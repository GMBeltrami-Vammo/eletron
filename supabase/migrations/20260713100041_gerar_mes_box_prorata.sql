-- Box-day pro-rata (decisão #50). Re-issues gerar_mes adding a box-day pro-rata
-- for box-priced contracts (por_box / por_box_minimo): the AGREED valor_mensal
-- is scaled by (Σ box-days)/(30 × N), where N = boxes present in the month and
-- each present box contributes its active days (box up before/through the month
-- = 30; activated on day D = 30−D+1, cap 30). N counts only PRESENT boxes, so a
-- steady-state count shortfall bills the full valor_mensal + boxes_mismatch flag
-- ("sempre use o valor do contrato"); only the temporal ramp-up reduces it.
-- Mirrors components/pagamentos/box-prorata.ts branch-for-branch, both reading
-- the BRT dates the sync stored in stations.box_activations (timezone-free).
--
-- Supersedes the station-creation (source_created_at) pro-rata for box-priced
-- contracts WHEN box data exists; fixo (and box-data-less por_box) keep it.
-- Flags are append-only (never lost); the box-day basis is recorded on
-- charges.raw for traceability; every charge still audited.
create or replace function charging.gerar_mes(p_competencia date)
returns jsonb
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email            text := charging.jwt_email();
  v_month            date := date_trunc('month', p_competencia)::date;
  v_days_in_month    integer := extract(day from (v_month + interval '1 month' - interval '1 day'))::integer;
  v_created          integer := 0;
  v_skipped          integer := 0;
  v_flagged          integer := 0;
  r                  record;
  v_amount           numeric;
  v_boxes            integer;
  v_flags            jsonb;
  v_dedupe           text;
  v_due              date;
  v_ba               uuid;
  v_charge_id        uuid;
  v_prorata          numeric;
  v_created_day      integer;
  v_used_box_prorata boolean;
  v_present          integer;
  v_boxdays          integer;
  v_box_basis        jsonb;
begin
  if not charging.is_vammo_user() then raise exception 'not authorized'; end if;
  if not charging.is_operator() then raise exception 'operator role required'; end if;

  for r in
    select c.*, s.active_boxes, s.boxes_synced_at, s.source_created_at, s.box_activations
    from charging.contracts c
    left join charging.stations s on s.id = c.station_id
    where c.status = 'ACTIVE'
      and c.payment_method in ('pix','transferencia')
      and coalesce(c.rent_manual, false) = false   -- M7: manual-rent contracts are reminded, never generated
  loop
    v_flags            := '[]'::jsonb;
    v_boxes            := r.active_boxes;
    v_charge_id        := null;
    v_used_box_prorata := false;
    v_box_basis        := null;

    -- pricing per contract_type. Amount is ALWAYS the agreed valor_mensal;
    -- Metabase active_boxes never changes the billed amount, it only FLAGS box
    -- drift (Gabriel 2026-07-09, decisão #36).
    if r.contract_type = 'fixo' then
      v_amount := r.valor_mensal;
    elsif r.contract_type in ('por_box', 'por_box_minimo') then
      v_amount := r.valor_mensal;
      if v_boxes is null then
        v_flags := v_flags || '["no_metabase_data"]'::jsonb;
      elsif v_boxes <> r.box_count then
        v_flags := v_flags || '["boxes_mismatch"]'::jsonb;
      end if;
    else
      continue;   -- gratuito / casa_vammo — nothing to bill
    end if;

    if v_amount is null or v_amount <= 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- new_station (informational): station created within the competência month.
    if r.source_created_at is not null
       and date_trunc('month', r.source_created_at)::date = v_month then
      v_flags := v_flags || '["new_station"]'::jsonb;
    end if;

    -- box-day pro-rata (decisão #50) — box-priced contracts with box activation
    -- data. Base = valor_mensal; only the ramp-up (fraction < 1) reduces it.
    if r.contract_type in ('por_box', 'por_box_minimo')
       and r.box_activations is not null
       and jsonb_typeof(r.box_activations) = 'array'
       and jsonb_array_length(r.box_activations) > 0 then
      select
        count(*) filter (where d is null or d < (v_month + interval '1 month')::date),
        coalesce(sum(
          case
            when d is null then 30
            when d >= (v_month + interval '1 month')::date then 0
            when d < v_month then 30
            else greatest(0, least(30, 30 - extract(day from d)::integer + 1))
          end
        ), 0)
      into v_present, v_boxdays
      from (
        select (nullif(elem, ''))::date as d
        from jsonb_array_elements_text(r.box_activations) as elem
      ) boxes;

      if coalesce(v_present, 0) > 0 then
        v_prorata := least(1.0, v_boxdays::numeric / (30.0 * v_present));
        if v_prorata < 1.0 then
          v_amount := round(v_amount * v_prorata, 2);
          v_flags  := v_flags || '["pro_rata"]'::jsonb;
        end if;
        v_box_basis := jsonb_build_object(
          'box_prorata',
          jsonb_build_object('box_days', v_boxdays, 'present_boxes', v_present,
                             'fraction', round(v_prorata, 4))
        );
        v_used_box_prorata := true;
      end if;
    end if;

    -- station-creation pro-rata (M5) — fixo, or por_box without box data. Only
    -- when the box-day pro-rata did NOT already apply.
    if not v_used_box_prorata
       and r.source_created_at is not null
       and date_trunc('month', r.source_created_at)::date = v_month then
      v_created_day := extract(day from r.source_created_at)::integer;
      if v_created_day >= 5 then
        v_prorata := greatest((30 - v_created_day + 1)::numeric / 30.0, 1.0 / 30.0);
        v_amount  := round(v_amount * v_prorata, 2);
        v_flags   := v_flags || '["pro_rata"]'::jsonb;
      end if;
    end if;

    -- surface stale box counts
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
      source, dedupe_key, flags, raw
    ) values (
      v_ba, r.station_id, 'aluguel', v_month, 'explicit',
      v_amount, v_amount, v_due, 'pendente', 'rpc',
      (case when r.station_id is null then 'unmatched' else 'manually_matched' end)::charging.match_status,
      r.payment_method, r.banco, r.agencia, r.conta, r.chave_pix,
      'gerar_mes', v_dedupe, v_flags, v_box_basis
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
          'amount', v_amount, 'flags', v_flags, 'contract_id', r.id, 'box_prorata', v_box_basis));
    end if;
  end loop;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('job', 'gerar_mes:' || to_char(v_month, 'YYYY-MM'), 'generated', v_email,
    jsonb_build_object('created', v_created, 'skipped_existing', v_skipped, 'flagged', v_flagged));

  return jsonb_build_object('created', v_created, 'skipped_existing', v_skipped, 'flagged', v_flagged);
end;
$$;
