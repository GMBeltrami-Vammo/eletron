-- Eletron Phase 2 — migration 6: charge-match stickiness.
-- resolve_unmatched_charge and assign_station_to_account's charge cascade now
-- stamp status_source='rpc', so the sheet-sync's status_source split preserves
-- the human attribution/flags on re-sync (paired with lib/sync/sheet-sync.ts
-- omitting billing_account_id/station_id/match_status/flags for 'rpc' rows).

create or replace function charging.resolve_unmatched_charge(p_charge_id uuid, p_billing_account_id uuid)
returns void
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email  text := charging.jwt_email();
  v_charge charging.charges%rowtype;
  v_acct   charging.billing_accounts%rowtype;
begin
  if not charging.is_vammo_user() then raise exception 'not authorized'; end if;
  if not charging.is_operator() then raise exception 'operator role required'; end if;

  select * into v_charge from charging.charges where id = p_charge_id for update;
  if not found then raise exception 'charge % not found', p_charge_id; end if;
  if v_charge.billing_account_id is not null then
    raise exception 'charge % is already attributed', p_charge_id;
  end if;

  select * into v_acct from charging.billing_accounts where id = p_billing_account_id;
  if not found then raise exception 'billing account % not found', p_billing_account_id; end if;

  update charging.charges
  set billing_account_id = p_billing_account_id, station_id = v_acct.station_id,
      match_status = 'manually_matched', status_source = 'rpc'
  where id = p_charge_id;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('charges', p_charge_id::text, 'matched', v_email,
    jsonb_build_object('billing_account_id', p_billing_account_id, 'station_id', v_acct.station_id));
end;
$$;

create or replace function charging.assign_station_to_account(
  p_billing_account_id uuid,
  p_station_id         integer,
  p_method             text,
  p_note               text
)
returns void
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email text := charging.jwt_email();
  v_acct  charging.billing_accounts%rowtype;
begin
  if not charging.is_vammo_user() then raise exception 'not authorized'; end if;
  if not charging.is_admin() then raise exception 'admin role required to remap an account'; end if;

  select * into v_acct from charging.billing_accounts where id = p_billing_account_id for update;
  if not found then raise exception 'billing account % not found', p_billing_account_id; end if;
  if not exists (select 1 from charging.stations where id = p_station_id) then
    raise exception 'station % not found', p_station_id;
  end if;
  if v_acct.station_id is not distinct from p_station_id and v_acct.match_status = 'manually_matched' then
    raise exception 'account is already assigned to station %', p_station_id;
  end if;

  update charging.billing_accounts
  set station_id = p_station_id, match_status = 'manually_matched',
      match_method = coalesce(p_method, 'manual'), matched_by_email = v_email, matched_at = now()
  where id = p_billing_account_id;

  -- cascade to the account's still-unattributed charges, stamping rpc so the
  -- sync preserves the assignment on re-sync.
  update charging.charges set station_id = p_station_id, status_source = 'rpc'
  where billing_account_id = p_billing_account_id and station_id is null;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('billing_accounts', p_billing_account_id::text, 'remapped', v_email,
    jsonb_build_object('from_station', v_acct.station_id, 'to_station', p_station_id,
      'method', p_method, 'note', p_note));
end;
$$;
