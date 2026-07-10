-- Feature D invariant fix — decision #29 ("paid iff a comprovante is bound").
--
-- Bug: unmatch_payment (migration 12) walked a charge off 'pago' ONLY when
-- coverage was lost (paid_total < amount - tol). But a receiptless payment
-- (e.g. "Registrar pagamento" without a bound comprovante, which per migration
-- 14 does NOT itself grant baixa) can still cover the amount after the LAST
-- receipted payment is removed — leaving the charge 'pago' with no comprovante,
-- violating #29. Reachable via the /comprovantes "Remover" flow (feature D 2a).
--
-- Fix: after deleting the payment, also walk the charge back when NO remaining
-- payment carries a bound receipt (mirror record_payment's "exists a bound
-- receipt" condition on the reverse path). The app's 'pago' stays strictly
-- comprovante-backed; the scraper/portal "paid" status is a separate, displayed
-- fact and is untouched. Everything else (receipt reset, the enum cast from
-- migration 12, audit) is preserved verbatim.

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
  -- receipt. Walk back on coverage loss OR when no receipted payment remains.
  select exists (
    select 1 from charging.payments
    where charge_id = v_charge.id and receipt_id is not null
  ) into v_has_receipted;

  if v_charge.status = 'pago'
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
