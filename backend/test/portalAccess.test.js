import assert from 'node:assert/strict';
import { test } from 'node:test';

import { portalContext, portalsFor, withRequestedPortal } from '../src/services/portalAccess.js';

const membership = (role, is_owner = false) => ({ is_platform_admin: false, role, is_owner });

test('each sign-in page admits only the accounts of its audience', () => {
  assert.deepEqual(portalsFor([membership('admin', true)]), ['owner']);
  assert.deepEqual(portalsFor([membership('lawyer')]), ['staff']);
  assert.deepEqual(portalsFor([membership('assistant')]), ['staff']);
  assert.deepEqual(portalsFor([membership('client')]), ['client']);
});

test('an account with several roles may use each of their pages', () => {
  assert.deepEqual(portalsFor([membership('lawyer'), membership('admin', true)]), ['owner', 'staff']);
  assert.deepEqual(portalsFor([membership('client'), membership('lawyer')]), ['staff', 'client']);
});

test('an account without an office, and the platform owner, sign in as owners', () => {
  assert.deepEqual(portalsFor([{ is_platform_admin: false, role: null, is_owner: null }]), ['owner']);
  assert.deepEqual(portalsFor([{ is_platform_admin: true, role: null, is_owner: null }]), ['owner']);
  assert.deepEqual(portalsFor([{ ...membership('client'), is_platform_admin: true }]), ['owner', 'client']);
});

function run(header) {
  const outcome = { status: null, body: null, store: undefined, nextCalled: false };
  const request = { get: (name) => (name === 'x-qadiyati-portal' ? header : undefined) };
  const response = {
    status(code) {
      outcome.status = code;
      return this;
    },
    json(body) {
      outcome.body = body;
      return this;
    },
  };
  withRequestedPortal(request, response, () => {
    outcome.nextCalled = true;
    outcome.store = portalContext.getStore();
  });
  return outcome;
}

test('the requested portal reaches the auth adapter, and unknown values are refused', () => {
  assert.deepEqual(run('client').store, { portal: 'client' });
  const none = run(undefined);
  assert.equal(none.nextCalled, true);
  assert.equal(none.store, undefined);
  const unknown = run('admin');
  assert.equal(unknown.nextCalled, false);
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.code, 'VALIDATION');
});
