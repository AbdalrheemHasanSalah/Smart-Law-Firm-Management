import { query } from '../config/db.js';
import { auditLater } from './auditService.js';
import { cancelInvoice, createInvoice } from './financeService.js';
import { officeCondition } from './officeScope.js';

/**
 * Fee agreements and installments (اتفاقيات الأتعاب والأقساط). Office admin only, like the rest of
 * the office's money.
 *
 * An agreement is the fee agreed with a client on a case, in one currency, paid in installments.
 * Each installment is issued as an ordinary invoice with its due date when the agreement is made,
 * so payments, the client's statement, overdue marks, reminders and the aging report all work on
 * it unchanged. The installments must add up to the agreed fee exactly.
 *
 * A settlement closes what is left: every installment with nothing paid on it is cancelled, and
 * when the client pays an agreed sum instead, one invoice for that sum is issued. Partly paid
 * installments stay as they are (their remainder is still owed).
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCIES = ['ILS', 'JOD', 'USD'];
const MAX_INSTALLMENTS = 60;
const MAX_AMOUNT = 9_999_999_999.99;

export class FeeAgreementError extends Error {
  constructor(status, message, publicCode) {
    super(message);
    this.name = 'FeeAgreementError';
    this.status = status;
    if (publicCode) this.publicCode = publicCode;
  }
}

const invalid = (message) => {
  throw new FeeAgreementError(400, message, 'VALIDATION');
};
const notFound = () => {
  throw new FeeAgreementError(404, 'Fee agreement not found.', 'NOT_FOUND');
};

function assertAdmin(actor) {
  if (!actor || actor.role !== 'admin' || typeof actor.user_id !== 'string' || !UUID_PATTERN.test(actor.user_id)) {
    throw new FeeAgreementError(403, 'You do not have permission to access this resource.', 'FORBIDDEN');
  }
  officeCondition(actor, [], 'office');
}

const uuid = (value, field) => (typeof value === 'string' && UUID_PATTERN.test(value) ? value : invalid(`${field} must be a valid UUID.`));
const cents = (value) => Math.round(Number(value) * 100);
const fromCents = (value) => Math.round(value) / 100;

function amountOf(value, field) {
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number) || number <= 0 || number > MAX_AMOUNT || Math.round(number * 100) !== number * 100) {
    invalid(`${field} must be a positive amount with at most two decimals.`);
  }
  return number;
}

function dateOf(value, field) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) invalid(`${field} must be a date (YYYY-MM-DD).`);
  if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) invalid(`${field} is not a real date.`);
  return value;
}

/** Adds whole months to a date, keeping the day or the month's last day (31 Jan + 1 → 28/29 Feb). */
export function addMonths(day, months) {
  const [year, month, date] = day.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * An even schedule: `count` installments `everyMonths` apart from `firstDue`, the cents that do not
 * divide evenly going to the last one, so the sum is exactly the total.
 */
export function evenSchedule(total, count, firstDue, everyMonths = 1) {
  const totalCents = cents(total);
  const base = Math.floor(totalCents / count);
  return Array.from({ length: count }, (_, index) => ({
    due_on: addMonths(firstDue, index * everyMonths),
    amount: fromCents(index === count - 1 ? totalCents - base * (count - 1) : base),
  }));
}

function parseAgreement(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('A JSON object is required.');
  const unknown = Object.keys(body).filter((key) => !['case_id', 'client_id', 'currency', 'total_amount', 'description', 'installments', 'plan'].includes(key));
  if (unknown.length) invalid(`Unknown fields: ${unknown.join(', ')}.`);
  const currency = CURRENCIES.includes(body.currency) ? body.currency : invalid('currency must be ILS, JOD or USD.');
  const total = amountOf(body.total_amount, 'total_amount');
  let description = null;
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== 'string' || body.description.trim().length > 500) invalid('description must be at most 500 characters.');
    description = body.description.trim() || null;
  }
  let schedule;
  if (body.plan !== undefined) {
    if (body.installments !== undefined) invalid('Give either plan or installments, not both.');
    const plan = body.plan;
    const count = Number(plan?.count);
    const every = Number(plan?.every_months ?? 1);
    if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALLMENTS) invalid(`plan.count must be 1 to ${MAX_INSTALLMENTS}.`);
    if (!Number.isInteger(every) || every < 1 || every > 12) invalid('plan.every_months must be 1 to 12.');
    if (cents(total) < count) invalid('The fee is too small for that many installments.');
    schedule = evenSchedule(total, count, dateOf(plan?.first_due_on, 'plan.first_due_on'), every);
  } else {
    if (!Array.isArray(body.installments) || body.installments.length === 0 || body.installments.length > MAX_INSTALLMENTS) {
      invalid(`installments must list 1 to ${MAX_INSTALLMENTS} installments, or give a plan.`);
    }
    schedule = body.installments.map((entry, index) => ({
      due_on: dateOf(entry?.due_on, `installments[${index}].due_on`),
      amount: amountOf(entry?.amount, `installments[${index}].amount`),
    }));
    schedule.sort((a, b) => a.due_on.localeCompare(b.due_on));
  }
  const sum = schedule.reduce((acc, entry) => acc + cents(entry.amount), 0);
  if (sum !== cents(total)) invalid(`The installments add up to ${fromCents(sum)}, not the agreed ${total}.`);
  return { caseId: uuid(body.case_id, 'case_id'), clientId: uuid(body.client_id, 'client_id'), currency, total, description, schedule };
}

/* ───────────────────────── reading ───────────────────────── */

const SELECT_AGREEMENT = `
  SELECT a.agreement_id, a.case_id, a.client_id, a.currency, a.total_amount, a.description, a.status, a.settled_at,
         a.settlement_amount, a.settlement_note, a.settlement_invoice_id, a.created_at, u.full_name AS created_by_name,
         lc.case_number, lc.title AS case_title, c.full_name_or_org AS client_name,
         COALESCE((
           SELECT json_agg(json_build_object(
                    'installment_id', fi.installment_id, 'sequence', fi.sequence, 'due_on', to_char(fi.due_on, 'YYYY-MM-DD'),
                    'amount', fi.amount, 'invoice_id', fi.invoice_id, 'invoice_number', i.invoice_number, 'invoice_status', i.status,
                    'paid', COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.invoice_id AND p.status = 'completed'), 0)
                  ) ORDER BY fi.sequence)
             FROM fee_installments fi JOIN invoices i ON i.invoice_id = fi.invoice_id
            WHERE fi.agreement_id = a.agreement_id
         ), '[]'::json) AS installments
    FROM fee_agreements a
    JOIN app_users u ON u.user_id = a.created_by_user_id
    JOIN legal_cases lc ON lc.case_id = a.case_id
    JOIN clients c ON c.client_id = a.client_id`;

const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;

/** An installment's state from its invoice: paid, partly paid, overdue, due, or cancelled. */
export function installmentState(entry, today = new Date().toISOString().slice(0, 10)) {
  if (entry.invoice_status === 'cancelled') return 'cancelled';
  if (money(entry.paid) >= money(entry.amount)) return 'paid';
  if (entry.due_on < today) return 'overdue';
  return money(entry.paid) > 0 ? 'partial' : 'due';
}

function publicAgreement(row) {
  const installments = row.installments.map((entry) => ({
    ...entry,
    amount: money(entry.amount),
    paid: money(entry.paid),
    remaining: entry.invoice_status === 'cancelled' ? 0 : money(money(entry.amount) - money(entry.paid)),
    state: installmentState(entry),
  }));
  const paid = installments.reduce((sum, entry) => sum + entry.paid, 0);
  const remaining = installments.reduce((sum, entry) => sum + entry.remaining, 0);
  return {
    agreement_id: row.agreement_id,
    case_id: row.case_id,
    case_number: row.case_number,
    case_title: row.case_title,
    client_id: row.client_id,
    client_name: row.client_name,
    currency: row.currency,
    total_amount: money(row.total_amount),
    description: row.description,
    status: row.status,
    settled_at: row.settled_at,
    settlement_amount: row.settlement_amount === null ? null : money(row.settlement_amount),
    settlement_note: row.settlement_note,
    created_at: row.created_at,
    created_by_name: row.created_by_name,
    paid: money(paid),
    remaining: money(remaining),
    overdue_count: installments.filter((entry) => entry.state === 'overdue').length,
    installments,
  };
}

export async function listAgreements(actor, filters = {}) {
  assertAdmin(actor);
  const parameters = [actor.office_id];
  let where = 'a.office_id = $1';
  if (filters.caseId !== undefined) {
    parameters.push(uuid(filters.caseId, 'caseId'));
    where += ` AND a.case_id = $${parameters.length}`;
  }
  if (filters.clientId !== undefined) {
    parameters.push(uuid(filters.clientId, 'clientId'));
    where += ` AND a.client_id = $${parameters.length}`;
  }
  const result = await query(`${SELECT_AGREEMENT} WHERE ${where} ORDER BY a.created_at DESC LIMIT 200`, parameters);
  return { agreements: result.rows.map(publicAgreement) };
}

async function findAgreement(actor, agreementId) {
  const result = await query(`${SELECT_AGREEMENT} WHERE a.agreement_id = $1 AND a.office_id = $2`, [uuid(agreementId, 'agreementId'), actor.office_id]);
  if (!result.rowCount) notFound();
  return publicAgreement(result.rows[0]);
}

/* ───────────────────────── creating and settling ───────────────────────── */

/**
 * Records the agreement and issues one invoice per installment. If an invoice cannot be issued
 * (the client is not a party to the case, say), the invoices already issued are cancelled and the
 * agreement is removed, so nothing half-made is left.
 */
export async function createAgreement(actor, body) {
  assertAdmin(actor);
  const input = parseAgreement(body);
  const party = await query(
    `SELECT 1 FROM involves i JOIN clients c ON c.client_id = i.client_id
      WHERE i.case_id = $1 AND i.client_id = $2 AND c.office_id = $3`,
    [input.caseId, input.clientId, actor.office_id]
  );
  if (!party.rowCount) invalid('The client is not a party to this case.');
  const inserted = await query(
    `INSERT INTO fee_agreements (office_id, case_id, client_id, currency, total_amount, description, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING agreement_id`,
    [actor.office_id, input.caseId, input.clientId, input.currency, input.total, input.description, actor.user_id]
  );
  const agreementId = inserted.rows[0].agreement_id;
  const issued = [];
  try {
    for (const [index, entry] of input.schedule.entries()) {
      const invoice = await createInvoice(actor, {
        client_id: input.clientId,
        case_id: input.caseId,
        category: 'legal_fees',
        currency: input.currency,
        amount: entry.amount,
        // The end of the due day in Palestine, so the installment is overdue only from the next day.
        due_at: `${entry.due_on}T20:00:00Z`,
        description: `قسط ${index + 1} من ${input.schedule.length}${input.description ? ` — ${input.description}` : ' — اتفاقية أتعاب'}`,
      });
      issued.push(invoice.invoice_id);
      await query(
        `INSERT INTO fee_installments (office_id, agreement_id, sequence, due_on, amount, invoice_id) VALUES ($1, $2, $3, $4, $5, $6)`,
        [actor.office_id, agreementId, index + 1, entry.due_on, entry.amount, invoice.invoice_id]
      );
    }
  } catch (error) {
    for (const invoiceId of issued) await cancelInvoice(actor, invoiceId).catch(() => {});
    await query('DELETE FROM fee_agreements WHERE agreement_id = $1 AND office_id = $2', [agreementId, actor.office_id]).catch(() => {});
    throw error;
  }
  auditLater(actor, {
    action: 'fee_agreement_created',
    entityType: 'case',
    entityId: input.caseId,
    details: { agreement_id: agreementId, total: input.total, currency: input.currency, installments: input.schedule.length },
  });
  return { agreement: await findAgreement(actor, agreementId) };
}

/**
 * Settles what is left of an agreement: installments with nothing paid are cancelled; `amount`
 * (0 to waive) is issued as one invoice due today when it is above zero.
 */
export async function settleAgreement(actor, agreementId, body) {
  assertAdmin(actor);
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('A JSON object is required.');
  const unknown = Object.keys(body).filter((key) => !['amount', 'note'].includes(key));
  if (unknown.length) invalid(`Unknown fields: ${unknown.join(', ')}.`);
  const amount = body.amount === 0 || body.amount === '0' ? 0 : amountOf(body.amount, 'amount');
  if (typeof body.note !== 'string' || !body.note.trim() || body.note.trim().length > 1000) invalid('note is required (at most 1000 characters).');
  const agreement = await findAgreement(actor, agreementId);
  if (agreement.status !== 'active') throw new FeeAgreementError(409, 'This agreement is already settled.', 'AGREEMENT_SETTLED');
  if (amount > agreement.remaining) invalid('The settlement cannot be more than what is still owed.');
  // Claim the agreement first, so a second settlement at the same moment does nothing.
  const claimed = await query(
    `UPDATE fee_agreements SET status = 'settled', settled_at = NOW(), settlement_amount = $3, settlement_note = $4
      WHERE agreement_id = $1 AND office_id = $2 AND status = 'active' RETURNING agreement_id`,
    [agreementId, actor.office_id, amount, body.note.trim()]
  );
  if (!claimed.rowCount) throw new FeeAgreementError(409, 'This agreement is already settled.', 'AGREEMENT_SETTLED');
  for (const entry of agreement.installments) {
    if (entry.invoice_status === 'unpaid' && entry.paid === 0) await cancelInvoice(actor, entry.invoice_id).catch(() => {});
  }
  if (amount > 0) {
    const invoice = await createInvoice(actor, {
      client_id: agreement.client_id,
      case_id: agreement.case_id,
      category: 'legal_fees',
      currency: agreement.currency,
      amount,
      due_at: new Date().toISOString().slice(0, 10),
      description: `تسوية اتفاقية الأتعاب${agreement.description ? ` — ${agreement.description}` : ''}`,
    });
    await query('UPDATE fee_agreements SET settlement_invoice_id = $3 WHERE agreement_id = $1 AND office_id = $2', [agreementId, actor.office_id, invoice.invoice_id]);
  }
  auditLater(actor, { action: 'fee_agreement_settled', entityType: 'case', entityId: agreement.case_id, details: { agreement_id: agreementId, amount } });
  return { agreement: await findAgreement(actor, agreementId) };
}
