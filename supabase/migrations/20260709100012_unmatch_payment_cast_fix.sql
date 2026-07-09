-- Eletron Phase 2.5 — migration 12: unmatch_payment enum-cast fix.
-- Reviewer caught a 4th instance of the plpgsql CASE→enum bug (see migration
-- 11): unmatch_payment set charges.status from an uncast CASE (text) → fails at
-- runtime with "column status is of type charge_status but expression is of type
-- text". It fires exactly when unmatching a payment from a `pago` charge (the
-- comprovante "Remover" button, app/actions/charges.ts). Re-issued with the
-- explicit ::charging.charge_status cast; no other change.

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
