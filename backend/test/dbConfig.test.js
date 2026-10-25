import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getDatabaseConfig } from '../src/config/db.js';

const environments = ['development', 'staging', 'production'];

function remoteDiscreteConfig(NODE_ENV, DB_SSL) {
  return {
    NODE_ENV,
    DB_HOST: 'db.example.test',
    DB_USER: 'test-user',
    DB_PASSWORD: 'test-only',
    DB_NAME: 'smart_law_firm',
    ...(DB_SSL === undefined ? {} : { DB_SSL }),
  };
}

function remoteUrl(query = 'sslmode=verify-full', overrides = {}) {
  return {
    NODE_ENV: 'development',
    DATABASE_URL: `postgresql://test-user@db.example.test:5432/smart_law_firm?${query}`,
    ...overrides,
  };
}

test('remote discrete PostgreSQL connections require verified TLS in every environment', () => {
  for (const NODE_ENV of environments) {
    assert.throws(
      () => getDatabaseConfig(remoteDiscreteConfig(NODE_ENV)),
      /DB_SSL=true is required for remote PostgreSQL connections/
    );

    assert.deepEqual(
      getDatabaseConfig(remoteDiscreteConfig(NODE_ENV, 'true')).ssl,
      { rejectUnauthorized: true }
    );

    assert.throws(
      () => getDatabaseConfig(remoteDiscreteConfig(NODE_ENV, 'false')),
      /DB_SSL=true is required for remote PostgreSQL connections/
    );
  }
});

test('remote DATABASE_URL requires and sanitizes canonical verified TLS', () => {
  const config = getDatabaseConfig(
    remoteUrl('sslmode=verify-full&application_name=unit-test')
  );

  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  const sanitizedUrl = new URL(config.connectionString);
  assert.equal(sanitizedUrl.searchParams.has('sslmode'), false);
  assert.equal(sanitizedUrl.searchParams.get('application_name'), 'unit-test');
});

test('DATABASE_URL takes precedence over conflicting discrete settings', () => {
  const config = getDatabaseConfig({
    ...remoteUrl(),
    DB_HOST: 'localhost',
    DB_USER: 'discrete-user',
    DB_PASSWORD: 'discrete-password',
    DB_NAME: 'discrete_database',
  });

  assert.equal(
    config.connectionString,
    'postgresql://test-user@db.example.test:5432/smart_law_firm'
  );
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  for (const field of ['host', 'user', 'password', 'database']) {
    assert.equal(Object.hasOwn(config, field), false);
  }
});

test('DATABASE_URL requires an explicit non-empty username', () => {
  for (const DATABASE_URL of [
    'postgresql://db.example.test:5432/smart_law_firm?sslmode=verify-full',
    'postgresql://@db.example.test:5432/smart_law_firm?sslmode=verify-full',
  ]) {
    assert.throws(
      () => getDatabaseConfig({ DATABASE_URL }),
      /DATABASE_URL must include an explicit, non-empty username/
    );
  }
});

test('remote DATABASE_URL rejects missing, weak, and insecure TLS modes', () => {
  for (const query of [
    '',
    'sslmode=disable',
    'sslmode=no-verify',
    'sslmode=prefer',
    'sslmode=require',
    'sslmode=verify-ca',
  ]) {
    assert.throws(
      () => getDatabaseConfig(remoteUrl(query)),
      /sslmode=verify-full|exactly one/
    );
  }
});

test('remote DATABASE_URL rejects duplicate and noncanonical SSL parameters', () => {
  for (const query of [
    'sslmode=verify-full&sslmode=disable',
    'sslmode=verify-full&sslmode=verify-full',
    'SSLmode=verify-full',
    'sslMode=verify-full',
    '%73slmode=verify-full',
    'sslmode=verify%2Dfull',
  ]) {
    assert.throws(
      () => getDatabaseConfig(remoteUrl(query)),
      /SSL parameter|sslmode=verify-full|exactly one/
    );
  }
});

test('remote DATABASE_URL rejects unsupported and conflicting SSL parameters', () => {
  for (const query of [
    'sslmode=verify-full&ssl=0',
    'sslmode=verify-full&sslmode=no-verify',
    'sslmode=verify-full&sslrootcert=C%3A%5Ccerts%5Croot.pem',
    'sslmode=verify-full&sslcert=C%3A%5Ccerts%5Cclient.pem',
    'sslmode=verify-full&sslkey=C%3A%5Ccerts%5Cclient.key',
    'sslmode=verify-full&sslnegotiation=direct',
    'sslmode=verify-full&uselibpqcompat=true',
    'sslmode=verify-full&ssl_future_option=value',
  ]) {
    assert.throws(
      () => getDatabaseConfig(remoteUrl(query)),
      /unsupported or unsafe SSL parameter/
    );
  }
});

test('remote DATABASE_URL rejects contradictory DB_SSL configuration', () => {
  assert.throws(
    () => getDatabaseConfig(remoteUrl('sslmode=verify-full', { DB_SSL: 'false' })),
    /DB_SSL must be true when configured/
  );

  assert.deepEqual(
    getDatabaseConfig(remoteUrl('sslmode=verify-full', { DB_SSL: 'true' })).ssl,
    { rejectUnauthorized: true }
  );
});

test('URL host overrides are classified by their effective host', () => {
  const remoteHostOverride = getDatabaseConfig({
    DATABASE_URL: 'postgresql://unit-test-user@localhost:5432/smart_law_firm?host=db.example.test&sslmode=verify-full',
  });
  assert.deepEqual(remoteHostOverride.ssl, { rejectUnauthorized: true });
  assert.equal(new URL(remoteHostOverride.connectionString).searchParams.has('sslmode'), false);

  assert.throws(
    () => getDatabaseConfig({
      DATABASE_URL: 'postgresql://unit-test-user@localhost:5432/smart_law_firm?host=localhost&host=db.example.test',
    }),
    /duplicate host parameters/
  );
});

test('local development PostgreSQL loopback hosts do not require TLS', () => {
  for (const DB_HOST of [
    'localhost',
    'api.localhost',
    '127.0.0.1',
    '127.42.0.9',
    '::1',
    '0:0:0:0:0:0:0:1',
  ]) {
    const config = getDatabaseConfig({
      NODE_ENV: 'development',
      DB_HOST,
      DB_USER: 'test-user',
      DB_PASSWORD: 'test-only',
      DB_NAME: 'smart_law_firm',
    });

    assert.equal(config.host, DB_HOST);
    assert.equal(config.ssl, undefined);
  }
});

test('local Unix-socket connections do not require TLS', () => {
  const config = getDatabaseConfig({
    NODE_ENV: 'development',
    DB_HOST: '/var/run/postgresql',
    DB_USER: 'test-user',
    DB_PASSWORD: 'test-only',
    DB_NAME: 'smart_law_firm',
  });

  assert.equal(config.host, '/var/run/postgresql');
  assert.equal(config.ssl, undefined);
});

test('local DATABASE_URL connections remain usable without TLS', () => {
  const config = getDatabaseConfig({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://unit-test-user@localhost:5432/smart_law_firm',
  });

  assert.equal(config.connectionString, 'postgresql://unit-test-user@localhost:5432/smart_law_firm');
  assert.equal(config.ssl, undefined);
});

test('local DATABASE_URL Unix-socket hosts remain usable without TLS', () => {
  const connectionString = 'postgresql://unit-test-user@localhost:5432/smart_law_firm?host=%2Fvar%2Frun%2Fpostgresql';
  const config = getDatabaseConfig({ DATABASE_URL: connectionString });

  assert.equal(config.connectionString, connectionString);
  assert.equal(config.ssl, undefined);
});

test('missing hosts fail closed and unrecognized hosts require TLS', () => {
  assert.throws(
    () => getDatabaseConfig({
      NODE_ENV: 'development',
      DB_USER: 'test-user',
      DB_PASSWORD: 'test-only',
      DB_NAME: 'smart_law_firm',
    }),
    /host must be explicitly configured/
  );

  assert.throws(
    () => getDatabaseConfig({
      ...remoteDiscreteConfig('development'),
      DB_HOST: 'unrecognized host',
    }),
    /DB_SSL=true is required for remote PostgreSQL connections/
  );

  assert.throws(
    () => getDatabaseConfig({
      DATABASE_URL: 'postgresql://unit-test-user@unrecognized-host:5432/smart_law_firm',
    }),
    /sslmode=verify-full/
  );
});

test('discrete PostgreSQL configuration requires an explicit nonblank DB_USER', () => {
  for (const missingUser of [
    {},
    { DB_USER: '' },
    { DB_USER: '   ' },
  ]) {
    assert.throws(
      () => getDatabaseConfig({
        NODE_ENV: 'development',
        DB_HOST: 'localhost',
        DB_PASSWORD: 'test-only',
        PGUSER: 'legacy-user',
        ...missingUser,
      }),
      /DB_USER must be explicitly configured when DATABASE_URL is not set/
    );
  }
});

test('discrete PostgreSQL configuration rejects surrounding DB_USER whitespace', () => {
  for (const DB_USER of [' test-user', 'test-user ']) {
    assert.throws(
      () => getDatabaseConfig({
        NODE_ENV: 'development',
        DB_HOST: 'localhost',
        DB_USER,
        DB_PASSWORD: 'test-only',
        DB_NAME: 'smart_law_firm',
      }),
      /DB_USER must not contain leading or trailing whitespace/
    );
  }
});
