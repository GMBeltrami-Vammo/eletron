# Phase 2 — Adversarial review resolutions (AUTHORITATIVE)

Where anything in `schema-writes.md`, `drive-comprovantes.md` or `ux-screens.md` contradicts this file, THIS file wins.
Source: critical-reviewer pass over the approved Phase 2 plan (2026-07-08); findings C1-C3 / H1-H6 / M1-M14 / L1-L8.

## Critical

- **C1 — One dedupe recipe per logical charge.**
  Manual bills use the scraper key `enel:{id}:{due}` / `edp:{uc}:{due}` with `source='manual'` — later scraper import or sheet-sync of the written-back row converges on the same charge (`status_source` protects human state).
  Gerar mês uses the sheet key `pag:{cadastro_id}:{YYYY-MM}:aluguel` — converges with 2_Pagamentos rows.
  The `manual:{uuid}` and `rent:{cadastro}:{YYYY-MM}` recipes in the design docs are void.
- **C2 — Gerar mês writes back to 2_Pagamentos** via the same `sheet_writebacks` outbox (same columns A5 produced, incl. the Pago checkbox column) so the sheet-side A6 rent→FISCAL export keeps receiving rows during the parallel transition.
- **C3 — `meter_readings.name text NOT NULL`** + `p_name` RPC param, default `'{swap_station_id} - {address}'`, editable.
  One Drive filename: `{stationId} - {sanitized address} - {YYYY-MM-DD}.jpg` (+` -N` on collision).

## High

- **H1 — Status re-derivation uses all paid signals**: Comprovante cell non-empty → `pago` (backfill synthesizes receipt/payment from the link); `invoiceHistoryStatuses` consulted for historical rows; decision #16's EDP receipted-after-due rule mirrored into charge status.
  Backfill assertion: zero charges with `status='pago' AND status_source='rpc' AND no payments`.
- **H2 — Pipeline sets `status_source='rpc'` when writing `conciliado`** (sheet-sync must never clobber it); no-downgrade test required.
- **H3 — SupabaseRepository**: `.range()` pagination on every read (PostgREST 1000-row cap; never raise the shared project's global cap); 15-min cache layer; domain ids stay `dedupe_key` strings (DB uuid internal); new entities (meter_readings, documents/receipts/payments, job_runs, user_roles) read via direct `supabaseForUser` queries outside the Repository interface.
- **H4 — Authoritative names**:
  RPCs (15): `create_meter_reading, correct_meter_reading, create_manual_bill, record_payment, unmatch_payment, confirm_charge, update_charge_status, gerar_mes, acknowledge_alert, resolve_alert, mute_alert, set_user_role, assign_station_to_account, resolve_unmatched_charge, claim_job`.
  Upload routes: `/api/uploads/{meter-photo,comprovante,manual-bill}`; Drive proxy: `/api/files/[documentId]`.
  `documents`: `drive_file_id` + `drive_folder_kind` enum + `web_view_link` (folder ID from kind via env).
  Meter EXIF columns: `photo_taken_at timestamptz, photo_gps jsonb, photo_warnings text[]`.
  Poll cursor: `sync_cursors` table. 23 tables in migration 2 (incl. `sheet_writebacks`, `sync_cursors`); `conciliado` enum value in migration 1.
  `create_manual_bill` = drive-comprovantes §3.3 signature (with `p_energy_details jsonb`) + C1 dedupe guard.
- **H5 — No session-token bridge.** Supabase JWT minted per-call, server-side only, inside server actions/routes after `await auth()`; `auth.config.ts` stays callback-free; nothing token-shaped reaches the browser.
  Hardening: minted tokens carry `app:'eletron'`; `charging` RLS policies require it.
- **H6 — Scheduler resilience**: setup precondition "confirm where n8n runs + uptime (if on the nightly-shutdown PC, move schedulers to an always-on host)"; the single Vercel daily cron is a CATCH-UP endpoint (sheet-sync + drive-poll sweep + alerts-eval); self-staleness alert `sheet_sync_stale` (>26h without success).

## Medium (applied)

- M1: CLAUDE.md + decision entry amend the "never write scraper tabs" rule — app writes are append-only to `Faturas_ENEL`, `Faturas_EDP`, `2_Pagamentos`, only via `lib/sheets/faturas-writeback.ts`, tab-name allowlist asserted in code; SA Editor is spreadsheet-wide incl. `6_senhas` → move `6_senhas` out at setup (or protected ranges).
- M2: alert types `manual_bill_sheet_append_failed`, `encrypted_comprovante`, `sheet_sync_stale` added to CHECK + TS enum + labels.
- M3: alerts-eval runs the existing TS `evaluateAlerts()` over the synced snapshot (no SQL re-implementation); alert-count parity in the pre-flip checklist.
- M4: `record_payment` double-submit guard for receiptless payments.
- M5: gerar_mes — pro-rata clamped ≥1/30 (flagged), `LEAST(due_day, days_in_month)`, creation date = `stations.source_created_at`; day-31/February tests.
- M6: fixture PDFs requested at M1 start; extractor fallback = pdfjs-dist legacy with Y-coordinate line assembly.
- M7: clean `REPOSITORY_BACKEND` flip-back only before M2; after M2, write actions are gated on `backend==='supabase'`.
- M8: `/revisao/comprovantes` = Phase 1 appendix queue design + deltas (conciliado badge, charge-picker reuse, Drive proxy links).
- M9: E2E sheet-append runs against a staging copy of the spreadsheet.
- M10: mobile deep-dive shows "Abrir em nova aba" instead of the iframe; page jumps use iframe key-remount.
- M11: `REVOKE EXECUTE … FROM PUBLIC, anon` + `ALTER DEFAULT PRIVILEGES … ON FUNCTIONS` in migration 1.
- M12: matcher is NEW design (parsers are the n8n port); rank-1 linha-digitável documented dormant until Phase 3.
- M13: migration dry-run — check branching cost via MCP first; fallback local `supabase start` shadow DB.
- M14: leituras account picker only when the station has >1 metered account, else NULL.

## Low (applied)

Counts fixed (15 RPCs, 23 tables); stale `*/15` Vercel-cron directives in the design docs are void (n8n schedules); enum literals `energy_enel/energy_edp`; Fluid Compute = verify; `update_charge_status` transition allow-list (conciliado exits only via `confirm_charge`/`unmatch_payment`); Gerar-mês preview surfaces `boxes_synced_at` staleness; decision entry supersedes the storage half of decision #9 and records deliberate anyone-with-link continuation for manual bills; goBuy env-name divergence (`SUPABASE_SECRET_KEY` vs `SUPABASE_SERVICE_ROLE_KEY`) recorded.
