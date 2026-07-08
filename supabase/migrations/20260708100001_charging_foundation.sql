-- Eletron Phase 2 — migration 1: charging schema foundation.
-- Creates the isolated `charging` schema on the shared "Vammo Automations"
-- project: enums, the user_roles table + auth helpers, the updated_at trigger,
-- and the privilege baseline (zero writes to clients; functions locked down).
-- Additive + isolated: touches nothing in finance/cx/public.

create schema if not exists charging;

-- ── Privilege baseline ─────────────────────────────────────────────────────
revoke all on schema charging from public;
revoke all on schema charging from anon;
grant usage on schema charging to authenticated, service_role;
-- New tables: no client privileges by default; SELECT is granted per-table in
-- migration 2 and gated by RLS. Service role keeps full access (jobs/backfill).
alter default privileges in schema charging revoke all on tables from public, anon, authenticated;
alter default privileges in schema charging revoke all on functions from public, anon;

-- ── Enums ───────────────────────────────────────────────────────────────────
create type charging.station_status as enum ('ACTIVE','INACTIVE','DECOMMISSIONED','PRE_INSTALLATION');
create type charging.account_type as enum ('rent','energy_enel','energy_edp','third_party');
create type charging.contract_type as enum ('por_box','fixo','por_box_minimo','gratuito','casa_vammo');
create type charging.payment_method as enum ('pix','boleto_celular','boleto_email','transferencia','debito_automatico','outro');
-- charge_status includes 'conciliado' (auto-matched, awaiting human confirm — Phase 2).
create type charging.charge_status as enum ('pendente','boleto_recebido','conciliado','pago','atrasado','antecipado','em_compensacao','negociada','cancelada','nao_aplicavel');
create type charging.charge_kind as enum ('aluguel','energia','aluguel_energia');
create type charging.charge_line_kind as enum ('aluguel','energia','desconto','multa_juros','outro');
create type charging.utility_bill_status as enum ('paga','pendente','a_vencer','vencida','sem_contas','em_compensacao','fatura_negociada','na');
create type charging.auto_debit_status as enum ('cadastrado','nao_cadastrado','desconhecido');
create type charging.match_status as enum ('auto_matched','manually_matched','unmatched','needs_review','rejected','superseded');
create type charging.adjustment_index as enum ('igpm','ipca','inpc','outro');
create type charging.adjustment_status as enum ('pendente','negociando','aplicado','recusado');
create type charging.document_kind as enum ('fatura_enel','fatura_edp','boleto_aluguel','boleto_condominio','nota_debito','nfse','comprovante','contrato','foto_medidor','outro');
-- ingest_source: Phase 2 adds gerar_mes/auto_match/app_upload/drive_poll; email_ai kept for Phase 3.
create type charging.ingest_source as enum ('scraper_enel','scraper_edp','email_ai','drive_poll','manual','metabase_sync','sheet_backfill','gerar_mes','auto_match','app_upload');
create type charging.receipt_type as enum ('pix','ted','debito_automatico','boleto_barcode','outro');
create type charging.alert_status as enum ('open','acknowledged','resolved','muted');
create type charging.competencia_source as enum ('explicit','inferred_due_date','inferred_filename','inferred_issuer_rule','manual','unknown');
-- Phase 2 additions:
create type charging.drive_folder_kind as enum ('meter_photos','comprovantes','bills','other');
create type charging.doc_processing_status as enum ('pending','processed','needs_review','failed');

-- ── updated_at trigger fn ─────────────────────────────────────────────────
create or replace function charging.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── Roles table (foundational: the auth helpers read it) ────────────────────
create table charging.user_roles (
  email           text primary key check (email = lower(email) and email like '%@vammo.com'),
  role            text not null check (role in ('admin','operator')),
  created_at      timestamptz not null default now(),
  created_by_email text
);

-- ── Auth helpers (namespaced copies of goBuy finance.*) ─────────────────────
-- Identity comes from the minted JWT (mintSupabaseToken); never from the client.
-- The `app` claim hardening: only eletron-minted tokens may read charging, so a
-- goBuy-minted token on the same shared JWT secret cannot reach this schema.
create or replace function charging.jwt_email()
returns text language sql stable as $$
  select lower(auth.jwt() ->> 'email')
$$;

create or replace function charging.is_vammo_user()
returns boolean language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', '') like '%@vammo.com'
     and coalesce(auth.jwt() ->> 'app', '') = 'eletron'
$$;

create or replace function charging.is_admin()
returns boolean language sql stable security definer set search_path = charging as $$
  select exists (
    select 1 from charging.user_roles
    where email = charging.jwt_email() and role = 'admin'
  )
$$;

create or replace function charging.is_operator()
returns boolean language sql stable security definer set search_path = charging as $$
  select charging.is_admin() or exists (
    select 1 from charging.user_roles
    where email = charging.jwt_email() and role = 'operator'
  )
$$;

-- RLS policies call these as the authenticated role → explicit EXECUTE grants
-- (the ALTER DEFAULT PRIVILEGES above stripped the PUBLIC default).
grant execute on function charging.jwt_email(), charging.is_vammo_user(),
  charging.is_admin(), charging.is_operator() to authenticated, service_role;

-- user_roles is readable by any vammo user (the /admin Usuários card needs it);
-- writes only via the set_user_role RPC (migration 3).
alter table charging.user_roles enable row level security;
grant select on charging.user_roles to authenticated;
create policy user_roles_select on charging.user_roles
  for select to authenticated using (charging.is_vammo_user());
