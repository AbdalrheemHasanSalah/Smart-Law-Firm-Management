import assert from 'node:assert/strict';
import { test } from 'node:test';

import { invitationEmail, passwordResetEmail, sendMail } from '../src/services/mailService.js';

const message = { to: 'sami@office.ps', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' };

test('without an API key nothing is sent and the caller is told so', async () => {
  let called = false;
  const sent = await sendMail(message, {
    env: { NODE_ENV: 'test' },
    fetchImpl: async () => {
      called = true;
    },
  });
  assert.equal(sent, false);
  assert.equal(called, false);
});

test('with an API key the message goes to Resend from the configured sender', async () => {
  let request;
  const sent = await sendMail(message, {
    env: { NODE_ENV: 'test', RESEND_API_KEY: 're_test', MAIL_FROM: 'Qadiyati <no-reply@q.ps>' },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200 };
    },
  });
  assert.equal(sent, true);
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.options.headers.authorization, 'Bearer re_test');
  assert.deepEqual(JSON.parse(request.options.body), {
    from: 'Qadiyati <no-reply@q.ps>',
    to: ['sami@office.ps'],
    subject: 'Hello',
    html: '<p>Hi</p>',
    text: 'Hi',
  });
});

test('a refused or failed delivery is reported, never thrown', async (t) => {
  t.mock.method(console, 'error', () => {});
  const env = { NODE_ENV: 'test', RESEND_API_KEY: 're_test' };
  assert.equal(await sendMail(message, { env, fetchImpl: async () => ({ ok: false, status: 422 }) }), false);
  assert.equal(
    await sendMail(message, {
      env,
      fetchImpl: async () => {
        throw new Error('offline');
      },
    }),
    false
  );
});

test('the invitation email names the office and role and escapes what the office typed', () => {
  const email = invitationEmail({
    officeName: 'Haddad <script>',
    role: 'lawyer',
    url: 'https://app.qadiyati.ps/invite/abc',
  });
  assert.match(email.subject, /Haddad <script>/);
  assert.equal(email.html.includes('<script>'), false);
  assert.match(email.html, /Haddad &lt;script&gt;/);
  assert.match(email.html, /محامٍ/);
  assert.match(email.html, /https:\/\/app\.qadiyati\.ps\/invite\/abc/);
  assert.match(email.text, /https:\/\/app\.qadiyati\.ps\/invite\/abc/);
});

test('the password reset email carries the reset link', () => {
  const email = passwordResetEmail({ url: 'https://app.qadiyati.ps/reset-password?token=t' });
  assert.match(email.html, /reset-password\?token=t/);
  assert.match(email.text, /reset-password\?token=t/);
});
