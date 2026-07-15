-- Immutable per-bill débito-automático flag (Gabriel 2026-07-14).
--
-- The comprovante matcher must gate on whether a FATURA was DA — a bill-level,
-- IMMUTABLE fact — not on utility_account_state.auto_debit, which is the
-- STATION's CURRENT (mutable) enrollment and can flip after the bill is issued.
-- A manual boleto payment (concessionária receipt) must never bind to a bill
-- that was on débito automático, and vice-versa. We reuse
-- charge_energy_details.auto_debit as that per-bill snapshot.
--
-- Backfill: for the existing corpus, copy the station's CURRENT auto_debit (the
-- best available snapshot). Going forward the value is (re)frozen at
-- send-to-fiscal — see set_fiscal_exported (next migration). WHERE-scoped
-- (supautils) and idempotent (re-running just re-copies the station value).

update charging.charge_energy_details ced
   set auto_debit = uas.auto_debit
  from charging.charges c
  join charging.utility_account_state uas
    on uas.billing_account_id = c.billing_account_id
 where c.id = ced.charge_id
   and uas.auto_debit is not null;
