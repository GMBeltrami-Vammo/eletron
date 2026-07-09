-- Eletron Phase 2.5 — migration 10: reclassify_charge dedupe_key convergence fix.
-- Review finding (C1): reclassifying an email charge to aluguel + cadastro left
-- its dedupe_key as 'email:…', so a later gerar_mes inserted a SECOND rent
-- charge for the same cadastro/competência (ON CONFLICT never fired). Fix: when
-- the reclassification lands as pure rent with a cadastro + competência, adopt
-- the canonical 'pag:{cadastro}:{YYYY-MM}:aluguel' key so gerar_mes converges
-- (DO NOTHING). If another charge already holds that key, REFUSE with a pt-BR
-- message so the human resolves the existing one instead of double-billing.
-- Only the dedupe_key handling is added; everything else is byte-identical to
-- migration 8's reclassify_charge.

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
