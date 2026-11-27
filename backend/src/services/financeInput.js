import { query } from '../config/db.js';

/**
 * Input checks and errors shared by the office-finance services (accounts, expenses, custodies).
 * Amounts have at most two decimals; dates are calendar days (YYYY-MM-DD).
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const CURRENCIES = ['ILS', 'JOD', 'USD'];
const MAX_AMOUNT = 9_999_999_999.99;

export class OfficeFinanceError extends Error {
  constructor(status, message, publicCode) {
    super(message);
    this.name = 'OfficeFinanceError';
    this.status = status;
    if (publicCode) this.publicCode = publicCode;
  }
}

export const invalid = (message) => {
  throw new OfficeFinanceError(400, message, 'VALIDATION');
};
export const notFound = (what = 'Record') => {
  throw new OfficeFinanceError(404, `${what} not found.`, 'NOT_FOUND');
};
export const forbidden = () => {
  throw new OfficeFinanceError(403, 'You do not have permission to access this resource.', 'FORBIDDEN');
};

export function assertActor(actor, roles) {
  if (!actor || !roles.includes(actor.role) || typeof actor.user_id !== 'string' || !UUID_PATTERN.test(actor.user_id)) {
    forbidden();
  }
}

export function assertBody(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Request body must be a JSON object.');
  if (Object.keys(body).some((field) => !allowed.includes(field))) invalid('Request contains unsupported fields.');
}

export const uuid = (value, field) => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) invalid(`${field} must be a valid UUID.`);
  return value;
};

export const optionalUuid = (value, field) => (value === undefined || value === null || value === '' ? null : uuid(value, field));

/** A positive amount with at most two decimals (or zero and negatives when `allowZero`/`signed`). */
export function amount(value, field = 'amount', { allowZero = false, signed = false } = {}) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number) || Math.abs(number) > MAX_AMOUNT) invalid(`${field} must be a number.`);
  if (!signed && (number < 0 || (!allowZero && number === 0))) invalid(`${field} must be a positive number.`);
  if (Math.round(number * 100) !== Number((number * 100).toFixed(6))) invalid(`${field} may have at most two decimal places.`);
  return Math.round(number * 100) / 100;
}

export function date(value, field, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) invalid(`${field} is required.`);
    return null;
  }
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)
    || Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    invalid(`${field} must be a date (YYYY-MM-DD).`);
  }
  return value;
}

export function text(value, field, max, { required = false } = {}) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    if (required) invalid(`${field} is required.`);
    return null;
  }
  if (typeof value !== 'string' || value.trim().length > max) invalid(`${field} must contain at most ${max} characters.`);
  return value.trim();
}

export function positiveInteger(value, fallback, field) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    invalid(`${field} must be a positive integer.`);
  }
  return Number(value);
}

/** A from/to range of calendar days, at most `maxDays` apart; `to` may not come before `from`. */
export function dayRange(parameters, { maxDays = 731 } = {}) {
  const from = date(parameters.from, 'from');
  const to = date(parameters.to, 'to');
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (span < 0) invalid('to must not be before from.');
  if (span > maxDays) invalid(`The range may cover at most ${maxDays} days.`);
  return { from, to };
}

export const money = (value) => (value === null || value === undefined ? 0 : Math.round(Number(value) * 100) / 100);

// PostgreSQL refuses values a statement never uses, so only the used ones are sent.
function usedParameters(sql, parameters) {
  const highest = Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])));
  return parameters.slice(0, highest);
}

export async function execute(sql, parameters = []) {
  try {
    return await query(sql, usedParameters(sql, parameters));
  } catch (error) {
    if (error?.code === '23505') throw new OfficeFinanceError(409, 'This record conflicts with an existing one.', 'DUPLICATE');
    if (['23502', '23503', '23514', '22001', '22003', '22007', '22008', '22P02'].includes(error?.code)) {
      invalid('Finance data violates a database constraint.');
    }
    throw error;
  }
}
