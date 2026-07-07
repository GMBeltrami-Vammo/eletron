# Eletron — Security & Operations Chapter

Perspective: security + operations engineer. Everything below is prescriptive; deviations should be recorded in `decisions.md`.

---

## 1. Auth / Authz

### 1.1 Identity: next-auth v5 + Google OAuth, copied from goBuy (proven in prod)

Reuse goBuy's exact wiring — it is the workspace's reference implementation and already solves the "next-auth identity → Supabase RLS" bridge:

- **`auth.ts`**: NextAuth with Google provider, JWT session strategy (no DB adapter — sessions are stateless cookies, nothing to store or leak).
- **Domain gate** in the `signIn` callback: `user.email?.toLowerCase().endsWith("@vammo.com")`. Additionally pass `authorization: { params: { hd: "vammo.com" } }` on the Google provider so the account picker pre-filters — but the server-side `endsWith` check remains the enforcement (the `hd` param is UX only, never trust it alone). Also require `profile.email_verified === true`.
- **Supabase token minting** (goBuy `lib/supabase/token.ts`, copy verbatim): the `jwt` callback mints a short-lived (8h, refreshed at 7h) HS256 JWT signed with `SUPABASE_JWT_SECRET`, `role: "authenticated"`, `email` claim, deterministic UUID `sub` derived from email. This token is what client components and server code use to call Supabase *as that user*, so Postgres — not TypeScript — is the final authority on every check.
- **`middleware.ts`** (goBuy pattern): everything requires a session except `/login`, `/api/auth/*`, and `/api/cron/*` (cron authenticates itself, §4). API paths return JSON 401; pages redirect to `/login`. Matcher excludes static assets only.

### 1.2 Server-side verification rules

- Every server action and route handler starts with `const session = await auth()` and rejects if `!session?.user?.email` or not `@vammo.com`. Middleware is defense-in-depth, not the sole gate.
- Route handlers that mutate also do a same-origin check (goBuy `isSameOrigin`) as CSRF defense-in-depth.
- **No server code path ever trusts a client-supplied email/role.** Actor identity always comes from the session; the RPC re-derives it from `jwt_email()` inside Postgres.

### 1.3 Roles: two roles, enforced in Postgres

The finance/charging team is small and trusted, but "mark this bill paid" and "re-map a billing account to another station" have different blast radii. Ship a minimal two-role split from day one — it costs one table and one helper function:

- `eletron.user_roles (email text pk, role text check (role in ('admin','operator')), created_at, created_by_email)`
- **Any authenticated @vammo.com user**: read everything (RLS SELECT policies check `eletron.jwt_email() like '%@vammo.com'`). Gabriel's "excess of information" bias — viewing is company-wide by domain.
- **`operator`** (the finance/charging team): all write RPCs — meter readings, mark-paid, review-queue resolutions, comprovante uploads.
- **`admin`** (Gabriel + 1 backup): role management, billing-account remapping, deleting/voiding records, portal-credential management, job re-runs.
- Helpers mirrored from goBuy: `eletron.jwt_email()`, `eletron.is_operator()`, `eletron.is_admin()` — called *inside every RPC*, never only in the UI.
- Seed `user_roles` via migration; changes only through an admin RPC (`set_user_role`) which itself writes an audit event.

---

## 2. Supabase Security Posture

### 2.1 Schema and privilege layout

- Dedicated schema **`eletron`** (mirror of goBuy's `finance` schema). Nothing in `public`.
- `REVOKE ALL` from `anon` on the schema — anonymous key gets zero access; the app never uses it for data.
- `authenticated` gets `USAGE` on the schema + `SELECT` on tables/views **through RLS policies only** (`GRANT SELECT` + RLS enabled + domain-check policy). **No INSERT/UPDATE/DELETE grants to any client-facing role, ever.**
- All mutations go through `SECURITY DEFINER` functions with `SET search_path TO 'eletron'` (goBuy `approve_purchase_request` is the template: `FOR UPDATE` row locks, state-machine guards, `GET DIAGNOSTICS ROW_COUNT` double-submit guards, explicit `RAISE EXCEPTION` messages).
- **Service-role key**: exists only as `SUPABASE_SERVICE_ROLE_KEY` server env var (no `NEXT_PUBLIC_` prefix anywhere in the codebase — add a lint/CI grep for `NEXT_PUBLIC_SUPABASE_SERVICE`). Used exclusively by: cron sync jobs, file upload/download routes (after session authz), and storage administration. User-initiated reads/writes always use the minted user JWT so RLS and RPC role checks apply.
- Note for setup: new Supabase projects default to asymmetric JWT signing — enable/retrieve the **legacy HS256 JWT secret** (as goBuy uses) or adapt `mintSupabaseToken` to the project's signing config. Verify `auth.jwt()->>'email'` resolves before building policies on it.

### 2.2 Audit events — one table, written by every RPC

Mirror `finance.request_events`, generalized (eletron has many entity types):

```
eletron.audit_events (
  id bigint identity pk,
  entity_type text not null,        -- 'charge' | 'payment' | 'meter_reading' | 'billing_account' | 'contract' | 'document' | 'user_role' | 'job' ...
  entity_id text not null,
  event_type text not null,         -- 'created' | 'marked_paid' | 'review_resolved' | 'reading_registered' | 'remapped' | 'voided' | 'role_changed' ...
  actor_email text not null,        -- 'system:sheet-sync' etc. for jobs
  detail jsonb,                     -- old/new values, match confidence, sha256, job_run_id
  created_at timestamptz default now()
)
```

Rules: append-only (no UPDATE/DELETE grants to anyone but service role — and even service role code never updates it); every `SECURITY DEFINER` RPC inserts exactly one event inside the same transaction as its mutation; cron jobs write events under `actor_email = 'system:<job>'` with `job_run_id` in detail. Surface per-entity timelines in the UI (station detail → "Histórico") — audit doubles as the activity feed Gabriel wants.

### 2.3 Storage: private buckets + signed URLs (fixes the anyone-with-link problem)

Four **private** buckets: `bills` (energy bill PDFs mirrored/ingested), `comprovantes` (payment receipts), `contracts` (lease PDFs), `meter-photos`.

- Bucket policies: no `anon`/`authenticated` storage policies at all — clients cannot touch storage directly. All access via app routes using the service-role client, *after* session verification.
- **Download**: `GET /api/files/[documentId]` → verify session → look up document row (RLS via user token) → `createSignedUrl(path, 300)` (5-min TTL) → redirect. Never store or render permanent URLs.
- **Upload**: only via the upload route (§5); path convention `{entity}/{yyyy-mm}/{uuid}_{sanitized_name}` with goBuy's `sanitizeFilename`.
- The existing Drive PDFs (scraper output) stay where they are — scraper is untouched — but the sync job **mirrors each bill PDF into the `bills` bucket** on first sight (deterministic Drive filenames make this idempotent) so the app serves everything through signed URLs. New app-managed files never touch Drive. Recommend a later, separate task: flip the Drive folder off anyone-with-link once the app is the primary viewer.

---

## 3. Secrets Management

### 3.1 `.env.example` inventory (complete v1 list)

```bash
# next-auth
AUTH_SECRET=                      # openssl rand -base64 32
AUTH_URL=https://eletron.vammo.com
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=    # used only for the client lib bootstrap; anon has zero grants
SUPABASE_SERVICE_ROLE_KEY=        # server only — cron + file routes
SUPABASE_JWT_SECRET=              # signs minted user tokens (goBuy pattern)

# Google Sheets/Drive ingestion (read-only service account)
GSHEETS_SA_KEY_B64=               # base64 service-account JSON; Viewer on sheet 1MBJwXex..., 18FxHr2F... and Drive bills folder
SCRAPER_SPREADSHEET_ID=1MBJwXex56QkSWGJ0K8Unc-XDGjjZdCDu2SO8Ec5kIs8
RENT_SPREADSHEET_ID=18FxHr2F2ewv02jXjk95_cVmcmM19n9Hb20rBD6_L9ME

# AI extraction (phase 2/3)
LLAMAPARSE_API_KEY=               # replaces the key hardcoded in boleto_aluguel.json
OPENAI_API_KEY=

# Notifications
SLACK_WEBHOOK_FINANCE=            # replaces Enel_Bot posts to C0AQFULQW9X
SLACK_WEBHOOK_CHARGING_OPS=       # shutdown alerts to C05F04UF4LV

# Jobs
CRON_SECRET=                      # Vercel Cron auth
```

Vercel env vars set per-environment (Production/Preview); `SUPABASE_SERVICE_ROLE_KEY` and `GSHEETS_SA_KEY_B64` marked Sensitive.

### 3.2 What replaces each existing secret leak

| Current leak | Replacement |
|---|---|
| LlamaParse key hardcoded in `boleto_aluguel.json` HTTP nodes | `LLAMAPARSE_API_KEY` env var when the flow is ported; meanwhile move to an n8n credential/variable (quick fix, do now) |
| Arqia portal password hardcoded in `Alerta - SIM_Data_Arqia.json` | Out of app scope (SIM workflow stays in n8n) — move to n8n variable now; note in decisions.md |
| `6_senhas` plaintext sheet (Manager condo portal login) | **Supabase Vault**: `vault.create_secret()` per portal credential, a `eletron.portal_credentials` table holding metadata (portal name, username, vault secret id, linked billing_account) with the secret itself only in `vault.secrets`. Read via an admin-only `SECURITY DEFINER` function; write via admin RPC (audited). The sheet tab is then deleted. With only 1–2 credentials, plain env vars would also work — Vault is preferred because credentials are per-billing-account data, not app config, and the set will grow |
| Bill PDFs anyone-with-link on Drive | Private `bills` bucket + signed URLs (§2.3) |

Never store: portal passwords in `eletron` tables, tokens in audit detail, service-account JSON in the repo. Add `gitleaks`/secret-scan to CI.

---

## 4. Background Jobs on Vercel

### 4.1 Job inventory (v1)

| Job | Route | Schedule (BRT) | Purpose |
|---|---|---|---|
| `sheet-sync` | `/api/cron/sheet-sync` | 04:30, 08:00, 13:00 daily | Pull scraper sheet tabs (Vammo_data, enel_data, edp_data, Faturas_ENEL/EDP, MatchingQualityCheck) + rent sheets (1_Cadastro, 2_Pagamentos) → upsert into Postgres; mirror new bill PDFs to storage |
| `alerts-eval` | `/api/cron/alerts-eval` | 09:00 daily | Recompute alert states (overdue, due-soon-no-DA, stale scraper, new installs, negotiated, shutdowns, contract irregularities) → upsert `alerts` table → Slack digests for push-worthy categories |
| `freshness-check` | `/api/cron/freshness` | hourly | Compare `job_runs` last-success + max `scraping_time` per source against thresholds; Slack on breach |
| `email-ingest` (phase 3) | `/api/cron/email-ingest` | */10 min | Poll parceiros@ mailbox, run extraction pipeline into review queue |

`vercel.json` crons; each route exports `maxDuration = 300` (requires Pro; GRU region per convention) and `runtime = "nodejs"`.

### 4.2 Authentication of cron routes

Set `CRON_SECRET` in Vercel — Vercel Cron then sends `Authorization: Bearer <CRON_SECRET>` automatically. First line of every cron route: constant-time compare against the header; 401 otherwise. These are the only session-exempt routes in middleware. Manual re-run from the UI goes through an admin server action that invokes the same handler function internally (with the admin's identity recorded in the job run).

### 4.3 Idempotency + locking (no double-processing)

- **Locking**: `job_runs`-based claim, in one RPC `eletron.claim_job(p_job_name, p_lease_seconds)`: insert a `running` row only if no other `running` row for that job has `started_at > now() - lease`; return run id or null (caller exits with status `skipped_locked`). Lease (e.g. 10 min) makes crashed runs self-heal — no stuck locks. (Advisory locks don't fit serverless: the connection may drop without releasing in-band state visibility.)
- **Idempotency**: every sync write is an **upsert on natural keys** — invoices on `(enel_id, due_date)` / `(uc, due_date)` (the scraper's own dedupe invariants), installations on `enel_id`/`uc`, stations on `swap_station_id`, rent payables on `(cadastro_id, ano, mês, tipo_cobranca)`. A crashed run re-executed produces zero duplicates. Row-level change detection via a stored `source_row_hash` — unchanged rows are skipped (cheap, and gives "rows_changed" stats).
- **Partial-crash safety**: process tab-by-tab, commit per tab; record per-tab progress in the run's `stats` jsonb. Re-run resumes safely because of upserts. Never do "delete all + reinsert".

### 4.4 Observability

- `eletron.job_runs (id, job_name, trigger ('cron'|'manual:<email>'), started_at, finished_at, status ('running'|'success'|'error'|'skipped_locked'), stats jsonb, error text)`.
- **UI**: `/admin/jobs` page (runs table, per-job last success, durations, row stats) + a **global freshness strip** on the dashboard: "ENEL scrape: 2026-07-07 02:41 · EDP scrape: 12 days ago ⚠ · Sheet sync: 26 min ago" — sourced from max `scraping_time` per provider and `job_runs`. EDP staleness is *expected* (manual runs) so its threshold is longer and labeled, not alarmed identically.
- **Slack**: webhook message on job `error`, and on freshness breach (scraper stale >36h → "PC provavelmente desligado/travado"). Include job name, error head, and a deep link to `/admin/jobs`.

---

## 5. File Handling Safety

Copy goBuy's `/api/documents` route as the template for every upload surface (comprovantes, contracts, bill PDFs, meter photos):

1. Same-origin check → session → role (`is_operator`).
2. **Limits**: PDFs 25 MB, images 10 MB; reject empty files.
3. **Type validation**: MIME allowlist (`application/pdf`, `image/jpeg`, `image/png`, `image/heic` converted server-side) **and** extension **and** magic-byte sniff (`%PDF-`, JPEG `FF D8 FF`, PNG signature). Content-type stored server-side from sniffing, never from the client.
4. **Encrypted PDFs**: detect `/Encrypt` (the n8n flow already does) → do not silently drop; create a review-queue item "password-protected document" (replaces the Slack-DM-to-Fabricio flow).
5. **Content-hash dedupe**: sha256 over bytes, **unique index on `documents.sha256`**; on collision return the existing document and link it to the new context (the bill-PDF analysis proved byte-identical duplicates under different filenames are common). Secondary dedupe for boletos on `linha_digitável`/`nosso_numero` extracted at parse time.
6. **Virus surface**: files are stored in private buckets, served only via short-TTL signed URLs with correct `Content-Type` and `Content-Disposition: attachment` (or inline for the in-app PDF viewer, which is fine — Supabase storage serves from a distinct origin, no cookie scope). No file bytes are ever interpreted server-side except by the PDF text extractor — run extraction with size/time limits. Given a trusted internal user base, no AV scanning in v1; note as a later hardening item.
7. **Meter photos (mandatory field, mobile flow)**:
   - `<input type="file" accept="image/*" capture="environment">` — works on any phone browser, no native app.
   - Server: re-encode with `sharp` (kills polyglot/exploit payloads and HEIC), produce a display-size derivative (max 2000px) + keep original.
   - **EXIF policy**: *extract, store, then strip*. Pull `DateTimeOriginal` and GPS into `meter_readings.photo_taken_at` / `photo_gps` columns **before** re-encoding strips them — these are verification features (was the photo taken today? near the station's coordinates? flag if >200 m away or >24 h old), aligned with "excess of information". The served file itself carries no EXIF.
   - The `register_meter_reading` RPC rejects submissions without a stored photo document id (photo-first upload, then reading submit referencing it), and audits reading value + photo sha256 + EXIF flags.

---

## 6. Failure Modes and Mitigations

| Failure | Detection | Mitigation |
|---|---|---|
| **Scraper stale** (host PC off/crashed; it shuts itself down nightly by design) | `freshness-check` compares max `scraping_time` (ENEL) per provider vs thresholds (ENEL >36h, EDP labeled manual with >21d soft threshold) | Dashboard freshness strip + Slack alert; app keeps serving last-known data clearly timestamped ("dados de 05/07 02:41"), never hides staleness |
| **Sheet schema drift** (header renames; month columns inserted dynamically after "Ultimo Comprovante") | Sync resolves **columns by header name only** (never position); maintains an expected-header manifest per tab (mirroring `enel_helpers.py`/`edp_helpers.py` STATIC_HEADERS — note refactor in flight, same filenames) | Unknown header → log + continue (excess-of-info: store unmapped columns in a `raw_extra jsonb`); **missing required header → abort that tab, run status `error`, Slack alert, previous data untouched**. Month-column pattern (`F_\w{3}\d{2}` / lowercase `mmmaa`) parsed dynamically |
| **Sheets API quota / flakiness** | 429/5xx from API | One `spreadsheets.values.batchGet` per spreadsheet per run (all tabs in one call, `FORMULA` render for `link_fatura`); exponential backoff w/ jitter; 3 runs/day is far under quota; per-tab commit means partial success is preserved |
| **AI extraction wrong values** | N/A — assume wrong until reviewed | **Human-in-the-loop gate is structural**: AI-extracted charges land in status `extracted` → review queue showing PDF side-by-side with fields → operator approves (→ `confirmed`) or fixes. **The `mark_paid` RPC refuses any charge not `confirmed`**; nothing AI-written can reach "paid" without a named human in `audit_events`. Match confidence + AI rationale stored in `detail` |
| **Duplicate charge rows** (same boleto emailed twice, re-scraped invoice, renamed file) | Unique natural keys on invoices; sha256 unique on documents; linha digitável match on boletos | Upserts, not inserts; near-duplicates (same account+competência+value ±R$0.01, e.g. the Kitchen Central R$1,00 trap uses explicit tolerance rules per issuer) → flagged `possible_duplicate` into the review queue, never auto-merged |
| **Partial sync crash** (Vercel timeout mid-run) | `job_runs` row stuck `running` past lease | Per-tab transactions + idempotent upserts → re-run resumes; lease-based lock self-heals; `stats` shows which tab progressed |
| **`Sem contas` carry-forward** (scraper preserves stale status/value/due_date) | due_date in the past relative to scrape month | Sync computes a derived `status_reliable` flag when status is carried forward (compare due_date month vs scrape time); UI badges it "status possivelmente desatualizado" instead of showing green |
| **UNIDENTIFIED / unmatched stations** | Literal sentinels in sheets | First-class `unmatched` state on billing accounts + a permanent review view (replaces Slack yes/no matching thread eventually); sync never drops these rows |
| **`Não cadastrado` vs `Nao Cadastrado`** and pt-BR decimals | — | Single normalization layer at sync ingest (enum mapping table + pt-BR number/date parsers, unit-tested); nothing downstream ever sees raw sheet strings |

---

## 7. v1 Phasing Recommendation

Principle: **v1 is read-mostly and cannot corrupt anything** — the sheets remain the operational source of truth for n8n until each write flow is deliberately cut over. The app's DB is a synced replica + new-data store; the only sheet the app might ever write back to is the two human-owned columns (`Financeiro Check`, `Comprovante`), and only in phase 2.

**Phase 1 — Visibility (ship first, ~read-only + one green-field write):**
- Auth (next-auth + domain gate + roles table), middleware, minted Supabase tokens.
- Schema `eletron`, RLS read policies, `audit_events`, `job_runs`.
- `sheet-sync` + `freshness-check` crons; PDF mirroring to private `bills` bucket; signed-URL viewer.
- Station dashboard, bills/charges views, alerts panel (all six SStation-Warnings categories as saved views), irregularidades panel, Slack digests (`alerts-eval`) — n8n alert workflows keep running in parallel until parity is confirmed, then those two are switched off first (they're read-only, zero risk).
- **Meter readings module** — the only write flow in phase 1. Safe because it's green-field (no sheet, no n8n conflict): photo-mandatory RPC, mobile flow, EXIF verification. It exercises the whole write stack (RPC + audit + storage + review) on a low-risk surface.

**Phase 2 — Reconciliation writes (after phase 1 hardens):**
- Comprovante upload + parser functions (port of PDF_Comprovante_Processor) + **review queue for unmatched/ambiguous**; `mark_paid` RPC with `confirmed`-only guard.
- Decision point recorded in decisions.md: either (a) app writes `Comprovante`/`Financeiro Check` back to the sheets (narrow writeback job, human-owned columns only) so n8n/VencidasEnelWarning stay coherent during transition, or (b) cut the n8n comprovante workflow over entirely. Prefer (b) if phase 1 alert parity held.

**Phase 3 — Ingestion & onboarding (highest-effort, highest-leverage):**
- `email-ingest` cron porting boleto_aluguel (LlamaParse + 2-stage LLM, keys in env), UNIDENTIFIED → review queue.
- Contract onboarding flow (Fill_Cadastro_Form port: upload → AI extract *whole* contract → editable form → `create_contract` RPC), replacing the Google Form; 3_Reajustes module.
- Portal credentials in Vault; retire `6_senhas`.

Out of scope permanently: Arqia SIM workflow (stays in n8n / data platform; fix its hardcoded password there — noted in decisions.md).

---

### Critical Files for Implementation

- C:/Users/gabri/OneDrive/Desktop/Vammo/goBuy/auth.ts — next-auth v5 + domain gate + Supabase token minting callbacks to copy
- C:/Users/gabri/OneDrive/Desktop/Vammo/goBuy/lib/supabase/token.ts — `mintSupabaseToken` (HS256 bridge from next-auth identity to Supabase RLS)
- C:/Users/gabri/OneDrive/Desktop/Vammo/goBuy/supabase/migrations/20260701000001_approve_request_partial_guard.sql — SECURITY DEFINER RPC + `request_events` audit + double-submit guard template
- C:/Users/gabri/OneDrive/Desktop/Vammo/goBuy/app/api/documents/route.ts — upload route template (origin check, MIME/size validation, sha256 dedupe, private bucket, audit event)
- C:/Users/gabri/OneDrive/Desktop/Vammo/Vammo-Enel/enel_helpers.py (and edp_helpers.py) — canonical sheet schemas the sync's header manifest must mirror