import { isIP } from 'node:net';

const REQUIRED_TEST_DATABASE = 'smart_law_firm_test';
const DEVELOPMENT_DATABASE = 'smart_law_firm';
const ALLOWED_URL_PARAMETERS = new Set(['sslmode', 'sslrootcert']);

function normalizeHost(host) {
  return host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function isLoopbackHost(host) {
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (isIP(host) === 4) return Number(host.split('.')[0]) === 127;
  return isIP(host) === 6 && host === '::1';
}

export function isRemoteDatabaseHost(host) {
  const normalizedHost = host?.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return Boolean(
    normalizedHost
    && !normalizedHost.startsWith('/')
    && !isLoopbackHost(normalizedHost)
  );
}

export function assertSafeIntegrationEnvironment({ pgOptions, pgSslMode }) {
  if (pgOptions?.trim()) {
    throw new Error('PGOPTIONS must be unset for integration tests.');
  }
  if (pgSslMode?.trim() && pgSslMode.trim().toLowerCase() !== 'verify-full') {
    throw new Error('PGSSLMODE must be unset or verify-full for integration tests.');
  }
}

function parseHostAllowlist(value) {
  const hosts = (value || '')
    .split(',')
    .map((host) => normalizeHost(host.trim()))
    .filter(Boolean);

  if (
    hosts.length === 0
    || hosts.some((host) => {
      const validHostname = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(host);
      return host.includes('*') || (!isIP(host) && !validHostname);
    })
  ) {
    throw new Error('TEST_DATABASE_HOST_ALLOWLIST must contain exact PostgreSQL hostnames or IP addresses.');
  }

  return new Set(hosts);
}

function parseServerAddressAllowlist(value) {
  const addresses = (value || '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);

  if (addresses.length === 0 || addresses.some((address) => !isIP(address))) {
    throw new Error('TEST_DATABASE_SERVER_ADDRESS_ALLOWLIST must contain one or more exact IPv4 or IPv6 addresses.');
  }

  return new Set(addresses);
}

function getUrlParameter(parsed, name) {
  for (const [parameterName, value] of parsed.searchParams) {
    if (parameterName.toLowerCase() === name) return value;
  }
  return null;
}

export function validateTestDatabaseTarget({
  databaseUrl,
  databaseName,
  databaseRole,
  hostAllowlist,
  serverAddressAllowlist,
}) {
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required.');
  if (databaseName !== REQUIRED_TEST_DATABASE) {
    throw new Error(`TEST_DATABASE_NAME must be exactly ${REQUIRED_TEST_DATABASE}.`);
  }
  if (!databaseRole?.trim()) {
    throw new Error('TEST_DATABASE_ROLE is required.');
  }

  let parsed;
  let configuredDatabaseName;
  let configuredDatabaseRole;
  const configuredParameters = new Set();
  try {
    parsed = new URL(databaseUrl);
    configuredDatabaseName = decodeURIComponent(parsed.pathname.slice(1));
    configuredDatabaseRole = decodeURIComponent(parsed.username);
    for (const [parameterName] of parsed.searchParams) {
      const name = parameterName.toLowerCase();
      if (parameterName !== name || configuredParameters.has(name)) throw new Error();
      configuredParameters.add(name);
    }
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  }

  const configuredHost = normalizeHost(parsed.hostname);
  const sslMode = getUrlParameter(parsed, 'sslmode');
  const hasSslRootCert = configuredParameters.has('sslrootcert');
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !configuredHost
    || configuredDatabaseName !== REQUIRED_TEST_DATABASE
    || configuredDatabaseRole !== databaseRole
    || parsed.hash
    || [...configuredParameters].some((name) => !ALLOWED_URL_PARAMETERS.has(name))
    || (configuredParameters.has('sslmode') && sslMode !== 'verify-full')
    || (hasSslRootCert && sslMode !== 'verify-full')
  ) {
    throw new Error(`TEST_DATABASE_URL must target the ${REQUIRED_TEST_DATABASE} PostgreSQL database.`);
  }

  const port = parsed.port ? Number(parsed.port) : NaN;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('TEST_DATABASE_URL must include a valid explicit PostgreSQL port.');
  }

  const allowedHosts = parseHostAllowlist(hostAllowlist);
  const allowedServerAddresses = parseServerAddressAllowlist(serverAddressAllowlist);
  const remoteTestDatabase = isRemoteDatabaseHost(configuredHost);
  if (!allowedHosts.has(configuredHost)) {
    throw new Error('TEST_DATABASE_URL host is not in TEST_DATABASE_HOST_ALLOWLIST.');
  }
  if (remoteTestDatabase && sslMode !== 'verify-full') {
    throw new Error('Remote TEST_DATABASE_URL connections must use sslmode=verify-full.');
  }

  return {
    connectionString: databaseUrl,
    databaseName: REQUIRED_TEST_DATABASE,
    databaseRole,
    host: configuredHost,
    port,
    allowedHosts,
    allowedServerAddresses,
  };
}

export function getTestDatabaseTargetFromEnv(
  env,
  {
    requireProvisioningAuthorization = false,
    requireConnectionGuard = true,
  } = {}
) {
  if (env.TEST_INTEGRATION_ENABLED !== 'true') {
    throw new Error('TEST_INTEGRATION_ENABLED must be set to true.');
  }
  if (env.TEST_DATABASE_DISPOSABLE !== 'true') {
    throw new Error('TEST_DATABASE_DISPOSABLE=true is required; an administrator must independently verify disposability.');
  }
  if (
    requireProvisioningAuthorization
    && env.TEST_ADMIN_PROVISION_ENABLED !== 'true'
  ) {
    throw new Error('TEST_ADMIN_PROVISION_ENABLED must be set to true.');
  }
  if (requireConnectionGuard && env.TEST_DATABASE_CONNECTION_GUARD !== 'true') {
    throw new Error('TEST_DATABASE_CONNECTION_GUARD must be set to true before application pool connections.');
  }

  assertSafeIntegrationEnvironment({
    pgOptions: env.PGOPTIONS,
    pgSslMode: env.PGSSLMODE,
  });

  return validateTestDatabaseTarget({
    databaseUrl: env.TEST_DATABASE_URL,
    databaseName: env.TEST_DATABASE_NAME,
    databaseRole: env.TEST_DATABASE_ROLE,
    hostAllowlist: env.TEST_DATABASE_HOST_ALLOWLIST,
    serverAddressAllowlist: env.TEST_DATABASE_SERVER_ADDRESS_ALLOWLIST,
  });
}

export async function verifyTestDatabaseIdentity(client, target) {
  let result;
  try {
    await client.query('SET search_path TO pg_catalog, public, pg_temp');
    result = await client.query(
      `SELECT pg_catalog.current_database() AS database,
              current_user AS role,
              pg_catalog.host(pg_catalog.inet_server_addr()) AS server_address,
              pg_catalog.inet_server_port() AS server_port`
    );
  } catch {
    throw new Error('Could not verify the PostgreSQL test server identity.');
  }
  const identity = result.rows[0];

  if (
    identity?.database !== target.databaseName
    || identity.role !== target.databaseRole
    || !identity.server_address
    || !target.allowedServerAddresses.has(identity.server_address)
    || identity.server_port !== target.port
  ) {
    throw new Error('Connected PostgreSQL identity is not in the explicitly configured test database/server allowlists.');
  }
}

export async function verifySafeTestDatabaseRole(client) {
  let result;
  try {
    result = await client.query(
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
              EXISTS (
                SELECT 1
                FROM pg_catalog.pg_shdepend AS dependency
                WHERE dependency.refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass
                  AND dependency.refobjid = role.oid
                  AND dependency.deptype = 'o'
              ) AS owns_any_database_objects,
              EXISTS (
                SELECT 1
                FROM pg_catalog.pg_namespace AS namespace
                WHERE namespace.nspname <> 'information_schema'
                  AND namespace.nspname !~ '^pg_'
                  AND pg_catalog.has_schema_privilege(role.oid, namespace.oid, 'CREATE')
              ) AS can_create_in_schema,
              COALESCE((
                SELECT pg_catalog.has_database_privilege(
                  role.oid,
                  database.oid,
                  'CONNECT'
                )
                FROM pg_catalog.pg_database AS database
                WHERE database.datname = $1
              ), FALSE) AS can_connect_to_development_database
       FROM pg_catalog.pg_roles AS role
       WHERE role.rolname = current_user`,
      [DEVELOPMENT_DATABASE]
    );
  } catch {
    throw new Error('Could not verify that the PostgreSQL test role has safe privileges.');
  }

  const role = result.rows[0];
  if (
    !role
    || role.rolsuper
    || role.rolbypassrls
    || role.rolcreatedb
    || role.rolcreaterole
    || role.rolreplication
    || role.has_role_memberships
    || role.owns_any_database_objects
    || role.can_create_in_schema
    || role.can_connect_to_development_database
  ) {
    throw new Error('The PostgreSQL test role has privileged attributes, memberships, ownership, or development-database access.');
  }
}
