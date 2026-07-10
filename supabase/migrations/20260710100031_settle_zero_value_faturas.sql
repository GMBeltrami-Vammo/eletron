-- settle_zero_value_faturas (decision #42, Gabriel 2026-07-10): a zero-value
-- energy fatura (amount = 0) is NOT sent to the fiscal sheet — instead it is
-- auto-checked ("Enviado ao fiscal") AND considered PAID even without a bound
-- comprovante. That paid-without-comprovante is a deliberate EXCEPTION to
-- decision #29 (there is nothing to pay for a R$0 bill), so it can't go through
-- record_payment (which requires a receipt). Guarded to amount = 0 so it can
-- never mark a real bill paid; sets status='pago' (status_source='rpc', sticky)
-- + fiscal_exported=true on both the charge and its energy detail. Idempotent.
-- Returns the number of charges newly flipped to paid.

create or replace function charging.settle_zero_value_faturas(p_charge_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email text := charging.jwt_email();
  v_paid  integer := 0;
begin
  if not charging.is_vammo_user() then raise exception 'não autorizado'; end if;
  if p_charge_ids is null or array_length(p_charge_ids, 1) is null then
    return 0;
  end if;

  -- paid without comprovante — ONLY for zero-value charges (#29 exception).
  update charging.charges
     set status = 'pago', status_source = 'rpc', updated_at = now()
   where id = any(p_charge_ids)
     and amount = 0
     and status <> 'pago';
  get diagnostics v_paid = row_count;

  -- auto-check "Enviado ao fiscal" on both flags (energy-scoped by amount = 0).
  update charging.charge_energy_details ced
     set fiscal_exported = true, fiscal_exported_at = now()
   where ced.charge_id = any(p_charge_ids)
     and ced.fiscal_exported is distinct from true
     and exists (
       select 1 from charging.charges c where c.id = ced.charge_id and c.amount = 0
     );

  update charging.charges
     set fiscal_exported = true, updated_at = now()
   where id = any(p_charge_ids)
     and amount = 0
     and fiscal_exported is distinct from true;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('charges', 'zero_value_settle', 'zero_value_settled', v_email,
    jsonb_build_object('charge_count', array_length(p_charge_ids, 1), 'newly_paid', v_paid));

  return v_paid;
end;
$$;

revoke execute on function charging.settle_zero_value_faturas(uuid[]) from public, anon;
grant  execute on function charging.settle_zero_value_faturas(uuid[]) to authenticated;
