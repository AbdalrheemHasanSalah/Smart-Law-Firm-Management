import { auditLater } from './auditService.js';
import { assertActor, assertBody, execute, invalid, notFound, optionalUuid, uuid } from './financeInput.js';
import { notifyLater } from './notificationService.js';
import { officeCondition } from './officeScope.js';

/**
 * Sharing a case document with one of the case's clients after it was uploaded, or stopping.
 *
 * A shared document has the "authorized_users" access level and names the client who sees it in
 * their portal; that client must be a party to the document's case. Stopping returns it to the
 * case team. The administrator may do this for any document of the office; a lawyer or assistant
 * for documents of cases assigned to them that they can already see.
 */

const STAFF = ['admin', 'lawyer', 'assistant'];

export async function setDocumentSharing(actor, documentId, body) {
  assertActor(actor, STAFF);
  uuid(documentId, 'documentId');
  assertBody(body, ['shared', 'client_id']);
  if (typeof body.shared !== 'boolean') invalid('shared must be true or false.');
  const clientId = body.shared ? optionalUuid(body.client_id, 'client_id') : null;
  if (body.shared && !clientId) invalid('Choose the client to share the document with.');
  if (!body.shared && body.client_id !== undefined && body.client_id !== null) invalid('client_id applies to sharing only.');

  const parameters = [documentId, clientId];
  const office = officeCondition(actor, parameters, 'd');
  let mine = '';
  if (actor.role !== 'admin') {
    parameters.push(actor.user_id);
    const me = `$${parameters.length}`;
    mine = `AND (d.access_level IN ('case_team', 'authorized_users') OR d.user_id = ${me})
            AND EXISTS (SELECT 1 FROM assigned_to mine WHERE mine.case_id = d.case_id AND mine.user_id = ${me})`;
  }
  const change = body.shared
    ? `access_level = 'authorized_users', client_id = $2::uuid`
    : `access_level = 'case_team', client_id = NULL`;
  const condition = body.shared
    ? `AND EXISTS (SELECT 1 FROM involves party WHERE party.case_id = d.case_id AND party.office_id = d.office_id AND party.client_id = $2::uuid)`
    : `AND d.access_level = 'authorized_users' AND $2::uuid IS NULL`;
  const result = await execute(
    `UPDATE documents d SET ${change}
      WHERE d.document_id = $1 AND ${office} ${mine} ${condition}
     RETURNING d.document_id, d.case_id, d.client_id, d.access_level`,
    parameters
  );
  if (!result.rowCount) {
    if (body.shared) invalid('The document must be one you can see, and the client a party to its case.');
    notFound('Shared document');
  }
  const document = result.rows[0];
  if (body.shared) {
    notifyLater('case.document_shared', { officeId: actor.office_id, caseId: document.case_id, clientId, actorUserId: actor.user_id });
  }
  auditLater(actor, {
    action: body.shared ? 'document_shared' : 'document_unshared',
    entityType: 'case',
    entityId: document.case_id,
    details: {},
  });
  return { document };
}
