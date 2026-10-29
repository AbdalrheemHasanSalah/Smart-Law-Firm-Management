import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { kyselyAdapter } from '@better-auth/kysely-adapter';
import { toNodeHandler } from 'better-auth/node';
import { Kysely, PostgresDialect, sql } from 'kysely';

import { pool } from './db.js';
import { getSecurityConfig } from './security.js';

const secret = process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET;

if (!secret || secret.length < 32) {
  throw new Error('BETTER_AUTH_SECRET or AUTH_SECRET must be configured with at least 32 characters.');
}

const isUnitTest = process.env.NODE_ENV === 'test'
  && process.env.LAW_FIRM_UNIT_TEST_MODE === 'true';
const securityConfig = getSecurityConfig();

const RESET_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * No mail transport is configured in this project yet. Outside production the reset link is
 * written to the server console so the flow can be exercised locally; in production the
 * request succeeds silently until a real mailer replaces this function.
 */
async function sendResetPassword({ user, url }) {
  if (securityConfig.production) {
    console.warn('Password reset requested but no mail transport is configured.');
    return;
  }
  console.info(`[dev mail] Password reset link for ${user.email}: ${url}`);
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
