import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { mkdir, open, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { query } from '../config/db.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORAGE_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i;
const STATUSES = ['draft', 'under_review', 'approved', 'signed', 'archived'];
const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_CONFIGURED_UPLOAD_BYTES = 50 * 1024 * 1024;
const SERVICE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIRECTORY = process.env.DOCUMENT_STORAGE_DIR
  ? path.resolve(process.env.DOCUMENT_STORAGE_DIR)
  : path.resolve(SERVICE_DIRECTORY, '../../private-documents');
const PUBLIC_DIRECTORY_CANDIDATES = [
  path.resolve(SERVICE_DIRECTORY, '../../../frontend/public'),
  path.resolve(SERVICE_DIRECTORY, '../../public'),
  path.resolve(SERVICE_DIRECTORY, '../../uploads'),
];
const PUBLIC_FIELDS = [
  'contract_id',
  'title',
  'contract_type',
  'status',
  'created_at',
  'client_id',
  'case_id',
];

export class ContractServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ContractServiceError';
    this.status = status;
  }
}

function invalid(message) {
  throw new ContractServiceError(400, message);
}

function validateUuid(value, field) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    invalid(`${field} must be a valid UUID.`);
  }
  return value;
}

function assertActor(actor, roles) {
  if (!actor || !roles.includes(actor.role)) {
    throw new ContractServiceError(403, 'You do not have permission to access this resource.');
  }
  validateUuid(actor.user_id, 'Authenticated user ID');
}

function publicContract(row) {
  return Object.fromEntries(PUBLIC_FIELDS.map((field) => [field, row[field]]));
}

function accessScope(actor, parameters, alias = 'c') {
  if (actor.role === 'admin') return '';

  parameters.push(actor.user_id);
  const userParameter = `$${parameters.length}`;
  if (actor.role === 'client') {
    return `AND ${alias}.client_id IN (
      SELECT client_id FROM clients WHERE user_id = ${userParameter}
    )`;
  }
  if (actor.role === 'lawyer' || actor.role === 'assistant') {
    return `AND ${alias}.case_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM assigned_to assignment
        WHERE assignment.case_id = ${alias}.case_id
          AND assignment.user_id = ${userParameter}
      )`;
  }
  throw new ContractServiceError(403, 'You do not have permission to access this resource.');
}

function mapDatabaseError(error) {
  if (error?.code === '23505') {
    throw new ContractServiceError(409, 'A contract record conflicts with existing data.');
  }
  if (['23502', '23503', '23514', '22001', '22007', '22P02'].includes(error?.code)) {
    throw new ContractServiceError(400, 'Contract data violates a database constraint.');
  }
  throw error;
}

async function execute(text, parameters) {
  try {
    return await query(text, parameters);
  } catch (error) {
    return mapDatabaseError(error);
  }
}

function parsePositiveInteger(value, fallback, field) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    invalid(`${field} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    invalid(`${field} must be a positive integer.`);
  }
  return parsed;
}

function parseListOptions(parameters = {}) {
  const allowed = new Set(['page', 'pageSize', 'search', 'clientId', 'caseId', 'status']);
  if (!parameters || typeof parameters !== 'object'
    || Object.keys(parameters).some((key) => !allowed.has(key))) {
    invalid('Unsupported contract-list query parameter.');
  }
  const page = parsePositiveInteger(parameters.page, 1, 'page');
  const pageSize = Math.min(parsePositiveInteger(parameters.pageSize, 20, 'pageSize'), 50);
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) invalid('page is too large.');
  const clientId = parameters.clientId === undefined
    ? undefined
    : validateUuid(parameters.clientId, 'clientId');
  const caseId = parameters.caseId === undefined
    ? undefined
    : validateUuid(parameters.caseId, 'caseId');
  const status = parameters.status;
  if (status !== undefined && !STATUSES.includes(status)) {
    invalid('status is not a supported contract status.');
  }
  let search = '';
  if (parameters.search !== undefined) {
    if (typeof parameters.search !== 'string') invalid('search must be a string.');
    search = parameters.search.trim();
    if (search.length > 100) invalid('search must contain at most 100 characters.');
  }
  return { page, pageSize, offset, clientId, caseId, status, search };
}

function parseMetadataValue(value, field, maxLength) {
  if (typeof value !== 'string') invalid(`${field} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    invalid(`${field} must contain 1 to ${maxLength} characters.`);
  }
  return normalized;
}

async function assertPrivateStorageDirectory({ create = false } = {}) {
  const resolved = path.resolve(STORAGE_DIRECTORY);
  const comparable = (value) => process.platform === 'win32'
    ? value.toLowerCase()
    : value;
  const assertSamePath = (actual, expected) => {
    if (comparable(actual) !== comparable(expected)) {
      throw new ContractServiceError(500, 'Private contract storage is misconfigured.');
    }
  };
  if (PUBLIC_DIRECTORY_CANDIDATES.some((directory) => (
    resolved === directory || resolved.startsWith(`${directory}${path.sep}`)
  ))) {
    throw new ContractServiceError(500, 'Private contract storage is misconfigured.');
  }
  let existingAncestor = resolved;
  while (true) {
    try {
      const actualAncestor = await realpath(existingAncestor);
      assertSamePath(actualAncestor, existingAncestor);
      break;
    } catch (error) {
      if (error instanceof ContractServiceError) throw error;
      if (error?.code !== 'ENOENT') {
        throw new ContractServiceError(500, 'Private contract storage is misconfigured.');
      }
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) {
        throw new ContractServiceError(500, 'Private contract storage is unavailable.');
      }
      existingAncestor = parent;
    }
  }
  if (create) {
    await mkdir(resolved, { recursive: true, mode: 0o700 });
  }
  let actual;
  try {
    actual = await realpath(resolved);
  } catch (error) {
    throw new ContractServiceError(
      500,
      error?.code === 'ENOENT'
        ? 'Private contract storage is unavailable.'
        : 'Private contract storage is misconfigured.'
    );
  }
  assertSamePath(actual, resolved);
  const comparableActual = comparable(actual);
  for (const directory of PUBLIC_DIRECTORY_CANDIDATES) {
    try {
      const publicPath = await realpath(directory);
      const comparablePublicPath = comparable(publicPath);
      if (comparableActual === comparablePublicPath
        || comparableActual.startsWith(`${comparablePublicPath}${path.sep}`)) {
        throw new ContractServiceError(500, 'Private contract storage is misconfigured.');
      }
    } catch (error) {
      if (error instanceof ContractServiceError) throw error;
      if (error?.code !== 'ENOENT') {
        throw new ContractServiceError(500, 'Private contract storage is misconfigured.');
      }
    }
  }
  return actual;
}

function getMaxUploadBytes() {
  const configured = process.env.DOCUMENT_MAX_BYTES;
  if (configured === undefined) return DEFAULT_MAX_UPLOAD_BYTES;
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CONFIGURED_UPLOAD_BYTES) {
    throw new ContractServiceError(500, 'Contract upload limit configuration is invalid.');
  }
  return value;
}

function validateUploadHeaders(request) {
  const supported = new Set([
    'x-contract-file-name',
    'x-contract-title',
    'x-contract-type',
    'x-contract-case-id',
  ]);
  if (Object.keys(request.headers).some(
    (header) => header.startsWith('x-contract-') && !supported.has(header)
  )) {
    invalid('Request contains unsupported contract metadata.');
  }
  const fileName = request.headers['x-contract-file-name'];
  if (
    typeof fileName !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9 _().-]*\.pdf$/i.test(fileName.trim())
    || fileName.trim().length > 255
  ) {
    invalid('file name must be a safe PDF filename without path separators.');
  }
  const title = parseMetadataValue(request.headers['x-contract-title'], 'title', 200);
  const contractType = parseMetadataValue(request.headers['x-contract-type'], 'contract_type', 50);
  const caseId = request.headers['x-contract-case-id'] === undefined
    ? null
    : validateUuid(request.headers['x-contract-case-id'], 'case_id');
  return { fileName: fileName.trim(), title, contractType, caseId };
}

function validateContentHeaders(request, maxBytes) {
  if (request.headers['content-type']?.toLowerCase() !== 'application/pdf') {
    throw new ContractServiceError(415, 'Only PDF contracts are supported.');
  }
  const contentLength = request.headers['content-length'];
  if (contentLength !== undefined) {
    if (!/^\d+$/.test(contentLength)) invalid('Content-Length is invalid.');
    if (Number(contentLength) > maxBytes) {
      throw new ContractServiceError(413, 'Contract exceeds the maximum upload size.');
    }
  }
}

async function streamPdfToDisk(request, storageKey, maxBytes) {
  const storageDirectory = await assertPrivateStorageDirectory({ create: true });
  const filePath = path.join(storageDirectory, storageKey);
  // Node.js has no universal directory-handle-relative no-follow API on Windows.
  const openFlags = constants.O_WRONLY
    | constants.O_CREAT
    | constants.O_EXCL
    | (constants.O_NOFOLLOW || 0);
  let fileHandle;
  let safeToRemove = false;
  let fileIdentity;
  let receivedBytes = 0;
  let prefix = Buffer.alloc(0);
  let signatureChecked = false;
  let invalidPdf = false;
  const signature = Buffer.from('%PDF-');
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes) {
        callback(new ContractServiceError(413, 'Contract exceeds the maximum upload size.'));
        return;
      }
      if (invalidPdf) {
        callback();
        return;
      }
      if (!signatureChecked) {
        const combined = Buffer.concat([prefix, chunk]);
        if (combined.length < signature.length) {
          prefix = combined;
          callback();
          return;
        }
        signatureChecked = true;
        if (!combined.subarray(0, signature.length).equals(signature)) {
          invalidPdf = true;
          callback();
          return;
        }
        this.push(combined);
        prefix = Buffer.alloc(0);
        callback();
        return;
      }
      this.push(chunk);
      callback();
    },
  });
  try {
    fileHandle = await open(filePath, openFlags, 0o600);
    const openedStat = await fileHandle.stat();
    fileIdentity = getFileIdentity(openedStat);
    safeToRemove = true;
    const actualFilePath = await realpath(filePath);
    const comparable = (value) => process.platform === 'win32'
      ? value.toLowerCase()
      : value;
    if (!openedStat.isFile()
      || comparable(actualFilePath) !== comparable(filePath)) {
      throw new ContractServiceError(500, 'Private contract storage is misconfigured.');
    }
    await pipeline(
      request,
      limiter,
      createWriteStream(null, { fd: fileHandle.fd, autoClose: false })
    );
    if (!signatureChecked) invalidPdf = true;
    if (invalidPdf) {
      throw new ContractServiceError(415, 'Uploaded content is not a supported PDF document.');
    }
    await fileHandle.close();
    fileHandle = undefined;
    return { filePath, fileIdentity };
  } catch (error) {
    if (fileHandle) await fileHandle.close().catch(() => {});
    if (safeToRemove) {
      await removeStoredFile(filePath, fileIdentity, { suppressErrors: true });
    }
    if (error instanceof ContractServiceError) throw error;
    throw new ContractServiceError(500, 'Unable to store the uploaded contract.');
  }
}

function getFileIdentity(fileStat) {
  if (!Number.isInteger(fileStat?.dev) || !Number.isInteger(fileStat?.ino)) return null;
  if (fileStat.dev === 0 && fileStat.ino === 0) return null;
  return { dev: fileStat.dev, ino: fileStat.ino };
}

function hasSameFileIdentity(actual, expected) {
  return Boolean(
    actual
    && expected
    && actual.dev === expected.dev
    && actual.ino === expected.ino
  );
}

async function removeStoredFile(filePath, expectedIdentity, { suppressErrors = false } = {}) {
  let verificationHandle;
  try {
    verificationHandle = await open(
      filePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0)
    );
    const actualIdentity = getFileIdentity(await verificationHandle.stat());
    await verificationHandle.close();
    verificationHandle = undefined;
    if (!hasSameFileIdentity(actualIdentity, expectedIdentity)) return;
    await rm(filePath, { force: true });
  } catch {
    if (verificationHandle) await verificationHandle.close().catch(() => {});
    if (suppressErrors) return;
    throw new ContractServiceError(500, 'Unable to complete contract upload.');
  }
}

async function findContract(actor, contractId, includeStorageKey = false) {
  assertActor(actor, ['admin', 'lawyer', 'assistant', 'client']);
  validateUuid(contractId, 'contractId');
  const parameters = [contractId];
  const scope = accessScope(actor, parameters);
  const result = await execute(
    `SELECT c.contract_id, c.title, c.contract_type, c.status, c.created_at,
            c.client_id, c.case_id${includeStorageKey ? ', c.storage_key' : ''}
       FROM contracts c
      WHERE c.contract_id = $1 ${scope}
      LIMIT 1`,
    parameters
  );
  if (!result.rowCount) throw new ContractServiceError(404, 'Contract not found.');
  return result.rows[0];
}

export async function listContracts(actor, queryParameters) {
  assertActor(actor, ['admin', 'lawyer', 'assistant', 'client']);
  const { page, pageSize, offset, clientId, caseId, status, search } = parseListOptions(queryParameters);
  const parameters = [];
  const scope = accessScope(actor, parameters);
  let filters = '';
  if (clientId) {
    parameters.push(clientId);
    filters += ` AND c.client_id = $${parameters.length}`;
  }
  if (caseId) {
    parameters.push(caseId);
    filters += ` AND c.case_id = $${parameters.length}`;
  }
  if (status) {
    parameters.push(status);
    filters += ` AND c.status = $${parameters.length}`;
  }
  if (search) {
    parameters.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
    filters += ` AND (c.title ILIKE $${parameters.length} ESCAPE E'\\\\'
      OR c.contract_type ILIKE $${parameters.length} ESCAPE E'\\\\')`;
  }
  const count = await execute(
    `SELECT COUNT(*)::int AS total FROM contracts c WHERE TRUE ${scope} ${filters}`,
    parameters
  );
  const total = count.rows[0].total;
  const pageParameters = [...parameters, pageSize, offset];
  const result = await execute(
    `SELECT c.contract_id, c.title, c.contract_type, c.status, c.created_at,
            c.client_id, c.case_id
       FROM contracts c
      WHERE TRUE ${scope} ${filters}
      ORDER BY c.created_at DESC, c.contract_id ASC
      LIMIT $${pageParameters.length - 1} OFFSET $${pageParameters.length}`,
    pageParameters
  );
  return {
    contracts: result.rows.map(publicContract),
    pagination: { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) },
  };
}

export async function getContract(actor, contractId) {
  return publicContract(await findContract(actor, contractId));
}

export async function uploadContract(actor, clientId, request) {
  assertActor(actor, ['admin', 'lawyer', 'assistant']);
  validateUuid(clientId, 'clientId');
  const metadata = validateUploadHeaders(request);
  if (actor.role !== 'admin' && metadata.caseId === null) {
    throw new ContractServiceError(403, 'A case assignment is required for this upload.');
  }
  const maxBytes = getMaxUploadBytes();
  validateContentHeaders(request, maxBytes);
  const parameters = actor.role === 'admin'
    ? [clientId, metadata.caseId]
    : [clientId, metadata.caseId, actor.user_id];
  const accessCondition = actor.role === 'admin'
    ? ''
    : `AND EXISTS (
        SELECT 1 FROM assigned_to assignment
        WHERE assignment.case_id = lc.case_id AND assignment.user_id = $3
      )`;
  const related = await execute(
    `SELECT c.client_id, lc.case_id
       FROM clients c
       LEFT JOIN legal_cases lc ON lc.case_id = $2
      WHERE c.client_id = $1
        AND ($2::uuid IS NULL OR EXISTS (
          SELECT 1 FROM involves i
          WHERE i.client_id = c.client_id AND i.case_id = lc.case_id
        ))
        ${accessCondition}
      LIMIT 1`,
    parameters
  );
  if (!related.rowCount) throw new ContractServiceError(404, 'Client or case not found.');

  const storageKey = `${randomUUID()}.pdf`;
  const storedFile = await streamPdfToDisk(request, storageKey, maxBytes);
  try {
    const result = await execute(
      `INSERT INTO contracts
        (title, contract_type, status, storage_key, client_id, case_id, user_id)
       VALUES ($1, $2, 'draft', $3, $4, $5, $6)
       RETURNING contract_id, title, contract_type, status, created_at, client_id, case_id`,
      [metadata.title, metadata.contractType, storageKey,
        clientId, metadata.caseId, actor.user_id]
    );
    return publicContract(result.rows[0]);
  } catch (error) {
    await removeStoredFile(storedFile.filePath, storedFile.fileIdentity);
    throw error;
  }
}

export async function updateContract(actor, contractId, body) {
  assertActor(actor, ['admin', 'lawyer', 'assistant']);
  validateUuid(contractId, 'contractId');
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    invalid('Request body must be a JSON object.');
  }
  const allowed = new Set(['title', 'contract_type', 'status']);
  if (Object.keys(body).some((field) => !allowed.has(field))) {
    invalid('Request contains unsupported contract fields.');
  }
  if (Object.keys(body).length === 0) invalid('At least one permitted field is required.');
  if (Object.hasOwn(body, 'status') && actor.role === 'assistant') {
    throw new ContractServiceError(403, 'Assistants cannot change contract status.');
  }
  const fields = {};
  if (Object.hasOwn(body, 'title')) fields.title = parseMetadataValue(body.title, 'title', 200);
  if (Object.hasOwn(body, 'contract_type')) {
    fields.contract_type = parseMetadataValue(body.contract_type, 'contract_type', 50);
  }
  if (Object.hasOwn(body, 'status')) {
    if (!STATUSES.includes(body.status)) invalid('status is not a supported contract status.');
    fields.status = body.status;
  }
  const entries = Object.entries(fields);
  const parameters = entries.map(([, value]) => value);
  parameters.push(contractId);
  const scope = accessScope(actor, parameters);
  const assignments = entries.map(([field], index) => `${field} = $${index + 1}`);
  const result = await execute(
    `UPDATE contracts AS c SET ${assignments.join(', ')}
      WHERE c.contract_id = $${parameters.length} ${scope}
      RETURNING c.contract_id, c.title, c.contract_type, c.status, c.created_at,
                c.client_id, c.case_id`,
    parameters
  );
  if (!result.rowCount) throw new ContractServiceError(404, 'Contract not found.');
  return publicContract(result.rows[0]);
}

export async function getContractDownload(actor, contractId) {
  const row = await findContract(actor, contractId, true);
  if (!STORAGE_KEY_PATTERN.test(row.storage_key)) {
    throw new ContractServiceError(404, 'Contract not found.');
  }
  const storageDirectory = await assertPrivateStorageDirectory();
  const filePath = path.join(storageDirectory, row.storage_key);
  let fileHandle;
  try {
    const comparable = (value) => process.platform === 'win32'
      ? value.toLowerCase()
      : value;
    const comparableStorageDirectory = comparable(storageDirectory);
    const comparableFilePath = comparable(filePath);
    if (!comparableFilePath.startsWith(`${comparableStorageDirectory}${path.sep}`)) {
      throw new ContractServiceError(404, 'Contract file not found.');
    }
    fileHandle = await open(
      filePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0)
    );
    const fileStat = await fileHandle.stat();
    if (!fileStat.isFile()) throw new ContractServiceError(404, 'Contract file not found.');
    const actualFilePath = await realpath(filePath);
    const comparableActualFilePath = comparable(actualFilePath);
    if (comparableActualFilePath !== comparableFilePath
      || !comparableActualFilePath.startsWith(`${comparableStorageDirectory}${path.sep}`)) {
      throw new ContractServiceError(404, 'Contract file not found.');
    }
    return { contract: publicContract(row), fileHandle, fileSize: fileStat.size };
  } catch (error) {
    if (fileHandle) await fileHandle.close().catch(() => {});
    if (error?.code === 'ENOENT') throw new ContractServiceError(404, 'Contract file not found.');
    if (error instanceof ContractServiceError) throw error;
    throw new ContractServiceError(500, 'Unable to retrieve contract file.');
  }
}

export function createContractReadStream(fileHandle) {
  return fileHandle.createReadStream({ autoClose: false });
}
