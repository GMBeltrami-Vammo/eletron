# Eletron — CLAUDE.md

Internal Vammo app: full visibility over battery-swap stations' finances — energy bills (Enel/EDP/third-party), rent contracts, payments, comprovantes, manual meter readings (mandatory photo), and alerts.
Users: finance/charging team, Google OAuth restricted to @vammo.com.

@decisions.md

## Current state

- Phase 1 (read-only visibility) and Phase 2 (dark mode, `charging` schema + writes, Drive file store, comprovante pipeline, manual bills, Gerar mês) shipped; **Phase 2.5 in progress** — sheets severed, Supabase-only test environment (decisions #25-28), roles suspended, milestones R0-R4 (plan: `.claude/plans` "Phase 2.5 Reformulation").
- Specs: `docs/superpowers/specs/2026-07-07-eletron-design.md` + `appendix/` (Phase 1) and `appendix/phase2/` (schema-writes, drive-comprovantes, ux-screens, **review-resolutions.md — authoritative where docs conflict**); decisions #25-28 override all of them where they touch sheets/roles.
- Data sources after the R2 cutover: the `charging` schema on the shared "Vammo Automations" Supabase project (one FINAL sheet clone at cutover, then frozen scraper data), Metabase cards 28816/28556 direct, uploads + the n8n `POST /api/ingest/cobrancas` webhook. Comprovante intake is app drag-drop only — the app owns extraction/chunked processing/matching (decision #41); the n8n comprovante processing + the Drive-folder poll are retired.
  Until the cutover the app still serves from the live Google Sheets read behind `REPOSITORY_BACKEND=sheets`; `context/*.xlsx` fixtures for dev/test.
- Deployed on Vercel as of 2026-07-07: GitHub repo connected to Vercel project `eletron` (auto-deploy), local checkout linked via `vercel link` (`.vercel/repo.json`, gitignored) — see decision #14. Custom domain still open (Q2). Always commit and push to main (Gabriel's standing instruction).

## Stack

- Next.js 15 App Router + TypeScript + Tailwind + shadcn/ui; `@leopardaelectric/vammo-ui` for Sidebar/PageHeader/TableControls/StatCard/badges.
- TanStack Query v5 + Table v8; Recharts; zod; next-auth v5 beta (Google, @vammo.com gate — port of goBuy `auth.ts`/`middleware.ts`).
- Vammo Design System **Product track** (Inter, 8 px buttons / 12 px cards radius, alert palette, Lucide 24, tabular-nums, pt-BR copy).

## Rules specific to this repo

- SHEETS SEVERED (decision #25): the app NEVER touches the SCRAPER/RENT sheets — no writes, and no reads after the R2 cutover.
  The only permitted scraper-sheet read is the one final clone via `scripts/backfill.ts`/`runSheetSync` at the cutover ritual; `lib/sheets/faturas-writeback.ts` and the `sheet_writebacks` outbox are dormant — do not wire new call sites to them.
  EXCEPTION — the FISCAL spreadsheet (`FISCAL_SPREADSHEET_ID`) is a SEPARATE sheet the app both READS (decision #40, `lib/fiscal/fiscal-sheet.ts` — "is this fatura already registered?") and WRITES (decision #42, `lib/fiscal/send-fiscal.ts` — the send-to-fiscal append; the ONLY sheet the app writes). The write needs the SA to have Editor; the scraper/rent sheets stay fully severed.
- The Vammo-Enel scraper stays untouched (decision #10); it keeps writing its own sheet, which this app simply no longer consumes.
- Sheet-clone code resolves columns by header name only — month columns (`F_MMMAA`/`R_MMMAA`, lowercase `mmmaa` on EDP) are inserted dynamically.
- All pt-BR parsing (money, dates, comma decimals, "Não/Nao cadastrado", UNIDENTIFIED sentinels) lives ONLY in `lib/ingest/normalize.ts` — screens never see raw source strings.
- Domain types in `lib/domain/` mirror the Supabase **`charging`** schema (appendix phase2/schema-writes.md + review-resolutions.md); keep them in sync with any schema evolution.
- "Financeiro Check" / `fiscal_exported` means "exported to the FISCAL spreadsheet", never "paid" (decision #21); `pago` only via `confirm_charge`/`record_payment`.
- Roles are suspended (decision #26): every write gate reduces to "authenticated @vammo.com"; keep the gate call sites (`isOperatorEmail`, `withOperator`, `getViewer`) intact so roles can be restored by reinstating the `user_roles` lookups.
- `context/` holds real bills/spreadsheets with PII and bank data: gitignored, never commit, never paste contents into logs.
