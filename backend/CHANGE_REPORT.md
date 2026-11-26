# Multi-tenant offices: backend change report

**For:** the backend owner of `database-reference/` (the team repository).
**Where:** every change is in `backend-development/`, a plain copy of `database-reference/backend` with no Git history. Nothing was committed, pushed, or applied to any shared or production database. The original repository is unchanged.

## Why

Qadiyati must serve many independent law offices, but the schema had no concept of an office. Any `admin` could read every case, client and document in the system, and every sign-up became a global `client`. This change adds offices as tenants and isolates their data:

- at the **query level**: every business query is filtered by the caller's verified office;
- at the **database level**: composite foreign keys make links across offices impossible.

## Data model (`database/schema.sql`, `database/migrations/0001_multi_tenant_offices.sql`)

| Change | Purpose |
|---|---|
| `law_offices` | The tenant. `status` is `pending` (default), `active`, `rejected` or `suspended`, and the table holds review metadata. |
| `office_memberships (office_id, user_id)` | Gives a user a role inside one office, reusing `roles` (`admin` = office administrator). It has a status and `is_owner`, with at most one owner per office. A user may belong to several offices. |
| `office_invitations` | Stores only a SHA-256 hash of the token, plus the invited email, role, expiry and an optional `client_id`. |
| `app_users.is_platform_admin` | Platform administration, kept separate from office administration. |
| `sessions.active_office_id` | The office chosen for this session, stored on the server. |
| `office_id NOT NULL` on every tenant-owned table | Covers `clients`, `legal_cases`, `involves`, `assigned_to`, `documents`, `contracts`, `invoices`, `payments`, `hearings`, `appointments`, `tasks`, `case_notes`, `case_status_history`, `messages`, `notifications` and `ai_interactions`. `audit_logs.office_id` is nullable. |
| Composite FKs, e.g. `(office_id, case_id) → legal_cases(office_id, case_id)` | A child row must belong to the same office as its case, client, document or invoice. Staff references go to `office_memberships(office_id, user_id)`. |
| Uniqueness per office | `case_number`, `invoice_number` and `clients(office_id, user_id)`. `bar_number` stays unique platform-wide. |
| Left shared on purpose | `courts`, `legal_references` and `lawyer_profiles`, since they describe the court system, the law, or a person rather than an office. |

`app_users.role_id` is kept for compatibility, but authorization no longer reads it.

**The migration has NOT been run against any real database.** It moves existing data into one active "Legacy office" owned by the earliest `admin`, and every existing user becomes a member with their current role. It fails closed: there are no `IF NOT EXISTS` clauses, so re-running it aborts. The migration runner stays locked as before, so a DBA review is needed before it is ever used (see `migrations/README.md`).

## Authorization

- `requireAuth` (`src/middleware/auth.js`) loads the account and **joins the session's active office**. `request.user.role` and `request.user.office_id` are set only when the membership **and** the office are both active. The client never supplies the office ID used for authorization.
- `requireRole` returns `403 NO_ACTIVE_OFFICE` when there is no verified office, so existing routes are tenant-scoped without being edited.
- Every service query passes through `officeCondition()` (`src/services/officeScope.js`), **including the admin branch**, which used to have no filter at all. Inserts take `office_id` from the server context.
- `requireSession` is used only for `/logout` and `/sign-out`, so a suspended account can still end its session.
- `requirePlatformAdmin` protects `/platform/*`. Platform admin can be granted only with `npm run platform-admin:grant -- --email=…`; there is no API for it.

## Endpoints

New endpoints (full contracts in the frontend's `docs/API_CONTRACTS.md`):

- `POST /api/offices` registers a pending office. The caller becomes owner and `admin`, and a lawyer profile is created.
- `GET /api/offices/mine` lists the caller's memberships.
- `POST /api/session/office` and `DELETE /api/session/office` select or clear the active office, after re-checking the membership.
- `GET/POST /api/offices/current/invitations` and `DELETE /api/offices/current/invitations/:id` manage invitations (office admin only).
- `GET /api/invitations/:token` is a public, masked preview.
- `POST /api/invitations/:token/accept` requires a signed-in account whose email matches the invitation. It links exactly the invited client record; nothing is linked by email matching alone.
- `GET /api/platform/offices`, `PATCH /api/platform/offices/:id` and `PATCH /api/platform/users/:id/status` cover platform review and account status.

Changed endpoints:

- `GET /api/me` and `GET /api/session` now also return `role` (role in the active office, or `null`), `active_office`, `memberships` and `user.is_platform_admin`.
- `/api/users/*` now manages the **members of the active office**. Role and status changes apply to the membership. Suspending a member removes that office from the member's open sessions.

## Better Auth configuration (`src/config/auth.js`)

- **Password reset is enabled**, with a 1-hour token, and every other session is revoked on reset. No mailer exists yet, so outside production the link is printed to the server console (`[dev mail] …`).
- **Inactive accounts:** the existing in-transaction check now throws `APIError('FORBIDDEN', { code: 'ACCOUNT_INACTIVE' })` instead of a plain `Error`, which used to produce a 500.
- **Rate limits** are added for `/api/auth/request-password-reset` (5) and `/api/auth/reset-password` (10).

## Behaviour changes to review

1. **New accounts have no office.** Sign-up no longer grants access to anything until an office is approved or an invitation is accepted.
2. **Error bodies** now include a machine-readable `code` (`errorHandler.js` sends `publicCode` for 4xx responses only); `error` is unchanged.
3. **Pre-existing bug fixed in `contractService.updateContract`:** the contract-ID placeholder pointed at the last pushed parameter, which was the scope's user ID. Contract updates by lawyers and assistants therefore never matched a row.
4. **Suspension and sessions:** account-level suspension (platform admin) deletes every session of the account, both on suspension and on reactivation. This is the original behaviour, moved from `/api/users` to `/api/platform/users`.

## Verification

All runs used temporary data only:

| Check | Result |
|---|---|
| Existing and updated unit suites (`npm test`, `test:client-account-linking`, `test:case-assignment-unit`) | 312 + 9 + 12 passing, 0 failing (2 skipped by the suite itself) |
| New `test/offices.test.js` | Included above: tenant scoping, office selection, registration, invitations, platform review, sign-out of suspended accounts |
| Schema and migration on an in-memory PostgreSQL (PGlite) | 24/24: cross-office FK rejections, per-office uniqueness, migration with existing data, fail-closed re-run |
| Real server + Better Auth + in-memory PostgreSQL, over HTTP | 45/45: IDOR attempts between two offices, invitation misuse, suspension, password reset |
| Real frontend build in Edge against the same server | 11/11: registration → approval → sign-in → reset, httpOnly cookie never readable from JavaScript |

Tests that compared exact SQL or parameters were updated for the added office parameter; their security assertions were kept. Tests whose behaviour intentionally changed were rewritten, notably membership status instead of account status in `test/user.test.js`.

## Not done / needs a decision

- **Email delivery**: there is no mail transport. Invitation links are returned to the admin and shared by hand, and reset links go to the console in development.
- **Email verification** is still disabled (`requireEmailVerification: false`). Enable it once a mailer exists; invitation acceptance already requires a matching email.
- The tables `hearings`, `appointments`, `messages`, `notifications`, `invoices` and `payments` have no routes yet. When added, they must use `officeCondition()` like the other services.
- Rate limiting is in-memory per process, as before.
- Have a DBA review `0001_multi_tenant_offices.sql`, especially the legacy-office backfill.

## Running locally

```bash
cd backend-development
cp .env.example .env      # set BETTER_AUTH_SECRET (32+ chars) and a LOCAL database, e.g. DB_NAME=qadiyati_dev
npm install
npm run db:init           # creates the schema on that local database (do not point it at smart_law_firm)
npm run dev               # http://localhost:3000
# after signing up the account that will review offices:
npm run platform-admin:grant -- --email=you@example.com
```
