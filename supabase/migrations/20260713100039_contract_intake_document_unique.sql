-- Novo contrato hardening (adversarial review 2026-07-13): the ingest dedupes
-- the intake by document_id with .maybeSingle(), and the app-upload stageIntake
-- guards by document_id then inserts — a TOCTOU. Without a unique constraint,
-- two concurrent identical-PDF uploads can stage TWO awaiting_extraction rows
-- for one document; the n8n POST's .maybeSingle() then throws on >1 row and the
-- intake wedges (invisible to the pending queue/badge, no recovery UI). Enforce
-- one intake per document — stageIntake's insert-error branch already re-reads
-- and returns the winner, so this makes the race safe.
create unique index if not exists contract_intake_document_idx
  on charging.contract_intake(document_id)
  where document_id is not null;
