# Eletron — Test-env #1: Scraper → App Ingestion Feed — Design

Date: 2026-07-09.
Status: design approved by Gabriel (dual-write + same charging schema); pending spec review, then build.
Un-freezes the scraper data that decision #25 froze — this is the "scraper→Supabase feed (future)" #25 anticipated.

## Goal

Let the Vammo-Enel scrapers (`scraperEnel`, `scraperEDP`) send new bill data to eletron so the app stops depending on the one-time clone and reflects fresh scrapes.
Gabriel: "vincular meu scraper: como eu envio novas informações?"

## Output contract (verified from the scrapers)

The scrapers write one Google Sheet (no HTTP anywhere today — greenfield).
Per installation they produce: an **account-state row** (`enel_data`/`edp_data` tab) and 0..N **fatura rows** (`Faturas_ENEL`/`Faturas_EDP`).
Natural keys: account by `enel_id` / `uc`; fatura by `(enel_id, due_date)` / `(uc, due_date)`.
PDFs go to Drive folder `1AB8ok…` (`Fatura-{Enel|EDP}-{id}-{YYYY-MM}.pdf`, anyone-with-link), and the fatura row carries `link_fatura` = `=HYPERLINK("<webViewLink>";"Ver Fatura")`.
"Detected but no PDF" is implicit: an account row with `status`/`last_billing`/`due_date` but **no** fatura row + no Drive PDF.

## Endpoint

`POST /api/ingest/scraper`, `Authorization: Bearer SCRAPER_INGEST_SECRET` (mirrors the n8n cobranças/contratos webhooks; new Vercel env var).
Accepts 1..N installations per call (the scraper streams per-installation; batching is optional).

```jsonc
{ "provider": "enel" | "edp",
  "installations": [
    { "installationKey": "123456789",
      "account": { /* the enel_data/edp_data row dict, verbatim keys */ },
      "faturas": [ { /* the Faturas_ENEL/EDP row dict, verbatim keys */ } ] } ] }
```

The payload deliberately carries **the same row-dicts the scraper already builds for the sheet**, so the app parses them with the existing `normalize.ts` (money/date/auto-debit/composite parsing) — near-zero new parsing, and ingested rows come out identical to cloned rows.

## Processing (reuse + one careful deviation)

1. Assemble the POSTed rows into the raw-tab shape `normalize()` expects (per provider), run `normalize()` → a **partial** `LoadedSnapshot` (just these installations' accounts, states, charges, energy details, monthly consumption).
2. Upsert with the existing sync row-builders (`toUtilityStateRow`, `toChargeRow`, `toEnergyDetailRow`, `toMonthlyConsumptionRow`) on their natural keys — a thin `runScraperIngest(admin, snapshot)` modeled on `runSheetSync` but scoped to the energy entities.
3. **Charges**: dedupe `enel:{id}:{due}` / `edp:{uc}:{due}` — the SAME keys the clone uses (decision #20), so re-POSTs upsert (no dupes) and converge with manual/clone rows. Preserve `status_source='rpc'` stickiness: `toChargeRow(..., { includeStatus:false })` for charges already human-set, so ingest never clobbers a human status/flags/fiscal (partition exactly like `runSheetSync`).
4. **CRITICAL — preserve the station match.** A per-installation POST has no `Vammo_data`/Metabase, so its billing account has no `swap_station_id`. Do NOT upsert `billing_accounts.station_id` / `match_status` from ingest (that would un-match accounts the clone/matching tool already linked). Instead: match the POST to the EXISTING billing account by `enel_id`/`uc`; only INSERT a new account (unmatched → `/revisão › Instalações`) when none exists; never overwrite an existing account's station/match. The scraper-owned account fields (address, email, auto_debit, auto_debit_registration) may update via `utility_account_state`, not the account's station mapping.
5. **Ciclo 1 for free**: an installation with an `account` but no `faturas` → no charge → Q11 shows **Detectada**; the next run's fatura POST advances it to Analisada (decision #33). No placeholder charge is created for detected-only bills.
6. **Station creation**: never (#28) — Metabase remains the station SoT.
7. **PDF**: unchanged — store the Drive link (`extractHyperlinkUrl(link_fatura)` → `charge_energy_details.fatura_drive_url`), surfaced by the Q11 Ciclo drawer + Faturas tab.

## Dual-write + unfreeze (Gabriel's choices)

The scraper KEEPS its Google-Sheet writes and ADDS the POST (dual-write) so the downstream weekly matching + Slack scripts (which read the sheet) keep working.
Ingest lands in the **same `charging` schema** the app reads — the current test environment (#25) — so re-scraped installations overwrite their frozen clone rows and freshness/Ciclo-1/the ≤30-day alert gates come back to life. AMENDS #25 (scraper data no longer frozen once the feed runs).

## Deliverables

- `app/api/ingest/scraper/route.ts` + `lib/ingest/scraper-feed.ts` (assemble → normalize → `runScraperIngest`), with the station-preserve upsert.
- A zod payload schema (lenient, accented/spaced keys mapped) + audit_events row per ingest run.
- **Test harness**: a sample payload (built from a real cloned installation) + `scripts/test-scraper-ingest.ts` that POSTs it and asserts the account state + charge + Ciclo appear; a unit test for the partial-normalize + station-preserve upsert.
- **Python snippet** for the scraper: a `post_to_eletron(provider, installation_row, fatura_rows)` helper (requests + Bearer) the scraper calls alongside its gspread write — Gabriel wires it in (scraper stays his, per #10).
- `SCRAPER_INGEST_SECRET` added to Vercel env (Gabriel provides/sets it) + `.env.example`.
- decisions.md: new decision recording the feed + the #25 amendment.

## Verification

1. Unit: partial-normalize of a sample ENEL + EDP installation → expected account/charge/detail; the station-preserve upsert leaves an already-matched account's `station_id`/`match_status` untouched; dedupe converges with a pre-existing cloned charge (no dupe).
2. `scripts/test-scraper-ingest.ts` against the live charging schema (a throwaway installation id, then cleaned up) → account state + charge + Ciclo Analisada visible; a no-fatura POST → Ciclo Detectada.
3. tsc / eslint / vitest / build green; adversarial review of the upsert (esp. the station-preserve + stickiness); commit + push.

## Out of scope

- Migrating the downstream weekly-matching + Slack scripts off the sheet (dual-write keeps them working).
- A scraper-side scheduler change (stays in Dagster; the POST is added inside the existing run).
- Backfilling history via the feed (the clone already did that; the feed carries new/updated scrapes forward).
