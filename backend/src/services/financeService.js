import { query } from '../config/db.js';
import { auditLater } from './auditService.js';
import { officeCondition } from './officeScope.js';

/**
 * Case finances. The office bills a client with invoices, each one lawyer's fees, court fees or
 * expenses, in shekels, dinars or dollars; payments are recorded against an invoice and move its
 * status (unpaid → partially paid → paid). Money is never added across currencies.
 *
 *   admin             everything in the office; the only role that bills or records payments
 *   lawyer/assistant  read the invoices of cases they are assigned to
 *   client            read their own statement in the portal
 *
 * "Overdue" is not stored: an unpaid or partly paid invoice past its due date is reported as
 * overdue when it is read, so nothing has to run at midnight.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CATEGORIES = ['legal_fees', 'court_fees', 'expenses'];
export const CURRENCIES = ['ILS', 'JOD', 'USD'];
export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'cheque', 'card'];
const STATES = ['unpaid', 'partially_paid', 'paid', 'overdue', 'cancelled'];
const MAX_AMOUNT = 9_999_999_999.99;
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 25;

export class FinanceServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'FinanceServiceError';
    this.status = status;
  }
}

const invalid = (message) => {
  throw new FinanceServiceError(400, message);
};
const forbidden = () => {
  throw new FinanceServiceError(403, 'You do not have permission to access this resource.');
};

function assertActor(actor, roles) {
  if (!actor || !roles.includes(actor.role) || typeof actor.user_id !== 'string' || !UUID_PATTERN.test(actor.user_id)) {
    forbidden();
  }
}

function validateUuid(value, field) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) invalid(`${field} must be a valid UUID.`);
  return value;
}

function validateAmount(value) {
  const amount = typeof value === 'string' ? Number(value) : value;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    invalid('amount must be a positive number.');
  }
  // Two decimal places: whole agorot, piastres or cents.
  if (Math.round(amount * 100) !== Number((amount * 100).toFixed(6))) invalid('amount may have at most two decimal places.');
  return Math.round(amount * 100) / 100;
}

function validateDate(value, field) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) invalid(`${field} must be a valid date.`);
  return new Date(value).toISOString();
}

function optionalText(body, field, max) {
  if (!Object.hasOwn(body, field) || body[field] === null) return null;
  if (typeof body[field] !== 'string') invalid(`${field} must be a string or null.`);
  const value = body[field].trim();
  if (value.length > max) invalid(`${field} must contain at most ${max} characters.`);
  return value || null;
}

function validateObject(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Request body must be a JSON object.');
  if (Object.keys(body).some((field) => !allowed.has(field))) invalid('Request contains unsupported fields.');
}

const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;

/* ───────────────────────── reading invoices ───────────────────────── */

/** One invoice row with what has been paid on it and its state as of now. */
const INVOICE_SELECT = `
  SELECT
    i.invoice_id, i.invoice_number, i.category, i.description, i.amount, i.currency, i.status,
    i.issued_at, i.due_at, i.client_id, i.case_id,
    c.full_name_or_org AS client_name,
    lc.case_number,
    COALESCE(paid.total, 0) AS paid_amount,
    CASE
      WHEN i.status IN ('unpaid', 'partially_paid') AND i.due_at IS NOT NULL AND i.due_at < NOW() THEN 'overdue'
      ELSE i.status
    END AS state
  FROM invoices i
  JOIN clients c ON c.client_id = i.client_id
  LEFT JOIN legal_cases lc ON lc.case_id = i.case_id
  LEFT JOIN LATERAL (
    SELECT SUM(p.amount) AS total FROM payments p WHERE p.invoice_id = i.invoice_id AND p.status = 'completed'
  ) paid ON TRUE
`;

function publicInvoice(row) {
  const amount = money(row.amount);
  const paid = money(row.paid_amount);
  return {
    invoice_id: row.invoice_id,
    invoice_number: row.invoice_number,
    category: row.category,
    description: row.description,
    amount,
    currency: row.currency,
    status: row.status,
    state: row.state,
    issued_at: row.issued_at,
    due_at: row.due_at,
    client_id: row.client_id,
    client_name: row.client_name,
    case_id: row.case_id,
    case_number: row.case_number,
    paid_amount: paid,
    remaining: row.status === 'cancelled' ? 0 : money(amount - paid),
  };
}

/** Lawyers and assistants see invoices of the cases they work on; the administrator sees all. */
function invoiceScope(actor, parameters) {
  const office = officeCondition(actor, parameters, 'i');
  if (actor.role === 'admin') return office;
  parameters.push(actor.user_id);
  return `${office} AND EXISTS (
    SELECT 1 FROM assigned_to assignment
     WHERE assignment.case_id = i.case_id AND assignment.user_id = $${parameters.length}
  )`;
}

function parsePositiveInteger(value, fallback, field) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) invalid(`${field} must be a positive integer.`);
  return Number(value);
}

export async function listInvoices(actor, queryParameters = {}) {
  assertActor(actor, ['admin', 'lawyer', 'assistant']);
  const page = parsePositiveInteger(queryParameters.page, 1, 'page');
  const pageSize = Math.min(parsePositiveInteger(queryParameters.pageSize, DEFAULT_PAGE_SIZE, 'pageSize'), MAX_PAGE_SIZE);
  const parameters = [];
  const conditions = [invoiceScope(actor, parameters)];
  if (queryParameters.case_id !== undefined) {
    parameters.push(validateUuid(queryParameters.case_id, 'case_id'));
    conditions.push(`i.case_id = $${parameters.length}`);
  }
  if (queryParameters.client_id !== undefined) {
    parameters.push(validateUuid(queryParameters.client_id, 'client_id'));
    conditions.push(`i.client_id = $${parameters.length}`);
  }
  let stateFilter = '';
  if (queryParameters.state !== undefined) {
    if (!STATES.includes(queryParameters.state) && queryParameters.state !== 'open') invalid('state is not supported.');
    parameters.push(queryParameters.state);
    stateFilter = queryParameters.state === 'open'
      ? `WHERE invoice.state IN ('unpaid', 'partially_paid', 'overdue') AND $${parameters.length}::text IS NOT NULL`
      : `WHERE invoice.state = $${parameters.length}`;
  }
  const base = `SELECT * FROM (${INVOICE_SELECT} WHERE ${conditions.join(' AND ')}) invoice ${stateFilter}`;
  const total = await query(`SELECT COUNT(*)::int AS total FROM (${base}) counted`, parameters);
  parameters.push(pageSize, (page - 1) * pageSize);
  const rows = await query(
    `${base} ORDER BY invoice.issued_at DESC, invoice.invoice_number DESC LIMIT $${parameters.length - 1} OFFSET $${parameters.length}`,
    parameters
  );
  const count = total.rows[0]?.total ?? 0;
  return {
    invoices: rows.rows.map(publicInvoice),
    pagination: { page, pageSize, total: count, totalPages: Math.ceil(count / pageSize) },
  };
}

/* ───────────────────────── billing ───────────────────────── */

const CREATE_FIELDS = new Set(['client_id', 'case_id', 'category', 'amount', 'currency', 'description', 'due_at']);

export async function createInvoice(actor, body) {
  assertActor(actor, ['admin']);
  validateObject(body, CREATE_FIELDS);
  const clientId = validateUuid(body.client_id, 'client_id');
  const caseId = body.case_id === undefined || body.case_id === null ? null : validateUuid(body.case_id, 'case_id');
  if (!CATEGORIES.includes(body.category)) invalid('category must be legal_fees, court_fees or expenses.');
  const currency = body.currency ?? 'ILS';
  if (!CURRENCIES.includes(currency)) invalid('currency must be ILS, JOD or USD.');
  const amount = validateAmount(body.amount);
  const description = optionalText(body, 'description', 500);
  const dueAt = body.due_at === undefined || body.due_at === null ? null : validateDate(body.due_at, 'due_at');

  // Numbers run per office and year: 2026-0001, 2026-0002… A clash with a number taken at the
  // same moment by another request is retried with the next one.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // $1 client, $2 case, $3 office, then $4… the invoice values.
    const parameters = [clientId, caseId];
    const office = officeCondition(actor, parameters, 'c');
    parameters.push(amount, currency, body.category, description, dueAt, actor.user_id);
    try {
      const result = await query(
        `
          INSERT INTO invoices (invoice_number, amount, currency, category, description, due_at, client_id, case_id, user_id, office_id, status)
          SELECT
            to_char(NOW(), 'YYYY') || '-' || lpad((
              SELECT COUNT(*) + 1
                FROM invoices existing
               WHERE existing.office_id = c.office_id
                 AND existing.invoice_number LIKE to_char(NOW(), 'YYYY') || '-%'
            )::text, 4, '0'),
            $4::numeric, $5::text, $6::text, $7::text, $8::timestamptz,
            c.client_id, lc.case_id, $9::uuid, c.office_id, 'unpaid'
          FROM clients c
          LEFT JOIN legal_cases lc ON lc.case_id = $2::uuid AND lc.office_id = c.office_id
          WHERE c.client_id = $1::uuid
            AND ${office}
            -- A case-related charge goes to a client who is a party to that case.
            AND (
              $2::uuid IS NULL
              OR EXISTS (SELECT 1 FROM involves party WHERE party.case_id = lc.case_id AND party.client_id = c.client_id)
            )
          RETURNING invoice_id
        `,
        parameters
      );
      if (!result.rowCount) throw new FinanceServiceError(404, 'Client not found, or the client is not a party to this case.');
      const invoice = await getInvoice(actor, result.rows[0].invoice_id);
      auditLater(actor, {
        action: 'invoice_created',
        entityType: 'invoice',
        entityId: invoice.invoice_id,
        details: {
          subject: invoice.invoice_number,
          case_id: invoice.case_id,
          values: { invoice_number: invoice.invoice_number, category: invoice.category, amount: invoice.amount, currency: invoice.currency, client_name: invoice.client_name },
        },
      });
      return invoice;
    } catch (error) {
      if (error?.code === '23505' && error.constraint === 'invoices_office_number_key' && attempt < 2) continue;
      if (error?.code === '23503') throw new FinanceServiceError(404, 'Client or case not found.');
      throw error;
    }
  }
  throw new FinanceServiceError(409, 'Could not allocate an invoice number. Try again.');
}

async function getInvoice(actor, invoiceId) {
  const parameters = [invoiceId];
  const scope = invoiceScope(actor, parameters);
  const result = await query(`${INVOICE_SELECT} WHERE i.invoice_id = $1 AND ${scope}`, parameters);
  if (!result.rowCount) throw new FinanceServiceError(404, 'Invoice not found.');
  return publicInvoice(result.rows[0]);
}

export async function cancelInvoice(actor, invoiceId) {
  assertActor(actor, ['admin']);
  validateUuid(invoiceId, 'invoiceId');
  const parameters = [invoiceId];
  const office = officeCondition(actor, parameters, 'i');
  // Only an invoice with nothing paid on it can be cancelled; a paid one needs a refund instead.
  const result = await query(
    `UPDATE invoices i SET status = 'cancelled'
      WHERE i.invoice_id = $1 AND ${office}
        AND i.status = 'unpaid'
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.invoice_id AND p.status = 'completed')
      RETURNING i.invoice_id, i.invoice_number`,
    parameters
  );
  if (!result.rowCount) {
    const existing = await query(
      'SELECT i.status FROM invoices i WHERE i.invoice_id = $1 AND i.office_id = $2',
      [invoiceId, actor.office_id]
    );
    if (!existing.rowCount) throw new FinanceServiceError(404, 'Invoice not found.');
    throw new FinanceServiceError(409, 'Only an unpaid invoice with no payments can be cancelled.');
  }
  auditLater(actor, {
    action: 'invoice_cancelled',
    entityType: 'invoice',
    entityId: invoiceId,
    details: { subject: result.rows[0].invoice_number },
  });
  return getInvoice(actor, invoiceId);
}

/* ───────────────────────── payments ───────────────────────── */

const PAYMENT_FIELDS = new Set(['amount', 'method', 'paid_at', 'reference']);

/**
 * Records a payment and moves the invoice to partially paid or paid, in one statement: the
 * invoice row is locked, the payment is accepted only if it does not exceed what remains, and the
 * new status is written with it.
 */
export async function recordPayment(actor, invoiceId, body) {
  assertActor(actor, ['admin']);
  validateUuid(invoiceId, 'invoiceId');
  validateObject(body, PAYMENT_FIELDS);
  const amount = validateAmount(body.amount);
  if (!PAYMENT_METHODS.includes(body.method)) invalid('method must be cash, bank_transfer, cheque or card.');
  const paidAt = body.paid_at === undefined || body.paid_at === null ? new Date().toISOString() : validateDate(body.paid_at, 'paid_at');
  if (Date.parse(paidAt) > Date.now() + 60_000) invalid('paid_at cannot be in the future.');
  const reference = optionalText(body, 'reference', 100);

  const parameters = [invoiceId];
  const office = officeCondition(actor, parameters, 'i');
  parameters.push(amount, body.method, paidAt, reference, actor.user_id);
  let result;
  try {
    result = await query(
      `
        WITH invoice AS (
          SELECT i.invoice_id, i.amount, i.status, i.office_id
            FROM invoices i
           WHERE i.invoice_id = $1 AND ${office}
             FOR UPDATE
        ),
        paid AS (
          SELECT COALESCE(SUM(p.amount), 0) AS total
            FROM payments p
           WHERE p.invoice_id = $1 AND p.status = 'completed'
        ),
        inserted AS (
          INSERT INTO payments (amount, payment_method, paid_at, reference_number, status, invoice_id, user_id, office_id)
          SELECT $3::numeric, $4::text, $5::timestamptz, $6::text, 'completed', invoice.invoice_id, $7::uuid, invoice.office_id
            FROM invoice, paid
           WHERE invoice.status IN ('unpaid', 'partially_paid')
             AND paid.total + $3::numeric <= invoice.amount
          RETURNING payment_id, amount, invoice_id
        ),
        updated AS (
          UPDATE invoices i
             SET status = CASE WHEN paid.total + inserted.amount >= invoice.amount THEN 'paid' ELSE 'partially_paid' END
            FROM invoice, paid, inserted
           WHERE i.invoice_id = inserted.invoice_id
          RETURNING i.status
        )
        SELECT inserted.payment_id, updated.status,
               (SELECT status FROM invoice) AS previous_status,
               (SELECT amount FROM invoice) AS invoice_amount,
               (SELECT total FROM paid) AS paid_before
          FROM (SELECT 1) one
          LEFT JOIN inserted ON TRUE
          LEFT JOIN updated ON TRUE
      `,
      parameters
    );
  } catch (error) {
    if (error?.code === '23505' && error.constraint === 'payments_office_reference_key') {
      throw new FinanceServiceError(409, 'This payment reference has already been recorded.');
    }
    throw error;
  }
  const row = result.rows[0];
  if (!row || row.invoice_amount === null || row.invoice_amount === undefined) throw new FinanceServiceError(404, 'Invoice not found.');
  if (!row.payment_id) {
    if (!['unpaid', 'partially_paid'].includes(row.previous_status)) {
      throw new FinanceServiceError(409, 'This invoice is already paid or cancelled.');
    }
    throw new FinanceServiceError(409, `The payment exceeds the remaining amount of ${money(row.invoice_amount - row.paid_before)}.`);
  }
  const invoice = await getInvoice(actor, invoiceId);
  auditLater(actor, {
    action: 'payment_recorded',
    entityType: 'invoice',
    entityId: invoiceId,
    details: {
      subject: invoice.invoice_number,
      case_id: invoice.case_id,
      values: { amount, currency: invoice.currency, method: body.method, reference },
      changes: { status: { from: row.previous_status, to: row.status } },
    },
  });
  return { payment_id: row.payment_id, invoice };
}

/* ───────────────────────── summaries and statements ───────────────────────── */

/** Office totals per currency: billed, paid, outstanding and overdue. Administrators only. */
export async function financeSummary(actor) {
  assertActor(actor, ['admin']);
  const parameters = [];
  const office = officeCondition(actor, parameters, 'i');
  const result = await query(
    `SELECT invoice.currency,
            SUM(invoice.amount) AS billed,
            SUM(invoice.paid_amount) AS paid,
            SUM(invoice.amount - invoice.paid_amount) AS outstanding,
            SUM(CASE WHEN invoice.state = 'overdue' THEN invoice.amount - invoice.paid_amount ELSE 0 END) AS overdue,
            COUNT(*) FILTER (WHERE invoice.state = 'overdue')::int AS overdue_count,
            COUNT(*) FILTER (WHERE invoice.state IN ('unpaid', 'partially_paid', 'overdue'))::int AS open_count
       FROM (${INVOICE_SELECT} WHERE ${office} AND i.status <> 'cancelled') invoice
      GROUP BY invoice.currency
      ORDER BY invoice.currency`,
    parameters
  );
  return {
    currencies: result.rows.map((row) => ({
      currency: row.currency,
      billed: money(row.billed),
      paid: money(row.paid),
      outstanding: money(row.outstanding),
      overdue: money(row.overdue),
      overdue_count: row.overdue_count,
      open_count: row.open_count,
    })),
  };
}

async function buildStatement(actor, clientId) {
  const clientResult = await query(
    `SELECT c.client_id, c.full_name_or_org, c.phone, c.email, c.national_id,
            office.name AS office_name, office.city AS office_city, office.phone AS office_phone, office.email AS office_email
       FROM clients c
       JOIN law_offices office ON office.office_id = c.office_id
      WHERE c.client_id = $1 AND c.office_id = $2`,
    [clientId, actor.office_id]
  );
  if (!clientResult.rowCount) throw new FinanceServiceError(404, 'Client not found.');
  const client = clientResult.rows[0];

  const invoices = await query(
    `${INVOICE_SELECT} WHERE i.client_id = $1 AND i.office_id = $2 AND i.status <> 'cancelled' ORDER BY i.issued_at, i.invoice_number`,
    [clientId, actor.office_id]
  );
  const payments = await query(
    `SELECT p.payment_id, p.amount, p.payment_method AS method, p.paid_at, p.reference_number AS reference,
            i.invoice_number, i.currency
       FROM payments p
       JOIN invoices i ON i.invoice_id = p.invoice_id
      WHERE i.client_id = $1 AND p.office_id = $2 AND p.status = 'completed'
      ORDER BY p.paid_at, p.payment_id`,
    [clientId, actor.office_id]
  );

  const rows = invoices.rows.map(publicInvoice);
  const byCurrency = new Map();
  for (const invoice of rows) {
    const totals = byCurrency.get(invoice.currency) ?? { currency: invoice.currency, legal_fees: 0, court_fees: 0, expenses: 0, billed: 0, paid: 0, balance: 0 };
    totals[invoice.category] = money(totals[invoice.category] + invoice.amount);
    totals.billed = money(totals.billed + invoice.amount);
    totals.paid = money(totals.paid + invoice.paid_amount);
    totals.balance = money(totals.billed - totals.paid);
    byCurrency.set(invoice.currency, totals);
  }
  return {
    client: { client_id: client.client_id, full_name_or_org: client.full_name_or_org, phone: client.phone, email: client.email, national_id: client.national_id },
    office: { name: client.office_name, city: client.office_city, phone: client.office_phone, email: client.office_email },
    generated_at: new Date().toISOString(),
    currencies: [...byCurrency.values()],
    invoices: rows,
    payments: payments.rows.map((payment) => ({ ...payment, amount: money(payment.amount) })),
  };
}

/** A client's statement of account, for the office administrator. */
export async function clientStatement(actor, clientId) {
  assertActor(actor, ['admin']);
  validateUuid(clientId, 'clientId');
  officeCondition(actor, [], 'c');
  return buildStatement(actor, clientId);
}

/** The signed-in client's own statement, in the portal. */
export async function ownStatement(actor) {
  assertActor(actor, ['client']);
  const parameters = [actor.user_id];
  const office = officeCondition(actor, parameters, 'c');
  const own = await query(`SELECT c.client_id FROM clients c WHERE c.user_id = $1 AND ${office} LIMIT 1`, parameters);
  if (!own.rowCount) throw new FinanceServiceError(404, 'Client profile not found.');
  return buildStatement(actor, own.rows[0].client_id);
}
