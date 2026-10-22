import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const MIGRATION_ID_PATTERN = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;
const HISTORY_TABLE = 'schema_migrations';
const MIGRATION_LOCK_ID = 'smart-law-firm-schema-migrations-v1';
const MIGRATION_TRANSACTION_FENCE_ID = 'smart-law-firm-schema-migration-transaction-v1';

function migrationError(message) {
  return new Error(`Migration safety check failed: ${message}`);
}

function scanMigrationStatements(source, identifier) {
  const statements = [];
  let tokens = [];
  let index = 0;

  const fail = (reason) => {
    throw migrationError(`migration "${identifier}" ${reason}.`);
  };
  const finishStatement = () => {
    if (tokens.length) statements.push(tokens);
    tokens = [];
  };

  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === '-' && next === '-') {
      index += 2;
      while (
        index < source.length
        && source[index] !== '\n'
        && source[index] !== '\r'
      ) {
        index += 1;
      }
      continue;
    }
    if (character === '/' && next === '*') {
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source[index] === '/' && source[index + 1] === '*') {
          depth += 1;
          index += 2;
        } else if (source[index] === '*' && source[index + 1] === '/') {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (depth !== 0) fail('contains an unterminated block comment');
      continue;
    }
    if (character === "'") {
      const isEscapeString = tokens.at(-1) === 'E'
        && index > 0
        && /[eE]/.test(source[index - 1])
        && (index < 2 || !/[A-Za-z0-9_$]/.test(source[index - 2]));
      if (isEscapeString) tokens.pop();
      tokens.push('<literal>');
      index += 1;
      let closed = false;
      while (index < source.length) {
        if (source[index] === '\\' && isEscapeString) {
          index += 2;
        } else if (source[index] === '\\' && !isEscapeString) {
          fail('uses a backslash in a standard string; use an E-string or dollar quote');
        } else if (source[index] === "'" && source[index + 1] === "'") {
          index += 2;
        } else if (source[index] === "'") {
          index += 1;
          closed = true;
          break;
        } else {
          index += 1;
        }
      }
      if (!closed) fail('contains an unterminated string literal');
      continue;
    }
    if (character === '"') {
      tokens.push('<identifier>');
      index += 1;
      let closed = false;
      while (index < source.length) {
        if (source[index] === '"' && source[index + 1] === '"') {
          index += 2;
        } else if (source[index] === '"') {
          index += 1;
          closed = true;
          break;
        } else {
          index += 1;
        }
      }
      if (!closed) fail('contains an unterminated quoted identifier');
      continue;
    }
    if (character === '$') {
      const delimiter = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(source.slice(index))?.[0];
      if (delimiter) {
        const end = source.indexOf(delimiter, index + delimiter.length);
        if (end === -1) fail('contains an unterminated dollar-quoted string');
        tokens.push('<literal>');
        index = end + delimiter.length;
        continue;
      }
    }
    if (character === ';') {
      finishStatement();
      index += 1;
      continue;
    }
    if (/[A-Za-z_\u0080-\uFFFF]/.test(character)) {
      const word = /^[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_$\u0080-\uFFFF]*/.exec(
        source.slice(index)
      )[0];
      tokens.push(word.toUpperCase());
      index += word.length;
      continue;
    }

    tokens.push(character);
    index += 1;
  }

  finishStatement();
  return statements;
}

function assertRunnerManagedTransaction(source, identifier) {
  const transactionCommands = new Set([
    'ABORT',
    'BEGIN',
    'COMMIT',
    'END',
    'PREPARE',
    'RELEASE',
    'ROLLBACK',
    'SAVEPOINT',
    'START',
  ]);
  for (const [first, second] of scanMigrationStatements(source, identifier).map(
    (statement) => [statement[0], statement[1]]
  )) {
    if (
      transactionCommands.has(first)
      || (first === 'SET' && second === 'TRANSACTION')
      || first === 'DO'
      || first === 'CALL'
    ) {
      throw migrationError(
        `migration "${identifier}" contains unsupported transaction-control or procedural SQL.`
      );
    }
  }
}

function hasParenthesizedConcurrentReindexOption(statement) {
  if (statement[0] !== 'REINDEX' || statement[1] !== '(') return false;
  let depth = 0;
  for (const token of statement.slice(1)) {
    if (token === '(') depth += 1;
    if (token === ')') {
      depth -= 1;
      if (depth === 0) return false;
    } else if (depth > 0 && token === 'CONCURRENTLY') {
      return true;
    }
  }
  return false;
}

function assertNoConcurrentIndexOperation(source, identifier) {
  const statements = scanMigrationStatements(source, identifier);
  const hasConcurrentIndex = statements.some((statement) => (
    (
      ['CREATE', 'DROP'].includes(statement[0])
      && statement.some((token, index) => (
        token === 'INDEX' && statement[index + 1] === 'CONCURRENTLY'
      ))
    )
    || (
      statement[0] === 'REINDEX'
      && (
        statement.some((token, index) => (
          ['INDEX', 'TABLE', 'SCHEMA', 'DATABASE', 'SYSTEM'].includes(token)
          && statement[index + 1] === 'CONCURRENTLY'
        ))
        || hasParenthesizedConcurrentReindexOption(statement)
      )
    )
  ));
  if (hasConcurrentIndex) {
    throw migrationError(
      `migration "${identifier}" contains a non-transactional concurrent index operation.`
    );
  }
}

export function calculateMigrationChecksum(source) {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

export function validateMigrationSource(identifier, source) {
  if (!MIGRATION_ID_PATTERN.test(identifier)) {
    throw migrationError(`invalid migration identifier "${identifier}".`);
  }
  if (typeof source !== 'string' || !source.trim()) {
    throw migrationError(`migration "${identifier}" has no SQL source.`);
  }
  assertRunnerManagedTransaction(source, identifier);
  assertNoConcurrentIndexOperation(source, identifier);

  return {
    identifier,
    source,
    checksum: calculateMigrationChecksum(source),
  };
}

export async function readMigrationFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'));

  const migrations = [];
  const seenVersions = new Set();
  for (const name of names) {
    const match = MIGRATION_ID_PATTERN.exec(name);
    if (!match) {
      throw migrationError(`SQL file "${name}" does not have a valid versioned name.`);
    }
    if (seenVersions.has(match[1])) {
      throw migrationError(`migration version "${match[1]}" is duplicated.`);
    }
    seenVersions.add(match[1]);
    const source = await readFile(path.join(directory, name), 'utf8');
    migrations.push(validateMigrationSource(name, source));
  }

  return migrations;
}

async function getHistoryTableState(client) {
  const result = await client.query(
    "SELECT pg_catalog.to_regclass('public.schema_migrations') AS relation"
  );
  return result.rows[0]?.relation ? 'present' : 'absent';
}

export async function assertCompatibleHistoryTable(client) {
  const relation = await client.query(
    `SELECT relation.relkind,
            owner.rolname AS owner_name,
            relation.relrowsecurity,
            relation.relforcerowsecurity,
            EXISTS (
              SELECT 1
              FROM pg_catalog.pg_inherits AS inheritance
              WHERE inheritance.inhrelid = relation.oid
                 OR inheritance.inhparent = relation.oid
            ) AS has_inheritance,
            EXISTS (
              SELECT 1
              FROM pg_catalog.pg_trigger AS trigger_row
              WHERE trigger_row.tgrelid = relation.oid
            ) AS has_triggers,
            EXISTS (
              SELECT 1
              FROM pg_catalog.pg_rewrite AS rule_row
              WHERE rule_row.ev_class = relation.oid
                AND rule_row.rulename <> '_RETURN'
            ) AS has_rules,
            EXISTS (
              SELECT 1
              FROM pg_catalog.aclexplode(
                COALESCE(
                  relation.relacl,
                  pg_catalog.acldefault('r', relation.relowner)
                )
              ) AS privilege
              WHERE privilege.grantee <> relation.relowner
            ) AS has_non_owner_privileges,
            EXISTS (
              SELECT 1
              FROM pg_catalog.pg_attribute AS attribute
              CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS privilege
              WHERE attribute.attrelid = relation.oid
                AND attribute.attnum > 0
                AND NOT attribute.attisdropped
                AND attribute.attacl IS NOT NULL
                AND privilege.grantee <> relation.relowner
            ) AS has_column_privileges
       FROM pg_catalog.pg_class AS relation
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = relation.relnamespace
       JOIN pg_catalog.pg_roles AS owner
         ON owner.oid = relation.relowner
      WHERE namespace.nspname = 'public'
        AND relation.relname = $1`,
    [HISTORY_TABLE]
  );
  if (
    relation.rows.length !== 1
    || relation.rows[0].relkind !== 'r'
    || relation.rows[0].owner_name !== (await getCurrentRole(client))
    || relation.rows[0].relrowsecurity
    || relation.rows[0].relforcerowsecurity
    || relation.rows[0].has_inheritance
    || relation.rows[0].has_triggers
    || relation.rows[0].has_rules
    || relation.rows[0].has_non_owner_privileges
    || relation.rows[0].has_column_privileges
  ) {
    throw migrationError(
      'public.schema_migrations must be a plain, standalone table owned only by the current migration role, without RLS, external grants, triggers, or rules.'
    );
  }

  const columns = await client.query(
    `SELECT column_name, data_type, is_nullable, column_default,
            is_identity, is_generated
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position`,
    [HISTORY_TABLE]
  );
  const expectedColumns = [
    ['version', 'text', 'NO', null, 'NO', 'NEVER'],
    ['checksum', 'text', 'NO', null, 'NO', 'NEVER'],
    ['applied_at', 'timestamp with time zone', 'NO', 'now()', 'NO', 'NEVER'],
  ];

  if (
    columns.rows.length !== expectedColumns.length
    || columns.rows.some((column, index) => (
      column.column_name !== expectedColumns[index][0]
      || column.data_type !== expectedColumns[index][1]
      || column.is_nullable !== expectedColumns[index][2]
      || column.column_default !== expectedColumns[index][3]
      || column.is_identity !== expectedColumns[index][4]
      || column.is_generated !== expectedColumns[index][5]
    ))
  ) {
    throw migrationError(
      'public.schema_migrations exists with an unexpected column definition.'
    );
  }

  const primaryKey = await client.query(
    `SELECT constraint_column_usage.column_name
       FROM information_schema.table_constraints AS constraints
       JOIN information_schema.constraint_column_usage AS constraint_column_usage
         ON constraint_column_usage.constraint_catalog = constraints.constraint_catalog
        AND constraint_column_usage.constraint_schema = constraints.constraint_schema
        AND constraint_column_usage.constraint_name = constraints.constraint_name
         AND constraint_column_usage.table_name = constraints.table_name
      WHERE constraints.table_schema = 'public'
        AND constraints.table_name = $1
        AND constraints.constraint_type = 'PRIMARY KEY'`,
    [HISTORY_TABLE]
  );

  if (
    primaryKey.rows.length !== 1
    || primaryKey.rows[0].column_name !== 'version'
  ) {
    throw migrationError(
      'public.schema_migrations must have version as its sole primary key.'
    );
  }

  const unexpectedConstraints = await client.query(
    `SELECT constraint_row.contype
       FROM pg_catalog.pg_constraint AS constraint_row
       JOIN pg_catalog.pg_class AS relation
         ON relation.oid = constraint_row.conrelid
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = $1
        AND constraint_row.contype <> 'p'`,
    [HISTORY_TABLE]
  );
  if (unexpectedConstraints.rows.length) {
    throw migrationError(
      'public.schema_migrations must not have constraints other than its primary key.'
    );
  }

  const indexes = await client.query(
    `SELECT index_row.indisprimary,
            index_row.indisunique,
            index_row.indisvalid,
            index_row.indisready,
            index_row.indpred IS NULL AS has_no_predicate,
            index_row.indexprs IS NULL AS has_no_expressions,
            index_row.indnatts AS attribute_count,
            index_row.indkey[0] = attribute.attnum AS indexes_version
       FROM pg_catalog.pg_index AS index_row
       JOIN pg_catalog.pg_class AS table_row
         ON table_row.oid = index_row.indrelid
       JOIN pg_catalog.pg_namespace AS namespace
         ON namespace.oid = table_row.relnamespace
       JOIN pg_catalog.pg_attribute AS attribute
         ON attribute.attrelid = table_row.oid
        AND attribute.attname = 'version'
      WHERE namespace.nspname = 'public'
        AND table_row.relname = $1`,
    [HISTORY_TABLE]
  );
  if (
    indexes.rows.length !== 1
    || !indexes.rows[0].indisprimary
    || !indexes.rows[0].indisunique
    || !indexes.rows[0].indisvalid
    || !indexes.rows[0].indisready
    || !indexes.rows[0].has_no_predicate
    || !indexes.rows[0].has_no_expressions
    || indexes.rows[0].attribute_count !== 1
    || !indexes.rows[0].indexes_version
  ) {
    throw migrationError(
      'public.schema_migrations must have only its valid, non-partial primary-key index on version.'
    );
  }
}

async function getCurrentRole(client) {
  const result = await client.query('SELECT current_user AS role');
  return result.rows[0]?.role;
}

function normalizeHistoryRows(rows) {
  return rows.map(({ version, checksum, applied_at: appliedAt }) => ({
    version,
    checksum,
    appliedAt: appliedAt instanceof Date ? appliedAt.toISOString() : String(appliedAt),
  }));
}

async function readHistoryIntegritySnapshot(client) {
  await assertCompatibleHistoryTable(client);
  const relation = await client.query(
    `SELECT oid::text AS relation_oid
       FROM pg_catalog.pg_class
      WHERE oid = 'public.schema_migrations'::pg_catalog.regclass`
  );
  const entries = await client.query(
    `SELECT version, checksum, applied_at
       FROM public.schema_migrations
      ORDER BY version`
  );
  return {
    relationOid: relation.rows[0]?.relation_oid,
    entries: normalizeHistoryRows(entries.rows),
  };
}

function assertHistoryWasPreserved(before, after, identifier) {
  if (
    !before.relationOid
    || before.relationOid !== after.relationOid
    || JSON.stringify(before.entries) !== JSON.stringify(after.entries)
  ) {
    throw migrationError(
      `migration "${identifier}" modified or replaced the pre-existing migration history.`
    );
  }
}

async function readAppliedMigrations(client) {
  if (await getHistoryTableState(client) === 'absent') {
    return new Map();
  }

  await assertCompatibleHistoryTable(client);
  const result = await client.query(
    `SELECT version, checksum
       FROM public.schema_migrations
      ORDER BY version`
  );
  return new Map(result.rows.map(({ version, checksum }) => [version, checksum]));
}

function assertHistoryMatchesFiles(migrations, applied) {
  const filesById = new Map(migrations.map((migration) => [
    migration.identifier,
    migration.checksum,
  ]));

  for (const [identifier, checksum] of applied) {
    if (!MIGRATION_ID_PATTERN.test(identifier) || !CHECKSUM_PATTERN.test(checksum)) {
      throw migrationError('migration history contains an invalid identifier or checksum.');
    }
    const fileChecksum = filesById.get(identifier);
    if (!fileChecksum) {
      throw migrationError(
        `applied migration "${identifier}" has no corresponding source file.`
      );
    }
    if (fileChecksum !== checksum) {
      throw migrationError(
        `checksum mismatch for applied migration "${identifier}".`
      );
    }
  }
}

export function getPendingMigrations(migrations, applied) {
  assertHistoryMatchesFiles(migrations, applied);
  return migrations.filter((migration) => !applied.has(migration.identifier));
}

export async function applyPendingMigrations(client, migrations, lockClient) {
  if (!lockClient || lockClient === client) {
    throw migrationError(
      'a separate PostgreSQL session is required for migration coordination.'
    );
  }

  let lockAcquisitionAttempted = false;
  let primaryError;
  let result;
  let lockBackendPid;
  const committedMigrations = [];
  try {
    const [migrationBackend, lockBackend] = await Promise.all([
      client.query('SELECT pg_catalog.pg_backend_pid() AS pid'),
      lockClient.query('SELECT pg_catalog.pg_backend_pid() AS pid'),
    ]);
    if (
      typeof migrationBackend.rows[0]?.pid !== 'number'
      || typeof lockBackend.rows[0]?.pid !== 'number'
      || migrationBackend.rows[0].pid === lockBackend.rows[0].pid
    ) {
      throw migrationError(
        'migration SQL and the coordination lock must use distinct PostgreSQL sessions.'
      );
    }
    lockBackendPid = lockBackend.rows[0].pid;

    lockAcquisitionAttempted = true;
    await lockClient.query(
      'SELECT pg_catalog.pg_advisory_lock(pg_catalog.hashtext($1))',
      [MIGRATION_LOCK_ID]
    );

    let applied = await readAppliedMigrations(client);
    let pending = getPendingMigrations(migrations, applied);

    for (const migration of pending) {
      let transactionAttempted = false;
      let commitAttempted = false;
      try {
        transactionAttempted = true;
        await client.query('BEGIN');
        await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
        await client.query(
          'SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext($1))',
          [MIGRATION_TRANSACTION_FENCE_ID]
        );
        const lockHealth = await lockClient.query(
          'SELECT pg_catalog.pg_backend_pid() AS pid'
        );
        if (lockHealth.rows[0]?.pid !== lockBackendPid) {
          throw migrationError(
            'the coordination connection changed PostgreSQL sessions during migration.'
          );
        }
        applied = await readAppliedMigrations(client);
        pending = getPendingMigrations(migrations, applied);
        if (!pending.some(({ identifier }) => identifier === migration.identifier)) {
          await client.query('ROLLBACK');
          continue;
        }
        if (await getHistoryTableState(client) === 'absent') {
          await client.query(
            `CREATE TABLE public.schema_migrations (
               version TEXT PRIMARY KEY,
               checksum TEXT NOT NULL,
               applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
             )`
          );
        }
        await assertCompatibleHistoryTable(client);
        const historyBefore = await readHistoryIntegritySnapshot(client);

        await client.query(migration.source);
        const historyAfter = await readHistoryIntegritySnapshot(client);
        assertHistoryWasPreserved(historyBefore, historyAfter, migration.identifier);
        await client.query(
          `INSERT INTO public.schema_migrations (version, checksum)
           VALUES ($1, $2)`,
          [migration.identifier, migration.checksum]
        );
        commitAttempted = true;
        await client.query('COMMIT');
        committedMigrations.push(migration.identifier);
      } catch (error) {
        let failure = error;
        if (transactionAttempted) {
          try {
            await client.query('ROLLBACK');
          } catch (rollbackError) {
            failure = new AggregateError(
              [failure, rollbackError],
              `Migration "${migration.identifier}" failed and rollback also failed.`,
              { cause: failure }
            );
          }
        }
        const migrationFailure = new Error(
          `Migration "${migration.identifier}" failed; later migrations were not run.`,
          { cause: failure }
        );
        if (commitAttempted) {
          throw new Error(
            `Migration "${migration.identifier}" COMMIT outcome is ambiguous; it may already be applied. Check public.schema_migrations before retrying.`,
            { cause: migrationFailure }
          );
        }
        throw migrationFailure;
      }

      try {
        const lockHealth = await lockClient.query(
          'SELECT pg_catalog.pg_backend_pid() AS pid'
        );
        if (lockHealth.rows[0]?.pid !== lockBackendPid) {
          throw migrationError(
            'the coordination connection changed PostgreSQL sessions during migration.'
          );
        }
      } catch (error) {
        throw new Error(
          `Migration "${migration.identifier}" committed, but the coordination connection was lost; check public.schema_migrations before retrying.`,
          { cause: error }
        );
      }

      try {
        applied = await readAppliedMigrations(client);
        pending = getPendingMigrations(migrations, applied);
      } catch (error) {
        throw new Error(
          `Migration "${migration.identifier}" committed, but post-commit ledger verification failed; inspect public.schema_migrations and the target catalog before retrying.`,
          { cause: error }
        );
      }
    }

    result = { applied: applied.size, pending: pending.length };
  } catch (error) {
    primaryError = error;
  }

  if (primaryError && committedMigrations.length) {
    primaryError = new Error(
      `Migration run failed after committed migration(s) ${committedMigrations.join(', ')}; inspect public.schema_migrations and the target catalog before retrying.`,
      { cause: primaryError }
    );
  }

  let cleanupError;
  if (lockAcquisitionAttempted) {
    try {
      const unlock = await lockClient.query(
        'SELECT pg_catalog.pg_advisory_unlock(pg_catalog.hashtext($1))',
        [MIGRATION_LOCK_ID]
      );
      if (unlock.rows[0]?.pg_advisory_unlock !== true) {
        throw migrationError('the migration coordination lock was lost before cleanup.');
      }
    } catch (error) {
      cleanupError = error;
    }
  }

  if (primaryError && cleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError],
      committedMigrations.length
        ? 'Migration execution and coordination-lock cleanup failed; committed migrations may already be applied. Inspect public.schema_migrations and the target catalog before retrying.'
        : 'Migration execution failed and coordination-lock cleanup also failed.',
      { cause: primaryError }
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupError && committedMigrations.length) {
    throw new Error(
      `Coordination-lock cleanup failed after committed migration(s) ${committedMigrations.join(', ')}; inspect public.schema_migrations and the target catalog before retrying.`,
      { cause: cleanupError }
    );
  }
  if (cleanupError) throw cleanupError;
  return result;
}

export async function inspectMigrationStatus(client, migrations) {
  const applied = await readAppliedMigrations(client);
  const pending = getPendingMigrations(migrations, applied);
  return {
    applied: [...applied.keys()],
    pending: pending.map(({ identifier }) => identifier),
  };
}
