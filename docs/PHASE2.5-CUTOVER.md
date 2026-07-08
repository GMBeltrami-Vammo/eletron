# Eletron Phase 2.5 — Cutover ritual (sheets → Supabase, one-way)

This is the one session that flips eletron from "reads the Google Sheets" to "Supabase-only test environment" and turns the sheets off for good (decision #25).
After it, the app never reads or writes any Google Sheet again; the scraper keeps running but no longer feeds this app (its data freezes at the clone — accepted, decision #25/#28).
Everything up to step 4 is reversible (set `REPOSITORY_BACKEND` back to `sheets`); step 4 onward is the point of no return for sheet data.

All the R0–R4 code already ships dormant behind `REPOSITORY_BACKEND=sheets`, so nothing below changes app behavior until you flip the flag.

## Pre-flight (Gabriel-held secrets/grants)

- [ ] `N8N_INGEST_SECRET` set in Vercel Production (`openssl rand -base64 32`) — the webhook Bearer.
- [ ] `METABASE_API_KEY` (+ `METABASE_URL` if not the default `https://metabase.vammo.com`) set in Vercel Production — the daily station/box sync.
- [ ] Service account `sheets-api-service@silent-effect-492609-t1…` granted **Reader** on the shared drive that holds n8n's cobrança archive folder (`0ACD4zi4ran4EUk9PVA` → `1DIeZY…`) so the webhook can download the PDF the AI already uploaded.
- [ ] Redeploy after setting env vars (they only take effect on the next build).

## Step 1 — Final clone (populate `charging` from the live sheets, one last time)

Run the existing sync once against the live sheets — this is the ONLY remaining permitted sheet read.

```
# locally, with the sheets SA env present (or trigger the old sync path once):
npx tsx scripts/backfill.ts        # runs runSheetSync against the live sheets
```

Verify the clone counts (Supabase SQL editor or ask me via MCP):

```sql
select count(*) from charging.stations;                                   -- ~300
select account_type, count(*) from charging.billing_accounts group by 1;  -- ~254 enel / 17 edp / 244 rent / 13 third_party
select count(*) from charging.billing_accounts where account_type='energy_enel' and station_id=553;  -- 3
select count(*) from charging.charges;                                     -- > 800
-- no human 'pago' without a payment behind it:
select count(*) from charging.charges c
  where c.status='pago' and c.status_source='rpc'
    and not exists (select 1 from charging.payments p where p.charge_id=c.id);  -- 0
```

## Step 2 — Re-run migration 8's `rent_manual` seed (contracts were empty at migration time)

Migration 8 added `contracts.rent_manual` + a name-pattern seed, but it ran BEFORE the clone, against an empty `contracts` table (it hit 0 rows — expected). Re-run just the seed now that contracts exist:

```sql
update charging.contracts c
set rent_manual = true
from charging.counterparties cp
where c.counterparty_id = cp.id
  and (cp.name ilike '%ipiranga%' or cp.name ilike '%smart kitchen%'
       or c.address ilike '%ipiranga%' or c.address ilike '%smart kitchen%');

select cadastro_id, address, rent_manual from charging.contracts where rent_manual;  -- eyeball
```

This seed is best-effort — the "%ipiranga%" address match can over-hit the Ipiranga neighborhood, and "Smart Kitchens" stations are NOT "Kitchen Central" (a third-party energy counterparty).
Curate the result with the contract-page toggle (Ipiranga + Smart Kitchens contracts must end up `true`; anything wrongly flagged set back to `false`).

## Step 3 — Swap the n8n final node to the webhook (Gabriel, in n8n)

Replace the whole `Split Out → If1 → Edit Fields1 → Append (2_Pagamentos)` tail with a single **HTTP Request** node hanging off the existing **Edit Fields** node (which already carries `dados` + `webViewLink` + `nome_arquivo` + `remetente`).

- **Method**: POST
- **URL**: `https://<eletron-domain>/api/ingest/cobrancas`
- **Header**: `Authorization: Bearer {{$env.N8N_INGEST_SECRET}}` (or the literal secret)
- **Body** (JSON): the AI output verbatim, plus two envelope fields:
  - the Drive Upload node's file **`id`** → `drive_file_id`
  - the Gmail trigger's **message id** → `gmail_message_id`

### Payload contract

```jsonc
{
  "cobrancas": [                      // the AI array, keys verbatim (accented/spaced OK)
    {
      "status": "MATCHED",            // MATCHED | UNIDENTIFIED | NOT_A_BILL
      "cadastro_id": 44,
      "swap_station_id": 553,
      "Mês": "Julho", "Ano": "2026",  // day≤10 rule already applied by the AI
      "Tipo de Cobrança": "Aluguel",  // Aluguel | Energia | Aluguel + Energia
      "Parceiro": "…", "CNPJ": "…",
      "Valor": "Documento: 1500,00 / Planilha: 1450,00 / Energia: 120,00",
      "Endereço": "…",
      "Tipo de Pagamento": "Pix",
      "Banco": "…", "Agência": "…", "Conta Corrente": "…",
      "Chave Pix / Código do Boleto": "…"
    }
  ],
  "nome_arquivo": "boleto.pdf",
  "drive_file_id": "1AbC…",           // REQUIRED (unless every cobrança is NOT_A_BILL)
  "web_view_link": "https://drive.google.com/…",
  "remetente": "cobranca@parceiro.com",
  "gmail_message_id": "18f…"
}
```

The webhook is lenient: missing fields tolerated, `dados` may nest the array (object or JSON string), accented/deaccented keys both accepted.
Responses: `200` ok (incl. `NOT_A_BILL` → recorded skipped, no rows); `400` bad JSON; `401` bad/absent Bearer; `422` Drive download / non-PDF (n8n should retry); `500` unexpected.
Idempotent: the document is deduped by sha256, so a redelivery reuses it and re-converges without duplicating charges.

**Convergence (decision #20/#27, C1):** a `MATCHED` `Aluguel` cobrança with `cadastro_id` + month claims the `pag:{cadastro}:{YYYY-MM}:aluguel` key — the SAME key `gerar_mes` uses — so email-first-then-gerar_mes and gerar_mes-first-then-email both land on ONE charge. Everything the webhook creates/touches is `needs_review`; a human clears it in **Revisão → Cobranças**.

## Step 4 — Flip the backend (point of no return for sheet data)

```
vercel env add REPOSITORY_BACKEND production   # value: supabase
vercel --prod                                  # or push any commit to redeploy
```

The app now serves from `charging`. The daily cron is already `metabase-sync → alerts-eval → comprovantes sweep` (no sheet-sync). Rollback before this point = leave the flag `sheets`; after real writes accumulate, rollback loses them (expected).

## Step 5 — Verify live

- **Metabase sync**: /admin → "Sincronizar Metabase" (or wait for the daily cron); confirm `stations.active_boxes` populates and station 360's Metabase card flips from "Sem dados do Metabase".
- **Webhook**: have n8n process one sample email (or `curl` a sample payload with the Bearer); confirm the document + charges appear and land in **Revisão → Cobranças**; reclassify one and confirm it leaves the queue.
- **Payment linkage**: a confirmed comprovante shows its chip on /energia, /pagamentos, station 360 and /alugueis.
- **Rent-manual**: the seeded contracts show "Cobrança manual" and are skipped by Gerar mês (their reminder alert lands in /alertas — R4).

## After cutover

- The sheets are dead to the app. `lib/sheets/faturas-writeback.ts` + the `sheet_writebacks` table stay dormant as the restoration point; do not wire new call sites.
- Scraper/portal data is frozen at the clone date. Energy surfaces carry "dados de energia congelados em {data do clone}" (R3); bill-level alert rules stop firing on data older than 30 days.
- A scraper→Supabase feed to un-freeze energy data is a future scraper-side project (decision #25).
