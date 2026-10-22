import { createHash, createPublicKey, verify } from 'node:crypto';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  applyPendingMigrations,
  inspectMigrationStatus,
  readMigrationFiles,
} from './migrationRunner.js';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEVELOPMENT_DATABASE = 'smart_law_firm';
const VALID_ENVIRONMENTS = new Set(['development', 'test', 'staging']);
const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;
const TRUSTED_AUTHORIZATION_KEY_SHA256 = 'UNCONFIGURED';
const MAX_AUTHORIZATION_LIFETIME_MS = 10 * 60 * 1000;
const AUTHORIZATION_FIELDS = [
  'environment',
  'database',
  'role',
  'host',
  'port',
  'serverAddresses',
  'expiresAt',
];
const CONFLICTING_PG_ENVIRONMENT = [
  'PGHOST',
  'PGHOSTADDR',
  'PGPORT',
  'PGDATABASE',
  'PGUSER',
  'PGPASSWORD',
  'PGSSLMODE',
  'PGSSLROOTCERT',
  'PGSSLCERT',
  'PGSSLKEY',
  'PGOPTIONS',
  'PGSERVICE',
  'PGSERVICEFILE',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'NODE_EXTRA_CA_CERTS',
  'NODE_OPTIONS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'OPENSSL_CONF',
];

function requireValue(env, name) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be explicitly configured for migrations.`);
  }
  return value;
}

function normalizeHost(host) {
  return host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function isValidHost(host) {
  return isIP(host) !== 0 || HOSTNAME_PATTERN.test(host);
}

export function hasDevelopmentDatabaseConnectAccess(role) {
  return Boolean(
    role?.can_connect_to_development_database
    || role?.public_can_connect_to_development_database
  );
}

function decodeCanonicalBase64Url(value) {
  const decoded = Buffer.from(value, 'base64url');
  if (!value || decoded.toString('base64url') !== value) {
    throw new Error('Migration authorization token is malformed.');
  }
  return decoded;
}

export function verifyMigrationAuthorization(
  token,
  publicKeyPem,
  target,
  trustedFingerprint,
  now = Date.now()
) {
  if (!/^[a-f0-9]{64}$/.test(trustedFingerprint || '')) {
    throw new Error(
      'Migration authorization is disabled until a trusted public-key fingerprint is pinned in source.'
    );
  }

  let publicKey;
  try {
    publicKey = createPublicKey(publicKeyPem);
  } catch {
    throw new Error('Migration authorization public key is invalid.');
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Migration authorization requires an Ed25519 public key.');
  }
  const actualFingerprint = createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex');
  if (actualFingerprint !== trustedFingerprint) {
    throw new Error('Migration authorization public key does not match the pinned fingerprint.');
  }

  const tokenParts = token?.split('.');
  if (!tokenParts || tokenParts.length !== 2) {
    throw new Error('Migration authorization token is malformed.');
  }
  const payloadBytes = decodeCanonicalBase64Url(tokenParts[0]);
  const signature = decodeCanonicalBase64Url(tokenParts[1]);
  if (signature.length !== 64) {
    throw new Error('Migration authorization signature is invalid.');
  }

  let authorization;
  try {
    authorization = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    throw new Error('Migration authorization payload is invalid.');
  }
  if (
    !authorization
    || typeof authorization !== 'object'
    || Array.isArray(authorization)
  ) {
    throw new Error('Migration authorization payload is not canonical.');
  }

  const canonicalAuthorization = {
    environment: authorization.environment,
    database: authorization.database,
    role: authorization.role,
    host: authorization.host,
    port: authorization.port,
    serverAddresses: authorization.serverAddresses,
    expiresAt: authorization.expiresAt,
  };
  if (
    JSON.stringify(Object.keys(authorization)) !== JSON.stringify(AUTHORIZATION_FIELDS)
    || JSON.stringify(canonicalAuthorization) !== payloadBytes.toString('utf8')
  ) {
    throw new Error('Migration authorization payload is not canonical.');
  }

  const expiration = Date.parse(authorization.expiresAt);
  const addresses = authorization.serverAddresses;
  if (
    !VALID_ENVIRONMENTS.has(authorization.environment)
    || typeof authorization.database !== 'string'
    || !authorization.database
    || typeof authorization.role !== 'string'
    || !authorization.role
    || typeof authorization.host !== 'string'
    || !isValidHost(authorization.host)
    || normalizeHost(authorization.host) !== authorization.host
    || !Number.isSafeInteger(authorization.port)
    || authorization.port < 1
    || authorization.port > 65535
    || !Array.isArray(addresses)
    || addresses.length === 0
    || addresses.some((address) => (
      typeof address !== 'string' || isIP(address) === 0
    ))
    || [...addresses].sort().some((address, index) => address !== addresses[index])
    || new Set(addresses).size !== addresses.length
    || typeof authorization.expiresAt !== 'string'
    || !Number.isFinite(expiration)
    || !Number.isFinite(new Date(expiration).getTime())
    || new Date(expiration).toISOString() !== authorization.expiresAt
    || expiration <= now
    || expiration > now + MAX_AUTHORIZATION_LIFETIME_MS
    || authorization.environment !== target.environment
    || authorization.database !== target.database
    || authorization.role !== target.role
    || authorization.host !== target.host
    || authorization.port !== target.port
  ) {
    throw new Error('Migration authorization does not match the requested, permitted target.');
  }

  if (!verify(null, payloadBytes, publicKey, signature)) {
    throw new Error('Migration authorization signature is invalid.');
  }

  return { serverAddressAllowlist: new Set(addresses) };
}

export function getMigrationTarget(env = process.env) {
  if (env.NODE_ENV === 'production') {
    throw new Error('Migrations are disabled when NODE_ENV=production.');
  }

  const environment = requireValue(env, 'MIGRATION_TARGET_ENV');
  if (!VALID_ENVIRONMENTS.has(environment)) {
    throw new Error('MIGRATION_TARGET_ENV must be development, test, or staging.');
  }

  for (const variable of CONFLICTING_PG_ENVIRONMENT) {
    if (env[variable]) {
      throw new Error(`${variable} must not override explicit migration connection settings.`);
    }
  }

  const connectionString = requireValue(env, 'MIGRATION_DATABASE_URL');
  const expectedDatabase = requireValue(env, 'MIGRATION_DATABASE_NAME');
  const expectedRole = requireValue(env, 'MIGRATION_DATABASE_ROLE');
  let parsed;
  let database;
  let role;
  try {
    parsed = new URL(connectionString);
    database = decodeURIComponent(parsed.pathname.slice(1));
    role = decodeURIComponent(parsed.username);
  } catch {
    throw new Error('MIGRATION_DATABASE_URL must be a valid PostgreSQL URL.');
  }

  if (database === DEVELOPMENT_DATABASE) {
    throw new Error(
      'The known development database is blocked. A separately reviewed authorization change is required.'
    );
  }

  const host = normalizeHost(parsed.hostname);
  const port = parsed.port ? Number(parsed.port) : NaN;
  const queryParameterNames = [...parsed.searchParams.keys()];
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !isValidHost(host)
    || database !== expectedDatabase
    || role !== expectedRole
    || !parsed.password
    || !Number.isSafeInteger(port)
    || port < 1
    || port > 65535
    || parsed.hash
    || parsed.searchParams.get('sslmode') !== 'verify-full'
    || parsed.searchParams.has('sslrootcert')
    || queryParameterNames.some((name) => (
      name !== name.toLowerCase()
      || name !== 'sslmode'
      || queryParameterNames.filter((candidate) => candidate === name).length !== 1
    ))
  ) {
    throw new Error(
      'MIGRATION_DATABASE_URL must explicitly match the target and use sslmode=verify-full.'
    );
  }

  const target = {
    connectionString,
    database,
    role,
    host,
    port,
    environment,
  };
  const authorization = verifyMigrationAuthorization(
    requireValue(env, 'MIGRATION_AUTHORIZATION_TOKEN'),
    requireValue(env, 'MIGRATION_AUTHORIZATION_PUBLIC_KEY'),
    target,
    TRUSTED_AUTHORIZATION_KEY_SHA256
  );

  return {
    ...target,
    serverAddressAllowlist: authorization.serverAddressAllowlist,
  };
}

export function parseMigrationCommand(args) {
  if (args.length === 1 && args[0] === '--status') {
    return { mode: 'status', confirmation: null };
  }

  if (
    args.length === 2
    && args[0] === '--up'
    && args[1].startsWith('--confirm-target=')
  ) {
    const confirmation = args[1].slice('--confirm-target='.length);
    if (!confirmation) {
      throw new Error('--confirm-target must name the exact database target.');
    }
    return { mode: 'up', confirmation };
  }

  throw new Error(
    'Usage: node database/migrate.js --status | --up --confirm-target=<exact-database-name>'
  );
}

export async function verifyConnectedTarget(client, target) {
  const result = await client.query(
    `SELECT pg_catalog.current_database() AS database,
            current_user AS role,
            pg_catalog.host(pg_catalog.inet_server_addr()) AS server_address,
            pg_catalog.inet_server_port() AS server_port`
  );
  const identity = result.rows[0];
  if (
    identity?.database !== target.database
    || identity.role !== target.role
    || !identity.server_address
    || !target.serverAddressAllowlist.has(identity.server_address)
    || identity.server_port !== target.port
  ) {
    throw new Error(
      'Connected PostgreSQL identity does not match the explicitly configured target.'
    );
  }
}

export async function verifyMigrationRole(client, target) {
  const result = await client.query(
    `SELECT role.rolsuper,
            role.rolbypassrls,
            role.rolcreatedb,
            role.rolcreaterole,
            role.rolreplication,
            EXISTS (
              SELECT 1
              FROM pg_catalog.pg_roles AS granted_role
              WHERE granted_role.oid <> role.oid
                AND pg_catalog.pg_has_role(role.oid, granted_role.oid, 'MEMBER')
            ) AS has_role_memberships,
            COALESCE((
              SELECT pg_catalog.has_database_privilege(
                role.oid,
                database.oid,
                'CONNECT'
              )
              FROM pg_catalog.pg_database AS database
              WHERE database.datname = $1
            ), FALSE) AS can_connect_to_development_database,
            COALESCE((
              SELECT pg_catalog.bool_or(privilege.privilege_type = 'CONNECT')
              FROM pg_catalog.pg_database AS database
              CROSS JOIN LATERAL pg_catalog.aclexplode(
                COALESCE(
                  database.datacl,
                  pg_catalog.acldefault('d', database.datdba)
                )
              ) AS privilege
              WHERE database.datname = $1
                AND privilege.grantee = 0
            ), FALSE) AS public_can_connect_to_development_database
       FROM pg_catalog.pg_roles AS role
      WHERE role.rolname = current_user`,
    [DEVELOPMENT_DATABASE]
  );
  const role = result.rows[0];
  if (
    !role
    || role.rolsuper
    || role.rolbypassrls
    || role.rolcreatedb
    || role.rolcreaterole
    || role.rolreplication
    || role.has_role_memberships
    || hasDevelopmentDatabaseConnectAccess(role)
    || target.role === 'postgres'
  ) {
    throw new Error(
      'Migration role is privileged, belongs to another role, is the postgres superuser, or can connect to the development database.'
    );
  }
}

async function run() {
  const command = parseMigrationCommand(process.argv.slice(2));
  const target = getMigrationTarget();
  if (command.mode === 'up' && command.confirmation !== target.database) {
    throw new Error('--confirm-target must exactly match MIGRATION_DATABASE_NAME.');
  }

  const migrations = await readMigrationFiles(path.join(__dirname, 'migrations'));
  if (command.mode === 'up' && migrations.length === 0) {
    console.log('No migration files are present; no database connection was opened.');
    return;
  }

  const client = new Client({ connectionString: target.connectionString });
  let lockClient;
  let primaryError;
  let completedMigrationResult;
  try {
    await client.connect();
    await verifyConnectedTarget(client, target);
    await verifyMigrationRole(client, target);

    if (command.mode === 'status') {
      const status = await inspectMigrationStatus(client, migrations);
      console.log(`Applied migrations: ${status.applied.join(', ') || 'none'}`);
      console.log(`Pending migrations: ${status.pending.join(', ') || 'none'}`);
    } else {
      lockClient = new Client({ connectionString: target.connectionString });
      await lockClient.connect();
      await verifyConnectedTarget(lockClient, target);
      await verifyMigrationRole(lockClient, target);
      const result = await applyPendingMigrations(client, migrations, lockClient);
      completedMigrationResult = result;
      console.log(
        `Migration run finished. Applied migration count: ${result.applied}; pending: ${result.pending}.`
      );
    }
  } catch (error) {
    primaryError = error;
  }

  const cleanupErrors = [];
  for (const connection of [lockClient, client]) {
    if (!connection) continue;
    try {
      await connection.end();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (primaryError && cleanupErrors.length) {
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      'Migration command failed and connection cleanup also failed.',
      { cause: primaryError }
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupErrors.length === 1) {
    if (completedMigrationResult) {
      throw new Error(
        'Migration execution completed, but connection cleanup failed; migrations may already be applied. Check public.schema_migrations before retrying.',
        { cause: cleanupErrors[0] }
      );
    }
    throw cleanupErrors[0];
  }
  if (cleanupErrors.length > 1) {
    const cleanupFailure = new AggregateError(
      cleanupErrors,
      'Migration connection cleanup failed.'
    );
    if (completedMigrationResult) {
      throw new Error(
        'Migration execution completed, but connection cleanup failed; migrations may already be applied. Check public.schema_migrations before retrying.',
        { cause: cleanupFailure }
      );
    }
    throw cleanupFailure;
  }
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMain) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
