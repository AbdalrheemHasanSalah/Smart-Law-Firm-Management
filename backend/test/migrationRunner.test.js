import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const {
  calculateMigrationChecksum,
  assertCompatibleHistoryTable,
  applyPendingMigrations,
  getPendingMigrations,
  readMigrationFiles,
  validateMigrationSource,
} = await import('../database/migrationRunner.js');
const {
  getMigrationTarget,
  hasDevelopmentDatabaseConnectAccess,
  parseMigrationCommand,
  verifyMigrationAuthorization,
  verifyMigrationRole,
} = await import('../database/migrate.js');

const AUTHORIZATION_TEST_TIME = Date.parse('2026-10-19T12:00:00.000Z');

function createAuthorizationFixture(target, overrides = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const fingerprint = createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex');
  const authorization = {
    environment: target.environment,
    database: target.database,
    role: target.role,
    host: target.host,
    port: target.port,
    serverAddresses: ['127.0.0.1', '::1'].sort(),
    expiresAt: new Date(AUTHORIZATION_TEST_TIME + 5 * 60 * 1000).toISOString(),
    ...overrides,
  };
  const payload = Buffer.from(JSON.stringify(authorization)).toString('base64url');
  const signature = sign(null, Buffer.from(payload, 'base64url'), privateKey)
    .toString('base64url');
  return {
    token: `${payload}.${signature}`,
    publicKeyPem,
    fingerprint,
  };
}

function createLockClient({
  unlockResult,
  unlockError,
  lockError,
  pidSequence = [200, 200, 200],
} = {}) {
  let lockHeld = false;
  let connected = true;
  let pidIndex = 0;
  const calls = [];
  return {
    calls,
    isHeld: () => lockHeld,
    disconnect() {
      connected = false;
      lockHeld = false;
    },
    async query(sql) {
      calls.push(sql);
      if (sql.includes('pg_backend_pid')) {
        if (!connected) throw new Error('coordination session disconnected');
        const pid = pidSequence[Math.min(pidIndex, pidSequence.length - 1)];
        pidIndex += 1;
        return { rows: [{ pid }] };
      }
      if (sql.includes('pg_advisory_lock')) {
        if (lockError) throw lockError;
        if (!connected) throw new Error('coordination session disconnected');
        lockHeld = true;
        return { rows: [{ pg_advisory_lock: null }] };
      }
      if (sql.includes('pg_advisory_unlock')) {
        if (unlockError) throw unlockError;
        if (!connected) throw new Error('coordination session disconnected');
        const didUnlock = unlockResult ?? lockHeld;
        if (didUnlock) lockHeld = false;
        return { rows: [{ pg_advisory_unlock: didUnlock }] };
      }
      throw new Error(`Unexpected coordination query: ${sql}`);
    },
  };
}

function createEmptyMigrationClient({ beginError, rollbackError, readError } = {}) {
  let rollbackAttempted = false;
  const client = {
    async query(sql) {
      if (sql.includes('pg_backend_pid')) return { rows: [{ pid: 100 }] };
      if (sql.includes('to_regclass')) {
        if (readError) throw readError;
        return { rows: [{ relation: null }] };
      }
      if (sql === 'BEGIN' && beginError) throw beginError;
      if (sql === 'ROLLBACK') {
        rollbackAttempted = true;
        if (rollbackError) throw rollbackError;
        return { rows: [] };
      }
      throw new Error(`Unexpected migration query: ${sql}`);
    },
  };
  return { client, wasRollbackAttempted: () => rollbackAttempted };
}

test('migration files are ordered and receive stable SHA-256 checksums', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'law-firm-migrations-'));
  try {
    await writeFile(path.join(directory, '0002_add_index.sql'), 'SELECT 2;');
    await writeFile(path.join(directory, '0001_create_table.sql'), 'SELECT 1;');

    const migrations = await readMigrationFiles(directory);
    assert.deepEqual(
      migrations.map(({ identifier }) => identifier),
      ['0001_create_table.sql', '0002_add_index.sql']
    );
    assert.equal(
      migrations[0].checksum,
      calculateMigrationChecksum('SELECT 1;')
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('migration reader rejects duplicate versions and invalid SQL filenames', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'law-firm-migrations-'));
  try {
    await writeFile(path.join(directory, '0001_first.sql'), 'SELECT 1;');
    await writeFile(path.join(directory, '0001_second.sql'), 'SELECT 2;');
    await assert.rejects(readMigrationFiles(directory), /version "0001" is duplicated/);

    await rm(path.join(directory, '0001_second.sql'));
    await writeFile(path.join(directory, 'invalid_name.sql'), 'SELECT 2;');
    await assert.rejects(readMigrationFiles(directory), /does not have a valid versioned name/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('migration source rejects transaction control and non-transactional indexes', () => {
  const transactionStatements = [
    'BEGIN TRANSACTION;',
    '/* outer /* nested */ comment */ COMMIT WORK AND NO CHAIN;',
    'ROLLBACK /* gap */ TRANSACTION;',
    'END;',
    'ABORT;',
    'START TRANSACTION;',
    "PREPARE TRANSACTION 'prepared';",
    'SET /* gap */ TRANSACTION READ ONLY;',
    'SAVEPOINT migration_step;',
    'RELEASE SAVEPOINT migration_step;',
    'DO $$ BEGIN COMMIT; END $$;',
    'CALL migration_procedure();',
  ];
  for (const source of transactionStatements) {
    assert.throws(
      () => validateMigrationSource('0001_initial.sql', source),
      /unsupported transaction-control or procedural SQL/
    );
  }
  assert.throws(
    () => validateMigrationSource('0001_cr_line.sql', '-- comment\rCOMMIT;'),
    /unsupported transaction-control or procedural SQL/
  );
  assert.doesNotThrow(() => validateMigrationSource(
    '0001_literals.sql',
    "SELECT 'COMMIT;'; -- ROLLBACK;\n/* BEGIN; */ SELECT $$ END; $$;"
  ));
  assert.throws(
    () => validateMigrationSource('0001_unclosed.sql', 'SELECT 1; /*'),
    /unterminated block comment/
  );
  assert.throws(
    () => validateMigrationSource(
      '0001_initial.sql',
      'CREATE INDEX CONCURRENTLY index_name ON table_name (column_name);'
    ),
    /non-transactional concurrent index operation/
  );
  for (const source of [
    'CREATE /* comment */ INDEX CONCURRENTLY index_name ON table_name (column_name);',
    'DROP -- comment\n INDEX /* gap */ CONCURRENTLY index_name;',
    'CREATE UNIQUE INDEX /* gap */ CONCURRENTLY index_name ON table_name (column_name);',
    'REINDEX INDEX /* gap */ CONCURRENTLY index_name;',
    'REINDEX TABLE -- comment\n CONCURRENTLY table_name;',
    'REINDEX (CONCURRENTLY) INDEX index_name;',
    'REINDEX (VERBOSE, /* gap */ CONCURRENTLY) TABLE table_name;',
    'REINDEX /* gap */ ( CONCURRENTLY ) INDEX index_name;',
  ]) {
    assert.throws(
      () => validateMigrationSource('0001_initial.sql', source),
      /non-transactional concurrent index operation/
    );
  }
  for (const source of [
    `SELECT 'CREATE INDEX CONCURRENTLY idx ON t (c);';`,
    'SELECT $$ REINDEX INDEX CONCURRENTLY idx $$;',
    `SELECT 'REINDEX (CONCURRENTLY) INDEX idx';`,
    'SELECT "CONCURRENTLY";',
    '/* CREATE INDEX CONCURRENTLY idx ON t (c); */ SELECT 1;',
  ]) {
    assert.doesNotThrow(() => validateMigrationSource('0001_literals.sql', source));
  }
});

test('applied migrations are pending only when their identifiers are not recorded', () => {
  const migrations = [
    validateMigrationSource('0001_first.sql', 'SELECT 1;'),
    validateMigrationSource('0002_second.sql', 'SELECT 2;'),
  ];
  assert.deepEqual(
    getPendingMigrations(migrations, new Map([
      ['0001_first.sql', migrations[0].checksum],
    ])).map(({ identifier }) => identifier),
    ['0002_second.sql']
  );
});

test('pending calculation rejects changed checksums and missing migration sources', () => {
  const migration = validateMigrationSource('0001_first.sql', 'SELECT 1;');
  assert.throws(
    () => getPendingMigrations([migration], new Map([['0001_first.sql', '0'.repeat(64)]])),
    /checksum mismatch/
  );
  assert.throws(
    () => getPendingMigrations([], new Map([['0001_first.sql', '0'.repeat(64)]])),
    /has no corresponding source file/
  );
});

test('migration command requires a precise mode and explicit target confirmation', () => {
  assert.deepEqual(parseMigrationCommand(['--status']), {
    mode: 'status',
    confirmation: null,
  });
  assert.deepEqual(parseMigrationCommand([
    '--up',
    '--confirm-target=isolated_database',
  ]), {
    mode: 'up',
    confirmation: 'isolated_database',
  });
  assert.throws(() => parseMigrationCommand(['--up']), /Usage:/);
});

test('migration target blocks unpinned authorization and rejects development or production targets', () => {
  const target = {
    environment: 'test',
    database: 'isolated_database',
    role: 'runner',
    host: 'localhost',
    port: 5432,
  };
  const fixture = createAuthorizationFixture(target);
  const env = {
    MIGRATION_TARGET_ENV: 'test',
    MIGRATION_DATABASE_URL: 'postgresql://runner:placeholder@localhost:5432/isolated_database',
    MIGRATION_DATABASE_NAME: 'isolated_database',
    MIGRATION_DATABASE_ROLE: 'runner',
  };
  env.MIGRATION_DATABASE_URL = 'postgresql://runner:test-only@localhost:5432/isolated_database?sslmode=verify-full';
  env.MIGRATION_AUTHORIZATION_TOKEN = fixture.token;
  env.MIGRATION_AUTHORIZATION_PUBLIC_KEY = fixture.publicKeyPem;
  assert.throws(
    () => getMigrationTarget(env),
    /until a trusted public-key fingerprint is pinned in source/
  );
  assert.throws(
    () => getMigrationTarget({
      ...env,
      MIGRATION_DATABASE_URL: 'postgresql://runner:placeholder@localhost:5432/smart_law_firm',
      MIGRATION_DATABASE_NAME: 'smart_law_firm',
    }),
    /known development database is blocked/
  );
  assert.throws(
    () => getMigrationTarget({ ...env, NODE_ENV: 'production' }),
    /disabled when NODE_ENV=production/
  );
  assert.throws(
    () => getMigrationTarget({
      ...env,
      MIGRATION_DATABASE_URL: 'postgresql://runner:test-only@127.0.0.1:5432/isolated_database',
    }),
    /sslmode=verify-full/
  );
  assert.throws(
    () => getMigrationTarget({ ...env, PGHOSTADDR: '127.0.0.1' }),
    /PGHOSTADDR must not override/
  );
  assert.throws(
    () => getMigrationTarget({ ...env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }),
    /NODE_TLS_REJECT_UNAUTHORIZED must not override/
  );
  assert.throws(
    () => getMigrationTarget({
      ...env,
      MIGRATION_DATABASE_URL: env.MIGRATION_DATABASE_URL.replace(
        '?sslmode=verify-full',
        '?sslmode=verify-full&sslrootcert=%2Ftmp%2Fca.pem'
      ),
    }),
    /sslmode=verify-full/
  );
  assert.throws(
    () => getMigrationTarget({
      ...env,
      MIGRATION_DATABASE_URL: env.MIGRATION_DATABASE_URL
        .replace('localhost', 'db.example.com')
        .replace('?sslmode=verify-full', ''),
    }),
    /sslmode=verify-full/
  );
});

test('signed authorization binds target identity, expiry, TLS policy, and server addresses', () => {
  const target = {
    environment: 'test',
    database: 'isolated_database',
    role: 'runner',
    host: '127.0.0.1',
    port: 5432,
  };
  const fixture = createAuthorizationFixture(target);
  const authorization = verifyMigrationAuthorization(
    fixture.token,
    fixture.publicKeyPem,
    target,
    fixture.fingerprint,
    AUTHORIZATION_TEST_TIME
  );
  assert.deepEqual(
    [...authorization.serverAddressAllowlist].sort(),
    ['127.0.0.1', '::1'].sort()
  );
  assert.throws(
    () => verifyMigrationAuthorization(
      fixture.token,
      fixture.publicKeyPem,
      { ...target, database: 'other_database' },
      fixture.fingerprint,
      AUTHORIZATION_TEST_TIME
    ),
    /does not match the requested, permitted target/
  );
  const productionTarget = { ...target, environment: 'production' };
  const productionFixture = createAuthorizationFixture(productionTarget);
  assert.throws(
    () => verifyMigrationAuthorization(
      productionFixture.token,
      productionFixture.publicKeyPem,
      productionTarget,
      productionFixture.fingerprint,
      AUTHORIZATION_TEST_TIME
    ),
    /does not match the requested, permitted target/
  );
  const expired = createAuthorizationFixture(target, {
    expiresAt: new Date(AUTHORIZATION_TEST_TIME - 1).toISOString(),
  });
  assert.throws(
    () => verifyMigrationAuthorization(
      expired.token,
      expired.publicKeyPem,
      target,
      expired.fingerprint,
      AUTHORIZATION_TEST_TIME
    ),
    /does not match the requested, permitted target/
  );
  const longLived = createAuthorizationFixture(target, {
    expiresAt: new Date(AUTHORIZATION_TEST_TIME + 11 * 60 * 1000).toISOString(),
  });
  assert.throws(
    () => verifyMigrationAuthorization(
      longLived.token,
      longLived.publicKeyPem,
      target,
      longLived.fingerprint,
      AUTHORIZATION_TEST_TIME
    ),
    /does not match the requested, permitted target/
  );
  assert.throws(
    () => verifyMigrationAuthorization(
      fixture.token,
      fixture.publicKeyPem,
      target,
      '0'.repeat(64),
      AUTHORIZATION_TEST_TIME
    ),
    /does not match the pinned fingerprint/
  );
  assert.throws(
    () => verifyMigrationAuthorization(
      `${fixture.token.split('.')[0]}.${Buffer.alloc(64).toString('base64url')}`,
      fixture.publicKeyPem,
      target,
      fixture.fingerprint,
      AUTHORIZATION_TEST_TIME
    ),
    /signature is invalid/
  );
});

test('development database access predicate rejects direct and PUBLIC CONNECT access', () => {
  assert.equal(hasDevelopmentDatabaseConnectAccess({
    can_connect_to_development_database: true,
    public_can_connect_to_development_database: false,
  }), true);
  assert.equal(hasDevelopmentDatabaseConnectAccess({
    can_connect_to_development_database: false,
    public_can_connect_to_development_database: true,
  }), true);
  assert.equal(hasDevelopmentDatabaseConnectAccess({
    can_connect_to_development_database: false,
    public_can_connect_to_development_database: false,
  }), false);
});

test('migration role verification rejects PUBLIC CONNECT from its catalog result', async () => {
  let executedQuery;
  const client = {
    async query(sql, parameters) {
      executedQuery = sql;
      assert.deepEqual(parameters, ['smart_law_firm']);
      return {
        rows: [{
          rolsuper: false,
          rolbypassrls: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          has_role_memberships: false,
          can_connect_to_development_database: false,
          public_can_connect_to_development_database: true,
        }],
      };
    },
  };

  await assert.rejects(
    () => verifyMigrationRole(client, { role: 'runner' }),
    /can connect to the development database/
  );
  assert.match(executedQuery, /pg_catalog\.aclexplode/);
  assert.match(executedQuery, /privilege\.grantee = 0/);
  assert.match(executedQuery, /public_can_connect_to_development_database/);
});

test('history integrity checks verify ownership, grants, triggers, rules, RLS, indexes, and structure', async () => {
  const validMetadata = {
    relkind: 'r',
    owner_name: 'runner',
    relrowsecurity: false,
    relforcerowsecurity: false,
    has_inheritance: false,
    has_triggers: false,
    has_rules: false,
    has_non_owner_privileges: false,
    has_column_privileges: false,
  };
  const validIndex = {
    indisprimary: true,
    indisunique: true,
    indisvalid: true,
    indisready: true,
    has_no_predicate: true,
    has_no_expressions: true,
    attribute_count: 1,
    indexes_version: true,
  };
  const makeClient = (metadata = {}, columns, indexes) => ({
    async query(sql) {
      if (sql.includes('FROM pg_catalog.pg_class AS relation')) {
        return { rows: [{ ...validMetadata, ...metadata }] };
      }
      if (sql === 'SELECT current_user AS role') return { rows: [{ role: 'runner' }] };
      if (sql.includes('information_schema.columns')) {
        return {
          rows: columns || [
            { column_name: 'version', data_type: 'text', is_nullable: 'NO', column_default: null, is_identity: 'NO', is_generated: 'NEVER' },
            { column_name: 'checksum', data_type: 'text', is_nullable: 'NO', column_default: null, is_identity: 'NO', is_generated: 'NEVER' },
            { column_name: 'applied_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()', is_identity: 'NO', is_generated: 'NEVER' },
          ],
        };
      }
      if (sql.includes('information_schema.table_constraints')) {
        return { rows: [{ column_name: 'version' }] };
      }
      if (sql.includes('pg_catalog.pg_constraint')) return { rows: [] };
      if (sql.includes('pg_catalog.pg_index AS index_row')) {
        return { rows: indexes || [validIndex] };
      }
      throw new Error(`Unexpected history verification query: ${sql}`);
    },
  });

  await assertCompatibleHistoryTable(makeClient());
  for (const metadata of [
    { owner_name: 'other_role' },
    { has_non_owner_privileges: true },
    { has_column_privileges: true },
    { has_triggers: true },
    { has_rules: true },
    { relrowsecurity: true },
    { relforcerowsecurity: true },
    { has_inheritance: true },
    { relkind: 'v' },
  ]) {
    await assert.rejects(
      () => assertCompatibleHistoryTable(makeClient(metadata)),
      /plain, standalone table owned only by the current migration role/
    );
  }
  await assert.rejects(
    () => assertCompatibleHistoryTable(makeClient({}, [
      { column_name: 'version', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'checksum', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'applied_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'CURRENT_TIMESTAMP' },
    ])),
    /unexpected column definition/
  );
  await assert.rejects(
    () => assertCompatibleHistoryTable(makeClient({}, undefined, [
      validIndex,
      { ...validIndex, indisprimary: false },
    ])),
    /only its valid, non-partial primary-key index/
  );
});

test('migration history and migration source commit in the same transaction', async () => {
  const statements = [];
  const history = new Map();
  let historyTableExists = false;
  let relationOid = '12345';
  let historyAtBegin;
  let relationOidAtBegin;
  let historyTableAtBegin;
  let tamperMode;
  let lockHeldDuringMigration;
  let disconnectDuringMigration = false;
  let activeLockClient = createLockClient();
  let transactionOpen = false;
  let commitFailureForVersion;
  let insertedVersion;
  let competingAppliedEntry;
  let commitWasSent = false;
  let failPostCommitHistoryRead = false;
  let injectUnknownHistoryVersionAfterCommit = false;
  const client = {
    async query(sql, parameters = []) {
      statements.push({ sql, parameters });
      if (sql.includes('pg_backend_pid')) return { rows: [{ pid: 100 }] };
      if (sql === 'BEGIN') {
        transactionOpen = true;
        historyAtBegin = new Map(history);
        relationOidAtBegin = relationOid;
        historyTableAtBegin = historyTableExists;
        return { rows: [] };
      }
      if (sql === 'ROLLBACK') {
        if (transactionOpen) {
          history.clear();
          for (const [version, checksum] of historyAtBegin) history.set(version, checksum);
          if (competingAppliedEntry) {
            history.set(competingAppliedEntry[0], competingAppliedEntry[1]);
          }
          relationOid = relationOidAtBegin;
          historyTableExists = historyTableAtBegin;
          transactionOpen = false;
        }
        return { rows: [] };
      }
      if (sql === 'COMMIT') {
        transactionOpen = false;
        commitWasSent = true;
        if (insertedVersion === commitFailureForVersion) {
          throw new Error('commit response lost after server commit');
        }
        return { rows: [] };
      }
      if (sql.includes('FROM pg_catalog.pg_class AS relation')) {
        return {
          rows: [{
            relkind: 'r',
            owner_name: 'runner',
            relrowsecurity: false,
            relforcerowsecurity: false,
            has_inheritance: false,
            has_triggers: false,
            has_rules: false,
            has_non_owner_privileges: false,
            has_column_privileges: false,
          }],
        };
      }
      if (sql.includes('SELECT oid::text AS relation_oid')) {
        return { rows: [{ relation_oid: relationOid }] };
      }
      if (sql === 'SELECT current_user AS role') return { rows: [{ role: 'runner' }] };
      if (sql.includes('to_regclass')) {
        return { rows: [{ relation: historyTableExists ? 'schema_migrations' : null }] };
      }
      if (sql.includes('CREATE TABLE public.schema_migrations')) {
        historyTableExists = true;
        return { rows: [] };
      }
      if (sql.startsWith('INSERT INTO public.schema_migrations')) {
        insertedVersion = parameters[0];
        history.set(parameters[0], parameters[1]);
        return { rows: [] };
      }
      if (sql === 'SELECT pg_catalog.pg_advisory_unlock_all();') {
        lockHeldDuringMigration = activeLockClient.isHeld();
        if (disconnectDuringMigration) activeLockClient.disconnect();
        if (tamperMode === 'row') {
          history.set('0001_create_example.sql', 'tampered');
        }
        if (tamperMode === 'delete') history.delete('0001_create_example.sql');
        if (tamperMode === 'relation') relationOid = 'replacement';
        return { rows: [] };
      }
      if (sql.includes('pg_advisory_xact_lock')) {
        if (competingAppliedEntry) {
          history.set(competingAppliedEntry[0], competingAppliedEntry[1]);
        }
        return { rows: [] };
      }
      if (sql.includes('information_schema.columns')) {
        return {
          rows: [
            { column_name: 'version', data_type: 'text', is_nullable: 'NO', column_default: null, is_identity: 'NO', is_generated: 'NEVER' },
            { column_name: 'checksum', data_type: 'text', is_nullable: 'NO', column_default: null, is_identity: 'NO', is_generated: 'NEVER' },
            { column_name: 'applied_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()', is_identity: 'NO', is_generated: 'NEVER' },
          ],
        };
      }
      if (sql.includes('information_schema.table_constraints')) {
        return { rows: [{ column_name: 'version' }] };
      }
      if (sql.includes('pg_catalog.pg_constraint')) return { rows: [] };
      if (sql.includes('pg_catalog.pg_index AS index_row')) {
        return {
          rows: [{
            indisprimary: true,
            indisunique: true,
            indisvalid: true,
            indisready: true,
            has_no_predicate: true,
            has_no_expressions: true,
            attribute_count: 1,
            indexes_version: true,
          }],
        };
      }
      if (sql.includes('FROM public.schema_migrations')) {
        if (commitWasSent && failPostCommitHistoryRead) {
          failPostCommitHistoryRead = false;
          commitWasSent = false;
          throw new Error('post-commit ledger read failed');
        }
        const rows = [...history].map(([version, checksum]) => ({
          version,
          checksum,
          applied_at: '2026-01-01T00:00:00.000Z',
        }));
        if (commitWasSent && injectUnknownHistoryVersionAfterCommit) {
          injectUnknownHistoryVersionAfterCommit = false;
          commitWasSent = false;
          rows.push({
            version: '9999_unlisted.sql',
            checksum: 'a'.repeat(64),
            applied_at: '2026-01-01T00:00:00.000Z',
          });
          return { rows };
        }
        commitWasSent = false;
        return { rows };
      }
      return { rows: [] };
    },
  };
  const migration = validateMigrationSource('0001_create_example.sql', 'SELECT 1;');

  const result = await applyPendingMigrations(client, [migration], activeLockClient);

  assert.deepEqual(result, { applied: 1, pending: 0 });
  const sourceIndex = statements.findIndex(({ sql }) => sql === migration.source);
  const historyInsertIndex = statements.findIndex(({ sql }) => (
    sql.startsWith('INSERT INTO public.schema_migrations')
  ));
  const beginIndex = statements.findIndex(({ sql }) => sql === 'BEGIN');
  const isolationIndex = statements.findIndex(({ sql }) => (
    sql === 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED'
  ));
  const fenceIndex = statements.findIndex(({ sql }) => sql.includes('pg_advisory_xact_lock'));
  const postFenceLedgerReadIndex = statements.findIndex(({ sql }, index) => (
    index > fenceIndex && sql.includes('FROM public.schema_migrations')
  ));
  const commitIndex = statements.findIndex(({ sql }) => sql === 'COMMIT');
  assert.ok(beginIndex < sourceIndex);
  assert.ok(beginIndex < isolationIndex && isolationIndex < fenceIndex);
  assert.ok(fenceIndex < postFenceLedgerReadIndex);
  assert.ok(postFenceLedgerReadIndex < sourceIndex);
  assert.ok(sourceIndex < historyInsertIndex);
  assert.ok(historyInsertIndex < commitIndex);
  assert.equal(history.get(migration.identifier), migration.checksum);

  const tamperMigration = validateMigrationSource(
    '0002_tamper.sql',
    'SELECT pg_catalog.pg_advisory_unlock_all();'
  );
  for (const mode of ['row', 'delete', 'relation']) {
    tamperMode = mode;
    activeLockClient = createLockClient();
    await assert.rejects(
      () => applyPendingMigrations(
        client,
        [migration, tamperMigration],
        activeLockClient
      ),
      (error) => (
        error instanceof Error
        && error.message === `Migration "${tamperMigration.identifier}" failed; later migrations were not run.`
        && error.cause instanceof Error
        && error.cause.message.includes('modified or replaced the pre-existing migration history.')
      )
    );
    assert.equal(lockHeldDuringMigration, true);
    assert.equal(history.get(migration.identifier), migration.checksum);
    assert.equal(relationOid, '12345');
    assert.equal(history.has(migration.identifier), true);
  }

  tamperMode = undefined;
  disconnectDuringMigration = true;
  activeLockClient = createLockClient();
  const followingMigration = validateMigrationSource(
    '0003_must_not_run.sql',
    'SELECT 3;'
  );
  await assert.rejects(
    () => applyPendingMigrations(
      client,
      [migration, tamperMigration, followingMigration],
      activeLockClient
    ),
    (error) => (
      error instanceof AggregateError
      && error.errors[0]?.cause?.message.includes(
        'committed, but the coordination connection was lost'
      )
    )
  );
  assert.equal(history.has(tamperMigration.identifier), true);
  assert.equal(
    statements.some(({ sql }) => sql === followingMigration.source),
    false
  );

  disconnectDuringMigration = false;
  commitFailureForVersion = '0002_commit_uncertain.sql';
  activeLockClient = createLockClient();
  const uncertainCommit = validateMigrationSource(
    commitFailureForVersion,
    'SELECT 2;'
  );
  await assert.rejects(
    () => applyPendingMigrations(
      client,
      [migration, tamperMigration, uncertainCommit],
      activeLockClient
    ),
    (error) => (
      error.message.includes('COMMIT outcome is ambiguous')
      && error.message.includes('before retrying')
    )
  );
  assert.equal(history.has(uncertainCommit.identifier), true);

  activeLockClient = createLockClient({ pidSequence: [200, 201] });
  const changedSessionMigration = validateMigrationSource(
    '0004_changed_lock_session.sql',
    'SELECT 4;'
  );
  await assert.rejects(
    () => applyPendingMigrations(
      client,
      [migration, tamperMigration, uncertainCommit, changedSessionMigration],
      activeLockClient
    ),
    (error) => (
      error instanceof Error
      && error.cause instanceof Error
      && /coordination connection changed PostgreSQL sessions/.test(error.cause.message)
    )
  );
  assert.equal(
    statements.some(({ sql }) => sql === changedSessionMigration.source),
    false
  );

  competingAppliedEntry = [
    changedSessionMigration.identifier,
    changedSessionMigration.checksum,
  ];
  activeLockClient = createLockClient();
  const racedResult = await applyPendingMigrations(
    client,
    [migration, tamperMigration, uncertainCommit, changedSessionMigration],
    activeLockClient
  );
  assert.deepEqual(racedResult, { applied: 4, pending: 0 });
  assert.equal(transactionOpen, false);
  assert.equal(history.has(changedSessionMigration.identifier), true);
  assert.equal(
    statements.some(({ sql }) => sql === changedSessionMigration.source),
    false
  );

  const postCommitReadFailure = validateMigrationSource(
    '0005_post_commit_read_failure.sql',
    'SELECT 5;'
  );
  tamperMode = undefined;
  commitFailureForVersion = undefined;
  failPostCommitHistoryRead = true;
  activeLockClient = createLockClient();
  await assert.rejects(
    () => applyPendingMigrations(
      client,
      [
        migration,
        tamperMigration,
        uncertainCommit,
        changedSessionMigration,
        postCommitReadFailure,
      ],
      activeLockClient
    ),
    (error) => (
      error.message.includes('after committed migration(s)')
      && error.message.includes('inspect public.schema_migrations')
      && error.cause?.message.includes('post-commit ledger verification failed')
    )
  );
  assert.equal(history.has(postCommitReadFailure.identifier), true);

  const pendingCalculationFailure = validateMigrationSource(
    '0006_pending_calculation_failure.sql',
    'SELECT 6;'
  );
  injectUnknownHistoryVersionAfterCommit = true;
  activeLockClient = createLockClient();
  await assert.rejects(
    () => applyPendingMigrations(
      client,
      [
        migration,
        tamperMigration,
        uncertainCommit,
        changedSessionMigration,
        postCommitReadFailure,
        pendingCalculationFailure,
      ],
      activeLockClient
    ),
    (error) => (
      error.message.includes('after committed migration(s)')
      && error.message.includes('inspect public.schema_migrations')
      && error.cause?.message.includes('post-commit ledger verification failed')
    )
  );
  assert.equal(history.has(pendingCalculationFailure.identifier), true);

  const falseUnlockAfterCommit = validateMigrationSource(
    '0007_false_unlock_after_commit.sql',
    'SELECT 7;'
  );
  activeLockClient = createLockClient({ unlockResult: false });
  await assert.rejects(
    () => applyPendingMigrations(
      client,
      [
        migration,
        tamperMigration,
        uncertainCommit,
        changedSessionMigration,
        postCommitReadFailure,
        pendingCalculationFailure,
        falseUnlockAfterCommit,
      ],
      activeLockClient
    ),
    /cleanup failed after committed migration\(s\).*inspect public\.schema_migrations/
  );
  assert.equal(history.has(falseUnlockAfterCommit.identifier), true);

  const throwingUnlockAfterCommit = validateMigrationSource(
    '0008_throwing_unlock_after_commit.sql',
    'SELECT 8;'
  );
  const unlockFailure = new Error('unlock failed after migration commit');
  activeLockClient = createLockClient({ unlockError: unlockFailure });
  await assert.rejects(
    () => applyPendingMigrations(
      client,
      [
        migration,
        tamperMigration,
        uncertainCommit,
        changedSessionMigration,
        postCommitReadFailure,
        pendingCalculationFailure,
        falseUnlockAfterCommit,
        throwingUnlockAfterCommit,
      ],
      activeLockClient
    ),
    (error) => (
      error.message.includes('cleanup failed after committed migration(s)')
      && error.message.includes('inspect public.schema_migrations')
      && error.cause === unlockFailure
    )
  );
  assert.equal(history.has(throwingUnlockAfterCommit.identifier), true);
});

test('lock acquisition errors are preserved and an attempted unlock is checked', async () => {
  const lockFailure = new Error('lock acquisition failed');
  const fixture = createEmptyMigrationClient();

  await assert.rejects(
    () => applyPendingMigrations(
      fixture.client,
      [],
      createLockClient({ lockError: lockFailure })
    ),
    (error) => (
      error instanceof AggregateError
      && error.errors[0] === lockFailure
      && error.cause === lockFailure
    )
  );

  const noMigrations = createEmptyMigrationClient();
  await assert.rejects(
    () => applyPendingMigrations(
      noMigrations.client,
      [],
      createLockClient({ unlockResult: false })
    ),
    /coordination lock was lost/
  );
});

test('unlock exceptions are reported alongside the primary execution error', async () => {
  const primaryFailure = new Error('history read failed');
  const unlockFailure = new Error('unlock failed');
  const fixture = createEmptyMigrationClient({ readError: primaryFailure });

  await assert.rejects(
    () => applyPendingMigrations(
      fixture.client,
      [],
      createLockClient({ unlockError: unlockFailure })
    ),
    (error) => (
      error instanceof AggregateError
      && error.errors[0] === primaryFailure
      && error.errors[1] === unlockFailure
      && error.cause === primaryFailure
    )
  );
});

test('transaction setup and rollback errors preserve both causes', async () => {
  const beginFailure = new Error('transaction setup failed');
  const rollbackFailure = new Error('rollback failed');
  const fixture = createEmptyMigrationClient({
    beginError: beginFailure,
    rollbackError: rollbackFailure,
  });
  const migration = validateMigrationSource('0001_initial.sql', 'SELECT 1;');

  await assert.rejects(
    () => applyPendingMigrations(
      fixture.client,
      [migration],
      createLockClient()
    ),
    (error) => (
      error instanceof Error
      && error.message === `Migration "${migration.identifier}" failed; later migrations were not run.`
      && error.cause instanceof AggregateError
      && error.cause.message === `Migration "${migration.identifier}" failed and rollback also failed.`
      && error.cause.errors[0] === beginFailure
      && error.cause.errors[1] === rollbackFailure
      && error.cause.cause === beginFailure
    )
  );
  assert.equal(fixture.wasRollbackAttempted(), true);
});

test('failed migration rolls back and stops before recording history', async () => {
  const statements = [];
  let transactionOpen = false;
  let historyWritten = false;
  let historyTableExists = false;
  let historyTableAtBegin;
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes('pg_backend_pid')) return { rows: [{ pid: 100 }] };
      if (sql.includes('FROM pg_catalog.pg_class AS relation')) {
        return {
          rows: [{
            relkind: 'r',
            owner_name: 'runner',
            relrowsecurity: false,
            relforcerowsecurity: false,
            has_inheritance: false,
            has_triggers: false,
            has_rules: false,
            has_non_owner_privileges: false,
            has_column_privileges: false,
          }],
        };
      }
      if (sql === 'SELECT current_user AS role') return { rows: [{ role: 'runner' }] };
      if (sql === 'BEGIN') {
        transactionOpen = true;
        historyTableAtBegin = historyTableExists;
      }
      if (sql === 'COMMIT') transactionOpen = false;
      if (sql === 'ROLLBACK') {
        transactionOpen = false;
        historyTableExists = historyTableAtBegin;
      }
      if (sql.includes('to_regclass')) {
        return { rows: [{ relation: historyTableExists ? 'schema_migrations' : null }] };
      }
      if (sql.includes('CREATE TABLE public.schema_migrations')) {
        historyTableExists = true;
        return { rows: [] };
      }
      if (sql.includes('information_schema.columns')) {
        return {
          rows: [
            { column_name: 'version', data_type: 'text', is_nullable: 'NO', column_default: null, is_identity: 'NO', is_generated: 'NEVER' },
            { column_name: 'checksum', data_type: 'text', is_nullable: 'NO', column_default: null, is_identity: 'NO', is_generated: 'NEVER' },
            { column_name: 'applied_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()', is_identity: 'NO', is_generated: 'NEVER' },
          ],
        };
      }
      if (sql.includes('information_schema.table_constraints')) {
        return { rows: [{ column_name: 'version' }] };
      }
      if (sql.includes('pg_catalog.pg_constraint')) return { rows: [] };
      if (sql.includes('pg_catalog.pg_index AS index_row')) {
        return {
          rows: [{
            indisprimary: true,
            indisunique: true,
            indisvalid: true,
            indisready: true,
            has_no_predicate: true,
            has_no_expressions: true,
            attribute_count: 1,
            indexes_version: true,
          }],
        };
      }
      if (sql.includes('SELECT oid::text AS relation_oid')) {
        return { rows: [{ relation_oid: '12345' }] };
      }
      if (sql.includes('FROM public.schema_migrations')) {
        return { rows: [] };
      }
      if (sql === 'FAIL MIGRATION;') throw new Error('fixture failure');
      if (sql.startsWith('INSERT INTO public.schema_migrations')) historyWritten = true;
      return { rows: [] };
    },
  };
  const migration = validateMigrationSource('0001_failing.sql', 'FAIL MIGRATION;');

  await assert.rejects(
    () => applyPendingMigrations(client, [migration], createLockClient()),
    /failed; later migrations were not run/
  );
  assert.equal(transactionOpen, false);
  assert.equal(historyWritten, false);
  assert.equal(historyTableExists, false);
  assert.ok(statements.includes('ROLLBACK'));
});

test('migration commands are not wired into automatic application startup', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8')
  );
  const appSource = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const serverSource = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');

  assert.equal(packageJson.scripts.start.includes('migrate'), false);
  assert.equal(packageJson.scripts.dev.includes('migrate'), false);
  assert.doesNotMatch(appSource, /database[\\/]+migrate\.js/);
  assert.doesNotMatch(serverSource, /database[\\/]+migrate\.js/);
});
