-- Feature test-env #2 (Gabriel 2026-07-09): on a box mismatch the billed rent
-- must stay the AGREED contract value (valor_mensal); Metabase active_boxes
-- NEVER changes the billed amount — it only FLAGS box drift for human review.
--
-- Re-issues gerar_mes with ONLY the pricing branch changed: por_box and
-- por_box_minimo now bill valor_mensal (like fixo), and set boxes_mismatch /
-- no_metabase_data purely as informational flags. valor_por_box / min_box /
-- active_boxes no longer drive the amount. Everything else (pro-rata via
-- station.source_created_at, boxes_stale, due_date, dedupe/idempotency, audit,
-- return payload) is preserved verbatim from migration 11.

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

    -- pricing per contract_type. Amount is ALWAYS the agreed valor_mensal;
    -- Metabase active_boxes never changes the billed amount, it only FLAGS box
    -- drift for human review (Gabriel 2026-07-09). So por_box / por_box_minimo
    -- bill valor_mensal like fixo, plus the box flags.
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

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('job', 'gerar_mes:' || to_char(v_month, 'YYYY-MM'), 'generated', v_email,
    jsonb_build_object('created', v_created, 'skipped_existing', v_skipped, 'flagged', v_flagged));

  return jsonb_build_object('created', v_created, 'skipped_existing', v_skipped, 'flagged', v_flagged);
end;
$$;
