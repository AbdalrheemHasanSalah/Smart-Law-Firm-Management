import { query as databaseQuery } from '../config/db.js';
import { pushToUser } from './pushService.js';
import { getSecurityConfig } from '../config/security.js';
import { sendMail as deliverMail } from './mailService.js';
import { notificationEmail } from './notificationService.js';

/**
 * Scheduled reminders, run every few minutes by the server:
 *
 *   hearing       the case team, the day before and on the morning of the session
 *   task          the person it is assigned to, the day before it is due
 *   appointment   the staff member it is with, on its morning
 *   poa           the office administrators and the lawyers it names, 30 and 7 days before it expires
 *   installment   the office administrators, the day before a fee installment is due, and the day
 *                 after if it is still unpaid
 *
 * Days are counted in the office's time zone (REMINDER_TIMEZONE, Palestine by default), and
 * nothing is sent before the morning hour (REMINDER_MORNING_HOUR, 7 by default).
 *
 * Each reminder is claimed for its recipient by inserting its key into reminder_deliveries before
 * it is delivered: a reminder is sent at most once, even across restarts or overlapping runs.
 * Delivery goes through channels (in-app and email today), so another channel such as SMS or
 * WhatsApp can be added without touching what is due or who receives it. Like other emails, a
 * reminder names the case number and the time, never note text or document names.
 */

export const DEFAULT_TIMEZONE = 'Asia/Hebron';
export const DEFAULT_MORNING_HOUR = 7;
const KEEP_DELIVERIES_DAYS = 180;
const ACTIVE_TASK_STATUSES = "('pending', 'in_progress')";

export function reminderConfig(env = process.env) {
  const timeZone = env.REMINDER_TIMEZONE || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en', { timeZone });
  } catch {
    throw new Error('REMINDER_TIMEZONE is not a valid time zone.');
  }
  const hour = env.REMINDER_MORNING_HOUR === undefined ? DEFAULT_MORNING_HOUR : Number(env.REMINDER_MORNING_HOUR);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('REMINDER_MORNING_HOUR must be an hour from 0 to 23.');
  return { timeZone, morningHour: hour };
}

/** The local calendar day (YYYY-MM-DD) and hour of `date` in `timeZone`. */
export function localClock(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

const addDays = (day, days) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/* ───────────── what is due ───────────── */

// Recipients are active members of an active office, with an active account.
const PERSON = `u.user_id, u.email, u.full_name, u.email_reminders`;
const ACTIVE_MEMBER = (userColumn, officeColumn) => `
  JOIN office_memberships member ON member.user_id = ${userColumn} AND member.office_id = ${officeColumn}
       AND member.status = 'active'
  JOIN app_users u ON u.user_id = ${userColumn} AND u.status = 'active'`;

/**
 * Every reminder due now, one row per recipient. Each kind takes only the values it uses, from
 * the time zone, today and tomorrow (local days) and the current time.
 */
const DUE = {
  hearing: {
    values: ({ timeZone, today, tomorrow, now }) => [timeZone, today, tomorrow, now],
    sql: `
    SELECT 'hearing' AS kind, h.hearing_id AS subject_id, h.hearing_at AS at, h.hearing_type AS detail,
           lc.case_id, lc.case_number, h.office_id,
           CASE WHEN (h.hearing_at AT TIME ZONE $1)::date = $3::date THEN 'day_before' ELSE 'same_day' END AS moment,
           ${PERSON}
      FROM hearings h
      JOIN law_offices o ON o.office_id = h.office_id AND o.status = 'active'
      JOIN legal_cases lc ON lc.case_id = h.case_id AND lc.office_id = h.office_id
      JOIN assigned_to team ON team.case_id = h.case_id AND team.office_id = h.office_id
      ${ACTIVE_MEMBER('team.user_id', 'h.office_id')}
     WHERE h.status = 'scheduled' AND h.hearing_at > $4::timestamptz
       AND (h.hearing_at AT TIME ZONE $1)::date IN ($2::date, $3::date)`,
  },
  task: {
    values: ({ timeZone, tomorrow }) => [timeZone, tomorrow],
    sql: `
    SELECT 'task' AS kind, t.task_id AS subject_id, t.due_at AS at, NULL AS detail,
           lc.case_id, lc.case_number, t.office_id, 'day_before' AS moment,
           ${PERSON}
      FROM tasks t
      JOIN law_offices o ON o.office_id = t.office_id AND o.status = 'active'
      LEFT JOIN legal_cases lc ON lc.case_id = t.case_id AND lc.office_id = t.office_id
      ${ACTIVE_MEMBER('t.assigned_to_user_id', 't.office_id')}
     WHERE t.status IN ${ACTIVE_TASK_STATUSES} AND t.due_at IS NOT NULL
       AND (t.due_at AT TIME ZONE $1)::date = $2::date`,
  },
  appointment: {
    values: ({ timeZone, today, now }) => [timeZone, today, now],
    sql: `
    SELECT 'appointment' AS kind, a.appointment_id AS subject_id, a.starts_at AS at, a.appointment_type AS detail,
           lc.case_id, lc.case_number, a.office_id, 'same_day' AS moment,
           ${PERSON}
      FROM appointments a
      JOIN law_offices o ON o.office_id = a.office_id AND o.status = 'active'
      LEFT JOIN legal_cases lc ON lc.case_id = a.case_id AND lc.office_id = a.office_id
      ${ACTIVE_MEMBER('a.user_id', 'a.office_id')}
     WHERE a.status IN ('scheduled', 'confirmed') AND a.starts_at > $3::timestamptz
       AND (a.starts_at AT TIME ZONE $1)::date = $2::date`,
  },
  poa: {
    values: ({ today }) => [today],
    sql: `
    SELECT 'poa' AS kind, p.poa_id AS subject_id, to_char(p.expires_on, 'YYYY-MM-DD') AS at, p.poa_number AS detail,
           NULL::uuid AS case_id, NULL AS case_number, p.office_id,
           CASE WHEN p.expires_on - $1::date <= 7 THEN '7' ELSE '30' END AS moment,
           (p.expires_on - $1::date) AS days_left,
           ${PERSON}
      FROM powers_of_attorney p
      JOIN law_offices o ON o.office_id = p.office_id AND o.status = 'active'
      JOIN (
        SELECT named.poa_id, named.user_id FROM power_of_attorney_lawyers named
        UNION
        SELECT poa.poa_id, admin_m.user_id
          FROM powers_of_attorney poa
          JOIN office_memberships admin_m ON admin_m.office_id = poa.office_id
          JOIN roles r ON r.role_id = admin_m.role_id AND r.role_name = 'admin'
      ) audience ON audience.poa_id = p.poa_id
      ${ACTIVE_MEMBER('audience.user_id', 'p.office_id')}
     WHERE p.status = 'active' AND p.expires_on IS NOT NULL
       AND p.expires_on BETWEEN $1::date AND $1::date + 30`,
  },
  installment: {
    values: ({ today, tomorrow }) => [today, tomorrow],
    sql: `
    SELECT 'installment' AS kind, fi.installment_id AS subject_id, to_char(fi.due_on, 'YYYY-MM-DD') AS at,
           (fi.amount::text || ' ' || a.currency) AS detail,
           lc.case_id, lc.case_number, fi.office_id,
           CASE WHEN fi.due_on = $2::date THEN 'day_before' ELSE 'overdue' END AS moment,
           ${PERSON}
      FROM fee_installments fi
      JOIN fee_agreements a ON a.agreement_id = fi.agreement_id AND a.status = 'active'
      JOIN invoices i ON i.invoice_id = fi.invoice_id AND i.status IN ('unpaid', 'partially_paid')
      JOIN law_offices o ON o.office_id = fi.office_id AND o.status = 'active'
      JOIN legal_cases lc ON lc.case_id = a.case_id AND lc.office_id = fi.office_id
      JOIN office_memberships admin_m ON admin_m.office_id = fi.office_id
      JOIN roles r ON r.role_id = admin_m.role_id AND r.role_name = 'admin'
      ${ACTIVE_MEMBER('admin_m.user_id', 'fi.office_id')}
     WHERE fi.due_on IN ($2::date, $1::date - 1)`,
  },
};

/** The key that makes a reminder unique: what, when, and which of its reminders. */
export function reminderKey(row) {
  const when = row.at instanceof Date ? row.at.toISOString() : String(row.at);
  return `${row.kind}:${row.subject_id}:${row.moment}:${when}`.slice(0, 200);
}

/* ───────────── what it says ───────────── */

const APPOINTMENT_NAMES = { meeting: 'لقاء مع موكّل', expert_session: 'جلسة خبرة', court_visit: 'مراجعة محكمة', other: 'موعد' };

function appUrl(pathname) {
  const [origin] = getSecurityConfig().trustedOrigins;
  return `${origin}${pathname}`;
}

export function reminderMessage(row, timeZone) {
  const time = new Intl.DateTimeFormat('ar-PS-u-nu-latn', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(row.at));
  const inCase = row.case_number ? ` في القضية ${row.case_number}` : '';
  switch (row.kind) {
    case 'hearing': {
      const when = row.moment === 'day_before' ? 'غداً' : 'اليوم';
      return {
        title: `تذكير: جلسة ${when}`,
        body: `لديك جلسة ${row.detail ?? ''}${inCase} ${when} الساعة ${time}.`.replace(/\s+/g, ' '),
        path: `/office/cases/${row.case_id}?tab=hearings`, button: 'افتح ملف القضية',
      };
    }
    case 'task':
      return {
        title: 'تذكير: مهمة مستحقة غداً',
        body: `لديك مهمة${inCase} موعد إنجازها غداً الساعة ${time}.`,
        path: '/office/tasks', button: 'افتح المهام',
      };
    case 'appointment':
      return {
        title: 'تذكير: موعد اليوم',
        body: `لديك ${APPOINTMENT_NAMES[row.detail] ?? 'موعد'}${inCase} اليوم الساعة ${time}.`,
        // The calendar opens on the appointment's day (local, like the reminder itself).
        path: `/office/calendar?day=${localClock(new Date(row.at), timeZone).day}`, button: 'افتح التقويم',
      };
    case 'poa': {
      const days = Number(row.days_left);
      const left = days === 0 ? 'اليوم' : days === 1 ? 'غداً' : `خلال ${days} يوماً`;
      return {
        title: 'توكيل ينتهي قريباً',
        body: `ينتهي التوكيل رقم ${row.detail} ${left}. جدّده أو استبدله حتى لا تبقى قضاياه دون توكيل ساري.`,
        path: '/office/powers-of-attorney?state=expiring', button: 'افتح التوكيلات',
      };
    }
    case 'installment':
      return row.moment === 'day_before'
        ? {
            title: 'قسط أتعاب مستحق غداً',
            body: `يستحق غداً قسط أتعاب بقيمة ${row.detail}${inCase}.`,
            path: `/office/cases/${row.case_id}?tab=finance`, button: 'افتح مالية القضية',
          }
        : {
            title: 'قسط أتعاب متأخر',
            body: `لم يُسدَّد قسط أتعاب بقيمة ${row.detail}${inCase} كان مستحقاً أمس.`,
            path: `/office/cases/${row.case_id}?tab=finance`, button: 'افتح مالية القضية',
          };
    default:
      return null;
  }
}

/* ───────────── how it is delivered ───────────── */

/** Delivery channels. Each receives the recipient and the message and returns whether it sent. */
export function defaultChannels({ query, sendMail }) {
  return [
    {
      name: 'in_app',
      async deliver({ person, officeId, message }) {
        await query(
          `INSERT INTO notifications (title, body, notification_type, user_id, office_id, link_path)
           VALUES ($1, $2, 'reminder', $3, $4, $5)`,
          [message.title, message.body, person.user_id, officeId, message.path]
        );
        return true;
      },
    },
    {
      // On the person's phone or computer, when they turned push notifications on there.
      name: 'push',
      async deliver({ person, message }) {
        return (await pushToUser(person.user_id, { title: message.title, body: message.body, url: message.path }, query)) > 0;
      },
    },
    {
      name: 'email',
      async deliver({ person, message }) {
        if (!person.email_reminders || !person.email) return false;
        return sendMail({ to: person.email, ...notificationEmail({ ...message, url: appUrl(message.path) }) });
      },
    },
  ];
}

/**
 * Sends every reminder due at `now` and returns how many people were reminded. Safe to run as
 * often as wanted; `query`, `sendMail`, `channels` and `env` can be replaced in tests.
 */
export async function runReminders({ now = new Date(), query = databaseQuery, sendMail = deliverMail, channels, env = process.env } = {}) {
  const { timeZone, morningHour } = reminderConfig(env);
  const { day: today, hour } = localClock(now, timeZone);
  if (hour < morningHour) return 0;
  const tomorrow = addDays(today, 1);
  const deliveries = channels ?? defaultChannels({ query, sendMail });
  const clock = { timeZone, today, tomorrow, now: now.toISOString() };

  let reminded = 0;
  for (const [kind, { sql, values }] of Object.entries(DUE)) {
    const due = await query(sql, values(clock));
    for (const row of due.rows) {
      const message = reminderMessage(row, timeZone);
      if (!message) continue;
      // Claim first: if another run already sent it to this person, nothing is inserted.
      const claimed = await query(
        `INSERT INTO reminder_deliveries (reminder_key, user_id, office_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING reminder_key`,
        [reminderKey(row), row.user_id, row.office_id]
      );
      if (!claimed.rowCount) continue;
      for (const channel of deliveries) {
        try {
          await channel.deliver({ person: row, officeId: row.office_id, message });
        } catch (error) {
          console.error('Reminder could not be delivered.', { channel: channel.name, kind, name: error?.name ?? 'Error' });
        }
      }
      reminded += 1;
    }
  }
  await query(`DELETE FROM reminder_deliveries WHERE sent_at < NOW() - make_interval(days => $1::int)`, [KEEP_DELIVERIES_DAYS]);
  return reminded;
}
