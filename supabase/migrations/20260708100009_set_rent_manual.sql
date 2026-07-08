-- Eletron Phase 2.5 — migration 9: set_rent_manual RPC.
-- The name-pattern seed in migration 8 is best-effort (Ipiranga neighborhood
-- over-match, "Smart Kitchens" ≠ "Kitchen Central"), so the rent_manual flag
-- must be human-curatable from the contract page (M7). This RPC is the write
-- path: any @vammo.com session (roles suspended) toggles it, audited.

create or replace function charging.set_rent_manual(p_contract_id uuid, p_manual boolean)
returns void
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email    text := charging.jwt_email();
  v_contract charging.contracts%rowtype;
begin
  if not charging.is_vammo_user() then raise exception 'não autorizado'; end if;
  if p_manual is null then raise exception 'informe o valor (verdadeiro/falso)'; end if;

  select * into v_contract from charging.contracts where id = p_contract_id for update;
  if not found then raise exception 'contrato % não encontrado', p_contract_id; end if;
  if coalesce(v_contract.rent_manual, false) = p_manual then
    return;  -- idempotent no-op
  end if;

  update charging.contracts set rent_manual = p_manual where id = p_contract_id;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('contracts', p_contract_id::text, 'rent_manual_set', v_email,
    jsonb_build_object('rent_manual', p_manual, 'previous', coalesce(v_contract.rent_manual, false)));
end;
$$;

revoke execute on function charging.set_rent_manual(uuid, boolean) from public, anon;
grant execute on function charging.set_rent_manual(uuid, boolean) to authenticated;
