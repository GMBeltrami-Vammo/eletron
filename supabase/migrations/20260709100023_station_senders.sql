-- Feature B (Gabriel 2026-07-10): match incoming boletos by their EMAIL SENDER
-- against a learned list ("most reliable matching method so far"). The n8n
-- cobrança webhook already carries `remetente`; this adds:
--   1. charging.station_senders — the sender→station list. One sender maps to
--      exactly ONE station (sender_email UNIQUE); a station may have MANY
--      senders (station_id repeats), per "permitir mais de um remetente para
--      cada estação". No case of multi-station-per-sender yet, but if one
--      arises the UNIQUE(sender_email) is the point to revisit.
--   2. charges.email_sender — the from-address stored structurally on each
--      cobrança charge (was only free text in notes), so it is queryable/shown
--      and drives the teach-on-reclassify.
--   3. set_station_sender(sender, station|null) — the sole writer: upsert a
--      mapping, or clear it when p_station_id is null. Called on ingestion-teach
--      and when a human reclassifies a cobrança that carries a sender.

create table if not exists charging.station_senders (
  id               uuid primary key default gen_random_uuid(),
  sender_email     text not null unique,
  station_id       integer not null references charging.stations(id),
  notes            text,
  created_by_email text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists station_senders_station_idx on charging.station_senders(station_id);

alter table charging.station_senders enable row level security;
-- Read for any authenticated @vammo.com (matching the schema's uniform policy);
-- writes go only through the SECURITY DEFINER RPC below.
drop policy if exists station_senders_select on charging.station_senders;
create policy station_senders_select on charging.station_senders
  for select to authenticated using (charging.is_vammo_user());

alter table charging.charges add column if not exists email_sender text;

-- Normalizes a raw "Name <a@b.com>" (or bare address) to a lowercased address.
create or replace function charging.normalize_sender(p_raw text)
returns text
language sql
immutable
set search_path to 'charging'
as $$
  select nullif(
    lower(btrim(
      coalesce(
        (regexp_match(coalesce(p_raw, ''), '<([^>]+)>'))[1],  -- inside < >
        p_raw
      )
    )),
    ''
  )
$$;

create or replace function charging.set_station_sender(p_sender_email text, p_station_id integer)
returns void
language plpgsql
security definer
set search_path to 'charging'
as $$
declare
  v_email  text := charging.jwt_email();
  v_sender text := charging.normalize_sender(p_sender_email);
begin
  if not charging.is_vammo_user() then raise exception 'não autorizado'; end if;
  if v_sender is null then raise exception 'informe o remetente (e-mail)'; end if;

  if p_station_id is null then
    delete from charging.station_senders where sender_email = v_sender;
    insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
    values ('station_senders', v_sender, 'sender_unlinked', v_email,
      jsonb_build_object('sender', v_sender));
    return;
  end if;

  if not exists (select 1 from charging.stations where id = p_station_id) then
    raise exception 'estação % não encontrada', p_station_id;
  end if;

  insert into charging.station_senders (sender_email, station_id, created_by_email)
  values (v_sender, p_station_id, v_email)
  on conflict (sender_email) do update
    set station_id = excluded.station_id, updated_at = now();

  insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
  values ('station_senders', v_sender, 'sender_linked', v_email,
    jsonb_build_object('sender', v_sender, 'station_id', p_station_id));
end;
$$;

revoke execute on function charging.set_station_sender(text, integer) from public, anon;
grant  execute on function charging.set_station_sender(text, integer) to authenticated;
