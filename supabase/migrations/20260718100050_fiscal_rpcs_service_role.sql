-- Allow service_role to call set_fiscal_exported / settle_zero_value_faturas
-- (Gabriel 2026-07-18): the Enel/EDP fiscal send now ALSO runs unattended from
-- the daily cron (lib/fiscal/send-fiscal-cron.ts), which authenticates as
-- service_role (supabaseAdmin(), no user JWT) — so `is_vammo_user()` alone would
-- reject it. Mirrors claim_job's existing service_role auth pattern (migration
-- 20260708100003): accept EITHER a human @vammo.com session OR the service_role
-- caller. actor_email falls back to 'system:fiscal-send' when there is no JWT
-- email (the audit_events.actor_email column was designed for this from day
-- one — its comment says "user email or 'system:{job}'"); a human-triggered
-- call (manual button) still records the real clicking email, unchanged.

create or replace function charging.set_fiscal_exported(
  p_charge_ids uuid[],
  p_value boolean
)
returns integer
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email   text := coalesce(charging.jwt_email(), 'system:fiscal-send');
  v_changed integer := 0;
begin
  if not (
    charging.is_vammo_user()
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or session_user = 'service_role'
  ) then
    raise exception 'não autorizado';
  end if;
  if p_charge_ids is null or array_length(p_charge_ids, 1) is null then
    return 0;
  end if;

  -- fatura detail (energy-only by construction) — this is the count reported.
  -- On the false→true transition, freeze auto_debit = the station's current
  -- enrollment, EXCEPT for manual bills, whose auto_debit is the human's método.
  update charging.charge_energy_details ced
     set fiscal_exported = p_value,
         fiscal_exported_at = case when p_value then now() else null end,
         auto_debit = case
           when p_value then coalesce(
             (select uas.auto_debit
                from charging.charges c2
                join charging.utility_account_state uas
                  on uas.billing_account_id = c2.billing_account_id
               where c2.id = ced.charge_id
                 and c2.source is distinct from 'manual'
               limit 1),
             ced.auto_debit)
           else ced.auto_debit
         end
   where ced.charge_id = any(p_charge_ids)
     and ced.fiscal_exported is distinct from p_value;
  get diagnostics v_changed = row_count;

  -- charge-level flag, energy-scoped (mirror reset_energy_fiscal_exported)
  update charging.charges c
     set fiscal_exported = p_value, updated_at = now()
   where c.id = any(p_charge_ids)
     and c.fiscal_exported is distinct from p_value
     and (
       exists (
         select 1 from charging.billing_accounts a
          where a.id = c.billing_account_id
            and a.account_type in ('energy_enel', 'energy_edp')
       )
       or (c.billing_account_id is null and c.kind = 'energia')
     );

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('charges', 'fiscal_verify', 'fiscal_exported_synced', v_email,
    jsonb_build_object(
      'value', p_value,
      'charge_count', array_length(p_charge_ids, 1),
      'details_changed', v_changed));

  return v_changed;
end;
$$;

revoke execute on function charging.set_fiscal_exported(uuid[], boolean) from public, anon;
grant  execute on function charging.set_fiscal_exported(uuid[], boolean) to authenticated, service_role;

create or replace function charging.settle_zero_value_faturas(p_charge_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email text := coalesce(charging.jwt_email(), 'system:fiscal-send');
  v_paid  integer := 0;
begin
  if not (
    charging.is_vammo_user()
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
    or session_user = 'service_role'
  ) then
    raise exception 'não autorizado';
  end if;
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
grant  execute on function charging.settle_zero_value_faturas(uuid[]) to authenticated, service_role;
