-- Manual comprovante↔charge match log (Gabriel 2026-07-14): capture every MANUAL
-- receipt binding so the matcher can be improved from real human decisions —
-- what the receipt looked like (parsed keys/value) vs the charge it was tied to,
-- especially cases the auto-matcher missed (e.g. a rent payment whose CNPJ ≠ the
-- charge's stored PIX key). Snapshots are frozen at bind time (append-only).
--
-- Chokepoint: an AFTER INSERT trigger on charging.payments for source='manual'
-- with a bound receipt. Manual binds go through record_payment (source='manual';
-- also used by resolveReceiptGroup); the auto-matcher inserts source='auto_match'
-- directly, so this logs manual binds ONLY. No change to record_payment.

create table if not exists charging.manual_match_log (
  id uuid primary key default gen_random_uuid(),
  logged_at timestamptz not null default now(),
  actor_email text,
  payment_id uuid,
  receipt_id uuid not null,
  charge_id uuid not null,
  document_id uuid,
  -- receipt (parsed) snapshot
  receipt_type text,
  receipt_amount numeric,
  receipt_paid_at date,
  receipt_chave_pix text,
  receipt_cnpj_cpf text,
  receipt_banco text,
  receipt_agencia text,
  receipt_conta text,
  receipt_codigo_barras text,
  receipt_match_notes text,
  -- charge snapshot (why the auto-matcher may have missed it)
  charge_dedupe_key text,
  charge_kind text,
  charge_amount numeric,
  charge_competencia date,
  charge_station_id integer,
  charge_issuer_cnpj text,
  charge_chave_pix text,
  charge_linha_digitavel text,
  charge_auto_debit_registration text,
  charge_bill_auto_debit text
);

alter table charging.manual_match_log enable row level security;
-- No policies → only the service role / SECURITY DEFINER trigger can touch it
-- (internal telemetry; queried server-side to tune the matcher).

create or replace function charging.log_manual_match()
returns trigger
language plpgsql
security definer
set search_path to 'charging'
as $$
begin
  if new.source <> 'manual' or new.receipt_id is null then
    return new;
  end if;
  insert into charging.manual_match_log (
    actor_email, payment_id, receipt_id, charge_id, document_id,
    receipt_type, receipt_amount, receipt_paid_at, receipt_chave_pix, receipt_cnpj_cpf,
    receipt_banco, receipt_agencia, receipt_conta, receipt_codigo_barras, receipt_match_notes,
    charge_dedupe_key, charge_kind, charge_amount, charge_competencia, charge_station_id,
    charge_issuer_cnpj, charge_chave_pix, charge_linha_digitavel,
    charge_auto_debit_registration, charge_bill_auto_debit
  )
  select
    new.created_by_email, new.id, new.receipt_id, new.charge_id, r.document_id,
    r.receipt_type::text, r.amount, r.paid_at, r.chave_pix, r.cnpj_cpf,
    r.banco, r.agencia, r.conta, r.codigo_barras, r.match_notes,
    c.dedupe_key, c.kind::text, c.amount, c.competencia, c.station_id,
    c.issuer_cnpj, c.chave_pix, c.linha_digitavel,
    coalesce(ced.auto_debit_registration, ba.auto_debit_registration),
    ced.auto_debit::text
  from charging.receipts r
  join charging.charges c on c.id = new.charge_id
  left join charging.charge_energy_details ced on ced.charge_id = c.id
  left join charging.billing_accounts ba on ba.id = c.billing_account_id
  where r.id = new.receipt_id;
  return new;
end;
$$;

drop trigger if exists trg_log_manual_match on charging.payments;
create trigger trg_log_manual_match
  after insert on charging.payments
  for each row execute function charging.log_manual_match();

-- One-time backfill of the manual binds that already exist (the trigger only
-- fires on new inserts). WHERE-scoped; safe to run once.
insert into charging.manual_match_log (
  actor_email, payment_id, receipt_id, charge_id, document_id,
  receipt_type, receipt_amount, receipt_paid_at, receipt_chave_pix, receipt_cnpj_cpf,
  receipt_banco, receipt_agencia, receipt_conta, receipt_codigo_barras, receipt_match_notes,
  charge_dedupe_key, charge_kind, charge_amount, charge_competencia, charge_station_id,
  charge_issuer_cnpj, charge_chave_pix, charge_linha_digitavel,
  charge_auto_debit_registration, charge_bill_auto_debit
)
select
  p.created_by_email, p.id, p.receipt_id, p.charge_id, r.document_id,
  r.receipt_type::text, r.amount, r.paid_at, r.chave_pix, r.cnpj_cpf,
  r.banco, r.agencia, r.conta, r.codigo_barras, r.match_notes,
  c.dedupe_key, c.kind::text, c.amount, c.competencia, c.station_id,
  c.issuer_cnpj, c.chave_pix, c.linha_digitavel,
  coalesce(ced.auto_debit_registration, ba.auto_debit_registration),
  ced.auto_debit::text
from charging.payments p
join charging.receipts r on r.id = p.receipt_id
join charging.charges c on c.id = p.charge_id
left join charging.charge_energy_details ced on ced.charge_id = c.id
left join charging.billing_accounts ba on ba.id = c.billing_account_id
where p.source = 'manual' and p.receipt_id is not null;
