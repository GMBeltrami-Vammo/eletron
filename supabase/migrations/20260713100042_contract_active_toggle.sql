-- "Contrato Ativo" toggle (decisão #51). A human turns a contract Ativo/Inativo
-- on /alugueis; inactivating records the inactivation DATE, which gerar_mes uses
-- to pro-rata the last month (valor_mensal × dia/30, decisão #51 / migration 43).
--
-- Human-only (test env: any @vammo.com passes — a non-head can do it now, per
-- Gabriel; the roles-per-action scaffolding will restrict it later). Audited.
-- The toggle only flips ACTIVE↔INACTIVE; DECOMMISSIONED/PRE_INSTALLATION are set
-- by other flows and simply read as "Inativo".
alter table charging.contracts
  add column if not exists inactivated_on date;

comment on column charging.contracts.inactivated_on is
  'Date the contract was made Inativo (set by set_contract_active). Drives the last-month pro-rata in gerar_mes (#51); null while ACTIVE.';

create or replace function charging.set_contract_active(
  p_contract_id     uuid,
  p_active          boolean,
  p_inactivated_on  date,
  p_reason          text
)
returns void
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email text := charging.jwt_email();
  v_c     charging.contracts%rowtype;
  v_date  date;
begin
  -- human-only; roles-per-action will tighten this later (Gabriel: non-head OK now)
  if not charging.is_vammo_user() then raise exception 'não autorizado'; end if;

  select * into v_c from charging.contracts where id = p_contract_id for update;
  if v_c.id is null then raise exception 'contrato % não encontrado', p_contract_id; end if;

  if p_active then
    -- one active contract per station (partial unique index) — friendly guard
    if v_c.station_id is not null and exists (
      select 1 from charging.contracts x
      where x.station_id = v_c.station_id and x.status = 'ACTIVE' and x.id <> p_contract_id
    ) then
      raise exception 'estação % já tem um contrato ativo', v_c.station_id;
    end if;
    update charging.contracts
    set status = 'ACTIVE', inactivated_on = null
    where id = p_contract_id;
  else
    v_date := coalesce(p_inactivated_on, current_date);
    update charging.contracts
    set status = 'INACTIVE', inactivated_on = v_date
    where id = p_contract_id;
  end if;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('contracts', p_contract_id::text,
    case when p_active then 'contract_activated' else 'contract_inactivated' end,
    v_email,
    jsonb_build_object(
      'active', p_active,
      'inactivated_on', case when p_active then null else v_date end,
      'reason', p_reason,
      'prev_status', v_c.status
    ));
end;
$$;

revoke execute on function charging.set_contract_active(uuid, boolean, date, text) from public, anon;
grant execute on function charging.set_contract_active(uuid, boolean, date, text) to authenticated;
