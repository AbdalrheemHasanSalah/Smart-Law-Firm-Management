# Database migrations

`schema.sql` is the bootstrap definition for a fresh installation.
`initialize.js` is a separate initializer and is not a migration runner.
Versioned upgrades are applied only by the explicit `migrate.js` command.

There are intentionally no migration SQL files yet. The source schemas show a
Better Auth difference from the committed legacy schema, but the live database
structure and its partial changes have not been inspected. Do not add a
Better Auth migration until a DBA has reviewed the target catalog and approved
the precise change set. In particular, never link existing users by email or
copy legacy `password_hash` values into Better Auth.

## Migration format

Name migrations using a unique, ordered four-digit version and lowercase
description, for example `0001_descriptive_name.sql`. Each file is applied in
its own PostgreSQL transaction. Do not include transaction-control statements
or non-transactional operations such as `CREATE INDEX CONCURRENTLY`,
`DROP INDEX CONCURRENTLY`, or `REINDEX ... CONCURRENTLY`. The token-aware
guard detects these command forms outside comments and quoted literals; it is
not a general SQL parser and does not validate arbitrary SQL syntax. It also
checks the parenthesized `REINDEX (CONCURRENTLY) ...` option form; accepted
syntax can vary by PostgreSQL version, so this guard is only defense in depth.

The runner uses a fail-closed lexical guard, not a complete PostgreSQL parser.
It skips nested comments, quoted strings/identifiers, and dollar-quoted
strings, and rejects transaction-control commands, `DO`, and `CALL`. Standard
strings containing backslashes are rejected; use a reviewed escape string or
dollar quoting instead. This guard does not prove that arbitrary SQL is safe.
Migration SQL must remain plain, reviewed SQL and must not use procedural or
dynamic execution to hide behavior.

The runner calculates a SHA-256 checksum from each source file and stores it
with its version in `public.schema_migrations`. It refuses to reapply an
applied version, a changed checksum, a history entry with no source file, or
an incompatible history table. Never edit an applied migration; add a new
version instead.

The runner acquires its session advisory lock on a separate PostgreSQL
connection from the one that executes migration SQL. It compares their
`pg_backend_pid()` values before locking, checks the lock-session PID before
each migration's SQL, and checks it again after each commit. These repeated
checks detect some connection changes; a PID check performed once would not
prove session stability for the full run.

Each migration transaction also acquires a distinct transaction-level advisory
fence on the migration connection. If the separate lock connection is lost
while migration SQL is running, the in-flight transaction is not cancelled
and may commit. A runner using this same session-lock and transaction-fence
protocol must wait for that transaction fence before running migration SQL;
after `BEGIN`, the runner explicitly sets `READ COMMITTED` before acquiring
the fence, then rereads the ledger and recalculates pending migrations. This
ordering is intended to give that post-fence read a fresh statement snapshot,
including commits made while it waited; it does not override or prove
PostgreSQL runtime behavior for every server version or proxy configuration.
The original runner then detects the lost coordination session after commit
and stops before starting another migration. This is cooperative coordination,
not a durable or universal fencing guarantee: older or otherwise nonconforming
runners that do not acquire the same transaction fence can bypass it, and it
does not prevent non-runner database actors from changing schema or history.
Do not rely on query cancellation to make lock loss safe.

There remains a check-to-use race: the lock-session PID check immediately
before migration SQL cannot atomically guarantee that the separate lock session
remains alive until or during the SQL. The current migration transaction may
therefore continue and commit after lock loss; the fence only coordinates
conforming runners while that transaction is active, and the original runner
checks the lock connection after commit before proceeding.

Both clients must remain bound to their respective PostgreSQL backend sessions
for the entire call. Use direct PostgreSQL connections or a configuration
that guarantees session affinity; transaction-pooling proxies are unsupported.
The clients must be distinct, connected, single-session clients, and callers
of `applyPendingMigrations` must close both after the call, including on
errors. The CLI follows this connection cleanup contract. A false unlock
result or unlock error is reported without replacing an earlier migration
error. If `COMMIT` returns an error, or any later ledger verification,
pending-list calculation, or unlock/connection cleanup fails after one or more
migrations committed, the command reports that migrations may already be
applied. Check `public.schema_migrations` and the target catalog before
retrying; never automatically rerun after an ambiguous outcome.

The first migration creates the history table inside the same transaction as
that migration. The migration role must own the table. Before every read or
write, the runner checks that the ledger is an ordinary table owned by the
current migration role, has only its expected columns/defaults and primary
key and its only valid index has one key attribute (`version`) with no
predicate or expressions, is not inherited, has no other
constraints, has no row-level security, and has no relation- or column-level
grants to other roles, triggers, or rules. For each migration transaction it
also snapshots the ledger relation OID and all existing rows, then verifies
they are unchanged before recording the new migration. An existing ledger
that fails any check must be investigated and repaired through a separately
reviewed DBA procedure; the runner will not adopt or repair it.

These checks are integrity safeguards against accidental or straightforward
tampering, not cryptographic protection against malicious migration SQL. SQL
could modify and restore identical ledger contents within one transaction, so
matching final snapshots cannot prove the ledger was never altered. Use
independent protected audit records, strict source review, and controlled
execution for that threat. Catalog ACL checks also do not establish every
effective privilege in PostgreSQL; inherited privileges and server behavior
must be verified by a DBA against the actual isolated target.

Each migration must contain explicit preflight checks for the structures it
changes. It must stop on unexpected columns, constraints, indexes, existing
data conflicts, or partial prior changes. `IF NOT EXISTS` alone is not a
compatibility check. The runner does not automatically drop or repair objects.

## Required target authorization and connection safeguards

The target URL, environment label, and database name are not proof of target
identity. Before any migration command can connect, it must receive a signed
Ed25519 authorization token whose claims bind the environment, database,
role, host, port, exact PostgreSQL server IP addresses, and expiration time.
The token expires within ten minutes. Production is not an allowed environment.
The authorization public key supplied to the process is accepted only if its
SHA-256 fingerprint matches `TRUSTED_AUTHORIZATION_KEY_SHA256` in
`database/migrate.js`. That source constant is intentionally unconfigured, so
the CLI currently fails closed; do not configure it until the organization
has provisioned and reviewed an independent signing key and approval process.
The private signing key must never be stored in this repository or supplied to
the migration process.

Set these variables in the invoking shell, not in a committed environment
file:

- `MIGRATION_TARGET_ENV`: `development`, `test`, or `staging` (production is
  refused and the value must match the signed authorization).
- `MIGRATION_DATABASE_URL`: explicit PostgreSQL URL including port and role.
- `MIGRATION_DATABASE_NAME`: exact database name expected in that URL.
- `MIGRATION_DATABASE_ROLE`: exact login role expected in that URL.
- `MIGRATION_AUTHORIZATION_TOKEN`: `<base64url-canonical-json>.<base64url-signature>`.
- `MIGRATION_AUTHORIZATION_PUBLIC_KEY`: PEM-encoded Ed25519 public key whose
  fingerprint matches the source-pinned fingerprint.

The signed JSON claims have this exact ordered shape:
`environment`, `database`, `role`, `host`, `port`, `serverAddresses` (sorted,
unique IP strings), and `expiresAt` (canonical ISO-8601 UTC timestamp). The
token signs the UTF-8 bytes of that compact JSON. Any mismatch, unpinned key,
unknown claim, expired token, or unsupported target fails closed. Existing
`MIGRATION_HOST_ALLOWLIST` and `MIGRATION_SERVER_ADDRESS_ALLOWLIST` settings
are no longer used; identity comes from the signed authorization.

Every target, including localhost and IP-address targets, must use
`sslmode=verify-full`. This requires certificate-chain validation and
hostname/IP identity verification using Node's configured system trust store.
Custom `sslrootcert` values are rejected because an unpinned CA would weaken
the independently signed target authorization. The following environment
overrides are rejected: `PGHOST`, `PGHOSTADDR`,
`PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE`, `PGSSLROOTCERT`,
`PGSSLCERT`, `PGSSLKEY`, `PGOPTIONS`, `PGSERVICE`, `PGSERVICEFILE`,
`NODE_TLS_REJECT_UNAUTHORIZED`, `NODE_EXTRA_CA_CERTS`, `NODE_OPTIONS`,
`SSL_CERT_FILE`, `SSL_CERT_DIR`, and `OPENSSL_CONF`. This is an explicit
denylist, not a blanket rejection of every `PG*` variable; other PostgreSQL
environment variables must be assessed against the installed `pg` version and
deployment environment before use.

Before future runtime use, a DBA must provision and independently verify a
dedicated non-superuser migration role, its ownership/DDL privileges limited
to the authorized target, and no access to the development database. The
runner also blocks the known `smart_law_firm` database, `NODE_ENV=production`,
the `postgres` role, dangerous role attributes, role memberships, and detected
CONNECT privilege on the development database, including CONNECT granted to
`PUBLIC`. A restricted login will therefore also be rejected if `PUBLIC` has
CONNECT on that database. Do not weaken this safeguard to accommodate default
database ACLs; have the DBA verify and configure the isolated target's actual
ACLs. The mock-based test only verifies the runner's decision logic; it does
not validate PostgreSQL's effective privilege calculations or catalog query
against a live server. These checks do not prove server ownership, database
disposability, or all effective privileges; DBA verification and independent
target authorization remain required. Never use the application pool,
application credentials, a superuser, or the test-runner role for migrations.
Never grant privileges automatically.

## Future commands (NOT EXECUTED)

From `backend`, after separately provisioning and verifying a non-production
target and taking a restorable backup:

```text
npm run db:migrate:status
npm run db:migrate -- --confirm-target=<exact-database-name>
```

Status opens a connection for read-only catalog/history inspection. Apply
requires the exact database confirmation argument in addition to the explicit
environment configuration. The runner itself never creates or resets a
database.

Take and independently verify a backup before applying migrations. The
transaction protects each migration's transactional DDL and history row, but
does not replace backup/restore. If a migration fails before commit, the
runner attempts rollback and stops. A COMMIT error is treated as ambiguous:
the server may have committed even when the client did not receive confirmation.
Post-commit verification or connection-cleanup errors likewise do not prove
that the migration failed. Inspect the migration ledger and target catalog
before retrying; do not assume retry is safe or drop unexpected objects.
Non-transactional work, if ever needed, requires a separate reviewed procedure
and is not supported by this runner.

The existing `backend/test/migrationRunner.test.js` tests are deterministic,
mock-based source tests. They cover runner logic, selected SQL-token cases,
the source ordering of the explicit isolation setting and fence, simulated
post-commit ledger failures, simulated unlock failures after commits,
coordination-session loss, and ambiguous commit outcomes.
They do not prove PostgreSQL advisory-lock behavior, transaction-pooling
behavior, catalog semantics, effective grants, TLS identity validation against
a server, concurrent sessions, or recovery after real server failures. Before
any real migration use, add and run integration tests only against a separately
provisioned, positively identified, disposable PostgreSQL instance. Include
ledger tampering/rollback behavior, `PUBLIC CONNECT`/role-privilege cases,
session-lock loss while a migration transaction remains active, and competing
runners using the transaction fence.
Have a DBA review the target schema, migration role, SQL, a restorable backup,
and a verified restore procedure before applying any migration.

Production or development database use requires a separately reviewed code
authorization change, DBA approval, a maintenance/cutover plan, and an
independent backup/restore check. Do not infer approval from a database name,
an environment variable, or the presence of `schema_migrations`.
