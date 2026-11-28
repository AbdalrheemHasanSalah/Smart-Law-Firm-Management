import { Readable } from 'node:stream';
import { PDFDocument } from 'pdf-lib';
import { query } from '../config/db.js';
import { auditLater } from './auditService.js';
import { uploadDocument } from './documentService.js';
import { officeCondition } from './officeScope.js';
import { createFileStore, detectReceiptType } from './receiptStorage.js';

/**
 * Files between the client and the office (ملفات من الموكّل، ومرفقات المحادثة).
 *
 *   portal    a client sends a photo or a PDF to the office for one of their cases, with a note
 *   message   any chat participant attaches a file to a message (uploaded first, then attached)
 *
 * A client's file waits as "new" until the office acts on it: "move" stores it among the case
 * documents (a photo is placed on a PDF page, since case documents are PDFs), "dismiss" sets it
 * aside. Who may open a file:
 *   - whoever uploaded it, and both people in the conversation of its message;
 *   - for a client's file: the office admin, and the staff assigned to its case.
 * Chat attachments never attached to a message are removed after a day.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ['admin', 'lawyer', 'assistant', 'client'];
const STAFF = ['admin', 'lawyer', 'assistant'];
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_NAME = 200;
const MAX_NOTE = 1000;
const UNATTACHED_LIFETIME = '1 day';

const files = createFileStore({ folder: 'shared-files', noun: 'file', maxBytes: MAX_FILE_BYTES });

export class SharedFileError extends Error {
  constructor(status, message, publicCode) {
    super(message);
    this.name = 'SharedFileError';
    this.status = status;
    if (publicCode) this.publicCode = publicCode;
  }
}

const invalid = (message) => {
  throw new SharedFileError(400, message, 'VALIDATION');
};
const notFound = () => {
  throw new SharedFileError(404, 'File not found.', 'NOT_FOUND');
};
const forbidden = () => {
  throw new SharedFileError(403, 'You do not have permission to access this resource.', 'FORBIDDEN');
};

function assertActor(actor, roles = ROLES) {
  if (!actor || !roles.includes(actor.role) || typeof actor.user_id !== 'string' || !UUID_PATTERN.test(actor.user_id)) forbidden();
}

const isUuid = (value) => typeof value === 'string' && UUID_PATTERN.test(value);

function header(request, name, max, { required = false } = {}) {
  const raw = request.headers[name];
  if (raw === undefined || raw === '') {
    if (required) invalid(`${name} is required.`);
    return null;
  }
  let value;
  try {
    value = decodeURIComponent(String(raw)).trim();
  } catch {
    invalid(`${name} is not valid.`);
  }
  if (value.length > max || /[\u0000-\u001f]/.test(value)) invalid(`${name} must be at most ${max} characters.`);
  return value || null;
}

/** A safe display name that keeps the extension the file really has. */
function fileNameOf(raw, extension) {
  const base = (raw ?? 'file').replace(/[\\/:*?"<>|]/g, '_').replace(/\.[A-Za-z0-9]{1,5}$/, '').slice(0, MAX_NAME - 5) || 'file';
  return `${base}.${extension}`;
}

/** The client record of the signed-in client for a case they are a party to, or null. */
async function clientOnCase(actor, caseId) {
  const result = await query(
    `SELECT c.client_id FROM involves i JOIN clients c ON c.client_id = i.client_id
      WHERE i.case_id = $1 AND c.user_id = $2 AND c.office_id = $3 LIMIT 1`,
    [caseId, actor.user_id, actor.office_id]
  );
  return result.rows[0]?.client_id ?? null;
}

/** Any client record of the signed-in client in this office (for a chat attachment). */
async function ownClientRecord(actor) {
  const result = await query('SELECT client_id FROM clients WHERE user_id = $1 AND office_id = $2 ORDER BY created_at LIMIT 1', [actor.user_id, actor.office_id]);
  return result.rows[0]?.client_id ?? null;
}

async function sweepUnattached(officeId) {
  const removed = await query(
    `DELETE FROM shared_files
      WHERE office_id = $1 AND purpose = 'message' AND message_id IS NULL AND created_at < NOW() - INTERVAL '${UNATTACHED_LIFETIME}'
      RETURNING storage_key`,
    [officeId]
  );
  await Promise.all(removed.rows.map((row) => files.remove(row.storage_key)));
}

const SELECT_FILE = `
  SELECT f.file_id, f.purpose, f.client_id, f.case_id, f.message_id, f.mime_type, f.file_name, f.size_bytes, f.note,
         f.status, f.moved_document_id, f.handled_at, f.created_at, f.uploaded_by_user_id, u.full_name AS uploaded_by_name,
         lc.case_number, c.full_name_or_org AS client_name
    FROM shared_files f
    JOIN app_users u ON u.user_id = f.uploaded_by_user_id
    LEFT JOIN legal_cases lc ON lc.case_id = f.case_id
    LEFT JOIN clients c ON c.client_id = f.client_id`;

export const publicFile = (row) => ({
  file_id: row.file_id,
  purpose: row.purpose,
  file_name: row.file_name,
  mime_type: row.mime_type,
  size_bytes: row.size_bytes,
  note: row.note,
  status: row.status,
  case_id: row.case_id,
  case_number: row.case_number ?? null,
  client_id: row.client_id,
  client_name: row.client_name ?? null,
  moved_document_id: row.moved_document_id,
  handled_at: row.handled_at,
  created_at: row.created_at,
  uploaded_by: { user_id: row.uploaded_by_user_id, full_name: row.uploaded_by_name },
});

/**
 * Stores a file sent as the raw request body. Headers: X-File-Name (URI-encoded), X-Purpose
 * ("portal" or "message"), and for the portal X-Case-Id and an optional X-Note.
 */
export async function uploadFile(actor, request) {
  assertActor(actor);
  officeCondition(actor, [], 'office');
  const purpose = request.headers['x-purpose'];
  if (purpose !== 'portal' && purpose !== 'message') invalid('X-Purpose must be portal or message.');
  const rawName = header(request, 'x-file-name', MAX_NAME, { required: true });
  let caseId = null;
  let clientId = null;
  let note = null;
  if (purpose === 'portal') {
    if (actor.role !== 'client') invalid('Only a client sends files from the portal.');
    caseId = request.headers['x-case-id'];
    if (!isUuid(caseId)) invalid('X-Case-Id must be one of your cases.');
    clientId = await clientOnCase(actor, caseId);
    if (!clientId) notFound();
    note = header(request, 'x-note', MAX_NOTE);
  } else if (actor.role === 'client') {
    clientId = await ownClientRecord(actor);
  }
  const buffer = await files.readBody(request);
  const type = detectReceiptType(buffer);
  if (!type) throw new SharedFileError(415, 'The file must be a PDF, PNG or JPG.', 'VALIDATION');
  const key = await files.save(buffer);
  try {
    const result = await query(
      `INSERT INTO shared_files (office_id, uploaded_by_user_id, purpose, client_id, case_id, storage_key, mime_type, file_name, size_bytes, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING file_id`,
      [actor.office_id, actor.user_id, purpose, clientId, caseId, key, type.mime, fileNameOf(rawName, type.extension), buffer.length, note]
    );
    if (purpose === 'message') sweepUnattached(actor.office_id).catch(() => {});
    const fileId = result.rows[0].file_id;
    if (purpose === 'portal') {
      auditLater(actor, { action: 'client_file.sent', entityType: 'case', entityId: caseId, details: { file_id: fileId } });
    }
    return { file: publicFile((await query(`${SELECT_FILE} WHERE f.file_id = $1`, [fileId])).rows[0]), case_id: caseId };
  } catch (error) {
    await files.remove(key);
    throw error;
  }
}

/** The actor's own chat attachment, not yet attached to a message. */
export async function assertOwnFreeFile(actor, fileId, run = query) {
  if (!isUuid(fileId)) invalid('attachment_file_id must be a valid UUID.');
  const result = await run(
    `SELECT file_id, file_name, mime_type, size_bytes FROM shared_files
      WHERE file_id = $1 AND uploaded_by_user_id = $2 AND office_id = $3 AND purpose = 'message' AND message_id IS NULL`,
    [fileId, actor.user_id, actor.office_id]
  );
  if (!result.rowCount) invalid('The attachment was not found or is already used.');
  return result.rows[0];
}

export async function attachFile(actor, fileId, messageId, run = query) {
  const result = await run(
    `UPDATE shared_files SET message_id = $4
      WHERE file_id = $1 AND uploaded_by_user_id = $2 AND office_id = $3 AND purpose = 'message' AND message_id IS NULL
      RETURNING file_id`,
    [fileId, actor.user_id, actor.office_id, messageId]
  );
  return result.rowCount > 0;
}

/** The attachment columns for a message row LEFT JOINed to shared_files as sf. */
export const ATTACHMENT_COLUMNS = 'sf.file_id AS attachment_file_id, sf.file_name AS attachment_name, sf.mime_type AS attachment_mime, sf.size_bytes AS attachment_size, sf.status AS attachment_status';

export const publicAttachment = (row) =>
  row.attachment_file_id
    ? { file_id: row.attachment_file_id, file_name: row.attachment_name, mime_type: row.attachment_mime, size_bytes: row.attachment_size, status: row.attachment_status }
    : null;

/** The rule of who may open a file, as SQL over shared_files f and messages m. Uses $2 = actor. */
function readRule(actor) {
  const message = '(m.message_id IS NOT NULL AND (m.sender_user_id = $2 OR m.receiver_user_id = $2))';
  if (actor.role === 'client') return `(f.uploaded_by_user_id = $2 OR ${message})`;
  if (actor.role === 'admin') return `(f.uploaded_by_user_id = $2 OR ${message} OR f.client_id IS NOT NULL)`;
  return `(f.uploaded_by_user_id = $2 OR ${message}
           OR (f.client_id IS NOT NULL AND f.case_id IS NOT NULL
               AND EXISTS (SELECT 1 FROM assigned_to a WHERE a.case_id = f.case_id AND a.user_id = $2)))`;
}

async function findReadable(actor, fileId) {
  if (!isUuid(fileId)) notFound();
  const parameters = [fileId, actor.user_id];
  const office = officeCondition(actor, parameters, 'f');
  const result = await query(
    `SELECT f.*, lc.case_number, c.full_name_or_org AS client_name, u.full_name AS uploaded_by_name
       FROM shared_files f
       JOIN app_users u ON u.user_id = f.uploaded_by_user_id
       LEFT JOIN messages m ON m.message_id = f.message_id AND m.office_id = f.office_id
       LEFT JOIN legal_cases lc ON lc.case_id = f.case_id
       LEFT JOIN clients c ON c.client_id = f.client_id
      WHERE f.file_id = $1 AND ${office} AND ${readRule(actor)}`,
    parameters
  );
  if (!result.rowCount) notFound();
  return result.rows[0];
}

export async function readFile(actor, fileId) {
  assertActor(actor);
  const row = await findReadable(actor, fileId);
  const stored = await files.read(row.storage_key);
  return { buffer: stored.buffer, mime: row.mime_type, fileName: row.file_name };
}

/** The files a client sent the office for a case, newest first. Staff on the case only. */
export async function listCaseIncoming(actor, caseId) {
  assertActor(actor, STAFF);
  if (!isUuid(caseId)) invalid('caseId must be a valid UUID.');
  const parameters = [caseId, actor.user_id];
  const office = officeCondition(actor, parameters, 'f');
  const access = actor.role === 'admin' ? 'TRUE' : 'EXISTS (SELECT 1 FROM assigned_to a WHERE a.case_id = f.case_id AND a.user_id = $2)';
  const result = await query(
    `${SELECT_FILE}
      WHERE f.case_id = $1 AND f.client_id IS NOT NULL AND f.purpose = 'portal' AND ${office} AND ${access}
        AND $2::uuid IS NOT NULL
      ORDER BY (f.status = 'new') DESC, f.created_at DESC
      LIMIT 100`,
    parameters
  );
  return { files: result.rows.map(publicFile) };
}

/** What the signed-in client has sent, newest first. */
export async function listMyFiles(actor) {
  assertActor(actor, ['client']);
  const parameters = [actor.user_id];
  const office = officeCondition(actor, parameters, 'f');
  const result = await query(
    `${SELECT_FILE} WHERE f.uploaded_by_user_id = $1 AND f.purpose = 'portal' AND ${office} ORDER BY f.created_at DESC LIMIT 100`,
    parameters
  );
  return { files: result.rows.map(publicFile) };
}

/** A photo on an A4 page, scaled to fit with a margin; a PDF is kept as it is. */
export async function asPdf(buffer, mime) {
  if (mime === 'application/pdf') return buffer;
  const pdf = await PDFDocument.create();
  const image = mime === 'image/png' ? await pdf.embedPng(buffer) : await pdf.embedJpg(buffer);
  const page = pdf.addPage([595.28, 841.89]);
  const margin = 28;
  const scale = Math.min((page.getWidth() - margin * 2) / image.width, (page.getHeight() - margin * 2) / image.height, 1);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, { x: (page.getWidth() - width) / 2, y: (page.getHeight() - height) / 2, width, height });
  return Buffer.from(await pdf.save());
}

/**
 * Stores a client's file among a case's documents, through the same upload as any document, so
 * every check of case documents applies. The file is then marked as moved.
 */
export async function moveToCase(actor, fileId, body) {
  assertActor(actor, STAFF);
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('A JSON object is required.');
  const unknown = Object.keys(body).filter((key) => !['case_id', 'document_type'].includes(key));
  if (unknown.length) invalid(`Unknown fields: ${unknown.join(', ')}.`);
  const row = await findReadable(actor, fileId);
  if (!row.client_id) invalid('Only a file the client sent can be moved to the case documents.');
  if (row.status !== 'new') throw new SharedFileError(409, 'This file was already handled.', 'FILE_HANDLED');
  const caseId = body.case_id ?? row.case_id;
  if (!isUuid(caseId)) invalid('case_id is required.');
  const documentType = (
    typeof body.document_type === 'string' && body.document_type.trim()
      ? body.document_type.trim()
      : `من الموكّل: ${row.file_name.replace(/\.[A-Za-z0-9]+$/, '')}`
  ).slice(0, 50);
  const stored = await files.read(row.storage_key);
  let pdf;
  try {
    pdf = await asPdf(stored.buffer, row.mime_type);
  } catch {
    throw new SharedFileError(422, 'The image could not be converted to PDF.', 'VALIDATION');
  }
  // Case documents take Latin file names only; the client's own name stays in the document type.
  const name = `client-${new Date().toISOString().slice(0, 10)}-${fileId.slice(0, 8)}.pdf`;
  const request = Object.assign(Readable.from([pdf]), {
    headers: {
      'content-type': 'application/pdf',
      'content-length': String(pdf.length),
      'x-document-file-name': encodeURIComponent(name),
      'x-document-type': encodeURIComponent(documentType),
      'x-document-source': encodeURIComponent('الموكّل'),
      'x-document-access-level': 'case_team',
      'x-document-client-id': row.client_id,
    },
  });
  const document = await uploadDocument(actor, caseId, request);
  const updated = await query(
    `UPDATE shared_files SET status = 'moved', moved_document_id = $3, case_id = $4, handled_by_user_id = $5, handled_at = NOW()
      WHERE file_id = $1 AND office_id = $2 AND status = 'new'
      RETURNING file_id`,
    [fileId, actor.office_id, document.document_id, caseId, actor.user_id]
  );
  if (!updated.rowCount) throw new SharedFileError(409, 'This file was already handled.', 'FILE_HANDLED');
  auditLater(actor, { action: 'client_file.moved', entityType: 'case', entityId: caseId, details: { file_id: fileId, document_id: document.document_id } });
  return { document, file_id: fileId };
}

export async function dismissFile(actor, fileId) {
  assertActor(actor, STAFF);
  const row = await findReadable(actor, fileId);
  if (!row.client_id) invalid('Only a file the client sent can be set aside.');
  const updated = await query(
    `UPDATE shared_files SET status = 'dismissed', handled_by_user_id = $3, handled_at = NOW()
      WHERE file_id = $1 AND office_id = $2 AND status = 'new' RETURNING file_id`,
    [fileId, actor.office_id, actor.user_id]
  );
  if (!updated.rowCount) throw new SharedFileError(409, 'This file was already handled.', 'FILE_HANDLED');
  return { dismissed: true };
}
