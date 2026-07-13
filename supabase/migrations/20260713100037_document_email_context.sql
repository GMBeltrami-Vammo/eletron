-- Boletos por e-mail (traceability, decisão #47 follow-up): tag every
-- API-received document with the e-mail addresses it arrived through. Today
-- the document keeps only email_message_id, and just the FIRST external
-- address survives (charges.email_sender, for matching) — the full involved
-- list lived only in the audit trail. email_context holds the whole set so a
-- document traces back to who sent it, accumulating across redeliveries
-- (same PDF forwarded from a second address unions in).
--   { "addresses": ["a@x.com", ...], "remetente_raw": "<original string>" }
-- jsonb (not a text[] column) mirrors the documents.exif / charges.raw pattern
-- and stays future-proof if subject/body are added later without a migration.
alter table charging.documents
  add column if not exists email_context jsonb;

comment on column charging.documents.email_context is
  'E-mail provenance for API-ingested docs: {addresses:text[], remetente_raw:text}. Accumulates across redeliveries (#47).';
