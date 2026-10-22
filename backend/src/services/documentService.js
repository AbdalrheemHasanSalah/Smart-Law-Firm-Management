import { randomUUID } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import { mkdir, open, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { query } from '../config/db.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORAGE_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i;
const ACCESS_LEVELS = ['restricted', 'case_team', 'authorized_users'];
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

const PUBLIC_DOCUMENT_FIELDS = [
  'document_id',
  'file_name',
  'mime_type',
  'document_type',
  'source',
  'document_date',
  'access_level',
  'created_at',
  'case_id',
];

export class DocumentServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'DocumentServiceError';
    this.status = status;
  }
}

function invalid(message) {
  throw new DocumentServiceError(400, message);
}

function validateUuid(value, field) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    invalid(`${field} must be a valid UUID.`);
  }
  return value;
}

function assertActor(actor, roles) {
  if (!actor || !roles.includes(actor.role)) {
    throw new DocumentServiceError(403, 'You do not have permission to access this resource.');
  }
  validateUuid(actor.user_id, 'Authenticated user ID');
}

function documentAccessScope(actor, parameters, alias = 'd') {
  if (actor.role === 'admin') return '';

  parameters.push(actor.user_id);
  const userParameter = `$${parameters.length}`;

  if (actor.role === 'lawyer' || actor.role === 'assistant') {
    return `
      AND (
        ${alias}.access_level = 'case_team'
        OR ${alias}.user_id = ${userParameter}
      )
      AND EXISTS (
        SELECT 1
        FROM assigned_to assignment
        WHERE assignment.case_id = ${alias}.case_id
          AND assignment.user_id = ${userParameter}
      )
    `;
  }

  if (actor.role === 'client') {
    return `
      AND ${alias}.access_level = 'authorized_users'
      AND EXISTS (
        SELECT 1
        FROM clients c
        JOIN involves i ON i.client_id = c.client_id
        WHERE c.user_id = ${userParameter}
          AND c.client_id = ${alias}.client_id
          AND i.case_id = ${alias}.case_id
      )
    `;
  }

  throw new DocumentServiceError(403, 'You do not have permission to access this resource.');
}

function caseAccessScope(actor, parameters, alias = 'lc') {
  if (actor.role === 'admin') return '';
  parameters.push(actor.user_id);
  return `
    AND EXISTS (
      SELECT 1
      FROM assigned_to assignment
      WHERE assignment.case_id = ${alias}.case_id
        AND assignment.user_id = $${parameters.length}
    )
  `;
}

function mapDatabaseError(error) {
  if (error?.code === '23505') {
    throw new DocumentServiceError(409, 'A document record conflicts with existing data.');
  }
  if (['23502', '23503', '23514', '22001', '22007', '22P02'].includes(error?.code)) {
    throw new DocumentServiceError(400, 'Document data violates a database constraint.');
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

function publicDocument(row) {
  return Object.fromEntries(PUBLIC_DOCUMENT_FIELDS.map((field) => [field, row[field]]));
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

function parseListOptions(queryParameters = {}) {
  const allowed = new Set(['page', 'pageSize', 'caseId', 'search']);
  if (
    !queryParameters ||
    typeof queryParameters !== 'object' ||
    Object.keys(queryParameters).some((key) => !allowed.has(key))
  ) {
    invalid('Unsupported document-list query parameter.');
  }

  const page = parsePositiveInteger(queryParameters.page, 1, 'page');
  const pageSize = Math.min(parsePositiveInteger(queryParameters.pageSize, 20, 'pageSize'), 50);
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) invalid('page is too large.');

  let caseId;
  if (queryParameters.caseId !== undefined) {
    caseId = validateUuid(queryParameters.caseId, 'caseId');
  }

  let search = '';
  if (queryParameters.search !== undefined) {
    if (typeof queryParameters.search !== 'string') {
      invalid('search must be a string.');
    }
    search = queryParameters.search.trim();
    if (search.length > 100) invalid('search must contain at most 100 characters.');
  }
  return { page, pageSize, offset, caseId, search };
}

function parseMetadataValue(value, field, { required = false, maxLength } = {}) {
  if (value === undefined) {
    if (required) invalid(`${field} is required.`);
    return null;
  }
  if (typeof value !== 'string') invalid(`${field} must be a string.`);
  const normalized = value.trim();
  if (!normalized && required) invalid(`${field} is required.`);
  if (normalized.length > maxLength) invalid(`${field} must contain at most ${maxLength} characters.`);
  return normalized || null;
}

function validateDocumentDate(value) {
  if (value === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))) {
    invalid('document_date must be a valid ISO date.');
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (date.toISOString().slice(0, 10) !== value) invalid('document_date must be a valid ISO date.');
  return value;
}

function validateUploadMetadata(request, actor) {
  const supportedHeaders = new Set([
    'x-document-file-name',
    'x-document-type',
    'x-document-source',
    'x-document-date',
    'x-document-access-level',
    'x-document-client-id',
  ]);
  if (
    Object.keys(request.headers).some(
      (header) => header.startsWith('x-document-') && !supportedHeaders.has(header)
    )
  ) {
    invalid('Request contains unsupported document metadata.');
  }

  const fileName = parseMetadataValue(
    request.headers['x-document-file-name'],
    'file name',
    { required: true, maxLength: 255 }
  );
  if (!/^[A-Za-z0-9][A-Za-z0-9 _().-]*\.pdf$/i.test(fileName)) {
    invalid('file name must be a safe PDF filename without path separators.');
  }

  const documentType = parseMetadataValue(
    request.headers['x-document-type'],
    'document_type',
    { required: true, maxLength: 50 }
  );

  const source = parseMetadataValue(
    request.headers['x-document-source'],
    'source',
    { maxLength: 100 }
  );
  const documentDate = validateDocumentDate(parseMetadataValue(
    request.headers['x-document-date'],
    'document_date',
    { maxLength: 10 }
  ));
  const accessLevel = parseMetadataValue(
    request.headers['x-document-access-level'],
    'access_level',
    { maxLength: 30 }
  ) ?? 'restricted';
  if (!ACCESS_LEVELS.includes(accessLevel)) invalid('access_level is not supported.');
  if (actor.role !== 'admin' && accessLevel === 'authorized_users' && !request.headers['x-document-client-id']) {
    invalid('client_id is required for authorized_users documents.');
  }

  let clientId = null;
  if (request.headers['x-document-client-id'] !== undefined) {
    clientId = validateUuid(request.headers['x-document-client-id'], 'client_id');
  }
  if (accessLevel === 'authorized_users' && !clientId) {
    invalid('client_id is required for authorized_users documents.');
  }

  return { fileName, documentType, source, documentDate, accessLevel, clientId };
}

function getMaxUploadBytes() {
  const configured = process.env.DOCUMENT_MAX_BYTES;
  if (configured === undefined) return DEFAULT_MAX_UPLOAD_BYTES;
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CONFIGURED_UPLOAD_BYTES) {
    throw new DocumentServiceError(500, 'Document upload limit configuration is invalid.');
  }
  return value;
}

async function assertPrivateStorageDirectory({ create = false } = {}) {
  const resolved = path.resolve(STORAGE_DIRECTORY);
  const comparable = (value) => process.platform === 'win32'
    ? value.toLowerCase()
    : value;
  const assertSamePath = (actual, expected) => {
    if (comparable(actual) !== comparable(expected)) {
      throw new DocumentServiceError(500, 'Private document storage is misconfigured.');
    }
  };
  if (PUBLIC_DIRECTORY_CANDIDATES.some((publicDirectory) => (
    comparable(resolved) === comparable(publicDirectory)
    || comparable(resolved).startsWith(`${comparable(publicDirectory)}${path.sep}`)
  ))) {
    throw new DocumentServiceError(500, 'Private document storage is misconfigured.');
  }
  let existingAncestor = resolved;
  while (true) {
    try {
      const actualAncestor = await realpath(existingAncestor);
      assertSamePath(actualAncestor, existingAncestor);
      break;
    } catch (error) {
      if (error instanceof DocumentServiceError) throw error;
      if (error?.code !== 'ENOENT') {
        throw new DocumentServiceError(500, 'Private document storage is misconfigured.');
      }
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) {
        throw new DocumentServiceError(500, 'Private document storage is unavailable.');
      }
      existingAncestor = parent;
    }
  }
  if (create) await mkdir(resolved, { recursive: true, mode: 0o700 });
  let actual;
  try {
    actual = await realpath(resolved);
  } catch (error) {
    throw new DocumentServiceError(
      500,
      error?.code === 'ENOENT'
        ? 'Private document storage is unavailable.'
        : 'Private document storage is misconfigured.'
    );
  }
  assertSamePath(actual, resolved);
  for (const publicDirectory of PUBLIC_DIRECTORY_CANDIDATES) {
    try {
      const actualPublicDirectory = comparable(await realpath(publicDirectory));
      const actualStorageDirectory = comparable(actual);
      if (
        actualStorageDirectory === actualPublicDirectory
        || actualStorageDirectory.startsWith(`${actualPublicDirectory}${path.sep}`)
      ) {
        throw new DocumentServiceError(500, 'Private document storage is misconfigured.');
      }
    } catch (error) {
      if (error instanceof DocumentServiceError) throw error;
      if (error?.code !== 'ENOENT') {
        throw new DocumentServiceError(500, 'Private document storage is misconfigured.');
      }
    }
  }
  return actual;
}

function validateContentHeaders(request, maxBytes) {
  if (request.headers['content-type']?.toLowerCase() !== 'application/pdf') {
    throw new DocumentServiceError(415, 'Only PDF documents are supported.');
  }
  const contentLength = request.headers['content-length'];
  if (contentLength !== undefined) {
    if (!/^\d+$/.test(contentLength)) invalid('Content-Length is invalid.');
    if (Number(contentLength) > maxBytes) {
      throw new DocumentServiceError(413, 'Document exceeds the maximum upload size.');
    }
  }
}

async function streamPdfToDisk(request, storageKey, maxBytes) {
  const storageDirectory = await assertPrivateStorageDirectory({ create: true });
  const filePath = path.join(storageDirectory, storageKey);

  let receivedBytes = 0;
  let prefix = Buffer.alloc(0);
  let signatureChecked = false;
  let invalidPdf = false;
  const signature = Buffer.from('%PDF-');
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes) {
        callback(new DocumentServiceError(413, 'Document exceeds the maximum upload size.'));
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

  // Node.js has no universal directory-handle-relative no-follow API on Windows.
  const openFlags = constants.O_WRONLY
    | constants.O_CREAT
    | constants.O_EXCL
    | (constants.O_NOFOLLOW || 0);
  let fileHandle;
  let safeToRemove = false;
  let fileIdentity;
  try {
    fileHandle = await open(filePath, openFlags, 0o600);
    safeToRemove = true;
    const openedStat = await fileHandle.stat();
    fileIdentity = getFileIdentity(openedStat);
    const actualFilePath = await realpath(filePath);
    const comparable = (value) => process.platform === 'win32'
      ? value.toLowerCase()
      : value;
    if (
      !openedStat.isFile()
      || comparable(actualFilePath) !== comparable(filePath)
    ) {
      throw new DocumentServiceError(500, 'Private document storage is misconfigured.');
    }
    await pipeline(
      request,
      limiter,
      createWriteStream(null, { fd: fileHandle.fd, autoClose: false })
    );
    if (!signatureChecked) invalidPdf = true;
    if (invalidPdf) throw new DocumentServiceError(415, 'Uploaded content is not a supported PDF document.');
    await fileHandle.close();
    fileHandle = undefined;
    return { filePath, fileIdentity };
  } catch (error) {
    if (fileHandle) await fileHandle.close().catch(() => {});
    if (safeToRemove) {
      await removeStoredFile(filePath, fileIdentity, { suppressErrors: true });
    }
    if (error instanceof DocumentServiceError) throw error;
    throw new DocumentServiceError(500, 'Unable to store the uploaded document.');
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
    throw new DocumentServiceError(500, 'Unable to complete document upload.');
  }
}

export async function listDocuments(actor, queryParameters) {
  assertActor(actor, ['admin', 'lawyer', 'assistant', 'client']);
  const { page, pageSize, offset, caseId, search } = parseListOptions(queryParameters);
  const parameters = [];
  const scope = documentAccessScope(actor, parameters);
  let filters = '';
  if (caseId) {
    parameters.push(caseId);
    filters += ` AND d.case_id = $${parameters.length}`;
  }
  if (search) {
    parameters.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
    const searchParameter = `$${parameters.length}`;
    filters += `
      AND (
        d.file_name ILIKE ${searchParameter} ESCAPE E'\\\\'
        OR d.document_type ILIKE ${searchParameter} ESCAPE E'\\\\'
      )
    `;
  }

  const countResult = await execute(
    `SELECT COUNT(*)::int AS total FROM documents d WHERE TRUE ${scope} ${filters}`,
    parameters
  );
  const total = countResult.rows[0].total;
  const pageParameters = [...parameters, pageSize, offset];
  const result = await execute(
    `
      SELECT
        d.document_id,
        d.file_name,
        d.mime_type,
        d.document_type,
        d.source,
        d.document_date,
        d.access_level,
        d.created_at,
        d.case_id,
        d.client_id
      FROM documents d
      WHERE TRUE
        ${scope}
        ${filters}
      ORDER BY d.created_at DESC, d.document_id ASC
      LIMIT $${pageParameters.length - 1}
      OFFSET $${pageParameters.length}
    `,
    pageParameters
  );
  return {
    documents: result.rows.map(publicDocument),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}

async function findDocument(actor, documentId, { includeStorageKey = false } = {}) {
  assertActor(actor, ['admin', 'lawyer', 'assistant', 'client']);
  validateUuid(documentId, 'documentId');
  const parameters = [documentId];
  const scope = documentAccessScope(actor, parameters);
  const result = await execute(
    `
      SELECT
        d.document_id,
        d.file_name,
        d.mime_type,
        d.document_type,
        d.source,
        d.document_date,
        d.access_level,
        d.created_at,
        d.case_id,
        d.client_id
        ${includeStorageKey ? ', d.storage_key' : ''}
      FROM documents d
      WHERE d.document_id = $1
        ${scope}
      LIMIT 1
    `,
    parameters
  );
  if (!result.rowCount) throw new DocumentServiceError(404, 'Document not found.');
  return result.rows[0];
}

export async function getDocumentMetadata(actor, documentId) {
  const row = await findDocument(actor, documentId);
  return publicDocument(row);
}

export async function getDocumentDownload(actor, documentId) {
  const row = await findDocument(actor, documentId, { includeStorageKey: true });
  if (typeof row.storage_key !== 'string' || !STORAGE_KEY_PATTERN.test(row.storage_key)) {
    throw new DocumentServiceError(404, 'Document not found.');
  }
  const storageDirectory = await assertPrivateStorageDirectory();
  const filePath = path.join(storageDirectory, row.storage_key);
  let fileHandle;
  try {
    fileHandle = await open(
      filePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0)
    );
    const fileStat = await fileHandle.stat();
    const actualFilePath = await realpath(filePath);
    const comparable = (value) => process.platform === 'win32'
      ? value.toLowerCase()
      : value;
    if (
      !fileStat.isFile()
      || comparable(actualFilePath) !== comparable(filePath)
    ) {
      throw new DocumentServiceError(404, 'Document file not found.');
    }
    return {
      document: publicDocument(row),
      fileHandle,
      fileSize: fileStat.size,
    };
  } catch (error) {
    if (fileHandle) await fileHandle.close().catch(() => {});
    if (error?.code === 'ENOENT') throw new DocumentServiceError(404, 'Document file not found.');
    if (error instanceof DocumentServiceError) throw error;
    throw new DocumentServiceError(500, 'Unable to retrieve document file.');
  }
}

export async function assertCaseUploadAccess(actor, caseId, clientId) {
  assertActor(actor, ['admin', 'lawyer', 'assistant']);
  validateUuid(caseId, 'caseId');
  if (clientId !== null) validateUuid(clientId, 'client_id');
  const parameters = [caseId];
  const scope = caseAccessScope(actor, parameters);
  parameters.push(clientId);
  const clientParameter = `$${parameters.length}`;
  const result = await execute(
    `
      SELECT lc.case_id
      FROM legal_cases lc
      WHERE lc.case_id = $1
        ${scope}
        AND (
          ${clientParameter}::uuid IS NULL
          OR EXISTS (
            SELECT 1
            FROM involves i
            WHERE i.case_id = lc.case_id
              AND i.client_id = ${clientParameter}
          )
        )
      LIMIT 1
    `,
    parameters
  );
  if (!result.rowCount) throw new DocumentServiceError(404, 'Case not found.');
}

export async function uploadDocument(actor, caseId, request) {
  assertActor(actor, ['admin', 'lawyer', 'assistant']);
  const metadata = validateUploadMetadata(request, actor);
  const maxBytes = getMaxUploadBytes();
  validateContentHeaders(request, maxBytes);
  await assertCaseUploadAccess(actor, caseId, metadata.clientId);

  const storageKey = `${randomUUID()}.pdf`;
  const storedFile = await streamPdfToDisk(request, storageKey, maxBytes);
  try {
    const result = await execute(
      `
        INSERT INTO documents (
          file_name,
          storage_key,
          mime_type,
          document_type,
          source,
          document_date,
          access_level,
          case_id,
          client_id,
          user_id
        )
        VALUES ($1, $2, 'application/pdf', $3, $4, $5, $6, $7, $8, $9)
        RETURNING
          document_id,
          file_name,
          mime_type,
          document_type,
          source,
          document_date,
          access_level,
          created_at,
          case_id,
          client_id
      `,
      [
        metadata.fileName,
        storageKey,
        metadata.documentType,
        metadata.source,
        metadata.documentDate,
        metadata.accessLevel,
        caseId,
        metadata.clientId,
        actor.user_id,
      ]
    );
    return publicDocument(result.rows[0]);
  } catch (error) {
    await removeStoredFile(storedFile.filePath, storedFile.fileIdentity);
    throw error;
  }
}

export async function updateDocumentMetadata(actor, documentId, body) {
  assertActor(actor, ['admin', 'lawyer', 'assistant']);
  validateUuid(documentId, 'documentId');
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    invalid('Request body must be a JSON object.');
  }

  const allowed = new Set(['document_type', 'source', 'document_date']);
  if (actor.role === 'admin') allowed.add('access_level');
  if (Object.keys(body).some((field) => !allowed.has(field))) {
    invalid('Request contains unsupported document fields.');
  }
  if (Object.keys(body).length === 0) invalid('At least one permitted field is required.');

  const fields = {};
  if (Object.hasOwn(body, 'document_type')) {
    if (
      typeof body.document_type !== 'string' ||
      !body.document_type.trim() ||
      body.document_type.trim().length > 50
    ) {
      invalid('document_type must contain 1 to 50 characters.');
    }
    fields.document_type = body.document_type.trim();
  }
  if (Object.hasOwn(body, 'source')) {
    if (body.source === null) {
      fields.source = null;
    } else if (typeof body.source === 'string' && body.source.trim().length <= 100) {
      fields.source = body.source.trim() || null;
    } else {
      invalid('source must be a string or null of at most 100 characters.');
    }
  }
  if (Object.hasOwn(body, 'document_date')) {
    if (body.document_date !== null && typeof body.document_date !== 'string') {
      invalid('document_date must be a valid ISO date or null.');
    }
    fields.document_date = validateDocumentDate(body.document_date);
  }
  if (Object.hasOwn(body, 'access_level')) {
    if (!ACCESS_LEVELS.includes(body.access_level)) invalid('access_level is not supported.');
    fields.access_level = body.access_level;
  }

  const entries = Object.entries(fields);
  const parameters = entries.map(([, value]) => value);
  const assignments = entries.map(([field], index) => `${field} = $${index + 1}`);
  parameters.push(documentId);
  const documentScope = documentAccessScope(actor, parameters);
  const result = await execute(
    `
      UPDATE documents AS d
      SET ${assignments.join(', ')}
      WHERE d.document_id = $${entries.length + 1}
        ${documentScope}
      RETURNING
        d.document_id,
        d.file_name,
        d.mime_type,
        d.document_type,
        d.source,
        d.document_date,
        d.access_level,
        d.created_at,
        d.case_id,
        d.client_id
    `,
    parameters
  );
  if (!result.rowCount) throw new DocumentServiceError(404, 'Document not found.');
  return publicDocument(result.rows[0]);
}

export function createDocumentReadStream(fileHandle) {
  return fileHandle.createReadStream({ autoClose: false });
}
