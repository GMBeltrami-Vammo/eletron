-- set_fiscal_exported — the write half of decision #40's fiscal verification.
-- After reset_energy_fiscal_exported (migration 26) cleared the untrusted cloned
-- flags, "Enviada ao fiscal" must be EARNED: the /energia "Verificar no fiscal"
-- button reads the FISCAL sheet and calls this to sync `fiscal_exported` to what
-- was actually found there (true = registered, false = not). Sets BOTH the
-- charge-level flag (charges.fiscal_exported, energy-scoped) and the fatura
-- detail (charge_energy_details.fiscal_exported + _at) — the two columns the
-- Faturas view / Ciclo / pagamentos read. Ciclo stage 3 (Enviada ao fiscal)
-- keys off this flag, so a registered fatura moves to Ciclo 3 automatically.
--
-- is_vammo_user() gate (decision #26); only touches rows whose value changes
-- (quiet audit); energy-scoped so it can never flip a rent "No Fiscal" flag.
-- Returns the number of fatura details actually changed.

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

  -- fatura detail (energy-only by construction) — this is the count reported
  update charging.charge_energy_details
     set fiscal_exported = p_value,
         fiscal_exported_at = case when p_value then now() else null end
   where charge_id = any(p_charge_ids)
     and fiscal_exported is distinct from p_value;
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
