const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tenant isolation helpers. Every business query runs inside the office that
 * requireOfficeContext resolved from the server-side session, never from a
 * client-supplied office ID.
 */
export function hasOfficeContext(actor) {
  return typeof actor?.office_id === 'string' && UUID_PATTERN.test(actor.office_id);
}

export function officeCondition(actor, parameters, alias) {
  if (!hasOfficeContext(actor)) {
    const error = new Error('An active office is required for this request.');
    error.status = 403;
    error.publicCode = 'NO_ACTIVE_OFFICE';
    throw error;
  }
  parameters.push(actor.office_id);
  return `${alias}.office_id = $${parameters.length}`;
}
