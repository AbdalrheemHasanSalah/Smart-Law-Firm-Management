import assert from 'node:assert/strict';
import { test } from 'node:test';

const { getSubscriptionConfig } = await import('../src/config/subscription.js');
const { createSupportMessage, faqAnswer, listSupportMessages, siteGuide, supportChat, updateSupportMessage } = await import(
  '../src/services/supportService.js'
);
const { setGeminiClientForTests } = await import('../src/services/hearingPrepService.js');

const messageId = '1cdd115e-0279-48b4-a795-1be1d5a50d0b';
const platform = { user_id: '6f1e8c0a-2b3d-4e5f-8a9b-0c1d2e3f4a5b', is_platform_admin: true };
const owner = { user_id: '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a', role: 'admin', office_id: '9b1f6c2e-4d3a-4f5b-8c7d-0e1f2a3b4c5d' };
const config = getSubscriptionConfig({
  SUBSCRIPTION_MONTHLY_PRICE: '100',
  SUBSCRIPTION_TRIAL_DAYS: '30',
  SUBSCRIPTION_GRACE_DAYS: '7',
  PAYMENT_BANK_IBAN: 'PS00',
  PAYMENT_WALLET_NAME: 'PalPay',
  PAYMENT_WALLET_NUMBER: '0599',
});

// The app loads backend/.env; these tests decide which AI keys exist.
for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GEMINI_API_KEY', 'AI_PROVIDER']) delete process.env[name];

function fakeQuery(answer = () => []) {
  const calls = [];
  const query = async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    const rows = answer(sql, parameters) ?? [];
    return { rowCount: rows.length, rows };
  };
  return { query, calls };
}

const rejects = (promise, status) => assert.rejects(promise, (error) => error.status === status);
const ask = (text) => ({ messages: [{ role: 'user', text }] });

/* ───────── what the bot knows ───────── */

test('the site guide carries the live price, trial, grace period and payment methods', () => {
  const guide = siteGuide(config);
  assert.match(guide, /100 شيكل لكل محامٍ شهرياً/);
  assert.match(guide, /خصم 15%/);
  assert.match(guide, /30 يوماً/);
  assert.match(guide, /7 أيام/);
  assert.match(guide, /تحويل بنكي/);
  assert.match(guide, /PalPay/);
  assert.doesNotMatch(guide, /بطاقة ائتمان/, 'card payments are not mentioned when Stripe is off');
});

test('common answers match Arabic questions whatever their spelling', () => {
  assert.match(faqAnswer('كيف اسجل مكتبي؟', config).answer, /سجّل مكتبك/);
  assert.match(faqAnswer('نسيت كلمة المرور', config).answer, /ساعة واحدة/);
  assert.match(faqAnswer('ما هي طرق الدفع', config).answer, /PalPay/);
  assert.equal(faqAnswer('xyz qwe', config), null);
});

/* ───────── the chat ───────── */

test('without an AI key the common answers reply, and unknown questions point to the management', async () => {
  let result = await supportChat(ask('كم سعر الاشتراك؟'), { config });
  assert.equal(result.source, 'faq');
  assert.match(result.reply, /100/);
  result = await supportChat(ask('سؤال لا علاقة له'), { config });
  assert.equal(result.suggest_contact, true);
});

test('with AI the reply comes from the model; the contact mark becomes a flag', async (t) => {
  process.env.GEMINI_API_KEY = 'test-key';
  t.after(() => delete process.env.GEMINI_API_KEY);
  const seen = [];
  const result = await supportChat(
    { messages: [{ role: 'assistant', text: 'مرحباً' }, { role: 'user', text: 'دفعت ولم يُعتمد' }] },
    {
      config,
      ask: async (system, history) => {
        seen.push({ system, history });
        return 'تواصل مع إدارة المنصّة. [[CONTACT]]';
      },
    }
  );
  assert.deepEqual(result, { reply: 'تواصل مع إدارة المنصّة.', suggest_contact: true, source: 'ai' });
  assert.match(seen[0].system, /<site_guide>[\s\S]*100 شيكل[\s\S]*<\/site_guide>/);
  assert.match(seen[0].system, /لا تقدّم أي رأي أو استشارة قانونية/);
  assert.deepEqual(seen[0].history, [{ role: 'user', text: 'دفعت ولم يُعتمد' }], 'the conversation starts with the visitor');
});

test('with the site in English, common answers reply in English to Arabic or English questions', async () => {
  const english = (text) => ({ messages: [{ role: 'user', text }], lang: 'en' });
  let result = await supportChat(english('كم سعر الاشتراك؟'), { config });
  assert.equal(result.source, 'faq');
  assert.match(result.reply, /100 ILS per lawyer per month/);
  assert.match(result.reply, /15% discount/);
  assert.match(result.reply, /e-wallet \(PalPay\)/);
  result = await supportChat(english('I forgot my password'), { config });
  assert.match(result.reply, /valid for one hour/);
  result = await supportChat(english('How do I invite my team?'), { config });
  assert.match(result.reply, /invitation link/);
  result = await supportChat(english('something unrelated'), { config });
  assert.match(result.reply, /^I could not find an exact answer/);
  assert.equal(result.suggest_contact, true);
  // Arabic stays the default.
  assert.match((await supportChat(ask('نسيت كلمة المرور'), { config })).reply, /ساعة واحدة/);
});

test('with the site in English the AI is told to answer in English', async (t) => {
  process.env.GEMINI_API_KEY = 'test-key';
  t.after(() => delete process.env.GEMINI_API_KEY);
  const systems = [];
  const ask2 = async (system) => {
    systems.push(system);
    return 'Click “Register your office”.';
  };
  const result = await supportChat({ messages: [{ role: 'user', text: 'How do I register?' }], lang: 'en' }, { config, ask: ask2 });
  assert.equal(result.reply, 'Click “Register your office”.');
  assert.match(systems[0], /أجب بالإنجليزية دائماً \(English only\)/);
  await supportChat(ask('كيف أسجل؟'), { config, ask: ask2 });
  assert.match(systems[1], /- أجب بالعربية/);
  assert.doesNotMatch(systems[1], /English only/);
});

test('the chat language is validated', async () => {
  await rejects(supportChat({ messages: [{ role: 'user', text: 'hi' }], lang: 'fr' }, { config }), 400);
});

test('when the AI fails the common answers still reply', async (t) => {
  process.env.GEMINI_API_KEY = 'test-key';
  t.after(() => delete process.env.GEMINI_API_KEY);
  t.mock.method(console, 'error', () => {});
  const result = await supportChat(ask('نسيت كلمة المرور'), {
    config,
    ask: async () => {
      throw Object.assign(new Error('busy'), { publicCode: 'AI_BUSY' });
    },
  });
  assert.equal(result.source, 'faq');
  assert.match(result.reply, /نسيت كلمة المرور/);
});

test('the real Gemini path is used through the shared chat helper', async (t) => {
  process.env.GEMINI_API_KEY = 'test-key';
  t.after(() => {
    delete process.env.GEMINI_API_KEY;
    setGeminiClientForTests(null);
  });
  const requests = [];
  setGeminiClientForTests({
    models: {
      generateContent: async (params) => {
        requests.push(params);
        return { text: 'من زر "سجّل مكتبك".', candidates: [{ finishReason: 'STOP' }] };
      },
    },
  });
  const result = await supportChat(ask('كيف أسجّل؟'), { config });
  assert.equal(result.source, 'ai');
  assert.equal(requests[0].model, 'gemini-3.5-flash-lite');
  assert.deepEqual(requests[0].contents, [{ role: 'user', parts: [{ text: 'كيف أسجّل؟' }] }]);
});

test('chat input is checked: roles, a question at the end, and a length limit', async () => {
  await rejects(supportChat({}, { config }), 400);
  await rejects(supportChat({ messages: [] }, { config }), 400);
  await rejects(supportChat({ messages: [{ role: 'system', text: 'x' }] }, { config }), 400);
  await rejects(supportChat({ messages: [{ role: 'user', text: 'x' }, { role: 'assistant', text: 'y' }] }, { config }), 400);
  await rejects(supportChat(ask('س'.repeat(501)), { config }), 400);
  await rejects(supportChat({ messages: [{ role: 'user', text: 'x' }], model: 'other' }, { config }), 400);
});

/* ───────── messages to the management ───────── */

test('a message is validated, stored with the chat, and linked to the account when signed in', async () => {
  const { query, calls } = fakeQuery(() => [{ message_id: messageId, created_at: '2026-11-25T00:00:00.000Z' }]);
  for (const body of [{ email: 'a@b.co', body: 'x' }, { name: 'A', email: 'nope', body: 'x' }, { name: 'A', email: 'a@b.co' }, { name: 'A', email: 'a@b.co', body: 'x', topic: 'gossip' }, { name: 'A', email: 'a@b.co', body: 'x', admin: true }]) {
    await rejects(createSupportMessage(null, body, { query }), 400);
  }
  assert.equal(calls.length, 0);

  const transcript = [{ role: 'user', text: 'q' }, { role: 'system', text: 'ignored' }, { role: 'assistant', text: 'a' }];
  const result = await createSupportMessage(owner, { name: ' سامر ', email: 'o@demo.ps', topic: 'subscription', body: ' لم يُعتمد ', transcript }, { query });
  assert.equal(result.message_id, messageId);
  assert.deepEqual(calls[0].parameters, [
    'سامر', 'o@demo.ps', null, 'subscription', 'لم يُعتمد',
    JSON.stringify([{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a' }]),
    null, owner.user_id, owner.office_id,
  ]);
});

test('a filled hidden field is treated as a bot: quiet success, nothing stored', async () => {
  const { query, calls } = fakeQuery();
  assert.deepEqual(await createSupportMessage(null, { name: 'x', email: 'x@y.co', body: 'spam', website: 'http://x' }, { query }), { message_id: null, received: true });
  assert.equal(calls.length, 0);
});

test('only the platform owner reads and answers messages; a reply is emailed when mail works', async () => {
  const { query } = fakeQuery((sql) => (sql.startsWith('UPDATE') ? [{ message_id: messageId, name: 'سامر', email: 'o@demo.ps', body: 'سؤال', status: 'in_progress' }] : []));
  await rejects(listSupportMessages(owner, {}, { query }), 403);
  await rejects(updateSupportMessage(owner, messageId, { reply: 'x' }, { query }), 403);
  await rejects(listSupportMessages(platform, { status: 'lost' }, { query }), 400);
  await rejects(updateSupportMessage(platform, messageId, {}, { query }), 400);
  await rejects(updateSupportMessage(platform, messageId, { status: 'done' }, { query }), 400);

  const sent = [];
  const result = await updateSupportMessage(platform, messageId, { reply: 'تم <التجديد>' }, { query, mail: async (message) => (sent.push(message), true) });
  assert.equal(result.emailed, true);
  assert.equal(sent[0].to, 'o@demo.ps');
  assert.match(sent[0].html, /تم &lt;التجديد&gt;/, 'the reply is escaped in the email');

  const quiet = await updateSupportMessage(platform, messageId, { reply: 'x' }, { query, mail: async () => false });
  assert.equal(quiet.emailed, false, 'without mail the reply is stored and reported as not emailed');
});
