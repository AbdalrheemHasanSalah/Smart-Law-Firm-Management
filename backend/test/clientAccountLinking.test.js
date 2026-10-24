import assert from 'node:assert/strict';
import { test } from 'node:test';
import dotenv from 'dotenv';

dotenv.config = () => ({ parsed: {} });

const { pool } = await import('../src/config/db.js');
const { ClientServiceError, linkClientAccount } = await import('../src/services/clientService.js');

const actor = {
  user_id: '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a',
  role: 'admin',
};
const clientId = '1cdd115e-0279-48b4-a795-1be1d5a50d0b';
const userId = '8bf121a3-7cf3-4c44-8a56-65a05dd1c9b1';

function setupLinkService(t, queryOverride) {
  const queries = [];
  const releaseState = { count: 0, error: undefined };
  let connectCount = 0;

  const transactionClient = {
    async query(sql, parameters = []) {
      queries.push({ sql, parameters });
      const overridden = await queryOverride?.(sql, parameters);
      if (overridden !== undefined) return overridden;

      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: null, rows: [] };
      }
      if (sql.includes('FROM clients WHERE client_id')) {
        return { rowCount: 1, rows: [{ client_id: clientId, user_id: null }] };
      }
      if (sql.includes('FROM app_users u')) {
        return { rowCount: 1, rows: [{ user_id: userId }] };
      }
      if (sql.includes('FROM clients WHERE user_id')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('UPDATE clients')) {
        return { rowCount: 1, rows: [{ client_id: clientId, user_id: userId }] };
      }
      if (sql.includes('INSERT INTO audit_logs')) {
        return { rowCount: 1, rows: [] };
      }
      assert.fail(`Unexpected transaction query: ${sql}`);
    },
    release(error) {
      releaseState.count += 1;
      releaseState.error = error;
    },
  };

  t.mock.method(pool, 'connect', async () => {
    connectCount += 1;
    return transactionClient;
  });

  return {
    queries,
    releaseState,
    transactionClient,
    get connectCount() {
      return connectCount;
    },
  };
}

async function expectServiceError(promise, status) {
  await assert.rejects(
    promise,
    (error) => error instanceof ClientServiceError && error.status === status
  );
}

test('linking validates authorization, UUIDs, and the exact request body before checkout', async (t) => {
  const state = setupLinkService(t);
  const invalidRequests = [
    [{ ...actor, role: 'lawyer' }, clientId, { user_id: userId }, 403],
    [{ ...actor, user_id: 'invalid' }, clientId, { user_id: userId }, 403],
    [actor, 'invalid', { user_id: userId }, 400],
    [actor, clientId, {}, 400],
    [actor, clientId, { user_id: 'invalid' }, 400],
    [actor, clientId, { user_id: userId, email: 'not-allowed@example.test' }, 400],
    [actor, clientId, null, 400],
  ];

  for (const [requestActor, requestClientId, body, status] of invalidRequests) {
    await expectServiceError(
      linkClientAccount(requestActor, requestClientId, body),
      status
    );
  }

  assert.equal(state.connectCount, 0);
  assert.deepEqual(state.queries, []);
});

test('linking checks eligible records, updates, audits, and commits in one transaction', async (t) => {
  const state = setupLinkService(t);

  assert.deepEqual(await linkClientAccount(actor, clientId, { user_id: userId }), {
    client_id: clientId,
    user_id: userId,
    linked: true,
  });
  assert.deepEqual(state.queries.map(({ sql }) => (
    sql.trim().split(/\s+/).slice(0, 2).join(' ')
  )), [
    'BEGIN',
    'SELECT client_id,',
    'SELECT u.user_id',
    'SELECT client_id',
    'UPDATE clients',
    'INSERT INTO',
    'COMMIT',
  ]);
  assert.deepEqual(state.queries[1].parameters, [clientId]);
  assert.match(state.queries[2].sql, /r\.role_name = 'client'/);
  assert.match(state.queries[2].sql, /u\.status = 'active'/);
  assert.match(state.queries[2].sql, /u\.auth_user_id IS NOT NULL/);
  assert.deepEqual(state.queries[2].parameters, [userId]);
  assert.deepEqual(state.queries[3].parameters, [userId, clientId]);
  assert.deepEqual(state.queries[4].parameters, [clientId, userId]);
  assert.deepEqual(state.queries[5].parameters, [
    'client_account_linked',
    'client',
    clientId,
    JSON.stringify({ linked_user_id: userId }),
    actor.user_id,
  ]);
  assert.deepEqual(state.queries[6].parameters, []);
  assert.equal(state.connectCount, 1);
  assert.equal(state.releaseState.count, 1);
  assert.equal(state.releaseState.error, undefined);
});

test('linking rolls back and releases when the client record does not exist', async (t) => {
  const state = setupLinkService(t, async (sql) => (
    sql.includes('FROM clients WHERE client_id')
      ? { rowCount: 0, rows: [] }
      : undefined
  ));

  await expectServiceError(linkClientAccount(actor, clientId, { user_id: userId }), 404);

  assert.equal(state.queries.at(-1).sql, 'ROLLBACK');
  assert.equal(state.releaseState.count, 1);
});

test('linking rejects an ineligible application account and rolls back', async (t) => {
  const state = setupLinkService(t, async (sql) => (
    sql.includes('FROM app_users u')
      ? { rowCount: 0, rows: [] }
      : undefined
  ));

  await expectServiceError(linkClientAccount(actor, clientId, { user_id: userId }), 404);

  assert.equal(state.queries.at(-1).sql, 'ROLLBACK');
  assert.equal(state.releaseState.count, 1);
});

test('linking rejects an already-linked client without updating or auditing', async (t) => {
  const state = setupLinkService(t, async (sql) => (
    sql.includes('FROM clients WHERE client_id')
      ? { rowCount: 1, rows: [{ client_id: clientId, user_id: actor.user_id }] }
      : undefined
  ));

  await expectServiceError(linkClientAccount(actor, clientId, { user_id: userId }), 409);

  assert.equal(state.queries.at(-1).sql, 'ROLLBACK');
  assert.equal(state.queries.some(({ sql }) => sql.includes('UPDATE clients')), false);
  assert.equal(state.queries.some(({ sql }) => sql.includes('INSERT INTO audit_logs')), false);
  assert.equal(state.releaseState.count, 1);
});

test('linking rejects an application account already linked to another client', async (t) => {
  const state = setupLinkService(t, async (sql) => (
    sql.includes('FROM clients WHERE user_id')
      ? { rowCount: 1, rows: [{ client_id: 'another-client' }] }
      : undefined
  ));

  await expectServiceError(linkClientAccount(actor, clientId, { user_id: userId }), 409);

  assert.equal(state.queries.at(-1).sql, 'ROLLBACK');
  assert.equal(state.queries.some(({ sql }) => sql.includes('UPDATE clients')), false);
  assert.equal(state.releaseState.count, 1);
});

test('audit insertion failure rolls back the relationship update and releases the client', async (t) => {
  const auditError = new Error('audit insert failed');
  const state = setupLinkService(t, async (sql) => {
    if (sql.includes('INSERT INTO audit_logs')) throw auditError;
    return undefined;
  });

  await assert.rejects(
    linkClientAccount(actor, clientId, { user_id: userId }),
    (error) => error === auditError
  );

  assert.equal(state.queries.at(-2).sql.includes('INSERT INTO audit_logs'), true);
  assert.equal(state.queries.at(-1).sql, 'ROLLBACK');
  assert.equal(state.queries.some(({ sql }) => sql === 'COMMIT'), false);
  assert.equal(state.releaseState.count, 1);
  assert.equal(state.releaseState.error, undefined);
});

test('a failed BEGIN releases the checked-out client with the error', async (t) => {
  const beginError = new Error('begin failed');
  const state = setupLinkService(t, async (sql) => {
    if (sql === 'BEGIN') throw beginError;
    return undefined;
  });

  await assert.rejects(
    linkClientAccount(actor, clientId, { user_id: userId }),
    (error) => error === beginError
  );

  assert.deepEqual(state.queries.map(({ sql }) => sql), ['BEGIN']);
  assert.equal(state.releaseState.count, 1);
  assert.equal(state.releaseState.error, beginError);
});

test('a rollback failure reports an unsafe rollback and discards the client', async (t) => {
  const auditError = new Error('audit insert failed');
  const rollbackError = new Error('rollback failed');
  const state = setupLinkService(t, async (sql) => {
    if (sql.includes('INSERT INTO audit_logs')) throw auditError;
    if (sql === 'ROLLBACK') throw rollbackError;
    return undefined;
  });
  t.mock.method(console, 'error', () => {});

  await expectServiceError(linkClientAccount(actor, clientId, { user_id: userId }), 500);

  assert.equal(state.queries.at(-1).sql, 'ROLLBACK');
  assert.equal(state.releaseState.count, 1);
  assert.equal(state.releaseState.error, rollbackError);
});
