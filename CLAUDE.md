# Eletron — CLAUDE.md

Internal Vammo app: full visibility over battery-swap stations' finances — energy bills (Enel/EDP/third-party), rent contracts, payments, comprovantes, manual meter readings (mandatory photo), and alerts.
Users: finance/charging team, Google OAuth restricted to @vammo.com.

@decisions.md

## Current state

- Phase 1 (read-only visibility) in progress; Supabase arrives in Phase 2.
- Spec: `docs/superpowers/specs/2026-07-07-eletron-design.md` + `appendix/` (full data model SQL, screen-by-screen UX, security/ops chapters).
- Data sources v1: live Google Sheets read (scraper sheet `1MBJwXex...` + rent sheet `18FxHr2F...`) cached ~15 min, with `context/*.xlsx` snapshots as dev/test fixtures.
- Deployed on Vercel as of 2026-07-07: GitHub repo connected to Vercel project `eletron` (auto-deploy), local checkout linked via `vercel link` (`.vercel/repo.json`, gitignored) — see decision #14. Use `vercel env pull .env.local` once env vars exist; custom domain still open (Q2).

## Stack

- Next.js 15 App Router + TypeScript + Tailwind + shadcn/ui; `@leopardaelectric/vammo-ui` for Sidebar/PageHeader/TableControls/StatCard/badges.
- TanStack Query v5 + Table v8; Recharts; zod; next-auth v5 beta (Google, @vammo.com gate — port of goBuy `auth.ts`/`middleware.ts`).
- Vammo Design System **Product track** (Inter, 8 px buttons / 12 px cards radius, alert palette, Lucide 24, tabular-nums, pt-BR copy).

## Rules specific to this repo

- The Vammo-Enel scraper and its Google Sheet are upstream and read-only; never write to scraper-owned tabs.
- Resolve sheet columns by header name only — month columns (`F_MMMAA`/`R_MMMAA`, lowercase `mmmaa` on EDP) are inserted dynamically.
- All pt-BR parsing (money, dates, comma decimals, "Não/Nao cadastrado", UNIDENTIFIED sentinels) lives ONLY in `lib/ingest/normalize.ts` — screens never see raw sheet strings.
- Domain types in `lib/domain/` mirror the future Supabase `eletron` schema (appendix data.md); keep them in sync with any schema evolution.
- `context/` holds real bills/spreadsheets with PII and bank data: gitignored, never commit, never paste contents into logs.
