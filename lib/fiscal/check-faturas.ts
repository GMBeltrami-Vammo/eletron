import "server-only";

/**
 * Batch "which energy faturas are already on the FISCAL sheet?" (decision #40).
 * Loads every Enel/EDP fatura with a due date from `charging`, groups them by
 * due-month tab ('MM-YYYY'), reads each fiscal tab ONCE, and matches every
 * fatura against the tab via the pure helpers in fiscal-sheet.ts. Read-only —
 * shared by scripts/check-fiscal.ts (CLI report) and the /energia "Verificar no
 * fiscal" action.
 */

import type { ChargingClient } from "@/lib/data/supabase-repository";
import type { createSheetsClient } from "@/lib/ingest/sheets-loader";
import {
  fiscalTabForDueDate,
  findFaturaRows,
  type FiscalFaturaQuery,
} from "./fiscal-sheet";

type SheetsClient = ReturnType<typeof createSheetsClient>;

export interface FaturaRef {
  chargeId: string;
  provider: "enel" | "edp";
  installationId: string;
  dueDate: string; // ISO YYYY-MM-DD
  nf: string | null;
  /** Fiscal tab 'MM-YYYY' derived from the due date. */
  tab: string;
  /** Charge amount (= energy total) — the fiscal "valor". */
  amount: number | null;
  /** Installation-level auto-debit (utility_account_state) — the "DA" marker + send gate. */
  autoDebit: "cadastrado" | "nao_cadastrado" | "desconhecido";
  /** Débito-automático registration number (prefers the per-fatura detail). */
  autoDebitRegistration: string | null;
  /** Drive PDF link for the "Ver Fatura" hyperlink. */
  driveUrl: string | null;
  /** "Enviado ao fiscal" flag (charge_energy_details) — the send skips faturas already checked. */
  fiscalExported: boolean;
  /** Pre-cutoff backlog fatura closed out (#71) — send/verify skip it (no send, no demote). */
  legacyClosed: boolean;
}

export interface FaturaFiscalStatus extends FaturaRef {
  /** At least one row on the due-month tab matched this fatura. */
  registered: boolean;
  /** False when the fiscal sheet has no tab for that month yet. */
  tabExists: boolean;
}

export interface FiscalCheckSummary {
  total: number;
  registered: number;
  notRegistered: number;
  noTab: number;
}

export interface FiscalCheckReport {
  results: FaturaFiscalStatus[];
  summary: FiscalCheckSummary;
}

/** Missing-tab errors from values.get ("Unable to parse range: '13-2026'"). */
function isMissingTabError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /unable to parse range/i.test(msg);
}

interface CedRow {
  nf: string | null;
  fatura_drive_url: string | null;
  fiscal_exported: boolean | null;
  auto_debit_registration: string | null;
  legacy_closed: boolean | null;
}

/** Every Enel/EDP fatura with a due date, with its installation id + nf + tab. */
export async function loadEnergyFaturas(
  admin: ChargingClient,
): Promise<FaturaRef[]> {
  const accById = new Map<
    string,
    {
      provider: "enel" | "edp";
      installationId: string;
      autoDebit: FaturaRef["autoDebit"];
      autoDebitReg: string | null;
    }
  >();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("billing_accounts")
      .select(
        "id, account_type, enel_id, edp_uc, utility_account_state(auto_debit, auto_debit_registration)",
      )
      .in("account_type", ["energy_enel", "energy_edp"])
      .range(from, from + 999);
    if (error) throw new Error(`billing_accounts read: ${error.message}`);
    const rows = (data ?? []) as {
      id: string;
      account_type: string;
      enel_id: string | null;
      edp_uc: string | null;
      utility_account_state:
        | { auto_debit: string | null; auto_debit_registration: string | null }
        | { auto_debit: string | null; auto_debit_registration: string | null }[]
        | null;
    }[];
    for (const r of rows) {
      const provider = r.account_type === "energy_enel" ? "enel" : "edp";
      const installationId = (provider === "enel" ? r.enel_id : r.edp_uc)?.trim();
      const st = Array.isArray(r.utility_account_state)
        ? r.utility_account_state[0]
        : r.utility_account_state;
      const ad = st?.auto_debit;
      const autoDebit: FaturaRef["autoDebit"] =
        ad === "cadastrado" || ad === "nao_cadastrado" ? ad : "desconhecido";
      if (installationId) {
        accById.set(r.id, {
          provider,
          installationId,
          autoDebit,
          autoDebitReg: st?.auto_debit_registration?.trim() || null,
        });
      }
    }
    if (rows.length < 1000) break;
  }

  const faturas: FaturaRef[] = [];
  const ids = [...accById.keys()];
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from("charges")
        .select(
          "id, billing_account_id, due_date, amount, charge_energy_details(nf, fatura_drive_url, fiscal_exported, auto_debit_registration, legacy_closed)",
        )
        .in("billing_account_id", slice)
        .not("due_date", "is", null)
        .range(from, from + 999);
      if (error) throw new Error(`charges read: ${error.message}`);
      const rows = (data ?? []) as unknown as {
        id: string;
        billing_account_id: string;
        due_date: string;
        amount: number | string | null;
        charge_energy_details:
          | CedRow
          | CedRow[]
          | null;
      }[];
      for (const r of rows) {
        const acc = accById.get(r.billing_account_id);
        if (!acc) continue;
        const ced = Array.isArray(r.charge_energy_details)
          ? r.charge_energy_details[0]
          : r.charge_energy_details;
        faturas.push({
          chargeId: r.id,
          provider: acc.provider,
          installationId: acc.installationId,
          dueDate: r.due_date,
          nf: ced?.nf?.trim() || null,
          tab: fiscalTabForDueDate(r.due_date),
          amount: r.amount === null ? null : Number(r.amount),
          autoDebit: acc.autoDebit,
          autoDebitRegistration:
            ced?.auto_debit_registration?.trim() || acc.autoDebitReg,
          driveUrl: ced?.fatura_drive_url?.trim() || null,
          fiscalExported: ced?.fiscal_exported === true,
          legacyClosed: ced?.legacy_closed === true,
        });
      }
      if (rows.length < 1000) break;
    }
  }
  return faturas;
}

/**
 * Checks the given (or all) energy faturas against the FISCAL sheet, reading
 * each due-month tab once. `sheets` must be authenticated on a SA that is a
 * Viewer of `spreadsheetId`. `monthFilter` (a 'MM-YYYY' tab) narrows the scan.
 */
export async function checkFaturasOnFiscal(
  admin: ChargingClient,
  sheets: SheetsClient,
  spreadsheetId: string,
  opts: { monthFilter?: string | null } = {},
): Promise<FiscalCheckReport> {
  let faturas = await loadEnergyFaturas(admin);
  if (opts.monthFilter) faturas = faturas.filter((f) => f.tab === opts.monthFilter);

  const byTab = new Map<string, FaturaRef[]>();
  for (const f of faturas) {
    const list = byTab.get(f.tab);
    if (list) list.push(f);
    else byTab.set(f.tab, [f]);
  }

  // Read each due-month tab in parallel (one Sheets call per tab, well under the
  // API's per-minute quota) so the button stays fast even with many months.
  const perTab = await Promise.all(
    [...byTab.entries()].map(async ([tab, group]): Promise<FaturaFiscalStatus[]> => {
      let grid: string[][];
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
          return group.map((f) => ({ ...f, registered: false, tabExists: false }));
        }
        throw err;
      }
      return group.map((f) => {
        const query: FiscalFaturaQuery = {
          installationId: f.installationId,
          dueDate: f.dueDate,
          notaFiscal: f.nf,
        };
        return {
          ...f,
          registered: findFaturaRows(grid, query).length > 0,
          tabExists: true,
        };
      });
    }),
  );
  const results: FaturaFiscalStatus[] = perTab.flat();

  const summary: FiscalCheckSummary = {
    total: results.length,
    registered: results.filter((r) => r.registered).length,
    notRegistered: results.filter((r) => !r.registered && r.tabExists).length,
    noTab: results.filter((r) => !r.tabExists).length,
  };
  return { results, summary };
}
