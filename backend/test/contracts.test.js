import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { PassThrough, Readable } from 'node:stream';

process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';
const storageDirectory = await mkdtemp(path.join(os.tmpdir(), 'smart-law-contracts-test-'));
process.env.DOCUMENT_STORAGE_DIR = storageDirectory;
process.env.DOCUMENT_MAX_BYTES = '2048';

const { auth } = await import('../src/config/auth.js');
const { pool } = await import('../src/config/db.js');
const { default: app } = await import('../src/app.js');
const { streamContractDownload } = await import('../src/controllers/contractController.js');

const authUserId = 'auth-user-id';
const appUserId = '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a';
const officeId = '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d';
const clientId = 'd5a39bb4-f7b6-43a0-bfca-2b16678cc514';
const caseId = '1cdd115e-0279-48b4-a795-1be1d5a50d0b';
const contractId = 'e4663540-663f-4d4d-b8f2-bfbc6a414d64';
const STORAGE_KEY_PATTERN = /^[0-9a-f-]{36}\.pdf$/i;
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
  office_id: '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d',
  role: 'admin',
};

let server;
let baseUrl;
let receivedContentLength;

before(async () => {
  server = createServer((request, response) => {
    if (request.url?.startsWith(`/api/clients/${clientId}/contracts`)) {
      receivedContentLength = request.headers['content-length'] ?? null;
    }
    app(request, response);
  });
  server.listen(0);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await pool.end();
  await rm(storageDirectory, { recursive: true, force: true });
});

afterEach(async () => {
  const entries = await readdir(storageDirectory);
  await Promise.all(entries.map((entry) => rm(path.join(storageDirectory, entry), {
    recursive: true,
    force: true,
  })));
});

function setupRequest(t, role, databaseHandler = async () => ({ rowCount: 0, rows: [] })) {
  t.mock.method(auth.api, 'getSession', async () => session);
  t.mock.method(pool, 'query', async (sql, parameters = []) => {
    if (sql.includes('u.auth_user_id')) {
      return { rowCount: 1, rows: [{ ...mappedUser, role }] };
    }
    return databaseHandler(sql, parameters);
  });
}

async function request(method, route, { headers = {}, body } = {}) {
  const isStream = body instanceof Readable;
  return fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      cookie: 'better-auth.session_token=test-session',
      ...headers,
    },
    ...(body === undefined ? {} : { body }),
    ...(isStream ? { duplex: 'half' } : {}),
  });
}

function uploadHeaders(overrides = {}) {
  return {
    'content-type': 'application/pdf',
    'x-contract-file-name': 'agreement.pdf',
    'x-contract-title': 'Client agreement',
    'x-contract-type': 'retainer',
    ...overrides,
  };
}

function contractRecord(overrides = {}) {
  return {
    contract_id: contractId,
    title: 'Client agreement',
    contract_type: 'retainer',
    status: 'draft',
    created_at: '2026-01-01T00:00:00.000Z',
    client_id: clientId,
    case_id: caseId,
    ...overrides,
  };
}

test('unauthenticated contract endpoints are rejected without database access', async (t) => {
  const calls = [];
  t.mock.method(auth.api, 'getSession', async () => null);
  t.mock.method(pool, 'query', async (...args) => {
    calls.push(args);
    return { rowCount: 0, rows: [] };
  });
  const requests = [
    ['GET', '/api/contracts'],
    ['GET', `/api/contracts/${contractId}`],
    ['GET', `/api/contracts/${contractId}/download`],
    ['PATCH', `/api/contracts/${contractId}`, { headers: { 'content-type': 'application/json' }, body: '{}' }],
    ['POST', `/api/clients/${clientId}/contracts`, { headers: uploadHeaders(), body: Buffer.from('%PDF-1.7') }],
  ];
  for (const [method, route, options] of requests) {
    assert.equal((await request(method, route, options)).status, 401);
  }
  assert.equal(calls.length, 0);
});

test('admin can list contracts with bounded filters and safe fields', async (t) => {
  setupRequest(t, 'admin', async (sql, parameters) => {
    assert.doesNotMatch(sql, /SELECT \*/i);
    if (sql.includes('COUNT(*)')) return { rowCount: 1, rows: [{ total: 1 }] };
    assert.deepEqual(parameters, [officeId, clientId, caseId, 'draft', '%\\%\\_%', 50, 50]);
    return { rowCount: 1, rows: [{ ...contractRecord(), storage_key: `${contractId}.pdf`, user_id: appUserId }] };
  });
  const response = await request(
    'GET',
    `/api/contracts?page=2&pageSize=999&clientId=${clientId}&caseId=${caseId}&status=draft&search=%25_`
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.contracts.length, 1);
  assert.equal('storage_key' in body.contracts[0], false);
  assert.equal('user_id' in body.contracts[0], false);
  assert.equal(body.pagination.pageSize, 50);
});

test('clients are scoped to their own contracts and staff to assigned cases', async (t) => {
  for (const role of ['client', 'lawyer', 'assistant']) {
    await t.test(role, async (subtest) => {
      setupRequest(subtest, role, async (sql, parameters) => {
        if (role === 'client') {
          assert.match(sql, /client_id IN \(\s*SELECT client_id FROM clients/);
        } else {
          assert.match(sql, /case_id IS NOT NULL/);
          assert.match(sql, /FROM assigned_to assignment/);
        }
        assert.ok(parameters.includes(appUserId));
        return { rowCount: 0, rows: [] };
      });
      assert.equal((await request('GET', `/api/contracts/${contractId}`)).status, 404);
    });
  }
});

test('assistant cannot change status and clients cannot update contracts', async (t) => {
  await t.test('assistant', async (subtest) => {
    const assistantCalls = [];
    setupRequest(subtest, 'assistant', async (sql, parameters) => {
      assistantCalls.push({ sql, parameters });
      return { rowCount: 0, rows: [] };
    });
    const assistantResponse = await request('PATCH', `/api/contracts/${contractId}`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Updated', status: 'signed' }),
    });
    assert.equal(assistantResponse.status, 403);
    assert.equal(assistantCalls.length, 0);
  });

  await t.test('client', async (subtest) => {
    setupRequest(subtest, 'client');
    const clientResponse = await request('PATCH', `/api/contracts/${contractId}`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Updated' }),
    });
    assert.equal(clientResponse.status, 403);
  });
});

test('contract updates reject ownership fields and invalid statuses', async (t) => {
  setupRequest(t, 'admin');
  for (const body of [
    { user_id: appUserId },
    { client_id: clientId },
    { case_id: caseId },
    { storage_key: 'unsafe.pdf' },
    { analysis_summary: 'injected' },
    { title: 'Updated', status: 'invalid' },
  ]) {
    const response = await request('PATCH', `/api/contracts/${contractId}`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
  }
});

test('contract upload verifies client/case scope before writing a file', async (t) => {
  setupRequest(t, 'lawyer', async (sql, parameters) => {
    if (sql.includes('FROM clients c')) {
      assert.match(sql, /c\.office_id = \$3/);
      assert.deepEqual(parameters, [clientId, caseId, officeId, appUserId]);
      return { rowCount: 0, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  });
  const response = await request('POST', `/api/clients/${clientId}/contracts`, {
    headers: uploadHeaders({ 'x-contract-case-id': caseId }),
    body: Buffer.from('%PDF-1.7\ncontract'),
  });
  assert.equal(response.status, 404);
  assert.deepEqual(await readdir(storageDirectory), []);
});

test('admin validation query receives exactly its SQL parameters', async (t) => {
  const calls = [];
  setupRequest(t, 'admin', async (sql, parameters) => {
    if (sql.includes('FROM clients c')) {
      calls.push({ sql, parameters });
      assert.doesNotMatch(sql, /\$4/);
      assert.deepEqual(parameters, [clientId, null, officeId]);
      return { rowCount: 1, rows: [{ client_id: clientId, case_id: null }] };
    }
    if (sql.includes('INSERT INTO contracts')) {
      return { rowCount: 1, rows: [contractRecord({ case_id: null })] };
    }
    return { rowCount: 0, rows: [] };
  });
  const response = await request('POST', `/api/clients/${clientId}/contracts`, {
    headers: uploadHeaders(),
    body: Buffer.from('%PDF-1.7\ncontract'),
  });
  assert.equal(response.status, 201);
  assert.equal(calls.length, 1);
});

test('uploads reject unsupported types, invalid signatures, and oversized bodies without Content-Length', async (t) => {
  const calls = [];
  receivedContentLength = null;
  setupRequest(t, 'admin', async (sql) => {
    if (sql.includes('FROM clients c')) return { rowCount: 1, rows: [{ client_id: clientId }] };
    calls.push(sql);
    return { rowCount: 0, rows: [] };
  });

  const unsupported = await request('POST', `/api/clients/${clientId}/contracts`, {
    headers: uploadHeaders({ 'content-type': 'application/octet-stream' }),
    body: Buffer.from('%PDF-1.7\ncontract'),
  });
  assert.equal(unsupported.status, 415);

  const invalidSignature = await request('POST', `/api/clients/${clientId}/contracts`, {
    headers: uploadHeaders(),
    body: Buffer.from('not a PDF'),
  });
  assert.equal(invalidSignature.status, 415);
  assert.deepEqual(await readdir(storageDirectory), []);

  const oversized = Buffer.concat([
    Buffer.from('%PDF-1.7\n'),
    Buffer.alloc(2048, 1),
  ]);
  const tooLarge = await request('POST', `/api/clients/${clientId}/contracts`, {
    headers: uploadHeaders(),
    body: Readable.from((async function* streamChunks() {
      yield oversized.subarray(0, 1024);
      yield oversized.subarray(1024);
    }())),
  });
  assert.equal(tooLarge.status, 413);
  assert.equal(receivedContentLength, null);
  assert.equal(calls.length, 0);
  assert.deepEqual(await readdir(storageDirectory), []);
});

test('an upload exactly at DOCUMENT_MAX_BYTES is accepted', async (t) => {
  setupRequest(t, 'admin', async (sql) => {
    if (sql.includes('FROM clients c')) return { rowCount: 1, rows: [{ client_id: clientId }] };
    if (sql.includes('INSERT INTO contracts')) return {
      rowCount: 1,
      rows: [contractRecord({ case_id: null })],
    };
    return { rowCount: 0, rows: [] };
  });
  const prefix = Buffer.from('%PDF-1.7\n');
  const payload = Buffer.concat([prefix, Buffer.alloc(2048 - prefix.length, 1)]);
  const response = await request('POST', `/api/clients/${clientId}/contracts`, {
    headers: uploadHeaders(),
    body: payload,
  });
  assert.equal(response.status, 201);
  assert.equal((await readdir(storageDirectory)).length, 1);
});

test('a failed contract INSERT removes only the newly written file', async (t) => {
  setupRequest(t, 'admin', async (sql) => {
    if (sql.includes('FROM clients c')) return { rowCount: 1, rows: [{ client_id: clientId }] };
    if (sql.includes('INSERT INTO contracts')) {
      const error = new Error('private contract database detail');
      error.code = '23505';
      throw error;
    }
    return { rowCount: 0, rows: [] };
  });
  const response = await request('POST', `/api/clients/${clientId}/contracts`, {
    headers: uploadHeaders(),
    body: Buffer.from('%PDF-1.7\ncontract'),
  });
  assert.equal(response.status, 409);
  assert.doesNotMatch(JSON.stringify(await response.json()), /private contract database detail/);
  assert.deepEqual(await readdir(storageDirectory), []);
});

test('failed contract INSERT does not remove a replacement file at the uploaded path', async (t) => {
  let replacementPath;
  setupRequest(t, 'admin', async (sql, parameters) => {
    if (sql.includes('FROM clients c')) return { rowCount: 1, rows: [{ client_id: clientId }] };
    if (sql.includes('INSERT INTO contracts')) {
      replacementPath = path.join(storageDirectory, parameters[2]);
      await rm(replacementPath);
      await writeFile(replacementPath, 'replacement contract');
      const error = new Error('private contract database detail');
      error.code = '23505';
      throw error;
    }
    return { rowCount: 0, rows: [] };
  });
  const response = await request('POST', `/api/clients/${clientId}/contracts`, {
    headers: uploadHeaders(),
    body: Buffer.from('%PDF-1.7\ncontract'),
  });
  assert.equal(response.status, 409);
  assert.equal(await readFile(replacementPath, 'utf8'), 'replacement contract');
});

test('contract download stream-construction failure closes the handle', async () => {
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
    () => streamContractDownload(response, () => {}, fileHandle, 10, contractId),
    /stream construction failed/
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closeCount, 1);
});

test('contract download stream errors and client disconnects close the handle once', async (t) => {
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

    streamContractDownload(response, () => {}, fileHandle, 10, contractId);
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

    streamContractDownload(response, () => {}, fileHandle, 10, contractId);
    response.emit('finish');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(closeCount, 1);
    response.emit('close');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(destroyed, true);
    assert.equal(closeCount, 1);
  });
});

test('clients cannot access another client contract on a shared case', async (t) => {
  setupRequest(t, 'client', async (sql, parameters) => {
    assert.match(sql, /client_id IN \(\s*SELECT client_id FROM clients/);
    assert.ok(parameters.includes(appUserId));
    return { rowCount: 0, rows: [] };
  });
  const response = await request('GET', `/api/contracts/${contractId}`);
  assert.equal(response.status, 404);
});

test('lawyers and assistants cannot access unassigned case contracts', async (t) => {
  for (const role of ['lawyer', 'assistant']) {
    await t.test(role, async (subtest) => {
      setupRequest(subtest, role, async (sql, parameters) => {
        assert.match(sql, /case_id IS NOT NULL/);
        assert.match(sql, /FROM assigned_to assignment/);
        assert.ok(parameters.includes(appUserId));
        return { rowCount: 0, rows: [] };
      });
      const response = await request('GET', `/api/contracts/${contractId}`);
      assert.equal(response.status, 404);
    });
  }
});

test('admin can upload and download a PDF without exposing storage details', async (t) => {
  setupRequest(t, 'admin', async (sql, parameters) => {
    if (sql.includes('FROM clients c')) return { rowCount: 1, rows: [{ client_id: clientId }] };
    if (sql.includes('INSERT INTO contracts')) {
      assert.equal(parameters[0], 'Client agreement');
      assert.equal(parameters[1], 'retainer');
      assert.match(parameters[2], STORAGE_KEY_PATTERN);
      return { rowCount: 1, rows: [contractRecord()] };
    }
    if (sql.includes('FROM contracts c')) {
      return { rowCount: 1, rows: [{ ...contractRecord(), storage_key: `${contractId}.pdf` }] };
    }
    return { rowCount: 0, rows: [] };
  });
  const upload = await request('POST', `/api/clients/${clientId}/contracts`, {
    headers: uploadHeaders(),
    body: Buffer.from('%PDF-1.7\ncontract'),
  });
  assert.equal(upload.status, 201);
  assert.equal('storage_key' in (await upload.clone().json()).contract, false);
  await writeFile(path.join(storageDirectory, `${contractId}.pdf`), '%PDF-1.7\ncontract');
  const download = await request('GET', `/api/contracts/${contractId}/download`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('cache-control'), 'private, no-store');
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await download.text(), '%PDF-1.7\ncontract');
});

test('non-regular contract storage paths return a safe not-found response', async (t) => {
  setupRequest(t, 'admin', async (sql) => {
    if (sql.includes('FROM contracts c')) {
      return { rowCount: 1, rows: [{ ...contractRecord(), storage_key: `${contractId}.pdf` }] };
    }
    return { rowCount: 0, rows: [] };
  });
  await mkdir(path.join(storageDirectory, `${contractId}.pdf`));
  const response = await request('GET', `/api/contracts/${contractId}/download`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Contract file not found.' });
});

test('symlinked contract files are rejected when symlinks are supported', async (t) => {
  setupRequest(t, 'admin', async (sql) => {
    if (sql.includes('FROM contracts c')) {
      return { rowCount: 1, rows: [{ ...contractRecord(), storage_key: `${contractId}.pdf` }] };
    }
    return { rowCount: 0, rows: [] };
  });
  const targetPath = path.join(storageDirectory, 'actual-contract.pdf');
  const symlinkPath = path.join(storageDirectory, `${contractId}.pdf`);
  await writeFile(targetPath, '%PDF-1.7\ncontract');
  try {
    await symlink(targetPath, symlinkPath);
  } catch (error) {
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error?.code)) {
      t.skip(`Symlinks are not supported by this environment (${error.code}).`);
      return;
    }
    throw error;
  }
  const response = await request('GET', `/api/contracts/${contractId}/download`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Contract file not found.' });
});

test('symlinked configured storage directories are rejected before creation when supported', async (t) => {
  const targetDirectory = `${storageDirectory}-target`;
  const configuredDirectory = storageDirectory;
  await rename(configuredDirectory, targetDirectory);
  try {
    await symlink(targetDirectory, configuredDirectory, 'junction');
  } catch (error) {
    await rename(targetDirectory, configuredDirectory);
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error?.code)) {
      t.skip(`Directory symlinks are not supported by this environment (${error.code}).`);
      return;
    }
    throw error;
  }
  try {
    setupRequest(t, 'admin', async (sql) => {
      if (sql.includes('FROM clients c')) return { rowCount: 1, rows: [{ client_id: clientId }] };
      return { rowCount: 0, rows: [] };
    });
    const response = await request('POST', `/api/clients/${clientId}/contracts`, {
      headers: uploadHeaders(),
      body: Buffer.from('%PDF-1.7\ncontract'),
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await readdir(targetDirectory), []);
  } finally {
    await rm(configuredDirectory, { recursive: true, force: true });
    await rename(targetDirectory, configuredDirectory);
  }
});
