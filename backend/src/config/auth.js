import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { kyselyAdapter } from '@better-auth/kysely-adapter';
import { toNodeHandler } from 'better-auth/node';
import { Kysely, PostgresDialect, sql } from 'kysely';

import { pool } from './db.js';
import { getSecurityConfig } from './security.js';
import { passwordResetEmail, sendMail } from '../services/mailService.js';
import { portalContext, portalsFor } from '../services/portalAccess.js';

const secret = process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET;

if (!secret || secret.length < 32) {
  throw new Error('BETTER_AUTH_SECRET or AUTH_SECRET must be configured with at least 32 characters.');
}

const isUnitTest = process.env.NODE_ENV === 'test'
  && process.env.LAW_FIRM_UNIT_TEST_MODE === 'true';
const securityConfig = getSecurityConfig();

const RESET_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * The link in the reset email opens the site's own reset page with the token, on the first
 * trusted frontend origin (the site's configured address, never anything from the request).
 * Better Auth's default link goes through GET /api/auth/reset-password/:token first, which a
 * click from a webmail page reaches as a cross-site request, and origin protection rightly
 * refuses those. The page then posts the token and new password from the site itself.
 */
export function resetPageLink(token, origins = securityConfig.trustedOrigins) {
  const origin = origins?.[0];
  if (!origin || typeof token !== 'string' || !token) return null;
  return `${origin}/reset-password?token=${encodeURIComponent(token)}`;
}

/**
 * Sent through mailService (SMTP or Resend). Without either the link is written to the console
 * outside production. The request answers the same either way, so it never reveals whether the
 * address has an account.
 */
async function sendResetPassword({ user, url, token }) {
  await sendMail({ to: user.email, ...passwordResetEmail({ url: resetPageLink(token) ?? url }) });
}

const db = isUnitTest
  ? null
  : new Kysely({
      dialect: new PostgresDialect({ pool }),
    });

export async function mapAuthUserToAppUser(user, query = pool.query.bind(pool)) {
  const fullName = user.name || user.email?.split('@')[0] || 'Law firm user';

  const result = await query(
    `
      INSERT INTO app_users (
        auth_user_id,
        full_name,
        email,
        email_verified,
        status,
        role_id,
        created_at,
        updated_at
      )
      SELECT
        $1,
        $2,
        $3,
        $4,
        'active',
        role_id,
        NOW(),
        NOW()
      FROM roles
      WHERE role_name = 'client'
      ON CONFLICT (auth_user_id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        email = EXCLUDED.email,
        email_verified = EXCLUDED.email_verified,
        updated_at = NOW()
    `,
    [user.id, fullName, user.email, Boolean(user.emailVerified)]
  );

  if (result.rowCount !== 1) {
    throw new Error('Better Auth user mapping did not establish exactly one application user.');
  }
}

export async function mapAuthUserToAppUserInTransaction(
  db,
  user,
  execute = (query) => db.executeQuery(query.compile(db))
) {
  const fullName = user.name || user.email?.split('@')[0] || 'Law firm user';
  const query = sql`
    INSERT INTO app_users (
      auth_user_id,
      full_name,
      email,
      email_verified,
      status,
      role_id,
      created_at,
      updated_at
    )
    SELECT
      ${user.id},
      ${fullName},
      ${user.email},
      ${Boolean(user.emailVerified)},
      'active',
      role_id,
      NOW(),
      NOW()
    FROM roles
    WHERE role_name = 'client'
    ON CONFLICT (auth_user_id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      email_verified = EXCLUDED.email_verified,
      updated_at = NOW()
    RETURNING auth_user_id
  `;
  const result = await execute(query);

  if (result.rows.length !== 1) {
    throw new Error('Better Auth user mapping did not establish exactly one application user.');
  }
}

function createAtomicAuthAdapter(rootDb) {
  return (options) => {
    const createMappedAdapter = (db, { transactionScoped = false } = {}) => {
      const baseAdapter = kyselyAdapter(db, {
        type: 'postgres',
        transaction: false,
      })(options);

      return {
        ...baseAdapter,
        async create(input) {
          if (input.model === 'session') {
            if (!transactionScoped) {
              return rootDb.transaction().execute(async (transactionDb) => {
                const transactionAdapter = createMappedAdapter(transactionDb, {
                  transactionScoped: true,
                });
                return transactionAdapter.create(input);
              });
            }

            const sessionUserId = input.data.userId;
            if (typeof sessionUserId !== 'string' || !sessionUserId) {
              throw new Error('Better Auth cannot create a session without a user ID.');
            }

            const account = await db.executeQuery(
              sql`SELECT status
                  FROM app_users
                  WHERE auth_user_id = ${sessionUserId}
                  FOR UPDATE`.compile(db)
            );
            // Runs on the session's own transaction (after the password check), so a stable
            // code can be returned without revealing account status to unauthenticated callers.
            if (account.rows[0]?.status !== 'active') {
              throw new APIError('FORBIDDEN', {
                code: 'ACCOUNT_INACTIVE',
                message: 'This account is inactive or suspended.',
              });
            }

            // The sign-in page of one audience refuses accounts of another, still after the
            // password check and before any session exists (see services/portalAccess.js).
            const requested = portalContext.getStore()?.portal;
            if (requested) {
              const memberships = await db.executeQuery(
                sql`SELECT u.is_platform_admin, r.role_name AS role, membership.is_owner
                    FROM app_users u
                    LEFT JOIN office_memberships membership ON membership.user_id = u.user_id
                    LEFT JOIN roles r ON r.role_id = membership.role_id
                    WHERE u.auth_user_id = ${sessionUserId}`.compile(db)
              );
              const portals = portalsFor(memberships.rows);
              if (!portals.includes(requested)) {
                throw new APIError('FORBIDDEN', {
                  code: 'WRONG_PORTAL',
                  message: 'This account does not sign in from this page.',
                  portals,
                });
              }
            }
          }

          const created = await baseAdapter.create(input);

          if (input.model === 'user') {
            await mapAuthUserToAppUserInTransaction(db, created);
          }

          return created;
        },
      };
    };

    const rootAdapter = createMappedAdapter(rootDb);

    return {
      ...rootAdapter,
      transaction(callback) {
        return rootDb.transaction().execute(async (transactionDb) => {
          const transactionAdapter = createMappedAdapter(transactionDb, {
            transactionScoped: true,
          });
          return callback(transactionAdapter);
        });
      },
    };
  };
}

export const auth = isUnitTest
  ? {
      api: {
        async getSession() {
          return null;
        },
        async signOut() {
          return new Response(null, { status: 200 });
        },
      },
    }
  : betterAuth({
  appName: 'Smart Law Firm Management',
  secret,
  baseURL: securityConfig.baseUrl,
  trustedOrigins: securityConfig.trustedOrigins,
  database: createAtomicAuthAdapter(db),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
    requireEmailVerification: false,
    sendResetPassword,
    resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
    revokeSessionsOnPasswordReset: true,
  },
  user: {
    modelName: 'auth_users',
    fields: {
      name: 'name',
      email: 'email',
      emailVerified: 'email_verified',
      image: 'image',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  session: {
    modelName: 'sessions',
    fields: {
      userId: 'user_id',
      expiresAt: 'expires_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    freshAge: 60 * 60 * 24,
    cookieCache: {
      maxAge: 300,
    },
  },
  account: {
    modelName: 'accounts',
    fields: {
      userId: 'user_id',
      accountId: 'account_id',
      providerId: 'provider_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      idToken: 'id_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      password: 'password',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  verification: {
    modelName: 'verifications',
    fields: {
      identifier: 'identifier',
      value: 'value',
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  databaseHooks: {
    user: {
      update: {
        after: async (user) => {
          const payload = [
            user.name || null,
            user.email || null,
            Boolean(user.emailVerified),
            user.id,
          ];

          await pool.query(
            `
              UPDATE app_users
              SET
                full_name = COALESCE($1, full_name),
                email = COALESCE($2, email),
                email_verified = COALESCE($3, email_verified),
                updated_at = NOW()
              WHERE auth_user_id = $4
            `,
            payload
          );
        },
      },
    },
  },
    });

export const authHandler = isUnitTest
  ? (_request, response) => response.status(200).json(null)
  : toNodeHandler(auth);
