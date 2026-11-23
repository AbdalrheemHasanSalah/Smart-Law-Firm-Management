/**
 * Notifications by email (and a row in `notifications` for a later in-app list).
 *
 * People are told about changes that concern them without having the app open:
 *   - the client, when something they are allowed to see changes on their case;
 *   - the staff assigned to a case, and the person a task is given to;
 *   - the office owner, about activity in the office and decisions on it;
 *   - the platform owner, when an office asks to be reviewed.
 *
 * Rules:
 *   - A notification never changes the outcome of the request that caused it. `notifyLater`
 *     runs after the response and swallows every failure.
 *   - Recipients are looked up inside the acting office only, and the person who made the
 *     change is not notified about their own action.
 *   - An email says what kind of change happened and links to the app. It never carries the
 *     content itself (note text, file names), so nothing confidential travels by email and a
 *     client is never told about something they may not see.
 */
import { query as databaseQuery } from '../config/db.js';
import { getSecurityConfig } from '../config/security.js';
import { escapeHtml, sendMail as deliverMail } from './mailService.js';

const STATUS_NAMES = {
  open: 'مفتوحة',
  in_progress: 'قيد النظر',
  on_hold: 'معلّقة',
  closed: 'مغلقة',
  cancelled: 'ملغاة',
};
const ROLE_NAMES = { lawyer: 'محامٍ', assistant: 'مساعد قانوني', client: 'موكّل', admin: 'مدير المكتب' };
const OFFICE_DECISIONS = {
  active: { title: 'تم اعتماد مكتبك', body: 'اعتُمد مكتبك على قضيتي. يمكنك الآن الدخول ودعوة فريقك وموكّليك.' },
  rejected: { title: 'لم يُعتمد طلب مكتبك', body: 'راجعنا طلب تسجيل مكتبك ولم نتمكن من اعتماده. يمكنك تقديم طلب جديد ببيانات محدّثة.' },
  suspended: { title: 'أُوقف مكتبك مؤقتاً', body: 'أُوقف الوصول إلى مكتبك على قضيتي. تواصل مع إدارة المنصّة لمعرفة السبب.' },
};

const CLIENTS_OF_CASE = `
  SELECT u.user_id, u.email, u.full_name, c.client_id
  FROM involves i
  JOIN clients c ON c.client_id = i.client_id AND c.office_id = i.office_id
  JOIN app_users u ON u.user_id = c.user_id
  JOIN office_memberships m ON m.user_id = u.user_id AND m.office_id = i.office_id
  WHERE i.case_id = $1 AND i.office_id = $2
    AND u.status = 'active' AND m.status = 'active'`;

const STAFF_OF_CASE = `
  SELECT u.user_id, u.email, u.full_name
  FROM assigned_to a
  JOIN app_users u ON u.user_id = a.user_id
  JOIN office_memberships m ON m.user_id = a.user_id AND m.office_id = a.office_id
  WHERE a.case_id = $1 AND a.office_id = $2
    AND u.status = 'active' AND m.status = 'active'`;

const OWNER_OF_OFFICE = `
  SELECT u.user_id, u.email, u.full_name
  FROM office_memberships m
  JOIN app_users u ON u.user_id = m.user_id
  WHERE m.office_id = $1 AND m.is_owner = TRUE
    AND u.status = 'active' AND m.status = 'active'`;

const MEMBER_OF_OFFICE = `
  SELECT u.user_id, u.email, u.full_name
  FROM office_memberships m
  JOIN app_users u ON u.user_id = m.user_id
  WHERE m.office_id = $1 AND m.user_id = $2
    AND u.status = 'active' AND m.status = 'active'`;

const PLATFORM_OWNERS = `
  SELECT user_id, email, full_name
  FROM app_users
  WHERE is_platform_admin = TRUE AND status = 'active'`;

const DATE_FORMAT = new Intl.DateTimeFormat('ar-PS-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });

const CASE_LABEL ='SELECT case_number, title FROM legal_cases WHERE case_id = $1 AND office_id = $2';
const OFFICE_NAME = 'SELECT name FROM law_offices WHERE office_id = $1';

function appUrl(pathname) {
  const [origin] = getSecurityConfig().trustedOrigins;
  return `${origin}${pathname}`;
}

export function notificationEmail({ title, body, url, button }) {
  const link = escapeHtml(url);
  return {
    subject: `${title} — قضيتي`,
    html: `<!doctype html>
<html><body style="margin:0;background:#f6f5ee;font-family:Tahoma,Arial,sans-serif;color:#061d33">
<div dir="rtl" style="max-width:560px;margin:0 auto;padding:32px 24px;text-align:right;line-height:1.8">
<p style="font-size:22px;font-weight:700;color:#061d33;margin:0 0 24px">قضيتي</p>
<div style="background:#ffffff;border-top:4px solid #d90b1a;border-radius:10px;padding:24px">
<p style="font-size:18px;font-weight:700;margin:0 0 12px">${escapeHtml(title)}</p>
<p style="margin:0 0 20px;color:#46607a">${escapeHtml(body)}</p>
<a href="${link}" style="display:inline-block;background:#d90b1a;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(button)}</a>
</div>
<p style="font-size:12px;color:#5d7d90;margin-top:24px">وصلتك هذه الرسالة لأن لك حساباً على قضيتي. التفاصيل تظهر داخل النظام فقط بعد تسجيل الدخول.</p>
</div></body></html>`,
    text: `${title}\n\n${body}\n\n${url}`,
  };
}

/** Removes the actor and repeated people, so nobody is told twice or about their own action. */
function audience(groups, actorUserId) {
  const seen = new Set(actorUserId ? [actorUserId] : []);
  const people = [];
  for (const person of groups.flat()) {
    if (!person?.email || seen.has(person.user_id)) continue;
    seen.add(person.user_id);
    people.push(person);
  }
  return people;
}

/**
 * Works out who should hear about `event` and what to tell each of them.
 * Returns a list of `{ people, title, body, path, button, type, officeId }`.
 */
async function plan(event, payload, query) {
  const rows = async (sql, parameters) => (await query(sql, parameters)).rows;
  const { officeId, caseId, actorUserId } = payload;

  const caseContext = async () => {
    const [found] = await rows(CASE_LABEL, [caseId, officeId]);
    if (!found) return null;
    const [clients, staff, owner] = await Promise.all([
      rows(CLIENTS_OF_CASE, [caseId, officeId]),
      rows(STAFF_OF_CASE, [caseId, officeId]),
      rows(OWNER_OF_OFFICE, [officeId]),
    ]);
    return { label: `رقم ${found.case_number}`, clients, staff, owner };
  };
  const forStaff = (people, title, body, type) => ({
    people: audience([people], actorUserId), title, body, type, officeId,
    path: `/office/cases/${caseId}`, button: 'افتح ملف القضية',
  });
  const forClients = (people, title, body, type) => ({
    people: audience([people], actorUserId), title, body, type, officeId,
    path: '/portal', button: 'افتح بوابة الموكّل',
  });

  switch (event) {
    case 'case.status_changed': {
      const context = await caseContext();
      if (!context) return [];
      const status = STATUS_NAMES[payload.status] ?? payload.status;
      return [
        forClients(context.clients, 'تغيّرت حالة قضيتك', `أصبحت حالة قضيتك ${context.label}: ${status}.`, 'case_status'),
        forStaff([...context.staff, ...context.owner], 'تغيّرت حالة قضية', `أصبحت حالة القضية ${context.label}: ${status}.`, 'case_status'),
      ];
    }
    case 'case.note_added': {
      const context = await caseContext();
      if (!context) return [];
      // internal notes concern the office owner only; team notes add the assigned staff;
      // only a client-visible note reaches the client.
      const staff = payload.visibility === 'internal' ? context.owner : [...context.staff, ...context.owner];
      const messages = [forStaff(staff, 'ملاحظة جديدة على قضية', `أُضيفت ملاحظة جديدة على القضية ${context.label}.`, 'case_note')];
      if (payload.visibility === 'client_visible') {
        messages.push(forClients(context.clients, 'تحديث جديد على قضيتك', `كتب مكتبك تحديثاً جديداً على قضيتك ${context.label}.`, 'case_note'));
      }
      return messages;
    }
    case 'case.document_added': {
      const context = await caseContext();
      if (!context) return [];
      const staff = payload.accessLevel === 'restricted' ? context.owner : [...context.staff, ...context.owner];
      const messages = [forStaff(staff, 'مستند جديد في قضية', `رُفع مستند جديد إلى القضية ${context.label}.`, 'case_document')];
      if (payload.accessLevel === 'authorized_users' && payload.clientId) {
        const shared = context.clients.filter((client) => client.client_id === payload.clientId);
        messages.push(forClients(shared, 'مستند جديد في قضيتك', `شارك مكتبك معك مستنداً جديداً في قضيتك ${context.label}.`, 'case_document'));
      }
      return messages;
    }
    case 'case.staff_assigned': {
      const context = await caseContext();
      if (!context) return [];
      const assigned = await rows(MEMBER_OF_OFFICE, [officeId, payload.userId]);
      return [forStaff(assigned, 'أُسندت إليك قضية', `أُسندت إليك القضية ${context.label}.`, 'case_assignment')];
    }
    case 'case.client_linked': {
      const context = await caseContext();
      if (!context) return [];
      const linked = context.clients.filter((client) => client.client_id === payload.clientId);
      return [forClients(linked, 'أُضيفت قضية إلى حسابك', `أضاف مكتبك القضية ${context.label} إلى حسابك، ويمكنك متابعتها من بوابتك.`, 'case_assignment')];
    }
    case 'task.assigned': {
      const assigned = await rows(MEMBER_OF_OFFICE, [officeId, payload.userId]);
      return [{
        people: audience([assigned], actorUserId), officeId, type: 'task',
        title: 'مهمة جديدة لك', body: 'أُسندت إليك مهمة جديدة في المكتب.',
        path: '/office/tasks', button: 'افتح المهام',
      }];
    }
    case 'task.completed': {
      const owner = await rows(OWNER_OF_OFFICE, [officeId]);
      return [{
        people: audience([owner], actorUserId), officeId, type: 'task',
        title: 'أُنجزت مهمة', body: 'أنجز أحد أعضاء المكتب مهمة مسندة إليه.',
        path: '/office/tasks', button: 'افتح المهام',
      }];
    }
    case 'message.received': {
      const receiver = await rows(MEMBER_OF_OFFICE, [officeId, payload.userId]);
      return [{
        people: audience([receiver], actorUserId), officeId, type: 'message',
        title: 'رسالة جديدة', body: `وصلتك رسالة جديدة من ${payload.senderName ?? 'أحد أعضاء المكتب'}.`,
        path: payload.receiverRole === 'client' ? '/portal/messages' : '/office/messages', button: 'افتح الرسائل',
      }];
    }
    case 'subscription.paid': {
      const owner = await rows(OWNER_OF_OFFICE, [officeId]);
      const until = payload.endsAt ? ` حتى ${DATE_FORMAT.format(new Date(payload.endsAt))}` : '';
      const messages = [{
        people: audience([owner], actorUserId), officeId, type: 'subscription',
        title: 'سُجّلت دفعة اشتراك', body: `سُجّلت دفعة اشتراك لمكتبك، والاشتراك فعّال${until}.`,
        path: '/office/subscription', button: 'افتح صفحة الاشتراك',
      }];
      if (payload.online) {
        // Payments made online reach the platform owner by email only (no office of theirs to list it in).
        const [office] = await rows(OFFICE_NAME, [officeId]);
        const platformOwners = await rows(PLATFORM_OWNERS, []);
        messages.push({
          people: audience([platformOwners], actorUserId), officeId: null, type: 'platform',
          title: 'دفعة اشتراك إلكترونية', body: `دفع ${office ? `«${office.name}»` : 'أحد المكاتب'} اشتراكه إلكترونياً${until}.`,
          path: '/platform/subscriptions', button: 'افتح الاشتراكات',
        });
      }
      return messages;
    }
    case 'subscription.expiring': {
      const owner = await rows(OWNER_OF_OFFICE, [officeId]);
      const date = DATE_FORMAT.format(new Date(payload.endsAt));
      return [{
        people: audience([owner], actorUserId), officeId, type: 'subscription',
        title: 'اشتراك مكتبك ينتهي قريباً',
        body: `ينتهي اشتراك مكتبك في ${date}. جدّده قبل ذلك حتى لا يتوقف عمل المكتب بعد انتهاء مهلة السماح.`,
        path: '/office/subscription', button: 'جدّد الاشتراك',
      }];
    }
    case 'member.joined': {
      const owner = await rows(OWNER_OF_OFFICE, [officeId]);
      const role = ROLE_NAMES[payload.role] ?? payload.role;
      return [{
        people: audience([owner], actorUserId), officeId, type: 'team',
        title: 'عضو جديد في مكتبك', body: `قُبلت دعوة وانضمّ عضو جديد إلى مكتبك بصفة ${role}.`,
        path: '/office/team', button: 'افتح الفريق',
      }];
    }
    case 'office.registered': {
      const owners = await rows(PLATFORM_OWNERS, []);
      return [{
        people: audience([owners], actorUserId), officeId: null, type: 'platform',
        title: 'طلب مكتب جديد بانتظار المراجعة', body: `سُجّل مكتب جديد باسم «${payload.officeName}» وينتظر قرارك.`,
        path: '/platform', button: 'راجع الطلبات',
      }];
    }
    case 'office.reviewed': {
      const decision = OFFICE_DECISIONS[payload.status];
      if (!decision) return [];
      const owner = await rows(OWNER_OF_OFFICE, [officeId]);
      const [office] = await rows(OFFICE_NAME, [officeId]);
      return [{
        // The decision is recorded in the app's own review screen; only the email is sent,
        // because a pending or rejected office has no usable workspace to list it in.
        people: audience([owner], actorUserId), officeId: null, type: 'platform',
        title: decision.title, body: office ? `${office.name}: ${decision.body}` : decision.body,
        path: '/login', button: 'افتح قضيتي',
      }];
    }
    default:
      return [];
  }
}

/**
 * Sends the notifications for one event and returns how many emails were accepted.
 * `query` and `sendMail` can be replaced in tests.
 */
export async function notify(event, payload, { query = databaseQuery, sendMail = deliverMail } = {}) {
  const messages = await plan(event, payload, query);
  let sent = 0;
  for (const { people, title, body, path, button, type, officeId } of messages) {
    const email = notificationEmail({ title, body, url: appUrl(path), button });
    for (const person of people) {
      if (officeId) {
        await query(
          `INSERT INTO notifications (title, body, notification_type, user_id, office_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [title, body, type, person.user_id, officeId]
        );
      }
      if (await sendMail({ to: person.email, ...email })) sent += 1;
    }
  }
  return sent;
}

/**
 * Fire-and-forget: schedules `notify` after the current request has been answered.
 * Unit tests of other features do not expect these extra queries, so it stays off under
 * NODE_ENV=test unless NOTIFICATIONS_IN_TESTS is set.
 */
export function notifyLater(event, payload, dependencies) {
  if (process.env.NODE_ENV === 'test' && process.env.NOTIFICATIONS_IN_TESTS !== 'true') return;
  setImmediate(() => {
    notify(event, payload, dependencies).catch((error) => {
      console.error('Notification could not be delivered.', { event, name: error?.name ?? 'Error' });
    });
  });
}
