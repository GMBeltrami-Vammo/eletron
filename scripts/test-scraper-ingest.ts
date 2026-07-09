/**
 * scripts/test-scraper-ingest.ts — smoke test for POST /api/ingest/scraper
 * (decision #34). Builds a realistic ENEL payload (one state-2 installation with
 * a full Faturas_ENEL row dict + one state-1 installation with faturas:[]) and
 * POSTs it to a running dev server, printing the returned stats.
 *
 * This WRITES to whatever `charging` the server is pointed at — run only against
 * a dev/test server, ideally with a throwaway installation id you can clean up.
 *
 * Run (do NOT commit the secret):
 *   SCRAPER_INGEST_SECRET=... npx tsx scripts/test-scraper-ingest.ts
 * Optionally override the target:
 *   SCRAPER_INGEST_URL=http://localhost:3000/api/ingest/scraper
 */

const SECRET = process.env.SCRAPER_INGEST_SECRET;
const TARGET =
  process.env.SCRAPER_INGEST_URL ?? "http://localhost:3000/api/ingest/scraper";

// A throwaway installation id (900000000+) so a live run is easy to identify/clean.
const STATE2_ID = "900000001";
const STATE1_ID = "900000002";

const payload = {
  provider: "enel",
  installations: [
    {
      // ── state 2 (Analisada): account + fatura + Drive PDF ──
      installationKey: STATE2_ID,
      account: {
        enel_id: STATE2_ID,
        swap_station_id: "", // external — the scraper does not write it
        station_status: "Ativo",
        address: "Rua de Teste do Feed, 100 - São Paulo",
        auto_debit: "Cadastrado",
        auto_debit_registration: "REG-TEST-1",
        email: "energia@vammo.com",
        status: "Pendente",
        last_billing: "R$ 1.234,56",
        due_date: "2026-07-20",
        negotiated_invoices: "",
        invoice_history: "Pendente, A vencer",
        shutdown_date: "",
        first_seen_time: "2026-07-09 03:00:00",
        scraping_time: "2026-07-09 03:00:00",
        lat: "-23,5505",
        lon: "-46,6333",
        F_JUL26: "123,4",
        R_JUL26: "120,0",
      },
      faturas: [
        {
          enel_id: STATE2_ID,
          value: "R$ 1.234,56",
          due_date: "2026-07-20",
          auto_debit: "",
          auto_debit_registration: "REG-TEST-1",
          NF: "NF-TEST-987",
          link_fatura:
            '=HYPERLINK("https://drive.google.com/file/d/TEST_FEED_FILE/view";"Ver Fatura")',
          "Financeiro Check": "FALSE",
          Comprovante: "",
          C1: "0,1",
          C2: "",
          C3: "",
          C4: "",
          C5: "",
          C6: "",
          "TUSD (kWh)": "100,0",
          "TUSD (R$)": "50,00",
          "TE (kWh)": "80,0",
          "TE (R$)": "40,00",
          CIP: "10,00",
          Sub_Faturamento: "",
          Total: "1234,56",
          "Leitura Anterior": "2026-06-15",
          "Leitura Atual": "2026-07-15",
        },
      ],
    },
    {
      // ── state 1 (Detectada): account only, no fatura ──
      installationKey: STATE1_ID,
      account: {
        enel_id: STATE1_ID,
        swap_station_id: "",
        station_status: "Ativo",
        address: "Rua Detectada Sem PDF, 200 - São Paulo",
        auto_debit: "Nao Cadastrado",
        auto_debit_registration: "",
        email: "energia@vammo.com",
        status: "A vencer",
        last_billing: "R$ 789,00",
        due_date: "2026-07-28",
        first_seen_time: "2026-07-09 03:00:00",
        scraping_time: "2026-07-09 03:00:00",
        lat: "-23,56",
        lon: "-46,64",
      },
      faturas: [],
    },
  ],
};

async function main(): Promise<void> {
  if (!SECRET) {
    console.error("Set SCRAPER_INGEST_SECRET (Bearer for POST /api/ingest/scraper).");
    process.exit(1);
    return;
  }
  const res = await fetch(TARGET, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${SECRET}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  console.log(`POST ${TARGET} → ${res.status}`);
  console.log(JSON.stringify(parsed, null, 2));
  process.exit(res.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
