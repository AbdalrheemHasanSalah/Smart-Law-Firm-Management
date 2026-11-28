import { createHash, randomInt } from 'node:crypto';
import { query } from '../config/db.js';
import { auditLater } from './auditService.js';
import { officeCondition } from './officeScope.js';
import { createFileStore, detectReceiptType } from './receiptStorage.js';

/**
 * The unified print engine's server side.
 *
 *   letterhead   what every printed page of the office carries: logo, name, contact lines, footer
 *   issuing      each printed document gets a SHA-256 fingerprint of its exact text and a short
 *                verification code; the paper shows both, with a QR code to the public check
 *   verifying    anyone with the code learns only whether it is valid or revoked, which office
 *                issued it, when, and what kind of document it is: never its content or names
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF = ['admin', 'lawyer', 'assistant'];
export const ISSUED_KINDS = ['contract', 'pleading', 'letter', 'other', 'statement', 'hearing_prep', 'analysis', 'invoice', 'report'];
/** No 0/O, 1/I/L: a code is read from paper and typed by hand. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
const MAX_CONTENT = 500_000;

const logos = createFileStore({ folder: 'letterhead-logos', noun: 'logo', maxBytes: 1024 * 1024 });

export class PrintError extends Error {
  constructor(status, message, publicCode) {
    super(message);
    this.name = 'PrintError';
    this.status = status;
    if (publicCode) this.publicCode = publicCode;
  }
}

const invalid = (message) => {
  throw new PrintError(400, message, 'VALIDATION');
};
const forbidden = () => {
  throw new PrintError(403, 'You do not have permission to access this resource.', 'FORBIDDEN');
};
const notFound = () => {
  throw new PrintError(404, 'Not found.', 'NOT_FOUND');
};

function assertStaff(actor) {
  if (!actor || !STAFF.includes(actor.role) || typeof actor.user_id !== 'string' || !UUID_PATTERN.test(actor.user_id)) forbidden();
}

/* ───────────────────────── letterhead ───────────────────────── */

const LETTERHEAD_FIELDS = { display_name: 200, subtitle: 200, address: 500, phone: 60, email: 254, license_number: 100, footer_text: 500 };

/** The office's letterhead, with its registered details filling any line it leaves empty. */
export async function getLetterhead(actor) {
  assertStaff(actor);
  const parameters = [];
  const office = officeCondition(actor, parameters, 'o');
  const result = await query(
    `SELECT o.name, o.phone AS office_phone, o.email AS office_email, o.address AS office_address, o.license_number AS office_license,
            l.display_name, l.subtitle, l.address, l.phone, l.email, l.license_number, l.footer_text, l.logo_key, l.updated_at
       FROM law_offices o LEFT JOIN office_letterheads l ON l.office_id = o.office_id
      WHERE ${office}`,
    parameters
  );
  if (!result.rowCount) notFound();
  const row = result.rows[0];
  return {
    letterhead: {
      // What the admin saved (null where they left the registered value).
      saved: Object.fromEntries(Object.keys(LETTERHEAD_FIELDS).map((field) => [field, row[field] ?? null])),
      // What prints.
      display_name: row.display_name || row.name,
      subtitle: row.subtitle || null,
      address: row.address || row.office_address || null,
      phone: row.phone || row.office_phone || null,
      email: row.email || row.office_email || null,
      license_number: row.license_number || row.office_license || null,
      footer_text: row.footer_text || null,
      has_logo: Boolean(row.logo_key),
      updated_at: row.updated_at ?? null,
    },
  };
}

export async function saveLetterhead(actor, body) {
  assertStaff(actor);
  if (actor.role !== 'admin') forbidden();
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('A JSON object is required.');
  const unknown = Object.keys(body).filter((key) => !Object.hasOwn(LETTERHEAD_FIELDS, key));
  if (unknown.length) invalid(`Unknown fields: ${unknown.join(', ')}.`);
  const values = Object.entries(LETTERHEAD_FIELDS).map(([field, max]) => {
    const value = body[field];
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string' || value.trim().length > max) invalid(`${field} must be text of at most ${max} characters.`);
    return value.trim() || null;
  });
  if (values[4] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values[4])) invalid('email is not valid.');
  officeCondition(actor, [], 'office');
  await query(
    `INSERT INTO office_letterheads (office_id, display_name, subtitle, address, phone, email, license_number, footer_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (office_id) DO UPDATE
       SET display_name = EXCLUDED.display_name, subtitle = EXCLUDED.subtitle, address = EXCLUDED.address,
           phone = EXCLUDED.phone, email = EXCLUDED.email, license_number = EXCLUDED.license_number,
           footer_text = EXCLUDED.footer_text, updated_at = NOW()`,
    [actor.office_id, ...values]
  );
  auditLater(actor, { action: 'letterhead.updated', entityType: 'office', entityId: actor.office_id, details: {} });
  return getLetterhead(actor);
}

/** A PNG or JPG logo up to 1 MB, sent as the raw request body. */
export async function attachLetterheadLogo(actor, request) {
  assertStaff(actor);
  if (actor.role !== 'admin') forbidden();
  officeCondition(actor, [], 'office');
  const buffer = await logos.readBody(request);
  const type = detectReceiptType(buffer);
  if (!type || type.extension === 'pdf') throw new PrintError(415, 'The logo must be a PNG or JPG image.', 'VALIDATION');
  const key = await logos.save(buffer);
  let previous = null;
  try {
    const result = await query(
      `INSERT INTO office_letterheads (office_id, logo_key) VALUES ($1, $2)
       ON CONFLICT (office_id) DO UPDATE SET logo_key = EXCLUDED.logo_key, updated_at = NOW()
       RETURNING (SELECT logo_key FROM office_letterheads WHERE office_id = $1) AS previous_key`,
      [actor.office_id, key]
    );
    previous = result.rows[0]?.previous_key ?? null;
  } catch (error) {
    await logos.remove(key);
    throw error;
  }
  if (previous && previous !== key) await logos.remove(previous);
  return { has_logo: true };
}

export async function removeLetterheadLogo(actor) {
  assertStaff(actor);
  if (actor.role !== 'admin') forbidden();
  const result = await query(
    `UPDATE office_letterheads SET logo_key = NULL, updated_at = NOW()
      WHERE office_id = $1 RETURNING (SELECT logo_key FROM office_letterheads WHERE office_id = $1) AS previous_key`,
    [actor.office_id]
  );
  const previous = result.rows[0]?.previous_key;
  if (previous) await logos.remove(previous);
  return { has_logo: false };
}

export async function readLetterheadLogo(actor) {
  assertStaff(actor);
  const parameters = [];
  const office = officeCondition(actor, parameters, 'l');
  const result = await query(`SELECT l.logo_key FROM office_letterheads l WHERE ${office}`, parameters);
  if (!result.rows[0]?.logo_key) notFound();
  return logos.read(result.rows[0].logo_key);
}

/* ───────────────────────── issuing and verifying ───────────────────────── */

export const fingerprintOf = (content) => createHash('sha256').update(String(content).normalize('NFC'), 'utf8').digest('hex');

const newCode = () => Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

/** Records a printed document and returns its verification code. Retries the rare code clash. */
export async function issueDocument(actor, { kind, content, draftId = null }) {
  if (!ISSUED_KINDS.includes(kind)) invalid('kind is not supported.');
  const fingerprint = fingerprintOf(content);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const result = await query(
        `INSERT INTO issued_documents (office_id, code, kind, content_sha256, draft_id, issued_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING code, issued_at, content_sha256`,
        [actor.office_id, newCode(), kind, fingerprint, draftId, actor.user_id]
      );
      return { code: result.rows[0].code, issued_at: result.rows[0].issued_at, fingerprint: result.rows[0].content_sha256 };
    } catch (error) {
      if (error?.code !== '23505' || attempt === 4) throw error;
    }
  }
  throw new PrintError(500, 'Could not issue a code.');
}

export async function revokeIssued(actor, { draftId }) {
  await query('UPDATE issued_documents SET revoked_at = NOW() WHERE draft_id = $1 AND office_id = $2 AND revoked_at IS NULL', [draftId, actor.office_id]);
}

/**
 * A print from a screen (a statement, a hearing sheet, an analysis): the text as printed is
 * fingerprinted here, and the code returned is printed on it. The text itself is not stored.
 */
export async function registerPrint(actor, body) {
  assertStaff(actor);
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('A JSON object is required.');
  const unknown = Object.keys(body).filter((key) => !['kind', 'content'].includes(key));
  if (unknown.length) invalid(`Unknown fields: ${unknown.join(', ')}.`);
  if (typeof body.content !== 'string' || !body.content.trim() || body.content.length > MAX_CONTENT) invalid(`content must be the printed text, at most ${MAX_CONTENT} characters.`);
  officeCondition(actor, [], 'office');
  const issued = await issueDocument(actor, { kind: body.kind, content: body.content.trim() });
  auditLater(actor, { action: 'document.printed', entityType: 'office', entityId: actor.office_id, details: { kind: body.kind, code: issued.code } });
  return issued;
}

/** The public check behind the QR code: valid or revoked, office, date and kind. Nothing else. */
export async function verifyCode(codeValue) {
  const code = typeof codeValue === 'string' ? codeValue.trim().toUpperCase() : '';
  if (!CODE_PATTERN.test(code)) return { status: 'not_found' };
  const result = await query(
    `SELECT i.kind, i.issued_at, i.revoked_at, o.name AS office_name
       FROM issued_documents i JOIN law_offices o ON o.office_id = i.office_id
      WHERE i.code = $1`,
    [code]
  );
  if (!result.rowCount) return { status: 'not_found' };
  const row = result.rows[0];
  return { status: row.revoked_at ? 'revoked' : 'valid', office_name: row.office_name, kind: row.kind, issued_at: row.issued_at, revoked_at: row.revoked_at };
}
