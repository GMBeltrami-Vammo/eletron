-- ARQIA (Gabriel 2026-07-22, spec docs/superpowers/specs/2026-07-22-arqia-tab-design):
-- traz o workflow n8n de monitoramento de SIMs IoT (Arqia/gestaom2m) pro app.
-- Tabelas no schema `charging` (reusa supabaseAdmin + is_vammo_user), prefixo
-- arqia_. Reverte a decisão #13 ("Arqia fica no n8n").

create table if not exists charging.arqia_sims (
  iccid         text primary key,
  first_seen_on date not null,               -- base do pró-rata (300 MB/SIM)
  status        text not null default 'active' check (status in ('active','inactive')),
  account_name  text,
  updated_at    timestamptz not null default now()
);

-- Rollup diário → alimenta o gráfico e a checagem de alerta.
create table if not exists charging.arqia_snapshots (
  snapshot_on        date primary key,
  sim_count          integer not null default 0,
  base_quota_mb      numeric not null default 0,   -- pró-rata (300/SIM)
  purchased_mb       numeric not null default 0,   -- Σ compras do mês
  effective_quota_mb numeric not null default 0,   -- base + purchased
  consumption_mb     numeric not null default 0,
  pct                numeric not null default 0,
  created_at         timestamptz not null default now()
);

-- Compras manuais de dados móveis do mês (somam ao limite; resetam por mês).
create table if not exists charging.arqia_data_purchases (
  id           uuid primary key default gen_random_uuid(),
  competencia  date not null,                       -- 'YYYY-MM-01'
  mb_added     numeric not null check (mb_added > 0),
  note         text,
  actor_email  text,
  created_at   timestamptz not null default now()
);
create index if not exists arqia_data_purchases_comp_idx
  on charging.arqia_data_purchases(competencia);

-- Log dos alertas (painel "Slack alerts").
create table if not exists charging.arqia_alerts (
  id                 uuid primary key default gen_random_uuid(),
  snapshot_on        date not null,
  pct                numeric not null,
  effective_quota_mb numeric not null,
  consumption_mb     numeric not null,
  threshold          numeric not null,
  message            text not null,
  sent_to            jsonb not null default '[]'::jsonb,
  slack_ok           boolean not null default false,
  created_at         timestamptz not null default now()
);
create index if not exists arqia_alerts_created_idx
  on charging.arqia_alerts(created_at desc);

-- RLS: leitura p/ @vammo.com autenticado (o app lê via service role de qualquer
-- forma); escrita só via RPC / service role. Espelha charging.station_senders.
alter table charging.arqia_sims           enable row level security;
alter table charging.arqia_snapshots      enable row level security;
alter table charging.arqia_data_purchases enable row level security;
alter table charging.arqia_alerts         enable row level security;

drop policy if exists arqia_sims_select on charging.arqia_sims;
create policy arqia_sims_select on charging.arqia_sims
  for select to authenticated using (charging.is_vammo_user());
drop policy if exists arqia_snapshots_select on charging.arqia_snapshots;
create policy arqia_snapshots_select on charging.arqia_snapshots
  for select to authenticated using (charging.is_vammo_user());
drop policy if exists arqia_data_purchases_select on charging.arqia_data_purchases;
create policy arqia_data_purchases_select on charging.arqia_data_purchases
  for select to authenticated using (charging.is_vammo_user());
drop policy if exists arqia_alerts_select on charging.arqia_alerts;
create policy arqia_alerts_select on charging.arqia_alerts
  for select to authenticated using (charging.is_vammo_user());

-- "Adicionar dados móveis no mês": soma MB ao limite do mês corrente.
create or replace function charging.create_arqia_data_purchase(p_mb numeric, p_note text)
returns uuid
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email text := charging.jwt_email();
  v_id    uuid;
  v_comp  date := date_trunc('month', current_date)::date;
begin
  if not charging.is_vammo_user() then raise exception 'não autorizado'; end if;
  if p_mb is null or p_mb <= 0 then raise exception 'informe os MB comprados (> 0)'; end if;

  insert into charging.arqia_data_purchases (competencia, mb_added, note, actor_email)
  values (v_comp, p_mb, nullif(btrim(coalesce(p_note, '')), ''), v_email)
  returning id into v_id;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('arqia_data_purchases', v_id::text, 'arqia_data_purchased', v_email,
    jsonb_build_object('competencia', v_comp, 'mb_added', p_mb));

  return v_id;
end;
$$;

revoke execute on function charging.create_arqia_data_purchase(numeric, text) from public, anon;
grant  execute on function charging.create_arqia_data_purchase(numeric, text) to authenticated;

-- Table-level grants (RLS/policies não bastam — o role precisa do privilégio).
-- O app lê/escreve via service_role (supabaseAdmin); authenticated só SELECT.
-- (Aplicado em prod na migration arqia_grants; aqui p/ um apply do zero ficar
-- completo — apply_migration não herda os grants padrão do schema charging.)
grant select, insert, update, delete on
  charging.arqia_sims,
  charging.arqia_snapshots,
  charging.arqia_data_purchases,
  charging.arqia_alerts
  to service_role;
grant select on
  charging.arqia_sims,
  charging.arqia_snapshots,
  charging.arqia_data_purchases,
  charging.arqia_alerts
  to authenticated;
