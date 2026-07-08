/**
 * scripts/backfill.ts — the first full `charging` sync + verification.
 *
 * It is just the sheet-sync core run once with trigger='manual:backfill'
 * (backfill = the first idempotent full sync, decision #20 / schema-writes §7).
 * After it lands, it queries the DB and asserts the acceptance invariants, then
 * exits non-zero if any fail.
 *
 * Run (env must be present — Supabase URL + service role key + JWT secret):
 *   npx tsx scripts/backfill.ts
 * or with a dotenv shim:
 *   npx dotenv -e .env.local -- tsx scripts/backfill.ts
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY (service role — bypasses RLS to seed).
 * Reads the sheets when GSHEETS_* env vars are set, xlsx fixtures otherwise.
 */

import { loadRawTabs } from "@/lib/ingest/load-raw";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runSheetSync } from "@/lib/sync/sheet-sync";

type Filters = Record<string, string | number | boolean>;

async function count(
  admin: ReturnType<typeof supabaseAdmin>,
  table: string,
  filters: Filters = {},
): Promise<number> {
  let q = admin.from(table).select("*", { count: "exact", head: true });
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { count: c, error } = await q;
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return c ?? 0;
}

async function column(
  admin: ReturnType<typeof supabaseAdmin>,
  table: string,
  col: string,
  filters: Filters = {},
): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += 1000) {
    let q = admin.from(table).select(col);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    const { data, error } = await q.order(col, { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`select ${table}.${col}: ${error.message}`);
    const rows = (data ?? []) as unknown as Record<string, string | null>[];
    for (const r of rows) if (r[col] != null) out.push(String(r[col]));
    if (rows.length < 1000) break;
  }
  return out;
}

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

async function main(): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — set the env (e.g. `vercel env pull .env.local` then `npx dotenv -e .env.local -- tsx scripts/backfill.ts`).",
    );
    process.exit(1);
    return;
  }

  const admin = supabaseAdmin();

  console.log("── Running sheet-sync (trigger=manual:backfill) ──");
  const result = await runSheetSync({
    admin,
    loadRaw: loadRawTabs,
    trigger: "manual:backfill",
  });

  if (result.status !== "success") {
    console.error(`Sync did not succeed (status=${result.status}): ${result.error ?? ""}`);
    process.exit(1);
    return;
  }

  console.log("Upserted counts:", JSON.stringify(result.counts));
  console.log("Referential fixes:", JSON.stringify(result.referentialFixes));
  console.log(`Normalization issues captured: ${result.issues.length}`);
  console.log(`Rows read: ${result.rowsRead}, upserted: ${result.rowsUpserted}, skipped: ${result.rowsSkipped}`);
  console.log("");

  const checks: Check[] = [];

  // station 553 → 3 energy_enel accounts
  const enel553 = await count(admin, "billing_accounts", {
    station_id: 553,
    account_type: "energy_enel",
  });
  checks.push({
    name: "station 553 → 3 energy_enel accounts",
    pass: enel553 === 3,
    detail: `got ${enel553}`,
  });

  // 1373 / 968 / 1043 → 2 energy_edp each
  for (const st of [1373, 968, 1043]) {
    const n = await count(admin, "billing_accounts", {
      station_id: st,
      account_type: "energy_edp",
    });
    checks.push({
      name: `station ${st} → 2 energy_edp accounts`,
      pass: n === 2,
      detail: `got ${n}`,
    });
  }

  // charges > 0
  const chargesCount = await count(admin, "charges");
  checks.push({
    name: "charges count > 0",
    pass: chargesCount > 0,
    detail: `${chargesCount}`,
  });

  // fiscal_exported=true — load-faithful vs the sheet TRUE count
  const dbFiscal = await count(admin, "charge_energy_details", {
    fiscal_exported: true,
  });
  const raw = await loadRawTabs();
  const sheetFiscal = (["Faturas_ENEL", "Faturas_EDP"] as const).reduce(
    (acc, tab) =>
      acc +
      raw[tab].filter((r) => (r["Financeiro Check"] ?? "").toLowerCase() === "true")
        .length,
    0,
  );
  checks.push({
    name: "fiscal_exported=true count == normalized (load-faithful) count",
    pass: dbFiscal === result.fiscalExportedTrue,
    detail: `db=${dbFiscal} normalized=${result.fiscalExportedTrue} sheetRaw=${sheetFiscal} (Δ ${sheetFiscal - dbFiscal} = deduped duplicate invoice rows)`,
  });

  // post-semantics invariant: zero pago + rpc charges without a payment
  const pagoRpcIds = await column(admin, "charges", "id", {
    status: "pago",
    status_source: "rpc",
  });
  const paidChargeIds = new Set(await column(admin, "payments", "charge_id"));
  const violations = pagoRpcIds.filter((id) => !paidChargeIds.has(id));
  checks.push({
    name: "zero charges with status=pago AND status_source=rpc AND no payments",
    pass: violations.length === 0,
    detail: `violations=${violations.length}`,
  });

  console.log("── Assertions ──");
  let allPass = true;
  for (const c of checks) {
    console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}  (${c.detail})`);
    if (!c.pass) allPass = false;
  }

  console.log("");
  console.log("── DB row counts ──");
  const tables = [
    "stations",
    "counterparties",
    "contracts",
    "billing_accounts",
    "utility_account_state",
    "monthly_consumption",
    "charges",
    "charge_energy_details",
    "charge_lines",
    "raw_sheet_rows",
    "alerts",
  ];
  for (const t of tables) {
    console.log(`  ${t}: ${await count(admin, t)}`);
  }

  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
