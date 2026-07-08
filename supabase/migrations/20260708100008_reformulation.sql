-- Eletron Phase 2.5 — migration 8: reformulation.
-- Per the 2026-07-08 pivot (Supabase-only test env, roles suspended):
--   A) de-role: is_operator()/is_admin() collapse to is_vammo_user()
--   B) contracts.rent_manual column + best-effort seed (Ipiranga / Smart Kitchens)
--   C) alerts CHECK gains 'manual_rent_reminder'; open stale-sync alerts resolved
--   D) gerar_mes re-issued with the rent_manual skip (M7) — only change
--   E) reclassify_charge — email-classification review / full charge patch (M9, H3)
--   F) adjust_charge — amount/due-date alteration with reason (pro-rata, delayed debt)
--   G) cancel_contract — contract → INACTIVE with reason
--   H) reject_account — "não é Vammo" for unmatched/needs_review accounts (M8)
--   I) EXECUTE grants for the four new RPCs
-- All functions stay SECURITY DEFINER with a pinned search_path; RLS and table
-- grants are untouched. Zero references to any schema other than charging.

-- ── A) De-role ───────────────────────────────────────────────────────────────
-- Roles suspended per Gabriel 2026-07-08: any @vammo.com session may write.
-- Redefining the two helpers (bodies = is_vammo_user()) de-roles every existing
-- RPC in one place — no RPC edits needed. user_roles and set_user_role are left
-- dormant (data kept; the RPC still works but grants nothing extra).
-- Existing EXECUTE grants are preserved by create or replace.

create or replace function charging.is_admin()
returns boolean language sql stable security definer set search_path = charging as $$
  select charging.is_vammo_user()
$$;

create or replace function charging.is_operator()
returns boolean language sql stable security definer set search_path = charging as $$
  select charging.is_vammo_user()
$$;

-- ── B) contracts.rent_manual ─────────────────────────────────────────────────
-- Contracts whose rent is collected manually (no boleto/pix generation): the
-- gerar_mes skip (section D) + the manual_rent_reminder alert rule target these.
alter table charging.contracts add column if not exists rent_manual boolean not null default false;

-- Best-effort seed by counterparty name, with contract address as a fallback.
-- Curated afterwards via the contract-page toggle (M7): "Smart Kitchens" station
-- names ≠ "Kitchen Central" (a third-party ENERGY counterparty — deliberately
-- not matched here), and "%ipiranga%" on address may over-match the Ipiranga
-- neighborhood — human review expected; the seed may legitimately hit 0 rows.
update charging.contracts c
set rent_manual = true
from charging.counterparties cp
where c.counterparty_id = cp.id
  and (cp.name ilike '%ipiranga%' or cp.name ilike '%smart kitchen%'
       or c.address ilike '%ipiranga%' or c.address ilike '%smart kitchen%');

-- ── C) Alert hygiene ─────────────────────────────────────────────────────────
-- alert_type is a text CHECK (L1 — not an enum): drop + recreate to admit
-- 'manual_rent_reminder'. The constraint was created inline in migration 2, so
-- its name is auto-generated (expected: alerts_alert_type_check). We find it
-- dynamically in pg_constraint instead of hardcoding the name — if this block
-- ever drops nothing, check `\d charging.alerts` for the actual name.
do $do$
declare
  v_name text;
begin
  select con.conname into v_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'charging'
    and rel.relname = 'alerts'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%alert_type%'
  limit 1;
  if v_name is not null then
    execute format('alter table charging.alerts drop constraint %I', v_name);
  end if;
end;
$do$;

-- Full previous list + 'manual_rent_reminder'. scraper_stale / sheet_sync_stale
-- stay valid values for one release (M2): existing rows keep passing the CHECK
-- and the auto-resolve set can still reference them; only their emission stops.
alter table charging.alerts add constraint alerts_alert_type_check check (alert_type in (
  'overdue_bill','due_soon_no_auto_debit','no_auto_debit','new_installation',
  'scraper_stale','negotiated_invoice','scheduled_shutdown',
  'station_without_contract','contract_without_station',
  'unmatched_charge','unmatched_receipt','unmatched_account',
  'meter_vs_bill_discrepancy','missing_meter_reading','value_mismatch','contract_expiring',
  'manual_bill_sheet_append_failed','encrypted_comprovante','sheet_sync_stale',
  'manual_rent_reminder'));

-- M2: post-sever these would stay open forever on frozen data — resolve them now.
update charging.alerts
set status = 'resolved', resolved_at = now(), resolved_by_email = 'system:migration-8'
where alert_type in ('scraper_stale','sheet_sync_stale')
  and status in ('open','acknowledged');

-- ── D) gerar_mes: skip rent_manual contracts (M7) ───────────────────────────
-- Exact copy of migration 3's body with ONE added filter in the contracts loop
-- (`and coalesce(c.rent_manual, false) = false`): manually-collected rents get
-- the manual_rent_reminder alert instead of a generated charge. Nothing else
-- changed.
create or replace function charging.gerar_mes(p_competencia date)
returns jsonb
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email         text := charging.jwt_email();
  v_month         date := date_trunc('month', p_competencia)::date;
  v_days_in_month integer := extract(day from (v_month + interval '1 month' - interval '1 day'))::integer;
  v_created       integer := 0;
  v_skipped       integer := 0;
  v_flagged       integer := 0;
  r               record;
  v_amount        numeric;
  v_boxes         integer;
  v_flags         jsonb;
  v_dedupe        text;
  v_due           date;
  v_ba            uuid;
  v_charge_id     uuid;
  v_prorata       numeric;
  v_created_day   integer;
begin
  if not charging.is_vammo_user() then raise exception 'not authorized'; end if;
  if not charging.is_operator() then raise exception 'operator role required'; end if;

  for r in
    select c.*, s.active_boxes, s.boxes_synced_at, s.source_created_at
    from charging.contracts c
    left join charging.stations s on s.id = c.station_id
    where c.status = 'ACTIVE'
      and c.payment_method in ('pix','transferencia')
      and coalesce(c.rent_manual, false) = false   -- M7: manual-rent contracts are reminded, never generated
  loop
    v_flags     := '[]'::jsonb;
    v_boxes     := r.active_boxes;
    v_charge_id := null;

    -- pricing per contract_type
    if r.contract_type = 'fixo' then
      v_amount := r.valor_mensal;
    elsif r.contract_type = 'por_box' then
      if v_boxes is null then
        v_amount := r.valor_mensal;
        v_flags  := v_flags || '["no_metabase_data"]'::jsonb;
      elsif v_boxes = r.box_count then
        v_amount := r.valor_mensal;
      else
        v_amount := v_boxes * r.valor_por_box;
        v_flags  := v_flags || '["boxes_mismatch"]'::jsonb;
      end if;
    elsif r.contract_type = 'por_box_minimo' then
      if v_boxes is null then
        v_amount := r.valor_mensal;
        v_flags  := v_flags || '["no_metabase_data"]'::jsonb;
      else
        v_amount := greatest(coalesce(r.min_box, 0), v_boxes) * r.valor_por_box;
        if v_boxes <> r.box_count then v_flags := v_flags || '["boxes_mismatch"]'::jsonb; end if;
      end if;
    else
      continue;   -- gratuito / casa_vammo — nothing to bill
    end if;

    if v_amount is null or v_amount <= 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- M5 pro-rata: station created within the competência month, from source_created_at
    if r.source_created_at is not null
       and date_trunc('month', r.source_created_at)::date = v_month then
      v_created_day := extract(day from r.source_created_at)::integer;
      if v_created_day >= 5 then
        v_prorata := greatest((30 - v_created_day + 1)::numeric / 30.0, 1.0 / 30.0);  -- clamp >= 1/30
        v_amount  := round(v_amount * v_prorata, 2);
        v_flags   := v_flags || '["new_station","pro_rata"]'::jsonb;
      else
        v_flags   := v_flags || '["new_station"]'::jsonb;
      end if;
    end if;

    -- surface stale box counts (decision: gerar-mês preview shows boxes_synced_at staleness)
    if r.boxes_synced_at is not null and r.boxes_synced_at < now() - interval '48 hours' then
      v_flags := v_flags || '["boxes_stale"]'::jsonb;
    end if;

    -- due date: LEAST(due_day, days_in_month) (M5 — day-31 / February safe)
    v_due := make_date(
      extract(year from v_month)::integer,
      extract(month from v_month)::integer,
      least(coalesce(r.due_day, v_days_in_month), v_days_in_month)
    );

    -- C1: pag:{cadastro_id}:{YYYY-MM}:aluguel converges with 2_Pagamentos rows
    v_dedupe := 'pag:' || coalesce(r.cadastro_id::text, r.id::text)
                || ':' || to_char(v_month, 'YYYY-MM') || ':aluguel';

    select id into v_ba from charging.billing_accounts
    where contract_id = r.id and account_type = 'rent';

    insert into charging.charges (
      billing_account_id, station_id, kind, competencia, competencia_source,
      amount, expected_amount, due_date, status, status_source, match_status,
      payment_method, banco, agencia, conta, chave_pix,
      source, dedupe_key, flags
    ) values (
      v_ba, r.station_id, 'aluguel', v_month, 'explicit',
      v_amount, v_amount, v_due, 'pendente', 'rpc',
      case when r.station_id is null then 'unmatched' else 'manually_matched' end,
      r.payment_method, r.banco, r.agencia, r.conta, r.chave_pix,
      'gerar_mes', v_dedupe, v_flags
    )
    on conflict (dedupe_key) do nothing
    returning id into v_charge_id;

    if v_charge_id is null then
      v_skipped := v_skipped + 1;                 -- already generated / in 2_Pagamentos
    else
      v_created := v_created + 1;
      if v_flags <> '[]'::jsonb then v_flagged := v_flagged + 1; end if;
      insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
      values ('charges', v_charge_id::text, 'created', v_email,
        jsonb_build_object('source', 'gerar_mes', 'competencia', to_char(v_month, 'YYYY-MM'),
          'amount', v_amount, 'flags', v_flags, 'contract_id', r.id));
    end if;
  end loop;

  -- batch summary event (gerar_mes is the sole multi-audit RPC — schema-writes §4)
  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('job', 'gerar_mes:' || to_char(v_month, 'YYYY-MM'), 'generated', v_email,
    jsonb_build_object('created', v_created, 'skipped_existing', v_skipped, 'flagged', v_flagged));

  return jsonb_build_object('created', v_created, 'skipped_existing', v_skipped, 'flagged', v_flagged);
end;
$$;

-- ── E) reclassify_charge (M9, H3) ───────────────────────────────────────────
-- Backs the email-classification review queue (and monthly alterations): a full
-- human patch over a charge — kind, competência, valores, payment fields, line
-- split, and account attribution. Every param is optional ("no change") except
-- p_kind. Attribution replicates normalize.ts:1441-1475:
--   aluguel                  → the cadastro's contract's rent billing_account
--   energia/aluguel_energia  → counterparty upsert (by cnpj, else exact name;
--                              kind 'outro' when new) + third_party account
--                              upsert keyed (counterparty, station, external_ref)
-- REFUSES paid / payment-bearing charges (unmatch first — M9).
-- p_codigo_boleto maps to charges.linha_digitavel (the boleto identity column).
create or replace function charging.reclassify_charge(
  p_charge_id         uuid,
  p_kind              charging.charge_kind,
  p_competencia       date,
  p_amount            numeric,
  p_expected_amount   numeric,
  p_lines             jsonb,
  p_cadastro_id       integer,
  p_station_id        integer,
  p_counterparty_name text,
  p_counterparty_cnpj text,
  p_payment_method    charging.payment_method,
  p_banco             text,
  p_agencia           text,
  p_conta             text,
  p_chave_pix         text,
  p_codigo_boleto     text,
  p_notes             text
)
returns uuid
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email          text := charging.jwt_email();
  v_old            charging.charges%rowtype;
  v_before         jsonb;
  v_after          jsonb;
  v_contract       charging.contracts%rowtype;
  v_ba             uuid;
  v_station        integer;
  v_cp_id          uuid;
  v_cnpj           text;
  v_name           text;
  v_line           jsonb;
  v_lines_replaced integer;
begin
  if not charging.is_vammo_user() then raise exception 'não autorizado'; end if;
  if p_kind is null then
    raise exception 'informe o tipo da cobrança (aluguel / energia / aluguel_energia)';
  end if;
  if p_amount is not null and p_amount <= 0 then
    raise exception 'o valor deve ser maior que zero';
  end if;

  select * into v_old from charging.charges where id = p_charge_id for update;
  if not found then raise exception 'cobrança % não encontrada', p_charge_id; end if;

  -- M9: human/payment state is immovable — reverse the payments first.
  if v_old.status = 'pago'
     or exists (select 1 from charging.payments where charge_id = p_charge_id) then
    raise exception 'remova os pagamentos antes de reclassificar';
  end if;

  v_before  := to_jsonb(v_old);
  v_ba      := v_old.billing_account_id;   -- default: attribution unchanged
  v_station := v_old.station_id;

  v_cnpj := nullif(regexp_replace(coalesce(p_counterparty_cnpj, ''), '[^0-9]', '', 'g'), '');
  v_name := nullif(btrim(coalesce(p_counterparty_name, '')), '');

  if p_station_id is not null
     and not exists (select 1 from charging.stations where id = p_station_id) then
    raise exception 'estação % não encontrada', p_station_id;
  end if;

  -- ── account attribution (normalize.ts branch, in SQL) ──
  if p_kind = 'aluguel' and p_cadastro_id is not null then
    -- pure rent → the cadastro's rent account; station comes from the contract
    select * into v_contract from charging.contracts where cadastro_id = p_cadastro_id;
    if not found then
      raise exception 'contrato com cadastro_id % não encontrado', p_cadastro_id;
    end if;

    select id into v_ba from charging.billing_accounts
    where contract_id = v_contract.id and account_type = 'rent';
    if v_ba is null then
      -- the sync normally creates this account; create it here so a manually
      -- reviewed charge is never blocked on a missing hub row
      insert into charging.billing_accounts
        (station_id, account_type, contract_id, match_status, matched_by_email, matched_at)
      values (v_contract.station_id, 'rent', v_contract.id,
              case when v_contract.station_id is null then 'unmatched' else 'manually_matched' end,
              v_email, now())
      returning id into v_ba;
    end if;
    v_station := v_contract.station_id;

  elsif p_kind in ('energia','aluguel_energia') and (v_cnpj is not null or v_name is not null) then
    -- energy-bearing → counterparty + third_party account (Hubees/DIA/Kitchen/…)
    if v_cnpj is not null and v_cnpj !~ '^[0-9]{11}$|^[0-9]{14}$' then
      raise exception 'CNPJ/CPF inválido — informe 11 ou 14 dígitos';
    end if;
    v_station := coalesce(p_station_id, v_old.station_id);

    -- counterparty upsert: identity by cnpj when given, else exact name
    if v_cnpj is not null then
      select id into v_cp_id from charging.counterparties where cnpj_cpf = v_cnpj;
    else
      select id into v_cp_id from charging.counterparties where name = v_name limit 1;
    end if;
    if v_cp_id is null then
      insert into charging.counterparties (name, cnpj_cpf, kind)
      values (coalesce(v_name, v_cnpj), v_cnpj, 'outro')
      returning id into v_cp_id;
    end if;

    -- third_party account upsert on (counterparty, station, external_ref='') —
    -- mirrors the ba_3p unique index; select-then-insert because the index is
    -- partial/expressional (and NULL station rows must still dedupe)
    select id into v_ba from charging.billing_accounts
    where account_type = 'third_party'
      and counterparty_id = v_cp_id
      and station_id is not distinct from v_station
      and coalesce(external_ref, '') = ''
    limit 1;
    if v_ba is null then
      insert into charging.billing_accounts
        (station_id, account_type, counterparty_id, match_status, matched_by_email, matched_at)
      values (v_station, 'third_party', v_cp_id,
              case when v_station is null then 'unmatched' else 'manually_matched' end,
              v_email, now())
      returning id into v_ba;
    elsif v_station is not null then
      update charging.billing_accounts
      set match_status = 'manually_matched', matched_by_email = v_email, matched_at = now()
      where id = v_ba;
    end if;
  end if;

  -- ── field patch: null params leave the column untouched ──
  update charging.charges
  set kind               = p_kind,
      competencia        = coalesce(p_competencia, competencia),
      competencia_source = case when p_competencia is not null
                                then 'manual'::charging.competencia_source
                                else competencia_source end,
      amount             = coalesce(p_amount, amount),
      expected_amount    = coalesce(p_expected_amount, expected_amount),
      payment_method     = coalesce(p_payment_method, payment_method),
      banco              = coalesce(p_banco, banco),
      agencia            = coalesce(p_agencia, agencia),
      conta              = coalesce(p_conta, conta),
      chave_pix          = coalesce(p_chave_pix, chave_pix),
      linha_digitavel    = coalesce(p_codigo_boleto, linha_digitavel),
      notes              = coalesce(p_notes, notes),
      billing_account_id = v_ba,
      station_id         = v_station,
      match_status       = 'manually_matched',   -- human reviewed — leaves the queue
      status_source      = 'rpc'                 -- sticky against any future re-sync
  where id = p_charge_id;

  -- ── line split replacement: [{line_kind, description, amount, competencia}] ──
  if p_lines is not null then
    if jsonb_typeof(p_lines) <> 'array' then
      raise exception 'p_lines deve ser um array json de linhas';
    end if;
    delete from charging.charge_lines where charge_id = p_charge_id;
    for v_line in select value from jsonb_array_elements(p_lines) loop
      if v_line ->> 'line_kind' is null then
        raise exception 'cada linha precisa de um tipo (line_kind)';
      end if;
      if v_line ->> 'amount' is null then
        raise exception 'cada linha precisa de um valor (amount)';
      end if;
      insert into charging.charge_lines
        (charge_id, line_kind, description, amount, competencia, competencia_source)
      values (
        p_charge_id,
        (v_line ->> 'line_kind')::charging.charge_line_kind,
        v_line ->> 'description',
        (v_line ->> 'amount')::numeric,
        (v_line ->> 'competencia')::date,
        case when v_line ->> 'competencia' is not null
             then 'manual'::charging.competencia_source end
      );
    end loop;
    v_lines_replaced := jsonb_array_length(p_lines);
  end if;

  select to_jsonb(c) into v_after from charging.charges c where c.id = p_charge_id;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('charges', p_charge_id::text, 'reclassified', v_email,
    jsonb_build_object('before', v_before, 'after', v_after, 'lines_replaced', v_lines_replaced));

  return p_charge_id;
end;
$$;

-- ── F) adjust_charge ─────────────────────────────────────────────────────────
-- Monthly alterations: pro-rata overrides, box/contract change effects, delayed
-- debt — a new amount and/or due date, always with a reason. Flags the charge
-- 'adjusted' (idempotent append into the jsonb string array).
create or replace function charging.adjust_charge(
  p_charge_id    uuid,
  p_new_amount   numeric,
  p_new_due_date date,
  p_reason       text
)
returns void
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email  text := charging.jwt_email();
  v_charge charging.charges%rowtype;
begin
  if not charging.is_vammo_user() then raise exception 'não autorizado'; end if;
  if p_new_amount is null and p_new_due_date is null then
    raise exception 'informe um novo valor e/ou uma nova data de vencimento';
  end if;
  if p_new_amount is not null and p_new_amount <= 0 then
    raise exception 'o novo valor deve ser maior que zero';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'informe o motivo do ajuste';
  end if;

  select * into v_charge from charging.charges where id = p_charge_id for update;
  if not found then raise exception 'cobrança % não encontrada', p_charge_id; end if;
  if v_charge.status = 'pago' then
    raise exception 'cobrança paga — use unmatch antes de ajustar';
  end if;

  update charging.charges
  set amount        = coalesce(p_new_amount, amount),
      due_date      = coalesce(p_new_due_date, due_date),
      flags         = case when flags @> '["adjusted"]'::jsonb
                           then flags
                           else flags || '["adjusted"]'::jsonb end,
      status_source = 'rpc'
  where id = p_charge_id;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('charges', p_charge_id::text, 'adjusted', v_email,
    jsonb_build_object('reason', btrim(p_reason),
      'old_amount', v_charge.amount,
      'new_amount', coalesce(p_new_amount, v_charge.amount),
      'old_due_date', v_charge.due_date,
      'new_due_date', coalesce(p_new_due_date, v_charge.due_date)));
end;
$$;

-- ── G) cancel_contract ───────────────────────────────────────────────────────
-- Contract cancellation: status → INACTIVE with a mandatory reason. gerar_mes
-- only bills ACTIVE contracts, so future months stop generating automatically;
-- already-generated charges are untouched (adjust/cancel them individually).
create or replace function charging.cancel_contract(p_contract_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email    text := charging.jwt_email();
  v_contract charging.contracts%rowtype;
begin
  if not charging.is_vammo_user() then raise exception 'não autorizado'; end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'informe o motivo do cancelamento';
  end if;

  select * into v_contract from charging.contracts where id = p_contract_id for update;
  if not found then raise exception 'contrato % não encontrado', p_contract_id; end if;
  if v_contract.status in ('INACTIVE','DECOMMISSIONED') then
    raise exception 'contrato já está % — nada a cancelar', v_contract.status;   -- double-submit guard
  end if;

  update charging.contracts set status = 'INACTIVE' where id = p_contract_id;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('contracts', p_contract_id::text, 'cancelled', v_email,
    jsonb_build_object('reason', btrim(p_reason), 'previous_status', v_contract.status::text));
end;
$$;

-- ── H) reject_account (M8) ───────────────────────────────────────────────────
-- The matching tool's "Não é Vammo": marks an unmatched/needs_review billing
-- account as rejected and clears its station. Allowed ONLY from unmatched /
-- needs_review (a manually_matched account must be re-assigned instead, via
-- assign_station_to_account). The account's existing charges are untouched.
create or replace function charging.reject_account(p_billing_account_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email text := charging.jwt_email();
  v_acct  charging.billing_accounts%rowtype;
begin
  if not charging.is_vammo_user() then raise exception 'não autorizado'; end if;

  select * into v_acct from charging.billing_accounts where id = p_billing_account_id for update;
  if not found then raise exception 'conta % não encontrada', p_billing_account_id; end if;
  if v_acct.match_status = 'rejected' then
    raise exception 'conta já foi rejeitada';   -- double-submit guard
  end if;
  if v_acct.match_status not in ('unmatched','needs_review') then
    raise exception 'apenas contas não vinculadas ou em revisão podem ser rejeitadas (atual: %)', v_acct.match_status;
  end if;

  update charging.billing_accounts
  set match_status = 'rejected', matched_by_email = v_email, matched_at = now(), station_id = null
  where id = p_billing_account_id;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('billing_accounts', p_billing_account_id::text, 'rejected', v_email,
    jsonb_build_object('reason', p_reason,
      'previous_station_id', v_acct.station_id,
      'previous_match_status', v_acct.match_status::text));
end;
$$;

-- ── I) EXECUTE privileges (migration-7 style) ────────────────────────────────
-- Belt-and-suspenders over migration 1's ALTER DEFAULT PRIVILEGES: nothing for
-- public/anon; authenticated calls in — the in-function is_vammo_user() gate is
-- the authorization (roles suspended, section A).
revoke execute on function charging.reclassify_charge(uuid, charging.charge_kind, date, numeric, numeric, jsonb, integer, integer, text, text, charging.payment_method, text, text, text, text, text, text) from public, anon;
grant execute on function charging.reclassify_charge(uuid, charging.charge_kind, date, numeric, numeric, jsonb, integer, integer, text, text, charging.payment_method, text, text, text, text, text, text) to authenticated;

revoke execute on function charging.adjust_charge(uuid, numeric, date, text) from public, anon;
grant execute on function charging.adjust_charge(uuid, numeric, date, text) to authenticated;

revoke execute on function charging.cancel_contract(uuid, text) from public, anon;
grant execute on function charging.cancel_contract(uuid, text) to authenticated;

revoke execute on function charging.reject_account(uuid, text) from public, anon;
grant execute on function charging.reject_account(uuid, text) to authenticated;
