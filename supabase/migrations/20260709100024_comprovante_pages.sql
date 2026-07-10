-- Feature C (Gabriel 2026-07-10, test-env #3): isolate multi-page comprovante
-- PDFs into individual one-page PDFs so the EXACT page bound to a charge can be
-- opened reliably (the browser #page=N anchor is fragile). Pages are stored in
-- Supabase (a private Storage bucket), lazy-cached: the /api/files/[id]/page/[n]
-- route splits page n from the whole PDF (still in Drive, decision #17) on first
-- request, uploads the 1-page PDF here, records the path, and serves it; later
-- requests serve straight from Storage. No eager pipeline change / backfill.

insert into storage.buckets (id, name, public)
values ('comprovante_pages', 'comprovante_pages', false)
on conflict (id) do nothing;

create table if not exists charging.document_pages (
  document_id  uuid    not null references charging.documents(id) on delete cascade,
  page_number  integer not null,
  storage_path text    not null,
  byte_size    bigint,
  created_at   timestamptz not null default now(),
  primary key (document_id, page_number)
);

alter table charging.document_pages enable row level security;
-- Read for any authenticated @vammo.com (uniform schema policy); the isolated
-- pages are written by the service role in the page route, so no write policy.
drop policy if exists document_pages_select on charging.document_pages;
create policy document_pages_select on charging.document_pages
  for select to authenticated using (charging.is_vammo_user());
