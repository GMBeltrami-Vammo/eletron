-- Eletron Phase 2.5 — migration 16: contract-onboarding intake (Q10).
-- Ports the n8n Fill_Cadastro_Form flow off the Google Form: n8n keeps Drive
-- watch + OCR + OpenAI extraction, then POSTs its AI output to
-- POST /api/ingest/contratos. The app STAGES the raw extraction in
-- charging.contract_intake ('pending'); a human reviews/edits and confirms,
-- which creates the real contract (+ counterparty + rent billing_account).
--
-- Why a staging table (not a direct contract): contracts.status is a constrained
-- enum (ACTIVE/INACTIVE/DECOMMISSIONED/PRE_INSTALLATION) with no "draft" state,
-- and decision #28 makes Metabase the station source of truth — so a contract is
-- only ever created after a human confirm, and it attaches to a swap_station_id
-- only if that station already exists (the app never creates stations).
--
-- Follows the migration-2/3/8 idioms: RLS on, SELECT to authenticated gated by
-- is_vammo_user(), full DML to service_role, no client INSERT/UPDATE/DELETE
-- (writes via the SECURITY DEFINER RPCs below or the service-role key). RPCs
-- follow the guard template (is_vammo_user gate → FOR UPDATE → state guard →
-- mutate → exactly ONE audit_events row) and pin search_path. Every CASE that
-- feeds an enum column is wrapped `(...)::charging.<enum>` (migration-11 lesson:
-- a plpgsql CASE of string literals is `text` and will NOT implicitly cast).

-- ── contract_intake (raw AI extraction, staged for human review) ─────────────
create table charging.contract_intake (
  id                uuid primary key default gen_random_uuid(),
  document_id       uuid references charging.documents(id),   -- the contract PDF (Drive-backed)
  drive_file_id     text,
  web_view_link     text,
  nome_arquivo      text,
  ai_extraction     jsonb not null,                           -- n8n OpenAI output, verbatim
  status            text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  created_at        timestamptz not null default now(),
  reviewed_by_email text,
  reviewed_at       timestamptz,
  contract_id       uuid references charging.contracts(id),   -- set on confirm
  notes             text                                      -- rejection reason / free notes
);
-- idempotent re-delivery: one intake per source Drive file (webhook upserts by it)
create unique index contract_intake_drive_file_idx on charging.contract_intake(drive_file_id);
create index contract_intake_status_idx on charging.contract_intake(status) where status = 'pending';
alter table charging.contract_intake enable row level security;
grant select on charging.contract_intake to authenticated;
grant select, insert, update, delete on charging.contract_intake to service_role;
create policy contract_intake_select on charging.contract_intake for select to authenticated using (charging.is_vammo_user());

-- ── confirm_contract_intake ──────────────────────────────────────────────────
-- The human gate: turns a reviewed/edited intake into a real contract. Creates
-- (or reuses) the locador counterparty, inserts the contract, and creates the
-- rent billing_account. Attribution to a station only if it exists (decision
-- #28 — the app never creates stations). CNPJ/CPF arrives ALREADY normalized
-- from the app (lib/ingest/normalize.ts normalizeCnpjCpf). pt-BR errors.
create or replace function charging.confirm_contract_intake(
  p_intake_id         uuid,
  p_swap_station_id   integer,
  p_status            charging.station_status,
  p_contract_type     charging.contract_type,
  p_counterparty_name text,
  p_counterparty_cnpj text,
  p_numero_conexao    text,
  p_endereco          text,
  p_contato           text,
  p_telefone          text,
  p_email             text,
  p_box_count         integer,
  p_min_box           integer,
  p_valor_por_box     numeric,
  p_valor_mensal      numeric,
  p_due_day           integer,
  p_payment_method    charging.payment_method,
  p_banco             text,
  p_agencia           text,
  p_conta             text,
  p_chave_pix         text,
  p_observacoes       text
)
returns uuid
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email       text := charging.jwt_email();
  v_intake      charging.contract_intake%rowtype;
  v_station     integer;
  v_cnpj        text;
  v_name        text;
  v_cp_id       uuid;
  v_contract_id uuid;
  v_ba          uuid;
begin
  if not charging.is_vammo_user() then raise exception 'não autorizado'; end if;
  if p_contract_type is null then
    raise exception 'informe o tipo de contrato';
  end if;
  if p_due_day is not null and (p_due_day < 1 or p_due_day > 31) then
    raise exception 'o dia de vencimento deve estar entre 1 e 31';
  end if;

  select * into v_intake from charging.contract_intake where id = p_intake_id for update;
  if not found then raise exception 'cadastro de contrato % não encontrado', p_intake_id; end if;
  if v_intake.status <> 'pending' then
    raise exception 'este contrato já foi % — nada a confirmar', v_intake.status;  -- double-submit guard
  end if;

  -- station must exist (app never creates stations); null = contract sem estação
  if p_swap_station_id is not null then
    if not exists (select 1 from charging.stations where id = p_swap_station_id) then
      raise exception 'estação % não encontrada — o app não cria estações (fonte é o Metabase)', p_swap_station_id;
    end if;
    v_station := p_swap_station_id;
  end if;

  -- one active contract per station (mirrors the one_active_contract_per_station index)
  if p_status = 'ACTIVE' and v_station is not null
     and exists (select 1 from charging.contracts where station_id = v_station and status = 'ACTIVE') then
    raise exception 'a estação % já possui um contrato ativo', v_station;
  end if;

  -- counterparty (locador): identity by cnpj when valid (arrives normalized), else exact name
  v_cnpj := nullif(btrim(coalesce(p_counterparty_cnpj, '')), '');
  v_name := nullif(btrim(coalesce(p_counterparty_name, '')), '');
  if v_cnpj is not null and v_cnpj !~ '^[0-9]{11}$|^[0-9]{14}$' then
    raise exception 'CNPJ/CPF inválido — informe 11 ou 14 dígitos';
  end if;
  if v_cnpj is null and v_name is null then
    raise exception 'informe o parceiro locador (nome ou CNPJ/CPF)';
  end if;

  if v_cnpj is not null then
    select id into v_cp_id from charging.counterparties where cnpj_cpf = v_cnpj;
  else
    select id into v_cp_id from charging.counterparties where name = v_name limit 1;
  end if;
  if v_cp_id is null then
    insert into charging.counterparties (name, cnpj_cpf, kind)
    values (coalesce(v_name, v_cnpj), v_cnpj, 'locador')
    returning id into v_cp_id;
  end if;

  -- the contract (cadastro_id left null — app-created; ai_extraction retained)
  insert into charging.contracts (
    station_id, counterparty_id, status, address, contact_name, phone, email,
    enel_connection_number, contract_type, box_count, min_box, valor_por_box, valor_mensal,
    due_day, payment_method, banco, agencia, conta, chave_pix,
    contract_document_id, observations, ai_extraction
  ) values (
    v_station, v_cp_id, p_status, p_endereco, p_contato, p_telefone, p_email,
    p_numero_conexao, p_contract_type, p_box_count, p_min_box, p_valor_por_box, p_valor_mensal,
    p_due_day, p_payment_method, p_banco, p_agencia, p_conta, p_chave_pix,
    v_intake.document_id, p_observacoes, v_intake.ai_extraction
  )
  returning id into v_contract_id;

  -- the rent billing_account (hub row). CASE→enum MUST be cast (migration-11).
  insert into charging.billing_accounts (
    station_id, account_type, contract_id, match_status, matched_by_email, matched_at
  ) values (
    v_station, 'rent', v_contract_id,
    (case when v_station is null then 'unmatched' else 'manually_matched' end)::charging.match_status,
    v_email, now()
  )
  returning id into v_ba;

  update charging.contract_intake
  set status = 'confirmed', contract_id = v_contract_id,
      reviewed_by_email = v_email, reviewed_at = now()
  where id = p_intake_id;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('contracts', v_contract_id::text, 'created', v_email,
    jsonb_build_object('source', 'contract_intake', 'intake_id', p_intake_id,
      'counterparty_id', v_cp_id, 'billing_account_id', v_ba, 'station_id', v_station,
      'contract_type', p_contract_type::text, 'status', p_status::text));

  return v_contract_id;
end;
$$;

-- ── reject_contract_intake ───────────────────────────────────────────────────
create or replace function charging.reject_contract_intake(p_intake_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email  text := charging.jwt_email();
  v_intake charging.contract_intake%rowtype;
begin
  if not charging.is_vammo_user() then raise exception 'não autorizado'; end if;

  select * into v_intake from charging.contract_intake where id = p_intake_id for update;
  if not found then raise exception 'cadastro de contrato % não encontrado', p_intake_id; end if;
  if v_intake.status <> 'pending' then
    raise exception 'este contrato já foi % — nada a rejeitar', v_intake.status;  -- double-submit guard
  end if;

  update charging.contract_intake
  set status = 'rejected', notes = p_reason,
      reviewed_by_email = v_email, reviewed_at = now()
  where id = p_intake_id;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('contract_intake', p_intake_id::text, 'rejected', v_email,
    jsonb_build_object('reason', p_reason, 'drive_file_id', v_intake.drive_file_id));
end;
$$;

-- ── EXECUTE privileges (migration-8 style) ───────────────────────────────────
revoke execute on function charging.confirm_contract_intake(uuid, integer, charging.station_status, charging.contract_type, text, text, text, text, text, text, text, integer, integer, numeric, numeric, integer, charging.payment_method, text, text, text, text, text) from public, anon;
grant execute on function charging.confirm_contract_intake(uuid, integer, charging.station_status, charging.contract_type, text, text, text, text, text, text, text, integer, integer, numeric, numeric, integer, charging.payment_method, text, text, text, text, text) to authenticated;

revoke execute on function charging.reject_contract_intake(uuid, text) from public, anon;
grant execute on function charging.reject_contract_intake(uuid, text) to authenticated;
