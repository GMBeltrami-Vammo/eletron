-- Eletron Phase 2.5 — migration 15: confirm_charge requires a bound comprovante.
-- Review finding: migration 14 stopped a receiptless record_payment from reaching
-- 'pago', but confirm_charge could still flip to 'pago' on a receiptless covering
-- payment (DB-layer hole in the "paid iff comprovante" invariant, decision #29).
-- Add the same receipt-bound guard. Re-issues confirm_charge; nothing else changed.

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
  -- "paid iff comprovante" (decision #29): baixa requires a bound receipt.
  if not exists (select 1 from charging.payments where charge_id = p_charge_id and receipt_id is not null) then
    raise exception 'so e possivel dar baixa com um comprovante vinculado';
  end if;

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
