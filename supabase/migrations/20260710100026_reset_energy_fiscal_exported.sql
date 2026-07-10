-- Reset "Enviada ao fiscal" on energy faturas (Gabriel 2026-07-10).
--
-- The fiscal_exported flags cloned from the sheets ("Financeiro Check") are no
-- longer trusted: from now on a fatura only counts as "Enviada ao fiscal" when
-- verified/registered against the real FISCAL spreadsheet (lib/fiscal/
-- fiscal-sheet.ts check, send flow to follow). Clearing the flag walks those
-- faturas' Ciclo back from 3 · Enviada ao fiscal to 2 · Analisada (Paga rows
-- are unaffected — stage 4 does not read this flag).
--
-- Scope: energy only (accounts energy_enel/energy_edp + station-only manual
-- energia charges + all charge_energy_details rows). Rent "No Fiscal" flags
-- stay untouched.

update charging.charge_energy_details
   set fiscal_exported = false
 where fiscal_exported;

update charging.charges c
   set fiscal_exported = false
 where c.fiscal_exported
   and (
     exists (
       select 1
         from charging.billing_accounts a
        where a.id = c.billing_account_id
          and a.account_type in ('energy_enel', 'energy_edp')
     )
     or (c.billing_account_id is null and c.kind = 'energia')
   );
