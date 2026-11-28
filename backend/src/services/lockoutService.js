import { query } from '../config/db.js';
import { getSecurityConfig } from '../config/security.js';
import { accountLockedEmail, sendMail } from './mailService.js';

/**
 * Account lockout (phase 8). Five wrong passwords in a row for one email address lock sign-in to it
 * for 15 minutes, doubling with each new lock up to a day. A correct sign-in, the lock running out
 * (for the count only), a password reset or the office owner lifts it. Locks are kept by address
 * whether or not an account exists, so a lock reveals nothing about which addresses are registered;
 * the notice email only goes to a real account.
 */

export const MAX_FAILURES = 5;
const BASE_MINUTES = 15;
const MAX_MINUTES = 24 * 60;

export const lockMinutes = (level) => Math.min(BASE_MINUTES * 2 ** Math.max(level - 1, 0), MAX_MINUTES);

export const normalizeEmail = (value) =>
  typeof value === 'string' && value.trim() && value.length <= 255 ? value.trim().toLowerCase() : null;

/** The time the address stays locked until, or null. */
export async function lockedUntil(email, run = query) {
  const result = await run('SELECT locked_until FROM sign_in_lockouts WHERE email = $1 AND locked_until > NOW()', [email]);
  return result.rows[0]?.locked_until ?? null;
}

/**
 * Counts a wrong password. On the fifth in a row the address is locked and the count starts over;
 * the lock level grows so the next lock lasts twice as long. Returns the new lock, if one began.
 */
export async function recordFailure(email, run = query) {
  const result = await run(
    `INSERT INTO sign_in_lockouts AS l (email, failed_count, last_failed_at, updated_at)
     VALUES ($1, 1, NOW(), NOW())
     ON CONFLICT (email) DO UPDATE SET
       failed_count = l.failed_count + 1,
       last_failed_at = NOW(),
       updated_at = NOW()
     RETURNING failed_count, lock_level`,
    [email]
  );
  const { failed_count: count, lock_level: level } = result.rows[0];
  if (count < MAX_FAILURES) return null;
  const minutes = lockMinutes(level + 1);
  const locked = await run(
    `UPDATE sign_in_lockouts
        SET failed_count = 0, lock_level = lock_level + 1,
            locked_until = NOW() + make_interval(mins => $2), updated_at = NOW()
      WHERE email = $1
      RETURNING locked_until`,
    [email, minutes]
  );
  return { until: locked.rows[0].locked_until, minutes };
}

/** A correct password clears the count and the lock history. */
export async function clearLockout(email, run = query) {
  await run('DELETE FROM sign_in_lockouts WHERE email = $1', [email]);
}

async function sendLockNotice(email, minutes) {
  const account = await query("SELECT email FROM app_users WHERE lower(email) = $1 AND status = 'active' LIMIT 1", [email]);
  if (!account.rowCount) return;
  const origin = getSecurityConfig().trustedOrigins?.[0];
  if (!origin) return;
  await sendMail({ to: account.rows[0].email, ...accountLockedEmail({ url: `${origin}/forgot-password`, minutes }) });
}

/**
 * Express middleware in front of better-auth's email sign-in: refuses a locked address, and once
 * the response is out counts a wrong password (401) or clears the count after a sign-in (200).
 */
export function signInLockout(request, response, next) {
  const email = normalizeEmail(request.body?.email);
  if (!email) return next();
  lockedUntil(email)
    .then((until) => {
      if (until) {
        return response.status(429).json({
          code: 'ACCOUNT_LOCKED',
          error: 'Too many wrong passwords. Sign-in to this account is paused for a while.',
          locked_until: new Date(until).toISOString(),
        });
      }
      response.on('finish', () => {
        const settle = response.statusCode === 401
          ? recordFailure(email).then((lock) => lock && sendLockNotice(email, lock.minutes))
          : response.statusCode >= 200 && response.statusCode < 300
            ? clearLockout(email)
            : Promise.resolve();
        settle.catch((error) => console.error('Sign-in lockout could not be updated.', { name: error?.name ?? 'Error' }));
      });
      return next();
    })
    .catch(next);
}
