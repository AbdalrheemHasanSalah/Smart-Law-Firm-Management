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
];

test('database initializer verifies TLS certificates for URL and field configurations', () => {
  const original = Object.fromEntries(
    CONFIG_KEYS.map((key) => [key, process.env[key]])
  );

  try {
    process.env.DB_SSL = 'true';
    process.env.DATABASE_URL = 'postgresql://test-user:test-password@db.example.test:5432/app_test';
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
