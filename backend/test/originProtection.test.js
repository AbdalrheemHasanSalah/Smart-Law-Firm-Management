import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createOriginProtection } from '../src/middleware/originProtection.js';

const trustedOrigins = ['https://firm.example.test'];

function runProtection(middleware, { method = 'POST', origin, fetchSite } = {}) {
  let nextCalled = false;
  let responseStatus;
  let responseBody;
  const headers = {
    origin,
    'sec-fetch-site': fetchSite,
  };
  const request = {
    method,
    get(name) {
      return headers[name.toLowerCase()];
    },
  };
  const response = {
    status(status) {
      responseStatus = status;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
  };

  middleware(request, response, () => {
    nextCalled = true;
  });

  return { nextCalled, responseStatus, responseBody };
}

test('production origin protection allows trusted unsafe requests', () => {
  const middleware = createOriginProtection({ enforce: true, trustedOrigins });
  assert.equal(
    runProtection(middleware, { origin: trustedOrigins[0] }).nextCalled,
    true
  );
});

test('production origin protection rejects missing, untrusted, and null origins', () => {
  const middleware = createOriginProtection({ enforce: true, trustedOrigins });

  for (const origin of [undefined, 'https://attacker.example.test', 'null']) {
    const result = runProtection(middleware, { origin });
    assert.equal(result.nextCalled, false);
    assert.equal(result.responseStatus, 403);
  }
});

test('production origin protection rejects cross-site fetches and permits safe requests without Origin', () => {
  const middleware = createOriginProtection({ enforce: true, trustedOrigins });
  const crossSite = runProtection(middleware, {
    origin: trustedOrigins[0],
    fetchSite: 'cross-site',
  });

  assert.equal(crossSite.responseStatus, 403);
  assert.equal(
    runProtection(middleware, { method: 'GET' }).nextCalled,
    true
  );
});

test('local development can explicitly leave origin protection disabled', () => {
  const middleware = createOriginProtection({ enforce: false, trustedOrigins });
  assert.equal(runProtection(middleware, { origin: 'https://attacker.example.test' }).nextCalled, true);
  assert.equal(runProtection(middleware, { method: 'POST' }).nextCalled, true);
});
