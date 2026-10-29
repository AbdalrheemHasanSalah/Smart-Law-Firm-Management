import assert from 'node:assert/strict';
import { test } from 'node:test';

import { securityHeaders } from '../src/middleware/securityHeaders.js';

test('security headers middleware sets API-safe browser security headers', () => {
  const headers = new Map();
  let nextCalled = false;

  securityHeaders({}, {
    setHeader(name, value) {
      headers.set(name, value);
    },
  }, () => {
    nextCalled = true;
  });

  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(headers.get('X-Frame-Options'), 'DENY');
  assert.equal(headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
  assert.equal(headers.get('Permissions-Policy'), 'camera=(), microphone=(), geolocation=()');
  assert.match(headers.get('Content-Security-Policy'), /default-src 'none'/);
  assert.equal(nextCalled, true);
});
