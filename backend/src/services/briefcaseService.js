import { query } from '../config/db.js';
import { getClientById } from './clientService.js';
import { listAgreements } from './feeAgreementService.js';
import { clientStatement } from './financeService.js';

/**
 * The client's briefcase (حقيبة الموكّل): everything about one client on one screen.
 *
 *   everyone on the office staff who may open the client   their cases (with stage and next
 *       hearing), the actor's own recent messages with them, the files they sent, the documents
 *       shared with them, and the official notices sent to them
 *   the office admin only   the money: balances per currency, fee agreements and installments
 *
 * A lawyer or assistant sees only the cases assigned to them, as everywhere else.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF = ['admin', 'lawyer', 'assistant'];
const LIMIT = 20;

export class BriefcaseError extends Error {
  constructor(status, message, publicCode) {
    super(message);
    this.name = 'BriefcaseError';
    this.status = status;
    if (publicCode) this.publicCode = publicCode;
  }
}

export async function clientBriefcase(actor, clientId) {
  if (!actor || !STAFF.includes(actor.role) || typeof actor.user_id !== 'string' || !UUID_PATTERN.test(actor.user_id)) {
    throw new BriefcaseError(403, 'You do not have permission to access this resource.', 'FORBIDDEN');
  }
  if (typeof clientId !== 'string' || !UUID_PATTERN.test(clientId)) throw new BriefcaseError(400, 'clientId must be a valid UUID.', 'VALIDATION');
  // Not visible to the actor → 404, as on the client's own page.
  const client = await getClientById(actor, clientId);
  const admin = actor.role === 'admin';
  const caseScope = admin ? 'TRUE' : 'EXISTS (SELECT 1 FROM assigned_to a WHERE a.case_id = lc.case_id AND a.user_id = $3)';

  const [cases, account, files, documents, notices] = await Promise.all([
    query(
      `SELECT lc.case_id, lc.case_number, lc.title, lc.status, lc.stage, lc.opened_at,
              (SELECT MIN(h.hearing_at) FROM hearings h WHERE h.case_id = lc.case_id AND h.status = 'scheduled' AND h.hearing_at >= NOW()) AS next_hearing_at
         FROM involves i JOIN legal_cases lc ON lc.case_id = i.case_id
        WHERE i.client_id = $1 AND lc.office_id = $2 AND ${caseScope} AND $3::uuid IS NOT NULL
        ORDER BY (lc.status IN ('closed', 'cancelled')), lc.opened_at DESC`,
      [clientId, actor.office_id, actor.user_id]
    ),
    query('SELECT user_id FROM clients WHERE client_id = $1 AND office_id = $2', [clientId, actor.office_id]),
    query(
      `SELECT f.file_id, f.purpose, f.file_name, f.mime_type, f.size_bytes, f.note, f.status, f.created_at, lc.case_number
         FROM shared_files f LEFT JOIN legal_cases lc ON lc.case_id = f.case_id
        WHERE f.client_id = $1 AND f.office_id = $2
          AND (${admin ? 'TRUE' : `(f.case_id IS NOT NULL AND EXISTS (SELECT 1 FROM assigned_to a WHERE a.case_id = f.case_id AND a.user_id = $3))`})
          AND $3::uuid IS NOT NULL
        ORDER BY f.created_at DESC LIMIT ${LIMIT}`,
      [clientId, actor.office_id, actor.user_id]
    ),
    query(
      `SELECT d.document_id, d.file_name, d.document_type, d.created_at, lc.case_number
         FROM documents d JOIN legal_cases lc ON lc.case_id = d.case_id
        WHERE d.client_id = $1 AND d.office_id = $2 AND ${caseScope} AND $3::uuid IS NOT NULL
        ORDER BY d.created_at DESC LIMIT ${LIMIT}`,
      [clientId, actor.office_id, actor.user_id]
    ),
    query(
      `SELECT n.notice_id, n.kind, n.title, n.sent_at, n.acknowledged_at, lc.case_number
         FROM official_notices n JOIN legal_cases lc ON lc.case_id = n.case_id
        WHERE n.client_id = $1 AND n.office_id = $2 AND ${caseScope} AND $3::uuid IS NOT NULL
        ORDER BY n.sent_at DESC LIMIT ${LIMIT}`,
      [clientId, actor.office_id, actor.user_id]
    ),
  ]);

  // The actor's own conversation with the client: messages are always between two people.
  const clientUserId = account.rows[0]?.user_id ?? null;
  const thread = clientUserId
    ? await query(
        `SELECT m.message_id, m.body, m.sent_at, m.sender_user_id,
                EXISTS (SELECT 1 FROM voice_clips v WHERE v.message_id = m.message_id) AS has_voice,
                EXISTS (SELECT 1 FROM shared_files sf WHERE sf.message_id = m.message_id) AS has_attachment
           FROM messages m
          WHERE m.office_id = $1
            AND ((m.sender_user_id = $2 AND m.receiver_user_id = $3) OR (m.sender_user_id = $3 AND m.receiver_user_id = $2))
          ORDER BY m.sent_at DESC LIMIT 5`,
        [actor.office_id, actor.user_id, clientUserId]
      )
    : { rows: [] };

  let money = null;
  if (admin) {
    const [statement, agreements] = await Promise.all([clientStatement(actor, clientId), listAgreements(actor, { clientId })]);
    money = { currencies: statement.statement?.currencies ?? statement.currencies ?? [], agreements: agreements.agreements };
  }

  return {
    client,
    has_portal: clientUserId !== null,
    client_user_id: clientUserId,
    cases: cases.rows,
    messages: thread.rows.map((row) => ({ ...row, mine: row.sender_user_id === actor.user_id })),
    files: files.rows,
    documents: documents.rows,
    notices: notices.rows,
    money,
  };
}
