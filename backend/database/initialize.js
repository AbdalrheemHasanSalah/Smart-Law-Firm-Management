import fs from 'fs';
import { isIP } from 'node:net';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables without overriding existing process environment
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'backend/.env') });
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
  const hostParameters = [];
  for (const rawParameter of parsed.search.slice(1).split('&')) {
    if (!rawParameter) continue;
    const [parameter] = new URLSearchParams(rawParameter);
    if (!parameter) continue;
    const [name, value] = parameter;
    if (name.toLowerCase() !== 'host') continue;
    const rawName = rawParameter.split('=', 1)[0];
    if (name !== 'host' || rawName !== 'host') {
      throw new Error('DATABASE_URL must use the canonical host parameter name.');
    }
    hostParameters.push(value);
  }

  if (hostParameters.length > 1) {
    throw new Error('DATABASE_URL must not contain duplicate host parameters.');
  }
  if (hostParameters.length === 1) {
    if (!hostParameters[0].trim()) {
      throw new Error('DATABASE_URL host parameter must not be empty.');
    }
    return hostParameters[0];
  }
  if (!parsed.hostname) {
    throw new Error('DATABASE_URL must explicitly configure a database host.');
  }
  return parsed.hostname;
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
  for (const rawParameter of parsed.search.slice(1).split('&')) {
    if (!rawParameter) continue;
    const parameters = [...new URLSearchParams(rawParameter)];
    if (parameters.length !== 1) {
      throw new Error('Remote DATABASE_URL contains an unsupported or unsafe SSL parameter.');
    }
    const [[name, value]] = parameters;
    const lowerName = name.toLowerCase();
    if (
      !lowerName.startsWith('ssl')
      && !lowerName.startsWith('tls')
      && !lowerName.includes('libpqcompat')
    ) {
      continue;
    }

    const rawName = rawParameter.split('=', 1)[0];
    const rawValue = rawParameter.includes('=')
      ? rawParameter.slice(rawParameter.indexOf('=') + 1)
      : '';
    if (name !== 'sslmode' || rawName !== name) {
      throw new Error('Remote DATABASE_URL contains an unsupported or unsafe SSL parameter.');
    }
    sslModeCount += 1;
    if (value !== APPROVED_REMOTE_SSL_MODE || rawValue !== APPROVED_REMOTE_SSL_MODE) {
      throw new Error('Remote DATABASE_URL must use sslmode=verify-full.');
    }
  }

  if (sslModeCount > 1 || (requireSslMode && sslModeCount !== 1)) {
    throw new Error('Remote DATABASE_URL must contain exactly one sslmode=verify-full parameter.');
  }
  if (sslModeCount === 1) {
    parsed.searchParams.delete('sslmode');
    return parsed.toString();
  }
  return connectionString;
}

export const EXPECTED_TABLES = [
  'roles',
  'auth_users',
  'app_users',
  'sessions',
  'accounts',
  'verifications',
  'law_offices',
  'office_memberships',
  'office_invitations',
  'lawyer_profiles',
  'clients',
  'courts',
  'legal_cases',
  'involves',
  'assigned_to',
  'notifications',
  'messages',
  'appointments',
  'hearings',
  'tasks',
  'documents',
  'audit_logs',
  'legal_references',
  'contracts',
  'invoices',
  'payments',
  'case_notes',
  'ai_interactions',
  'ai_interaction_sources',
  'case_status_history',
];

export const EXPECTED_ROLES = ['admin', 'lawyer', 'assistant', 'client'];

const RESETTABLE_TABLES = [
  'ai_interaction_sources',
  'case_status_history',
  'payments',
  'ai_interactions',
  'case_notes',
  'invoices',
  'contracts',
  'legal_references',
  'audit_logs',
  'documents',
  'tasks',
  'hearings',
  'appointments',
  'messages',
  'notifications',
  'assigned_to',
  'involves',
  'legal_cases',
  'office_invitations',
  'lawyer_profiles',
  'clients',
  'office_memberships',
  'law_offices',
  'accounts',
  'sessions',
  'verifications',
  'app_users',
  'auth_users',
  'courts',
  'roles',
];

export const EXPECTED_FOREIGN_KEYS = [
  { table: 'app_users', column: 'auth_user_id', foreignTable: 'auth_users', foreignColumn: 'id' },
  { table: 'app_users', column: 'role_id', foreignTable: 'roles', foreignColumn: 'role_id' },
  { table: 'sessions', column: 'user_id', foreignTable: 'auth_users', foreignColumn: 'id' },
  { table: 'accounts', column: 'user_id', foreignTable: 'auth_users', foreignColumn: 'id' },
  { table: 'lawyer_profiles', column: 'user_id', foreignTable: 'app_users', foreignColumn: 'user_id' },
  { table: 'clients', column: 'user_id', foreignTable: 'app_users', foreignColumn: 'user_id' },
  { table: 'legal_cases', column: 'court_id', foreignTable: 'courts', foreignColumn: 'court_id' },
  { table: 'involves', column: 'client_id', foreignTable: 'clients', foreignColumn: 'client_id' },
  { table: 'involves', column: 'case_id', foreignTable: 'legal_cases', foreignColumn: 'case_id' },
  { table: 'assigned_to', column: 'user_id', foreignTable: 'app_users', foreignColumn: 'user_id' },
  { table: 'assigned_to', column: 'case_id', foreignTable: 'legal_cases', foreignColumn: 'case_id' },
  { table: 'notifications', column: 'user_id', foreignTable: 'app_users', foreignColumn: 'user_id' },
  { table: 'messages', column: 'sender_user_id', foreignTable: 'app_users', foreignColumn: 'user_id' },
  { table: 'messages', column: 'receiver_user_id', foreignTable: 'app_users', foreignColumn: 'user_id' },
  { table: 'messages', column: 'case_id', foreignTable: 'legal_cases', foreignColumn: 'case_id' },
  { table: 'appointments', column: 'client_id', foreignTable: 'clients', foreignColumn: 'client_id' },
  { table: 'appointments', column: 'user_id', foreignTable: 'app_users', foreignColumn: 'user_id' },
  { table: 'appointments', column: 'case_id', foreignTable: 'legal_cases', foreignColumn: 'case_id' },
  { table: 'hearings', column: 'case_id', foreignTable: 'legal_cases', foreignColumn: 'case_id' },
  { table: 'hearings', column: 'court_id', foreignTable: 'courts', foreignColumn: 'court_id' },
  { table: 'tasks', column: 'case_id', foreignTable: 'legal_cases', foreignColumn: 'case_id' },
  { table: 'tasks', column: 'assigned_to_user_id', foreignTable: 'app_users', foreignColumn: 'user_id' },
  { table: 'tasks', column: 'created_by_user_id', foreignTable: 'app_users', foreignColumn: 'user_id' },
  { table: 'documents', column: 'case_id', foreignTable: 'legal_cases', foreignColumn: 'case_id' },
  { table: 'documents', column: 'client_id', foreignTable: 'clients', foreignColumn: 'client_id' },
  { table: 'documents', column: 'user_id', foreignTable: 'app_users', foreignColumn: 'user_id' },
  { table: 'audit_logs', column: 'user_id', foreignTable: 'app_users', foreignColumn: 'user_id' },
  { table: 'legal_references', column: 'user_id', foreignTable: 'app_users', foreignColumn: 'user_id' },
  { table: 'contracts', column: 'client_id', foreignTable: 'clients', foreignColumn: 'client_id' },
  { table: 'contracts', column: 'case_id', foreignTable: 'legal_cases', foreignColumn: 'case_id' },
  { table: 'contracts', column: 'user_id', foreignTable: 'app_users', foreignColumn: 'user_id' },
  { table: 'invoices', column: 'client_id', foreignTable: 'clients', foreignColumn: 'client_id' },
  { table: 'invoices', column: 'case_id', foreignTable: 'legal_cases', foreignColumn: 'case_id' },
  { table: 'invoices', column: 'user_id', foreignTable: 'app_users', foreignColumn: 'user_id' },
  { table: 'payments', column: 'invoice_id', foreignTable: 'invoices', foreignColumn: 'invoice_id' },
  { table: 'payments', column: 'user_id', foreignTable: 'app_users', foreignColumn: 'user_id' },
  { table: 'case_notes', column: 'case_id', foreignTable: 'legal_cases', foreignColumn: 'case_id' },
  { table: 'case_notes', column: 'user_id', foreignTable: 'app_users', foreignColumn: 'user_id' },
  { table: 'ai_interactions', column: 'user_id', foreignTable: 'app_users', foreignColumn: 'user_id' },
  { table: 'ai_interactions', column: 'case_id', foreignTable: 'legal_cases', foreignColumn: 'case_id' },
  { table: 'ai_interactions', column: 'document_id', foreignTable: 'documents', foreignColumn: 'document_id' },
  { table: 'ai_interaction_sources', column: 'interaction_id', foreignTable: 'ai_interactions', foreignColumn: 'interaction_id' },
  { table: 'ai_interaction_sources', column: 'reference_id', foreignTable: 'legal_references', foreignColumn: 'reference_id' },
  { table: 'case_status_history', column: 'case_id', foreignTable: 'legal_cases', foreignColumn: 'case_id' },
  { table: 'case_status_history', column: 'user_id', foreignTable: 'app_users', foreignColumn: 'user_id' },
  { table: 'law_offices', column: 'created_by_user_id', foreignTable: 'app_users', foreignColumn: 'user_id' },
  { table: 'office_memberships', column: 'office_id', foreignTable: 'law_offices', foreignColumn: 'office_id' },
  { table: 'office_memberships', column: 'user_id', foreignTable: 'app_users', foreignColumn: 'user_id' },
  { table: 'office_memberships', column: 'role_id', foreignTable: 'roles', foreignColumn: 'role_id' },
  { table: 'office_invitations', column: 'office_id', foreignTable: 'law_offices', foreignColumn: 'office_id' },
  { table: 'sessions', column: 'active_office_id', foreignTable: 'law_offices', foreignColumn: 'office_id' },
  { table: 'clients', column: 'office_id', foreignTable: 'law_offices', foreignColumn: 'office_id' },
  { table: 'legal_cases', column: 'office_id', foreignTable: 'law_offices', foreignColumn: 'office_id' },
  { table: 'documents', column: 'office_id', foreignTable: 'law_offices', foreignColumn: 'office_id' },
  { table: 'hearings', column: 'office_id', foreignTable: 'law_offices', foreignColumn: 'office_id' },
];

export function getDbConfig() {
  const env = process.env;
  const connectionString = env.DATABASE_URL;
  let host;
  if (connectionString) {
    let parsed;
    try {
      parsed = new URL(connectionString);
    } catch {
      throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
    }
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
      throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
    }
    if (!parsed.username.trim()) {
      throw new Error('DATABASE_URL must include an explicit, non-empty username.');
    }
    host = getUrlConnectionHost(parsed);
  } else {
    if (!env.DB_USER?.trim()) {
      throw new Error('DB_USER must be explicitly configured when DATABASE_URL is not set.');
    }
    if (env.DB_USER !== env.DB_USER.trim()) {
      throw new Error('DB_USER must not contain leading or trailing whitespace.');
    }
    host = env.DB_HOST || env.PGHOST;
    if (!host?.trim()) {
      throw new Error('A PostgreSQL database host must be explicitly configured.');
    }
    host = host.trim();
  }

  const remoteDatabase = !isLocalDatabaseHost(host);
  if (remoteDatabase && !connectionString && env.DB_SSL !== 'true') {
    throw new Error('DB_SSL=true is required for remote PostgreSQL connections.');
  }

  const config = {
    ssl: remoteDatabase || env.DB_SSL === 'true'
      ? { rejectUnauthorized: true }
      : false,
  };

  if (connectionString) {
    config.connectionString = remoteDatabase
      ? assertSafeDatabaseUrl(connectionString, env, true)
      : env.DB_SSL === 'true'
        ? assertSafeDatabaseUrl(connectionString, env, false)
        : connectionString;
  } else {
    config.port = Number(env.DB_PORT || env.PGPORT || 5432);
    config.user = env.DB_USER;
    config.password = env.DB_PASSWORD ?? env.PGPASSWORD ?? '';
    config.database = env.DB_NAME || env.PGDATABASE || 'smart_law_firm';
    config.host = host;
  }

  return config;
}

export function findSchemaPath() {
  const candidates = [
    path.resolve(__dirname, 'schema.sql'),
    path.resolve(__dirname, '../database/schema.sql'),
    path.resolve(process.cwd(), 'backend/database/schema.sql'),
    path.resolve(process.cwd(), 'database/schema.sql'),
    path.resolve(process.cwd(), 'schema.sql'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`schema.sql not found in candidate paths: ${candidates.join(', ')}`);
}

/**
 * Sanitizes schema SQL to prevent nested transaction boundaries.
 * Removes any redundant BEGIN; or COMMIT; statements from the SQL file.
 */
export function sanitizeSchemaSql(sql) {
  return sql
    .replace(/^\s*BEGIN\s*;/gim, '')
    .replace(/^\s*COMMIT\s*;/gim, '')
    .trim();
}

/**
 * Ensures target database exists on PostgreSQL server.
 * Connects to administrative database ('postgres') if necessary to create it.
 */
async function ensureDatabaseExists(config) {
  if (config.connectionString) {
    return;
  }

  const targetDb = config.database;
  const adminClient = new Client({
    ...config,
    database: 'postgres',
  });

  try {
    await adminClient.connect();
    const checkRes = await adminClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [targetDb]
    );

    if (checkRes.rowCount === 0) {
      console.log(`Database "${targetDb}" does not exist. Creating...`);
      const escapedDb = targetDb.replace(/"/g, '""');
      await adminClient.query(`CREATE DATABASE "${escapedDb}"`);
      console.log(`Database "${targetDb}" created successfully.`);
    }
  } catch (err) {
    console.warn(`Database check/creation notice: ${err.message}`);
  } finally {
    try {
      await adminClient.end();
    } catch {
      // Ignore cleanup error
    }
  }
}

/**
 * Verifies the database state:
 * - Checks connectivity and metadata
 * - Checks table count and expected tables
 * - Checks initial roles without duplicates
 * - Checks all 42 expected foreign key constraints
 */
export async function verifyDatabase(client) {
  console.log('\n--- Running Database Pre-Commit Verification ---');

  // 1. Connection check
  const infoRes = await client.query(
    'SELECT current_database() AS db, current_user AS "user", version() AS ver'
  );
  const { db, user, ver } = infoRes.rows[0];
  console.log(`Connected to database: "${db}" as user: "${user}"`);
  console.log(`PostgreSQL version: ${ver.split(',')[0]}`);

  // 2. Expected tables check
  const tableRes = await client.query(`
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public'
    ORDER BY tablename ASC
  `);
  const foundTables = new Set(tableRes.rows.map((r) => r.tablename));
  const missingTables = EXPECTED_TABLES.filter((t) => !foundTables.has(t));

  if (missingTables.length > 0) {
    throw new Error(`Verification failed: Missing expected tables: ${missingTables.join(', ')}`);
  }
  console.log(`✓ All ${EXPECTED_TABLES.length} expected tables are present in public schema.`);

  // 3. Roles check
  const rolesRes = await client.query('SELECT role_name FROM roles ORDER BY role_name ASC');
  const existingRoles = new Set(rolesRes.rows.map((r) => r.role_name));
  const missingRoles = EXPECTED_ROLES.filter((r) => !existingRoles.has(r));

  if (missingRoles.length > 0) {
    throw new Error(`Verification failed: Missing initial roles: ${missingRoles.join(', ')}`);
  }
  console.log(`✓ Initial roles verified: [${rolesRes.rows.map((r) => r.role_name).join(', ')}]`);

  // 4. Foreign Key Constraints check
  const fkRes = await client.query(`
    SELECT
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    ORDER BY tc.table_name, kcu.column_name;
  `);

  const activeFkKeys = new Set(
    fkRes.rows.map(
      (r) => `${r.table_name}.${r.column_name}->${r.foreign_table_name}.${r.foreign_column_name}`
    )
  );

  const missingFks = EXPECTED_FOREIGN_KEYS.filter(
    (fk) => !activeFkKeys.has(`${fk.table}.${fk.column}->${fk.foreignTable}.${fk.foreignColumn}`)
  );

  if (missingFks.length > 0) {
    const missingDesc = missingFks
      .map((f) => `${f.table}.${f.column}->${f.foreignTable}.${f.foreignColumn}`)
      .join(', ');
    throw new Error(`Verification failed: Missing expected foreign keys: ${missingDesc}`);
  }

  console.log(`✓ All ${EXPECTED_FOREIGN_KEYS.length} expected foreign keys confirmed active.`);

  return {
    database: db,
    user,
    tableCount: foundTables.size,
    rolesCount: rolesRes.rowCount,
    foreignKeyCount: fkRes.rowCount,
  };
}

/**
 * Initializes the database by reading and executing schema.sql inside a transaction.
 * Verification is performed inside the transaction BEFORE committing.
 *
 * @param {Object} options
 * @param {pg.Client|pg.PoolClient} [options.client] - Existing client to use (caller manages ownership)
 * @param {pg.Pool} [options.pool] - Existing pool to acquire a client from
 * @param {boolean} [options.closePool] - Whether to close the connection/pool on finish (defaults to false if pool passed, true if standalone)
 * @param {string} [options.schemaPath] - Explicit path to schema.sql
 * @param {boolean} [options.verify=true] - Whether to run verification before commit
 */
export async function initializeDatabase(options = {}) {
  if (options.reset && options.confirmDatabase !== 'smart_law_firm') {
    throw new Error(
      'Reset requires explicit confirmation with confirmDatabase: "smart_law_firm".'
    );
  }

  if (!options.reset && options.confirmDatabase) {
    throw new Error('confirmDatabase can only be used together with reset.');
  }

  const schemaFile = options.schemaPath || findSchemaPath();
  console.log(`Using schema file: ${schemaFile}`);
  const rawSql = fs.readFileSync(schemaFile, 'utf8');
  const schemaSql = sanitizeSchemaSql(rawSql);

  const config = getDbConfig();
  console.log(`Target database: ${config.connectionString ? 'DATABASE_URL' : `${config.database} on ${config.host}:${config.port}`}`);

  let client = options.client || null;
  let clientAcquiredFromPool = false;
  let ownedClient = false;
  let pool = options.pool || null;

  try {
    if (!client) {
      if (pool) {
        client = await pool.connect();
        clientAcquiredFromPool = true;
      } else {
        if (!options.reset) {
          await ensureDatabaseExists(config);
        }
        client = new Client(config);
        ownedClient = true;
        await client.connect();
      }
    }

    if (options.reset) {
      const targetResult = await client.query(`
        SELECT current_database() AS database,
               host(inet_server_addr()) AS server_address,
               inet_server_port() AS server_port
      `);
      const target = targetResult.rows[0];
      const isLoopback = target.server_address === '::1' ||
        target.server_address === '127.0.0.1' ||
        target.server_address?.startsWith('127.');

      if (
        target.database !== options.confirmDatabase ||
        target.server_port !== 5432 ||
        !isLoopback
      ) {
        throw new Error(
          `Refusing reset: connected target is ${target.database} at ${target.server_address}:${target.server_port}; expected smart_law_firm on localhost:5432.`
        );
      }

      console.log(
        `Explicit reset confirmed for ${target.database} at ${target.server_address}:${target.server_port}.`
      );
      console.log(`The following ${RESETTABLE_TABLES.length} public tables and their data will be dropped: ${RESETTABLE_TABLES.join(', ')}.`);
    }

    console.log('Beginning initialization transaction...');
    await client.query('BEGIN');

    try {
      if (options.reset) {
        const tableList = RESETTABLE_TABLES
          .map((table) => `public.${table}`)
          .join(', ');
        await client.query(`DROP TABLE IF EXISTS ${tableList}`);
        await client.query(
          'DROP FUNCTION IF EXISTS public.set_app_user_default_role()'
        );
      }

      console.log('Executing schema statements...');
      await client.query(schemaSql);

      if (options.verify !== false) {
        await verifyDatabase(client);
      }

      console.log('Committing transaction...');
      await client.query('COMMIT');
      console.log('Schema executed, verified, and committed successfully.');
    } catch (txErr) {
      console.error('Error during schema execution/verification, rolling back transaction...');
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Rollback error:', rollbackErr.message);
      }
      throw txErr;
    }

    console.log('\nDatabase initialization completed successfully!');
    return { success: true };
  } catch (err) {
    console.error('\nDatabase initialization failed:');
    console.error(err.message);
    throw err;
  } finally {
    // Correct client resource cleanup
    if (client) {
      if (clientAcquiredFromPool) {
        try {
          client.release();
        } catch (releaseErr) {
          console.error('Error releasing pool client:', releaseErr.message);
        }
      } else if (ownedClient) {
        try {
          await client.end();
        } catch (endErr) {
          console.error('Error ending standalone client:', endErr.message);
        }
      }
      // If options.client was passed in, caller retains ownership; we do not close it.
    }

    // Correct pool resource cleanup
    if (pool && options.closePool === true) {
      try {
        await pool.end();
      } catch (poolErr) {
        console.error('Error ending pool:', poolErr.message);
      }
    }
  }
}

// Standalone CLI execution
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMain) {
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');
  const confirmArgument = args.find((argument) =>
    argument.startsWith('--confirm-database=')
  );
  const confirmDatabase = confirmArgument?.split('=', 2)[1];

  if (args.some((argument) =>
    argument !== '--reset' && !argument.startsWith('--confirm-database=')
  )) {
    console.error(
      'Usage: node database/initialize.js [--reset --confirm-database=smart_law_firm]'
    );
    process.exit(1);
  } else if (reset !== Boolean(confirmDatabase)) {
    console.error(
      'Reset requires both --reset and --confirm-database=smart_law_firm.'
    );
    process.exit(1);
  } else {
    initializeDatabase({
      closePool: true,
      reset,
      confirmDatabase,
    })
    .then(() => {
      process.exit(0);
    })
    .catch(() => {
      process.exit(1);
    });
  }
}
