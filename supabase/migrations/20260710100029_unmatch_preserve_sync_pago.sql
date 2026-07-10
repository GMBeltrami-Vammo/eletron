-- Review finding #3 (AMENDS migration 20 / decision #35). unmatch_payment walked
-- a charge off 'pago' whenever no receipted payment remained — but that also
-- reversed a SYNC/PORTAL-derived 'pago' (status_source='sync') the moment its
-- (newly bindable, decision #41) comprovante was removed, destroying the
-- parallel scraper/portal "paid" status the app deliberately preserves
-- (reset_comprovante_matches already guards on status_source='rpc'; unmatch did
-- not). Fix: only walk back charges the APP itself set to 'pago' via a
-- comprovante (status_source='rpc'). A sync/portal 'pago' keeps its status when
-- its comprovante is unbound. Everything else preserved verbatim from migration 20.

create or replace function charging.unmatch_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email         text := charging.jwt_email();
  v_pay           charging.payments%rowtype;
  v_charge        charging.charges%rowtype;
  v_tol           numeric := 0.01;
  v_paid_total    numeric;
  v_has_receipted boolean;
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

  -- decision #29: the app's 'pago' requires at least one payment with a bound
  -- receipt. Walk back on coverage loss OR when no receipted payment remains —
  -- but ONLY for charges the APP set to 'pago' (status_source='rpc'). A
  -- sync/portal-derived 'pago' (status_source='sync') is a separate, displayed
  -- fact (decision #35) and keeps its status when a comprovante is unbound.
  select exists (
    select 1 from charging.payments
    where charge_id = v_charge.id and receipt_id is not null
  ) into v_has_receipted;

  if v_charge.status = 'pago'
     and v_charge.status_source = 'rpc'
     and (v_charge.amount is null
          or v_paid_total < v_charge.amount - v_tol
          or not v_has_receipted) then
    update charging.charges
    set status = (case when v_charge.due_date is not null and v_charge.due_date < current_date
                      then 'atrasado' else 'pendente' end)::charging.charge_status,
        status_source = 'rpc'
    where id = v_charge.id;
  end if;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('payments', p_payment_id::text, 'unmatched', v_email,
    jsonb_build_object('reason', p_reason, 'charge_id', v_charge.id, 'deleted_payment', to_jsonb(v_pay)));
end;
$$;
