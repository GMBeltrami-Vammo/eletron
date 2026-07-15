-- set_fiscal_exported — now ALSO freezes the bill's DA flag (Gabriel 2026-07-14).
-- When a fatura becomes "enviada ao fiscal" (fiscal_exported false→true), snapshot
-- the station's CURRENT auto_debit into charge_energy_details.auto_debit — the
-- immutable per-bill value the comprovante matcher gates on. Only on the
-- transition (the WHERE already limits to changed rows), so a later verify
-- re-sync never re-freezes it. Demote (→false) leaves auto_debit untouched.
-- Everything else (charge-level flag, audit, gate, energy-scoping) unchanged.

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
  -- enrollment (the bill-level DA snapshot the matcher gates on).
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
