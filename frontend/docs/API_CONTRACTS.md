# API contracts — authentication and offices

**Status:** implemented in `backend-development/` (the separate working copy of the backend). It has not been merged into the team repository yet. The frontend calls these endpoints through `src/features/auth/api/auth.http.ts`. Changing an endpoint means editing only that file.

- **Base URL:** `VITE_API_BASE_URL` (default `http://localhost:3000/api`).
- **Session:** an **httpOnly cookie** set by Better Auth. The frontend sends it with `withCredentials: true` and never reads or stores a token.
- **CORS:** the backend accepts the origins listed in `FRONTEND_URL` / `TRUSTED_FRONTEND_ORIGINS`.

## Errors

The backend sends `{ "code": "…", "error": "…" }`. Better Auth sends `{ "code": "…", "message": "…" }`. The frontend uses **only** the `code` (see `src/services/api/api-error.ts`) and translates it through `errors.<code>`, so server wording is never shown.

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_CREDENTIALS` | 401 | Wrong email or password. Mapped from Better Auth's `INVALID_EMAIL_OR_PASSWORD`. |
| `ACCOUNT_INACTIVE` | 403 | Account suspended or inactive. Checked after the password. |
| `EMAIL_TAKEN` | 422 | Sign-up with an existing email. Mapped from `USER_ALREADY_EXISTS*`. |
| `RATE_LIMITED` | 429 | Too many attempts. |
| `NO_ACTIVE_OFFICE` | 403 | A business route was called without a verified active office. |
| `OFFICE_PENDING` / `OFFICE_INACTIVE` | 403 | The office is under review, or is rejected/suspended. |
| `MEMBERSHIP_SUSPENDED` | 403 | Access to this office is suspended. |
| `REGISTRATION_PENDING` | 409 | The account already has an office awaiting review. |
| `BAR_NUMBER_TAKEN` / `BAR_NUMBER_MISMATCH` | 409 | Bar number already registered, or different from the one on the account. |
| `INVITATION_INVALID` | 404 / 410 | Unknown, used, revoked or expired invitation. |
| `INVITATION_EMAIL_MISMATCH` | 403 | The invitation was sent to another email address. |
| `ALREADY_MEMBER` | 409 | Already a member of the office. |
| `RESET_TOKEN_INVALID` | 400 | Password-reset link is invalid or expired. Mapped from Better Auth's `INVALID_TOKEN`. |

## Authentication (Better Auth)

| Request | Body | Notes |
|---|---|---|
| `POST /auth/sign-up/email` | `{ name, email, password }` | Password must be 8–128 characters. The user is signed in immediately. The new account has **no office membership**. |
| `POST /auth/sign-in/email` | `{ email, password, rememberMe }` | `rememberMe: false` makes it a browser-session cookie. |
| `POST /logout` | — | Works for any valid session, including that of a suspended account. |
| `POST /auth/request-password-reset` | `{ email, redirectTo }` | Gives the same answer whether or not the email exists. `redirectTo` must be a trusted origin. With no mailer configured, the link is printed to the backend console. |
| `POST /auth/reset-password` | `{ token, newPassword }` | Signs out every other session of the account. |

The emailed link opens `/api/auth/reset-password/:token?callbackURL=…`. That redirects to the frontend's `/reset-password?token=…`, or to `?error=INVALID_TOKEN`.

## Session

### `GET /me` (also `GET /session`)

```json
{
  "user": { "user_id": "uuid", "full_name": "…", "email": "…", "email_verified": false, "status": "active", "is_platform_admin": false, "created_at": "ISO", "updated_at": "ISO" },
  "role": "admin | lawyer | assistant | client | null",
  "active_office": { "office_id": "uuid", "office_name": "…", "office_status": "active", "office_city": "…", "role": "admin", "membership_status": "active", "is_owner": true },
  "memberships": [ { "…": "same shape as active_office" } ],
  "session": { "…": "public Better Auth session fields" }
}
```

`role` and `active_office` are `null` until an office is selected. They are recomputed from the database on **every request**.

### `POST /session/office` — `{ office_id }`

Stores the chosen office **on the server-side session** after checking membership and statuses. An office the user doesn't belong to returns 404, the same response as an unknown ID.

`DELETE /session/office` clears the active office.

## Offices

### `POST /offices` (signed in)

```json
{
  "office": { "name": "…", "phone": "+970 …", "city": "…", "email": "optional", "address": "optional", "license_number": "optional" },
  "lawyer": { "bar_number": "…", "specialty": "optional", "years_experience": 0 }
}
```

`201 { "office": { "office_id", "name", "status": "pending", "created_at" } }`

The caller becomes the owner and `admin` of the office, which grants no data access until the office is approved.

### `GET /offices/mine` → `{ memberships: [...] }`

## Invitations

| Request | Who | Notes |
|---|---|---|
| `POST /offices/current/invitations` `{ email, role, client_id? }` | Office admin | `role` ∈ `lawyer`, `assistant`, `client`. `client_id` is allowed only with `client` and must be an unlinked client of the same office. Returns `{ invitation, invite_url }`; the link is valid for 7 days and can be used once. |
| `GET /offices/current/invitations` | Office admin | The latest 100 invitations. |
| `DELETE /offices/current/invitations/:id` | Office admin | Revokes an invitation. |
| `GET /invitations/:token` | Public | `{ office_name, office_active, role, email_hint, state, expires_at }`. The email is masked. |
| `POST /invitations/:token/accept` `{ bar_number?, specialty?, years_experience? }` | Signed in | The account email must match the invited email. On success, the office becomes the session's active office. |

## Platform administration

| Request | Notes |
|---|---|
| `GET /platform/offices?status=pending` | Offices together with their owner and the owner's bar number. |
| `PATCH /platform/offices/:id` `{ status: active\|rejected\|suspended, review_note? }` | Approving an office also marks the owner's licence as verified. Rejecting or suspending removes the office from every open session. |
| `PATCH /platform/users/:id/status` `{ status: active\|inactive\|suspended }` | Platform-wide account status. Every session of the account is deleted, both on suspension and on reactivation. |

Platform administration is granted only from the command line (`npm run platform-admin:grant -- --email=…`). No API endpoint grants it.
