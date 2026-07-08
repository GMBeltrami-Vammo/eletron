-- Eletron Phase 2 — migration 2: charging schema tables.
-- 22 domain tables (everything except user_roles, which ships in migration 1).
-- Builds on migration 1's enums, auth helpers (charging.is_vammo_user() etc.),
-- and the charging.set_updated_at() trigger fn — none are recreated here.
-- Per table: RLS on, SELECT to authenticated gated by is_vammo_user(), full DML
-- to service_role (jobs/backfill per design §4), and NO client INSERT/UPDATE/
-- DELETE policy — every write goes through a SECURITY DEFINER RPC (migration 3)
-- or the service-role key. audit_events is append-only even for service_role.
-- Tables are ordered so every FK target is created before it is referenced.
-- Money numeric(12,2), kWh numeric(12,3), all timestamps timestamptz.

-- ── stations (natural PK = swap_station_id) ─────────────────────────────────
create table charging.stations (
  id                            integer primary key,          -- swap_station_id
  name                          text,
  address                       text,
  latitude                      double precision,
  longitude                     double precision,
  status                        charging.station_status not null,
  source_created_at             timestamptz,                  -- created_at from backoffice (gerar_mes pro-rata)
  requires_manual_meter_reading boolean not null default false,
  active_boxes                  integer,                      -- from 4_Metabase_Boxes via sheet-sync
  boxes_synced_at               timestamptz,
  synced_at                     timestamptz,
  raw                           jsonb,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz
);
alter table charging.stations enable row level security;
grant select on charging.stations to authenticated;
grant select, insert, update, delete on charging.stations to service_role;
create policy stations_select on charging.stations for select to authenticated using (charging.is_vammo_user());
create trigger set_updated_at before update on charging.stations for each row execute function charging.set_updated_at();

-- ── counterparties (landlords, condos, intermediaries, SPEs, utilities) ─────
create table charging.counterparties (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  cnpj_cpf           text check (cnpj_cpf ~ '^[0-9]{11}$|^[0-9]{14}$'),   -- digits only, 11 or 14
  kind               text not null check (kind in ('locador','condominio','intermediario','spe','concessionaria','outro')),
  value_tolerance    numeric(12,2) not null default 0.01,     -- Kitchen Central: 1.00 (known ND↔boleto offset)
  billing_cycle_rule text,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz,
  unique (cnpj_cpf)
);
alter table charging.counterparties enable row level security;
grant select on charging.counterparties to authenticated;
grant select, insert, update, delete on charging.counterparties to service_role;
create policy counterparties_select on charging.counterparties for select to authenticated using (charging.is_vammo_user());
create trigger set_updated_at before update on charging.counterparties for each row execute function charging.set_updated_at();

-- ── documents (Drive-backed file store; no Supabase Storage — decision #17) ──
create table charging.documents (
  id                uuid primary key default gen_random_uuid(),
  kind              charging.document_kind not null,
  source            charging.ingest_source not null,
  drive_file_id     text not null unique,                     -- Drive is the store
  drive_folder_kind charging.drive_folder_kind not null,      -- folder resolved from kind via env
  web_view_link     text,
  original_filename text,
  content_hash      text not null unique,                     -- sha256 — THE dedupe key
  mime_type         text,
  byte_size         bigint,
  email_message_id  text,                                     -- provenance (no FK until Phase 3)
  page_count        integer,
  exif              jsonb,                                    -- raw EXIF; meter cols copied off it
  processing_status charging.doc_processing_status not null default 'pending',
  processing_error  text,
  processed_at      timestamptz,
  uploaded_by_email text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz
);
create index documents_email_message_idx on charging.documents(email_message_id);
alter table charging.documents enable row level security;
grant select on charging.documents to authenticated;
grant select, insert, update, delete on charging.documents to service_role;
create policy documents_select on charging.documents for select to authenticated using (charging.is_vammo_user());
create trigger set_updated_at before update on charging.documents for each row execute function charging.set_updated_at();

-- ── contracts (the ~25-field 1_Cadastro model) ─────────────────────────────
create table charging.contracts (
  id                     uuid primary key default gen_random_uuid(),
  cadastro_id            integer unique,                      -- legacy 1_Cadastro PK (nullable for app-created)
  station_id             integer references charging.stations(id),
  counterparty_id        uuid not null references charging.counterparties(id),
  status                 charging.station_status not null default 'ACTIVE',  -- Status_Locacao
  address                text,
  contact_name           text,
  phone                  text,
  email                  text,
  enel_connection_number text,
  contract_type          charging.contract_type not null,
  box_count              integer,
  min_box                integer,
  valor_por_box          numeric(12,2),
  valor_mensal           numeric(12,2),
  due_day                smallint check (due_day between 1 and 31),
  payment_method         charging.payment_method,
  banco                  text,
  agencia                text,
  conta                  text,
  chave_pix              text,
  starts_on              date,
  ends_on                date,
  contract_document_id   uuid references charging.documents(id),
  observations           text,
  ai_extraction          jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz
);
create index contracts_station_idx on charging.contracts(station_id);
create index contracts_counterparty_idx on charging.contracts(counterparty_id);
create unique index one_active_contract_per_station on charging.contracts(station_id) where status = 'ACTIVE';
alter table charging.contracts enable row level security;
grant select on charging.contracts to authenticated;
grant select, insert, update, delete on charging.contracts to service_role;
create policy contracts_select on charging.contracts for select to authenticated using (charging.is_vammo_user());
create trigger set_updated_at before update on charging.contracts for each row execute function charging.set_updated_at();

-- ── rent_adjustments (3_Reajustes; table only, RPCs are Phase 3) ────────────
create table charging.rent_adjustments (
  id             uuid primary key default gen_random_uuid(),
  contract_id    uuid not null references charging.contracts(id),
  negotiated_on  date,
  index_type     charging.adjustment_index not null,
  index_pct      numeric(8,4),
  old_amount     numeric(12,2) not null,
  new_amount     numeric(12,2) not null,
  effective_from date not null,
  status         charging.adjustment_status not null default 'pendente',
  document_id    uuid references charging.documents(id),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz
);
create index rent_adjustments_contract_idx on charging.rent_adjustments(contract_id);
alter table charging.rent_adjustments enable row level security;
grant select on charging.rent_adjustments to authenticated;
grant select, insert, update, delete on charging.rent_adjustments to service_role;
create policy rent_adjustments_select on charging.rent_adjustments for select to authenticated using (charging.is_vammo_user());
create trigger set_updated_at before update on charging.rent_adjustments for each row execute function charging.set_updated_at();

-- ── billing_accounts (the hub: station 1—N accounts) ────────────────────────
create table charging.billing_accounts (
  id                      uuid primary key default gen_random_uuid(),
  station_id              integer references charging.stations(id),   -- NULL = Unidentified scraper rows
  account_type            charging.account_type not null,
  enel_id                 text,
  edp_uc                  text,
  edp_contract_id         text,
  contract_id             uuid references charging.contracts(id),     -- for account_type='rent'
  counterparty_id         uuid references charging.counterparties(id),-- for third_party
  external_ref            text,
  auto_debit_registration text,
  match_status            charging.match_status not null default 'unmatched',
  match_method            text,
  match_distance_m        numeric,
  match_confidence        numeric,
  matched_by_email        text,
  matched_at              timestamptz,
  is_active               boolean not null default true,
  meter_reading_required  boolean not null default false,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz,
  check (account_type <> 'rent' or contract_id is not null),
  check (account_type <> 'third_party' or counterparty_id is not null)
);
create unique index ba_enel on charging.billing_accounts(enel_id) where account_type = 'energy_enel';
create unique index ba_edp  on charging.billing_accounts(edp_uc)  where account_type = 'energy_edp';
create unique index ba_rent on charging.billing_accounts(contract_id) where account_type = 'rent';
create unique index ba_3p   on charging.billing_accounts(counterparty_id, station_id, coalesce(external_ref, ''))
  where account_type = 'third_party';
create index billing_accounts_station_idx on charging.billing_accounts(station_id);
alter table charging.billing_accounts enable row level security;
grant select on charging.billing_accounts to authenticated;
grant select, insert, update, delete on charging.billing_accounts to service_role;
create policy billing_accounts_select on charging.billing_accounts for select to authenticated using (charging.is_vammo_user());
create trigger set_updated_at before update on charging.billing_accounts for each row execute function charging.set_updated_at();

-- ── account_aliases (matching hints) ────────────────────────────────────────
create table charging.account_aliases (
  id                 uuid primary key default gen_random_uuid(),
  billing_account_id uuid not null references charging.billing_accounts(id) on delete cascade,
  alias_type         text not null check (alias_type in ('address','store_number','spe_name','cnpj','email','other')),
  alias_value        text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz,
  unique (alias_type, alias_value, billing_account_id)
);
alter table charging.account_aliases enable row level security;
grant select on charging.account_aliases to authenticated;
grant select, insert, update, delete on charging.account_aliases to service_role;
create policy account_aliases_select on charging.account_aliases for select to authenticated using (charging.is_vammo_user());
create trigger set_updated_at before update on charging.account_aliases for each row execute function charging.set_updated_at();

-- ── job_runs (union of appendix sync_runs + security-ops job_runs) ──────────
create table charging.job_runs (
  id             uuid primary key default gen_random_uuid(),
  job_name       text not null,
  trigger        text not null,                               -- 'cron' | 'manual:{email}'
  source_ref     text,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null default 'running'
                   check (status in ('running','success','partial','error','skipped_locked')),
  rows_read      integer,
  rows_upserted  integer,
  rows_skipped   integer,
  max_scraped_at timestamptz,                                 -- staleness detection
  stats          jsonb,
  error          text
);
create index job_runs_name_idx on charging.job_runs(job_name, started_at desc);
alter table charging.job_runs enable row level security;
grant select on charging.job_runs to authenticated;
grant select, insert, update, delete on charging.job_runs to service_role;
create policy job_runs_select on charging.job_runs for select to authenticated using (charging.is_vammo_user());

-- ── utility_account_state (current per-installation scraper state) ──────────
create table charging.utility_account_state (
  billing_account_id        uuid primary key references charging.billing_accounts(id),
  provider_station_status   text,
  address                   text,
  neighborhood              text,
  city                      text,
  bill_status               charging.utility_bill_status,
  bill_status_raw           text,
  last_billing              numeric(12,2),
  due_date                  date,
  auto_debit                charging.auto_debit_status,
  auto_debit_registration   text,
  account_email             text,
  negotiated_invoices       text[],
  invoice_history           text[],
  shutdown_date             date,
  shutdown_start            time,
  shutdown_end              time,
  first_seen_at             timestamptz,                      -- write-once
  scraped_at                timestamptz,                      -- freshness signal
  lat                       double precision,
  lon                       double precision,
  ultima_fatura_flag        text,
  ultimo_comprovante        text,
  is_status_carried_forward boolean not null default false,
  raw                       jsonb not null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz
);
alter table charging.utility_account_state enable row level security;
grant select on charging.utility_account_state to authenticated;
grant select, insert, update, delete on charging.utility_account_state to service_role;
create policy utility_account_state_select on charging.utility_account_state for select to authenticated using (charging.is_vammo_user());
create trigger set_updated_at before update on charging.utility_account_state for each row execute function charging.set_updated_at();

-- ── utility_account_snapshots (append-only history) ─────────────────────────
create table charging.utility_account_snapshots (
  id                 bigint generated always as identity primary key,
  billing_account_id uuid not null references charging.billing_accounts(id),
  job_run_id         uuid not null references charging.job_runs(id),
  row_hash           text not null,
  snapshot           jsonb not null,
  scraped_at         timestamptz,
  created_at         timestamptz not null default now(),
  unique (billing_account_id, row_hash, scraped_at)
);
create index uas_account_idx on charging.utility_account_snapshots(billing_account_id);
alter table charging.utility_account_snapshots enable row level security;
grant select on charging.utility_account_snapshots to authenticated;
grant select, insert, update, delete on charging.utility_account_snapshots to service_role;
create policy utility_account_snapshots_select on charging.utility_account_snapshots for select to authenticated using (charging.is_vammo_user());

-- ── monthly_consumption (F_/R_ matrix, unpivoted) ───────────────────────────
create table charging.monthly_consumption (
  billing_account_id uuid not null references charging.billing_accounts(id),
  competencia        date not null,                           -- first of month
  kwh_billed         numeric(12,3),
  kwh_recorded       numeric(12,3),
  source             charging.ingest_source not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz,
  primary key (billing_account_id, competencia)
);
alter table charging.monthly_consumption enable row level security;
grant select on charging.monthly_consumption to authenticated;
grant select, insert, update, delete on charging.monthly_consumption to service_role;
create policy monthly_consumption_select on charging.monthly_consumption for select to authenticated using (charging.is_vammo_user());
create trigger set_updated_at before update on charging.monthly_consumption for each row execute function charging.set_updated_at();

-- ── charges (the unified payables ledger) ───────────────────────────────────
create table charging.charges (
  id                 uuid primary key default gen_random_uuid(),
  billing_account_id uuid references charging.billing_accounts(id),   -- NULL = UNIDENTIFIED
  station_id         integer references charging.stations(id),        -- denormalized; NULL when unmatched
  kind               charging.charge_kind not null,
  competencia        date,
  competencia_source charging.competencia_source not null default 'unknown',
  amount             numeric(12,2) not null,
  expected_amount    numeric(12,2),
  due_date           date,
  status             charging.charge_status not null default 'pendente',
  status_source      text not null default 'sync' check (status_source in ('sync','rpc')),  -- H2: sticky human state
  match_status       charging.match_status not null default 'unmatched',
  flags              jsonb not null default '[]',             -- gerar_mes flags (replaces sheet cell colors)
  payment_method     charging.payment_method,
  banco              text,
  agencia            text,
  conta              text,
  chave_pix          text,
  linha_digitavel    text,                                    -- normalized digits-only
  nosso_numero       text,
  nota_fiscal        text,
  documento_numero   text,
  issuer_cnpj        text,
  source             charging.ingest_source not null,
  source_document_id uuid references charging.documents(id),
  dedupe_key         text not null unique,                    -- ONE recipe per logical charge (C1)
  legacy_ref         jsonb,
  raw                jsonb,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz
);
create index charges_station_comp_idx on charging.charges(station_id, competencia);
create index charges_account_comp_idx on charging.charges(billing_account_id, competencia);
create index charges_due_idx on charging.charges(due_date) where status in ('pendente','boleto_recebido','atrasado');
create index charges_match_idx on charging.charges(match_status) where match_status in ('unmatched','needs_review');
create index charges_linha_idx on charging.charges(linha_digitavel) where linha_digitavel is not null;
alter table charging.charges enable row level security;
grant select on charging.charges to authenticated;
grant select, insert, update, delete on charging.charges to service_role;
create policy charges_select on charging.charges for select to authenticated using (charging.is_vammo_user());
create trigger set_updated_at before update on charging.charges for each row execute function charging.set_updated_at();

-- ── charge_lines (rent/energy split inside one charge) ──────────────────────
create table charging.charge_lines (
  id                 uuid primary key default gen_random_uuid(),
  charge_id          uuid not null references charging.charges(id) on delete cascade,
  line_kind          charging.charge_line_kind not null,
  description        text,
  amount             numeric(12,2) not null,                  -- negatives allowed (Hubees discounts)
  competencia        date,
  competencia_source charging.competencia_source,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz
);
create index charge_lines_charge_idx on charging.charge_lines(charge_id);
alter table charging.charge_lines enable row level security;
grant select on charging.charge_lines to authenticated;
grant select, insert, update, delete on charging.charge_lines to service_role;
create policy charge_lines_select on charging.charge_lines for select to authenticated using (charging.is_vammo_user());
create trigger set_updated_at before update on charging.charge_lines for each row execute function charging.set_updated_at();

-- ── charge_energy_details (1:1 Faturas_ENEL / Faturas_EDP detail) ───────────
-- decision #21: fiscal_exported ("Enviado ao fiscal") replaces financeiro_check;
-- it means "exported to the FISCAL spreadsheet", NEVER "paid".
create table charging.charge_energy_details (
  charge_id               uuid primary key references charging.charges(id) on delete cascade,
  nf                      text,
  tariff_c1               text,
  tariff_c2               text,
  tariff_c3               text,
  tariff_c4               text,
  tariff_c5               text,
  tariff_c6               text,
  classificacao           text,
  modalidade              text,
  tipo_fornecimento       text,
  tusd_kwh                numeric(12,3),
  tusd_amount             numeric(12,2),
  te_kwh                  numeric(12,3),
  te_amount               numeric(12,2),
  cip                     numeric(12,2),
  sub_faturamento         numeric(12,2),
  total                   numeric(12,2),
  leitura_anterior        date,
  leitura_atual           date,
  auto_debit              charging.auto_debit_status,
  auto_debit_registration text,
  fatura_drive_url        text,
  fiscal_exported         boolean not null default false,     -- sheet "Financeiro Check" maps here 1:1
  fiscal_exported_at      timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz
);
alter table charging.charge_energy_details enable row level security;
grant select on charging.charge_energy_details to authenticated;
grant select, insert, update, delete on charging.charge_energy_details to service_role;
create policy charge_energy_details_select on charging.charge_energy_details for select to authenticated using (charging.is_vammo_user());
create trigger set_updated_at before update on charging.charge_energy_details for each row execute function charging.set_updated_at();

-- ── receipts (one row per receipt PAGE/SEGMENT) ─────────────────────────────
create table charging.receipts (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid not null references charging.documents(id),
  page_number      integer not null default 1,
  segment_index    integer not null default 0,                -- débito-automático multi-segment pages
  receipt_type     charging.receipt_type not null,
  amount           numeric(12,2),
  paid_at          date,
  chave_pix        text,
  cnpj_cpf         text,
  banco            text,
  agencia          text,
  conta            text,
  identificacao    text,
  autenticacao     text,
  codigo_barras    text,
  ctrl             text,
  match_status     charging.match_status not null default 'unmatched',
  matched_by_email text,
  matched_at       timestamptz,
  match_notes      text,
  raw_text         text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz,
  unique (document_id, page_number, segment_index)
);
create index receipts_match_idx on charging.receipts(match_status) where match_status in ('unmatched','needs_review');
alter table charging.receipts enable row level security;
grant select on charging.receipts to authenticated;
grant select, insert, update, delete on charging.receipts to service_role;
create policy receipts_select on charging.receipts for select to authenticated using (charging.is_vammo_user());
create trigger set_updated_at before update on charging.receipts for each row execute function charging.set_updated_at();

-- ── payments (allocation of money to a charge) ──────────────────────────────
create table charging.payments (
  id               uuid primary key default gen_random_uuid(),
  charge_id        uuid not null references charging.charges(id),
  receipt_id       uuid references charging.receipts(id),     -- NULL: 'Pago' without receipt exists
  amount           numeric(12,2) not null,
  paid_at          date,
  method           charging.payment_method,
  source           charging.ingest_source not null,
  created_by_email text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz,
  unique (charge_id, receipt_id)                              -- one receipt allocated once per charge
);
create index payments_receipt_idx on charging.payments(receipt_id);
alter table charging.payments enable row level security;
grant select on charging.payments to authenticated;
grant select, insert, update, delete on charging.payments to service_role;
create policy payments_select on charging.payments for select to authenticated using (charging.is_vammo_user());
create trigger set_updated_at before update on charging.payments for each row execute function charging.set_updated_at();

-- ── meter_readings (phone flow, mandatory photo) ────────────────────────────
create table charging.meter_readings (
  id                  uuid primary key default gen_random_uuid(),
  station_id          integer not null references charging.stations(id),
  billing_account_id  uuid references charging.billing_accounts(id),  -- M14: NULL unless >1 metered account
  name                text not null,                          -- C3: editable label, default '{id} - {address}'
  reading_date        date not null,
  competencia         date not null,                          -- month it counts toward
  reading_kwh         numeric(12,3) not null,
  photo_document_id   uuid not null references charging.documents(id),-- MANDATORY photo
  photo_taken_at      timestamptz,                            -- EXIF, copied off documents.exif
  photo_gps           jsonb,
  photo_warnings      text[],
  read_by_email       text not null,                          -- = logged-in user (never a param)
  notes               text,
  replaces_reading_id uuid references charging.meter_readings(id),    -- corrections append, never overwrite
  is_superseded       boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);
create index meter_readings_station_comp_idx on charging.meter_readings(station_id, competencia);
-- one live reading per photo (a correction supersedes the old row, freeing the slot)
create unique index meter_readings_photo_unique on charging.meter_readings(photo_document_id) where not is_superseded;
alter table charging.meter_readings enable row level security;
grant select on charging.meter_readings to authenticated;
grant select, insert, update, delete on charging.meter_readings to service_role;
create policy meter_readings_select on charging.meter_readings for select to authenticated using (charging.is_vammo_user());
create trigger set_updated_at before update on charging.meter_readings for each row execute function charging.set_updated_at();

-- ── alerts (replaces all n8n watchdogs) ─────────────────────────────────────
create table charging.alerts (
  id                    uuid primary key default gen_random_uuid(),
  alert_type            text not null check (alert_type in (
    'overdue_bill','due_soon_no_auto_debit','no_auto_debit','new_installation',
    'scraper_stale','negotiated_invoice','scheduled_shutdown',
    'station_without_contract','contract_without_station',
    'unmatched_charge','unmatched_receipt','unmatched_account',
    'meter_vs_bill_discrepancy','missing_meter_reading','value_mismatch','contract_expiring',
    'manual_bill_sheet_append_failed','encrypted_comprovante','sheet_sync_stale')),  -- +3 (M2)
  severity              text not null default 'warning' check (severity in ('info','warning','critical')),
  station_id            integer references charging.stations(id),
  billing_account_id    uuid references charging.billing_accounts(id),
  charge_id             uuid references charging.charges(id),
  dedupe_key            text not null unique,                 -- upsert key ('overdue:{account}:{due}')
  payload               jsonb not null default '{}',
  status                charging.alert_status not null default 'open',
  first_detected_at     timestamptz not null default now(),
  last_detected_at      timestamptz not null default now(),
  acknowledged_by_email text,
  acknowledged_at       timestamptz,
  muted_by_email        text,
  muted_at              timestamptz,
  resolved_at           timestamptz,
  resolved_by_email     text,
  notified_slack_at     timestamptz,
  updated_at            timestamptz
);
create index alerts_status_type_idx on charging.alerts(status, alert_type);
alter table charging.alerts enable row level security;
grant select on charging.alerts to authenticated;
grant select, insert, update, delete on charging.alerts to service_role;
create policy alerts_select on charging.alerts for select to authenticated using (charging.is_vammo_user());
create trigger set_updated_at before update on charging.alerts for each row execute function charging.set_updated_at();

-- ── raw_sheet_rows (staging: every synced sheet row, verbatim) ──────────────
create table charging.raw_sheet_rows (
  id               bigint generated always as identity primary key,
  job_run_id       uuid not null references charging.job_runs(id),
  tab              text not null,
  sheet_row_number integer,
  row_hash         text not null,                             -- skip unchanged rows across runs
  data             jsonb not null,                            -- header-name → raw cell value
  created_at       timestamptz not null default now(),
  unique (tab, row_hash)
);
alter table charging.raw_sheet_rows enable row level security;
grant select on charging.raw_sheet_rows to authenticated;
grant select, insert, update, delete on charging.raw_sheet_rows to service_role;
create policy raw_sheet_rows_select on charging.raw_sheet_rows for select to authenticated using (charging.is_vammo_user());

-- ── audit_events (goBuy request_events pattern; append-only) ────────────────
create table charging.audit_events (
  id           bigint generated always as identity primary key,
  entity_table text not null,                                 -- entity_table wins over entity_type
  entity_id    text not null,
  event_type   text not null,
  actor_email  text not null,                                 -- user email or 'system:{job}'
  detail       jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
create index audit_events_entity_idx on charging.audit_events(entity_table, entity_id);
create index audit_events_created_idx on charging.audit_events(created_at);
alter table charging.audit_events enable row level security;
grant select on charging.audit_events to authenticated;
-- append-only even for service_role: SELECT + INSERT only (no UPDATE/DELETE)
grant select, insert on charging.audit_events to service_role;
create policy audit_events_select on charging.audit_events for select to authenticated using (charging.is_vammo_user());

-- ── sheet_writebacks (outbox: append-only rows back to the scraper sheet) ───
create table charging.sheet_writebacks (
  id           uuid primary key default gen_random_uuid(),
  charge_id    uuid references charging.charges(id),
  spreadsheet  text,
  tab          text,                                          -- allowlist asserted in app code
  payload      jsonb,
  status       text not null default 'pending',
  attempts     integer not null default 0,
  last_error   text,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index sheet_writebacks_pending_idx on charging.sheet_writebacks(created_at) where completed_at is null;
alter table charging.sheet_writebacks enable row level security;
grant select on charging.sheet_writebacks to authenticated;
grant select, insert, update, delete on charging.sheet_writebacks to service_role;
create policy sheet_writebacks_select on charging.sheet_writebacks for select to authenticated using (charging.is_vammo_user());

-- ── sync_cursors (poller cursors, e.g. comprovantes-drive-poll) ─────────────
create table charging.sync_cursors (
  job_name   text primary key,
  cursor     timestamptz,                                     -- max processed modifiedTime
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
alter table charging.sync_cursors enable row level security;
grant select on charging.sync_cursors to authenticated;
grant select, insert, update, delete on charging.sync_cursors to service_role;
create policy sync_cursors_select on charging.sync_cursors for select to authenticated using (charging.is_vammo_user());
create trigger set_updated_at before update on charging.sync_cursors for each row execute function charging.set_updated_at();
