# Comprovante flow reformulation — chunked large-PDF processing + eager per-page isolation — Design

Date: 2026-07-10
Status: approved (Gabriel 2026-07-10) + built + adversarially reviewed — see decision #41

Gabriel (2026-07-10): "remove the n8n processing part; drop a >40-page comprovante → the app analyzes/processes it, puts it in Drive, and for each match uploads the matched page individually to Supabase; that per-page file is what shows on hover; process in ~10-page steps with a progress bar; it's a cold copy so we can reset the matches and re-match with the same documents; tell me if a Vercel upgrade is needed."

## Verified facts (exploration 2026-07-10)

- The app pipeline (`lib/comprovantes/pipeline.ts`) ALREADY owns extraction + parsing + matching into the `charging` schema — deterministic, no AI.
- "The n8n processing part" = a Gabriel-side n8n workflow (`PDF_Comprovante_Processor.json`) that duplicates it and writes the (now-severed, decision #25) Google-Sheet Comprovante column — dead weight; no app code depends on it. Gabriel disables it.
- Two intake paths today: the app drag-drop (`POST /api/uploads/comprovante`, inline for ≤20 pages, else `pending`) and the `comprovantes-drive-poll` cron (pinged by an n8n `*/15` schedule — NOT a Vercel cron).
- The clone has ZERO comprovante data (`documents`/`receipts`/`payments`/`document_pages` all 0). Nothing to delete; re-matching runs entirely against new uploads.
- 647 charges are `pago` with `status_source='sync'` and NO bound payment — paid from the clone's billStatus derivation, not a comprovante. The matcher only matches OPEN charges, so it would skip all 647.
- Vercel plan is **Hobby**. Function-duration is NOT the blocker for chunked work (each 10-page chunk is seconds). The real platform limit is the **4.5 MB request-body cap** on the upload POST (identical on Pro) — accepted as-is per Gabriel (fine for ~40-page vector receipts; very large PDFs would fail).
- Per-page isolation already exists lazily: `GET /api/files/[documentId]/page/[n]` splits with `pdf-lib` → uploads to the private Supabase Storage bucket `comprovante_pages` → records `charging.document_pages` (migrations 24/25).
- `parseComprovantePages` derives `page_number` from the array index — chunking a slice REQUIRES a `startPage` offset or every page is mislabelled.

## Decisions (Gabriel)

1. Intake = **app drag-drop only**. Delete the drive-poll cron; Gabriel disables the n8n workflow. Drive becomes an app-owned archive.
2. Big-PDF upload: **keep the current server-buffered upload** (accept the ~4.5 MB ceiling; no direct-to-storage this round).
3. Match against `pago`-without-comprovante charges too (least-destructive; no mass status reset), plus a reversible **"Resetar comprovantes"** action for re-running the stress test.
4. Hover shows the **isolated one-page PDF** from Supabase.

## Design

### 1. Chunked pipeline (10 pages/step, client-driven, progress bar)
- **Migration 27**: `documents.pages_processed int not null default 0` (no new enum value — `pending` already means in-flight; the idempotent daily sweep is the crash-recovery net).
- `parseComprovantePages(pages, startPage = 1)` — page numbers = `startPage + index`. The one mandatory correctness fix.
- Extract only the chunk's pages via unpdf's `getDocumentProxy` + `getPage(n)` loop over `[from, to)` (no new dep; avoids materializing all pages).
- Refactor `processComprovanteDocument` → `processComprovanteChunk(documentId, from, to, admin)`: download the PDF once, extract+parse pages `[from,to)`, load candidates once, match each receipt, eager-isolate matched pages, bump `pages_processed`, return `{ processed, total, matched, done }`. Load the source `PDFDocument` ONCE and `copyPages` all matched pages in the chunk (fixes `splitPdfPage`'s per-page full-load hotspot).
- **Endpoint** `POST /api/uploads/comprovante/chunk` (same-origin + session + operator) — `{ documentId, from, to }` → runs one chunk → returns progress.
- **Upload route** stops inline-processing: it stores the whole PDF to Drive + inserts the `documents` row (`processing`, `page_count`) and returns `{ documentId, pageCount }`. The **client** (`upload-card.tsx`) then loops chunks (0–10, 10–20, …) rendering a progress bar (`pages_processed / page_count`), and finalizes the doc status when done. `pages_processed` is the durable backstop if the tab closes; the daily-cron `sweepComprovantes` stays as a crash-recovery net (extended to resume `processing` docs).

### 2. Eager per-match page → Supabase
In the auto-match branch, after binding the payment: `copyPages` the matched receipt's page from the already-loaded source doc → upload to `comprovante_pages` → upsert `document_pages` (same path `{documentId}/{page}.pdf` + onConflict the route uses). The lazy `/page/[n]` route stays as the fallback for any page not eagerly materialized (e.g. later hover on an unmatched page).

### 3. Matcher reaches already-paid charges
`loadOpenCandidates` → `loadCandidates`: OPEN charges (as today) PLUS `pago` charges that have NO bound comprovante (no `payments` row with a `receipt_id`). On a unique match: bind payment + receipt + isolate page as usual; the OPEN→`pago` flip is unchanged (it only fires from an open status, so an already-`pago` charge simply stays `pago` — now with a comprovante). Ambiguity from the wider pool still → `needs_review`. This is a permanent improvement (a late comprovante can attach to a prematurely-paid charge) and satisfies decision #29 for the clone's sync-pago rows.

### 4. Hover preview
Add a hover-card to `ComprovanteChip` (used on /pagamentos, drawer, /energia, station 360, /alugueis) embedding `<iframe src="/api/files/{documentId}/page/{page}">` — the row already carries `documentId` + `page` in `PaymentLinkSummary`. Mount lazily on hover-open; the route's cache + `document_pages` make it a cheap cache hit (pre-warmed by the eager upload). Mobile falls back to the existing "open in new tab".

### 5. Reset ("Resetar comprovantes")
An operator action + `reset_comprovante_matches` RPC: delete `payments` where `source='auto_match'` (and manual comprovante payments) + reset their receipts + delete `document_pages` rows; the server also purges the `comprovante_pages` Storage bucket; charges that were flipped OPEN→pago by a comprovante walk back (via the existing unmatch logic), sync-pago charges stay pago. Audited. For iterating the stress test.

### 6. Remove n8n
Delete `app/api/cron/comprovantes-drive-poll/route.ts`. Keep `CRON_SECRET` (daily cron still uses it) and the daily `sweepComprovantes`. Gabriel disables the n8n `PDF_Comprovante_Processor` + the `*/15` schedule (his side).

## Vercel
Hobby, **no upgrade needed** — client-driven 10-page chunks keep every request seconds-long, well under the limit. The only ceiling is the 4.5 MB upload body (accepted). Supabase Storage has no Vercel-side limit.

## Verification
- Unit: `parseComprovantePages` offset correctness; `splitPdfPage`/load-once-copy-many.
- DB (rolled back): chunk processing of a seeded multi-page doc; matcher binding a `pago`-without-comprovante charge; reset unbinds cleanly.
- Gate: tsc/eslint/vitest/build.
- Browser: drop a >40-page PDF → progress bar advances → matches bind → hover shows the isolated page; reset clears; re-drop re-matches.

## Out of scope
- Direct-to-storage upload for >4.5 MB PDFs (deferred; accepted ceiling).
- OCR for scanned/image comprovantes (still → needs_review).
- A senders-style admin CRUD.
