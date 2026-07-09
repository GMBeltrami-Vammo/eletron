-- Request #5: declutter the /estacoes list of Enel/EDP stations. Two INDEPENDENT
-- tools were chosen ("Both"):
--   (A) a persisted manual hide list — THIS migration: stations.hidden + the
--       set_station_hidden RPC.
--   (B) a client-side freshness filter (hide stations whose last scraper
--       collection is older than N days) — UI only, no schema.
--
-- `hidden` is human/RPC-owned state. Both sync paths deliberately DO NOT write
-- it, so re-syncing never clobbers a manual hide:
--   * runMetabaseSync (lib/sync/metabase-sync.ts) omits `hidden` from its UPDATE
--     patch and INSERT payload → updates leave it, inserts get the default false.
--   * the sheet backfill's toStationRow (lib/sync/sheet-sync.ts) omits it from
--     the upsert column set (same trick it already uses for active_boxes) → an
--     ON CONFLICT DO UPDATE never touches columns absent from the payload.
-- Only set_station_hidden writes the column.

alter table charging.stations
  add column if not exists hidden boolean not null default false;

-- set_station_hidden — the sole write path. Toggle mirror of set_rent_manual
-- (migration 9): SECURITY DEFINER, pinned search_path, is_vammo_user() gate
-- (roles suspended — decision #26), idempotent no-op, audited. Any @vammo.com
-- session may hide/show a station.
create or replace function charging.set_station_hidden(p_station_id integer, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email   text := charging.jwt_email();
  v_station charging.stations%rowtype;
begin
  if not charging.is_vammo_user() then raise exception 'não autorizado'; end if;
  if p_hidden is null then raise exception 'informe o valor (verdadeiro/falso)'; end if;

  select * into v_station from charging.stations where id = p_station_id for update;
  if not found then raise exception 'estação % não encontrada', p_station_id; end if;
  if coalesce(v_station.hidden, false) = p_hidden then
    return;  -- idempotent no-op (double-submit / re-hide)
  end if;

  update charging.stations set hidden = p_hidden where id = p_station_id;

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('stations', p_station_id::text, 'set_station_hidden', v_email,
    jsonb_build_object('hidden', p_hidden, 'previous', coalesce(v_station.hidden, false)));
end;
$$;

-- Belt-and-suspenders over the schema's ALTER DEFAULT PRIVILEGES: nothing for
-- public/anon; authenticated calls in (the in-function is_vammo_user() gate is
-- the authorization — roles suspended).
revoke execute on function charging.set_station_hidden(integer, boolean) from public, anon;
grant execute on function charging.set_station_hidden(integer, boolean) to authenticated;
