-- Novo contrato — app-owned upload (decisão #48): the app now drops the PDF to
-- Drive + Supabase BEFORE n8n extracts, so an intake exists in a pre-extraction
-- state while the /alugueis/novo page polls. Add 'awaiting_extraction' to the
-- status CHECK; the ingest flips it → 'pending' when n8n POSTs the AI output.
-- Pending-only surfaces (readContratoQueue, countPendingContractIntakes, the
-- partial status index) are unaffected — an awaiting row does not show in the
-- review queue nor inflate the badge until the extraction actually arrives.
alter table charging.contract_intake
  drop constraint if exists contract_intake_status_check;
alter table charging.contract_intake
  add constraint contract_intake_status_check
  check (status in ('awaiting_extraction', 'pending', 'confirmed', 'rejected'));
