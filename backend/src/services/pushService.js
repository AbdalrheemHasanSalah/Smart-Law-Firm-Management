import webpush from 'web-push';
import { query } from '../config/db.js';

/**
 * Push notifications (Web Push): a short alert on a phone or computer even when the site is closed.
 *
 * Each device that accepts them registers a subscription here. Whenever the site notifies a
 * person (the in-app notification list, reminders, official notices), the same title and text are
 * pushed to each of their devices, with the page to open. Subscriptions the push service reports
 * as gone (404/410) are removed.
 *
 * Needs VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (a mailto: or https: contact) in the
 * environment; without them push is off and everything else works as before. Generate the keys
 * once with `npx web-push generate-vapid-keys`.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TITLE = 120;
const MAX_BODY = 300;
const PUSH_TTL_SECONDS = 24 * 60 * 60;

export class PushError extends Error {
  constructor(status, message, publicCode) {
    super(message);
    this.name = 'PushError';
    this.status = status;
    if (publicCode) this.publicCode = publicCode;
  }
}

const invalid = (message) => {
  throw new PushError(400, message, 'VALIDATION');
};

let sender = null;
/** Unit tests replace the sender; nothing else should call this. */
export function setPushSenderForTests(fake) {
  sender = fake;
}

export function pushConfig(env = process.env) {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject || !/^(mailto:|https:\/\/)/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

function send(subscription, payload) {
  if (sender) return sender(subscription, payload);
  const config = pushConfig();
  return webpush.sendNotification(subscription, payload, {
    TTL: PUSH_TTL_SECONDS,
    vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
  });
}

export const isPushEnabled = () => sender !== null || pushConfig() !== null;

/** The public key a browser needs to subscribe, or enabled: false. */
export function pushSettings() {
  const config = pushConfig();
  return config ? { enabled: true, public_key: config.publicKey } : { enabled: sender !== null, public_key: null };
}

function assertUser(actor) {
  if (!actor || typeof actor.user_id !== 'string' || !UUID_PATTERN.test(actor.user_id)) {
    throw new PushError(403, 'You do not have permission to access this resource.', 'FORBIDDEN');
  }
}

/** Registers (or re-registers) this device for the signed-in person. */
export async function subscribe(actor, body, userAgent) {
  assertUser(actor);
  if (!isPushEnabled()) throw new PushError(503, 'Push notifications are not configured on this server.', 'PUSH_DISABLED');
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('A subscription object is required.');
  const { endpoint, keys } = body;
  if (typeof endpoint !== 'string' || endpoint.length > 1000 || !/^https:\/\/[^\s]+$/.test(endpoint)) invalid('endpoint must be an https address.');
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' || keys.p256dh.length > 200 || keys.auth.length > 100) {
    invalid('keys.p256dh and keys.auth are required.');
  }
  // The same device signed in as someone else now belongs to them: the endpoint is unique.
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent, created_at = NOW()`,
    [actor.user_id, endpoint, keys.p256dh, keys.auth, typeof userAgent === 'string' ? userAgent.slice(0, 300) : null]
  );
  return { subscribed: true };
}

export async function unsubscribe(actor, body) {
  assertUser(actor);
  const endpoint = body?.endpoint;
  if (typeof endpoint !== 'string' || !endpoint) invalid('endpoint is required.');
  await query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, actor.user_id]);
  return { subscribed: false };
}

/**
 * Pushes one alert to every device of a person. Never throws: a failed push must not undo the
 * notification it accompanies. Returns how many devices accepted it.
 */
export async function pushToUser(userId, { title, body, url = '/' }, run = query) {
  if (!isPushEnabled()) return 0;
  try {
    const subscriptions = await run('SELECT subscription_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [userId]);
    const payload = JSON.stringify({ title: String(title).slice(0, MAX_TITLE), body: String(body ?? '').slice(0, MAX_BODY), url });
    let delivered = 0;
    for (const row of subscriptions.rows) {
      try {
        await send({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload);
        delivered += 1;
        await run('UPDATE push_subscriptions SET last_success_at = NOW() WHERE subscription_id = $1', [row.subscription_id]);
      } catch (error) {
        // Gone for good: the person uninstalled, cleared the site or revoked permission.
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await run('DELETE FROM push_subscriptions WHERE subscription_id = $1', [row.subscription_id]);
        }
      }
    }
    return delivered;
  } catch (error) {
    console.error('Push could not be sent.', { name: error?.name ?? 'Error' });
    return 0;
  }
}
