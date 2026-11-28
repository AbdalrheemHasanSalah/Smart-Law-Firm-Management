import { can } from '../config/permissions.js';
import { officeProfitability } from './accountService.js';
import { assertActor, dayRange, execute, forbidden, invalid, money, uuid } from './financeInput.js';
import { officeCondition } from './officeScope.js';

/**
 * Office reports over a period, aggregated in the database.
 *
 *   cases       current status and type of the cases in view; cases opened and closed in the period;
 *               open and closed cases per lawyer (whole-office view only)
 *   hearings    hearings in the period by status; hearings whose date passed with no outcome
 *   tasks       tasks due in the period by status; tasks overdue today
 *   finance     billed and collected in the period, outstanding balances by age today, the
 *               largest debtors, expenses by category and profit by month (whole-office view only)
 *
 * The administrator sees the whole office, or one member's view (userId). A lawyer or assistant
 * always sees their own: the cases assigned to them and the tasks given to them, and no money.
 */

const STAFF = ['admin', 'lawyer', 'assistant'];
const LIST_LIMIT = 50;

/**
 * Turns named values (:from, :to, :now, :office, :member) into $1…$n, numbering only the ones the
 * statement uses: PostgreSQL refuses values a statement never uses.
 */
export function compile(sql, values) {
  const order = [];
  const text = sql.replace(/:(from|to|now|office|member)\b/g, (_, name) => {
    if (!order.includes(name)) order.push(name);
    return `$${order.indexOf(name) + 1}`;
  });
  return { text, parameters: order.map((name) => values[name]) };
}

export async function officeReport(actor, queryParameters = {}) {
  assertActor(actor, STAFF);
  if (Object.keys(queryParameters).some((key) => !['from', 'to', 'userId'].includes(key))) invalid('Unsupported report query parameter.');
  const { from, to } = dayRange(queryParameters);
  const focus = queryParameters.userId === undefined ? null : uuid(queryParameters.userId, 'userId');
  if (focus && actor.role !== 'admin') forbidden();
  const whole = actor.role === 'admin' && !focus;
  const now = new Date().toISOString();

  // Refuses a request without an active office; every statement below filters on it.
  const officeParameters = [];
  officeCondition(actor, officeParameters, 'office');
  const member = focus ?? actor.user_id;
  const values = { from, to, now, office: officeParameters[0], member };
  const office = (alias) => `${alias}.office_id = :office`;
  const myCase = (column) => (whole ? 'TRUE' : `EXISTS (SELECT 1 FROM assigned_to mine WHERE mine.case_id = ${column} AND mine.user_id = :member)`);
  const myTask = whole ? 'TRUE' : 't.assigned_to_user_id = :member';
  // A private task is seen by its writer alone: in their own view, never in someone else's.
  const visibleTask = member === actor.user_id ? '(NOT t.is_private OR t.created_by_user_id = :member)' : 'NOT t.is_private';

  const queries = {
    caseStatus: `
      SELECT lc.status AS key, COUNT(*)::int AS count FROM legal_cases lc
       WHERE ${office('lc')} AND ${myCase('lc.case_id')} GROUP BY 1`,
    caseType: `
      SELECT lc.case_type AS key, COUNT(*)::int AS count FROM legal_cases lc
       WHERE ${office('lc')} AND ${myCase('lc.case_id')} GROUP BY 1 ORDER BY 2 DESC`,
    caseFlow: `
      SELECT COUNT(*) FILTER (WHERE lc.opened_at >= :from::date AND lc.opened_at < :to::date + 1)::int AS opened,
             COUNT(*) FILTER (WHERE lc.closed_at >= :from::date AND lc.closed_at < :to::date + 1)::int AS closed
        FROM legal_cases lc WHERE ${office('lc')} AND ${myCase('lc.case_id')}`,
    hearingStatus: `
      SELECT h.status AS key, COUNT(*)::int AS count FROM hearings h
       WHERE ${office('h')} AND ${myCase('h.case_id')}
         AND h.hearing_at >= :from::date AND h.hearing_at < :to::date + 1
       GROUP BY 1`,
    missedHearings: `
      SELECT h.hearing_id, h.hearing_at, h.hearing_type, lc.case_id, lc.case_number, lc.title
        FROM hearings h JOIN legal_cases lc ON lc.case_id = h.case_id AND lc.office_id = h.office_id
       WHERE ${office('h')} AND ${myCase('h.case_id')} AND h.status = 'scheduled' AND h.hearing_at < :now::timestamptz
       ORDER BY h.hearing_at DESC LIMIT ${LIST_LIMIT}`,
    taskStatus: `
      SELECT t.status AS key, COUNT(*)::int AS count FROM tasks t
       WHERE ${office('t')} AND ${myTask} AND ${visibleTask}
         AND t.due_at >= :from::date AND t.due_at < :to::date + 1
       GROUP BY 1`,
    overdueTasks: `
      SELECT t.task_id, t.title, t.due_at, t.priority, u.full_name AS assignee_name, lc.case_id, lc.case_number
        FROM tasks t
        JOIN app_users u ON u.user_id = t.assigned_to_user_id
        LEFT JOIN legal_cases lc ON lc.case_id = t.case_id AND lc.office_id = t.office_id
       WHERE ${office('t')} AND ${myTask} AND ${visibleTask}
         AND t.status IN ('pending', 'in_progress') AND t.due_at < :now::timestamptz
       ORDER BY t.due_at LIMIT ${LIST_LIMIT}`,
  };
  if (whole) {
    queries.perLawyer = `
      SELECT u.user_id, u.full_name,
             COUNT(*) FILTER (WHERE lc.status NOT IN ('closed', 'cancelled'))::int AS open,
             COUNT(*) FILTER (WHERE lc.status IN ('closed', 'cancelled'))::int AS closed
        FROM assigned_to a
        JOIN legal_cases lc ON lc.case_id = a.case_id AND lc.office_id = a.office_id
        JOIN app_users u ON u.user_id = a.user_id
       WHERE ${office('a')}
       GROUP BY u.user_id, u.full_name ORDER BY 3 DESC, 2`;
    queries.billed = `
      SELECT i.currency, SUM(i.amount) AS billed FROM invoices i
       WHERE ${office('i')} AND i.status <> 'cancelled' AND i.issued_at >= :from::date AND i.issued_at < :to::date + 1
       GROUP BY 1`;
    queries.collected = `
      SELECT i.currency, SUM(p.amount) AS collected FROM payments p
        JOIN invoices i ON i.invoice_id = p.invoice_id AND i.office_id = p.office_id
       WHERE ${office('p')} AND p.status = 'completed' AND p.paid_at >= :from::date AND p.paid_at < :to::date + 1
       GROUP BY 1`;
    // What each open invoice still lacks today, aged from its due date (or its issue date).
    queries.outstanding = `
      SELECT i.invoice_id, i.invoice_number, i.currency, c.client_id, c.full_name_or_org AS client_name,
             i.amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.invoice_id AND p.status = 'completed'), 0) AS remaining,
             GREATEST(0, (:now::timestamptz::date - COALESCE(i.due_at, i.issued_at)::date))::int AS days_late
        FROM invoices i JOIN clients c ON c.client_id = i.client_id AND c.office_id = i.office_id
       WHERE ${office('i')} AND i.status IN ('unpaid', 'partially_paid', 'overdue')`;
  }

  const entries = Object.entries(queries);
  const results = await Promise.all(entries.map(([, sql]) => {
    const { text, parameters } = compile(sql, values);
    return execute(text, parameters);
  }));
  const rows = Object.fromEntries(entries.map(([name], index) => [name, results[index].rows]));
  const counts = (list) => Object.fromEntries(list.map((row) => [row.key, row.count]));

  const report = {
    from,
    to,
    scope: whole ? 'office' : 'member',
    user_id: whole ? null : member,
    cases: {
      by_status: counts(rows.caseStatus),
      by_type: rows.caseType.map((row) => ({ case_type: row.key, count: row.count })),
      opened: rows.caseFlow[0]?.opened ?? 0,
      closed: rows.caseFlow[0]?.closed ?? 0,
      per_lawyer: rows.perLawyer ?? null,
    },
    hearings: {
      by_status: counts(rows.hearingStatus),
      missed: rows.missedHearings,
    },
    tasks: {
      by_status: counts(rows.taskStatus),
      overdue: rows.overdueTasks,
    },
    finance: null,
  };

  if (whole && can(actor, 'finance.manage')) {
    const money_ = {};
    const totalFor = (currency) => (money_[currency] ??= { currency, billed: 0, collected: 0 });
    for (const row of rows.billed) totalFor(row.currency).billed = money(row.billed);
    for (const row of rows.collected) totalFor(row.currency).collected = money(row.collected);

    const aging = {};
    const debtors = {};
    const buckets = (days) => (days === 0 ? 'current' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90_plus');
    for (const row of rows.outstanding) {
      const remaining = money(row.remaining);
      if (remaining <= 0) continue;
      const age = (aging[row.currency] ??= { currency: row.currency, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 });
      age[buckets(row.days_late)] = money(age[buckets(row.days_late)] + remaining);
      age.total = money(age.total + remaining);
      const key = `${row.client_id}|${row.currency}`;
      const debtor = (debtors[key] ??= { client_id: row.client_id, client_name: row.client_name, currency: row.currency, outstanding: 0, invoices: 0, oldest_days_late: 0 });
      debtor.outstanding = money(debtor.outstanding + remaining);
      debtor.invoices += 1;
      debtor.oldest_days_late = Math.max(debtor.oldest_days_late, row.days_late);
    }

    const profit = await officeProfitability(actor, { from, to });
    report.finance = {
      billed_vs_collected: Object.values(money_).sort((a, b) => a.currency.localeCompare(b.currency)),
      aging: Object.values(aging).sort((a, b) => a.currency.localeCompare(b.currency)),
      debtors: Object.values(debtors).sort((a, b) => b.outstanding - a.outstanding).slice(0, 20),
      expenses_by_category: profit.by_category,
      profit_by_month: profit.months,
      profit_totals: profit.totals,
    };
  }
  return report;
}
