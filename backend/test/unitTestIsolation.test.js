import assert from 'node:assert/strict';
import pg from 'pg';
import { test } from 'node:test';

import { pool } from '../src/config/db.js';

test('unit tests fail closed if any PostgreSQL connection or query is attempted', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.LAW_FIRM_UNIT_TEST_MODE, 'true');

  const client = new pg.Client();
  assert.throws(
    () => client.connect(),
    /PostgreSQL connections are disabled during backend unit tests/
  );

  const driverPool = new pg.Pool();
  assert.throws(
    () => driverPool.connect(),
    /PostgreSQL connections are disabled during backend unit tests/
  );
  await driverPool.end();

  assert.throws(
    () => pool.connect(),
    /PostgreSQL access is disabled during unit tests/
  );
  assert.throws(
    () => pool.query('SELECT 1'),
    /PostgreSQL access is disabled during unit tests/
  );
});
