-- Fix (adversarial review H1): migrations 23/24 created station_senders and
-- document_pages with RLS + a select policy but omitted the per-table GRANTs
-- every other charging table has (migration 2/16 pattern: authenticated=SELECT,
-- service_role=SELECT/INSERT/UPDATE/DELETE). Without them the cobrança webhook
-- (service_role) reading station_senders errors — and `one()` turns that into a
-- 500 — so EVERY email with a remetente would abort the live webhook; and the
-- per-page cache (document_pages, service_role) would silently never persist.

grant select on charging.station_senders to authenticated;
grant select, insert, update, delete on charging.station_senders to service_role;

grant select on charging.document_pages to authenticated;
grant select, insert, update, delete on charging.document_pages to service_role;
