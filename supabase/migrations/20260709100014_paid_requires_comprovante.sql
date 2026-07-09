-- Eletron Phase 2.5 — migration 14: record_payment requires a comprovante to pay.
-- "Paid if and only if a comprovante is bound" (Gabriel 2026-07-09): a receiptless
-- payment may still be RECORDED, but it must NOT flip the charge to 'pago'. Only a
-- payment with a bound receipt (a linked comprovante) settles the charge. This
-- closes the "marcar como pago sem comprovante" path. Re-issues record_payment
-- with an extra guard on the pago flip; nothing else changed.

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

  if v_charge.amount is not null and v_paid_total >= v_charge.amount - v_tol
     and exists (select 1 from charging.payments where charge_id = p_charge_id and receipt_id is not null) then
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
