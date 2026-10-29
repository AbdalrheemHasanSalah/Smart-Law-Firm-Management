# قضيتي | Qadiyati — Frontend

Frontend for a law-firm management system (graduation project). React 19 + TypeScript (strict) + Vite, Tailwind CSS v4 with shadcn-style components on Radix, TanStack Query, React Router, React Hook Form + Zod, i18next (Arabic RTL default / English LTR), Motion for React.

**Current stage:** foundations + Login page. Other routes show a labelled "upcoming stage" screen.

## Run

```bash
npm install
cp .env.example .env      # VITE_USE_MOCKS=true by default
npm run dev               # http://localhost:5173
```

### Demo accounts (mock mode only)

| Email | Result |
|---|---|
| `lawyer@qadiyati.ps` | signs in (lawyer) |
| `admin@qadiyati.ps` | signs in (admin) |
| `inactive@qadiyati.ps` | "account not active" error |

Password for all: `Qadiyati@2026`, or press **Fill demo credentials** on the login page. These are fictional and work only in the browser mock; they are not real authentication.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | type-check + production build |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint |
| `npm test` | Vitest + Testing Library unit/component tests |
| `npm run test:e2e` | Playwright (run `npx playwright install chromium` once) |
| `npm run format` | Prettier |

## Connecting the real backend

Set `VITE_USE_MOCKS=false` and `VITE_API_BASE_URL` in `.env`. Endpoint assumptions are listed in `docs/API_CONTRACTS.md`.

## Docs

- `docs/ARCHITECTURE.md` — ERD analysis, entity→module mapping, open questions, design system, folder structure.
- `docs/API_CONTRACTS.md` — provisional endpoints.

## Photo credits

Photography from Unsplash (Unsplash License): Karwin Luo, Mark Weaver, Krists Luhaers. Registry and links in `src/assets/photos.ts`.
