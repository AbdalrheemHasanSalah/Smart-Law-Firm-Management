import fs from 'fs';
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

export const EXPECTED_TABLES = [
  'roles',
  'app_users',
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

export const EXPECTED_FOREIGN_KEYS = [
  { table: 'app_users', column: 'role_id', foreignTable: 'roles', foreignColumn: 'role_id' },
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
];

export function getDbConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    };
  }

  return {
    host: process.env.DB_HOST || process.env.PGHOST || 'localhost',
    port: Number(process.env.DB_PORT || process.env.PGPORT || 5432),
    user: process.env.DB_USER || process.env.PGUSER || 'postgres',
    password: process.env.DB_PASSWORD ?? process.env.PGPASSWORD ?? '',
    database: process.env.DB_NAME || process.env.PGDATABASE || 'smart_law_firm',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };
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
        await ensureDatabaseExists(config);
        client = new Client(config);
        ownedClient = true;
        await client.connect();
      }
    }

    console.log('Beginning initialization transaction...');
    await client.query('BEGIN');

    try {
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
  initializeDatabase({ closePool: true })
    .then(() => {
      process.exit(0);
    })
    .catch(() => {
      process.exit(1);
    });
}
