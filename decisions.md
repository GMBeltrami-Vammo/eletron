# Eletron — Decision Log

Traceability record of architectural and product decisions made during the build.
Each entry records what was decided, why, and when.
Full design spec: `docs/superpowers/specs/2026-07-07-eletron-design.md` (+ appendix with the complete data/UX/security designs).

---

## Architecture Decisions

| # | Decision | Chosen | Alternatives Considered | Rationale |
|---|---|---|---|---|
| 1 | Platform (2026-07-07) | Next.js 15 (App Router) on Vercel GRU | Electron desktop app | Workspace convention (VammoGrid/goBuy/VammoTestFleet); phone access needed for the meter-photo flow; OAuth gating is a workspace hard rule for Vercel apps; "eletron" is the project name (energy theme), not the framework |
| 2 | Authentication | next-auth v5 beta + Google OAuth restricted to @vammo.com, from day one | Public unlisted URL (VammoGrid V1 style) | Workspace hard rule for anything on Vercel; goBuy's `auth.ts`/`middleware.ts` is the proven template (hd hint + server-side endsWith check + email_verified) |
| 3 | v1 data backbone | UI-first: live Google Sheets read (cached ~15 min) + xlsx fixtures; Supabase arrives in Phase 2 | Supabase from day one; replace scraper outputs entirely | Gabriel's call: see the app take shape first ("for now, only worry about data flow and app format/function"). A repository interface + a single `normalize.ts` mean the data layer is reused when Supabase lands, not rebuilt. Replacing scraper outputs violates "scraper stays as-is" |
| 4 | Domain model | station 1—N `billing_accounts` (rent / energy_enel / energy_edp / third_party) 1—N `charges` (+ `charge_lines`, `payments`, `receipts`, `meter_readings`) | Flat per-station bill columns (sheet mirror) | Evidence from the sheets: 27 stations have 2–3 utility installations (station 553 has 3); Hubees bills ~16 stations in one nota de débito; condo/Kitchen Central documents mix rent+energia and need per-line splits; UNIDENTIFIED rows need a first-class unmatched state |
| 5 | External keys | `swap_station_id` (int) universal; `enel_id` / `edp_uc` / `cadastro_id` / counterparty CNPJ per account type; CNPJ digits-only is the issuer key, razão social never is | Name-based matching | Rede Automan 1 vs 2 have near-identical names and different CNPJs; Kitchen Central SPEs have standardized names; matching by name already produced the UNIDENTIFIED debris in the sheets |
| 6 | Dedupe/idempotency | `content_hash` (sha256) unique on documents; `linha_digitavel` for boletos; `(enel_id\|uc, due_date)` for scraper invoices; per-source `dedupe_key` unique on charges; filenames are never identity | Filename-based tracking (status quo) | Byte-identical bill PDFs exist under different filenames in the current inbox; the scraper sheet's own dedupe invariant is `(id, due_date)` |
| 7 | Writes (Phase 2+) | SECURITY DEFINER RPCs only + `audit_events` in the same transaction; zero client INSERT/UPDATE/DELETE; two roles (`admin`, `operator`) checked inside Postgres | Direct table grants; app-layer-only checks | goBuy `finance.request_events` pattern is the workspace standard; Postgres as final authority; "mark paid" and "remap account" have different blast radii, hence two roles |
| 8 | AI trust boundary (Phase 2+) | `record_payment` structurally refuses charges not human-confirmed; AI-extracted data always lands in review queues first | Auto-apply AI extractions | Nothing AI-written may reach "pago" without a named human in the audit trail; the n8n flow's silent UNIDENTIFIED appends are the failure mode being fixed |
| 9 | File storage (Phase 2+) | ONE private Supabase Storage bucket `eletron-documents`, path `{kind}/{yyyy}/{mm}/{sha256}`, served only via session-checked signed URLs (5 min TTL) | Four per-kind buckets; keep Drive anyone-with-link | No client storage policies at all, so bucket-level separation adds nothing; fixes the anyone-with-link exposure for app-served files. Later task: flip the Drive folder itself off anyone-with-link |
| 10 | Scraper relationship | Vammo-Enel stays untouched; its sheet tabs are pipeline-owned read-only inputs; columns resolved by header name only; all pt-BR parsing quarantined in `normalize.ts` | Modify scraper to write Postgres | Scraper has its own read-back logic (sheet dedupe, Drive-PDF idempotency) and a human Slack matching loop; breaking it risks the nightly run. Revisit post-v1 as a scraper-side change |
| 11 | Component library | `@leopardaelectric/vammo-ui` first (Sidebar, PageHeader, TableControls, StatCard, badges); bare shadcn/ui only for gaps; Vammo DS Product track (Inter, 8/12 px radius, alert palette) | Bare shadcn/ui like VammoGrid/goBuy | Workspace gotcha says check vammo-ui before adding UI components; eletron becomes the first Desktop/Vammo project to actually consume it |
| 12 | Rollout | 3 phases: (1) read-only visibility + meter-reading UI; (2) Supabase + sync + first writes (meter readings, comprovantes, alert lifecycle); (3) AI ingestion + contract onboarding | Everything in v1 | Each phase ships something usable; risky writes come after the foundation hardens; approved by Gabriel 2026-07-07 |
| 13 | n8n migration | Design-for-replacement now, migrate later; every workflow has a designated home (see spec §n8n); the two read-only alert workflows are cut over first after parity; Arqia SIM stays in n8n (out of scope — IoT telemetry, not station finance) | Replace n8n in v1; coexist indefinitely | Gabriel's call 2026-07-07; lowest-risk order is read-only alerts → comprovantes → email ingestion → cadastro form |

---

## Product Decisions

| # | Decision | Chosen | Rationale |
|---|---|---|---|
| P1 | Users | Finance/charging team | Confirmed by Gabriel; reads open to any @vammo.com account, writes role-gated from Phase 2 |
| P2 | Information density | Excess over lack: dense tables with column-visibility menus, raw source payloads retained (`raw` jsonb), per-row freshness timestamps as first-class UI | Gabriel: "I rather have excess of information than lack of it in the first versions" |
| P3 | Meter readings | New module; photo is structurally mandatory (submit disabled without photo; NOT NULL FK in Phase 2 schema); mobile-first capture flow; EXIF (time/GPS) extracted for verification then stripped | Some stations require monthly physical meter reads; photo requirement came as a hard requirement |
| P4 | Alerts | The app's alerts panel is the record (7 rule categories, acknowledge/resolve lifecycle); Slack becomes a thin push only (vencidas digest + shutdowns → ChargingOps) | Slack messages scroll away; permanent queryable panel replaces re-alerting every 3 days |
| P5 | Language | UI copy in pt-BR, informal "você", sentence case, no emoji; code/identifiers in English | Vammo DS voice/tone; team is Brazilian |

---

## Open Questions / Future Decisions

| # | Question | Status |
|---|---|---|
| Q1 | Phase 2: write `Comprovante`/`Financeiro Check` back to the sheets during transition, or cut the n8n comprovante flow over entirely? | Open — decide at Phase 2 start; prefer full cutover if Phase 1 alert parity held |
| Q2 | Production domain (eletron.vammo.com?) and Vercel project naming | Open — needed at first deploy |
| Q3 | Vercel Pro `maxDuration=300` for cron routes (Phase 2 sheet-sync) | Open — verify plan/limits before Phase 2 |
| Q4 | `@leopardaelectric/vammo-ui` install access (private GitHub package) and current version | Open — resolve during scaffold; fall back to shadcn/ui equivalents if blocked, keeping the same visual tokens |
| Q5 | DIA store↔station and Hubees address↔station mappings: who owns/maintains them (admin screen exists in design) | Open — Phase 3 concern |
| Q6 | Quick n8n hygiene: move hardcoded LlamaParse key (boleto_aluguel) + Arqia portal password (SIM_Data_Arqia) into n8n credentials/variables | Pending — 10-min manual fix in the n8n UI, independent of this repo |
| Q7 | `context/` folder (real bills with CNPJs/bank data) is gitignored, kept local as design fixtures | Decided for now — revisit if the repo needs shared fixtures (then use sanitized copies) |
