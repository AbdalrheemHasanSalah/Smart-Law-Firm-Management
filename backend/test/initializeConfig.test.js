import assert from 'node:assert/strict';
import { test } from 'node:test';

const { getDbConfig } = await import('../database/initialize.js');

const CONFIG_KEYS = [
  'DATABASE_URL',
  'DB_SSL',
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'PGUSER',
];

test('database initializer verifies TLS certificates for URL and field configurations', () => {
  const original = Object.fromEntries(
    CONFIG_KEYS.map((key) => [key, process.env[key]])
  );

  try {
    process.env.DB_SSL = 'true';
    process.env.DATABASE_URL = 'postgresql://test-user@db.example.test:5432/app_test?sslmode=verify-full';
    assert.deepEqual(getDbConfig().ssl, { rejectUnauthorized: true });

    delete process.env.DATABASE_URL;
    process.env.DB_HOST = 'db.example.test';
    process.env.DB_PORT = '5432';
    process.env.DB_USER = 'test-user';
    process.env.DB_PASSWORD = 'test-password';
    process.env.DB_NAME = 'app_test';
    assert.deepEqual(getDbConfig().ssl, { rejectUnauthorized: true });

    process.env.DB_SSL = 'false';
    assert.throws(
      () => getDbConfig(),
      /DB_SSL=true is required for remote PostgreSQL connections/
    );
  } finally {
    for (const key of CONFIG_KEYS) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  }
});

test('database initializer requires an explicit nonblank DB_USER', () => {
  const original = Object.fromEntries(
    CONFIG_KEYS.map((key) => [key, process.env[key]])
  );

  try {
    delete process.env.DATABASE_URL;
    process.env.DB_HOST = 'localhost';
    process.env.DB_PASSWORD = 'test-password';
    process.env.DB_NAME = 'app_test';
    process.env.PGUSER = 'legacy-test-user';

    for (const user of [undefined, '', '   ']) {
      if (user === undefined) {
        delete process.env.DB_USER;
      } else {
        process.env.DB_USER = user;
      }

      assert.throws(
        () => getDbConfig(),
        /DB_USER must be explicitly configured when DATABASE_URL is not set/
      );
    }
  } finally {
    for (const key of CONFIG_KEYS) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  }
});

test('database initializer rejects surrounding DB_USER whitespace', () => {
  const original = Object.fromEntries(
    CONFIG_KEYS.map((key) => [key, process.env[key]])
  );

  try {
    delete process.env.DATABASE_URL;
    process.env.DB_HOST = 'localhost';
    process.env.DB_PASSWORD = 'test-password';
    process.env.DB_NAME = 'app_test';

    for (const user of [' test-user', 'test-user ']) {
      process.env.DB_USER = user;

      assert.throws(
        () => getDbConfig(),
        /DB_USER must not contain leading or trailing whitespace/
      );
    }
  } finally {
    for (const key of CONFIG_KEYS) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  }
});

test('database initializer requires an explicit nonempty DATABASE_URL username', () => {
  const original = Object.fromEntries(
    CONFIG_KEYS.map((key) => [key, process.env[key]])
  );

  try {
    process.env.DB_USER = 'discrete-test-user';
    for (const connectionString of [
      'postgresql://db.example.test:5432/app_test?sslmode=verify-full',
      'postgresql://@db.example.test:5432/app_test?sslmode=verify-full',
    ]) {
      process.env.DATABASE_URL = connectionString;

      assert.throws(
        () => getDbConfig(),
        /DATABASE_URL must include an explicit, non-empty username/
      );
    }
  } finally {
    for (const key of CONFIG_KEYS) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  }
});

test('database initializer uses DATABASE_URL instead of conflicting discrete settings', () => {
  const original = Object.fromEntries(
    CONFIG_KEYS.map((key) => [key, process.env[key]])
  );

  try {
    process.env.DATABASE_URL = 'postgresql://url-user@db.example.test:5432/url_database?sslmode=verify-full';
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '6543';
    process.env.DB_USER = 'discrete-user';
    process.env.DB_PASSWORD = 'discrete-password';
    process.env.DB_NAME = 'discrete_database';
    delete process.env.DB_SSL;

    const config = getDbConfig();

    assert.deepEqual(Object.keys(config).sort(), ['connectionString', 'ssl']);
    assert.equal(
      config.connectionString,
      'postgresql://url-user@db.example.test:5432/url_database'
    );
    assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  } finally {
    for (const key of CONFIG_KEYS) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  }
});
