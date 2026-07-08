# Eletron — CLAUDE.md

Internal Vammo app: full visibility over battery-swap stations' finances — energy bills (Enel/EDP/third-party), rent contracts, payments, comprovantes, manual meter readings (mandatory photo), and alerts.
Users: finance/charging team, Google OAuth restricted to @vammo.com.

@decisions.md

## Current state

- Phase 1 (read-only visibility) shipped; **Phase 2 in progress** (dark mode, `charging` Supabase schema + first writes, Drive file store, comprovante pipeline, manual bills, Gerar mês).
- Specs: `docs/superpowers/specs/2026-07-07-eletron-design.md` + `appendix/` (Phase 1) and `appendix/phase2/` (schema-writes, drive-comprovantes, ux-screens, **review-resolutions.md — authoritative where docs conflict**).
- Data sources: live Google Sheets read (scraper sheet `1MBJwXex...` + rent sheet `18FxHr2F...`) cached ~15 min, `context/*.xlsx` fixtures for dev/test; Phase 2 adds the `charging` schema on the shared "Vammo Automations" Supabase project behind a `REPOSITORY_BACKEND` flag.
- Deployed on Vercel as of 2026-07-07: GitHub repo connected to Vercel project `eletron` (auto-deploy), local checkout linked via `vercel link` (`.vercel/repo.json`, gitignored) — see decision #14. Use `vercel env pull .env.local` once env vars exist; custom domain still open (Q2).

## Stack

- Next.js 15 App Router + TypeScript + Tailwind + shadcn/ui; `@leopardaelectric/vammo-ui` for Sidebar/PageHeader/TableControls/StatCard/badges.
- TanStack Query v5 + Table v8; Recharts; zod; next-auth v5 beta (Google, @vammo.com gate — port of goBuy `auth.ts`/`middleware.ts`).
- Vammo Design System **Product track** (Inter, 8 px buttons / 12 px cards radius, alert palette, Lucide 24, tabular-nums, pt-BR copy).

## Rules specific to this repo

- The Vammo-Enel scraper and its Google Sheet are upstream; scraper-owned state tabs (enel_data, edp_data, Vammo_data, backups) are READ-ONLY, always.
  Exception (decision #19): the app may APPEND rows to `Faturas_ENEL`, `Faturas_EDP` and `2_Pagamentos`, only via `lib/sheets/faturas-writeback.ts` (tab allowlist asserted in code, outbox with retries, DB is source of truth).
- Resolve sheet columns by header name only — month columns (`F_MMMAA`/`R_MMMAA`, lowercase `mmmaa` on EDP) are inserted dynamically.
- All pt-BR parsing (money, dates, comma decimals, "Não/Nao cadastrado", UNIDENTIFIED sentinels) lives ONLY in `lib/ingest/normalize.ts` — screens never see raw sheet strings.
- Domain types in `lib/domain/` mirror the Supabase **`charging`** schema (appendix phase2/schema-writes.md + review-resolutions.md); keep them in sync with any schema evolution.
- "Financeiro Check" / `fiscal_exported` means "exported to the FISCAL spreadsheet", never "paid" (decision #21); `pago` only via `confirm_charge`/`record_payment`.
- `context/` holds real bills/spreadsheets with PII and bank data: gitignored, never commit, never paste contents into logs.
