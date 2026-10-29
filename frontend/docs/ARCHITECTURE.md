# Qadiyati — Frontend Architecture & Phase 1 Analysis

This document records the analysis of the three references (ERD, colour palette, website design) and the decisions that every later stage builds on.

---

## 1. ERD analysis (Image 1 — PostgreSQL, schema `public`)

22 tables were read from the ERD. Their TypeScript models live in `src/types/entities.ts`, with **column names kept exactly as in the database** (snake_case).

| Group | Tables |
|---|---|
| Identity & access | `roles`, `app_users`, `lawyer_profiles`, `audit_logs` |
| Clients & cases | `clients`, `courts`, `legal_cases`, `involves` (client ⇄ case), `assigned_to` (user ⇄ case), `case_notes`, `case_status_history` |
| Scheduling | `hearings`, `appointments`, `tasks` |
| Documents | `documents`, `contracts` |
| Billing | `invoices`, `payments` |
| Communication | `messages`, `notifications` |
| AI & research | `ai_interactions`, `legal_references`, `ai_interaction_sources` (interaction ⇄ reference) |

### Key relationships

- `app_users.role_id → roles` (each user has one role). `lawyer_profiles.user_id → app_users` (a lawyer is a user with a profile).
- `legal_cases.court_id → courts`.
- **Many-to-many**: clients ⇄ cases through `involves` (`party_role`, `is_primary`); users ⇄ cases through `assigned_to` (`assignment_role`, `is_lead`, `assigned_at`).
- Children of a case: `hearings`, `case_notes`, `case_status_history`, `tasks`, `documents`, `contracts`, `invoices`, `messages`, `appointments`, `ai_interactions` (all via `case_id`).
- `hearings` has **both** `case_id` and its own `court_id` (a hearing's court can differ from the case's court).
- `payments.invoice_id → invoices`; `invoices` link to a client and optionally a case.
- `tasks` has two user FKs: `assigned_to_user_id` and `created_by_user_id`. `messages` has `sender_user_id` and `receiver_user_id`.
- `ai_interactions` may reference a case and a document; its sources are `legal_references` via `ai_interaction_sources`.

### Entity → frontend module mapping

Not every table becomes a page; junction and history tables appear inside their parent.

| Module (route) | Primary table | Shown inside it |
|---|---|---|
| Auth (`/login`, …) | `app_users`, `roles` | — |
| Cases | `legal_cases` | tabs: parties (`involves`→`clients`), team (`assigned_to`→`app_users`), `hearings`, `documents`, `case_notes`, `case_status_history`, `tasks`, `contracts`, `invoices`, `messages` |
| Clients | `clients` | related cases via `involves`, documents, contracts, invoices, appointments |
| Hearings | `hearings` | case + court |
| Courts | `courts` | reference list, used by case/hearing selectors |
| Appointments | `appointments` | client, case, user |
| Documents | `documents` | case, client, uploader |
| Tasks | `tasks` | case, assignee, creator |
| Contracts | `contracts` | client, case, `analysis_summary` |
| Invoices / Payments | `invoices`, `payments` | invoice → payments |
| Users & lawyers | `app_users`, `lawyer_profiles`, `roles` | — |
| Messages | `messages` | sender/receiver, case |
| Notifications | `notifications` | — |
| AI assistant / search | `ai_interactions`, `ai_interaction_sources`, `legal_references` | — |
| Activity history | `audit_logs` | shown as "recent activity" in dashboard / case details |

### Gaps and items to confirm with the backend developer

These are **not** invented in the frontend; they are flagged here instead.

1. **Nullability** is not visible in the ERD image. Obvious optional columns (`closed_at`, `read_at`, `completed_at`, `description`, …) are typed `| null` as an assumption.
2. **Allowed values** of every varchar `status` / `*_type` / `priority` / `visibility` / `access_level` column are not listed. They are typed as `string`; mock data uses provisional values (e.g. `app_users.status`: `active` / `inactive`).
3. **`documents` has no file-size column**, but the brief asks to show file size. Either the backend adds one (e.g. `size_bytes`) or the UI reads it from object-storage metadata. Not shown until confirmed.
4. **Registration** — *resolved (multi-tenant)*: only an office owner self-registers, creating a pending office that a platform administrator approves; lawyers, assistants and clients join by invitation. See `docs/API_CONTRACTS.md`.
5. **Auth transport** — *resolved*: Better Auth httpOnly session cookie (`withCredentials`), password reset through Better Auth. No token is stored in the browser.
6. **"Remember me"** — *resolved*: sent as Better Auth `rememberMe`; `false` gives a browser-session cookie.
7. `clients.user_id` — *resolved*: the client-portal account linked to that office's client record, set only by accepting an invitation for that record.
8. Unique markers (key icon) were read on: `legal_cases.case_number`, `roles.role_name`, `app_users.email`, `lawyer_profiles.bar_number`, `invoices.invoice_number`, `payments.reference_number`, `documents.storage_key`, `contracts.storage_key`.
9. `numeric(12,2)` amounts are typed as `string` to avoid float rounding; `invoices.currency` is `character(3)` (ISO-4217, e.g. ILS / JOD / USD).
10. `password_hash` is intentionally **excluded** from the frontend `AppUser` type.

---

## 2. Colour system (Image 2)

Palette sampled from the reference: `#2b372d` deep forest · `#4a4e40` olive · `#655d4d` umber · `#9b6229` bronze · `#ba997e` champagne. Extended with ivory (`#faf7f1`, `#f3eee4`) and charcoal (`#22241f`).

Defined in `src/styles/tokens.css` as **primitives** and **semantic tokens** (`--background`, `--surface`, `--heading`, `--primary`, `--accent`, `--gold`, `--border`, `--ring`, …), re-mapped for `.dark`. Tailwind utilities (`bg-surface`, `text-heading`, `border-gold`…) are generated from them in `src/styles/globals.css`. Components never use raw hex.

| Token | Light | Dark |
|---|---|---|
| background | ivory `#faf7f1` | forest `#121915` |
| surface | white | `#18211b` |
| heading | forest `#2b372d` | ivory `#f3ecde` |
| primary (buttons) | forest | champagne `#cdb293` |
| accent (links, eyebrows) | bronze `#8a5622`* | champagne |

\*The palette bronze `#9b6229` was darkened slightly for text so it meets WCAG AA on ivory.

## 3. Design reference (Image 3)

Adopted: serif display headings (Playfair Display / Amiri), small uppercase gold "eyebrow" labels with a hairline rule, generously rounded image frames with one oversized corner, a thin gold inset frame, deep green photographic panels, white cards with soft shadows. Not adopted: scales/gavels as decoration, testimonials or invented statistics.

## 4. Brand

`src/components/brand/LogoMark.tsx` — the emblem (balance scale in front of a case folder), cropped from the full logo and recoloured to the theme palette (forest + bronze on light, ivory + champagne on dark).
Static files in `public/brand/`: `qadiyati-logo.png` (full logo with wordmark, for light backgrounds), `qadiyati-logo-light.png` (for dark/photo backgrounds), `qadiyati-mark.png` / `qadiyati-mark-light.png` (emblem only), and `public/favicon.png`. All have transparent backgrounds.

## 5. Frontend architecture

```
src/
  app/            App.tsx, providers/ (theme, query, i18n, motion, auth), router/ (routes, guards)
  assets/         photos.ts (licensed photo registry + credits)
  components/
    ui/           shadcn-style primitives: button, input, label, checkbox, spinner, toaster
    shared/       ThemeToggle, LanguageSwitcher, FormField, Alert, Photo
    motion/       presets + Reveal / Stagger (reusable animation system)
    brand/        LogoMark, Logo
    layout/       PageLoader, CenteredMessage
  features/auth/  api/ (http + mock + selector), components/, hooks/, pages/, schemas/, AuthProvider
  hooks/          use-language, use-document-title
  lib/            env, i18n, storage, utils, i18n-message
  services/       api/ (axios client, ApiError, query keys), adapters/ (mock ⇄ http selector)
  mocks/data/     fictional demo records
  locales/        ar/ and en/ (common, auth, validation)
  styles/         tokens.css, fonts.css, globals.css
  types/          entities.ts (ERD models)
```

### Cross-cutting systems

- **i18n** — i18next with separate JSON files per language and namespace. Arabic is default. Changing language updates `<html lang dir>`, swaps font stacks and persists to `localStorage` (`qadiyati.lang`). Validation messages are stored as i18n *keys* in Zod schemas, so errors re-translate instantly.
- **Theme** — one `ThemeProvider`; class on `<html>`; persists to `qadiyati.theme`; follows the OS when no choice is saved. An inline script in `index.html` applies language + theme before first paint (no flash).
- **RTL/LTR** — only logical utilities (`ps-`, `pe-`, `start-`, `end-`, `ms-`, `rounded-ss-`), so layouts mirror automatically. Email/password fields stay `dir="ltr"`.
- **Motion** — Motion for React with `MotionConfig reducedMotion="user"`; transform/opacity only; shared easing in `components/motion/presets.ts`.
- **Data** — every service has a typed interface with a mock and an HTTP implementation; `VITE_USE_MOCKS` picks one. TanStack Query handles server state; API errors are normalised to `ApiError` codes translated from `common:errors.*`.
- **Security posture** — the mock auth adapter and route guards only control what the UI shows. Real authentication and authorisation are the backend's job.
