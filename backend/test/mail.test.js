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

test('with SMTP settings the message goes through that mailbox (e.g. Gmail), ahead of Resend', async () => {
  let transportOptions;
  let sentMessage;
  let fetched = false;
  const sent = await sendMail(message, {
    env: { NODE_ENV: 'test', SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'office@gmail.com', SMTP_PASS: 'app-password', RESEND_API_KEY: 're_test' },
    fetchImpl: async () => {
      fetched = true;
    },
    createTransport: (options) => {
      transportOptions = options;
      return { sendMail: async (mail) => { sentMessage = mail; } };
    },
  });
  assert.equal(sent, true);
  assert.equal(fetched, false);
  assert.equal(transportOptions.port, 465);
  assert.equal(transportOptions.secure, true);
  assert.deepEqual(transportOptions.auth, { user: 'office@gmail.com', pass: 'app-password' });
  assert.deepEqual(sentMessage, { from: 'Qadiyati <office@gmail.com>', ...message });
});

test('SMTP on port 587 upgrades with STARTTLS, and a failed SMTP send is reported, never thrown', async (t) => {
  t.mock.method(console, 'error', () => {});
  let transportOptions;
  const sent = await sendMail(message, {
    env: { NODE_ENV: 'test', SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'Office <o@example.com>' },
    createTransport: (options) => {
      transportOptions = options;
      return { sendMail: async () => { throw Object.assign(new Error('auth failed'), { code: 'EAUTH' }); } };
    },
  });
  assert.equal(sent, false);
  assert.equal(transportOptions.secure, false);
  assert.equal(transportOptions.from, 'Office <o@example.com>');
});

test('incomplete SMTP settings fall back to Resend', async () => {
  let fetched = false;
  const sent = await sendMail(message, {
    env: { NODE_ENV: 'test', SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'office@gmail.com', RESEND_API_KEY: 're_test' },
    fetchImpl: async () => {
      fetched = true;
      return { ok: true, status: 200 };
    },
    createTransport: () => assert.fail('SMTP needs host, user and password'),
  });
  assert.equal(sent, true);
  assert.equal(fetched, true);
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

test('the reset email links straight to the site reset page on the configured origin', async () => {
  process.env.BETTER_AUTH_SECRET ||= 'test-only-better-auth-secret-with-32-characters';
  const { resetPageLink } = await import('../src/config/auth.js');
  assert.equal(
    resetPageLink('abc/def+', ['https://site.example', 'https://other.example']),
    'https://site.example/reset-password?token=abc%2Fdef%2B'
  );
  assert.equal(resetPageLink('', ['https://site.example']), null);
  assert.equal(resetPageLink('abc', []), null);
});
