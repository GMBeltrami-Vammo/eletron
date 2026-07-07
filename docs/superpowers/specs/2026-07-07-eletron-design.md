# Eletron — Swap Station Visibility App — Design Spec

Date: 2026-07-07.
Status: approved by Gabriel (plan review, same date).
Appendices carry the full detail: `appendix/data-model.md` (schema SQL + ingestion), `appendix/ux-screens.md` (screen-by-screen), `appendix/security-ops.md` (auth, jobs, failure modes).

## Context

Vammo pays energy and rent bills for its battery-swap stations, but visibility today is scattered across a Google Sheet fed by the Vammo-Enel scraper, seven n8n workflows, email inboxes, and manual monthly meter readings.
Eletron makes every swap station visible in one place: energy source (Enel / EDP / third-party), last bill, payment status, comprovantes, history, last scrape, contract, and rent payment status.

Confirmed decisions (see `decisions.md` for the full log):
- Next.js 15 App Router on Vercel GRU; next-auth v5 + Google OAuth @vammo.com from day one.
- Users: finance/charging team.
- v1 backbone: UI-first over cached live Google Sheets + xlsx fixtures; Supabase in Phase 2 via the same `normalize.ts`.
- 3 phases: read-only visibility → Supabase + first writes → AI ingestion + onboarding.
- Every n8n workflow (except Arqia SIM) has a designated home in the app; migration order decided later.
- Bias: excess of information over lack of it.

## Key findings that shaped the design

- `swap_station_id` (integer) is the universal key; secondary keys per bill source are `cadastro_id` (rent), `enel_id` (ENEL installation), `uc`+`edp_id` (EDP), counterparty CNPJ (third-party).
- One station has multiple bill sources: 27 stations carry 2–3 utility installations (station 553 has 3 ENEL ids); Hubees bills ~16 stations in one nota de débito; condo and Kitchen Central documents mix rent+energia in one document; 2_Pagamentos holds separate Aluguel and Energia rows for the same station-month.
- Station↔utility matching is heuristic (geo/address) and leaves literal `UNIDENTIFIED` rows — the model needs a first-class unmatched state and review flows.
- The scraper sheet has sharp edges: dynamically inserted month columns (resolve by header name), `=HYPERLINK` formulas (FORMULA render option), pt-BR comma decimals, "Sem contas" carrying stale status forward, weekly clear+rewrite of pipeline-owned tabs.
- Bill documents fall into 6 categories with different station-linking strategies; competência is often absent and must be inferred per issuer with the inference source recorded; byte-identical duplicate PDFs exist under different names (hash dedupe).
- Security debt found: hardcoded LlamaParse key and Arqia password in n8n JSONs, a plaintext `6_senhas` credentials tab, bill PDFs shared anyone-with-link.

## Design summary

### Architecture

The Vammo-Enel scraper stays untouched and keeps writing its Google Sheet.
A single ingestion core (`lib/ingest`: Sheets loader + `normalize.ts` + `derive.ts`) turns raw sheet rows into normalized domain objects.
In Phase 1 a `SheetSnapshotRepository` serves screens from a cached (~15 min) normalized snapshot, with `context/*.xlsx` fixtures for dev/tests.
In Phase 2 the same `normalize.ts` feeds a Supabase `eletron` schema through `/api/cron/sheet-sync`, and the repository implementation swaps.
Screens depend only on the repository interface and never touch raw sheet strings.

### Domain model

Core chain: `stations` 1—N `billing_accounts` (rent / energy_enel / energy_edp / third_party, each with its own external key and heuristic-match bookkeeping) 1—N `charges` (unified payables ledger with per-source `dedupe_key`), plus `charge_lines` (rent/energy splits, negative Hubees discount lines), `charge_energy_details` (TUSD/TE/CIP/tariff/leituras), `receipts` + `payments` (one Hubees receipt → 16 payments), `meter_readings` (photo NOT NULL), `contracts` (~25 fields, pricing modality formulas), `counterparties` (CNPJ unique, per-issuer value tolerance and billing-cycle rules), `alerts` (upsert by dedupe key, auto-resolve), `documents` (sha256 unique), and plumbing (`job_runs`, `raw_sheet_rows`, `email_ingestions`, `audit_events`, `user_roles`).
Full SQL in `appendix/data-model.md`.

### Screens

Vammo DS Product track; vammo-ui components; TanStack Table/Query; Recharts.
Routes: `/estacoes` (KPI strip + dense filterable station table with the 6 n8n warning categories as permanent quick-filters), `/estacoes/[id]` (360° with freshness ribbon and tabs Visão geral / Energia / Aluguel / Pagamentos / Leituras / Documentos / Histórico), `/energia`, `/alugueis` (+ `/novo` onboarding in Phase 3), `/pagamentos`, `/comprovantes` (Phase 2), `/leituras` + `/leituras/nova` (mobile-first, mandatory photo), `/revisao/*` (4 queues), `/alertas` (7 rule categories with lifecycle), `/admin/*`.
Full screen specs in `appendix/ux-screens.md`.

### Security & operations

goBuy's auth wiring ported verbatim; zero client table writes ever (SECURITY DEFINER RPCs + audit events from Phase 2); structural AI gate (`record_payment` refuses unconfirmed charges); one private storage bucket with signed URLs; upload validation with magic-byte sniffing and hash dedupe; EXIF extract-then-strip for meter photos; lease-locked idempotent cron jobs with a `job_runs` observability table and freshness alerting ("PC provavelmente desligado" when ENEL scrape > 36 h).
Full chapter in `appendix/security-ops.md`.

### n8n → app homes

| Workflow | Home |
|---|---|
| VencidasEnelWarning | `/alertas` overdue category + Slack digest job |
| SStation Warnings | `/alertas` 6 categories + quick-filters on `/estacoes`; ChargingOps webhook for shutdowns |
| PDF_Comprovante_Processor | `/comprovantes` upload + parser lib + matcher + `/revisao/comprovantes` |
| boleto_aluguel | `/api/cron/email-ingest` (Phase 3) + `/revisao/cobrancas` |
| Fill_Cadastro_Form | `/alugueis/novo` (whole-PDF AI extraction → editable form) |
| SStation_without_contract | `/revisao/irregularidades` (two outer joins, inline actions) |
| Alerta SIM_Data_Arqia | Out of scope — stays in n8n (decisions.md Q6 covers its hardcoded password) |

## Phasing

Phase 1 (this build): auth, ingestion core with unit-tested normalization, read-only screens (`/estacoes`, 360°, `/energia`, `/alugueis`, `/alertas` computed in TS, `/revisao/irregularidades`, `/leituras` UI with stubbed submit), Vercel deploy.
Phase 2: Supabase schema + sync cron + repository swap, PDF mirroring to private storage, meter-readings write flow, alert lifecycle + Slack digests, comprovante reconciliation + review queue, `record_payment` gate.
Phase 3: email-bill AI ingestion, contract onboarding, ND explosion with tolerance rules, Vault for portal credentials (retire `6_senhas`), rent adjustments, retire remaining n8n flows one by one.
