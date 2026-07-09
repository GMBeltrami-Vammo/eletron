-- Eletron Phase 2.5 — migration 11: plpgsql enum-cast fix.
-- Live-testing reclassify_charge surfaced a latent bug: a CASE returning string
-- literals is typed `text` in plpgsql, which does NOT implicitly cast to an enum
-- column, so the CASE assignments to match_status / competencia_source failed at
-- runtime. These RPC paths were never exercised (DB empty pre-cutover). Re-issues
-- create_manual_bill, gerar_mes and reclassify_charge (the latter also carries
-- migration 10's dedupe-convergence fix) with explicit ::charging.<enum> casts.
-- No other logic changes.

-- ── create_manual_bill ──
create or replace function charging.create_manual_bill(
  p_billing_account_id uuid,
  p_competencia        date,
  p_due_date           date,
  p_amount             numeric,
  p_document_id        uuid,
  p_nf                 text,
  p_energy_details     jsonb,
  p_notes              text
)
returns uuid
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email  text := charging.jwt_email();
  v_acct   charging.billing_accounts%rowtype;
  v_dedupe text;
  v_id     uuid;
begin
  if not charging.is_vammo_user() then raise exception 'not authorized'; end if;
  if not charging.is_operator() then raise exception 'operator role required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be > 0'; end if;
  if p_due_date is null then raise exception 'due_date is required'; end if;

  select * into v_acct from charging.billing_accounts where id = p_billing_account_id for update;
  if not found then raise exception 'billing account % not found', p_billing_account_id; end if;
  if v_acct.account_type not in ('energy_enel','energy_edp') then
    raise exception 'manual bills are only for energy_enel / energy_edp accounts';
  end if;

  -- C1: reuse the scraper dedupe recipe so a later scraper import / sheet
  -- write-back of this row converges on THIS charge instead of duplicating it.
  if v_acct.account_type = 'energy_enel' then
    if v_acct.enel_id is null then raise exception 'account has no enel_id'; end if;
    v_dedupe := 'enel:' || v_acct.enel_id || ':' || to_char(p_due_date, 'YYYY-MM-DD');
  else
    if v_acct.edp_uc is null then raise exception 'account has no edp_uc'; end if;
    v_dedupe := 'edp:' || v_acct.edp_uc || ':' || to_char(p_due_date, 'YYYY-MM-DD');
  end if;

  -- one charge per logical bill: refuse if the scraper (or a prior manual entry)
  -- already produced it. Doubles as the double-submit guard.
  if exists (select 1 from charging.charges where dedupe_key = v_dedupe) then
    raise exception 'a charge already exists for this account and due date (%)', v_dedupe;
  end if;

  insert into charging.charges (
    billing_account_id, station_id, kind, competencia, competencia_source,
    amount, expected_amount, due_date, status, status_source, match_status,
    source, source_document_id, nota_fiscal, issuer_cnpj, dedupe_key, notes
  ) values (
    p_billing_account_id, v_acct.station_id, 'energia', p_competencia,
    (case when p_competencia is null then 'unknown' else 'manual' end)::charging.competencia_source,
    p_amount, p_amount, p_due_date, 'pendente', 'rpc',
    (case when v_acct.station_id is null then 'unmatched' else 'manually_matched' end)::charging.match_status,
    'manual', p_document_id, coalesce(p_nf, p_energy_details ->> 'nf'),
    p_energy_details ->> 'issuer_cnpj', v_dedupe, p_notes
  )
  returning id into v_id;

  insert into charging.charge_energy_details (
    charge_id, nf, classificacao, modalidade, tipo_fornecimento,
    tusd_kwh, tusd_amount, te_kwh, te_amount, cip, sub_faturamento, total,
    auto_debit_registration, fatura_drive_url
  ) values (
    v_id,
    coalesce(p_nf, p_energy_details ->> 'nf'),
    p_energy_details ->> 'classificacao',
    p_energy_details ->> 'modalidade',
    p_energy_details ->> 'tipo_fornecimento',
    (p_energy_details ->> 'tusd_kwh')::numeric,
    (p_energy_details ->> 'tusd_amount')::numeric,
    (p_energy_details ->> 'te_kwh')::numeric,
    (p_energy_details ->> 'te_amount')::numeric,
    (p_energy_details ->> 'cip')::numeric,
    (p_energy_details ->> 'sub_faturamento')::numeric,
    coalesce((p_energy_details ->> 'total')::numeric, p_amount),
    p_energy_details ->> 'auto_debit_registration',
    p_energy_details ->> 'fatura_drive_url'
  );

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('charges', v_id::text, 'created', v_email,
    jsonb_build_object('source', 'manual', 'dedupe_key', v_dedupe, 'amount', p_amount,
      'billing_account_id', p_billing_account_id, 'document_id', p_document_id));
  return v_id;
end;
$$;

-- ── gerar_mes ──
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
      (case when r.station_id is null then 'unmatched' else 'manually_matched' end)::charging.match_status,
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

-- ── reclassify_charge ──
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
  v_comp           date;
  v_new_dedupe     text;
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
      insert into charging.billing_accounts
        (station_id, account_type, contract_id, match_status, matched_by_email, matched_at)
      values (v_contract.station_id, 'rent', v_contract.id,
              (case when v_contract.station_id is null then 'unmatched' else 'manually_matched' end)::charging.match_status,
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
              (case when v_station is null then 'unmatched' else 'manually_matched' end)::charging.match_status,
              v_email, now())
      returning id into v_ba;
    elsif v_station is not null then
      update charging.billing_accounts
      set match_status = 'manually_matched', matched_by_email = v_email, matched_at = now()
      where id = v_ba;
    end if;
  end if;

  -- ── C1 dedupe convergence (review fix) ──
  -- Pure rent with a cadastro + competência adopts the gerar_mes recipe so the
  -- two creators converge on ONE charge. Refuse on collision (don't double-bill).
  v_comp := coalesce(p_competencia, v_old.competencia);
  if p_kind = 'aluguel' and p_cadastro_id is not null and v_comp is not null then
    v_new_dedupe := 'pag:' || p_cadastro_id || ':' || to_char(v_comp, 'YYYY-MM') || ':aluguel';
    if v_new_dedupe = v_old.dedupe_key then
      v_new_dedupe := null;  -- already canonical — no change
    elsif exists (
      select 1 from charging.charges
      where dedupe_key = v_new_dedupe and id <> p_charge_id
    ) then
      raise exception
        'já existe uma cobrança de aluguel para o cadastro % na competência % — resolva-a antes de reclassificar',
        p_cadastro_id, to_char(v_comp, 'YYYY-MM');
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
      dedupe_key         = coalesce(v_new_dedupe, dedupe_key),  -- C1 convergence
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

