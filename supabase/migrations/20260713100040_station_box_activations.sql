-- Box-day pro-rata (decisão #50): store, per station, the BRT activation date
-- of each currently-active box, so gerar_mes can pro-rata rent for months where
-- boxes came online mid-month (e.g. 3 boxes até o dia 14 + 3 no dia 14).
--
-- Sync-owned (runMetabaseSync, card 28556's fa.first_active_ts): an array of
-- 'YYYY-MM-DD' BRT dates (or json null when a box's activation date is unknown),
-- ONE entry per active box. The sync FULL-REPLACES it each run from the current
-- box snapshot, so a removed box simply drops out (no stale rows). Storing the
-- BRT *date* (not the raw timestamp) keeps the pro-rata math timezone-free and
-- identical between the SQL RPC and the TS preview. NOT human-editable; never
-- drives the amount except via the box-day pro-rata fraction.
alter table charging.stations
  add column if not exists box_activations jsonb;

comment on column charging.stations.box_activations is
  'Sync-owned (metabase-sync card 28556): array of active boxes'' BRT activation dates (YYYY-MM-DD, or null if unknown), one per box. Full-replaced daily. Drives the box-day pro-rata in gerar_mes (#50).';
