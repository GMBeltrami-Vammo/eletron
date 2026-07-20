-- Hard fix for older faturas (Gabriel 2026-07-18): energy faturas with a due
-- date before 01/05/2026 are the pre-cutoff BACKLOG — we won't chase their
-- comprovantes. Mark them "encerradas": a per-fatura flag on charge_energy_details
-- that the Ciclo reads as Paga (comprovante dispensado) and the fiscal send/verify
-- SKIP (never send, never demote). Also flip fiscal_exported=true so the
-- "Enviado ao fiscal" column shows them handled.
--
-- Per-fatura flag (not a date rule) per Gabriel's choice — explicit + auditable.
-- The backfill below closes the CURRENT pre-cutoff faturas; it is idempotent and
-- can be re-run if the (frozen) clone ever gains more old-dated faturas.

alter table charging.charge_energy_details
  add column if not exists legacy_closed boolean not null default false;

comment on column charging.charge_energy_details.legacy_closed is
  'Pre-01/05/2026 backlog fatura closed out (Gabriel 2026-07-18): Ciclo reads it as Paga (comprovante dispensado); the fiscal send/verify skip it (no send, no demote).';

-- Backfill: close out the pre-cutoff energy faturas + mark them fiscal-exported.
update charging.charge_energy_details ced
   set legacy_closed = true,
       fiscal_exported = true,
       fiscal_exported_at = coalesce(ced.fiscal_exported_at, now())
  from charging.charges c
  join charging.billing_accounts a on a.id = c.billing_account_id
 where ced.charge_id = c.id
   and a.account_type in ('energy_enel', 'energy_edp')
   and c.due_date < date '2026-05-01'
   and ced.legacy_closed is distinct from true;

-- Mirror the charge-level fiscal_exported flag (the "Enviado ao fiscal" column
-- reads either; keep both in sync).
update charging.charges c
   set fiscal_exported = true, updated_at = now()
  from charging.billing_accounts a
 where a.id = c.billing_account_id
   and a.account_type in ('energy_enel', 'energy_edp')
   and c.due_date < date '2026-05-01'
   and c.fiscal_exported is distinct from true;
