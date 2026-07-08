All required reading is done (plan file, both exploration reports, security-ops.md, data-model.md, `enel_helpers.py`/`edp_helpers.py`, `gsheets.py`, current `sheets-loader.ts`, `package.json`). Design follows.

---

# Phase 2 design — Drive integration & comprovante pipeline (server-side TS)

## 0. Decisions made in this design (flag for adversarial review)

| # | Decision | Rationale |
|---|---|---|
| D1 | **PDF text extraction: `unpdf`** (^1.3) | Serverless-first build of pdf.js by unjs: no worker files, no native deps, per-page text via `extractText(data, { mergePages: false })`. `pdf-parse` 1.1.1 is unmaintained + has the debug-entrypoint crash (reads a test file on import); raw `pdfjs-dist` needs legacy-build + worker shims on Vercel Node. Risk: whitespace/token order differs from n8n's extractor (pdf-parse) → regexes must be validated against real fixture PDFs (acceptance gate below). |
| D2 | **Fractional n8n page numbers → `(page_number int, segment_index int)`** | n8n emits `page 1.5` for the 2nd débito-automático segment on page 1; `receipts.page_number` is `integer` in the designed schema. Store physical page + `segment_index` (default 0), `UNIQUE (document_id, page_number, segment_index)`. Lossless, no numeric page hack. |
| D3 | **Pending-confirm state = new enum value `charges.status = 'conciliado'`** (label "Conciliado — aguardando confirmação") | Pipeline (service role) may set OPEN→`conciliado` only. Only the human RPC `confirm_receipt_match` moves `conciliado`→`pago` (named actor in `audit_events`). Satisfies "nothing auto-matched reaches pago without a named human". |
| D4 | **No external queue.** `documents.processing_status ('pending','processed','needs_review','failed')` + the 15-min cron sweep IS the queue | Upload route processes inline (budget ~8s / ≤20 pages); anything slower/failed stays `pending` and the drive-poll cron sweeps it. Idempotent by `content_hash` + upserted receipts, so double-processing is harmless. |
| D5 | **Sheet writeback via outbox table `charging.sheet_writebacks`** | The manual-bill flow does 3 external writes (Drive, DB, Sheet). DB is source of truth; the sheet append is enqueued in the same txn as the charge and attempted inline; on failure the cron retries. Never lost, never blocking. |
| D6 | **Meter-reading duplicate-month policy: allow multiple readings per competência; newest wins in views** | Mid-month checks are legitimate (consumption = delta between consecutive readings). Monthly headline = latest reading per (station, competência) ordered by `reading_date desc, created_at desc` (a view, not stored). `replaces_reading_id`/`is_superseded` are used ONLY by an explicit `correct_meter_reading` RPC (audited correction). UI warns (non-blocking) on a same-day duplicate for the same station. |
| D7 | **Ordering for uploads: hash-dedupe check → Drive upload → DB row** | A DB row must never point at a missing file. Orphan Drive files from a mid-flight crash are tolerable and self-healing (retry dedupes by `content_hash` before re-upload; deterministic names allow `findByName` skip). |
| D8 | **Manual-bill sheet row: `values.append` at bottom, `insertDataOption: 'INSERT_ROWS'`, `valueInputOption: 'USER_ENTERED'`, `due_date` in ISO `YYYY-MM-DD`** | Note: the scraper inserts at **row 2 top** (`enel_helpers.py:427 ws.insert_row(..., index=2)`); append-at-bottom is per instruction and safe — the scraper's dup check reads ALL rows (`get_all_values`), so a bottom manual row still blocks a later scraper duplicate insert, **provided due_date matches the scraper's ISO format** (confirmed: `format_date` → `'2026-05-20'`). A3 `formatAndCleanData` keeps re-applying formulas/colors regardless of row position. |
| D9 | **HEIC via `heic-convert` (pure-JS/WASM) before sharp** | sharp's prebuilt Vercel binaries do **not** include HEIF decode (licensing). `heic-convert` → JPEG buffer → sharp pipeline. HEIC capped at 10 MB (memory). |

## 1. Module / file layout

```
lib/google/service-account.ts     # parseServiceAccountKey extracted from sheets-loader.ts (shared, no behavior change to the read loader)
lib/google/clients.ts             # scoped googleapis clients (Drive rw, Sheets rw); read-only Sheets loader UNTOUCHED
lib/drive/client.ts               # uploadFile / downloadFile / listFolder / findByName
lib/drive/naming.ts               # buildMeterPhotoName, buildBillPdfName (+collision suffix), sanitizeDriveName
lib/uploads/validate.ts           # size/MIME/extension/magic-bytes//Encrypt/sha256 (no new dep; 4 signatures hand-rolled)
lib/uploads/meter-photo.ts        # heic-convert + exifr extract + sharp re-encode (EXIF strip)
lib/comprovantes/types.ts         # ParsedReceipt, MatchResult, OpenChargeCandidate
lib/comprovantes/extract.ts       # unpdf per-page extraction + isEncryptedPdf
lib/comprovantes/parse.ts         # 3 parser branches (exact n8n regexes) + parseBrMoney/parseBrDate
lib/comprovantes/normalize-pix.ts # normalizePixKey — port of Apps Script A7
lib/comprovantes/match.ts         # pure ranked matcher (unit-testable, no I/O)
lib/comprovantes/pipeline.ts      # processComprovanteDocument (service-role orchestration)
lib/sheets/faturas-writeback.ts   # FATURAS_HEADERS/FATURAS_EDP_HEADERS manifests + appendManualBillRow + outbox processor
app/api/uploads/meter-photo/route.ts
app/api/uploads/comprovante/route.ts
app/api/uploads/manual-bill/route.ts
app/api/cron/comprovantes-drive-poll/route.ts
app/api/files/[documentId]/route.ts
lib/comprovantes/__tests__/*.test.ts   # fixture-driven parser + matcher tests (vitest, already set up)
```

## 2. lib/drive — service-account Drive v3 client

Auth: reuse `GSHEETS_SA_KEY_B64`. New JWT clients in `lib/google/clients.ts` (the existing readonly loader keeps its own narrow-scope JWT):

```ts
// lib/google/clients.ts
getDriveClient(): drive_v3.Drive        // scope: https://www.googleapis.com/auth/drive
getSheetsRwClient(): sheets_v4.Sheets   // scope: https://www.googleapis.com/auth/spreadsheets
```

```ts
// lib/drive/client.ts — every call passes supportsAllDrives: true (+ includeItemsFromAllDrives on list)
interface DriveFileMeta { id: string; name: string; mimeType: string; size?: number;
                          modifiedTime: string; webViewLink?: string; md5Checksum?: string }

uploadFile(opts: { folderId: string; name: string; mimeType: string; buffer: Buffer;
                   shareAnyoneReader?: boolean }): Promise<{ fileId: string; webViewLink: string }>
// files.create({ requestBody: { name, parents: [folderId] },
//                media: { mimeType, body: Readable.from(buffer) },
//                fields: "id, webViewLink", supportsAllDrives: true })
// If shareAnyoneReader: permissions.create({ fileId, requestBody: { role: "reader", type: "anyone" },
//                                            supportsAllDrives: true }) wrapped in try/catch (non-fatal)
// — exact mirror of Vammo-Enel/gsheets.py:262-269.

downloadFile(fileId: string): Promise<Buffer>          // files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" })
listFolder(folderId: string, opts?: { modifiedAfter?: Date; mimeType?: string }): Promise<DriveFileMeta[]>
// q: "'{folderId}' in parents and trashed=false [and mimeType='...'] [and modifiedTime > '{ISO}']",
// orderBy: "modifiedTime", pageSize 100, follows nextPageToken.
findByName(folderId: string, name: string): Promise<DriveFileMeta | null>   // exact-name q, mirrors gsheets.py:237-244 (escape ')
```

**Permission policy (hard rule):** `shareAnyoneReader` is `true` ONLY for manual-bill PDFs (scraper-ecosystem parity — the sheet's `=HYPERLINK` must open for humans without Drive grants, exactly like `gsheets.py upload_pdf_to_drive`). Meter photos and comprovantes are uploaded with **no** permission call — they inherit folder ACLs; the app serves them via `GET /api/files/[documentId]` (session-gated Drive proxy stream), never a public link.

## 3. Upload routes

All three: `runtime = "nodejs"`, `export const maxDuration = 60`, region GRU. Guard sequence (per security-ops §5): same-origin (Origin/Host check) → `auth()` session → `charging.is_operator` (via user-JWT RPC/lookup) → multipart parse → `validateUpload`.

`lib/uploads/validate.ts`:

```ts
type UploadPolicy = "pdf" | "image";
validateUpload(input: { buffer: Buffer; filename: string; claimedMime: string }, policy: UploadPolicy):
  { ok: true; sniffedMime: string; sha256: string } | { ok: false; status: 400|413|415|422; error: string }
// pdf: ≤25MB, ext .pdf, magic "%PDF-";  image: ≤10MB, ext .jpg/.jpeg/.png/.heic,
// magic FF D8 FF | PNG sig | HEIC ftyp brands. Reject empty. Content-type ALWAYS from sniff.
isEncryptedPdf(buffer): boolean   // scan first 2KB + xref tail for "/Encrypt"; also catch unpdf PasswordException at parse time
sha256Hex(buffer): string
```

Dedupe contract (all routes): before Drive upload, `select id from charging.documents where content_hash = $1` → **200 with the existing `documentId`** and `deduplicated: true` (link to new context where applicable), no re-upload.

### 3.1 `POST /api/uploads/meter-photo`
- Body: multipart `file` + `stationId` (int).
- Flow: validate(image) → HEIC? `heic-convert` → `exifr.parse` (pick `DateTimeOriginal`, GPS) → `sharp(buffer).rotate().jpeg({quality: 82})` re-encode (strips EXIF; `.rotate()` bakes orientation) → hash of the **re-encoded** jpeg → dedupe → Drive upload to `DRIVE_METER_PHOTOS_FOLDER_ID` (`1t7WoWRYxjBYrb8E6onBtfe773r0yNwRC`), name `buildMeterPhotoName(stationId, address, today)` = `'{stationId} - {sanitized address} - {YYYY-MM-DD}.jpg'` (address from `charging.stations`; date `America/Sao_Paulo`; collision → suffix `' -2'`, `' -3'` via findByName loop) → insert `documents` (kind `meter_photo`, source `app_upload`, service role) with `drive_file_id`, `drive_folder_id`, `web_view_link`, exif payload.
- Response 201: `{ documentId, driveFileId, exif: { takenAt, gps }, warnings: string[] }` — warnings computed server-side: photo >24h old, GPS >200m from station coords, EXIF absent (pt-BR strings; excess-of-information — shown before submit, never blocking).
- Reading submit afterwards (photo-first): client calls RPC `charging.create_meter_reading(p_station_id, p_reading_kwh, p_reading_date default current_date, p_name default null → '{id} - {address}', p_photo_document_id NOT NULL, p_notes)`; RPC verifies the document row exists & kind=`meter_photo` & unused, sets `read_by_email = charging.jwt_email()` (responsible = logged-in user), `competencia = date_trunc('month', reading_date)`, copies `photo_taken_at`/`photo_gps` from the document, writes 1 audit event. Duplicate-month policy per **D6**; `correct_meter_reading(p_reading_id, …)` handles supersession.

### 3.2 `POST /api/uploads/comprovante`
- Body: multipart `file` (PDF only).
- Flow: validate(pdf) → `/Encrypt` → create `documents` row `processing_status='needs_review'` + alert (`dedupe_key 'encrypted:{sha256}'`, "comprovante protegido por senha") and return 422-with-documentId; else hash-dedupe → Drive upload to `DRIVE_COMPROVANTES_FOLDER_ID` (`13nbLPM1akfR48YqYAtMKFcOEioD8jPsY` — n8n keeps watching it and writing sheets in parallel; the app **never** writes Comprovante columns to sheets) — name `'{sha256[0..8]}_{sanitized original}.pdf'` (deterministic → retry-skippable) → `documents` row (`kind comprovante`, `processing_status 'pending'`) → **inline** `processComprovanteDocument(documentId)` if pageCount ≤ 20 (else leave `pending` for cron).
- Response 201: `{ documentId, status: 'processed'|'pending'|'needs_review', receipts: [{ page, segment, type, amount, paidAt, outcome: 'auto'|'ambiguous'|'unmatched', chargeId? }] }`.

### 3.3 `POST /api/uploads/manual-bill`
- Body: multipart `file` (PDF) + fields `{ billingAccountId, value, dueDate, nf, competencia, notes? }`.
- Flow: validate(pdf) → resolve account (must be type enel/edp; get `enel_id`|`edp_uc`) → hash-dedupe → **Drive**: canonical name `Fatura-{Enel|EDP}-{id}-{YYYY-MM}.pdf` (month tag from `dueDate`, mirroring `_pdf_filename`/`_month_tag`, `enel_helpers.py:301-313`); **collision policy**: if `findByName` hits (scraper already uploaded that bill) → upload as `Fatura-…-manual-1.pdf` (increment N) and flag `possible_duplicate` in the response — never overwrite the scraper's file; upload with `shareAnyoneReader: true` → **RPC `charging.create_manual_bill`** (below) → enqueue + attempt sheet append (D5/D8).
- Response 201: `{ chargeId, documentId, webViewLink, sheetAppended: boolean, warnings }`.

```sql
charging.create_manual_bill(
  p_billing_account_id uuid, p_amount numeric, p_due_date date, p_nf text,
  p_competencia date, p_document_id uuid, p_notes text) RETURNS uuid
-- SECURITY DEFINER, SET search_path TO 'charging'; guards per goBuy approve_purchase_request template:
--  is_operator() check; account FOR UPDATE; account_type in ('enel','edp');
--  REFUSE if a charge exists with dedupe_key in ('{enel|edp}:{id}:{due_date}', 'manual:{enel|edp}:{id}:{due_date}')
--    (exact pt-BR exception: 'Já existe fatura para essa conta com esse vencimento');
--  INSERT charges (kind energia, amount, due_date, competencia, status 'pendente', source 'manual',
--                  source_document_id, dedupe_key 'manual:{enel|edp}:{id}:{due_date}')
--  INSERT charge_energy_details (nf, fatura_drive_url = webViewLink, fiscal flag FALSE)
--  INSERT sheet_writebacks (charge_id, spreadsheet 'scraper', tab 'Faturas_ENEL'|'Faturas_EDP', payload jsonb, status 'pending')
--  INSERT 1 audit_event (actor = jwt_email()); RETURNS charge id.
```

Sheet append (`lib/sheets/faturas-writeback.ts`): exact column manifests mirrored from `enel_helpers.py:36-42` (`FATURAS_HEADERS`: `enel_id, value, due_date, auto_debit, auto_debit_registration, NF, link_fatura, Financeiro Check, Comprovante, C1..C6, TUSD (kWh), TUSD (R$), TE (kWh), TE (R$), CIP, Sub_Faturamento, Total, Leitura Anterior, Leitura Atual`) and `edp_helpers.py:27-33` (`uc, value, due_date, auto_debit, auto_debit_registration, NF, link_fatura, Financeiro Check, Comprovante, classificacao, modalidade, tipo_fornecimento, TUSD (kWh), TUSD (R$), TE (kWh), TE (R$), CIP, Total, Leitura Anterior, Leitura Atual`). At runtime read row 1 headers and map by name (the scraper itself maps by `col_map`, layout is fixed but map-by-name is cheap insurance). Values: id, `value` pt-BR formatted (`1.042,29`, matching `_float_to_br`), `due_date` ISO, `auto_debit`/`auto_debit_registration` copied from `charging.utility_account_state` when present (excess-of-information) else blank, `NF`, `link_fatura` = `=HYPERLINK("{webViewLink}";"Ver Fatura")` (exact `enel_helpers.py:372` shape), `Financeiro Check` = `FALSE`, everything else blank. Before appending, re-read the tab and skip if `(id, due_date)` already present (scraper-style dup check). `spreadsheets.values.append` bottom, `USER_ENTERED`, `INSERT_ROWS`.

## 4. Comprovante pipeline (`lib/comprovantes/`)

### 4.1 Extraction
```ts
extractPdfText(buffer): Promise<{ pageCount: number; pages: string[] }>   // unpdf extractText(data, { mergePages: false })
```
Whitespace normalization: collapse runs of spaces per line but **preserve line breaks** (the débito-automático label regexes are line-anchored `(.+)` captures). Empty total text (scanned/image comprovante) → `needs_review` ("comprovante sem texto extraível — imagem escaneada").

### 4.2 Parsers — exact n8n regexes (port of `PDF_Comprovante_Processor`)
```ts
interface ParsedReceipt {
  pageNumber: number; segmentIndex: number;                       // D2 — n8n's 1.5 → (1, 1)
  receiptType: "pix" | "ted" | "debito_automatico" | "outro";
  amount: number | null; paidAt: string | null;                   // ISO date
  chavePix?: string; chavePixNormalized?: string; cnpjCpf?: string;
  identificacao?: string; autenticacao?: string; codigoBarras?: string;
  utility?: "enel" | "edp";                                       // barcode routing
  rawText: string;
}
parseComprovantePages(pages: string[]): ParsedReceipt[]
```
Branch dispatch per page: text matches `/comprovante de pagamento de d[eé]bito autom[aá]tico/i` → **branch 2**, else **branch 1**.

1. **PIX/TED** (one receipt per page): `tipo` `/(?:Tipo|Forma)\s*(?:de)?\s*(?:Pagamento|Transação)\s*:?\s*([A-ZÀ-Ú\s]+)/`, fallback `/PIX/i` → pix, `/TRANSFER[ÊE]NCIA/i` → ted; `valor` `/(?:Valor|Total|Quantia)\s*:?\s*R?\$?\s*([\d.,]+)/`; `chave` first-match: `Chave PIX|Chave` label → email `/[\w.]+@[\w.]+/` → CPF `/\b\d{11}\b/` → CNPJ `/\b\d{14}\b/` → UUID `/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/i`; `data` labeled or bare `DD/MM/YYYY`|`DD/MM/YY` (2-digit year → `20YY`) → ISO.
2. **Débito automático**: split page on HEADER `'comprovante de pagamento de débito automático'` / FOOTER `'Em caso de dúvidas'` → one receipt per segment; `valor` `/valor\s+R\$\s*([\d.,]+)/i`; `identificacao` `/Identifica[çc][aã]o no extrato\s+(.+)/`; `data` `/pagamento realizado em\s+([\d/]+)/`; `autenticacao` `/autentica[çc][aã]o\s+([A-F0-9]+)/`.
3. **ELETROPAULO/EDP routing** on branch-2 `identificacao`: contains `'DA ELETROPAULO'` → `utility='enel'`; `'DA EDP'` → `utility='edp'`; the trailing code after the literal = `codigoBarras` (matched against the fatura's `auto_debit_registration`).

Helpers: `parseBrMoney("1.042,29") → 1042.29` (last separator = decimal), `parseBrDate`. `normalizePixKey` (A7 port): email → lowercase-trim; UUID/EVP → lowercase; CNPJ/CPF → digits only; phone → digits with `+55` normalization rules; returns `{ key, keyType }`. **Acceptance gate:** parser output must equal n8n's output on a fixture set of real comprovantes (≥1 per branch, redacted) — D1 risk control.

### 4.3 Matcher (`match.ts`, pure)
```ts
matchReceipt(receipt: ParsedReceipt, candidates: OpenChargeCandidate[]): MatchResult
// OpenChargeCandidate: { chargeId, amount, dueDate, competencia, chavePix, issuerCnpj, agencia, conta,
//                        linhaDigitavel, autoDebitRegistration, valueTolerance }  ← tolerance joined from counterparties
// MatchResult: { outcome: "auto" | "ambiguous" | "none"; chargeId?; rule?; candidateIds?; reasons: string[] }
```
- Candidate pool (pipeline query): charges in `charging` with `status IN ('pendente','boleto_recebido','atrasado')` (**OPEN only**).
- Ranked keys (first rank with ≥1 hit decides): 1 `codigoBarras`/`linha_digitavel` exact (digits-only) vs `linha_digitavel` or `auto_debit_registration` → 2 `chavePixNormalized` = normalized charge/counterparty `chave_pix` → 3 `cnpjCpf` = `issuer_cnpj`/counterparty CNPJ → 4 (`agencia`,`conta`) pair.
- Then filters within the winning rank: **amount** `|receipt.amount − charge.amount| ≤ value_tolerance` (default **0.01**; Kitchen Central **1.00** — per-counterparty column); **date window** `paid_at` day ≥ 25 or ≤ 10 (competência inference: day ≤ 10 → previous month; used to prefer the matching competência when several open months exist).
- Exactly 1 survivor → `auto`; ≥2 → `ambiguous` (candidates listed, `reasons` in pt-BR); 0 → `none`. Rank-1 (linha digitável) matches are exempt from the date window (the barcode is globally unique).

### 4.4 Pipeline orchestration (`pipeline.ts`, service-role)
```ts
processComprovanteDocument(documentId: string): Promise<{ receipts: number; auto: number; review: number }>
```
Load bytes (Drive `downloadFile`) → encrypted/empty guards → extract → parse → for each `ParsedReceipt`: **upsert** `charging.receipts` on `(document_id, page_number, segment_index)` (re-run safe) → run matcher → outcomes:
- `auto` → insert `payments` (`source 'auto_match'`, `created_by_email 'system:comprovante-pipeline'`) + `UPDATE charges SET status='conciliado'` **only from an OPEN status** (state-machine guard) + receipt `match_status='auto_matched'` + 1 audit event with rule/tolerance/candidates in `detail`. **Never 'pago'** (D3).
- `ambiguous`/`none` → receipt `match_status='needs_review'` (candidates in `match_notes`) → surfaces in `/revisao/comprovantes`.
Finish: `documents.processing_status='processed'` (`needs_review` if any receipt needs review; `failed` + `processing_error` on throw). Human RPCs consuming this: `confirm_receipt_match(charge_id, receipt_id)` (`conciliado`→`pago`, named actor), `reject_receipt_match`, `match_receipt_to_charge` / `unmatch_receipt` (deep-dive add/remove bindings).

### 4.5 Two ingestion paths, one pipeline
(a) upload route (§3.2, inline-or-pending); (b) **`GET /api/cron/comprovantes-drive-poll`** (Vercel cron `*/15`, `Authorization: Bearer CRON_SECRET` constant-time check, `charging.claim_job('comprovantes-drive-poll', 600)` lease): cursor = `charging.sync_cursors['comprovantes-drive-poll']`; `listFolder(COMPROVANTES, { modifiedAfter: cursor − 2min })` (overlap for clock skew) → skip files whose `drive_file_id` already in `documents` (no download) → download, validate, sha256-skip, insert `documents` (`source 'drive_poll'`) → process; **also sweeps** `documents.processing_status='pending'` older than 2 min (D4) and retries `sheet_writebacks` `pending/failed` (attempts < 5, backoff). Advance cursor to max `modifiedTime` seen on success. n8n keeps processing the same folder into sheets in parallel — no conflict: DB dedupe is by hash; the app never writes sheet Comprovante columns.

## 5. Schema deltas this scope needs (coordinate with the schema workstream; all in `charging`)

- `documents`: replace `storage_bucket`/`storage_path` with `drive_file_id text NOT NULL UNIQUE`, `drive_folder_id text NOT NULL`, `web_view_link text`, add `processing_status text NOT NULL DEFAULT 'pending' CHECK (in pending|processed|needs_review|failed)`, `processing_error text`, `processed_at timestamptz`, `exif jsonb`.
- `receipts`: add `segment_index int NOT NULL DEFAULT 0`; UNIQUE → `(document_id, page_number, segment_index)` (D2).
- `charges.status` enum: add `'conciliado'` (D3) — TS `ChargeStatus` in `lib/domain/enums.ts` gains it too; label in `lib/labels.ts`.
- `meter_readings`: add `photo_taken_at timestamptz`, `photo_gps jsonb`, `photo_warnings text[]`.
- New: `sheet_writebacks (id, charge_id, spreadsheet text, tab text, payload jsonb, status text, attempts int, last_error text, created_at, completed_at)`; `sync_cursors (job_name text pk, cursor timestamptz, updated_at)`.
- Semantics fix (other workstream, pipeline honors it): `charge_energy_details.financeiro_check` → fiscal-export flag (`fiscal_exported_at`); charge status derives from `utility_account_state.billStatus`, **not** from this flag (`normalize.ts:1260` change); this pipeline never reads or writes it.

## 6. Library picks (add to `package.json`)

| Lib | Version | Why / notes |
|---|---|---|
| `unpdf` | `^1.3.2` (verify latest at install) | D1. Per-page text, serverless pdf.js build, zero native deps. |
| `sharp` | `^0.34.5` | Vercel-supported prebuilt linux-x64 binaries; Next 15 auto-externalizes sharp (webpack prod build already in use — no config change expected; smoke-test on a preview deploy as an early task). Re-encode strips EXIF by default; `.rotate()` bakes orientation. |
| `exifr` | `^7.1.3` | `DateTimeOriginal` + GPS extraction pre-strip; pure JS, tiny. |
| `heic-convert` | `^2.1.0` | D9 — HEIC→JPEG before sharp (sharp prebuilds lack HEIF decode). |
| (no new dep) | — | Magic-byte sniffing hand-rolled (4 signatures); `googleapis ^173` and `jose ^5.10` already present. |

## 7. Failure modes

| Failure | Detection | Handling |
|---|---|---|
| SA lacks Drive write (403 on `files.create`) | Drive error status | 502 with pt-BR actionable message ("service account sem acesso à pasta — ver setup"); no DB row (D7); alert row |
| Crash between Drive upload and DB insert | Retry hits hash-dedupe/`findByName` | Orphan file tolerated; retry skips re-upload; deterministic names make it idempotent |
| Sheet append fails after charge created | `sheet_writebacks.status='failed'` | Outbox retry in cron (≤5, backoff) + alert after exhaustion; charge remains valid (DB is truth) |
| Encrypted PDF (`/Encrypt` or PasswordException) | validate/extract | `needs_review` document + review-queue item "documento protegido por senha"; never silently dropped |
| Scanned/imagem comprovante (empty text) | `pages.join('').trim()===''` | `needs_review` "sem texto extraível" |
| Parser regex misses (layout drift vs n8n) | Receipt with null amount/date | receipt `needs_review` + `raw_text` stored for debugging; fixture acceptance gate pre-launch |
| Double processing (inline + cron race, or re-upload) | — | Receipts upserted on `(document_id, page, segment)`; payments `UNIQUE (charge_id, receipt_id)`; status guard OPEN→`conciliado` only — fully idempotent |
| n8n processes the same file in parallel | By design | n8n writes sheets, app writes `charging`; no shared writes; DB hash dedupe |
| Scraper later scrapes a manually-entered bill | Sheet dup-check (id, ISO due_date) blocks the sheet row; sync job sees dedupe_key clash `enel:{id}:{due}` vs existing `manual:` | Sync flags `possible_duplicate` review item instead of inserting a second charge |
| Drive name collision on manual bill | `findByName` hit | Suffix `-manual-N` + `possible_duplicate` warning (never overwrite scraper file) |
| Vercel timeout mid-pipeline | doc stuck `pending` | Cron sweep resumes (idempotent); `maxDuration=300` on cron route, 60 on uploads |
| Drive poll cursor misses files (clock skew/pagination) | — | 2-min overlap window + `drive_file_id` skip set; full-folder resync possible by nulling cursor |
| HEIC decode failure / EXIF absent | heic-convert throw / exifr null | 415 with message / non-blocking warning stored in `photo_warnings` |
| Auto-match wrong charge | Human gate | `conciliado` never becomes `pago` without `confirm_receipt_match` by a named operator; `unmatch_receipt` reverses (audited) |

## 8. Setup steps for Gabriel (blocking, before deploy)

1. **Drive grants**: give the SA (`client_email` inside `GSHEETS_SA_KEY_B64`) **Content Manager** on the three folders: meter photos `1t7WoWRYxjBYrb8E6onBtfe773r0yNwRC`, comprovantes `13nbLPM1akfR48YqYAtMKFcOEioD8jPsY`, bills `1AB8ok7Dl5euKe-_qt3axEeXPi1f4KbaS`. If any folder lives in a user's **My Drive** (not a Shared Drive), share it with the SA as Editor and note the caveat: SA-created files count against the SA's own 15 GB quota — verify with one test upload per folder (make this a scripted smoke test).
2. **Sheets grant**: SA → **Editor** on the scraper spreadsheet (`SCRAPER_SPREADSHEET_ID`) — currently Viewer; needed for `values.append` to Faturas_ENEL/EDP.
3. **Vercel env**: `DRIVE_METER_PHOTOS_FOLDER_ID`, `DRIVE_COMPROVANTES_FOLDER_ID`, `DRIVE_BILLS_FOLDER_ID`, `CRON_SECRET` (+ Supabase vars from the schema workstream). Add cron `*/15 * * * *` → `/api/cron/comprovantes-drive-poll` in `vercel.json`.
4. **Fixtures**: provide ≥3 real comprovante PDFs (one per parser branch: PIX/TED, débito automático multi-segment, ELETROPAULO/EDP) + 1 encrypted PDF, redacted, for the parser acceptance tests.
5. Confirm the scraper spreadsheet locale is pt-BR (so `USER_ENTERED` parses `1.042,29` and `FALSE` checkbox correctly) — one manual test append on a staging copy.

### Critical Files for Implementation
- C:/Users/gabri/OneDrive/Desktop/Vammo/eletron/lib/ingest/sheets-loader.ts (SA key parsing to extract/share; read loader stays untouched)
- C:/Users/gabri/OneDrive/Desktop/Vammo/Vammo-Enel/enel_helpers.py (FATURAS_HEADERS:36-42, =HYPERLINK:372, dup-check/append:408-454, _pdf_filename:311-313 — writeback manifests mirror these)
- C:/Users/gabri/OneDrive/Desktop/Vammo/Vammo-Enel/gsheets.py (upload_pdf_to_drive + anyone-reader permission:247-270, findByName:237-244 — Drive client parity source)
- C:/Users/gabri/OneDrive/Desktop/Vammo/Vammo-Enel/n8n/PDF_Comprovante_Processor.json (exact parser regexes + segmentation being ported)
- C:/Users/gabri/OneDrive/Desktop/Vammo/eletron/docs/superpowers/specs/appendix/data-model.md (documents/receipts/payments/meter_readings DDL the deltas in §5 amend)
- C:/Users/gabri/OneDrive/Desktop/Vammo/eletron/docs/superpowers/specs/appendix/security-ops.md (upload validation §5, roles, claim_job/CRON_SECRET contracts)