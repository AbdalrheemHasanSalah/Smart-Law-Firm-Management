import assert from 'node:assert/strict';
import { mkdtemp, open, readFile, readdir, rm, symlink, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { after, afterEach, before, test } from 'node:test';
import { errorHandler } from '../src/middleware/errorHandler.js';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';
const storageDirectory = await mkdtemp(path.join(os.tmpdir(), 'smart-law-documents-test-'));
process.env.DOCUMENT_STORAGE_DIR = storageDirectory;
process.env.DOCUMENT_MAX_BYTES = '2048';

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');
const { streamDocumentDownload } = await import('../src/controllers/documentController.js');
const { uploadDocument } = await import('../src/services/documentService.js');

const authUserId = 'auth-user-id';
const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const caseId = '1cdd115e-0279-48b4-a795-1be1d5a50d0b';
const documentId = 'e4663540-663f-4d4d-b8f2-bfbc6a414d64';
const clientId = 'd5a39bb4-f7b6-43a0-bfca-2b16678cc514';
const session = {
  user: { id: authUserId },
  session: { id: 'session-id', expiresAt: '2999-01-01T00:00:00.000Z' },
};
const mappedUser = {
  user_id: appUserId,
  auth_user_id: authUserId,
  full_name: 'Test User',
  email: 'test@example.com',
  email_verified: true,
  status: 'active',
  role_id: 'role-id',
  role: 'admin',
};

let server;
let baseUrl;
let storedDocument;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  await pool.end();
  await rm(storageDirectory, { recursive: true, force: true });
});

afterEach(async () => {
  const files = await readdir(storageDirectory);
  await Promise.all(files.map((file) => rm(path.join(storageDirectory, file), { force: true })));
});

function setupRequest(t, role, databaseHandler = async () => ({ rowCount: 0, rows: [] })) {
  t.mock.method(console, 'error', () => {});
  t.mock.method(auth.api, 'getSession', async () => session);
  const calls = [];
  t.mock.method(pool, 'query', async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    if (sql.includes('u.auth_user_id')) {
      return { rowCount: 1, rows: [{ ...mappedUser, role }] };
    }
    return databaseHandler(sql, parameters);
  });
  return calls;
}

async function request(method, route, { headers = {}, body } = {}) {
  const requestHeaders = {
    cookie: 'better-auth.session_token=test-session',
    ...headers,
  };
  return fetch(`${baseUrl}${route}`, {
    method,
    headers: requestHeaders,
    body,
  });
}

function uploadHeaders(overrides = {}) {
  return {
    'content-type': 'application/pdf',
    'x-document-file-name': 'evidence.pdf',
    'x-document-type': 'evidence',
    ...overrides,
  };
}

test('admin can upload a PDF to an existing case without exposing storage or uploader identifiers', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql, parameters) => {
    if (sql.includes('FROM legal_cases lc')) {
      assert.match(sql, /EXISTS\s*\(/);
      assert.deepEqual(parameters, [caseId, null]);
      return { rowCount: 1, rows: [{ case_id: caseId }] };
    }
    assert.match(sql, /INSERT INTO documents/);
    assert.doesNotMatch(sql, /SELECT \*/i);
    assert.deepEqual(parameters.slice(0, 8), [
      'evidence.pdf',
      parameters[1],
      'evidence',
      null,
      null,
      'restricted',
      caseId,
      null,
    ]);
    assert.match(parameters[1], /^[0-9a-f-]{36}\.pdf$/i);
    storedDocument = {
      document_id: documentId,
      file_name: 'evidence.pdf',
      mime_type: 'application/pdf',
      document_type: 'evidence',
      source: null,
      document_date: null,
      access_level: 'restricted',
      created_at: '2026-01-01T00:00:00.000Z',
      case_id: caseId,
      client_id: null,
      storage_key: parameters[1],
    };
    return {
      rowCount: 1,
      rows: [{ ...storedDocument }],
    };
  });

  const response = await request('POST', `/api/cases/${caseId}/documents`, {
    headers: uploadHeaders(),
    body: Buffer.from('%PDF-1.7\nLegal document'),
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.document.document_id, documentId);
  assert.equal(body.document.case_id, caseId);
  assert.equal('storage_key' in body.document, false);
  assert.equal('user_id' in body.document, false);
  assert.equal(calls.length, 3);
  const saved = await readFile(path.join(storageDirectory, storedDocument.storage_key));
  assert.equal(saved.toString(), '%PDF-1.7\nLegal document');
});

test('unauthenticated requests cannot access document listing, metadata, downloads, or uploads', async (t) => {
  const calls = [];
  t.mock.method(auth.api, 'getSession', async () => null);
  t.mock.method(pool, 'query', async (sql, parameters) => {
    calls.push({ sql, parameters });
    return { rowCount: 0, rows: [] };
  });

  const requests = [
    ['GET', '/api/documents'],
    ['GET', `/api/documents/${documentId}`],
    ['GET', `/api/documents/${documentId}/download`],
    ['POST', `/api/cases/${caseId}/documents`, {
      headers: uploadHeaders(),
      body: Buffer.from('%PDF-1.7'),
    }],
  ];

  for (const [method, route, options = {}] of requests) {
    assert.equal((await request(method, route, options)).status, 401);
  }
  assert.equal(calls.length, 0);
});

test('upload rejects traversal names, unsupported media, and non-PDF content', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql) => {
    if (sql.includes('FROM legal_cases lc')) return { rowCount: 1, rows: [{ case_id: caseId }] };
    return { rowCount: 0, rows: [] };
  });
  const traversal = await request('POST', `/api/cases/${caseId}/documents`, {
    headers: uploadHeaders({ 'x-document-file-name': '..%2Fsecret.pdf' }),
    body: Buffer.from('%PDF-1.7'),
  });
  assert.equal(traversal.status, 400);
  const unsupportedType = await request('POST', `/api/cases/${caseId}/documents`, {
    headers: uploadHeaders({ 'content-type': 'application/octet-stream' }),
    body: Buffer.from('%PDF-1.7'),
  });
  assert.equal(unsupportedType.status, 415);
  const invalidPdf = await request('POST', `/api/cases/${caseId}/documents`, {
    headers: uploadHeaders(),
    body: Buffer.from('not a PDF document'),
  });
  assert.equal(invalidPdf.status, 415);
  assert.equal(calls.filter((call) => call.sql.includes('INSERT INTO documents')).length, 0);
  assert.deepEqual(await readdir(storageDirectory), []);
});

test('upload rejects a client relationship that is not linked to the case', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql) => {
    if (sql.includes('FROM legal_cases lc')) {
      return { rowCount: 0, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  });

  const response = await request('POST', `/api/cases/${caseId}/documents`, {
    headers: uploadHeaders({
      'x-document-access-level': 'authorized_users',
      'x-document-client-id': clientId,
    }),
    body: Buffer.from('%PDF-1.7\nLegal document'),
  });
  assert.equal(response.status, 404);
  assert.equal(calls.filter((call) => call.sql.includes('INSERT INTO documents')).length, 0);
  assert.deepEqual(await readdir(storageDirectory), []);
});

test('upload enforces size limits and rejects unauthorized cases before storing files', async (t) => {
  await t.test('exactly at the configured limit', async (subtest) => {
    const calls = setupRequest(subtest, 'admin', async (sql, parameters) => {
      if (sql.includes('FROM legal_cases lc')) {
        return { rowCount: 1, rows: [{ case_id: caseId }] };
      }
      assert.match(sql, /INSERT INTO documents/);
      return {
        rowCount: 1,
        rows: [{
          document_id: documentId,
          file_name: 'evidence.pdf',
          mime_type: 'application/pdf',
          document_type: 'evidence',
          source: null,
          document_date: null,
          access_level: 'restricted',
          created_at: '2026-01-01T00:00:00.000Z',
          case_id: caseId,
          client_id: null,
        }],
      };
    });
    const payload = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.alloc(2048 - Buffer.byteLength('%PDF-1.7\n'), 1),
    ]);
    const response = await request('POST', `/api/cases/${caseId}/documents`, {
      headers: uploadHeaders({ 'content-length': String(payload.length) }),
      body: payload,
    });
    assert.equal(response.status, 201);
    assert.equal(calls.filter((call) => call.sql.includes('INSERT INTO documents')).length, 1);
  });

  await t.test('oversized request', async (subtest) => {
    const calls = setupRequest(subtest, 'admin');
    const response = await request('POST', `/api/cases/${caseId}/documents`, {
      headers: uploadHeaders(),
      body: Buffer.alloc(2049, 1),
    });
    assert.equal(response.status, 413);
    assert.equal(calls.length, 1);
  });

  await t.test('case not accessible', async (subtest) => {
    const calls = setupRequest(subtest, 'lawyer', async (sql, parameters) => {
      assert.match(sql, /FROM assigned_to assignment/);
      assert.ok(parameters.includes(appUserId));
      return { rowCount: 0, rows: [] };
    });
    const response = await request('POST', `/api/cases/${caseId}/documents`, {
      headers: uploadHeaders(),
      body: Buffer.from('%PDF-1.7'),
    });
    assert.equal(response.status, 404);
    assert.equal(calls.length, 2);
    assert.deepEqual(await readdir(storageDirectory), []);
  });
});

test('missing stored files return a safe not-found response', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql) => {
    assert.match(sql, /d\.storage_key/);
    return {
      rowCount: 1,
      rows: [{
        document_id: documentId,
        file_name: 'missing.pdf',
        mime_type: 'application/pdf',
        document_type: 'evidence',
        source: null,
        document_date: null,
        access_level: 'restricted',
        created_at: '2026-01-01T00:00:00.000Z',
        case_id: caseId,
        client_id: null,
        storage_key: `${documentId}.pdf`,
      }],
    };
  });

  const response = await request('GET', `/api/documents/${documentId}/download`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Document file not found.' });
  assert.equal(calls.length, 2);
});

test('download rejects symlink and non-regular document files without exposing storage details', async (t) => {
  const storageKey = `${documentId}.pdf`;
  const row = {
    document_id: documentId,
    file_name: 'evidence.pdf',
    mime_type: 'application/pdf',
    document_type: 'evidence',
    source: null,
    document_date: null,
    access_level: 'restricted',
    created_at: '2026-01-01T00:00:00.000Z',
    case_id: caseId,
    client_id: null,
    storage_key: storageKey,
  };
  setupRequest(t, 'admin', async () => ({ rowCount: 1, rows: [row] }));

  const outsideFile = path.join(os.tmpdir(), `smart-law-document-target-${documentId}.pdf`);
  await writeFile(outsideFile, '%PDF-1.7\nOutside file');
  try {
    try {
      await symlink(outsideFile, path.join(storageDirectory, storageKey));
    } catch (error) {
      if (['EACCES', 'EPERM', 'UNKNOWN'].includes(error?.code)) {
        t.skip('The platform does not permit creating symlinks in the test environment.');
        return;
      }
      throw error;
    }
    const symlinkResponse = await request('GET', `/api/documents/${documentId}/download`);
    assert.notEqual(symlinkResponse.status, 200);
    assert.doesNotMatch(await symlinkResponse.text(), /Outside file|private-documents|storageKey/);
  } finally {
    await rm(path.join(storageDirectory, storageKey), { force: true });
    await rm(outsideFile, { force: true });
  }

  await mkdir(path.join(storageDirectory, storageKey));
  const directoryResponse = await request('GET', `/api/documents/${documentId}/download`);
  assert.notEqual(directoryResponse.status, 200);
  assert.doesNotMatch(await directoryResponse.text(), /private-documents|storageKey/);
  await rm(path.join(storageDirectory, storageKey), { recursive: true, force: true });
});

test('failed document insert removes the newly written file and hides database details', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql) => {
    if (sql.includes('FROM legal_cases lc')) return { rowCount: 1, rows: [{ case_id: caseId }] };
    const error = new Error('sensitive database error details');
    error.code = '23505';
    throw error;
  });
  const response = await request('POST', `/api/cases/${caseId}/documents`, {
    headers: uploadHeaders(),
    body: Buffer.from('%PDF-1.7\nLegal document'),
  });
  assert.equal(response.status, 409);
  assert.doesNotMatch(JSON.stringify(await response.json()), /sensitive database error/);
  assert.equal(calls.length, 3);
  assert.deepEqual(await readdir(storageDirectory), []);
});

test('database-insert cleanup does not remove a replacement file at the old storage path', async (t) => {
  let replacementPath;
  setupRequest(t, 'admin', async (sql, parameters) => {
    if (sql.includes('FROM legal_cases lc')) return { rowCount: 1, rows: [{ case_id: caseId }] };
    replacementPath = path.join(storageDirectory, parameters[1]);
    await rm(replacementPath);
    await writeFile(replacementPath, 'replacement content');
    const error = new Error('sensitive database error details');
    error.code = '23505';
    throw error;
  });

  const response = await request('POST', `/api/cases/${caseId}/documents`, {
    headers: uploadHeaders(),
    body: Buffer.from('%PDF-1.7\nLegal document'),
  });
  assert.equal(response.status, 409);
  assert.equal(await readFile(replacementPath, 'utf8'), 'replacement content');
});

test('aborted uploads clean up the partial file without touching other files', async (t) => {
  setupRequest(t, 'admin', async (sql) => {
    if (sql.includes('FROM legal_cases lc')) return { rowCount: 1, rows: [{ case_id: caseId }] };
    throw new Error('The insert should not be reached after an aborted upload.');
  });
  const abortedRequest = new Readable({
    read() {
      this.destroy(new Error('client aborted'));
    },
  });
  abortedRequest.headers = uploadHeaders();

  await assert.rejects(
    uploadDocument(mappedUser, caseId, abortedRequest),
    /Unable to store the uploaded document/
  );
  assert.deepEqual(await readdir(storageDirectory), []);
});

test('stream-construction failure closes the validated handle', async () => {
  const response = new PassThrough();
  response.status = () => response;
  response.set = () => response;
  response.headersSent = false;
  let closeCount = 0;
  const fileHandle = {
    close: async () => {
      closeCount += 1;
    },
    createReadStream: () => {
      throw new Error('stream construction failed');
    },
  };

  assert.throws(
    () => streamDocumentDownload(response, () => {}, fileHandle, 10, 'document.pdf'),
    /stream construction failed/
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closeCount, 1);
});

test('download stream errors and response disconnects close the handle once', async (t) => {
  await t.test('stream error', async () => {
    const response = new PassThrough();
    response.status = () => response;
    response.set = () => response;
    response.headersSent = true;
    response.destroy = () => {};
    let closeCount = 0;
    const stream = new Readable({
      read() {
        this.destroy(new Error('read failed'));
      },
    });
    const fileHandle = {
      close: async () => {
        closeCount += 1;
      },
      createReadStream: () => stream,
    };
    streamDocumentDownload(response, () => {}, fileHandle, 10, 'document.pdf');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(closeCount, 1);
  });

  await t.test('client disconnect', async () => {
    const response = new PassThrough();
    response.status = () => response;
    response.set = () => response;
    let closeCount = 0;
    let destroyed = false;
    const stream = new Readable({
      read() {},
      destroy(error, callback) {
        destroyed = true;
        callback(error);
      },
    });
    const fileHandle = {
      close: async () => {
        closeCount += 1;
      },
      createReadStream: () => stream,
    };
    streamDocumentDownload(response, () => {}, fileHandle, 10, 'document.pdf');
    response.emit('close');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(destroyed, true);
    assert.equal(closeCount, 1);
  });
});

test('client document access is limited to explicitly linked authorized documents', async (t) => {
  const calls = setupRequest(t, 'client', async (sql, parameters) => {
    assert.match(sql, /access_level = 'authorized_users'/);
    assert.match(sql, /JOIN involves i ON i\.client_id = c\.client_id/);
    assert.match(sql, /c\.user_id = \$2/);
    assert.ok(parameters.includes(appUserId));
    return { rowCount: 0, rows: [] };
  });
  assert.equal((await request('GET', `/api/documents/${documentId}`)).status, 404);
  assert.equal((await request('GET', `/api/documents/${documentId}/download`)).status, 404);
  assert.equal(calls.length, 4);
});

test('lawyers and assistants cannot read restricted documents without current case assignment', async (t) => {
  for (const role of ['lawyer', 'assistant']) {
    await t.test(role, async (subtest) => {
      const calls = setupRequest(subtest, role, async (sql, parameters) => {
        assert.match(sql, /d\.access_level = 'case_team'/);
        assert.match(sql, /d\.user_id = \$2/);
        assert.match(sql, /FROM assigned_to assignment/);
        assert.match(sql, /assignment\.user_id = \$2/);
        assert.ok(parameters.includes(appUserId));
        return { rowCount: 0, rows: [] };
      });
      assert.equal(
        (await request('GET', `/api/documents/${documentId}`)).status,
        404
      );
      assert.equal(calls.length, 2);
    });
  }
});

test('an uploader who loses case assignment cannot keep accessing restricted documents', async (t) => {
  const calls = setupRequest(t, 'lawyer', async (sql, parameters) => {
    assert.match(sql, /d\.user_id = \$2/);
    assert.match(sql, /FROM assigned_to assignment/);
    assert.ok(parameters.includes(appUserId));
    return { rowCount: 0, rows: [] };
  });
  assert.equal(
    (await request('GET', `/api/documents/${documentId}/download`)).status,
    404
  );
  assert.equal(calls.length, 2);
});

test('a client cannot access an authorized document linked to a different client on the same case', async (t) => {
  const calls = setupRequest(t, 'client', async (sql, parameters) => {
    assert.match(sql, /d\.access_level = 'authorized_users'/);
    assert.match(sql, /c\.client_id = d\.client_id/);
    assert.match(sql, /c\.user_id = \$2/);
    assert.match(sql, /i\.case_id = d\.case_id/);
    assert.ok(parameters.includes(appUserId));
    return { rowCount: 0, rows: [] };
  });
  assert.equal(
    (await request('GET', `/api/documents/${documentId}/download`)).status,
    404
  );
  assert.equal(calls.length, 2);
});

test('document lists enforce scoped search, case filters, stable pagination, and safe fields', async (t) => {
  const calls = setupRequest(t, 'admin', async (sql, parameters) => {
    assert.doesNotMatch(sql, /SELECT \*/i);
    if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ total: 1 }] };
    return {
      rowCount: 1,
      rows: [{
        document_id: documentId,
        file_name: 'evidence.pdf',
        mime_type: 'application/pdf',
        document_type: 'evidence',
        source: null,
        document_date: null,
        access_level: 'restricted',
        created_at: '2026-01-01T00:00:00.000Z',
        case_id: caseId,
        client_id: clientId,
        user_id: appUserId,
        storage_key: `${documentId}.pdf`,
      }],
    };
  });
  const response = await request(
    'GET',
    `/api/documents?page=2&pageSize=999&caseId=${caseId}&search=%25_%27`
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.pagination.pageSize, 50);
  assert.equal(body.documents.length, 1);
  assert.equal('storage_key' in body.documents[0], false);
  assert.equal('user_id' in body.documents[0], false);
  assert.deepEqual(calls[1].parameters, [caseId, "%\\%\\_'%"]);
  assert.deepEqual(calls[2].parameters, [caseId, "%\\%\\_'%", 50, 50]);
  assert.match(calls[2].sql, /ORDER BY d\.created_at DESC, d\.document_id ASC/);
});

test('clients cannot upload documents and malformed document UUIDs fail before document lookup', async (t) => {
  const calls = setupRequest(t, 'client');
  const uploadResponse = await request('POST', `/api/cases/${caseId}/documents`, {
    headers: uploadHeaders(),
    body: Buffer.from('%PDF-1.7'),
  });
  assert.equal(uploadResponse.status, 403);
  assert.equal((await request('GET', '/api/documents/not-a-uuid')).status, 400);
  assert.equal(calls.length, 2);
  assert.deepEqual(await readdir(storageDirectory), []);
});

test('clients cannot modify document metadata or access levels', async (t) => {
  const calls = setupRequest(t, 'client');
  for (const body of [
    { source: 'client-controlled source' },
    { document_type: 'client-controlled type' },
    { document_date: '2026-02-01' },
    { access_level: 'public' },
  ]) {
    const response = await request('PATCH', `/api/documents/${documentId}`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 403);
    const responseBody = await response.json();
    assert.deepEqual(responseBody, {
      error: 'You do not have permission to access this resource.',
    });
  }
  assert.equal(
    calls.filter(({ sql }) => /UPDATE documents/i.test(sql)).length,
    0,
    'Authorization must reject client metadata updates before document writes.'
  );
});

test('client can download a document only for their own linked client record', async (t) => {
  setupRequest(t, 'client', async (sql, parameters) => {
    assert.match(sql, /c\.client_id = d\.client_id/);
    assert.match(sql, /i\.case_id = d\.case_id/);
    assert.ok(parameters.includes(appUserId));
    return {
      rowCount: 1,
      rows: [{
        ...storedDocument,
        access_level: 'authorized_users',
        client_id: clientId,
      }],
    };
  });
  storedDocument = {
    document_id: documentId,
    file_name: 'evidence.pdf',
    mime_type: 'application/pdf',
    document_type: 'evidence',
    source: null,
    document_date: null,
    access_level: 'authorized_users',
    created_at: '2026-01-01T00:00:00.000Z',
    case_id: caseId,
    client_id: clientId,
    storage_key: `${documentId}.pdf`,
  };
  const filePath = path.join(storageDirectory, storedDocument.storage_key);
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(storageDirectory, { recursive: true });
  await writeFile(filePath, '%PDF-1.7\nAuthorized document', { flag: 'wx' });

  const response = await request('GET', `/api/documents/${documentId}/download`);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await response.text(), '%PDF-1.7\nAuthorized document');
});

test('metadata updates reject ownership, storage, and client-supplied access fields', async (t) => {
  const calls = setupRequest(t, 'admin');
  for (const body of [
    { user_id: appUserId },
    { storage_key: 'other.pdf' },
    { client_id: clientId },
  ]) {
    assert.equal((await request('PATCH', `/api/documents/${documentId}`, { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })).status, 400);
  }
  assert.equal(calls.length, 3);
});

test('staff metadata updates remain scoped to their current case assignment', async (t) => {
  const calls = setupRequest(t, 'assistant', async (sql, parameters) => {
    assert.match(sql, /UPDATE documents AS d/);
    assert.match(sql, /FROM assigned_to assignment/);
    assert.match(sql, /assignment\.user_id = \$3/);
    assert.match(sql, /d\.access_level = 'case_team'/);
    assert.match(sql, /d\.user_id = \$3/);
    assert.ok(parameters.includes(appUserId));
    return { rowCount: 0, rows: [] };
  });
  const response = await request('PATCH', `/api/documents/${documentId}`, {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'updated source' }),
  });
  assert.equal(response.status, 404);
  assert.equal(calls.length, 2);
});

test('unexpected database errors are not logged with messages or stack traces', (t) => {
  const logCalls = [];
  t.mock.method(console, 'error', (...args) => logCalls.push(args));
  const response = {
    statusCode: 200,
    body: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  const error = new Error('database detail contains private legal metadata');
  error.code = 'XX000';
  error.stack = 'stack trace contains a storage key';

  errorHandler(error, {}, response, () => {});

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { error: 'Internal server error' });
  assert.deepEqual(logCalls, [[
    'Request failed',
    { name: 'Error', status: 500, code: 'XX000' },
  ]]);
  assert.doesNotMatch(JSON.stringify(logCalls), /private legal metadata|storage key|stack trace/);
});
