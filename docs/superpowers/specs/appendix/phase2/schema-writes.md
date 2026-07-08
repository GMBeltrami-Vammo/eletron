Design complete. Below is the deliverable.

---

# Phase 2 Design — `charging` schema & write path (shared Supabase project `jfdqlnpidynxwqqiblcd`)

## 1. Schema adaptation (deltas vs `docs/superpowers/specs/appendix/data-model.md`)

Global: every `eletron.` → `charging.` (schema, enums, helpers, RPCs). Full DDL stays in the appendix; only deltas listed here.

### 1.1 Ships NOW (21 tables)

`stations`, `counterparties`, `account_aliases`, `contracts`, `rent_adjustments` (table only — sheet-sync fills it from 3_Reajustes; its RPCs are Phase 3), `billing_accounts`, `utility_account_state`, `utility_account_snapshots`, `monthly_consumption`, `documents`, `charges`, `charge_lines`, `charge_energy_details`, `receipts`, `payments`, `meter_readings`, `alerts`, `job_runs`, `raw_sheet_rows`, `audit_events`, `user_roles` (new, from security-ops §1.3).

**Deferred (DDL not shipped, kept in appendix):** `email_ingestions` (Phase 3), `portal_credentials`/Vault (Phase 3). `sync_runs` is **dropped — merged into `job_runs`** (see 1.2).

### 1.2 Column deltas per table

- **`documents`** — remove `storage_bucket`, `storage_path`. Add:
  - `drive_file_id text NOT NULL UNIQUE`
  - `drive_folder_kind charging.drive_folder_kind NOT NULL` — new enum `('meter_photos','comprovantes','bills','other')`
  - `web_view_link text`
  - Keep `content_hash text NOT NULL UNIQUE` (sha256 computed server-side before Drive upload / after Drive download in the poller). Keep `email_message_id` as plain nullable text (provenance, no FK until Phase 3).
- **`charges`** — remove `email_ingestion_id` (FK target deferred). Add:
  - `status_source text NOT NULL DEFAULT 'sync' CHECK (status_source IN ('sync','rpc'))` — sync jobs may only overwrite `status` where `status_source='sync'`; every human/RPC status write sets `'rpc'` (makes `pago`/`negociada`/`cancelada` sticky against re-sync).
  - `flags jsonb NOT NULL DEFAULT '[]'` — gerar_mes flags (`boxes_mismatch`, `no_metabase_data`, `pro_rata`, `new_station`) replacing the sheet's cell colors.
  - `ingest_source` enum gains values `'gerar_mes'`, `'auto_match'` (drop `'email_ai'` from shipped enum? keep it — cheap, avoids Phase 3 enum migration).
  - New dedupe recipe: rent generated rows `rent:{cadastro_id}:{YYYY-MM}` (= the A5 `(cadastro, competencia)` dedupe).
- **`charge_energy_details`** — **semantics fix**: replace `financeiro_check boolean` with:
  - `fiscal_exported boolean NOT NULL DEFAULT false` (sheet `Financeiro Check` maps here 1:1)
  - `fiscal_exported_at timestamptz` (NULL from sheet sync — the sheet has no timestamp; populated by the Phase 3 in-app fiscal export)
- **`stations`** — add `active_boxes integer`, `boxes_synced_at timestamptz` (from `4_Metabase_Boxes` via sheet-sync; A4 stays sheet-side, we read its output). Needed by `gerar_mes`.
- **`meter_readings`** — add `photo_taken_at timestamptz`, `photo_lat double precision`, `photo_lon double precision`, `exif_flags jsonb` (EXIF extracted server-side before Drive upload; sharp re-encode still applies). Partial unique index `ON meter_readings(photo_document_id)` (one reading per photo).
- **`alerts`** — add `acknowledged_by_email text`, `acknowledged_at timestamptz`, `muted_by_email text`, `muted_at timestamptz` (lifecycle was under-modeled).
- **`utility_account_snapshots`** — `sync_run_id` → `job_run_id uuid REFERENCES charging.job_runs(id)`.
- **`raw_sheet_rows`** — same rename `sync_run_id` → `job_run_id`.
- **`job_runs`** (union of appendix `sync_runs` + security-ops `job_runs`):
  `id uuid PK, job_name text NOT NULL, trigger text NOT NULL ('cron'|'manual:{email}'), source_ref text, started_at, finished_at, status text CHECK IN ('running','success','partial','error','skipped_locked'), rows_read int, rows_upserted int, rows_skipped int, max_scraped_at timestamptz, stats jsonb, error text`.
- **`audit_events`** — naming reconciled: **`entity_table`** wins (data-model.md); security-ops' `entity_type` is superseded. Shape unchanged otherwise; append-only (no UPDATE/DELETE for anyone; RPCs insert in-transaction; jobs use `actor_email='system:{job}'` + `job_run_id` in `detail`).
- **`user_roles`** — `email text PK, role text CHECK (role IN ('admin','operator')), created_at, created_by_email`.
- **`meter_readings.photo_document_id`** stays `NOT NULL` (mandatory photo).

### 1.3 `charge.status` re-derivation (the semantics fix, code side)

`lib/ingest/normalize.ts:1260` stops deriving `pago` from `Financeiro Check`. New rule (implemented once in normalize.ts so BOTH backends agree):

1. `financeiroCheck` maps to `details.fiscalExported` only (rename field in `ChargeEnergyDetails`; UI relabel below).
2. `status` for scraped invoice rows:
   - If the account's `utility_account_state.due_date == charge.due_date` (it is the current bill) → map `billStatus`: `paga→pago`, `pendente→pendente`, `a_vencer→pendente`, `vencida→atrasado`, `em_compensacao→em_compensacao`, `fatura_negociada→negociada`, `na→nao_aplicavel`, `sem_contas→` due-date rule + `is_status_carried_forward` badge.
   - Else (historical rows, no portal signal): `due_date >= today → pendente`, `< today → atrasado` — honest "unconfirmed" state; human confirmation or a matched comprovante moves it to `pago` via RPC.
3. Supabase sync additionally respects `status_source='rpc'` (never downgrades human-set status).

UI relabel: add `lib/labels.ts` canonical entry `fiscalExported: "Enviado ao fiscal"` (+ tooltip "Exportado à planilha fiscal — não significa pago"); consume it in `components/energia/faturas-table.tsx` (:213 header, :218 tooltip, :357 batch button) and `components/estacao/energy-tab.tsx` (:514, :519, :523 aria-label).

## 2. Isolation & access on the shared project

1. **Expose the schema**: Dashboard → Settings → API → "Exposed schemas": append `charging` to the existing list (`public, finance, ...`). This alone grants nothing — PostgREST still enforces PG grants + RLS.
2. **Privilege posture** (in migration 1):
   ```sql
   CREATE SCHEMA charging;
   REVOKE ALL ON SCHEMA charging FROM PUBLIC, anon;
   GRANT USAGE ON SCHEMA charging TO authenticated, service_role;
   ALTER DEFAULT PRIVILEGES IN SCHEMA charging REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
   -- per table: GRANT SELECT TO authenticated (RLS-gated); full to service_role.
   -- ZERO INSERT/UPDATE/DELETE grants to authenticated/anon. No grants touching finance/CX schemas; no grants FROM them.
   ```
   Every table: `ENABLE ROW LEVEL SECURITY` + one policy `FOR SELECT TO authenticated USING (charging.is_vammo_user())`. `audit_events`/`user_roles` readable too (excess-of-information; roles page needs it). No storage buckets (Drive is the store) — nothing added to `storage.*`.
3. **Helpers** (namespaced copies of goBuy `finance.*`):
   - `charging.jwt_email()` → `lower(auth.jwt()->>'email')`
   - `charging.is_vammo_user()` → email LIKE `'%@vammo.com'`
   - `charging.is_operator()` → `is_admin() OR EXISTS user_roles(email=jwt_email(), role='operator')`
   - `charging.is_admin()` → `EXISTS user_roles(email=jwt_email(), role='admin')`
   All `STABLE`, `SECURITY DEFINER`, `SET search_path TO 'charging'`.
4. **Seed** (migration 4): `user_roles`: `gabriel.beltrami@vammo.com → admin` (+ operators Gabriel names at setup). `counterparties` seeds come from backfill, not migration.
5. **Cross-schema check at setup**: verify goBuy still works after exposing `charging` (schema list is a single config value — typo risk; test `finance` RPC after saving). Verify `auth.jwt()->>'email'` resolves under the legacy HS256 secret (goBuy already proves it on this project).

## 3. Token bridge (minted JWT)

- **`lib/supabase/token.ts`** — port of goBuy's `mintSupabaseToken(email, ttl='8h')`: `jose` `SignJWT`, HS256 with `SUPABASE_JWT_SECRET`, claims `{ sub: emailToSub(email), email, role: 'authenticated', aud: 'authenticated' }`. **Edge-safe requirement**: `emailToSub` must use `crypto.subtle.digest('SHA-256', …)` (Web Crypto), not `node:crypto` — this module is imported (transitively) by `middleware.ts` via `auth.config.ts`.
- **`auth.config.ts` wiring** (both instances inherit; jwt cb runs on sign-in and on session refresh, session cb on every `auth()`):
  ```ts
  callbacks: {
    signIn(...), authorized(...),           // unchanged
    async jwt({ token }) {
      const exp = (token.supabaseExp as number | undefined) ?? 0;
      if (token.email && exp < Date.now() / 1000 + 3600) {   // refresh when <1h left of 8h TTL
        token.supabaseAccessToken = await mintSupabaseToken(token.email);
        token.supabaseExp = Math.floor(Date.now() / 1000) + 8 * 3600;
      }
      return token;
    },
    async session({ session, token }) {
      (session as any).supabaseAccessToken = token.supabaseAccessToken;
      return session;
    },
  }
  ```
  Module-scope type augmentation in `types/next-auth.d.ts`. `SUPABASE_JWT_SECRET` must exist in the Edge runtime env (Vercel provides all envs to middleware — no code change needed).
- **`lib/supabase/client.ts`** — `supabaseForUser(accessToken)`: `createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, { db: { schema: 'charging' }, global: { headers: { Authorization: 'Bearer ' + accessToken } }, auth: { persistSession: false, autoRefreshToken: false } })`.
- **`lib/supabase/admin.ts`** — `import 'server-only'`; `supabaseAdmin()` with `SUPABASE_SERVICE_ROLE_KEY`, `db.schema='charging'`. (Note: goBuy names this env `SUPABASE_SECRET_KEY`; eletron is a separate Vercel project — use the security-ops name `SUPABASE_SERVICE_ROLE_KEY`, record the divergence in decisions.md.)

## 4. RPC surface (Phase 2 ships exactly these; all `SECURITY DEFINER SET search_path TO 'charging'`, all insert exactly one `audit_events` row in-transaction, all follow the goBuy `approve_purchase_request` guard template: role check → `SELECT … FOR UPDATE` → state-machine guard → `GET DIAGNOSTICS` double-submit guard → audit)

| RPC | Signature (→ returns) | Guards | Audit |
|---|---|---|---|
| `create_meter_reading` | `(p_station_id int, p_billing_account_id uuid, p_reading_date date, p_reading_kwh numeric, p_photo_document_id uuid, p_notes text, p_replaces_reading_id uuid) → uuid` | `is_operator()`; station exists; document exists, `kind='foto_medidor'`, not yet referenced (partial unique idx); `reading_kwh >= 0`; if replacing: `FOR UPDATE` old row, must not already be superseded → set `is_superseded=true`. `read_by_email := jwt_email()` (responsible = logged-in user, never a parameter). `competencia := date_trunc('month', p_reading_date)` | `('meter_readings', id, 'reading_registered')` w/ kwh, photo sha256, EXIF flags |
| `create_manual_bill` | `(p_billing_account_id uuid, p_competencia date, p_due_date date, p_amount numeric, p_document_id uuid, p_nf text, p_energy_details jsonb, p_notes text) → uuid` | `is_operator()`; account `FOR UPDATE`, `account_type IN ('energy_enel','energy_edp')`; `p_amount > 0`; guard vs scraper dupes: `RAISE` if a charge exists with `dedupe_key = 'enel:{enel_id}:{due}' / 'edp:{uc}:{due}'` or another manual charge for same `(account, due_date, amount)`. Creates `charges` (kind `energia`, source `manual`, `dedupe_key='manual:'||gen_random_uuid()`, `competencia_source='manual'`, `status_source='rpc'`, status `pendente`) + `charge_energy_details` (fields from jsonb) + links `source_document_id` | `('charges', id, 'created')` |
| `record_payment` | `(p_charge_id uuid, p_receipt_id uuid, p_amount numeric, p_paid_at date, p_method charging.payment_method) → uuid` | `is_operator()`; charge `FOR UPDATE`, status NOT IN (`cancelada`,`nao_aplicavel`); receipt (if given) `FOR UPDATE`, unique `(charge_id, receipt_id)` gives double-submit guard; inserts `payments` (`source='manual'`, `created_by_email=jwt_email()`); if `sum(payments) >= amount − counterparty tolerance` → `status='pago', status_source='rpc'`; sets receipt `match_status='manually_matched', matched_by_email, matched_at` | `('charges', id, 'payment_recorded')` (+ `'paid'` when flipped) |
| `unmatch_payment` | `(p_payment_id uuid, p_reason text) → void` | `is_operator()`; payment + charge `FOR UPDATE`; DELETE payment (full row copied into audit detail — audit is the tombstone); if receipt has no remaining payments → `match_status='unmatched'`; recompute charge: if was `pago` and now under-covered → `pendente`/`atrasado` by due date, `status_source='rpc'` | `('payments', id, 'unmatched')` w/ deleted row + reason |
| `confirm_charge` | `(p_charge_id uuid) → void` — **the human gate over auto-matches** | `is_operator()`; `FOR UPDATE`; must have ≥1 payment and `sum(payments) >= amount − tolerance`; must not already be `pago` (double-submit); → `status='pago', status_source='rpc'` | `('charges', id, 'confirmed_paid')` w/ payment ids + `actor_email` (named human — satisfies the "no auto-pago" constraint) |
| `update_charge_status` | `(p_charge_id uuid, p_new_status charging.charge_status, p_reason text) → void` | `is_operator()` (`cancelada` requires `is_admin()`); `FOR UPDATE`; transition allow-list; **direct `→pago` forbidden** (`RAISE 'use confirm_charge/record_payment'`); `status_source='rpc'` | `('charges', id, 'status_changed')` before/after + reason |
| `gerar_mes` | `(p_competencia date) → jsonb {created, skipped_existing, flagged}` — port of A5 | `is_operator()`. Loop ACTIVE contracts with `payment_method IN ('pix','transferencia')` (skip DESATIVADA). Pricing: `fixo`→`valor_mensal`; `por_box`→ `boxes = stations.active_boxes`; `boxes IS NULL` → `valor_mensal` + flag `no_metabase_data`; `boxes == box_count` → `valor_mensal` else `boxes × valor_por_box` + flag `boxes_mismatch`; `por_box_minimo`→ `GREATEST(min_box, boxes) × valor_por_box` (+ mismatch flag). Pro-rata: station created in `p_competencia` month AND `day ≥ 5` → `valor × (30 − day + 1) / 30`, flags `new_station`,`pro_rata`. Dedupe: `ON CONFLICT (dedupe_key) DO NOTHING` with `dedupe_key='rent:{cadastro_id}:{YYYY-MM}'`. Creates charges kind `aluguel`, `source='gerar_mes'`, `expected_amount=amount`, `due_date` from `contracts.due_day`, `status='pendente'`, `flags` jsonb | one `('charges', id, 'created')` per row + one `('job','gerar_mes:{YYYY-MM}','generated')` summary |
| `acknowledge_alert` / `resolve_alert` / `mute_alert` | `(p_alert_id uuid, p_note text) → void` | `is_operator()`; `FOR UPDATE`; state machine: ack from `open`; resolve from `open|acknowledged`; mute from `open|acknowledged`; stamps `*_by_email/_at` | `('alerts', id, 'acknowledged'|'resolved'|'muted')` |
| `set_user_role` | `(p_email text, p_role text) → void` (`NULL` role = remove) | `is_admin()`; email must be `@vammo.com`; cannot remove the last admin (count guard) | `('user_roles', email, 'role_changed')` before/after |
| `assign_station_to_account` | `(p_billing_account_id uuid, p_station_id int, p_method text, p_note text) → void` | `is_admin()` (remapping = admin blast radius); account `FOR UPDATE`; station exists; sets `station_id`, `match_status='manually_matched'`, `matched_by_email/at`; cascades `station_id` to the account's charges where `station_id IS NULL` | `('billing_accounts', id, 'remapped')` before/after |
| `resolve_unmatched_charge` | `(p_charge_id uuid, p_billing_account_id uuid) → void` | `is_operator()`; charge `FOR UPDATE`, `billing_account_id IS NULL` (double-submit guard); sets account + denormalized `station_id`, `match_status='manually_matched'` | `('charges', id, 'matched')` |
| `claim_job` | `(p_job_name text, p_lease_seconds int) → uuid` (NULL = locked) | **service_role only**: `RAISE` unless `(auth.jwt()->>'role') = 'service_role'` or `current_user = 'service_role'`; insert `running` job_runs row only if no other `running` row newer than lease | none (job_runs row is the record) |

Deferred RPCs (Phase 3, spec preserved in appendix): `create_contract`, `update_contract`, `create_charge_manual` (generic), `create_rent_adjustment`, `apply_rent_adjustment`, `create_counterparty`, `upsert_account_alias`, `request_meter_photo_upload` (obsolete — Drive upload goes through the server route, no signed-URL RPC needed).

**Service-role-only writes (no RPC, jobs via `supabaseAdmin()`):** all sheet-sync upserts (§5), `alerts` upsert, `documents` inserts (all upload paths + poller), `receipts` + auto-matched `payments` (`source='auto_match'`, `created_by_email='system:comprovantes-poll'` — never flips charge status), `job_runs` finalization, backfill.

## 5. Jobs

Common: route handlers under `/api/cron/*`, `runtime='nodejs'`, first line constant-time `Authorization: Bearer CRON_SECRET` check; only session-exempt routes in middleware; body: `claim_job` (10-min lease) → work → finalize `job_runs` with stats. Manual re-run = admin server action invoking the same handler fn (`trigger='manual:{email}'`).

**Vercel Hobby reality check (flag):** Hobby allows only **2 cron jobs, each once per day** — the desired schedules (3× daily sync, 15-min poller) are impossible on Vercel Cron without Pro. **Design decision: schedule via n8n** (already running in parallel, already in-stack): three n8n Schedule→HTTP Request workflows hitting the endpoints with the `CRON_SECRET` header. `vercel.json` keeps one daily cron (`alerts-eval` 09:00 BRT) as fallback. Duration: classic Hobby functions cap at 60s; with **Fluid Compute enabled (free toggle)** `maxDuration=300` is available on Hobby. Design every job to fit **60s** anyway (batched upserts of 500 rows, per-tab commit, resume-safe); set `maxDuration=300` opportunistically. If sync ever exceeds 60s without Fluid, split per-spreadsheet (`?scope=scraper|rent`) — no Pro required.

1. **`/api/cron/sheet-sync`** — 04:30, 08:00, 13:00 BRT (n8n). Reuses the Phase 1 loader + `normalize.ts` **verbatim** (post-semantics-fix) → `DomainSnapshot` → upsert mapping:
   - `stations` → upsert by `id` (+ `active_boxes` read from `4_Metabase_Boxes` tab — new tab in the loader manifest)
   - `counterparties` → by `cnpj_cpf`; `contracts` → by `cadastro_id`; `rentAdjustments` → by `(contract_id, effective_from)`
   - `billingAccounts` → by natural key per type (`enel_id`/`edp_uc`/`contract_id`/3p tuple); snapshot ids `'enel:123'` resolved to uuids via lookup map; **never overwrite `station_id`/`match_status` on rows previously set by `assign_station_to_account`** (guard: skip fields when `matched_by_email IS NOT NULL`)
   - `utilityAccountStates` → upsert PK; row-hash change → append `utility_account_snapshots`
   - `monthlyConsumption` → upsert `(billing_account_id, competencia)`
   - `charges` → upsert by `dedupe_key`; `UPDATE … WHERE status_source='sync'` for status; status per §1.3; `financeiroCheck` → `charge_energy_details.fiscal_exported`
   - `chargeEnergyDetails` → upsert by `charge_id`; `issues` → `job_runs.stats.issues` (keeps `IngestHealthCard` working post-swap)
   - Raw rows → `raw_sheet_rows` (skip unchanged `row_hash`)
2. **`/api/cron/alerts-eval`** — 09:00 BRT + chained after each sheet-sync. Pure SQL over `charging`; computes all alert types; **upsert by `dedupe_key`**: on re-detection bump `last_detected_at`/`payload` and **preserve `acknowledged`/`muted` status** (only `resolved`→`open` reopens); auto-resolve `open`/`acknowledged` alerts whose condition cleared (`resolved_by_email='system:alerts-eval'`). **No Slack push in Phase 2** — the n8n watchdogs still run in parallel; double-pinging is worse than none (decisions.md entry).
3. **`/api/cron/comprovantes-drive-poll`** — every 15 min (n8n). Cursor = max `modifiedTime` processed, stored in latest `job_runs.stats`. For each new file in folder `13nbLPM…`: download via SA → sha256 → skip if `documents.content_hash` exists → insert `documents` (kind `comprovante`, source `drive_poll`) → page split → the three parsers as tested lib functions (`lib/comprovantes/parse.ts`, exact n8n regexes: PIX/TED field extraction; débito-automático header `'comprovante de pagamento de débito automático'` / footer `'Em caso de dúvidas'` segmentation with `page_number = page + seg*0.5`; DA routing on `identificacao` containing `DA ELETROPAULO`/`DA EDP`, plus A7 `normalizePixKey` port) → `receipts` rows → matcher (`lib/comprovantes/match.ts`: linha digitável exact > chave_pix/CNPJ/agência+conta > DA code vs `auto_debit_registration`; amount within `counterparties.value_tolerance` default R$0.01; due-window day≥25/≤10; competência day≤10→previous month) → unambiguous single match: insert `payments` (`source='auto_match'`), `receipts.match_status='auto_matched'`, **charge status untouched** → surfaces in `/revisao/comprovantes` awaiting `confirm_charge`; ambiguous/none → `needs_review`/`unmatched`. The in-app upload page writes to the SAME folder via the SA and lets the poller process it — one processing path; n8n keeps writing the sheets in parallel, harmlessly.

## 6. Repository swap & write path

- **`lib/data/supabase-repository.ts`** — `SupabaseRepository implements Repository` (all 8 read methods) over `supabaseForUser(session.supabaseAccessToken)` (RLS-gated reads; reads move to `charging` entirely once sync runs). `getFreshness()` from `job_runs` + max `utility_account_state.scraped_at`. `getIrregularities().issues` from latest sheet-sync `job_runs.stats.issues`.
- **`lib/data/repository.server.ts`** — `getRepository()` branches on `REPOSITORY_BACKEND` env (`'sheets'` default | `'supabase'`); flag flip = instant rollback, zero deploy (Vercel env change + redeploy is minutes; acceptable).
- **Write side** — new server actions (`app/actions/*.ts`): `await auth()` → guard email → `supabaseForUser(token).rpc('create_meter_reading', …)` etc.; Drive-upload routes (`/api/upload/meter-photo`, `/api/upload/comprovante`, `/api/upload/manual-bill`) follow security-ops §5 (origin → session → operator → size/MIME/magic-byte → sha256 dedupe → sharp+EXIF for photos) then: Drive upload via SA → `documents` insert via admin client → return `document_id` for the follow-up RPC. Manual-bill route additionally: deterministic name `Fatura-{Enel|EDP}-{id}-{YYYY-MM}.pdf` (month from due_date), skip upload if name exists in folder `1AB8ok…` (scraper idempotency convention), then **after** RPC success `values.append` one row to `Faturas_ENEL`/`Faturas_EDP` (bottom; header-name column mapping; `link_fatura` as `=HYPERLINK`); append failure → alert `manual_bill_sheet_append_failed`, never roll back the DB.
- **Cutover order**: (1) deploy migrations → (2) run backfill → (3) enable n8n schedules (sync + poll + alerts) → (4) parity check (§7 counts + spot-check UI against sheets backend) → (5) flip `REPOSITORY_BACKEND=supabase` → (6) rollback = flip back to `sheets` (sheets pipeline untouched throughout).

## 7. Backfill

`scripts/backfill.ts` (local, service role) = **invoke the sheet-sync core once** (same loader → normalize → upsert module; backfill is just the first idempotent full sync) with `trigger='manual:{email}'`, then print verification: per-table counts vs `DomainSnapshot` array lengths; **station 553 → 3 `energy_enel` accounts; 1373/968/1043 → 2 `energy_edp` each**; sum(`charges.amount`) per competência vs sheet; count of `fiscal_exported=true` == sheet `Financeiro Check` TRUE count; zero `charges` with `status='pago'` and no payment (expected post-fix — `pago` only comes from `billStatus='paga'` mapping). No separate seed scripts needed (counterparties/contracts come through the same pipeline).

## 8. Migration files (`supabase/migrations/`)

1. `20260708000001_charging_schema.sql` — schema, REVOKE/GRANT baseline, all enums (incl. `drive_folder_kind`, extended `ingest_source`), helpers (`jwt_email`, `is_vammo_user`, `is_operator`, `is_admin`), `updated_at` trigger fn.
2. `20260708000002_charging_tables.sql` — 21 tables + indexes + RLS enable + SELECT policies + per-table grants.
3. `20260708000003_charging_rpcs.sql` — `claim_job` + the 11 RPCs.
4. `20260708000004_charging_seed.sql` — `user_roles` seed (`gabriel.beltrami@vammo.com` admin + named operators).

## 9. Env vars to add (Vercel, eletron project)

```
NEXT_PUBLIC_SUPABASE_URL=https://jfdqlnpidynxwqqiblcd.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=            # zero grants; client bootstrap only
SUPABASE_SERVICE_ROLE_KEY=                # Sensitive; server-only (note: goBuy calls it SUPABASE_SECRET_KEY)
SUPABASE_JWT_SECRET=                      # legacy HS256 secret of the shared project (same one goBuy uses)
CRON_SECRET=                              # openssl rand -base64 32; also configured in the n8n scheduler workflows
REPOSITORY_BACKEND=sheets                 # flip to 'supabase' at cutover
DRIVE_METER_PHOTOS_FOLDER_ID=1t7WoWRYxjBYrb8E6onBtfe773r0yNwRC
DRIVE_COMPROVANTES_FOLDER_ID=13nbLPM1akfR48YqYAtMKFcOEioD8jPsY
DRIVE_BILLS_FOLDER_ID=1AB8ok7Dl5euKe-_qt3axEeXPi1f4KbaS
```
(Phase 1 already has `AUTH_*`, `GOOGLE_CLIENT_*`, `GSHEETS_SA_KEY_B64`, `SCRAPER_SPREADSHEET_ID`, `RENT_SPREADSHEET_ID`.)

## 10. Setup steps for Gabriel (manual, before/at deploy)

1. **Supabase dashboard**: add `charging` to Exposed Schemas (Settings → API); retrieve the legacy HS256 JWT secret + service-role key; after saving, smoke-test a goBuy `finance` read+RPC (shared config value).
2. **Drive**: grant the read service account **Content Manager** on the three folders (meter photos, comprovantes, bills — scraper uploads used user OAuth; the SA has no write today). Folders are on a shared drive (`supportsAllDrives=True` in scraper code) — grant at shared-drive or folder level.
3. **Sheets**: grant the same SA **Editor** on the scraper spreadsheet `1MBJwXex…` (for the manual-bill `values.append` to Faturas_ENEL/EDP).
4. **Vercel**: set env vars above; enable **Fluid Compute** (free, unlocks 300s maxDuration on Hobby); keep the single daily `alerts-eval` cron in `vercel.json`.
5. **n8n**: create three scheduler workflows (sheet-sync 04:30/08:00/13:00 BRT; comprovantes-poll */15; alerts-eval post-sync) calling the endpoints with the `CRON_SECRET` bearer header.
6. Apply migrations (`supabase db push` or MCP `apply_migration`), run `scripts/backfill.ts`, review verification output, then flip `REPOSITORY_BACKEND`.

### Critical Files for Implementation
- C:/Users/gabri/OneDrive/Desktop/Vammo/eletron/lib/ingest/normalize.ts (status re-derivation at :1260 + `financeiroCheck→fiscalExported`; the sync core reuses it verbatim)
- C:/Users/gabri/OneDrive/Desktop/Vammo/eletron/auth.config.ts (jwt/session callbacks for the minted-token bridge; edge-imported by middleware)
- C:/Users/gabri/OneDrive/Desktop/Vammo/eletron/lib/data/repository.ts + repository.server.ts (Repository interface to implement; `REPOSITORY_BACKEND` branch point)
- C:/Users/gabri/OneDrive/Desktop/Vammo/goBuy/lib/supabase/token.ts + goBuy/supabase/migrations/20260701000001_approve_request_partial_guard.sql (mint + RPC guard templates to port, namespaced to `charging`)
- C:/Users/gabri/OneDrive/Desktop/Vammo/eletron/docs/superpowers/specs/appendix/data-model.md (full DDL baseline; this design lists only deltas)