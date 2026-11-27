import { auditLater } from './auditService.js';
import {
  amount,
  assertActor,
  assertBody,
  CURRENCIES,
  date,
  dayRange,
  execute,
  invalid,
  money,
  notFound,
  text,
  uuid,
} from './financeInput.js';
import { officeCondition } from './officeScope.js';

/**
 * The office's accounts (cash box, bank, wallet), transfers between them, their ledgers, and the
 * office's profitability. Office administrators only.
 *
 * Balances are never stored: an account's balance is its opening balance, plus client payments
 * received into it, minus expenses paid from it, minus custodies issued from it, plus what came
 * back from settled custodies, minus and plus transfers. Profit is what clients paid minus what
 * the office spent, per currency; amounts in different currencies are never added together.
 */

const ADMIN = ['admin'];
const ACCOUNT_TYPES = ['cash', 'bank', 'wallet'];

/** Every movement of money for `${alias}.account_id`, as (on_date, amount signed) rows. */
const MOVEMENTS = `
  SELECT 'payment' AS kind, p.payment_id AS id, p.paid_at::date AS on_date, p.paid_at AS sort_at,
         p.amount AS amount, i.invoice_number AS reference, c.full_name_or_org AS party, NULL AS category
    FROM payments p
    JOIN invoices i ON i.invoice_id = p.invoice_id AND i.office_id = p.office_id
    JOIN clients c ON c.client_id = i.client_id AND c.office_id = i.office_id
   WHERE p.account_id = :account AND p.status = 'completed'
  UNION ALL
  SELECT 'expense', e.expense_id, e.spent_on, e.created_at, -e.amount, NULL, e.payee, e.category
    FROM office_expenses e WHERE e.account_id = :account AND e.status = 'active'
  UNION ALL
  SELECT 'custody_issued', cu.custody_id, cu.issued_on, cu.created_at, -cu.amount, NULL, holder.full_name, NULL
    FROM custodies cu JOIN app_users holder ON holder.user_id = cu.holder_user_id
   WHERE cu.account_id = :account
  UNION ALL
  SELECT 'custody_returned', cu.custody_id, cu.settled_on, cu.created_at, cu.returned_amount, NULL, holder.full_name, NULL
    FROM custodies cu JOIN app_users holder ON holder.user_id = cu.holder_user_id
   WHERE cu.return_account_id = :account AND cu.returned_amount > 0
  UNION ALL
  SELECT 'transfer_out', t.transfer_id, t.transferred_on, t.created_at, -t.amount, t.note, other.name, NULL
    FROM account_transfers t JOIN finance_accounts other ON other.account_id = t.to_account_id
   WHERE t.from_account_id = :account
  UNION ALL
  SELECT 'transfer_in', t.transfer_id, t.transferred_on, t.created_at, t.amount, t.note, other.name, NULL
    FROM account_transfers t JOIN finance_accounts other ON other.account_id = t.from_account_id
   WHERE t.to_account_id = :account`;

const movementsOf = (accountColumn) => MOVEMENTS.replaceAll(':account', accountColumn);

const publicAccount = (row) => ({
  account_id: row.account_id,
  name: row.name,
  account_type: row.account_type,
  currency: row.currency,
  opening_balance: money(row.opening_balance),
  opened_on: row.opened_on,
  is_active: row.is_active,
  balance: money(row.balance),
  created_at: row.created_at,
});

const ACCOUNT_COLUMNS = `
  a.account_id, a.name, a.account_type, a.currency, a.opening_balance,
  to_char(a.opened_on, 'YYYY-MM-DD') AS opened_on, a.is_active, a.created_at,
  a.opening_balance + COALESCE((SELECT SUM(m.amount) FROM (${movementsOf('a.account_id')}) m), 0) AS balance`;

export async function listAccounts(actor) {
  assertActor(actor, ADMIN);
  const parameters = [];
  const office = officeCondition(actor, parameters, 'a');
  const result = await execute(
    `SELECT ${ACCOUNT_COLUMNS} FROM finance_accounts a WHERE ${office}
      ORDER BY a.is_active DESC, a.currency, a.name`,
    parameters
  );
  return { accounts: result.rows.map(publicAccount) };
}

async function findAccount(actor, accountId) {
  uuid(accountId, 'accountId');
  const parameters = [accountId];
  const office = officeCondition(actor, parameters, 'a');
  const result = await execute(`SELECT ${ACCOUNT_COLUMNS} FROM finance_accounts a WHERE a.account_id = $1 AND ${office}`, parameters);
  if (!result.rowCount) notFound('Account');
  return publicAccount(result.rows[0]);
}

export async function createAccount(actor, body) {
  assertActor(actor, ADMIN);
  assertBody(body, ['name', 'account_type', 'currency', 'opening_balance', 'opened_on']);
  const name = text(body.name, 'name', 100, { required: true });
  if (!ACCOUNT_TYPES.includes(body.account_type)) invalid('account_type must be cash, bank or wallet.');
  if (!CURRENCIES.includes(body.currency)) invalid('currency must be ILS, JOD or USD.');
  const opening = body.opening_balance === undefined ? 0 : amount(body.opening_balance, 'opening_balance', { signed: true });
  const openedOn = date(body.opened_on, 'opened_on', { required: false });
  const parameters = [name, body.account_type, body.currency, opening, openedOn];
  officeCondition(actor, parameters, 'office');
  const result = await execute(
    `INSERT INTO finance_accounts (name, account_type, currency, opening_balance, opened_on, office_id)
     VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6)
     RETURNING account_id`,
    parameters
  );
  const account = await findAccount(actor, result.rows[0].account_id);
  auditLater(actor, { action: 'account_created', entityType: 'account', entityId: account.account_id, details: { subject: account.name, values: { currency: account.currency, opening_balance: account.opening_balance } } });
  return account;
}

/** Renames an account, or closes and reopens it. Its currency and opening balance never change. */
export async function updateAccount(actor, accountId, body) {
  assertActor(actor, ADMIN);
  uuid(accountId, 'accountId');
  assertBody(body, ['name', 'is_active']);
  const fields = {};
  if (Object.hasOwn(body, 'name')) fields.name = text(body.name, 'name', 100, { required: true });
  if (Object.hasOwn(body, 'is_active')) {
    if (typeof body.is_active !== 'boolean') invalid('is_active must be true or false.');
    fields.is_active = body.is_active;
  }
  const entries = Object.entries(fields);
  if (!entries.length) invalid('At least one field is required.');
  const parameters = entries.map(([, value]) => value);
  parameters.push(accountId);
  const idParameter = `$${parameters.length}`;
  const office = officeCondition(actor, parameters, 'a');
  const result = await execute(
    `UPDATE finance_accounts a SET ${entries.map(([field], index) => `${field} = $${index + 1}`).join(', ')}
      WHERE a.account_id = ${idParameter} AND ${office} RETURNING a.account_id`,
    parameters
  );
  if (!result.rowCount) notFound('Account');
  return findAccount(actor, accountId);
}

/** An account's movements in a range, each with the balance after it, and the balance before the range. */
export async function accountLedger(actor, accountId, queryParameters = {}) {
  assertActor(actor, ADMIN);
  const account = await findAccount(actor, accountId);
  if (Object.keys(queryParameters).some((key) => !['from', 'to'].includes(key))) invalid('Unsupported ledger query parameter.');
  const { from, to } = dayRange(queryParameters);
  const result = await execute(
    `SELECT m.kind, m.id, to_char(m.on_date, 'YYYY-MM-DD') AS on_date, m.amount, m.reference, m.party, m.category
       FROM (${movementsOf('$1::uuid')}) m
      ORDER BY m.on_date, m.sort_at, m.id`,
    [accountId]
  );
  let balance = account.opening_balance;
  let openingOfRange = null;
  const entries = [];
  for (const row of result.rows) {
    if (row.on_date > to) break;
    if (row.on_date >= from && openingOfRange === null) openingOfRange = balance;
    balance = money(balance + Number(row.amount));
    if (row.on_date >= from) entries.push({ ...row, amount: money(row.amount), balance_after: balance });
  }
  return {
    account,
    from,
    to,
    balance_before: openingOfRange ?? balance,
    balance_after: balance,
    entries,
  };
}

export async function createTransfer(actor, body) {
  assertActor(actor, ADMIN);
  assertBody(body, ['from_account_id', 'to_account_id', 'amount', 'transferred_on', 'note']);
  const fromId = uuid(body.from_account_id, 'from_account_id');
  const toId = uuid(body.to_account_id, 'to_account_id');
  if (fromId === toId) invalid('A transfer needs two different accounts.');
  const value = amount(body.amount);
  const on = date(body.transferred_on, 'transferred_on');
  const note = text(body.note, 'note', 500);
  const parameters = [fromId, toId, value, on, note, actor.user_id];
  const office = officeCondition(actor, parameters, 'source');
  // Both accounts open, in this office and in the same currency.
  const result = await execute(
    `INSERT INTO account_transfers (from_account_id, to_account_id, amount, transferred_on, note, created_by_user_id, office_id)
     SELECT source.account_id, target.account_id, $3, $4::date, $5, $6, source.office_id
       FROM finance_accounts source
       JOIN finance_accounts target ON target.account_id = $2 AND target.office_id = source.office_id
            AND target.is_active AND target.currency = source.currency
      WHERE source.account_id = $1 AND source.is_active AND ${office}
     RETURNING transfer_id`,
    parameters
  );
  if (!result.rowCount) invalid('Both accounts must be open accounts of the office in the same currency.');
  auditLater(actor, { action: 'account_transfer', entityType: 'account', entityId: fromId, details: { values: { amount: value, transferred_on: on, to_account_id: toId } } });
  return { transfer_id: result.rows[0].transfer_id };
}

/* ───────────── profitability ───────────── */

/**
 * The office's results over a range, per currency: what clients paid, what the office spent,
 * month by month, spending by category, and the cases that brought in or cost the most.
 */
export async function officeProfitability(actor, queryParameters = {}) {
  assertActor(actor, ADMIN);
  if (Object.keys(queryParameters).some((key) => !['from', 'to'].includes(key))) invalid('Unsupported query parameter.');
  const { from, to } = dayRange(queryParameters);
  const parameters = [from, to];
  // Pushes the active office as $3 (and refuses a request without one); every query filters on it.
  officeCondition(actor, parameters, 'office');
  const office = (alias) => `${alias}.office_id = $3`;
  const [collected, spent, cases] = await Promise.all([
    execute(
      `SELECT to_char(date_trunc('month', p.paid_at), 'YYYY-MM') AS month, i.currency, SUM(p.amount) AS total
         FROM payments p JOIN invoices i ON i.invoice_id = p.invoice_id AND i.office_id = p.office_id
        WHERE ${office('p')} AND p.status = 'completed'
          AND p.paid_at >= $1::date AND p.paid_at < $2::date + 1
        GROUP BY 1, 2`,
      parameters
    ),
    execute(
      `SELECT to_char(e.spent_on, 'YYYY-MM') AS month, e.currency, e.category, SUM(e.amount) AS total
         FROM office_expenses e
        WHERE ${office('e')} AND e.status = 'active' AND e.spent_on BETWEEN $1::date AND $2::date
        GROUP BY 1, 2, 3`,
      parameters
    ),
    execute(
      `WITH paid AS (
         SELECT i.case_id, i.currency, SUM(p.amount) AS collected
           FROM payments p JOIN invoices i ON i.invoice_id = p.invoice_id AND i.office_id = p.office_id
          WHERE ${office('p')} AND p.status = 'completed' AND i.case_id IS NOT NULL
            AND p.paid_at >= $1::date AND p.paid_at < $2::date + 1
          GROUP BY 1, 2
       ), cost AS (
         SELECT e.case_id, e.currency, SUM(e.amount) AS spent
           FROM office_expenses e
          WHERE ${office('e')} AND e.status = 'active' AND e.case_id IS NOT NULL
            AND e.spent_on BETWEEN $1::date AND $2::date
          GROUP BY 1, 2
       )
       SELECT lc.case_id, lc.case_number, lc.title, COALESCE(paid.currency, cost.currency) AS currency,
              COALESCE(paid.collected, 0) AS collected, COALESCE(cost.spent, 0) AS spent
         FROM paid FULL JOIN cost ON cost.case_id = paid.case_id AND cost.currency = paid.currency
         JOIN legal_cases lc ON lc.case_id = COALESCE(paid.case_id, cost.case_id) AND ${office('lc')}
        ORDER BY COALESCE(paid.collected, 0) - COALESCE(cost.spent, 0) DESC
        LIMIT 20`,
      parameters
    ),
  ]);

  const totals = {};
  const months = {};
  const categories = {};
  const totalFor = (currency) => (totals[currency] ??= { currency, collected: 0, spent: 0, net: 0 });
  const monthFor = (month, currency) => (months[`${month}|${currency}`] ??= { month, currency, collected: 0, spent: 0, net: 0 });
  for (const row of collected.rows) {
    const value = money(row.total);
    totalFor(row.currency).collected = money(totalFor(row.currency).collected + value);
    monthFor(row.month, row.currency).collected = money(monthFor(row.month, row.currency).collected + value);
  }
  for (const row of spent.rows) {
    const value = money(row.total);
    totalFor(row.currency).spent = money(totalFor(row.currency).spent + value);
    monthFor(row.month, row.currency).spent = money(monthFor(row.month, row.currency).spent + value);
    const key = `${row.category}|${row.currency}`;
    categories[key] = { category: row.category, currency: row.currency, spent: money((categories[key]?.spent ?? 0) + value) };
  }
  for (const entry of [...Object.values(totals), ...Object.values(months)]) entry.net = money(entry.collected - entry.spent);
  return {
    from,
    to,
    totals: Object.values(totals).sort((a, b) => a.currency.localeCompare(b.currency)),
    months: Object.values(months).sort((a, b) => a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency)),
    by_category: Object.values(categories).sort((a, b) => b.spent - a.spent),
    cases: cases.rows.map((row) => ({
      case_id: row.case_id, case_number: row.case_number, title: row.title, currency: row.currency,
      collected: money(row.collected), spent: money(row.spent), net: money(Number(row.collected) - Number(row.spent)),
    })),
  };
}

/** A case's results since it opened, per currency: billed, paid, spent on it, and the difference. */
export async function caseProfitability(actor, caseId) {
  assertActor(actor, ADMIN);
  uuid(caseId, 'caseId');
  const parameters = [caseId];
  const office = officeCondition(actor, parameters, 'lc');
  const result = await execute(
    `WITH target AS (
       SELECT lc.case_id, lc.office_id FROM legal_cases lc WHERE lc.case_id = $1 AND ${office}
     ), billed AS (
       SELECT i.currency, SUM(i.amount) AS billed
         FROM invoices i JOIN target ON i.case_id = target.case_id AND i.office_id = target.office_id
        WHERE i.status <> 'cancelled'
        GROUP BY 1
     ), paid AS (
       SELECT i.currency, SUM(p.amount) AS collected
         FROM payments p
         JOIN invoices i ON i.invoice_id = p.invoice_id AND i.office_id = p.office_id
         JOIN target ON i.case_id = target.case_id AND i.office_id = target.office_id
        WHERE p.status = 'completed'
        GROUP BY 1
     ), cost AS (
       SELECT e.currency, SUM(e.amount) AS spent
         FROM office_expenses e JOIN target ON e.case_id = target.case_id AND e.office_id = target.office_id
        WHERE e.status = 'active'
        GROUP BY 1
     )
     SELECT currencies.currency, (SELECT COUNT(*) FROM target)::int AS found,
            COALESCE(billed.billed, 0) AS billed, COALESCE(paid.collected, 0) AS collected, COALESCE(cost.spent, 0) AS spent
       FROM (SELECT currency FROM billed UNION SELECT currency FROM paid UNION SELECT currency FROM cost) currencies
       LEFT JOIN billed ON billed.currency = currencies.currency
       LEFT JOIN paid ON paid.currency = currencies.currency
       LEFT JOIN cost ON cost.currency = currencies.currency
      ORDER BY currencies.currency`,
    parameters
  );
  if (!result.rowCount) {
    const reachable = await execute(`SELECT 1 FROM legal_cases lc WHERE lc.case_id = $1 AND ${office}`, parameters);
    if (!reachable.rowCount) notFound('Case');
  }
  return {
    case_id: caseId,
    totals: result.rows.map((row) => ({
      currency: row.currency, billed: money(row.billed), collected: money(row.collected), spent: money(row.spent),
      net: money(Number(row.collected) - Number(row.spent)),
    })),
  };
}
