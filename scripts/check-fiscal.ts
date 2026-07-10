/**
 * scripts/check-fiscal.ts — CLI report of which energy faturas are already on
 * the FISCAL sheet (decision #40). Thin formatter over
 * lib/fiscal/check-faturas.ts (shared with the /energia "Verificar no fiscal"
 * button). Read-only — never writes the sheet or the DB.
 *
 * Requires (env; not committed):
 *   - FISCAL_SPREADSHEET_ID   — the fiscal spreadsheet id
 *   - GSHEETS_SA_KEY_B64      — the read-only SA (must be Viewer on that sheet)
 *   - NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — to read charging
 *
 * Run:
 *   npx dotenv -e .env.local -- tsx scripts/check-fiscal.ts
 *   # optional: focus one due-month (accepts YYYY-MM or MM-YYYY)
 *   npx dotenv -e .env.local -- tsx scripts/check-fiscal.ts 2026-03
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { createSheetsClient } from "@/lib/ingest/sheets-loader";
import {
  checkFaturasOnFiscal,
  type FaturaFiscalStatus,
} from "@/lib/fiscal/check-faturas";

/** Normalizes a YYYY-MM or MM-YYYY month arg to the fiscal tab 'MM-YYYY'. */
function normalizeMonthArg(arg: string | undefined): string | null {
  if (!arg) return null;
  const iso = /^(\d{4})-(\d{2})$/.exec(arg.trim());
  if (iso) return `${iso[2]}-${iso[1]}`;
  const tab = /^(\d{2})-(\d{4})$/.exec(arg.trim());
  if (tab) return `${tab[1]}-${tab[2]}`;
  throw new Error(`month filter must be YYYY-MM or MM-YYYY (got '${arg}')`);
}

async function main(): Promise<void> {
  const spreadsheetId = process.env.FISCAL_SPREADSHEET_ID;
  if (!spreadsheetId) {
    console.error(
      "✗ FISCAL_SPREADSHEET_ID not set. Set it in .env.local and grant the\n" +
        "  GSHEETS_SA_KEY_B64 service account Viewer on that spreadsheet.",
    );
    process.exit(1);
  }
  if (!process.env.GSHEETS_SA_KEY_B64) {
    console.error("✗ GSHEETS_SA_KEY_B64 not set (needed to read the fiscal sheet).");
    process.exit(1);
  }
  const monthFilter = normalizeMonthArg(process.argv[2]);

  const { results, summary } = await checkFaturasOnFiscal(
    supabaseAdmin(),
    createSheetsClient(),
    spreadsheetId,
    { monthFilter },
  );

  console.log(
    `Faturas de energia (Enel/EDP) com vencimento: ${summary.total}` +
      (monthFilter ? ` (aba ${monthFilter})` : ""),
  );
  console.log("\n=== RESUMO ===");
  console.log(`  registradas no fiscal:        ${summary.registered}`);
  console.log(`  NÃO registradas:              ${summary.notRegistered}`);
  console.log(`  em meses sem aba no fiscal:    ${summary.noTab}`);

  const line = (f: FaturaFiscalStatus) =>
    `  ${f.provider} ${f.installationId} · venc ${f.dueDate} · aba ${f.tab}` +
    (f.tabExists ? "" : " (sem aba)");

  const missing = results.filter((r) => !r.registered);
  if (missing.length > 0) {
    console.log(`\n=== NÃO REGISTRADAS (candidatas a enviar ao fiscal) — ${missing.length} ===`);
    for (const f of missing.slice(0, 200)) console.log(line(f));
    if (missing.length > 200) console.log(`  … e mais ${missing.length - 200}`);
  }
  const reg = results.filter((r) => r.registered);
  if (reg.length > 0) {
    console.log(`\n=== JÁ REGISTRADAS — ${reg.length} ===`);
    for (const f of reg.slice(0, 200)) console.log(line(f));
    if (reg.length > 200) console.log(`  … e mais ${reg.length - 200}`);
  }
}

main().catch((err) => {
  console.error("✗ check-fiscal falhou:", err instanceof Error ? err.message : err);
  process.exit(1);
});
