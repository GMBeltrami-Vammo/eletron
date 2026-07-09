-- Eletron Phase 2.5 — migration 13: rent_payment_due alert type.
-- New worry rule (Gabriel 2026-07-09): a pix/transferência rent charge generated
-- for the current month but not yet paid (no bound comprovante) becomes a worry
-- after the 5th. Extend the alerts alert_type CHECK to admit 'rent_payment_due'.
-- Same dynamic drop/recreate pattern as migration 8.

do $do$
declare
  v_name text;
begin
  select con.conname into v_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'charging'
    and rel.relname = 'alerts'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%alert_type%'
  limit 1;
  if v_name is not null then
    execute format('alter table charging.alerts drop constraint %I', v_name);
  end if;
end;
$do$;

alter table charging.alerts add constraint alerts_alert_type_check check (alert_type in (
  'overdue_bill','due_soon_no_auto_debit','no_auto_debit','new_installation',
  'scraper_stale','negotiated_invoice','scheduled_shutdown',
  'station_without_contract','contract_without_station',
  'unmatched_charge','unmatched_receipt','unmatched_account',
  'meter_vs_bill_discrepancy','missing_meter_reading','value_mismatch','contract_expiring',
  'manual_bill_sheet_append_failed','encrypted_comprovante','sheet_sync_stale',
  'manual_rent_reminder','rent_payment_due'));
