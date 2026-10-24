import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getSecurityConfig } from '../src/config/security.js';

const productionConfig = {
  NODE_ENV: 'production',
  BETTER_AUTH_URL: 'https://api.example.test',
  TRUSTED_FRONTEND_ORIGINS: 'https://firm.example.test, https://portal.example.test',
};

test('production security config accepts explicit HTTPS origins', () => {
  assert.deepEqual(getSecurityConfig(productionConfig), {
    production: true,
    enforceOriginProtection: true,
    baseUrl: 'https://api.example.test',
    trustedOrigins: ['https://firm.example.test', 'https://portal.example.test'],
  });
});

test('production security config rejects missing and insecure Better Auth URLs', () => {
  assert.throws(
    () => getSecurityConfig({ ...productionConfig, BETTER_AUTH_URL: undefined }),
    /BETTER_AUTH_URL or APP_URL must be configured/
  );
  assert.throws(
    () => getSecurityConfig({ ...productionConfig, BETTER_AUTH_URL: 'http://api.example.test' }),
    /must use HTTPS in production/
  );
  assert.throws(
    () => getSecurityConfig({ ...productionConfig, BETTER_AUTH_URL: 'not-a-url' }),
    /must be a valid URL/
  );
});

test('production security config requires explicit HTTPS frontend origins', () => {
  assert.throws(
    () => getSecurityConfig({
      NODE_ENV: 'production',
      BETTER_AUTH_URL: productionConfig.BETTER_AUTH_URL,
    }),
    /TRUSTED_FRONTEND_ORIGINS or FRONTEND_URL must be configured/
  );
  assert.throws(
    () => getSecurityConfig({
      ...productionConfig,
      TRUSTED_FRONTEND_ORIGINS: 'http://firm.example.test',
    }),
    /Trusted frontend origins must use HTTPS/
  );
});

test('development keeps explicit local HTTP defaults', () => {
  assert.deepEqual(getSecurityConfig({ NODE_ENV: 'development' }), {
    production: false,
    enforceOriginProtection: false,
    baseUrl: 'http://localhost:3000',
    trustedOrigins: ['http://localhost:5173'],
  });
});

test('non-production environments can explicitly enable origin protection', () => {
  const config = getSecurityConfig({
    NODE_ENV: 'staging',
    ENFORCE_ORIGIN_PROTECTION: 'true',
    BETTER_AUTH_URL: 'https://staging-api.example.test',
    TRUSTED_FRONTEND_ORIGINS: 'https://staging.example.test',
  });
  assert.equal(config.enforceOriginProtection, true);
});

test('production cannot disable origin protection', () => {
  assert.throws(
    () => getSecurityConfig({
      ...productionConfig,
      ENFORCE_ORIGIN_PROTECTION: 'false',
    }),
    /cannot be disabled in production/
  );
});

test('origin protection configuration rejects invalid values', () => {
  assert.throws(
    () => getSecurityConfig({
      NODE_ENV: 'development',
      ENFORCE_ORIGIN_PROTECTION: 'yes',
    }),
    /must be true or false/
  );
});
