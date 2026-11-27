import { auditLater } from './auditService.js';
import {
  amount,
  assertActor,
  assertBody,
  CURRENCIES,
  date,
  execute,
  forbidden,
  invalid,
  money,
  notFound,
  OfficeFinanceError,
  text,
  uuid,
} from './financeInput.js';
import { notifyLater } from './notificationService.js';
import { officeCondition } from './officeScope.js';

/**
 * Team HR: staff records, salary advances, monthly payslips and leave.
 *
 *   admin               every record of the office; gives advances, prepares and pays payslips,
 *                       decides leave requests
 *   lawyer, assistant   their own record, advances, paid payslips and leave; they request leave
 *
 * Money goes through office expenses (category "salaries"): an advance when it is given, a payslip
 * for its net when it is paid. What a person still owes is their advances minus the advance
 * deductions on their paid payslips. Leave days skip Fridays, and the annual entitlement is per
 * calendar year, by the day a leave starts.
 */

const STAFF = ['admin', 'lawyer', 'assistant'];
const ADMIN = ['admin'];
const LEAVE_TYPES = ['annual', 'sick', 'unpaid', 'other'];
const MAX_LEAVE_DAYS = 90;
const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const isAdmin = (actor) => actor.role === 'admin';

/** Working days between two dates, both included, Fridays not counted. */
export function leaveDays(startsOn, endsOn) {
  let days = 0;
  const day = new Date(`${startsOn}T00:00:00Z`);
  const end = new Date(`${endsOn}T00:00:00Z`);
  while (day <= end) {
    if (day.getUTCDay() !== 5) days += 1;
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return days;
}

/** What `user` still owes in advances: given, minus what paid payslips took back. */
const OWED = (office, user) => `
  (COALESCE((SELECT SUM(adv.amount) FROM salary_advances adv WHERE adv.office_id = ${office} AND adv.user_id = ${user}), 0)
   - COALESCE((SELECT SUM(back.advance_deduction) FROM payslips back
                WHERE back.office_id = ${office} AND back.user_id = ${user} AND back.status = 'paid'), 0))`;

/** Annual-leave days approved (or, with `pending`, also requested) for `user` in `year`. */
const ANNUAL_USED = (office, user, year, statuses) => `
  COALESCE((SELECT SUM(l.days) FROM leave_requests l
             WHERE l.office_id = ${office} AND l.user_id = ${user} AND l.leave_type = 'annual'
               AND l.status IN (${statuses}) AND EXTRACT(YEAR FROM l.starts_on) = ${year}), 0)::int`;

/* ───────────── staff records ───────────── */

const PROFILE_COLUMNS = (withId) => `
  m.user_id, u.full_name, u.email, r.role_name AS role, m.status AS membership_status,
  sp.job_title, to_char(sp.hire_date, 'YYYY-MM-DD') AS hire_date, sp.phone,
  ${withId ? 'sp.national_id,' : ''} sp.monthly_salary, COALESCE(sp.salary_currency, 'ILS') AS salary_currency,
  COALESCE(sp.annual_leave_days, 14) AS annual_leave_days, COALESCE(sp.show_on_public_page, FALSE) AS show_on_public_page,
  (sp.user_id IS NOT NULL) AS has_record,
  ${OWED('m.office_id', 'm.user_id')} AS advances_owed,
  ${ANNUAL_USED('m.office_id', 'm.user_id', '$2::int', "'approved'")} AS annual_used,
  ${ANNUAL_USED('m.office_id', 'm.user_id', '$2::int', "'pending'")} AS annual_pending`;

const PROFILE_FROM = `
  FROM office_memberships m
  JOIN app_users u ON u.user_id = m.user_id
  JOIN roles r ON r.role_id = m.role_id AND r.role_name IN ('admin', 'lawyer', 'assistant')
  LEFT JOIN staff_profiles sp ON sp.office_id = m.office_id AND sp.user_id = m.user_id`;

const publicProfile = (row) => ({
  ...row,
  monthly_salary: row.monthly_salary === null || row.monthly_salary === undefined ? null : money(row.monthly_salary),
  advances_owed: money(row.advances_owed),
  annual_remaining: Number(row.annual_leave_days) - Number(row.annual_used),
});

export async function listStaff(actor) {
  assertActor(actor, ADMIN);
  const parameters = [];
  const office = officeCondition(actor, parameters, 'm');
  parameters.push(new Date().getFullYear());
  const result = await execute(
    `SELECT ${PROFILE_COLUMNS(true)} ${PROFILE_FROM} WHERE ${office}
      ORDER BY (m.status = 'active') DESC, u.full_name`,
    parameters
  );
  return { staff: result.rows.map(publicProfile) };
}

const PROFILE_FIELDS = ['job_title', 'hire_date', 'phone', 'national_id', 'monthly_salary', 'salary_currency', 'annual_leave_days', 'show_on_public_page'];

/** Creates or updates a staff member's record. */
export async function saveStaffProfile(actor, userId, body) {
  assertActor(actor, ADMIN);
  uuid(userId, 'userId');
  assertBody(body, PROFILE_FIELDS);
  const values = {
    job_title: text(body.job_title, 'job_title', 100),
    hire_date: date(body.hire_date, 'hire_date', { required: false }),
    phone: text(body.phone, 'phone', 30),
    national_id: text(body.national_id, 'national_id', 30),
    monthly_salary: body.monthly_salary === undefined || body.monthly_salary === null || body.monthly_salary === ''
      ? null : amount(body.monthly_salary, 'monthly_salary', { allowZero: true }),
    salary_currency: body.salary_currency ?? 'ILS',
    annual_leave_days: body.annual_leave_days ?? 14,
    show_on_public_page: body.show_on_public_page ?? false,
  };
  if (!CURRENCIES.includes(values.salary_currency)) invalid('salary_currency must be ILS, JOD or USD.');
  if (typeof values.show_on_public_page !== 'boolean') invalid('show_on_public_page must be true or false.');
  if (!Number.isInteger(values.annual_leave_days) || values.annual_leave_days < 0 || values.annual_leave_days > 60) {
    invalid('annual_leave_days must be a whole number from 0 to 60.');
  }
  const parameters = [userId, ...PROFILE_FIELDS.map((field) => values[field])];
  const office = officeCondition(actor, parameters, 'm');
  // Only a staff member of this office has a record; the currency cannot change under open advances.
  const result = await execute(
    `INSERT INTO staff_profiles (user_id, office_id, job_title, hire_date, phone, national_id, monthly_salary, salary_currency, annual_leave_days, show_on_public_page)
     SELECT m.user_id, m.office_id, $2, $3::date, $4, $5, $6::numeric, $7, $8::int, $9::boolean
       FROM office_memberships m JOIN roles r ON r.role_id = m.role_id AND r.role_name IN ('admin', 'lawyer', 'assistant')
      WHERE m.user_id = $1 AND ${office}
        AND NOT EXISTS (SELECT 1 FROM staff_profiles old WHERE old.office_id = m.office_id AND old.user_id = m.user_id
                          AND old.salary_currency <> $7 AND ${OWED('m.office_id', 'm.user_id')} > 0)
     ON CONFLICT (office_id, user_id) DO UPDATE SET
       job_title = EXCLUDED.job_title, hire_date = EXCLUDED.hire_date, phone = EXCLUDED.phone,
       national_id = EXCLUDED.national_id, monthly_salary = EXCLUDED.monthly_salary,
       salary_currency = EXCLUDED.salary_currency, annual_leave_days = EXCLUDED.annual_leave_days,
       show_on_public_page = EXCLUDED.show_on_public_page, updated_at = NOW()
     RETURNING user_id`,
    parameters
  );
  if (!result.rowCount) invalid('The person must be a staff member of the office, and the salary currency cannot change while an advance is owed.');
  auditLater(actor, { action: 'staff_record_saved', entityType: 'staff', entityId: userId, details: { values: { job_title: values.job_title, monthly_salary: values.monthly_salary, salary_currency: values.salary_currency, annual_leave_days: values.annual_leave_days } } });
  return (await listStaff(actor)).staff.find((row) => row.user_id === userId);
}

/* ───────────── advances ───────────── */

const ADVANCE_COLUMNS = `
  a.advance_id, a.user_id, u.full_name, a.amount, a.currency, to_char(a.given_on, 'YYYY-MM-DD') AS given_on,
  a.note, e.account_id, account.name AS account_name, a.created_at`;
const ADVANCE_FROM = `
  FROM salary_advances a
  JOIN app_users u ON u.user_id = a.user_id
  JOIN office_expenses e ON e.expense_id = a.expense_id
  LEFT JOIN finance_accounts account ON account.account_id = e.account_id`;

export async function listAdvances(actor, queryParameters = {}) {
  assertActor(actor, STAFF);
  if (Object.keys(queryParameters).some((key) => key !== 'userId')) invalid('Unsupported advance query parameter.');
  const parameters = [];
  let filters = officeCondition(actor, parameters, 'a');
  const user = isAdmin(actor) ? (queryParameters.userId === undefined ? null : uuid(queryParameters.userId, 'userId')) : actor.user_id;
  if (!isAdmin(actor) && queryParameters.userId !== undefined && queryParameters.userId !== actor.user_id) forbidden();
  if (user) {
    parameters.push(user);
    filters += ` AND a.user_id = $${parameters.length}`;
  }
  const result = await execute(`SELECT ${ADVANCE_COLUMNS} ${ADVANCE_FROM} WHERE ${filters} ORDER BY a.given_on DESC, a.created_at DESC`, parameters);
  return { advances: result.rows.map((row) => ({ ...row, amount: money(row.amount) })) };
}

/** Pays an advance out of an open account in the person's salary currency, recorded as a salaries expense. */
export async function giveAdvance(actor, body) {
  assertActor(actor, ADMIN);
  assertBody(body, ['user_id', 'amount', 'account_id', 'given_on', 'note']);
  const userId = uuid(body.user_id, 'user_id');
  const value = amount(body.amount);
  const accountId = uuid(body.account_id, 'account_id');
  const givenOn = date(body.given_on, 'given_on');
  const note = text(body.note, 'note', 500);
  const parameters = [userId, value, accountId, givenOn, note, actor.user_id];
  const office = officeCondition(actor, parameters, 'sp');
  const result = await execute(
    `WITH person AS (
       SELECT sp.user_id, sp.office_id, sp.salary_currency, u.full_name
         FROM staff_profiles sp
         JOIN office_memberships m ON m.office_id = sp.office_id AND m.user_id = sp.user_id AND m.status = 'active'
         JOIN app_users u ON u.user_id = sp.user_id
        WHERE sp.user_id = $1 AND ${office}
     ), source AS (
       SELECT a.account_id, a.currency, person.* FROM finance_accounts a JOIN person ON a.office_id = person.office_id
        WHERE a.account_id = $3 AND a.is_active AND a.currency = person.salary_currency
     ), expense AS (
       INSERT INTO office_expenses (category, amount, currency, spent_on, payee, description, account_id, created_by_user_id, office_id)
       SELECT 'salaries', $2, source.currency, $4::date, source.full_name, 'سلفة على الراتب', source.account_id, $6, source.office_id
         FROM source
       RETURNING expense_id, office_id, currency
     )
     INSERT INTO salary_advances (user_id, amount, currency, given_on, note, expense_id, created_by_user_id, office_id)
     SELECT $1, $2, expense.currency, $4::date, $5, expense.expense_id, $6, expense.office_id FROM expense
     RETURNING advance_id`,
    parameters
  );
  if (!result.rowCount) invalid('The person needs a staff record, and the account must be open and in their salary currency.');
  auditLater(actor, { action: 'advance_given', entityType: 'staff', entityId: userId, details: { values: { amount: value, given_on: givenOn } } });
  return { advance_id: result.rows[0].advance_id };
}

/* ───────────── payroll ───────────── */

const PAYSLIP_COLUMNS = `
  p.payslip_id, p.user_id, u.full_name, p.period, p.salary, p.advance_deduction, p.other_deductions, p.deduction_note,
  p.net, p.currency, p.status, to_char(p.paid_on, 'YYYY-MM-DD') AS paid_on, e.account_id, account.name AS account_name,
  ${OWED('p.office_id', 'p.user_id')} AS advances_owed`;
const PAYSLIP_FROM = `
  FROM payslips p
  JOIN app_users u ON u.user_id = p.user_id
  LEFT JOIN office_expenses e ON e.expense_id = p.expense_id
  LEFT JOIN finance_accounts account ON account.account_id = e.account_id`;

const publicPayslip = (row) => ({
  ...row,
  salary: money(row.salary),
  advance_deduction: money(row.advance_deduction),
  other_deductions: money(row.other_deductions),
  net: money(row.net),
  advances_owed: money(row.advances_owed),
});

const period = (value) => {
  if (typeof value !== 'string' || !PERIOD_PATTERN.test(value)) invalid('period must be a month (YYYY-MM).');
  return value;
};

export async function listPayslips(actor, queryParameters = {}) {
  assertActor(actor, STAFF);
  if (Object.keys(queryParameters).some((key) => key !== 'period')) invalid('Unsupported payroll query parameter.');
  const parameters = [];
  let filters = officeCondition(actor, parameters, 'p');
  if (queryParameters.period !== undefined) {
    parameters.push(period(queryParameters.period));
    filters += ` AND p.period = $${parameters.length}`;
  }
  // A staff member sees only their own payslips, once paid.
  if (!isAdmin(actor)) {
    parameters.push(actor.user_id);
    filters += ` AND p.user_id = $${parameters.length} AND p.status = 'paid'`;
  }
  const result = await execute(`SELECT ${PAYSLIP_COLUMNS} ${PAYSLIP_FROM} WHERE ${filters} ORDER BY p.period DESC, u.full_name`, parameters);
  return { payslips: result.rows.map(publicPayslip) };
}

/**
 * Prepares the month's draft payslips for every active staff member with a salary and no payslip
 * for that month yet. Each proposes deducting what they owe in advances, up to the salary.
 */
export async function generatePayroll(actor, body) {
  assertActor(actor, ADMIN);
  assertBody(body, ['period']);
  const month = period(body.period);
  const parameters = [month, actor.user_id];
  const office = officeCondition(actor, parameters, 'sp');
  const result = await execute(
    `INSERT INTO payslips (user_id, period, salary, advance_deduction, other_deductions, net, currency, created_by_user_id, office_id)
     SELECT sp.user_id, $1, sp.monthly_salary, owed.amount, 0, sp.monthly_salary - owed.amount, sp.salary_currency, $2, sp.office_id
       FROM staff_profiles sp
       JOIN office_memberships m ON m.office_id = sp.office_id AND m.user_id = sp.user_id AND m.status = 'active'
       CROSS JOIN LATERAL (SELECT LEAST(sp.monthly_salary, GREATEST(${OWED('sp.office_id', 'sp.user_id')}, 0)) AS amount) owed
      WHERE ${office} AND sp.monthly_salary > 0
     ON CONFLICT (office_id, user_id, period) DO NOTHING
     RETURNING payslip_id`,
    parameters
  );
  auditLater(actor, { action: 'payroll_prepared', entityType: 'payroll', entityId: null, details: { values: { period: month, payslips: result.rowCount } } });
  return { created: result.rowCount, ...(await listPayslips(actor, { period: month })) };
}

async function findPayslip(actor, payslipId) {
  uuid(payslipId, 'payslipId');
  const parameters = [payslipId];
  const office = officeCondition(actor, parameters, 'p');
  const result = await execute(`SELECT ${PAYSLIP_COLUMNS} ${PAYSLIP_FROM} WHERE p.payslip_id = $1 AND ${office}`, parameters);
  if (!result.rowCount) notFound('Payslip');
  return publicPayslip(result.rows[0]);
}

const notDraft = () => {
  throw new OfficeFinanceError(409, 'This payslip is already paid and can no longer change.', 'PAYSLIP_PAID');
};

/** Adjusts a draft payslip's deductions; the net follows. */
export async function updatePayslip(actor, payslipId, body) {
  assertActor(actor, ADMIN);
  assertBody(body, ['advance_deduction', 'other_deductions', 'deduction_note']);
  const slip = await findPayslip(actor, payslipId);
  if (slip.status !== 'draft') notDraft();
  const advance = body.advance_deduction === undefined ? slip.advance_deduction : amount(body.advance_deduction, 'advance_deduction', { allowZero: true });
  const other = body.other_deductions === undefined ? slip.other_deductions : amount(body.other_deductions, 'other_deductions', { allowZero: true });
  const note = Object.hasOwn(body, 'deduction_note') ? text(body.deduction_note, 'deduction_note', 500) : slip.deduction_note;
  if (advance > slip.advances_owed) invalid('The advance deduction is more than what is owed.');
  const net = money(slip.salary - advance - other);
  if (net < 0) invalid('Deductions cannot be more than the salary.');
  const parameters = [payslipId, advance, other, note, net];
  const office = officeCondition(actor, parameters, 'p');
  const result = await execute(
    `UPDATE payslips p SET advance_deduction = $2, other_deductions = $3, deduction_note = $4, net = $5
      WHERE p.payslip_id = $1 AND p.status = 'draft' AND ${office} RETURNING p.payslip_id`,
    parameters
  );
  if (!result.rowCount) notDraft();
  return findPayslip(actor, payslipId);
}

export async function deletePayslip(actor, payslipId) {
  assertActor(actor, ADMIN);
  uuid(payslipId, 'payslipId');
  const parameters = [payslipId];
  const office = officeCondition(actor, parameters, 'p');
  const result = await execute(`DELETE FROM payslips p WHERE p.payslip_id = $1 AND p.status = 'draft' AND ${office} RETURNING p.payslip_id`, parameters);
  if (!result.rowCount) {
    await findPayslip(actor, payslipId);
    notDraft();
  }
  return { deleted: true };
}

/**
 * Pays a draft payslip: its net leaves an open account in its currency as a salaries expense, and
 * its advance deduction counts against what the person owes. Checked again under the row lock.
 */
export async function payPayslip(actor, payslipId, body) {
  assertActor(actor, ADMIN);
  assertBody(body, ['account_id', 'paid_on']);
  const paidOn = date(body.paid_on, 'paid_on');
  const accountId = body.account_id === undefined || body.account_id === null ? null : uuid(body.account_id, 'account_id');
  const slip = await findPayslip(actor, payslipId);
  if (slip.status !== 'draft') notDraft();
  if (slip.net > 0 && !accountId) invalid('Choose the account the salary is paid from.');
  if (slip.advance_deduction > slip.advances_owed) invalid('The advance deduction is more than what is owed.');
  const parameters = [payslipId, accountId, paidOn, actor.user_id];
  const office = officeCondition(actor, parameters, 'p');
  const result = await execute(
    `WITH slip AS (
       SELECT p.payslip_id, p.user_id, p.period, p.net, p.currency, p.advance_deduction, p.office_id
         FROM payslips p WHERE p.payslip_id = $1 AND p.status = 'draft' AND ${office}
        FOR UPDATE
     ), ready AS (
       SELECT slip.* FROM slip
        WHERE slip.advance_deduction <= ${OWED('slip.office_id', 'slip.user_id')}
          AND (slip.net = 0 OR EXISTS (SELECT 1 FROM finance_accounts a WHERE a.account_id = $2::uuid
                 AND a.office_id = slip.office_id AND a.is_active AND a.currency = slip.currency))
     ), expense AS (
       INSERT INTO office_expenses (category, amount, currency, spent_on, payee, description, account_id, created_by_user_id, office_id)
       SELECT 'salaries', ready.net, ready.currency, $3::date, u.full_name, 'راتب ' || ready.period, $2::uuid, $4, ready.office_id
         FROM ready JOIN app_users u ON u.user_id = ready.user_id
        WHERE ready.net > 0
       RETURNING expense_id
     )
     UPDATE payslips p SET status = 'paid', paid_on = $3::date, expense_id = (SELECT expense_id FROM expense)
       FROM ready WHERE p.payslip_id = ready.payslip_id
     RETURNING p.payslip_id`,
    parameters
  );
  if (!result.rowCount) invalid('The account must be open and in the payslip currency, and the advance deduction within what is owed.');
  auditLater(actor, { action: 'payslip_paid', entityType: 'payroll', entityId: payslipId, details: { subject: slip.full_name, values: { period: slip.period, net: slip.net, currency: slip.currency } } });
  return findPayslip(actor, payslipId);
}

/* ───────────── leave ───────────── */

const LEAVE_COLUMNS = `
  l.leave_id, l.user_id, u.full_name, l.leave_type, to_char(l.starts_on, 'YYYY-MM-DD') AS starts_on,
  to_char(l.ends_on, 'YYYY-MM-DD') AS ends_on, l.days, l.reason, l.status, l.decision_note, l.decided_at,
  decider.full_name AS decided_by_name, l.created_at`;
const LEAVE_FROM = `
  FROM leave_requests l
  JOIN app_users u ON u.user_id = l.user_id
  LEFT JOIN app_users decider ON decider.user_id = l.decided_by_user_id`;

export async function listLeave(actor, queryParameters = {}) {
  assertActor(actor, STAFF);
  if (Object.keys(queryParameters).some((key) => !['status', 'userId', 'year'].includes(key))) invalid('Unsupported leave query parameter.');
  const parameters = [];
  let filters = officeCondition(actor, parameters, 'l');
  if (!isAdmin(actor)) {
    if (queryParameters.userId !== undefined && queryParameters.userId !== actor.user_id) forbidden();
    parameters.push(actor.user_id);
    filters += ` AND l.user_id = $${parameters.length}`;
  } else if (queryParameters.userId !== undefined) {
    parameters.push(uuid(queryParameters.userId, 'userId'));
    filters += ` AND l.user_id = $${parameters.length}`;
  }
  if (queryParameters.status !== undefined) {
    if (!['pending', 'approved', 'rejected', 'cancelled'].includes(queryParameters.status)) invalid('status is not supported.');
    parameters.push(queryParameters.status);
    filters += ` AND l.status = $${parameters.length}`;
  }
  if (queryParameters.year !== undefined) {
    if (!/^\d{4}$/.test(queryParameters.year)) invalid('year must be a year.');
    parameters.push(Number(queryParameters.year));
    filters += ` AND EXTRACT(YEAR FROM l.starts_on) = $${parameters.length}`;
  }
  const result = await execute(
    `SELECT ${LEAVE_COLUMNS} ${LEAVE_FROM} WHERE ${filters}
      ORDER BY (l.status = 'pending') DESC, l.starts_on DESC, l.created_at DESC`,
    parameters
  );
  return { leave: result.rows };
}

/** A staff member asks for leave for themselves; annual leave must fit what is left of the year. */
export async function requestLeave(actor, body) {
  assertActor(actor, STAFF);
  assertBody(body, ['leave_type', 'starts_on', 'ends_on', 'reason']);
  if (!LEAVE_TYPES.includes(body.leave_type)) invalid('leave_type is not supported.');
  const startsOn = date(body.starts_on, 'starts_on');
  const endsOn = date(body.ends_on, 'ends_on');
  if (endsOn < startsOn) invalid('ends_on must not be before starts_on.');
  const days = leaveDays(startsOn, endsOn);
  if (days === 0) invalid('The leave covers no working day.');
  if (days > MAX_LEAVE_DAYS) invalid(`A leave request may cover at most ${MAX_LEAVE_DAYS} working days.`);
  const reason = text(body.reason, 'reason', 1000);
  const year = Number(startsOn.slice(0, 4));

  const checkParameters = [actor.user_id, startsOn, endsOn, year];
  const checkOffice = officeCondition(actor, checkParameters, 'm');
  const check = await execute(
    `SELECT EXISTS (SELECT 1 FROM leave_requests l WHERE l.office_id = m.office_id AND l.user_id = m.user_id
                      AND l.status IN ('pending', 'approved') AND l.starts_on <= $3::date AND l.ends_on >= $2::date) AS overlaps,
            COALESCE(sp.annual_leave_days, 14) AS entitlement,
            ${ANNUAL_USED('m.office_id', 'm.user_id', '$4::int', "'approved', 'pending'")} AS taken
       FROM office_memberships m
       LEFT JOIN staff_profiles sp ON sp.office_id = m.office_id AND sp.user_id = m.user_id
      WHERE m.user_id = $1 AND ${checkOffice}`,
    checkParameters
  );
  if (!check.rowCount) forbidden();
  const { overlaps, entitlement, taken } = check.rows[0];
  if (overlaps) throw new OfficeFinanceError(409, 'You already have leave on some of these days.', 'LEAVE_OVERLAP');
  if (body.leave_type === 'annual' && Number(taken) + days > Number(entitlement)) {
    throw new OfficeFinanceError(409, `Only ${Number(entitlement) - Number(taken)} annual leave days are left this year.`, 'LEAVE_BALANCE');
  }

  const parameters = [actor.user_id, body.leave_type, startsOn, endsOn, days, reason];
  officeCondition(actor, parameters, 'office');
  const result = await execute(
    `INSERT INTO leave_requests (user_id, leave_type, starts_on, ends_on, days, reason, office_id)
     VALUES ($1, $2, $3::date, $4::date, $5, $6, $7) RETURNING leave_id`,
    parameters
  );
  notifyLater('leave.requested', { officeId: actor.office_id, actorUserId: actor.user_id, days });
  return { leave_id: result.rows[0].leave_id, days };
}

/** The administrator approves or refuses a pending request; the requester is told. */
export async function decideLeave(actor, leaveId, body) {
  assertActor(actor, ADMIN);
  uuid(leaveId, 'leaveId');
  assertBody(body, ['status', 'decision_note']);
  if (!['approved', 'rejected'].includes(body.status)) invalid('status must be approved or rejected.');
  const note = text(body.decision_note, 'decision_note', 500);
  const parameters = [leaveId, body.status, note, actor.user_id];
  const office = officeCondition(actor, parameters, 'l');
  const result = await execute(
    `UPDATE leave_requests l SET status = $2, decision_note = $3, decided_by_user_id = $4, decided_at = NOW()
      WHERE l.leave_id = $1 AND l.status = 'pending' AND ${office}
     RETURNING l.leave_id, l.user_id`,
    parameters
  );
  if (!result.rowCount) throw new OfficeFinanceError(409, 'This request is not pending.', 'LEAVE_DECIDED');
  notifyLater('leave.decided', { officeId: actor.office_id, actorUserId: actor.user_id, userId: result.rows[0].user_id, status: body.status });
  auditLater(actor, { action: body.status === 'approved' ? 'leave_approved' : 'leave_rejected', entityType: 'leave', entityId: leaveId, details: {} });
  return { leave_id: leaveId, status: body.status };
}

/** The requester withdraws a pending request; the administrator may also cancel approved leave not yet started. */
export async function cancelLeave(actor, leaveId) {
  assertActor(actor, STAFF);
  uuid(leaveId, 'leaveId');
  const parameters = [leaveId];
  const office = officeCondition(actor, parameters, 'l');
  let allowed = `(l.status = 'pending' OR (l.status = 'approved' AND l.starts_on > CURRENT_DATE))`;
  if (!isAdmin(actor)) {
    parameters.push(actor.user_id);
    allowed = `l.status = 'pending' AND l.user_id = $${parameters.length}`;
  }
  const result = await execute(
    `UPDATE leave_requests l SET status = 'cancelled', decided_at = NULL
      WHERE l.leave_id = $1 AND ${allowed} AND ${office} RETURNING l.leave_id`,
    parameters
  );
  if (!result.rowCount) throw new OfficeFinanceError(409, 'This leave can no longer be cancelled.', 'LEAVE_DECIDED');
  return { leave_id: leaveId, status: 'cancelled' };
}

/* ───────────── a person's own view ───────────── */

export async function myHr(actor) {
  assertActor(actor, STAFF);
  const parameters = [actor.user_id];
  const office = officeCondition(actor, parameters, 'm');
  parameters.push(new Date().getFullYear());
  // The profile query uses $2 for the year; the office takes $3 here.
  const result = await execute(
    `SELECT ${PROFILE_COLUMNS(true).replaceAll('$2::int', '$3::int')} ${PROFILE_FROM} WHERE m.user_id = $1 AND ${office}`,
    parameters
  );
  if (!result.rowCount) notFound('Staff record');
  const [payslips, leave, advances] = await Promise.all([listPayslips(actor), listLeave(actor), listAdvances(actor)]);
  return { profile: publicProfile(result.rows[0]), ...payslips, ...leave, ...advances };
}
