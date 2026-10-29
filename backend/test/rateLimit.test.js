import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRateLimit } from '../src/middleware/rateLimit.js';

function runLimiter(
  middleware,
  remoteAddress = '127.0.0.1',
  forwardedFor
) {
  const headers = new Map();
  let nextCalled = false;
  let status;
  let body;
  const request = { socket: { remoteAddress }, headers: {} };
  const response = {
    setHeader(name, value) {
      headers.set(name, value);
    },
    status(value) {
      status = value;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };

  if (forwardedFor !== undefined) {
    request.headers['x-forwarded-for'] = forwardedFor;
  }
  middleware(request, response, () => {
    nextCalled = true;
  });

  return { headers, nextCalled, status, body };
}

test('rate limiter ignores caller-supplied forwarded addresses', () => {
  const middleware = createRateLimit({ maxRequests: 1 });

  assert.equal(
    runLimiter(middleware, '192.0.2.10', '198.51.100.20').nextCalled,
    true
  );
  assert.equal(
    runLimiter(middleware, '192.0.2.10', '203.0.113.30').status,
    429
  );
  assert.equal(
    runLimiter(middleware, '192.0.2.11', '198.51.100.20').nextCalled,
    true
  );
});

test('rate limiter allows configured requests and rejects excess requests', () => {
  let currentTime = 1000;
  const middleware = createRateLimit({
    windowMs: 60000,
    maxRequests: 2,
    now: () => currentTime,
  });

  assert.equal(runLimiter(middleware).nextCalled, true);
  assert.equal(runLimiter(middleware).nextCalled, true);
  const limited = runLimiter(middleware);
  assert.equal(limited.nextCalled, false);
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, 'Too many requests. Please try again later.');
  assert.equal(limited.headers.get('Retry-After'), '60');

  currentTime += 60000;
  assert.equal(runLimiter(middleware).nextCalled, true);
});

test('rate limiter isolates remote socket addresses', () => {
  const middleware = createRateLimit({ maxRequests: 1 });
  assert.equal(runLimiter(middleware, '192.0.2.10').nextCalled, true);
  assert.equal(runLimiter(middleware, '192.0.2.11').nextCalled, true);
  assert.equal(runLimiter(middleware, '192.0.2.10').status, 429);
});
