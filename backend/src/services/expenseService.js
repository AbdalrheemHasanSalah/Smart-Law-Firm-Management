import { auditLater } from './auditService.js';
import {
  amount,
  assertActor,
  assertBody,
  date,
  execute,
  forbidden,
  invalid,
  money,
  notFound,
  OfficeFinanceError,
  optionalUuid,
  positiveInteger,
  text,
  uuid,
} from './financeInput.js';
import { officeCondition } from './officeScope.js';
import { createFileStore, RECEIPT_TYPES } from './receiptStorage.js';

/**
 * Office expenses and petty cash custodies (العُهد).
 *
 * An expense is money the office spent that is not billed to a client (rent, salaries, supplies,
 * transport, court costs it paid itself…). It is paid from an office account, or from a custody:
 * cash the administrator handed to a staff member, who records what they spend from it with
 * receipts. When the custody is settled, what is left goes back into an account.
 *
 *   admin               every expense and custody of the office; issues and settles custodies
 *   lawyer, assistant   their own custodies, and expenses from them while they are open
 */

const STAFF = ['admin', 'lawyer', 'assistant'];
const CATEGORIES = ['rent', 'salaries', 'utilities', 'supplies', 'transport', 'court_costs', 'other'];
const receipts = createFileStore({ folder: 'expense-receipts', noun: 'receipt' });

const isAdmin = (actor) => actor.role === 'admin';

/* ───────────── custodies ───────────── */

const SPENT = (alias) => `COALESCE((SELECT SUM(spent.amount) FROM office_expenses spent
                                     WHERE spent.custody_id = ${alias}.custody_id AND spent.status = 'active'), 0)`;

const CUSTODY_COLUMNS = `
  cu.custody_id, cu.holder_user_id, holder.full_name AS holder_name, cu.account_id, source.name AS account_name,
  cu.amount, cu.currency, to_char(cu.issued_on, 'YYYY-MM-DD') AS issued_on, cu.purpose, cu.status,
  to_char(cu.settled_on, 'YYYY-MM-DD') AS settled_on, cu.returned_amount, cu.return_account_id, cu.created_at,
  ${SPENT('cu')} AS spent`;
const CUSTODY_FROM = `
  FROM custodies cu
  JOIN app_users holder ON holder.user_id = cu.holder_user_id
  JOIN finance_accounts source ON source.account_id = cu.account_id`;

const publicCustody = (row) => {
  const spent = money(row.spent);
  return {
    custody_id: row.custody_id,
    holder_user_id: row.holder_user_id,
    holder_name: row.holder_name,
    account_id: row.account_id,
    account_name: row.account_name,
    amount: money(row.amount),
    currency: row.currency,
    issued_on: row.issued_on,
    purpose: row.purpose,
    status: row.status,
    spent,
    remaining: money(Number(row.amount) - spent),
    settled_on: row.settled_on,
    returned_amount: row.returned_amount === null || row.returned_amount === undefined ? null : money(row.returned_amount),
    return_account_id: row.return_account_id,
    created_at: row.created_at,
  };
};

/** The administrator sees every custody; anyone else only those they hold. */
function custodyScope(actor, parameters) {
  const office = officeCondition(actor, parameters, 'cu');
  if (isAdmin(actor)) return office;
  parameters.push(actor.user_id);
  return `${office} AND cu.holder_user_id = $${parameters.length}`;
}

export async function listCustodies(actor, queryParameters = {}) {
  assertActor(actor, STAFF);
  if (Object.keys(queryParameters).some((key) => !['status', 'holderId'].includes(key))) invalid('Unsupported custody query parameter.');
  const parameters = [];
  let filters = custodyScope(actor, parameters);
  if (queryParameters.status !== undefined) {
    if (!['open', 'settled'].includes(queryParameters.status)) invalid('status must be open or settled.');
    parameters.push(queryParameters.status);
    filters += ` AND cu.status = $${parameters.length}`;
  }
  if (queryParameters.holderId !== undefined) {
    parameters.push(uuid(queryParameters.holderId, 'holderId'));
    filters += ` AND cu.holder_user_id = $${parameters.length}`;
  }
  const result = await execute(
    `SELECT ${CUSTODY_COLUMNS} ${CUSTODY_FROM} WHERE ${filters}
      ORDER BY (cu.status = 'settled'), cu.issued_on DESC, cu.created_at DESC`,
    parameters
  );
  return { custodies: result.rows.map(publicCustody) };
}

async function findCustody(actor, custodyId) {
  uuid(custodyId, 'custodyId');
  const parameters = [custodyId];
  const scope = custodyScope(actor, parameters);
  const result = await execute(`SELECT ${CUSTODY_COLUMNS} ${CUSTODY_FROM} WHERE cu.custody_id = $1 AND ${scope}`, parameters);
  if (!result.rowCount) notFound('Custody');
  return publicCustody(result.rows[0]);
}

/** Hands cash from an open account to an active staff member, in the account's currency. */
export async function issueCustody(actor, body) {
  assertActor(actor, ['admin']);
  assertBody(body, ['holder_user_id', 'account_id', 'amount', 'issued_on', 'purpose']);
  const holder = uuid(body.holder_user_id, 'holder_user_id');
  const accountId = uuid(body.account_id, 'account_id');
  const value = amount(body.amount);
  const issuedOn = date(body.issued_on, 'issued_on');
  const purpose = text(body.purpose, 'purpose', 500);
  const parameters = [holder, accountId, value, issuedOn, purpose, actor.user_id];
  const office = officeCondition(actor, parameters, 'a');
  const result = await execute(
    `INSERT INTO custodies (holder_user_id, account_id, amount, currency, issued_on, purpose, created_by_user_id, office_id)
     SELECT member.user_id, a.account_id, $3, a.currency, $4::date, $5, $6, a.office_id
       FROM finance_accounts a
       JOIN office_memberships member ON member.office_id = a.office_id AND member.user_id = $1 AND member.status = 'active'
       JOIN roles r ON r.role_id = member.role_id AND r.role_name IN ('admin', 'lawyer', 'assistant')
      WHERE a.account_id = $2 AND a.is_active AND ${office}
     RETURNING custody_id`,
    parameters
  );
  if (!result.rowCount) invalid('The holder must be an active staff member and the account an open account of the office.');
  const custody = await findCustody(actor, result.rows[0].custody_id);
  auditLater(actor, { action: 'custody_issued', entityType: 'custody', entityId: custody.custody_id, details: { subject: custody.holder_name, values: { amount: custody.amount, currency: custody.currency } } });
  return custody;
}

/**
 * Closes a custody. What was not spent goes back into an open account in the same currency
 * (required when anything is left); nothing more can be spent from it afterwards.
 */
export async function settleCustody(actor, custodyId, body) {
  assertActor(actor, ['admin']);
  uuid(custodyId, 'custodyId');
  assertBody(body, ['settled_on', 'return_account_id']);
  const settledOn = date(body.settled_on, 'settled_on');
  const returnAccount = optionalUuid(body.return_account_id, 'return_account_id');
  const custody = await findCustody(actor, custodyId);
  if (custody.status !== 'open') throw new OfficeFinanceError(409, 'This custody is already settled.', 'CUSTODY_SETTLED');
  if (settledOn < custody.issued_on) invalid('settled_on must not be before the custody was issued.');
  if (custody.remaining > 0 && !returnAccount) invalid('Choose the account the remaining cash goes back to.');
  const parameters = [custodyId, settledOn, returnAccount];
  const office = officeCondition(actor, parameters, 'cu');
  // The remainder is computed under the row lock, so an expense recorded meanwhile is counted.
  const result = await execute(
    `WITH locked AS (
       SELECT cu.custody_id, cu.amount, cu.currency, cu.office_id FROM custodies cu
        WHERE cu.custody_id = $1 AND cu.status = 'open' AND ${office}
        FOR UPDATE
     ), remainder AS (
       SELECT locked.custody_id, locked.amount - ${SPENT('locked')} AS left_over, locked.currency, locked.office_id FROM locked
     )
     UPDATE custodies cu
        SET status = 'settled', settled_on = $2::date, returned_amount = remainder.left_over,
            return_account_id = CASE WHEN remainder.left_over > 0 THEN $3::uuid ELSE NULL END
       FROM remainder
      WHERE cu.custody_id = remainder.custody_id
        AND (remainder.left_over = 0 OR EXISTS (
          SELECT 1 FROM finance_accounts back WHERE back.account_id = $3::uuid AND back.office_id = remainder.office_id
             AND back.is_active AND back.currency = remainder.currency))
     RETURNING cu.custody_id`,
    parameters
  );
  if (!result.rowCount) invalid('The remaining cash must go back to an open account in the same currency.');
  const settled = await findCustody(actor, custodyId);
  auditLater(actor, { action: 'custody_settled', entityType: 'custody', entityId: custodyId, details: { subject: settled.holder_name, values: { spent: settled.spent, returned_amount: settled.returned_amount } } });
  return settled;
}

/* ───────────── expenses ───────────── */

const EXPENSE_COLUMNS = `
  e.expense_id, e.category, e.amount, e.currency, to_char(e.spent_on, 'YYYY-MM-DD') AS spent_on, e.payee, e.description,
  e.account_id, account.name AS account_name, e.custody_id, holder.full_name AS custody_holder_name,
  e.case_id, lc.case_number, (e.receipt_key IS NOT NULL) AS has_receipt, e.status, e.created_at,
  creator.full_name AS created_by_name, e.created_by_user_id`;
const EXPENSE_FROM = `
  FROM office_expenses e
  JOIN app_users creator ON creator.user_id = e.created_by_user_id
  LEFT JOIN finance_accounts account ON account.account_id = e.account_id
  LEFT JOIN custodies cu ON cu.custody_id = e.custody_id
  LEFT JOIN app_users holder ON holder.user_id = cu.holder_user_id
  LEFT JOIN legal_cases lc ON lc.case_id = e.case_id AND lc.office_id = e.office_id`;

const publicExpense = (row) => ({
  ...row,
  amount: money(row.amount),
  has_receipt: Boolean(row.has_receipt),
});

/** The administrator sees every expense; anyone else those paid from custodies they hold. */
function expenseScope(actor, parameters) {
  const office = officeCondition(actor, parameters, 'e');
  if (isAdmin(actor)) return office;
  parameters.push(actor.user_id);
  return `${office} AND cu.holder_user_id = $${parameters.length}`;
}

export async function listExpenses(actor, queryParameters = {}) {
  assertActor(actor, STAFF);
  const allowed = ['from', 'to', 'category', 'caseId', 'custodyId', 'accountId', 'status', 'page', 'pageSize'];
  if (Object.keys(queryParameters).some((key) => !allowed.includes(key))) invalid('Unsupported expense query parameter.');
  const page = positiveInteger(queryParameters.page, 1, 'page');
  const pageSize = Math.min(positiveInteger(queryParameters.pageSize, 25, 'pageSize'), 100);
  const parameters = [];
  let filters = expenseScope(actor, parameters);
  const add = (condition, value) => {
    parameters.push(value);
    filters += ` AND ${condition.replace('?', `$${parameters.length}`)}`;
  };
  if (queryParameters.from !== undefined) add('e.spent_on >= ?::date', date(queryParameters.from, 'from'));
  if (queryParameters.to !== undefined) add('e.spent_on <= ?::date', date(queryParameters.to, 'to'));
  if (queryParameters.category !== undefined) {
    if (!CATEGORIES.includes(queryParameters.category)) invalid('category is not supported.');
    add('e.category = ?', queryParameters.category);
  }
  if (queryParameters.caseId !== undefined) add('e.case_id = ?', uuid(queryParameters.caseId, 'caseId'));
  if (queryParameters.custodyId !== undefined) add('e.custody_id = ?', uuid(queryParameters.custodyId, 'custodyId'));
  if (queryParameters.accountId !== undefined) add('e.account_id = ?', uuid(queryParameters.accountId, 'accountId'));
  if (queryParameters.status !== undefined) {
    if (!['active', 'cancelled'].includes(queryParameters.status)) invalid('status must be active or cancelled.');
    add('e.status = ?', queryParameters.status);
  }
  const count = await execute(`SELECT COUNT(*)::int AS total ${EXPENSE_FROM} WHERE ${filters}`, parameters);
  const total = count.rows[0]?.total ?? 0;
  const pageParameters = [...parameters, pageSize, (page - 1) * pageSize];
  const result = await execute(
    `SELECT ${EXPENSE_COLUMNS} ${EXPENSE_FROM} WHERE ${filters}
      ORDER BY e.spent_on DESC, e.created_at DESC, e.expense_id
      LIMIT $${pageParameters.length - 1} OFFSET $${pageParameters.length}`,
    pageParameters
  );
  return {
    expenses: result.rows.map(publicExpense),
    pagination: { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) },
  };
}

async function findExpense(actor, expenseId, { withKey = false } = {}) {
  uuid(expenseId, 'expenseId');
  const parameters = [expenseId];
  const scope = expenseScope(actor, parameters);
  const result = await execute(
    `SELECT ${EXPENSE_COLUMNS}${withKey ? ', e.receipt_key, cu.status AS custody_status' : ', cu.status AS custody_status'} ${EXPENSE_FROM}
      WHERE e.expense_id = $1 AND ${scope}`,
    parameters
  );
  if (!result.rowCount) notFound('Expense');
  return result.rows[0];
}

/**
 * Records an expense paid from an office account (administrator) or from an open custody (the
 * administrator, or the person holding it). Its currency is the account's or the custody's, and
 * a custody cannot be overspent.
 */
export async function createExpense(actor, body) {
  assertActor(actor, STAFF);
  assertBody(body, ['category', 'amount', 'spent_on', 'payee', 'description', 'case_id', 'account_id', 'custody_id']);
  if (!CATEGORIES.includes(body.category)) invalid('category is not supported.');
  const value = amount(body.amount);
  const spentOn = date(body.spent_on, 'spent_on');
  const payee = text(body.payee, 'payee', 200);
  const description = text(body.description, 'description', 1000);
  const caseId = optionalUuid(body.case_id, 'case_id');
  const accountId = optionalUuid(body.account_id, 'account_id');
  const custodyId = optionalUuid(body.custody_id, 'custody_id');
  if ((accountId ? 1 : 0) + (custodyId ? 1 : 0) !== 1) invalid('An expense is paid either from an account or from a custody.');
  if (accountId && !isAdmin(actor)) forbidden();

  const base = [body.category, value, spentOn, payee, description, caseId, actor.user_id];
  // The case, when given, belongs to the office; outside the administrator, it is one of the actor's cases.
  const caseCheck = (officeParameter, userParameter) => `($6::uuid IS NULL OR EXISTS (
      SELECT 1 FROM legal_cases lc WHERE lc.case_id = $6::uuid AND lc.office_id = ${officeParameter}
      ${userParameter ? `AND EXISTS (SELECT 1 FROM assigned_to mine WHERE mine.case_id = lc.case_id AND mine.user_id = ${userParameter})` : ''}))`;

  let result;
  if (accountId) {
    const parameters = [...base, accountId];
    const office = officeCondition(actor, parameters, 'a');
    result = await execute(
      `INSERT INTO office_expenses (category, amount, currency, spent_on, payee, description, case_id, account_id, created_by_user_id, office_id)
       SELECT $1, $2, a.currency, $3::date, $4, $5, $6::uuid, a.account_id, $7, a.office_id
         FROM finance_accounts a
        WHERE a.account_id = $8 AND a.is_active AND ${office} AND ${caseCheck('a.office_id', null)}
       RETURNING expense_id`,
      parameters
    );
    if (!result.rowCount) invalid('The account must be an open account of the office, and the case one of its cases.');
  } else {
    const parameters = [...base, custodyId];
    const office = officeCondition(actor, parameters, 'cu');
    const holderOnly = isAdmin(actor) ? '' : 'AND cu.holder_user_id = $7';
    const custody = await findCustody(actor, custodyId);
    if (custody.status !== 'open') throw new OfficeFinanceError(409, 'This custody is settled; nothing more can be spent from it.', 'CUSTODY_SETTLED');
    // Locked, so two expenses recorded at once cannot overspend it together.
    result = await execute(
      `WITH locked AS (
         SELECT cu.custody_id, cu.amount, cu.currency, cu.office_id FROM custodies cu
          WHERE cu.custody_id = $8 AND cu.status = 'open' AND ${office} ${holderOnly}
          FOR UPDATE
       ), source AS (
         SELECT locked.*, locked.amount - ${SPENT('locked')} AS left_over FROM locked
       )
       INSERT INTO office_expenses (category, amount, currency, spent_on, payee, description, case_id, custody_id, created_by_user_id, office_id)
       SELECT $1, $2, source.currency, $3::date, $4, $5, $6::uuid, source.custody_id, $7, source.office_id
         FROM source
        WHERE source.left_over >= $2 AND ${caseCheck('source.office_id', isAdmin(actor) ? null : '$7')}
       RETURNING expense_id`,
      parameters
    );
    if (!result.rowCount) {
      if (value > custody.remaining) {
        throw new OfficeFinanceError(409, 'The expense is more than what is left in the custody.', 'CUSTODY_INSUFFICIENT');
      }
      invalid('The case must be one of your cases in the office.');
    }
  }
  const expense = publicExpense(await findExpense(actor, result.rows[0].expense_id));
  auditLater(actor, {
    action: 'expense_recorded', entityType: 'expense', entityId: expense.expense_id,
    details: { subject: expense.payee ?? expense.category, values: { category: expense.category, amount: expense.amount, currency: expense.currency, spent_on: expense.spent_on } },
  });
  return expense;
}

/** Cancels an expense, which gives its amount back to its account or custody. */
export async function cancelExpense(actor, expenseId) {
  assertActor(actor, STAFF);
  const expense = await findExpense(actor, expenseId);
  if (expense.status === 'cancelled') throw new OfficeFinanceError(409, 'This expense is already cancelled.', 'EXPENSE_CANCELLED');
  if (expense.custody_id && expense.custody_status !== 'open') {
    throw new OfficeFinanceError(409, 'The custody is settled; its expenses can no longer change.', 'CUSTODY_SETTLED');
  }
  const parameters = [expenseId];
  const office = officeCondition(actor, parameters, 'e');
  const result = await execute(
    `UPDATE office_expenses e SET status = 'cancelled', cancelled_at = NOW()
      WHERE e.expense_id = $1 AND e.status = 'active' AND ${office}
        AND (e.custody_id IS NULL OR EXISTS (SELECT 1 FROM custodies cu WHERE cu.custody_id = e.custody_id AND cu.status = 'open'))
     RETURNING e.expense_id`,
    parameters
  );
  if (!result.rowCount) throw new OfficeFinanceError(409, 'This expense can no longer be cancelled.', 'EXPENSE_CANCELLED');
  auditLater(actor, { action: 'expense_cancelled', entityType: 'expense', entityId: expenseId, details: { subject: expense.payee ?? expense.category, values: { amount: money(expense.amount), currency: expense.currency } } });
  return publicExpense(await findExpense(actor, expenseId));
}

export async function attachExpenseReceipt(actor, expenseId, request) {
  assertActor(actor, STAFF);
  uuid(expenseId, 'expenseId');
  const declared = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (!RECEIPT_TYPES.has(declared)) throw new OfficeFinanceError(415, 'The receipt must be a PDF, PNG or JPG file.', 'VALIDATION');
  await findExpense(actor, expenseId);
  const key = await receipts.save(await receipts.readBody(request));
  const parameters = [key, expenseId];
  const office = officeCondition(actor, parameters, 'e');
  let previous;
  try {
    const result = await execute(
      `UPDATE office_expenses AS e SET receipt_key = $1
         FROM office_expenses old
        WHERE e.expense_id = $2 AND old.expense_id = e.expense_id AND ${office}
       RETURNING old.receipt_key AS previous_key`,
      parameters
    );
    if (!result.rowCount) notFound('Expense');
    previous = result.rows[0].previous_key;
  } catch (error) {
    await receipts.remove(key);
    throw error;
  }
  if (previous) await receipts.remove(previous);
  return { expense_id: expenseId, has_receipt: true };
}

export async function readExpenseReceipt(actor, expenseId) {
  assertActor(actor, STAFF);
  const expense = await findExpense(actor, expenseId, { withKey: true });
  if (!expense.receipt_key) notFound('Receipt');
  return receipts.read(expense.receipt_key);
}
