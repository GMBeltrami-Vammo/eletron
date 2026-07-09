-- Q8 (decision #21): a canonical charge-level "sent to the fiscal sheet" flag.
--
-- Until now the only fiscal-export signal lived on charge_energy_details
-- (energy, from the Faturas "Financeiro Check" column). Rent charges carried no
-- fiscal flag at all. This adds ONE charge-level flag the UI reads for every
-- charge kind:
--   * energy  → sheet "Financeiro Check"
--   * rent    → 2_Pagamentos "No Fiscal" column (col R)
--
-- It means "exportado à planilha fiscal", NEVER "pago" (decision #21). It never
-- drives charge.status; `pago` still comes only from confirm_charge /
-- record_payment with a bound comprovante (decision #29).
--
-- The actual send stays deferred (built later); this migration only stores the
-- captured flag.

alter table charging.charges
  add column if not exists fiscal_exported boolean not null default false;
alter table charging.charges
  add column if not exists fiscal_exported_at timestamptz;

-- Backfill from the energy detail so existing rows are consistent WITHOUT a
-- re-clone. Rent charges only populate once the final sheet clone re-runs (the
-- "No Fiscal" column is read on the next sync/backfill).
update charging.charges c
set fiscal_exported = d.fiscal_exported
from charging.charge_energy_details d
where d.charge_id = c.id
  and d.fiscal_exported = true;
