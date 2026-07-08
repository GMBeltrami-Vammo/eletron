-- Eletron Phase 2 — migration 3: charging schema write path (RPCs).
-- claim_job (service_role only) + 15 SECURITY DEFINER RPCs.
-- Every RPC follows the goBuy approve_purchase_request guard template:
--   is_vammo_user() gate → role check (is_operator/is_admin) → SELECT … FOR UPDATE
--   → state-machine guard → double-submit guard (existence / status / GET
--   DIAGNOSTICS) → mutate → exactly ONE audit_events insert in-txn.
-- gerar_mes is the sole batch RPC: one 'created' audit per charge + one summary
-- (per schema-writes §4). claim_job writes no audit (the job_runs row is the record).
-- All functions: SET search_path TO 'charging'. Grants at the bottom: EXECUTE
-- revoked from public/anon, granted to authenticated (claim_job to service_role only).

-- ── claim_job (service_role only — job lease) ───────────────────────────────
create or replace function charging.claim_job(p_job_name text, p_lease_seconds integer default 600)
returns uuid
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_id uuid;
begin
  -- SECURITY DEFINER runs as the owner, so current_user is NOT the caller;
  -- authorize the caller via the request JWT role and the session role instead.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' and session_user <> 'service_role' then
    raise exception 'claim_job is service_role only';
  end if;

  -- refuse if another run of this job is still holding a live lease
  if exists (
    select 1 from charging.job_runs
    where job_name = p_job_name
      and status = 'running'
      and started_at > now() - make_interval(secs => p_lease_seconds)
  ) then
    return null;   -- locked
  end if;

  insert into charging.job_runs (job_name, trigger, status, started_at)
  values (p_job_name, 'cron', 'running', now())
  returning id into v_id;
  return v_id;
end;
$$;

-- ── create_meter_reading ────────────────────────────────────────────────────
create or replace function charging.create_meter_reading(
  p_station_id        integer,
  p_billing_account_id uuid,
  p_name              text,
  p_reading_date      date,
  p_reading_kwh       numeric,
  p_photo_document_id uuid,
  p_notes             text
)
returns uuid
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email text := charging.jwt_email();
  v_doc   charging.documents%rowtype;
  v_id    uuid;
begin
  if not charging.is_vammo_user() then raise exception 'not authorized'; end if;
  if not charging.is_operator() then raise exception 'operator role required'; end if;
  if p_name is null or length(btrim(p_name)) = 0 then raise exception 'name is required'; end if;   -- C3
  if p_reading_kwh is null or p_reading_kwh < 0 then raise exception 'reading_kwh must be >= 0'; end if;

  if not exists (select 1 from charging.stations where id = p_station_id) then
    raise exception 'station % not found', p_station_id;
  end if;
  if p_billing_account_id is not null
     and not exists (select 1 from charging.billing_accounts where id = p_billing_account_id) then
    raise exception 'billing account % not found', p_billing_account_id;
  end if;

  -- photo must exist, be a meter photo, and not already back a live reading
  select * into v_doc from charging.documents where id = p_photo_document_id for update;
  if not found then raise exception 'photo document % not found', p_photo_document_id; end if;
  if v_doc.kind <> 'foto_medidor' then raise exception 'document % is not a meter photo', p_photo_document_id; end if;
  if exists (
    select 1 from charging.meter_readings
    where photo_document_id = p_photo_document_id and not is_superseded
  ) then
    raise exception 'photo % is already used by a reading', p_photo_document_id;
  end if;

  insert into charging.meter_readings (
    station_id, billing_account_id, name, reading_date, competencia,
    reading_kwh, photo_document_id, read_by_email, notes,
    photo_taken_at, photo_gps, photo_warnings
  ) values (
    p_station_id, p_billing_account_id, btrim(p_name), p_reading_date,
    date_trunc('month', p_reading_date)::date,
    p_reading_kwh, p_photo_document_id, v_email, p_notes,
    (v_doc.exif ->> 'taken_at')::timestamptz,
    v_doc.exif -> 'gps',
    case when v_doc.exif ? 'warnings'
         then array(select jsonb_array_elements_text(v_doc.exif -> 'warnings')) end
  )
  returning id into v_id;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('meter_readings', v_id::text, 'reading_registered', v_email,
    jsonb_build_object('station_id', p_station_id, 'reading_kwh', p_reading_kwh,
      'photo_document_id', p_photo_document_id, 'photo_sha256', v_doc.content_hash,
      'photo_warnings', v_doc.exif -> 'warnings'));
  return v_id;
end;
$$;

-- ── correct_meter_reading (append a corrected row, supersede the old) ───────
create or replace function charging.correct_meter_reading(
  p_reading_id        uuid,
  p_reading_date      date,
  p_reading_kwh       numeric,
  p_photo_document_id uuid,
  p_name              text,
  p_notes             text
)
returns uuid
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email text := charging.jwt_email();
  v_old   charging.meter_readings%rowtype;
  v_doc   charging.documents%rowtype;
  v_id    uuid;
begin
  if not charging.is_vammo_user() then raise exception 'not authorized'; end if;
  if not charging.is_operator() then raise exception 'operator role required'; end if;
  if p_reading_kwh is null or p_reading_kwh < 0 then raise exception 'reading_kwh must be >= 0'; end if;

  select * into v_old from charging.meter_readings where id = p_reading_id for update;
  if not found then raise exception 'reading % not found', p_reading_id; end if;
  if v_old.is_superseded then
    raise exception 'reading % was already corrected', p_reading_id;   -- double-submit guard
  end if;

  select * into v_doc from charging.documents where id = p_photo_document_id;
  if not found then raise exception 'photo document % not found', p_photo_document_id; end if;
  if v_doc.kind <> 'foto_medidor' then raise exception 'document % is not a meter photo', p_photo_document_id; end if;

  -- supersede the old reading first so its photo slot is free for possible reuse
  update charging.meter_readings set is_superseded = true where id = p_reading_id;

  if exists (
    select 1 from charging.meter_readings
    where photo_document_id = p_photo_document_id and not is_superseded
  ) then
    raise exception 'photo % is already used by a live reading', p_photo_document_id;
  end if;

  insert into charging.meter_readings (
    station_id, billing_account_id, name, reading_date, competencia,
    reading_kwh, photo_document_id, read_by_email, notes, replaces_reading_id,
    photo_taken_at, photo_gps, photo_warnings
  ) values (
    v_old.station_id, v_old.billing_account_id,
    coalesce(nullif(btrim(p_name), ''), v_old.name),
    p_reading_date, date_trunc('month', p_reading_date)::date,
    p_reading_kwh, p_photo_document_id, v_email, p_notes, p_reading_id,
    (v_doc.exif ->> 'taken_at')::timestamptz,
    v_doc.exif -> 'gps',
    case when v_doc.exif ? 'warnings'
         then array(select jsonb_array_elements_text(v_doc.exif -> 'warnings')) end
  )
  returning id into v_id;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('meter_readings', v_id::text, 'reading_corrected', v_email,
    jsonb_build_object('replaces_reading_id', p_reading_id,
      'old_reading_kwh', v_old.reading_kwh, 'new_reading_kwh', p_reading_kwh));
  return v_id;
end;
$$;

-- ── create_manual_bill (energy accounts only; reuses the scraper dedupe key) ─
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
    case when p_competencia is null then 'unknown' else 'manual' end,
    p_amount, p_amount, p_due_date, 'pendente', 'rpc',
    case when v_acct.station_id is null then 'unmatched' else 'manually_matched' end,
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

-- ── record_payment (human payment record; may flip to pago when covered) ────
create or replace function charging.record_payment(
  p_charge_id  uuid,
  p_receipt_id uuid,
  p_amount     numeric,
  p_paid_at    date,
  p_method     charging.payment_method
)
returns uuid
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email      text := charging.jwt_email();
  v_charge     charging.charges%rowtype;
  v_tol        numeric := 0.01;
  v_paid_total numeric;
  v_payment_id uuid;
  v_flipped    boolean := false;
begin
  if not charging.is_vammo_user() then raise exception 'not authorized'; end if;
  if not charging.is_operator() then raise exception 'operator role required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be > 0'; end if;

  select * into v_charge from charging.charges where id = p_charge_id for update;
  if not found then raise exception 'charge % not found', p_charge_id; end if;
  if v_charge.status in ('cancelada','nao_aplicavel') then
    raise exception 'cannot record a payment on a % charge', v_charge.status;
  end if;

  if p_receipt_id is not null then
    perform 1 from charging.receipts where id = p_receipt_id for update;
    if not found then raise exception 'receipt % not found', p_receipt_id; end if;
    -- unique(charge_id, receipt_id) is the double-submit guard for receipted payments
    if exists (select 1 from charging.payments where charge_id = p_charge_id and receipt_id = p_receipt_id) then
      raise exception 'this receipt is already recorded against the charge';
    end if;
  else
    -- M4: receiptless double-submit guard (the unique index cannot see NULL receipts)
    if exists (
      select 1 from charging.payments
      where charge_id = p_charge_id and receipt_id is null
        and amount = p_amount and paid_at is not distinct from p_paid_at
    ) then
      raise exception 'an identical receiptless payment was already recorded';
    end if;
  end if;

  insert into charging.payments (charge_id, receipt_id, amount, paid_at, method, source, created_by_email)
  values (p_charge_id, p_receipt_id, p_amount, p_paid_at, p_method, 'manual', v_email)
  returning id into v_payment_id;

  if v_charge.billing_account_id is not null then
    select coalesce(cp.value_tolerance, 0.01) into v_tol
    from charging.billing_accounts ba
    left join charging.counterparties cp on cp.id = ba.counterparty_id
    where ba.id = v_charge.billing_account_id;
  end if;

  select coalesce(sum(amount), 0) into v_paid_total from charging.payments where charge_id = p_charge_id;

  if v_charge.amount is not null and v_paid_total >= v_charge.amount - v_tol then
    update charging.charges set status = 'pago', status_source = 'rpc' where id = p_charge_id;
    v_flipped := true;
  end if;

  if p_receipt_id is not null then
    update charging.receipts
    set match_status = 'manually_matched', matched_by_email = v_email, matched_at = now()
    where id = p_receipt_id;
  end if;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('charges', p_charge_id::text, 'payment_recorded', v_email,
    jsonb_build_object('payment_id', v_payment_id, 'receipt_id', p_receipt_id, 'amount', p_amount,
      'paid_total', v_paid_total, 'flipped_to_paid', v_flipped,
      'new_status', case when v_flipped then 'pago' else v_charge.status::text end));
  return v_payment_id;
end;
$$;

-- ── unmatch_payment (delete a payment; audit is the tombstone) ──────────────
create or replace function charging.unmatch_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email      text := charging.jwt_email();
  v_pay        charging.payments%rowtype;
  v_charge     charging.charges%rowtype;
  v_tol        numeric := 0.01;
  v_paid_total numeric;
begin
  if not charging.is_vammo_user() then raise exception 'not authorized'; end if;
  if not charging.is_operator() then raise exception 'operator role required'; end if;

  select * into v_pay from charging.payments where id = p_payment_id for update;
  if not found then raise exception 'payment % not found', p_payment_id; end if;

  select * into v_charge from charging.charges where id = v_pay.charge_id for update;

  delete from charging.payments where id = p_payment_id;

  -- free the receipt if nothing else references it
  if v_pay.receipt_id is not null
     and not exists (select 1 from charging.payments where receipt_id = v_pay.receipt_id) then
    update charging.receipts
    set match_status = 'unmatched', matched_by_email = null, matched_at = null
    where id = v_pay.receipt_id;
  end if;

  -- recompute coverage; if it was paid and is now under-covered, walk it back
  if v_charge.billing_account_id is not null then
    select coalesce(cp.value_tolerance, 0.01) into v_tol
    from charging.billing_accounts ba
    left join charging.counterparties cp on cp.id = ba.counterparty_id
    where ba.id = v_charge.billing_account_id;
  end if;
  select coalesce(sum(amount), 0) into v_paid_total from charging.payments where charge_id = v_charge.id;

  if v_charge.status = 'pago' and (v_charge.amount is null or v_paid_total < v_charge.amount - v_tol) then
    update charging.charges
    set status = case when v_charge.due_date is not null and v_charge.due_date < current_date
                      then 'atrasado' else 'pendente' end,
        status_source = 'rpc'
    where id = v_charge.id;
  end if;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('payments', p_payment_id::text, 'unmatched', v_email,
    jsonb_build_object('reason', p_reason, 'charge_id', v_charge.id, 'deleted_payment', to_jsonb(v_pay)));
end;
$$;

-- ── confirm_charge (THE human gate over auto-matched 'conciliado' charges) ──
create or replace function charging.confirm_charge(p_charge_id uuid)
returns void
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email      text := charging.jwt_email();
  v_charge     charging.charges%rowtype;
  v_tol        numeric := 0.01;
  v_paid_total numeric;
  v_count      integer;
  v_ids        uuid[];
begin
  if not charging.is_vammo_user() then raise exception 'not authorized'; end if;
  if not charging.is_operator() then raise exception 'operator role required'; end if;

  select * into v_charge from charging.charges where id = p_charge_id for update;
  if not found then raise exception 'charge % not found', p_charge_id; end if;
  if v_charge.status = 'pago' then
    raise exception 'charge is already paid';   -- double-submit guard
  end if;

  select count(*), coalesce(sum(amount), 0), array_agg(id)
    into v_count, v_paid_total, v_ids
  from charging.payments where charge_id = p_charge_id;
  if v_count = 0 then raise exception 'charge has no payments to confirm'; end if;

  if v_charge.billing_account_id is not null then
    select coalesce(cp.value_tolerance, 0.01) into v_tol
    from charging.billing_accounts ba
    left join charging.counterparties cp on cp.id = ba.counterparty_id
    where ba.id = v_charge.billing_account_id;
  end if;
  if v_charge.amount is null or v_paid_total < v_charge.amount - v_tol then
    raise exception 'payments do not cover the charge amount';
  end if;

  update charging.charges set status = 'pago', status_source = 'rpc' where id = p_charge_id;

  -- named human in the audit trail satisfies the decision #8 "no auto-pago" rule
  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('charges', p_charge_id::text, 'confirmed_paid', v_email,
    jsonb_build_object('payment_ids', to_jsonb(v_ids), 'paid_total', v_paid_total,
      'prev_status', v_charge.status::text));
end;
$$;

-- ── update_charge_status (transition allow-list; never →pago) ───────────────
create or replace function charging.update_charge_status(
  p_charge_id  uuid,
  p_new_status charging.charge_status,
  p_reason     text
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
  if not charging.is_vammo_user() then raise exception 'not authorized'; end if;
  if not charging.is_operator() then raise exception 'operator role required'; end if;

  select * into v_charge from charging.charges where id = p_charge_id for update;
  if not found then raise exception 'charge % not found', p_charge_id; end if;

  -- transition allow-list (L5): 'pago' is reachable only through confirm_charge /
  -- record_payment; 'conciliado' is set only by the matcher and exits only through
  -- confirm_charge / unmatch_payment.
  if p_new_status = 'pago' then
    raise exception 'use confirm_charge or record_payment to mark a charge paid';
  end if;
  if p_new_status = 'conciliado' then
    raise exception 'conciliado is set by the matcher, not by update_charge_status';
  end if;
  if v_charge.status = 'conciliado' then
    raise exception 'a conciliado charge exits only via confirm_charge or unmatch_payment';
  end if;
  if v_charge.status = 'pago' then
    raise exception 'a paid charge is reversed only via unmatch_payment';
  end if;
  if p_new_status = 'cancelada' and not charging.is_admin() then
    raise exception 'admin role required to cancel a charge';
  end if;
  if v_charge.status = p_new_status then
    raise exception 'charge is already %', p_new_status;   -- double-submit guard
  end if;

  update charging.charges set status = p_new_status, status_source = 'rpc' where id = p_charge_id;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('charges', p_charge_id::text, 'status_changed', v_email,
    jsonb_build_object('from', v_charge.status::text, 'to', p_new_status::text, 'reason', p_reason));
end;
$$;

-- ── gerar_mes (port of A5 — generate the month's rent charges) ──────────────
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

-- ── acknowledge_alert / resolve_alert / mute_alert ──────────────────────────
create or replace function charging.acknowledge_alert(p_alert_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email text := charging.jwt_email();
  v_alert charging.alerts%rowtype;
begin
  if not charging.is_vammo_user() then raise exception 'not authorized'; end if;
  if not charging.is_operator() then raise exception 'operator role required'; end if;

  select * into v_alert from charging.alerts where id = p_alert_id for update;
  if not found then raise exception 'alert % not found', p_alert_id; end if;
  if v_alert.status <> 'open' then
    raise exception 'only open alerts can be acknowledged (current: %)', v_alert.status;
  end if;

  update charging.alerts
  set status = 'acknowledged', acknowledged_by_email = v_email, acknowledged_at = now()
  where id = p_alert_id;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('alerts', p_alert_id::text, 'acknowledged', v_email, jsonb_build_object('note', p_note));
end;
$$;

create or replace function charging.resolve_alert(p_alert_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email text := charging.jwt_email();
  v_alert charging.alerts%rowtype;
begin
  if not charging.is_vammo_user() then raise exception 'not authorized'; end if;
  if not charging.is_operator() then raise exception 'operator role required'; end if;

  select * into v_alert from charging.alerts where id = p_alert_id for update;
  if not found then raise exception 'alert % not found', p_alert_id; end if;
  if v_alert.status not in ('open','acknowledged') then
    raise exception 'only open/acknowledged alerts can be resolved (current: %)', v_alert.status;
  end if;

  update charging.alerts
  set status = 'resolved', resolved_by_email = v_email, resolved_at = now()
  where id = p_alert_id;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('alerts', p_alert_id::text, 'resolved', v_email, jsonb_build_object('note', p_note));
end;
$$;

create or replace function charging.mute_alert(p_alert_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email text := charging.jwt_email();
  v_alert charging.alerts%rowtype;
begin
  if not charging.is_vammo_user() then raise exception 'not authorized'; end if;
  if not charging.is_operator() then raise exception 'operator role required'; end if;

  select * into v_alert from charging.alerts where id = p_alert_id for update;
  if not found then raise exception 'alert % not found', p_alert_id; end if;
  if v_alert.status not in ('open','acknowledged') then
    raise exception 'only open/acknowledged alerts can be muted (current: %)', v_alert.status;
  end if;

  update charging.alerts
  set status = 'muted', muted_by_email = v_email, muted_at = now()
  where id = p_alert_id;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('alerts', p_alert_id::text, 'muted', v_email, jsonb_build_object('note', p_note));
end;
$$;

-- ── set_user_role (admin-only; cannot remove the last admin) ────────────────
create or replace function charging.set_user_role(p_email text, p_role text)
returns void
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email       text := charging.jwt_email();
  v_target      text := lower(btrim(p_email));
  v_old         text;
  v_admin_count integer;
begin
  if not charging.is_vammo_user() then raise exception 'not authorized'; end if;
  if not charging.is_admin() then raise exception 'admin role required'; end if;
  if v_target not like '%@vammo.com' then raise exception 'email must be @vammo.com'; end if;
  if p_role is not null and p_role not in ('admin','operator') then
    raise exception 'role must be admin, operator, or null';
  end if;

  select role into v_old from charging.user_roles where email = v_target;

  -- last-admin guard: block removing/demoting the final admin
  if v_old = 'admin' and (p_role is null or p_role <> 'admin') then
    select count(*) into v_admin_count from charging.user_roles where role = 'admin';
    if v_admin_count <= 1 then raise exception 'cannot remove the last admin'; end if;
  end if;

  if v_old is not distinct from p_role then
    raise exception 'no change: % is already %', v_target, coalesce(p_role, '(none)');  -- double-submit
  end if;

  if p_role is null then
    delete from charging.user_roles where email = v_target;
  else
    insert into charging.user_roles (email, role, created_by_email)
    values (v_target, p_role, v_email)
    on conflict (email) do update set role = excluded.role;
  end if;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('user_roles', v_target, 'role_changed', v_email, jsonb_build_object('from', v_old, 'to', p_role));
end;
$$;

-- ── assign_station_to_account (admin — account↔station remap) ───────────────
create or replace function charging.assign_station_to_account(
  p_billing_account_id uuid,
  p_station_id         integer,
  p_method             text,
  p_note               text
)
returns void
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email text := charging.jwt_email();
  v_acct  charging.billing_accounts%rowtype;
begin
  if not charging.is_vammo_user() then raise exception 'not authorized'; end if;
  if not charging.is_admin() then raise exception 'admin role required to remap an account'; end if;

  select * into v_acct from charging.billing_accounts where id = p_billing_account_id for update;
  if not found then raise exception 'billing account % not found', p_billing_account_id; end if;
  if not exists (select 1 from charging.stations where id = p_station_id) then
    raise exception 'station % not found', p_station_id;
  end if;
  if v_acct.station_id is not distinct from p_station_id and v_acct.match_status = 'manually_matched' then
    raise exception 'account is already assigned to station %', p_station_id;   -- double-submit
  end if;

  update charging.billing_accounts
  set station_id = p_station_id, match_status = 'manually_matched',
      match_method = coalesce(p_method, 'manual'), matched_by_email = v_email, matched_at = now()
  where id = p_billing_account_id;

  -- cascade the station to the account's still-unattributed charges
  update charging.charges set station_id = p_station_id
  where billing_account_id = p_billing_account_id and station_id is null;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('billing_accounts', p_billing_account_id::text, 'remapped', v_email,
    jsonb_build_object('from_station', v_acct.station_id, 'to_station', p_station_id,
      'method', p_method, 'note', p_note));
end;
$$;

-- ── resolve_unmatched_charge (attribute a UNIDENTIFIED charge to an account) ─
create or replace function charging.resolve_unmatched_charge(p_charge_id uuid, p_billing_account_id uuid)
returns void
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email  text := charging.jwt_email();
  v_charge charging.charges%rowtype;
  v_acct   charging.billing_accounts%rowtype;
begin
  if not charging.is_vammo_user() then raise exception 'not authorized'; end if;
  if not charging.is_operator() then raise exception 'operator role required'; end if;

  select * into v_charge from charging.charges where id = p_charge_id for update;
  if not found then raise exception 'charge % not found', p_charge_id; end if;
  if v_charge.billing_account_id is not null then
    raise exception 'charge % is already attributed';   -- double-submit guard
  end if;

  select * into v_acct from charging.billing_accounts where id = p_billing_account_id;
  if not found then raise exception 'billing account % not found', p_billing_account_id; end if;

  update charging.charges
  set billing_account_id = p_billing_account_id, station_id = v_acct.station_id,
      match_status = 'manually_matched'
  where id = p_charge_id;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('charges', p_charge_id::text, 'matched', v_email,
    jsonb_build_object('billing_account_id', p_billing_account_id, 'station_id', v_acct.station_id));
end;
$$;

-- ── EXECUTE privileges (M11) ────────────────────────────────────────────────
-- Belt-and-suspenders over migration 1's ALTER DEFAULT PRIVILEGES: no anon/public
-- may call anything in the schema. User RPCs go to authenticated (in-function
-- role checks do the real authorization); claim_job is service_role only.
revoke execute on all functions in schema charging from public, anon;

grant execute on function charging.create_meter_reading(integer, uuid, text, date, numeric, uuid, text) to authenticated;
grant execute on function charging.correct_meter_reading(uuid, date, numeric, uuid, text, text) to authenticated;
grant execute on function charging.create_manual_bill(uuid, date, date, numeric, uuid, text, jsonb, text) to authenticated;
grant execute on function charging.record_payment(uuid, uuid, numeric, date, charging.payment_method) to authenticated;
grant execute on function charging.unmatch_payment(uuid, text) to authenticated;
grant execute on function charging.confirm_charge(uuid) to authenticated;
grant execute on function charging.update_charge_status(uuid, charging.charge_status, text) to authenticated;
grant execute on function charging.gerar_mes(date) to authenticated;
grant execute on function charging.acknowledge_alert(uuid, text) to authenticated;
grant execute on function charging.resolve_alert(uuid, text) to authenticated;
grant execute on function charging.mute_alert(uuid, text) to authenticated;
grant execute on function charging.set_user_role(text, text) to authenticated;
grant execute on function charging.assign_station_to_account(uuid, integer, text, text) to authenticated;
grant execute on function charging.resolve_unmatched_charge(uuid, uuid) to authenticated;

grant execute on function charging.claim_job(text, integer) to service_role;
