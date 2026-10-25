
import pg from 'pg';
import dotenv from 'dotenv';
import { isIP } from 'node:net';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getTestDatabaseTargetFromEnv,
  verifySafeTestDatabaseRole,
  verifyTestDatabaseIdentity,
} from './testDatabaseSafety.js';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Adjust these paths to match your actual project structure.
// Existing system environment variables are not overwritten by default.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

const APPROVED_REMOTE_SSL_MODE = 'verify-full';

function normalizeHost(host) {
  return host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function isLoopbackIpv6(host) {
  if (isIP(host) !== 6) return false;

  const halves = host.split('::');
  if (halves.length > 2) return false;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const groups = halves.length === 1
    ? left
    : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];

  return groups.length === 8
    && groups.slice(0, 7).every((group) => Number.parseInt(group || '0', 16) === 0)
    && Number.parseInt(groups[7], 16) === 1;
}

function isLocalDatabaseHost(host) {
  const normalizedHost = normalizeHost(host);
  if (
    normalizedHost.startsWith('/')
    || normalizedHost === 'localhost'
    || normalizedHost.endsWith('.localhost')
  ) {
    return true;
  }

  if (isIP(normalizedHost) === 4) {
    return Number(normalizedHost.split('.')[0]) === 127;
  }

  return isLoopbackIpv6(normalizedHost);
}

function getUrlConnectionHost(parsed) {
  const rawParameters = parsed.search.slice(1).split('&');
  const hostParameters = [...parsed.searchParams].flatMap(([name, value], index) => {
    const rawParameter = rawParameters[index] ?? '';
    const equalsIndex = rawParameter.indexOf('=');
    const rawName = equalsIndex < 0
      ? rawParameter
      : rawParameter.slice(0, equalsIndex);

    if (name.toLowerCase() !== 'host') return [];
    if (name !== 'host' || rawName !== 'host') {
      throw new Error('DATABASE_URL must use the canonical host parameter name.');
    }
    return [{ value }];
  });

  if (hostParameters.length > 1) {
    throw new Error('DATABASE_URL must not contain duplicate host parameters.');
  }

  if (hostParameters.length === 1) {
    if (!hostParameters[0].value.trim()) {
      throw new Error('DATABASE_URL host parameter must not be empty.');
    }
    return hostParameters[0].value;
  }

  if (!parsed.hostname) {
    throw new Error('DATABASE_URL must explicitly configure a database host.');
  }
  return parsed.hostname;
}

function getDatabaseHost(env) {
  if (env.DATABASE_URL) {
    let parsed;
    try {
      parsed = new URL(env.DATABASE_URL);
    } catch {
      throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
    }
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
      throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
    }
    if (!parsed.username.trim()) {
      throw new Error('DATABASE_URL must include an explicit, non-empty username.');
    }
    return getUrlConnectionHost(parsed);
  }

  const host = env.DB_HOST || env.PGHOST;
  if (!host?.trim()) {
    throw new Error('A PostgreSQL database host must be explicitly configured.');
  }
  return host.trim();
}

function assertSafeDatabaseUrl(connectionString, env, requireSslMode) {
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }

  if (env.DB_SSL !== undefined && env.DB_SSL !== 'true') {
    throw new Error('DB_SSL must be true when configured for a remote PostgreSQL URL.');
  }

  let sslModeCount = 0;
  const rawParameters = parsed.search.slice(1).split('&');
  for (const [index, [name, value]] of [...parsed.searchParams].entries()) {
    const lowerName = name.toLowerCase();
    const isSslParameter = lowerName.startsWith('ssl')
      || lowerName.startsWith('tls')
      || lowerName.includes('libpqcompat');

    if (!isSslParameter) continue;
    const rawParameter = rawParameters[index] ?? '';
    const equalsIndex = rawParameter.indexOf('=');
    const rawName = equalsIndex < 0
      ? rawParameter
      : rawParameter.slice(0, equalsIndex);
    const rawValue = equalsIndex < 0 ? '' : rawParameter.slice(equalsIndex + 1);
    if (name !== 'sslmode' || rawName !== name) {
      throw new Error('Remote DATABASE_URL contains an unsupported or unsafe SSL parameter.');
    }

    sslModeCount += 1;
    if (sslModeCount > 1) {
      throw new Error('Remote DATABASE_URL contains an unsupported or unsafe SSL parameter.');
    }
    if (value !== APPROVED_REMOTE_SSL_MODE || rawValue !== APPROVED_REMOTE_SSL_MODE) {
      throw new Error('Remote DATABASE_URL must use sslmode=verify-full.');
    }
  }

  if (requireSslMode && sslModeCount !== 1) {
    throw new Error('Remote DATABASE_URL must contain exactly one sslmode=verify-full parameter.');
  }

  if (sslModeCount === 1) {
    parsed.searchParams.delete('sslmode');
    return parsed.toString();
  }
  return connectionString;
}

export function getDatabaseConfig(env = process.env) {
  const connectionString = env.DATABASE_URL;
  if (!connectionString && !env.DB_USER?.trim()) {
    throw new Error('DB_USER must be explicitly configured when DATABASE_URL is not set.');
  }
  if (!connectionString && env.DB_USER && env.DB_USER !== env.DB_USER.trim()) {
    throw new Error('DB_USER must not contain leading or trailing whitespace.');
  }

  const host = getDatabaseHost(env);
  const remoteDatabase = !isLocalDatabaseHost(host);

  if (remoteDatabase && !connectionString && env.DB_SSL !== 'true') {
    throw new Error('DB_SSL=true is required for remote PostgreSQL connections.');
  }

  const config = {
    max: Number(env.DB_POOL_MAX || 20),
    idleTimeoutMillis: Number(
      env.DB_IDLE_TIMEOUT || 30000
    ),
    connectionTimeoutMillis: Number(
      env.DB_CONNECT_TIMEOUT || 5000
    ),
  };

  if (connectionString) {
    if (remoteDatabase) {
      config.connectionString = assertSafeDatabaseUrl(connectionString, env, true);
    } else if (env.DB_SSL === 'true') {
      config.connectionString = assertSafeDatabaseUrl(connectionString, env, false);
    } else {
      config.connectionString = connectionString;
    }
  } else {
    config.host = host;

    config.port = Number(
      env.DB_PORT || env.PGPORT || 5432
    );

    config.user = env.DB_USER;

    config.password =
      env.DB_PASSWORD ??
      env.PGPASSWORD ??
      '';

    config.database =
      env.DB_NAME ||
      env.PGDATABASE ||
      'smart_law_firm';

    if (!config.password) {
      throw new Error(
        'Database password is missing. Check your .env configuration.'
      );
    }
  }

  if (remoteDatabase || env.DB_SSL === 'true') {
    config.ssl = { rejectUnauthorized: true };
  }

  return config;
}

function getIntegrationIdentityGuard(env) {
  if (env.TEST_INTEGRATION_ENABLED !== 'true') return null;
  if (
    env.TEST_DATABASE_CONNECTION_GUARD !== 'true'
    || !env.TEST_DATABASE_URL
    || env.DATABASE_URL !== env.TEST_DATABASE_URL
  ) {
    throw new Error('Integration database identity guard is not configured for the validated test URL.');
  }
  return getTestDatabaseTargetFromEnv(env);
}

class IdentityCheckedPool extends Pool {
  constructor(config, identityGuard) {
    super(config);
    this.identityGuard = identityGuard;
  }

  async verifyClient(client) {
    if (!this.identityGuard) return;
    try {
      await verifyTestDatabaseIdentity(client, this.identityGuard);
      await verifySafeTestDatabaseRole(client);
    } catch {
      throw new Error('A PostgreSQL integration connection failed identity or role-safety verification.');
    }
  }

  connect(callback) {
    if (!this.identityGuard) return super.connect(callback);

    if (typeof callback === 'function') {
      return super.connect((error, client, release) => {
        if (error) return callback(error, client, release);

        this.verifyClient(client).then(
          () => callback(null, client, release),
          (verificationError) => {
            release(verificationError);
            callback(verificationError);
          }
        );
      });
    }

    return super.connect().then(async (client) => {
      try {
        await this.verifyClient(client);
        return client;
      } catch (error) {
        client.release(error);
        throw error;
      }
    });
  }

  emit(eventName, ...args) {
    if (
      this.identityGuard
      && ['connect', 'acquire', 'release'].includes(eventName)
    ) {
      return false;
    }
    if (this.identityGuard && eventName === 'error') {
      return super.emit(eventName, args[0]);
    }
    return super.emit(eventName, ...args);
  }
}

const unitTestPool = {
  on() {
    return this;
  },
  query() {
    throw new Error('PostgreSQL access is disabled during unit tests.');
  },
  connect() {
    throw new Error('PostgreSQL access is disabled during unit tests.');
  },
  async end() {},
};

const isUnitTest = process.env.NODE_ENV === 'test'
  && process.env.LAW_FIRM_UNIT_TEST_MODE === 'true';
const integrationIdentityGuard = isUnitTest
  ? null
  : getIntegrationIdentityGuard(process.env);

export const pool = isUnitTest
  ? unitTestPool
  : new IdentityCheckedPool(
    getDatabaseConfig(),
    integrationIdentityGuard
  );

pool.on('error', (err) => {
  console.error(
    'Unexpected error on idle PostgreSQL client:',
    err.message
  );
});

export const query = (text, params) =>
  pool.query(text, params);

export async function testDatabaseConnection() {
  const result = await query(`
    SELECT current_database() AS database,
           current_user AS user,
           NOW() AS time
  `);

  console.log('PostgreSQL connected:', result.rows[0]);
  return result.rows[0];
}

export default pool;
