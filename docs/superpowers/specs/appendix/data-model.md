# Eletron — Data Architecture (Supabase Postgres)

## 0. Schema layout & conventions

- **Schema name: `eletron`** (mirrors goBuy's `finance` schema pattern). One extra logical area inside the same schema for ingestion plumbing (`sync_runs`, `raw_sheet_rows`, `email_ingestions`) — no second schema needed at this size.
- All tables: `id uuid PK DEFAULT gen_random_uuid()` unless a natural key is stated, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz` (trigger-maintained). Money = `numeric(12,2)`, kWh = `numeric(12,3)`, all timestamps `timestamptz` (store BRT-parsed instants as UTC).
- **RLS on every table**: `SELECT` allowed to authenticated users passing `eletron.is_vammo_user()` (JWT email ends `@vammo.com` — copy `finance.jwt_email()` / `finance.is_vammo_user()` helpers from goBuy). **Zero INSERT/UPDATE/DELETE policies** — client writes only via `SECURITY DEFINER` RPCs with `SET search_path TO 'eletron'`; batch jobs write with the service-role key. Every mutating RPC and every job writes `audit_events`.
- Sensitive: bank/Pix/CNPJ data lives here (needed for matching) — acceptable for a trusted finance team behind RLS; the `6_senhas` plaintext credentials sheet is **explicitly excluded** from the DB (portal credentials go to Supabase Vault / env vars).

## 1. Enums

```sql
CREATE TYPE eletron.station_status AS ENUM ('ACTIVE','INACTIVE','DECOMMISSIONED','PRE_INSTALLATION');
CREATE TYPE eletron.account_type AS ENUM ('rent','energy_enel','energy_edp','third_party');
CREATE TYPE eletron.contract_type AS ENUM ('por_box','fixo','por_box_minimo','gratuito','casa_vammo');
CREATE TYPE eletron.payment_method AS ENUM ('pix','boleto_celular','boleto_email','transferencia','debito_automatico','outro');
CREATE TYPE eletron.charge_status AS ENUM ('pendente','boleto_recebido','pago','atrasado','antecipado','em_compensacao','negociada','cancelada','nao_aplicavel');  -- superset of Status_Pgto + portal states
CREATE TYPE eletron.charge_kind AS ENUM ('aluguel','energia','aluguel_energia');
CREATE TYPE eletron.charge_line_kind AS ENUM ('aluguel','energia','desconto','multa_juros','outro');
CREATE TYPE eletron.utility_bill_status AS ENUM ('paga','pendente','a_vencer','vencida','sem_contas','em_compensacao','fatura_negociada','na');  -- portal-literal, mapped
CREATE TYPE eletron.auto_debit_status AS ENUM ('cadastrado','nao_cadastrado','desconhecido');
CREATE TYPE eletron.match_status AS ENUM ('auto_matched','manually_matched','unmatched','needs_review','rejected','superseded');
CREATE TYPE eletron.adjustment_index AS ENUM ('igpm','ipca','inpc','outro');
CREATE TYPE eletron.adjustment_status AS ENUM ('pendente','negociando','aplicado','recusado');
CREATE TYPE eletron.document_kind AS ENUM ('fatura_enel','fatura_edp','boleto_aluguel','boleto_condominio','nota_debito','nfse','comprovante','contrato','foto_medidor','outro');
CREATE TYPE eletron.ingest_source AS ENUM ('scraper_enel','scraper_edp','email_ai','drive_poll','manual','metabase_sync','sheet_backfill');
CREATE TYPE eletron.receipt_type AS ENUM ('pix','ted','debito_automatico','boleto_barcode','outro');
CREATE TYPE eletron.alert_status AS ENUM ('open','acknowledged','resolved','muted');
CREATE TYPE eletron.competencia_source AS ENUM ('explicit','inferred_due_date','inferred_filename','inferred_issuer_rule','manual','unknown');
```

Portal literals ("Paga", "Sem contas", "Não cadastrado"/"Nao Cadastrado") are **normalized at ingest** (rules in §5); the raw literal is always preserved in the staging row / `raw` jsonb.

## 2. Tables

### 2.1 Identity & counterparties

```sql
-- Natural PK = swap_station_id (universal key across every sheet, Metabase Q28816/28556)
CREATE TABLE eletron.stations (
  id                integer PRIMARY KEY,                 -- swap_station_id
  name              text,
  address           text,
  latitude          double precision, longitude double precision,
  status            eletron.station_status NOT NULL,
  source_created_at timestamptz,                         -- created_at from backoffice
  requires_manual_meter_reading boolean NOT NULL DEFAULT false,
  synced_at         timestamptz,                         -- last Metabase sync touch
  raw               jsonb                                 -- full source row (excess-of-info)
);

CREATE TABLE eletron.counterparties (                    -- landlords, condo admins, intermediaries, SPEs, utilities
  id           uuid PK,
  name         text NOT NULL,
  cnpj_cpf     text CHECK (cnpj_cpf ~ '^[0-9]{11}$|^[0-9]{14}$'),  -- digits only, normalized
  kind         text NOT NULL CHECK (kind IN ('locador','condominio','intermediario','spe','concessionaria','outro')),
  value_tolerance numeric(12,2) NOT NULL DEFAULT 0.01,   -- Kitchen Central: set 1.00 (known ND↔boleto R$1,00 offset)
  billing_cycle_rule text,                               -- e.g. 'kitchen_central_22_21', 'dia_calendar_month'
  notes        text,
  UNIQUE (cnpj_cpf)
);
-- CNPJ is the reliable issuer key; names are not (Rede Automan 1 vs 2). Seed: Hubees 50756844000135, DIA 03476811000151, Manager, each Kitchen SPE.
```

### 2.2 Contracts (the ~25-field Fill_Cadastro_Form / 1_Cadastro model)

```sql
CREATE TABLE eletron.contracts (
  id               uuid PK,
  cadastro_id      integer UNIQUE,                       -- legacy 1_Cadastro PK (nullable for new app-created)
  station_id       integer REFERENCES eletron.stations(id),   -- nullable: contract may precede station match
  counterparty_id  uuid NOT NULL REFERENCES eletron.counterparties(id),
  status           eletron.station_status NOT NULL DEFAULT 'ACTIVE',   -- Status_Locacao enum
  -- identity / contact
  address          text, contact_name text, phone text, email text,
  enel_connection_number text,                           -- 'Número da Conexão' → link hint to energy account
  -- pricing (README formulas: por_box = qty*valor; c/ mínimo = MAX(qty,min)*valor; fixo = flat; gratuito/casa_vammo = 0)
  contract_type    eletron.contract_type NOT NULL,
  box_count        integer, min_box integer,
  valor_por_box    numeric(12,2), valor_mensal numeric(12,2),
  -- payment instructions
  due_day          smallint CHECK (due_day BETWEEN 1 AND 31),
  payment_method   eletron.payment_method,
  banco text, agencia text, conta text, chave_pix text,
  -- lifecycle
  starts_on date, ends_on date,
  contract_document_id uuid REFERENCES eletron.documents(id),
  observations     text,
  ai_extraction    jsonb                                 -- raw Fill_Cadastro-style extraction that seeded this row
);
CREATE INDEX ON eletron.contracts(station_id);
CREATE INDEX ON eletron.contracts(counterparty_id);
CREATE UNIQUE INDEX one_active_contract_per_station ON eletron.contracts(station_id)
  WHERE status = 'ACTIVE';                               -- today 1:1; relax later if needed
```

### 2.3 Billing accounts (the hub: station 1—N accounts)

```sql
CREATE TABLE eletron.billing_accounts (
  id             uuid PK,
  station_id     integer REFERENCES eletron.stations(id),   -- NULLABLE: 'Unidentified' scraper rows live here unmatched
  account_type   eletron.account_type NOT NULL,
  -- external keys (per type)
  enel_id        text,        -- ENEL installation number ('Número da Conexão', INSTALACAO) — text: zero-padded values exist
  edp_uc         text,        -- EDP unidade consumidora (dedupe/matching key)
  edp_contract_id text,       -- edp_id (12-digit portal contract)
  contract_id    uuid REFERENCES eletron.contracts(id),  -- for account_type='rent'
  counterparty_id uuid REFERENCES eletron.counterparties(id),  -- for third_party (Hubees/DIA/Kitchen/Manager)
  external_ref   text,        -- e.g. DIA store number '267', condo unit code '0403/0 VAMMO'
  auto_debit_registration text,                          -- CTA_CONTRATO / bank-debit registration
  -- heuristic-match bookkeeping (geo/address matching is fallible everywhere)
  match_status   eletron.match_status NOT NULL DEFAULT 'unmatched',
  match_method   text,        -- 'geo<=20m','address_fuzzy','slack_confirm','manual','cnpj'
  match_distance_m numeric, match_confidence numeric,
  matched_by_email text, matched_at timestamptz,
  is_active      boolean NOT NULL DEFAULT true,
  meter_reading_required boolean NOT NULL DEFAULT false,
  notes          text,
  CHECK (account_type <> 'rent' OR contract_id IS NOT NULL),
  CHECK (account_type <> 'third_party' OR counterparty_id IS NOT NULL)
);
CREATE UNIQUE INDEX ba_enel ON eletron.billing_accounts(enel_id) WHERE account_type='energy_enel';
CREATE UNIQUE INDEX ba_edp  ON eletron.billing_accounts(edp_uc)  WHERE account_type='energy_edp';
CREATE UNIQUE INDEX ba_rent ON eletron.billing_accounts(contract_id) WHERE account_type='rent';
CREATE UNIQUE INDEX ba_3p   ON eletron.billing_accounts(counterparty_id, station_id, coalesce(external_ref,''))
  WHERE account_type='third_party';
CREATE INDEX ON eletron.billing_accounts(station_id);
```

This directly models the confirmed reality: station 553 → 3 `energy_enel` accounts; 1373/968/1043 → 2 `energy_edp` accounts; every Hubees station → its own `third_party` account under counterparty Hubees; station 450 → one `third_party` account under Manager whose charges carry rent+energy lines.

```sql
-- Matching hints used by AI/heuristic reconciliation (Hubees address lines, DIA store numbers, SPE names)
CREATE TABLE eletron.account_aliases (
  id uuid PK,
  billing_account_id uuid NOT NULL REFERENCES eletron.billing_accounts(id) ON DELETE CASCADE,
  alias_type text NOT NULL CHECK (alias_type IN ('address','store_number','spe_name','cnpj','email','other')),
  alias_value text NOT NULL,
  UNIQUE (alias_type, alias_value, billing_account_id)
);
```

### 2.4 Scraper state & history (mirrors enel_data / edp_data)

```sql
-- Current per-installation state, overwritten each sync (scraper-owned; app read-only over it)
CREATE TABLE eletron.utility_account_state (
  billing_account_id uuid PRIMARY KEY REFERENCES eletron.billing_accounts(id),
  provider_station_status text,                          -- portal contract status ('CONTRATO ATIVO', ...)
  address text, neighborhood text, city text,
  bill_status eletron.utility_bill_status,
  bill_status_raw text,                                  -- portal literal preserved
  last_billing numeric(12,2),
  due_date date,
  auto_debit eletron.auto_debit_status,
  auto_debit_registration text,
  account_email text,
  negotiated_invoices text[],                            -- 'mês/yy' list (ENEL)
  invoice_history text[],
  shutdown_date date, shutdown_start time, shutdown_end time,   -- ENEL scheduled outage
  first_seen_at timestamptz,                             -- write-once
  scraped_at timestamptz,                                -- freshness signal (scraping_time)
  lat double precision, lon double precision,
  ultima_fatura_flag text, ultimo_comprovante text,      -- n8n-maintained cells, carried for parity
  is_status_carried_forward boolean NOT NULL DEFAULT false,  -- 'Sem contas' carries stale status forward
  raw jsonb NOT NULL
);

-- Append-only history: one row per sync where the row-hash changed (replaces Backup Enel/Backup_EDP)
CREATE TABLE eletron.utility_account_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  billing_account_id uuid NOT NULL REFERENCES eletron.billing_accounts(id),
  sync_run_id uuid NOT NULL REFERENCES eletron.sync_runs(id),
  row_hash text NOT NULL, snapshot jsonb NOT NULL, scraped_at timestamptz,
  UNIQUE (billing_account_id, row_hash, scraped_at)
);

-- F_/R_ monthly matrix + EDP kWh columns, unpivoted
CREATE TABLE eletron.monthly_consumption (
  billing_account_id uuid NOT NULL REFERENCES eletron.billing_accounts(id),
  competencia date NOT NULL,                             -- first of month
  kwh_billed numeric(12,3),                              -- F_MMMYY
  kwh_recorded numeric(12,3),                            -- R_MMMYY (EDP: single consumo → kwh_billed)
  source eletron.ingest_source NOT NULL,
  PRIMARY KEY (billing_account_id, competencia)
);
```

### 2.5 Documents & files

```sql
CREATE TABLE eletron.documents (
  id uuid PK,
  kind eletron.document_kind NOT NULL,
  source eletron.ingest_source NOT NULL,
  storage_bucket text NOT NULL DEFAULT 'eletron-documents',   -- ONE private bucket, signed URLs only
  storage_path text NOT NULL UNIQUE,                     -- '{kind}/{yyyy}/{mm}/{sha256}.pdf'
  original_filename text,
  content_hash text NOT NULL,                            -- sha256 — THE dedupe key (byte-identical dupes confirmed)
  mime_type text, byte_size bigint,
  drive_file_id text,                                    -- provenance: scraper Drive file
  email_message_id text,                                 -- provenance: Gmail message
  page_count integer,
  uploaded_by_email text,
  UNIQUE (content_hash)
);
CREATE INDEX ON eletron.documents(drive_file_id);
CREATE INDEX ON eletron.documents(email_message_id);
```

Multi-station documents (Hubees ND → ~16 stations) need no special table: many `charges` reference one `document_id`. Rent+energy splits in one document are `charge_lines` under one charge.

### 2.6 Charges — the unified payables ledger

One row = one thing Vammo must pay for one billing account in one competência. Utility invoices, rent boletos, exploded ND lines, and condo boletos all land here; energy-bill detail hangs off a 1:1 child.

```sql
CREATE TABLE eletron.charges (
  id uuid PK,
  billing_account_id uuid REFERENCES eletron.billing_accounts(id),  -- NULLABLE = UNIDENTIFIED
  station_id integer REFERENCES eletron.stations(id),    -- denormalized from account; NULL when unmatched
  kind eletron.charge_kind NOT NULL,
  competencia date,                                      -- NULLABLE (often absent on raw boletos)
  competencia_source eletron.competencia_source NOT NULL DEFAULT 'unknown',
  amount numeric(12,2) NOT NULL,                         -- document total to pay
  expected_amount numeric(12,2),                         -- contract/planilha value (reconciliation)
  due_date date,
  status eletron.charge_status NOT NULL DEFAULT 'pendente',
  match_status eletron.match_status NOT NULL DEFAULT 'unmatched',  -- account/station attribution confidence
  -- payment-instruction snapshot for matching comprovantes
  payment_method eletron.payment_method,
  banco text, agencia text, conta text, chave_pix text,
  linha_digitavel text,                                  -- normalized digits-only
  nosso_numero text, nota_fiscal text, documento_numero text,
  issuer_cnpj text,                                      -- CNPJ printed on the document
  source eletron.ingest_source NOT NULL,
  source_document_id uuid REFERENCES eletron.documents(id),
  email_ingestion_id uuid REFERENCES eletron.email_ingestions(id),
  dedupe_key text NOT NULL,                              -- per-source natural key, see below
  legacy_ref jsonb,                                      -- {sheet:'2_Pagamentos', row: n} backfill provenance
  raw jsonb,                                             -- full AI/scraper payload
  notes text,
  UNIQUE (dedupe_key)
);
CREATE INDEX ON eletron.charges(station_id, competencia);
CREATE INDEX ON eletron.charges(billing_account_id, competencia);
CREATE INDEX ON eletron.charges(due_date) WHERE status IN ('pendente','boleto_recebido','atrasado');
CREATE INDEX ON eletron.charges(match_status) WHERE match_status IN ('unmatched','needs_review');
CREATE INDEX ON eletron.charges(linha_digitavel) WHERE linha_digitavel IS NOT NULL;
```

**`dedupe_key` recipes (idempotency backbone):**
- Scraper ENEL invoice: `enel:{enel_id}:{due_date}` (matches the sheet's own dedupe invariant)
- Scraper EDP invoice: `edp:{uc}:{due_date}`
- Email boleto: `boleto:{linha_digitavel}` when present, else `doc:{content_hash}:{line_index}`
- Hubees/DIA ND explosion: `nd:{content_hash}:{station_line_index}`
- Manual: `manual:{uuid}`

```sql
-- Rent/energy split inside ONE charge (Jardim Sul 'Discriminação das Verbas'; Kitchen Central rent+luz)
CREATE TABLE eletron.charge_lines (
  id uuid PK,
  charge_id uuid NOT NULL REFERENCES eletron.charges(id) ON DELETE CASCADE,
  line_kind eletron.charge_line_kind NOT NULL,
  description text,
  amount numeric(12,2) NOT NULL,                         -- negatives allowed (Hubees discounts)
  competencia date,                                      -- per-line: Kitchen Central rent=next month, energy=previous
  competencia_source eletron.competencia_source
);
CREATE INDEX ON eletron.charge_lines(charge_id);

-- 1:1 energy detail (Faturas_ENEL / Faturas_EDP columns)
CREATE TABLE eletron.charge_energy_details (
  charge_id uuid PRIMARY KEY REFERENCES eletron.charges(id) ON DELETE CASCADE,
  nf text,
  tariff_c1 text, tariff_c2 text, tariff_c3 text, tariff_c4 text, tariff_c5 text, tariff_c6 text, -- ENEL C1–C6
  classificacao text, modalidade text, tipo_fornecimento text,                                    -- EDP variant
  tusd_kwh numeric(12,3), tusd_amount numeric(12,2),
  te_kwh numeric(12,3), te_amount numeric(12,2),
  cip numeric(12,2), sub_faturamento numeric(12,2), total numeric(12,2),
  leitura_anterior date, leitura_atual date,
  auto_debit eletron.auto_debit_status, auto_debit_registration text,
  fatura_drive_url text,                                 -- parsed from =HYPERLINK link_fatura
  financeiro_check boolean NOT NULL DEFAULT false        -- the human-ticked 'paid' checkbox
);
```

### 2.7 Comprovantes (receipts) & payments

```sql
CREATE TABLE eletron.receipts (                          -- one row per receipt PAGE (multi-page comprovante PDFs)
  id uuid PK,
  document_id uuid NOT NULL REFERENCES eletron.documents(id),
  page_number integer NOT NULL DEFAULT 1,
  receipt_type eletron.receipt_type NOT NULL,
  amount numeric(12,2),
  paid_at date,
  -- parsed matching fields (PDF_Comprovante_Processor parsers become tested lib functions)
  chave_pix text, cnpj_cpf text, banco text, agencia text, conta text,
  identificacao text,                                    -- 'DA ELETROPAULO …{code}' / 'DA EDP …'
  autenticacao text, codigo_barras text, ctrl text,
  match_status eletron.match_status NOT NULL DEFAULT 'unmatched',
  matched_by_email text, matched_at timestamptz, match_notes text,
  raw_text text,                                         -- extracted page text (debuggability > storage cost)
  UNIQUE (document_id, page_number)
);
CREATE INDEX ON eletron.receipts(match_status) WHERE match_status IN ('unmatched','needs_review');

CREATE TABLE eletron.payments (                          -- payment = allocation of money to a charge
  id uuid PK,
  charge_id uuid NOT NULL REFERENCES eletron.charges(id),
  receipt_id uuid REFERENCES eletron.receipts(id),       -- NULLABLE: 'Pago' checkmarks without receipt exist
  amount numeric(12,2) NOT NULL,
  paid_at date,
  method eletron.payment_method,
  source eletron.ingest_source NOT NULL,                 -- auto-match vs manual vs sheet backfill
  created_by_email text,
  UNIQUE (charge_id, receipt_id)                         -- one receipt allocated once per charge
);
CREATE INDEX ON eletron.payments(receipt_id);
```

One Hubees transfer receipt paying 16 station charges = 1 `receipts` row → 16 `payments` rows. A charge's `status` flips to `pago` via the payment-recording RPC (never directly by clients).

### 2.8 Meter readings (new module — phone flow, mandatory photo)

```sql
CREATE TABLE eletron.meter_readings (
  id uuid PK,
  station_id integer NOT NULL REFERENCES eletron.stations(id),
  billing_account_id uuid REFERENCES eletron.billing_accounts(id),
  reading_date date NOT NULL,
  competencia date NOT NULL,                             -- month it counts toward
  reading_kwh numeric(12,3) NOT NULL,                    -- absolute meter register value
  photo_document_id uuid NOT NULL REFERENCES eletron.documents(id),  -- MANDATORY photo, enforced by NOT NULL
  read_by_email text NOT NULL,
  notes text,
  replaces_reading_id uuid REFERENCES eletron.meter_readings(id),    -- corrections append, never overwrite
  is_superseded boolean NOT NULL DEFAULT false
);
CREATE INDEX ON eletron.meter_readings(station_id, competencia);
```
Flow: RPC `request_meter_photo_upload()` returns a signed upload URL to `eletron-documents/foto_medidor/...`; after upload the client calls RPC `create_meter_reading(...)` which verifies the storage object exists, creates the `documents` row, the reading, and the audit event atomically. Consumption per month = delta between consecutive readings (computed in a view, not stored).

### 2.9 Rent adjustments (3_Reajustes)

```sql
CREATE TABLE eletron.rent_adjustments (
  id uuid PK,
  contract_id uuid NOT NULL REFERENCES eletron.contracts(id),
  negotiated_on date,
  index_type eletron.adjustment_index NOT NULL,
  index_pct numeric(8,4),
  old_amount numeric(12,2) NOT NULL,
  new_amount numeric(12,2) NOT NULL,
  effective_from date NOT NULL,
  status eletron.adjustment_status NOT NULL DEFAULT 'pendente',
  document_id uuid REFERENCES eletron.documents(id),
  notes text
);
```
RPC `apply_rent_adjustment` (status → `aplicado`) also updates `contracts.valor_mensal`/`valor_por_box` and audits both.

### 2.10 Alerts / irregularities (replaces all n8n watchdogs)

```sql
CREATE TABLE eletron.alerts (
  id uuid PK,
  alert_type text NOT NULL CHECK (alert_type IN (
    'overdue_bill','due_soon_no_auto_debit','no_auto_debit','new_installation',
    'scraper_stale','negotiated_invoice','scheduled_shutdown',
    'station_without_contract','contract_without_station',
    'unmatched_charge','unmatched_receipt','unmatched_account',
    'meter_vs_bill_discrepancy','missing_meter_reading','value_mismatch','contract_expiring')),
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  station_id integer REFERENCES eletron.stations(id),
  billing_account_id uuid REFERENCES eletron.billing_accounts(id),
  charge_id uuid REFERENCES eletron.charges(id),
  dedupe_key text NOT NULL UNIQUE,                       -- e.g. 'overdue:{account}:{due_date}'
  payload jsonb NOT NULL DEFAULT '{}',
  status eletron.alert_status NOT NULL DEFAULT 'open',
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz, resolved_by_email text,
  notified_slack_at timestamptz                          -- push dedupe
);
CREATE INDEX ON eletron.alerts(status, alert_type);
```
Alert jobs **upsert by `dedupe_key`** (bump `last_detected_at`; auto-resolve when the condition clears). The panel is permanent; Slack is a thin push for `due_soon_no_auto_debit`, `overdue_bill`, `scheduled_shutdown` (→ ChargingOps).

### 2.11 Ingestion plumbing & audit

```sql
CREATE TABLE eletron.sync_runs (
  id uuid PK,
  job text NOT NULL,             -- 'sheet_sync','metabase_stations','email_ingest','drive_pdf_fetch','alerts'
  source_ref text,               -- sheet tab / gmail label / drive folder
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','partial','failed')),
  rows_read int, rows_upserted int, rows_skipped int,
  max_scraped_at timestamptz,    -- staleness detection: max(scraping_time) seen this run
  error jsonb, stats jsonb
);

CREATE TABLE eletron.raw_sheet_rows (                    -- staging: every synced sheet row, verbatim (excess-of-info)
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sync_run_id uuid NOT NULL REFERENCES eletron.sync_runs(id),
  tab text NOT NULL, sheet_row_number int,
  row_hash text NOT NULL,        -- skip unchanged rows across runs
  data jsonb NOT NULL,           -- header-name → raw cell value
  UNIQUE (tab, row_hash)
);

CREATE TABLE eletron.email_ingestions (
  id uuid PK,
  gmail_message_id text NOT NULL UNIQUE,                 -- idempotency for the mailbox poller
  from_email text, participant_emails text[], subject text, received_at timestamptz,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','parsed','charges_created','needs_review','not_a_bill','protected_pdf','failed')),
  ai_extraction jsonb,                                   -- stage-1 + stage-2 model outputs, verbatim
  model_info jsonb,                                      -- model ids, tokens, latency
  error text
);

CREATE TABLE eletron.audit_events (                      -- goBuy finance.request_events pattern, generalized
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_table text NOT NULL,
  entity_id text NOT NULL,
  event_type text NOT NULL,      -- 'created','updated','matched','unmatched','paid','status_changed','resolved',...
  actor_email text NOT NULL,     -- user email or 'system:{job}'
  detail jsonb NOT NULL DEFAULT '{}',                    -- before/after diffs for updates
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON eletron.audit_events(entity_table, entity_id);
CREATE INDEX ON eletron.audit_events(created_at);
```

### 2.12 RPC surface (all `SECURITY DEFINER`, all audit-writing)

`create_meter_reading`, `request_meter_photo_upload`, `create_contract`, `update_contract`, `create_charge_manual`, `update_charge_status`, `record_payment` (charge + optional receipt → payments row + status flip), `match_receipt_to_charge` / `unmatch_receipt`, `resolve_unmatched_charge` (assign account/station), `assign_station_to_account` (matching review, replaces Slack yes/no loop), `create_rent_adjustment` / `apply_rent_adjustment`, `acknowledge_alert` / `resolve_alert` / `mute_alert`, `create_counterparty`, `upsert_account_alias`.

## 3. Ingestion / sync architecture

### Options evaluated

| Option | Verdict |
|---|---|
| (a) App reads Sheets live | **No.** Sheets API latency/quotas kill TanStack tables; `=HYPERLINK` needs FORMULA render; header drift and pt-BR parsing would leak into every query; no FKs, no history, no review-queue state, no audit. |
| (b) Sync worker Sheets→Supabase; app reads only Supabase | **Recommended.** Scraper untouched (hard constraint), app gets real FKs/indexes/RLS, all parsing quirks quarantined in one worker, staging tables keep raw truth, and n8n keeps working during migration because the sheet remains authoritative for the scraper's own loop. |
| (c) Replace scraper outputs entirely (scraper→Postgres) | **Not now.** Violates "scraper stays as-is"; also breaks the scraper's own read-back logic (dedupe against sheet, Drive-PDF idempotency flag) and the human Slack matching loop. Revisit after v1 as a scraper-side change. |

### What runs where

All jobs are **Vercel Cron → Next.js route handlers** (`/api/jobs/*`, GRU region, protected by `CRON_SECRET`), writing with the Supabase service-role client and recording `sync_runs` + `audit_events` (actor `system:{job}`). No Supabase Edge Functions needed — keeps everything in one repo/runtime like goBuy.

1. **`/api/jobs/sync-sheets`** — hourly 03:00–21:00 BRT (scraper finishes ~03:00; hourly is cheap because of row-hash skip).
   - Reads spreadsheet `1MBJwXex56QkSWGJ0K8Unc-XDGjjZdCDu2SO8Ec5kIs8` tabs `Vammo_data`, `enel_data`, `edp_data`, `Faturas_ENEL`, `Faturas_EDP`, `MatchingQualityCheck` and rentals sheet `18FxHr2F...` tabs `1_Cadastro`, `2_Pagamentos`, `3_Reajustes` — **always resolving columns by header name** (month columns are inserted dynamically), `valueRenderOption=FORMULA` on Faturas tabs to recover the `link_fatura` URL.
   - Pipeline per tab: raw row → `raw_sheet_rows` (skip if `row_hash` unchanged) → normalize (§5) → upsert domain rows on natural keys (`enel_id`, `uc`, `(enel_id,due_date)` dedupe keys, `cadastro_id`). New unseen `enel_id`/`uc` auto-creates a `billing_accounts` row (`match_status='unmatched'` until `swap_station_id` present).
   - Unpivots F_/R_ month columns → `monthly_consumption`; snapshots changed `utility_account_state` rows → `utility_account_snapshots`.
   - **Staleness detection:** records `max(scraping_time)` per tab in `sync_runs.max_scraped_at`; a check in the alerts job raises `scraper_stale` when ENEL > 30h or EDP > configured window (EDP is manual — per-row `scraped_at` drives per-account staleness badges).
   - Direction: **Sheets → Supabase only** for scraper-owned tabs (they're pipeline-owned, weekly clear+rewrite). Transition-only exception: an optional write-back of `Comprovante`/`Financeiro Check` cells (the two human-writable columns) so the legacy n8n/Slack ecosystem stays coherent until decommissioned.
2. **`/api/jobs/fetch-bill-pdfs`** — after sheet sync (chained or 15 min later). For each new charge with a `fatura_drive_url` / deterministic Drive name `Fatura-{Enel|EDP}-{id}-{YYYY-MM}.pdf`: download from Drive, sha256, upsert `documents` (dedupe by hash), stream to private Storage bucket `eletron-documents`, link `charges.source_document_id`. Kills the anyone-with-link exposure for app users (signed URLs only).
3. **`/api/jobs/sync-stations`** — daily. Metabase API (Q28816/Q28556) → `stations` upsert. Replaces the Apps Script + `4_Metabase_Boxes` tab. Feeds the irregularities alerts (two outer joins: station w/o contract, contract w/o station).
4. **`/api/jobs/ingest-email-bills`** — every 10 min. Gmail API on `parceiros@vammo.com` (`has:attachment filename:pdf`), idempotent on `gmail_message_id`. Keeps the n8n AI core as server code: LlamaParse (key in env) → stage-1 extraction → stage-2 reconciliation against `contracts`/`account_aliases` candidates fetched by sender email/CNPJ → creates `charges` (+`charge_lines`), archives PDF to Storage. `UNIDENTIFIED` → charge with `billing_account_id NULL`, `match_status='unmatched'` → review queue. Password-protected PDFs → `email_ingestions.status='protected_pdf'` + alert.
5. **Comprovante reconciliation** — lives in the app: `POST /api/receipts/upload` (also phone-friendly) → Storage → `documents` → page-split → the three deterministic parsers (PIX/TED, débito automático, barcode) as **tested lib functions** → matcher against open `charges` (linha digitável exact > chave_pix/CNPJ/agência+conta + amount within `counterparties.value_tolerance` + due-window rule day≥25/≤10) → auto-match creates `payments`; ambiguous/unmatched → review queue. Transition poller `/api/jobs/poll-comprovantes-drive` watches the legacy Drive folder so uploads via the old path still flow in.
6. **`/api/jobs/alerts`** — daily 09:00 BRT + after each sheet sync. Pure SQL over Supabase; upserts `alerts` by dedupe_key; Slack webhook push for the three push-worthy types.
7. **One-time backfill scripts** (run once, tagged `source='sheet_backfill'`): 2_Pagamentos history (including parsing the polluted `Valor` text into `charge_lines` + `notes`), Faturas backlog, Backup Enel time series → `utility_account_snapshots`.

## 4. n8n workflow → designated home

| n8n workflow | Tables | Job/endpoint in app |
|---|---|---|
| VencidasEnelWarning | `charges`, `utility_account_state`, `alerts` | `/api/jobs/alerts` (`overdue_bill`) + permanent Overdue view; Slack push |
| SStation Warnings | `utility_account_state`, `alerts`, `monthly_consumption` | `/api/jobs/alerts` — 6 types (`new_installation`, `scraper_stale`, `due_soon_no_auto_debit`, `no_auto_debit`, `negotiated_invoice`, `scheduled_shutdown`); ChargingOps webhook for shutdowns |
| PDF_Comprovante_Processor | `receipts`, `payments`, `documents` | `POST /api/receipts/upload` + `/api/jobs/poll-comprovantes-drive` + reconciliation lib + review queue UI |
| boleto_aluguel | `email_ingestions`, `charges`, `charge_lines`, `documents` | `/api/jobs/ingest-email-bills` + unmatched-charge review queue |
| Fill_Cadastro_Form | `contracts`, `documents`, `counterparties` | Interactive `/stations/new`: upload contract → `POST /api/contracts/extract` (AI, **whole PDF**, fixes maxPages:1) → editable form → RPC `create_contract` |
| SStation_without_contract | `stations`, `contracts`, `alerts` | `/api/jobs/sync-stations` + `/api/jobs/alerts` (`station_without_contract` / `contract_without_station`) → Irregularidades panel with inline actions |
| Alerta SIM_Data_Arqia | — (out of scope) | Stays in n8n / moves to data platform; record in decisions.md |

## 5. Data-quality normalization rules (implemented once, in the sync worker's `normalize.ts`)

1. **`swap_station_id`**: trim; `'UNIDENTIFIED'`/`'Unidentified'`/`''`/`'N/A'` → `NULL` + `match_status='unmatched'`; numeric-or-text (`3102` vs `'3102'`) → `parseInt` after stripping `.0`; reject non-integer with a `sync_runs.error` entry, never silently drop.
2. **`auto_debit`**: lowercase + strip accents → `{cadastrado, nao cadastrado} → enum`; anything else → `desconhecido` + raw preserved. (Kills the `'Não cadastrado'` vs `'Nao Cadastrado'` ENEL/EDP bug class.)
3. **pt-BR money** (`'R$ 6.502,34'`, `'R$1500'`): strip `R$`/spaces/NBSP, remove `.` thousands, `,`→`.`; store `numeric`. `Valor` cells with reconciliation text (`'Documento: X / Planilha: Y / Energia: Z'`) → parse into `amount`=Documento, `expected_amount`=Planilha, energy `charge_line`=Energia; unparseable → keep raw in `notes` + `needs_review`.
4. **Decimals in coordinates**: `enel_data`/`edp_data` lat/lon use comma decimals, `Vammo_data` uses dots — detect separator per value.
5. **Dates**: `due_date` ISO in state tabs; `Leitura` `DD/MM/YYYY`; `Mês` (pt-BR name) + `Ano` → `competencia = date(ano, mês, 1)`; comprovante dates `DD/MM/YY` vs `YYYY-MM-DD` handled by explicit format list, never `Date.parse`.
6. **Competência inference (per issuer, recorded in `competencia_source`)**:
   - Concessionária (ENEL/EDP): explicit `mês/ano referência` field → `explicit`.
   - Direct-landlord boleto: document-number hints (`'JUNHO26'`) first; else due-date rule *day ≤ 10 → previous month, else document month* → `inferred_issuer_rule`.
   - Kitchen Central: 22-to-21 cycle — rent line = month after emission, energy line = previous cycle; **per-line competência**, boleto value tolerance R$1,00 (counterparty-level).
   - Hubees/DIA ND: explicit period field (`'Maio/26'`, `'01.05.2026-31.05.2026'`).
   - No signal → `unknown` + review queue (never guess silently).
7. **Dedupe**: documents by `content_hash` (byte-identical dupes under different filenames are confirmed); boletos by normalized `linha_digitavel` (digits only — it encodes bank, due date and amount); scraper invoices by `(enel_id|uc, due_date)`; receipts by `(content_hash, page)`. Filenames are **never** identity.
8. **CNPJ/CPF**: digits only, CHECK-constrained; CNPJ is the issuer key, razão social never is (Rede Automan 1 vs 2, standardized SPE names).
9. **Portal bill status**: literal → `utility_bill_status` enum via a fixed map; unknown literal → sync error alert (surface new portal states instead of mis-mapping). `'Sem contas'` sets `is_status_carried_forward=true` — the UI must show staleness, not "paid".
10. **`enel_id`/`uc` as `text`**: zero-padded values exist in Forms (`'0027322174'`); normalize by stripping leading zeros for matching but store the canonical scraper form; comparison helper does both.
11. **Multi-installation strings**: `Vammo_data.installation_id`/`provider`/`has_auto_debit` are `', '`-joined parallel lists — split and zip positionally into separate `billing_accounts`.

### Critical Files for Implementation
- C:/Users/gabri/OneDrive/Desktop/Vammo/Vammo-Enel/enel_helpers.py (canonical enel_data/Faturas_ENEL column schemas the sync worker must mirror)
- C:/Users/gabri/OneDrive/Desktop/Vammo/Vammo-Enel/edp_helpers.py (canonical edp_data/Faturas_EDP schemas)
- C:/Users/gabri/OneDrive/Desktop/Vammo/Vammo-Enel/gsheets.py (spreadsheet ID, Drive folder IDs, sheet-write conventions the sync must respect)
- C:/Users/gabri/OneDrive/Desktop/Vammo/goBuy/supabase/migrations/20260701000001_approve_request_partial_guard.sql (the security-definer RPC + events-table pattern to copy: `jwt_email()`, `is_vammo_user()`, FOR UPDATE guards, event inserts)
- C:/Users/gabri/OneDrive/Desktop/Vammo/eletron/context/boleto_aluguel.json (AI extraction/reconciliation prompts and field contract to port into the email-ingest worker)