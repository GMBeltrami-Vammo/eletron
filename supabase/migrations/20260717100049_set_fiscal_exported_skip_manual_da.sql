-- set_fiscal_exported — the send-freeze (#58, migration 45) must NOT overwrite a
-- MANUAL fatura's auto_debit (Gabriel 2026-07-17). A manual Enel/EDP bill carries
-- the human's método (DA/Boleto) in charge_energy_details.auto_debit; freezing it
-- from the station at send would clobber that exactly when it drives the fiscal
-- column B (#42). Fix: the station snapshot subquery ignores manual charges
-- (source='manual'), so their auto_debit falls back to the value set at creation.
-- Scraper faturas keep the #58 send-time freeze unchanged.

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
  v_email   text := charging.jwt_email();
  v_changed integer := 0;
begin
  if not charging.is_vammo_user() then raise exception 'não autorizado'; end if;
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
grant  execute on function charging.set_fiscal_exported(uuid[], boolean) to authenticated;
