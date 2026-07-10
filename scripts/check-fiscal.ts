/**
 * scripts/check-fiscal.ts — batch "which energy faturas are already on the
 * FISCAL sheet?" report (decision #40). Reads charging for every Enel/EDP
 * fatura with a due date, groups them by due-month tab ('MM-YYYY'), reads each
 * tab ONCE from the FISCAL spreadsheet, and matches every fatura of that month
 * against the tab via the pure helpers in lib/fiscal/fiscal-sheet.ts. Read-only
 * — never writes the sheet or the DB.
 *
 * Requires (env; not committed):
 *   - FISCAL_SPREADSHEET_ID   — the fiscal spreadsheet id (Gabriel provides)
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
  fiscalTabForDueDate,
  findFaturaRows,
  type FiscalFaturaQuery,
} from "@/lib/fiscal/fiscal-sheet";

interface Fatura {
  provider: "enel" | "edp";
  installationId: string;
  dueDate: string; // ISO
  nf: string | null;
  tab: string; // 'MM-YYYY'
}

/** Normalizes a YYYY-MM or MM-YYYY month arg to the fiscal tab 'MM-YYYY'. */
function normalizeMonthArg(arg: string | undefined): string | null {
  if (!arg) return null;
  const iso = /^(\d{4})-(\d{2})$/.exec(arg.trim());
  if (iso) return `${iso[2]}-${iso[1]}`;
  const tab = /^(\d{2})-(\d{4})$/.exec(arg.trim());
  if (tab) return `${tab[1]}-${tab[2]}`;
  throw new Error(`month filter must be YYYY-MM or MM-YYYY (got '${arg}')`);
}

function isMissingTabError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /unable to parse range/i.test(msg);
}

async function loadEnergyFaturas(
  admin: ReturnType<typeof supabaseAdmin>,
): Promise<Fatura[]> {
  // 1. energy billing accounts → installation id (enel_id | edp_uc)
  const accById = new Map<string, { provider: "enel" | "edp"; installationId: string }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("billing_accounts")
      .select("id, account_type, enel_id, edp_uc")
      .in("account_type", ["energy_enel", "energy_edp"])
      .range(from, from + 999);
    if (error) throw new Error(`billing_accounts read: ${error.message}`);
    const rows = (data ?? []) as {
      id: string;
      account_type: string;
      enel_id: string | null;
      edp_uc: string | null;
    }[];
    for (const r of rows) {
      const provider = r.account_type === "energy_enel" ? "enel" : "edp";
      const installationId = (provider === "enel" ? r.enel_id : r.edp_uc)?.trim();
      if (installationId) accById.set(r.id, { provider, installationId });
    }
    if (rows.length < 1000) break;
  }

  // 2. charges of those accounts with a due date + their nf
  const faturas: Fatura[] = [];
  const ids = [...accById.keys()];
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from("charges")
        .select("id, billing_account_id, due_date, charge_energy_details(nf)")
        .in("billing_account_id", slice)
        .not("due_date", "is", null)
        .range(from, from + 999);
      if (error) throw new Error(`charges read: ${error.message}`);
      const rows = (data ?? []) as unknown as {
        id: string;
        billing_account_id: string;
        due_date: string;
        charge_energy_details: { nf: string | null } | { nf: string | null }[] | null;
      }[];
      for (const r of rows) {
        const acc = accById.get(r.billing_account_id);
        if (!acc) continue;
        const ced = Array.isArray(r.charge_energy_details)
          ? r.charge_energy_details[0]
          : r.charge_energy_details;
        faturas.push({
          provider: acc.provider,
          installationId: acc.installationId,
          dueDate: r.due_date,
          nf: ced?.nf?.trim() || null,
          tab: fiscalTabForDueDate(r.due_date),
        });
      }
      if (rows.length < 1000) break;
    }
  }
  return faturas;
}

async function main(): Promise<void> {
  const spreadsheetId = process.env.FISCAL_SPREADSHEET_ID;
  if (!spreadsheetId) {
    console.error(
      "✗ FISCAL_SPREADSHEET_ID not set. Set it in .env.local (Gabriel provides) and\n" +
        "  grant the GSHEETS_SA_KEY_B64 service account Viewer on that spreadsheet.",
    );
    process.exit(1);
  }
  if (!process.env.GSHEETS_SA_KEY_B64) {
    console.error("✗ GSHEETS_SA_KEY_B64 not set (needed to read the fiscal sheet).");
    process.exit(1);
  }
  const monthFilter = normalizeMonthArg(process.argv[2]);

  const admin = supabaseAdmin();
  const sheets = createSheetsClient();

  let faturas = await loadEnergyFaturas(admin);
  if (monthFilter) faturas = faturas.filter((f) => f.tab === monthFilter);
  console.log(
    `Faturas de energia (Enel/EDP) com vencimento: ${faturas.length}` +
      (monthFilter ? ` (filtradas para a aba ${monthFilter})` : ""),
  );

  // group by tab; read each tab once
  const byTab = new Map<string, Fatura[]>();
  for (const f of faturas) {
    const list = byTab.get(f.tab);
    if (list) list.push(f);
    else byTab.set(f.tab, [f]);
  }

  const registered: Fatura[] = [];
  const notRegistered: Fatura[] = [];
  const noTab: Fatura[] = [];

  const tabs = [...byTab.keys()].sort();
  console.log(`Lendo ${tabs.length} aba(s) do fiscal…\n`);

  for (const tab of tabs) {
    const group = byTab.get(tab) ?? [];
    let grid: string[][] | null = null;
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${tab}'`,
        valueRenderOption: "FORMATTED_VALUE",
        dateTimeRenderOption: "FORMATTED_STRING",
      });
      const values = res.data.values as unknown[][] | null | undefined;
      grid = (values ?? []).map((row) =>
        row.map((c) => (c === null || c === undefined ? "" : String(c))),
      );
    } catch (err) {
      if (isMissingTabError(err)) {
        for (const f of group) noTab.push(f);
        console.log(`  ${tab}: aba inexistente no fiscal → ${group.length} fatura(s) não registradas`);
        continue;
      }
      throw err;
    }

    let reg = 0;
    for (const f of group) {
      const query: FiscalFaturaQuery = {
        installationId: f.installationId,
        dueDate: f.dueDate,
        notaFiscal: f.nf,
      };
      if (findFaturaRows(grid, query).length > 0) {
        registered.push(f);
        reg += 1;
      } else {
        notRegistered.push(f);
      }
    }
    console.log(`  ${tab}: ${group.length} fatura(s) → ${reg} registrada(s), ${group.length - reg} não`);
  }

  const line = (f: Fatura) =>
    `  ${f.provider} ${f.installationId} · venc ${f.dueDate} · aba ${f.tab}${f.nf ? ` · NF ${f.nf}` : ""}`;

  console.log("\n=== RESUMO ===");
  console.log(`  registradas no fiscal:        ${registered.length}`);
  console.log(`  NÃO registradas:              ${notRegistered.length}`);
  console.log(`  em meses sem aba no fiscal:   ${noTab.length}`);

  const missing = [...notRegistered, ...noTab];
  if (missing.length > 0) {
    console.log(`\n=== NÃO REGISTRADAS (candidatas a enviar ao fiscal) — ${missing.length} ===`);
    for (const f of missing.slice(0, 200)) console.log(line(f));
    if (missing.length > 200) console.log(`  … e mais ${missing.length - 200}`);
  }
  if (registered.length > 0) {
    console.log(`\n=== JÁ REGISTRADAS — ${registered.length} ===`);
    for (const f of registered.slice(0, 200)) console.log(line(f));
    if (registered.length > 200) console.log(`  … e mais ${registered.length - 200}`);
  }
}

main().catch((err) => {
  console.error("✗ check-fiscal falhou:", err instanceof Error ? err.message : err);
  process.exit(1);
});
