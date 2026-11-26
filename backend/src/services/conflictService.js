import { query } from '../config/db.js';
import { officeCondition } from './officeScope.js';

/**
 * Conflict-of-interest check. Before the office takes on a new client (or records a new opposing
 * party), the person is compared with everyone the office already knows inside the same office:
 *
 *   - its clients, and the cases they are part of;
 *   - the opposing parties recorded on its cases.
 *
 * A new client who matches an opposing party, or a new opposing party who matches a client, is a
 * conflict. A new client who matches an existing client is reported as already known.
 *
 * Matching: ID numbers exactly, phone numbers by their last nine digits, and names after Arabic
 * spelling is normalised (hamza forms, taa marbuta, alif maqsura, diacritics), either equal or
 * with every word of a two-or-more-word name found in the other name.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Upper bound on the records read for one check; far above an office's size. */
const MAX_CANDIDATES = 5000;

export class ConflictServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ConflictServiceError';
    this.status = status;
  }
}

export function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[ً-ٰٟـ]/g, '') // diacritics and tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const digitsOf = (value) => String(value ?? '').replace(/\D/g, '');

export function namesMatch(a, b) {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const leftWords = left.split(' ');
  const rightWords = right.split(' ');
  const [shorter, longer] = leftWords.length <= rightWords.length ? [leftWords, new Set(rightWords)] : [rightWords, new Set(leftWords)];
  return shorter.length >= 2 && shorter.every((word) => longer.has(word));
}

export function phonesMatch(a, b) {
  const left = digitsOf(a);
  const right = digitsOf(b);
  return left.length >= 7 && right.length >= 7 && left.slice(-9) === right.slice(-9);
}

export function idsMatch(a, b) {
  const left = String(a ?? '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  const right = String(b ?? '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  return left.length >= 4 && left === right;
}

function matchedOn(input, record) {
  const reasons = [];
  if (input.national_id && idsMatch(input.national_id, record.national_id)) reasons.push('national_id');
  if (input.phone && phonesMatch(input.phone, record.phone)) reasons.push('phone');
  if (input.name && namesMatch(input.name, record.name)) reasons.push('name');
  return reasons;
}

function readInput(queryParameters) {
  const text = (value, max) => {
    if (value === undefined) return '';
    if (typeof value !== 'string' || value.length > max) {
      throw new ConflictServiceError(400, 'Conflict check parameters are invalid.');
    }
    return value.trim();
  };
  const input = {
    name: text(queryParameters.name, 200),
    national_id: text(queryParameters.national_id, 30),
    phone: text(queryParameters.phone, 30),
  };
  const role = queryParameters.role ?? 'client';
  if (role !== 'client' && role !== 'opponent') {
    throw new ConflictServiceError(400, 'role must be client or opponent.');
  }
  const exclude = queryParameters.exclude_client_id;
  if (exclude !== undefined && (typeof exclude !== 'string' || !UUID_PATTERN.test(exclude))) {
    throw new ConflictServiceError(400, 'exclude_client_id must be a valid UUID.');
  }
  if (!input.name && !input.national_id && !input.phone) {
    throw new ConflictServiceError(400, 'Provide a name, an ID number or a phone number.');
  }
  return { input, role, exclude };
}

/**
 * Checks one person against the office. `role` says what the person would become: a new
 * `client` (default) or a new `opponent`. Office administrators only, since they take on clients.
 */
export async function checkConflicts(actor, queryParameters = {}, run = query) {
  if (!actor || actor.role !== 'admin') {
    throw new ConflictServiceError(403, 'You do not have permission to access this resource.');
  }
  const { input, role, exclude } = readInput(queryParameters);

  const clientParameters = [];
  const clientScope = officeCondition(actor, clientParameters, 'c');
  clientParameters.push(MAX_CANDIDATES);
  const clients = await run(
    `SELECT c.client_id AS id, c.full_name_or_org AS name, c.national_id, c.phone,
            COALESCE(json_agg(json_build_object(
              'case_id', lc.case_id, 'case_number', lc.case_number, 'title', lc.title, 'party_role', i.party_role
            ) ORDER BY lc.opened_at DESC) FILTER (WHERE lc.case_id IS NOT NULL), '[]') AS cases
       FROM clients c
       LEFT JOIN involves i ON i.client_id = c.client_id
       LEFT JOIN legal_cases lc ON lc.case_id = i.case_id
      WHERE ${clientScope}
      GROUP BY c.client_id
      LIMIT $${clientParameters.length}`,
    clientParameters
  );

  const opponentParameters = [];
  const opponentScope = officeCondition(actor, opponentParameters, 'o');
  opponentParameters.push(MAX_CANDIDATES);
  const opponents = await run(
    `SELECT o.opponent_id AS id, o.full_name AS name, o.national_id, o.phone,
            json_build_array(json_build_object(
              'case_id', lc.case_id, 'case_number', lc.case_number, 'title', lc.title, 'party_role', 'opponent'
            )) AS cases
       FROM case_opponents o
       JOIN legal_cases lc ON lc.case_id = o.case_id
      WHERE ${opponentScope}
      LIMIT $${opponentParameters.length}`,
    opponentParameters
  );

  const matches = [];
  for (const record of clients.rows) {
    if (exclude && record.id === exclude) continue;
    const reasons = matchedOn(input, record);
    if (reasons.length) {
      matches.push({ source: 'client', id: record.id, name: record.name, matched_on: reasons, cases: record.cases, conflict: role === 'opponent' });
    }
  }
  for (const record of opponents.rows) {
    const reasons = matchedOn(input, record);
    if (reasons.length) {
      matches.push({ source: 'opponent', id: record.id, name: record.name, matched_on: reasons, cases: record.cases, conflict: role === 'client' });
    }
  }
  // Conflicts first, then the strongest evidence (ID number, then phone, then name).
  const weight = (match) => (match.conflict ? 100 : 0) + (match.matched_on.includes('national_id') ? 10 : 0) + (match.matched_on.includes('phone') ? 5 : 0) + match.matched_on.length;
  matches.sort((a, b) => weight(b) - weight(a));
  return { conflict: matches.some((match) => match.conflict), matches: matches.slice(0, 20) };
}
