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

test('behind the local reverse proxy, TRUST_PROXY=loopback counts each visitor by X-Real-IP', async () => {
  const { clientAddressOf } = await import('../src/middleware/rateLimit.js');
  const viaProxy = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-real-ip': '203.0.113.7' } };
  assert.equal(clientAddressOf(viaProxy, { TRUST_PROXY: 'loopback' }), '203.0.113.7');
  // Off by default: the header is ignored.
  assert.equal(clientAddressOf(viaProxy, {}), '127.0.0.1');
  // A direct (non-local) caller cannot claim another address.
  const direct = { socket: { remoteAddress: '198.51.100.9' }, headers: { 'x-real-ip': '203.0.113.7' } };
  assert.equal(clientAddressOf(direct, { TRUST_PROXY: 'loopback' }), '198.51.100.9');
  // Garbage in the header falls back to the peer.
  const garbage = { socket: { remoteAddress: '::1' }, headers: { 'x-real-ip': 'not-an-ip' } };
  assert.equal(clientAddressOf(garbage, { TRUST_PROXY: 'loopback' }), '::1');
});

test('with TRUST_PROXY=loopback, two visitors behind the proxy have separate limits', () => {
  const limiter = createRateLimit({ maxRequests: 1, env: { TRUST_PROXY: 'loopback' } });
  const send = (ip) => {
    let passed = false;
    limiter(
      { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-real-ip': ip } },
      { setHeader() {}, status() { return this; }, json() { return this; } },
      () => { passed = true; }
    );
    return passed;
  };
  assert.equal(send('203.0.113.1'), true);
  assert.equal(send('203.0.113.2'), true);
  assert.equal(send('203.0.113.1'), false);
});
