-- Inactivation pro-rata (decisão #51). gerar_mes now also bills the LAST month
-- of a contract inactivated mid-month: it includes contracts made INACTIVE
-- within the competência (via inactivated_on) and pro-ratas valor_mensal × D/30
-- (active days 1..D). This terminal pro-rata OVERRIDES the box-day and
-- station-creation pro-ratas (the month it ends is billed for the days it ran).
-- Everything else (box pro-rata #50, box-mismatch flags #36, append-only flags,
-- raw basis, audit, dedupe/idempotency) preserved from migration 41.
-- NB: idempotent — if the full month was already generated before inactivation,
-- on-conflict-do-nothing keeps it (human adjusts via adjust_charge).
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
  v_inact_day        integer;
begin
  if not charging.is_vammo_user() then raise exception 'not authorized'; end if;
  if not charging.is_operator() then raise exception 'operator role required'; end if;

  for r in
    select c.*, s.active_boxes, s.boxes_synced_at, s.source_created_at, s.box_activations
    from charging.contracts c
    left join charging.stations s on s.id = c.station_id
    where (
        c.status = 'ACTIVE'
        or (c.status = 'INACTIVE' and c.inactivated_on is not null
            and date_trunc('month', c.inactivated_on)::date = v_month)
      )
      and c.payment_method in ('pix','transferencia')
      and coalesce(c.rent_manual, false) = false   -- M7: manual-rent contracts are reminded, never generated
  loop
    v_flags            := '[]'::jsonb;
    v_boxes            := r.active_boxes;
    v_charge_id        := null;
    v_used_box_prorata := false;
    v_box_basis        := null;

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

    if r.status = 'INACTIVE' and r.inactivated_on is not null
       and date_trunc('month', r.inactivated_on)::date = v_month then
      -- terminal: last month billed for days 1..D (valor_mensal × D/30).
      v_inact_day := extract(day from r.inactivated_on)::integer;
      v_prorata := least(v_inact_day::numeric / 30.0, 1.0);
      v_amount := round(v_amount * v_prorata, 2);
      v_flags := v_flags || '["encerrado"]'::jsonb;
      if v_prorata < 1.0 then v_flags := v_flags || '["pro_rata"]'::jsonb; end if;
    else
      -- new_station (informational): station created within the competência month.
      if r.source_created_at is not null
         and date_trunc('month', r.source_created_at)::date = v_month then
        v_flags := v_flags || '["new_station"]'::jsonb;
      end if;

      -- box-day pro-rata (#50) — box-priced contracts with box activation data.
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

      -- station-creation pro-rata (M5) — fixo, or por_box without box data.
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
    end if;

    if r.boxes_synced_at is not null and r.boxes_synced_at < now() - interval '48 hours' then
      v_flags := v_flags || '["boxes_stale"]'::jsonb;
    end if;

    v_due := make_date(
      extract(year from v_month)::integer,
      extract(month from v_month)::integer,
      least(coalesce(r.due_day, v_days_in_month), v_days_in_month)
    );

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
      v_skipped := v_skipped + 1;
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
