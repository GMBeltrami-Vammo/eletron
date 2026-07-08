# Eletron Phase 2 — Cutover runbook

Everything Phase 2 is built, deployed to `main`, and the `charging` schema is live.
This is the short list of steps only you can run to switch the app from reading the Google Sheets to reading Supabase, and to confirm the write flows work end-to-end.
Nothing here is destructive; the sheets pipeline keeps running untouched, and every step is reversible.

## Pre-flight (one-time, already partly done)

- [x] `charging` schema applied on the shared "Vammo Automations" project (`jfdqlnpidynxwqqiblcd`) — 23 tables, RPCs, RLS, isolation verified.
- [x] Service account `sheets-api-service@silent-effect-492609-t1…` granted Content Manager on the 3 Drive folders + Editor on the scraper spreadsheet.
- [x] Vercel Production env vars set: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `CRON_SECRET`.
- [ ] Confirm `DRIVE_METER_PHOTOS_FOLDER_ID`, `DRIVE_COMPROVANTES_FOLDER_ID`, `DRIVE_BILLS_FOLDER_ID` are set in Vercel Production (values in `.env.example`).
- [ ] Add your operator teammates: they're read-only by default; to let someone write (register readings, confirm payments), add them in the app at `/admin → Usuários` once you (admin) can reach it, or seed via SQL.

## Step 1 — Backfill charging from the sheets (populate the DB)

The daily cron (`/api/cron/daily`) runs sheet-sync + alerts-eval. To run it on demand the first time, hit it once with the cron secret (from any terminal; replace `<CRON_SECRET>` and the domain):

```
curl -X POST "https://eletron-eight.vercel.app/api/cron/daily" \
  -H "Authorization: Bearer <CRON_SECRET>"
```

It returns a JSON summary (rows read/upserted per tab, alert counts). Re-running is safe (idempotent upserts).

## Step 2 — Verify the backfill counts

In the Supabase SQL editor (or ask me to run these via MCP), confirm:

```sql
select count(*) from charging.stations;                          -- ~300
select account_type, count(*) from charging.billing_accounts group by 1;  -- ~254 enel / 17 edp / 244 rent / 13 third_party
select count(*) from charging.billing_accounts
  where account_type='energy_enel' and station_id=553;           -- 3 (station 553 has 3 ENEL installs)
select count(*) from charging.charges;                           -- > 800
-- no charge should be 'pago' via a human path without a payment behind it:
select count(*) from charging.charges c
  where c.status='pago' and c.status_source='rpc'
    and not exists (select 1 from charging.payments p where p.charge_id=c.id);  -- 0
```

If these look right, the sheet→charging mapping is faithful.

## Step 3 — Parity check, then flip the backend

While `REPOSITORY_BACKEND=sheets` (current), the app still reads the sheets. Spot-check a few screens (`/estacoes`, a station 360°, `/energia`) look right. Then flip:

```
vercel env add REPOSITORY_BACKEND production   # value: supabase
vercel --prod                                  # or push any commit to redeploy
```

The app now reads `charging`. **Rollback = set it back to `sheets` and redeploy** — the sheets pipeline never stopped, so this is instant and safe (valid up to the first meter-reading/write; after that, new charging-only rows won't exist in the sheets, which is expected).

## Step 4 — Schedule the daily cron

`vercel.json` already declares one daily cron → `/api/cron/daily`. On Vercel Hobby that's the allowed 1/day. Confirm it appears under Project → Settings → Cron Jobs after the deploy. (The scraper refreshes the sheet once nightly, so daily sync is sufficient; there's also an "Atualizar agora" / admin "Executar agora" manual trigger.)

## Step 5 — Verify the write flows (the live checks that need the deploy)

Sign in as yourself (admin). Then:

- **Meter reading** — `/leituras/nova` on your phone: pick a station, take the photo, enter kWh, submit. Confirm the photo lands in the meter-photos Drive folder and the reading appears in `/leituras` with your name. (This is the first real use of the Drive grant.)
- **Comprovante** — `/comprovantes`: upload one of the June PDFs; watch it process; open the deep-dive; confirm an auto-matched receipt, then "Confirmar" flips the charge to Pago (with your name in the audit trail).
- **Manual bill** — `/energia` → "Adicionar fatura manual": attach a bill PDF for an Enel/EDP account; confirm it appears with a "Manual" badge, the PDF is in the bills Drive folder, and a row is appended to `Faturas_ENEL`/`Faturas_EDP`.
- **Gerar mês** — `/pagamentos` → "Gerar mês": pick the month, review the preview (values + formulas + flags), confirm, see the rows created.
- **Alerts** — `/alertas`: acknowledge/resolve one; confirm the lifecycle + your name stick.

## Known follow-ups (Phase 3, documented — not blocking)

- **Fiscal export** (Apps Scripts A1/A2/A6 → FISCAL spreadsheet) stays sheet-side; the app import + the Gerar-mês→`2_Pagamentos` writeback ship in Phase 3. Keep running the sheet-side scripts meanwhile.
- **Email-bill AI ingestion** (boleto_aluguel) and **contract onboarding** (`/alugueis/novo`) are Phase 3.
- **Comprovante parser coverage**: ~25% of pages in a large bundle don't yield an amount (cover/summary sheets) and land in review — safe, never a wrong auto-match; the parser can be widened later.
