import { query } from '../config/db.js';
import { auditLater } from './auditService.js';
import { getCaseById } from './caseService.js';
import { sendMail as deliverMail } from './mailService.js';
import { appUrl, notificationEmail } from './notificationService.js';
import { pushToUser } from './pushService.js';

/**
 * Official notices (الإشعارات الرسمية): a hearing date, a judgment or another formal notice the
 * office sends a client about a case. Each notice is kept, delivered on every channel it can use,
 * and every channel's outcome is logged:
 *
 *   portal     always: the notice appears in the client's portal (and their notification list)
 *              until they press "I have read it", which records the time
 *   push       to each device where the client turned notifications on
 *   email      when the client has an email address
 *   whatsapp   prepared as a link that opens WhatsApp with the client's number and the text; the
 *              lawyer sends it and records that they did (no paid provider, nothing automatic)
 *
 * Staff who can open the case send and read its notices; a client reads and acknowledges their own.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF = ['admin', 'lawyer', 'assistant'];
export const NOTICE_KINDS = ['hearing', 'judgment', 'other'];
const MAX_TITLE = 200;
const MAX_BODY = 4000;
const PORTAL_PATH = '/client';

export class OfficialNoticeError extends Error {
  constructor(status, message, publicCode) {
    super(message);
    this.name = 'OfficialNoticeError';
    this.status = status;
    if (publicCode) this.publicCode = publicCode;
  }
}

const invalid = (message) => {
  throw new OfficialNoticeError(400, message, 'VALIDATION');
};
const notFound = () => {
  throw new OfficialNoticeError(404, 'Not found.', 'NOT_FOUND');
};
const forbidden = () => {
  throw new OfficialNoticeError(403, 'You do not have permission to access this resource.', 'FORBIDDEN');
};

const isUuid = (value) => typeof value === 'string' && UUID_PATTERN.test(value);

function assertActor(actor, roles) {
  if (!actor || !roles.includes(actor.role) || !isUuid(actor.user_id)) forbidden();
}

async function assertCase(actor, caseId) {
  if (!isUuid(caseId)) invalid('caseId must be a valid UUID.');
  try {
    return await getCaseById(actor, caseId);
  } catch (error) {
    if (error?.status === 404 || error?.status === 403) notFound();
    throw error;
  }
}

/* ───────────────────────── text ───────────────────────── */

const TIMEZONE = () => process.env.REMINDER_TIMEZONE || 'Asia/Hebron';
const dateText = (value) =>
  new Intl.DateTimeFormat('ar-PS-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TIMEZONE() }).format(new Date(value));
const timeText = (value) => new Intl.DateTimeFormat('ar-PS-u-nu-latn', { hour: 'numeric', minute: '2-digit', timeZone: TIMEZONE() }).format(new Date(value));

/** The suggested title and text of a notice, from its kind and, for a hearing, the hearing itself. */
export function draftNotice({ kind, caseRecord, hearing, clientName }) {
  const greeting = clientName ? `السيد/ة ${clientName}،` : '';
  if (kind === 'hearing' && hearing) {
    const place = [hearing.court_name, hearing.court_room ? `القاعة ${hearing.court_room}` : null].filter(Boolean).join('، ');
    return {
      title: `موعد جلسة في القضية ${caseRecord.case_number}`,
      body: [greeting, `نُعلمكم بأن جلسة (${hearing.hearing_type}) في القضية رقم ${caseRecord.case_number} «${caseRecord.title}» محددة يوم ${dateText(hearing.hearing_at)} الساعة ${timeText(hearing.hearing_at)}${place ? ` في ${place}` : ''}.`, 'يرجى التواصل مع المكتب لأي استفسار.']
        .filter(Boolean)
        .join('\n'),
    };
  }
  if (kind === 'judgment') {
    return {
      title: `صدور حكم في القضية ${caseRecord.case_number}`,
      body: [greeting, `نُعلمكم بصدور حكم في القضية رقم ${caseRecord.case_number} «${caseRecord.title}».`, 'يرجى التواصل مع المكتب للاطلاع على الحكم والخطوات التالية.'].filter(Boolean).join('\n'),
    };
  }
  return { title: `إشعار بشأن القضية ${caseRecord.case_number}`, body: greeting };
}

/** A phone number as WhatsApp wants it: digits with the country code. */
export function whatsappNumber(phone, countryCode = process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || '970') {
  if (typeof phone !== 'string') return null;
  const trimmed = phone.trim();
  let digits = trimmed.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660)).replace(/\D/g, '');
  if (trimmed.startsWith('+')) return digits.length >= 8 ? digits : null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = `${countryCode}${digits.slice(1)}`;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export const whatsappLink = (number, text) => `https://wa.me/${number}?text=${encodeURIComponent(text)}`;

/* ───────────────────────── reading ───────────────────────── */

const SELECT_NOTICE = `
  SELECT n.notice_id, n.case_id, n.client_id, n.hearing_id, n.kind, n.title, n.body, n.sent_at, n.acknowledged_at,
         n.sent_by_user_id, u.full_name AS sent_by_name, lc.case_number, lc.title AS case_title,
         c.full_name_or_org AS client_name, c.phone AS client_phone,
         COALESCE((
           SELECT json_agg(json_build_object('channel', d.channel, 'status', d.status, 'detail', d.detail, 'recorded_at', d.recorded_at)
                           ORDER BY d.recorded_at)
             FROM notice_deliveries d WHERE d.notice_id = n.notice_id
         ), '[]'::json) AS deliveries
    FROM official_notices n
    JOIN app_users u ON u.user_id = n.sent_by_user_id
    JOIN legal_cases lc ON lc.case_id = n.case_id
    JOIN clients c ON c.client_id = n.client_id`;

const fullText = (row) => `${row.title}\n\n${row.body}\n\nللاطلاع والتأكيد في بوابتك: ${appUrl(PORTAL_PATH)}`;

const publicNotice = (row, { staff }) => {
  const number = staff ? whatsappNumber(row.client_phone) : null;
  return {
    notice_id: row.notice_id,
    case_id: row.case_id,
    case_number: row.case_number,
    case_title: row.case_title,
    kind: row.kind,
    title: row.title,
    body: row.body,
    sent_at: row.sent_at,
    acknowledged_at: row.acknowledged_at,
    sent_by: { user_id: row.sent_by_user_id, full_name: row.sent_by_name },
    ...(staff
      ? {
          client_id: row.client_id,
          client_name: row.client_name,
          deliveries: row.deliveries,
          whatsapp_url: number ? whatsappLink(number, fullText(row)) : null,
        }
      : {}),
  };
};

export async function listCaseNotices(actor, caseId) {
  assertActor(actor, STAFF);
  await assertCase(actor, caseId);
  const result = await query(`${SELECT_NOTICE} WHERE n.case_id = $1 AND n.office_id = $2 ORDER BY n.sent_at DESC LIMIT 100`, [caseId, actor.office_id]);
  return { notices: result.rows.map((row) => publicNotice(row, { staff: true })) };
}

export async function listMyNotices(actor) {
  assertActor(actor, ['client']);
  const result = await query(`${SELECT_NOTICE} WHERE c.user_id = $1 AND n.office_id = $2 ORDER BY (n.acknowledged_at IS NULL) DESC, n.sent_at DESC LIMIT 100`, [actor.user_id, actor.office_id]);
  return { notices: result.rows.map((row) => publicNotice(row, { staff: false })) };
}

/** The suggested text for a new notice, before the lawyer edits and sends it. */
export async function previewNotice(actor, caseId, parameters = {}) {
  assertActor(actor, STAFF);
  const caseRecord = await assertCase(actor, caseId);
  const kind = NOTICE_KINDS.includes(parameters.kind) ? parameters.kind : invalid('kind must be hearing, judgment or other.');
  const client = isUuid(parameters.clientId) ? await findCaseClient(actor, caseId, parameters.clientId) : null;
  const hearing = kind === 'hearing' && isUuid(parameters.hearingId) ? await findHearing(actor, caseId, parameters.hearingId) : null;
  return { draft: draftNotice({ kind, caseRecord, hearing, clientName: client?.full_name_or_org }) };
}

async function findCaseClient(actor, caseId, clientId) {
  const result = await query(
    `SELECT c.client_id, c.full_name_or_org, c.email, c.phone, c.user_id
       FROM involves i JOIN clients c ON c.client_id = i.client_id
      WHERE i.case_id = $1 AND c.client_id = $2 AND c.office_id = $3`,
    [caseId, clientId, actor.office_id]
  );
  if (!result.rowCount) invalid('The client is not a party to this case.');
  return result.rows[0];
}

async function findHearing(actor, caseId, hearingId) {
  const result = await query(
    `SELECT h.hearing_id, h.hearing_at, h.hearing_type, h.court_room, ct.name AS court_name
       FROM hearings h LEFT JOIN courts ct ON ct.court_id = h.court_id
      WHERE h.hearing_id = $1 AND h.case_id = $2 AND h.office_id = $3`,
    [hearingId, caseId, actor.office_id]
  );
  if (!result.rowCount) invalid('The hearing is not one of this case.');
  return result.rows[0];
}

/* ───────────────────────── sending ───────────────────────── */

async function logDelivery(actor, noticeId, channel, status, detail = null) {
  await query(
    `INSERT INTO notice_deliveries (office_id, notice_id, channel, status, detail, recorded_by_user_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [actor.office_id, noticeId, channel, status, detail, actor.user_id]
  );
}

/**
 * Sends a notice: portal (with the notification list), push and email now; WhatsApp prepared for
 * the lawyer to send. Returns the notice with its delivery log and the WhatsApp link.
 */
export async function sendNotice(actor, caseId, body, { sendMail = deliverMail } = {}) {
  assertActor(actor, STAFF);
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('A JSON object is required.');
  const unknown = Object.keys(body).filter((key) => !['client_id', 'kind', 'hearing_id', 'title', 'body'].includes(key));
  if (unknown.length) invalid(`Unknown fields: ${unknown.join(', ')}.`);
  const caseRecord = await assertCase(actor, caseId);
  const kind = NOTICE_KINDS.includes(body.kind) ? body.kind : invalid('kind must be hearing, judgment or other.');
  if (!isUuid(body.client_id)) invalid('client_id is required.');
  const client = await findCaseClient(actor, caseId, body.client_id);
  const hearing = body.hearing_id ? await findHearing(actor, caseId, isUuid(body.hearing_id) ? body.hearing_id : invalid('hearing_id is not valid.')) : null;
  const suggested = draftNotice({ kind, caseRecord, hearing, clientName: client.full_name_or_org });
  const text = (value, max, fallback) => {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'string' || value.trim().length > max) invalid(`Notice text must be at most ${max} characters.`);
    return value.trim() || fallback;
  };
  const title = text(body.title, MAX_TITLE, suggested.title);
  const noticeBody = text(body.body, MAX_BODY, suggested.body);
  if (!noticeBody) invalid('body is required.');

  const inserted = await query(
    `INSERT INTO official_notices (office_id, case_id, client_id, hearing_id, kind, title, body, sent_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING notice_id`,
    [actor.office_id, caseId, client.client_id, hearing?.hearing_id ?? null, kind, title, noticeBody, actor.user_id]
  );
  const noticeId = inserted.rows[0].notice_id;

  // Portal: the client's notification list (the notice itself shows in the portal regardless).
  if (client.user_id) {
    await query(
      `INSERT INTO notifications (title, body, notification_type, user_id, office_id) VALUES ($1, $2, 'official_notice', $3, $4)`,
      [title, noticeBody, client.user_id, actor.office_id]
    );
    await logDelivery(actor, noticeId, 'portal', 'sent');
    const devices = await pushToUser(client.user_id, { title, body: noticeBody, url: PORTAL_PATH });
    await logDelivery(actor, noticeId, 'push', devices > 0 ? 'sent' : 'skipped', devices > 0 ? `${devices}` : 'no device');
  } else {
    await logDelivery(actor, noticeId, 'portal', 'skipped', 'no portal account');
  }

  if (client.email) {
    let sent = false;
    try {
      sent = await sendMail({ to: client.email, ...notificationEmail({ title, body: noticeBody, url: appUrl(PORTAL_PATH), button: 'افتح بوابتك' }) });
    } catch {
      sent = false;
    }
    await logDelivery(actor, noticeId, 'email', sent ? 'sent' : 'failed');
  } else {
    await logDelivery(actor, noticeId, 'email', 'skipped', 'no email');
  }

  const number = whatsappNumber(client.phone);
  await logDelivery(actor, noticeId, 'whatsapp', number ? 'prepared' : 'skipped', number ? null : 'no phone');

  auditLater(actor, { action: 'official_notice.sent', entityType: 'case', entityId: caseId, details: { notice_id: noticeId, kind } });
  return { notice: await findNotice(actor, noticeId) };
}

async function findNotice(actor, noticeId) {
  if (!isUuid(noticeId)) notFound();
  const result = await query(`${SELECT_NOTICE} WHERE n.notice_id = $1 AND n.office_id = $2`, [noticeId, actor.office_id]);
  if (!result.rowCount) notFound();
  return publicNotice(result.rows[0], { staff: true });
}

/** The lawyer sent the prepared WhatsApp message: logged as sent. */
export async function recordWhatsAppSent(actor, caseId, noticeId) {
  assertActor(actor, STAFF);
  await assertCase(actor, caseId);
  const notice = await findNotice(actor, noticeId);
  if (notice.case_id !== caseId) notFound();
  if (!notice.whatsapp_url) invalid('The client has no phone number for WhatsApp.');
  await logDelivery(actor, noticeId, 'whatsapp', 'sent', 'sent by the lawyer');
  return { notice: await findNotice(actor, noticeId) };
}

/** The client has read the notice: the time is recorded once. */
export async function acknowledgeNotice(actor, noticeId) {
  assertActor(actor, ['client']);
  if (!isUuid(noticeId)) notFound();
  const result = await query(
    `UPDATE official_notices n SET acknowledged_at = COALESCE(n.acknowledged_at, NOW())
       FROM clients c
      WHERE n.notice_id = $1 AND n.office_id = $2 AND c.client_id = n.client_id AND c.user_id = $3
      RETURNING n.acknowledged_at`,
    [noticeId, actor.office_id, actor.user_id]
  );
  if (!result.rowCount) notFound();
  return { acknowledged_at: result.rows[0].acknowledged_at };
}
