-- Comprovante reformulation (Gabriel 2026-07-10): the app now processes a
-- comprovante PDF in client-driven 10-page chunks with a progress bar (removing
-- the n8n processing part + the 20-page inline cap). `pages_processed` is the
-- durable progress counter (progress = pages_processed / page_count) so the bar
-- survives a reload and the daily sweep can tell how far a crashed upload got.
-- Written by the service role at the end of each chunk; the doc stays
-- processing_status='pending' until the final chunk finalizes it to
-- processed/needs_review (no new enum value — 'pending' already means in-flight).

alter table charging.documents
  add column if not exists pages_processed integer not null default 0;
