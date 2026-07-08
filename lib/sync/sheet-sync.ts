/**
 * sheet-sync core — the idempotent full sync from the scraper/rent sheets into
 * the `charging` schema. Reuses `normalizeSnapshot` verbatim (decision-#21
 * status derivation included), then upserts on NATURAL keys.
 *
 * Server-only by convention (node crypto + service-role writes); receives the
 * `supabaseAdmin()` client and a `RawTabs` loader as params so it stays
 * testable and is shared by the cron routes, the daily catch-up, and backfill.
 *
 * uuid strategy (why two schemes):
 * - counterparties / contracts / billing_accounts / charge_lines are written
 *   ONLY by this sync, so their DB `id` is a DETERMINISTIC uuid derived from the
 *   snapshot's stable string id — no read-back needed, and it dedupes name-only
 *   counterparties cleanly (a null cnpj can't be a conflict target).
 * - charges are ALSO created by RPCs (create_manual_bill / gerar_mes) with
 *   random uuids that converge on the same `dedupe_key`, so charges upsert on
 *   `dedupe_key` and the real uuid is READ BACK (via `.select()`) to attach
 *   charge_energy_details / charge_lines. stations use the natural int PK.
 *
 * Protections:
 * - H2: `charges.status` is only overwritten where the existing
 *   `status_source='sync'`; rows a human/RPC set to `'rpc'` keep their status.
 * - Human match sticky: `billing_accounts.station_id`/`match_status` are never
 *   overwritten on rows with `matched_by_email` set (assign_station_to_account).
 * - Referential: any `station_id` not present in Vammo_data is nulled (the FK
 *   has no phantom station to point at); a contract with no counterparty falls
 *   back to a single sentinel counterparty (NOT NULL FK).
 */

import { createHash } from "crypto";

import {
  type BillingAccount,
  type Charge,
  type ChargeEnergyDetails,
  type ChargeLine,
  type Contract,
  type Counterparty,
  type DomainSnapshot,
  type MonthlyConsumption,
  type NormalizationIssue,
  type Station,
  type UtilityAccountState,
} from "@/lib/domain";
import { normalizeSnapshot } from "@/lib/ingest/normalize";
import { SHEET_ROW_KEY, type RawTabs } from "@/lib/ingest/raw-tabs";
import type { ChargingClient } from "@/lib/data/supabase-repository";
import { claimJob, finalizeJob } from "./job-runs";

export const SHEET_SYNC_JOB_NAME = "sheet-sync";
const BATCH = 500;

// A single shared sentinel counterparty for the (never-seen-in-fixtures)
// contract-with-no-landlord edge — keeps the NOT NULL FK valid, loses no row.
const SENTINEL_COUNTERPARTY_ID = "cp:sentinel:sem-contraparte";

// ═══════════════════════════════════════════════════════════════════════════
// Deterministic ids + hashing (pure)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stable v5-style uuid from any string. Same input → same uuid across runs, so
 * re-syncs update instead of duplicating and FKs resolve without a read-back.
 */
export function deterministicUuid(name: string): string {
  const h = createHash("sha256").update(name).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(
    17,
    20,
  )}-${h.slice(20, 32)}`;
}

/** Content hash of a raw sheet row (order-independent) for skip-unchanged. */
export function rowHash(data: Record<string, string>): string {
  const canonical = JSON.stringify(
    Object.keys(data)
      .sort()
      .map((k) => [k, data[k]]),
  );
  return createHash("sha256").update(canonical).digest("hex");
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Snapshot entity → DB row mappers (pure — no side effects, deterministic)
// ═══════════════════════════════════════════════════════════════════════════

type Row = Record<string, unknown>;
type ValidStation = (id: number | null) => number | null;

export function toStationRow(s: Station, syncedAt: string): Row {
  // Omit active_boxes / boxes_synced_at / requires_manual_meter_reading so an
  // upsert preserves them (they come from 4_Metabase_Boxes, out of sync scope).
  return {
    id: s.id,
    name: s.name,
    address: s.address,
    latitude: s.latitude,
    longitude: s.longitude,
    status: s.status ?? "INACTIVE", // stations.status is NOT NULL
    source_created_at: s.sourceCreatedAt,
    raw: s.raw,
    synced_at: syncedAt,
  };
}

export function toCounterpartyRow(c: Counterparty): Row {
  return {
    id: deterministicUuid(c.id),
    name: c.name,
    cnpj_cpf: c.cnpjCpf,
    kind: c.kind,
    notes: c.notes,
  };
}

export function toContractRow(c: Contract, validStation: ValidStation): Row {
  return {
    id: deterministicUuid(c.id),
    cadastro_id: c.cadastroId,
    station_id: validStation(c.stationId),
    counterparty_id: deterministicUuid(c.counterpartyId ?? SENTINEL_COUNTERPARTY_ID),
    status: c.status ?? "INACTIVE", // contracts.status NOT NULL; INACTIVE keeps alert parity
    address: c.address,
    contact_name: c.contactName,
    phone: c.phone,
    email: c.email,
    enel_connection_number: c.enelConnectionNumber,
    contract_type: c.contractType ?? "gratuito", // NOT NULL; gratuito is gerar_mes-safe
    box_count: c.boxCount,
    min_box: c.minBox,
    valor_por_box: c.valorPorBox,
    valor_mensal: c.valorMensal,
    due_day: c.dueDay,
    payment_method: c.paymentMethod,
    banco: c.banco,
    agencia: c.agencia,
    conta: c.conta,
    chave_pix: c.chavePix,
    starts_on: c.startsOn,
    ends_on: c.endsOn,
    observations: c.observations,
  };
}

export function toBillingAccountRow(
  a: BillingAccount,
  validStation: ValidStation,
  opts: { sticky: boolean },
): Row {
  const base: Row = {
    id: deterministicUuid(a.id),
    account_type: a.accountType,
    enel_id: a.enelId,
    edp_uc: a.edpUc,
    edp_contract_id: a.edpContractId,
    contract_id: a.contractId ? deterministicUuid(a.contractId) : null,
    counterparty_id: a.counterpartyId ? deterministicUuid(a.counterpartyId) : null,
    external_ref: a.externalRef,
    auto_debit_registration: a.autoDebitRegistration,
    is_active: a.isActive,
    notes: a.notes,
  };
  if (opts.sticky) return base; // preserve human station_id / match_status
  const station = validStation(a.stationId);
  return {
    ...base,
    station_id: station,
    // an account pointing at a phantom station is effectively unmatched
    match_status: station === null && a.stationId !== null ? "unmatched" : a.matchStatus,
  };
}

export function toUtilityStateRow(s: UtilityAccountState): Row {
  return {
    billing_account_id: deterministicUuid(s.billingAccountId),
    provider_station_status: s.providerStationStatus,
    address: s.address,
    neighborhood: s.neighborhood,
    city: s.city,
    bill_status: s.billStatus,
    bill_status_raw: s.billStatusRaw,
    last_billing: s.lastBilling,
    due_date: s.dueDate,
    auto_debit: s.autoDebit,
    auto_debit_registration: s.autoDebitRegistration,
    account_email: s.accountEmail,
    negotiated_invoices: s.negotiatedInvoices,
    invoice_history: s.invoiceHistory,
    shutdown_date: s.shutdownDate,
    shutdown_start: s.shutdownStart,
    shutdown_end: s.shutdownEnd,
    first_seen_at: s.firstSeenAt,
    scraped_at: s.scrapedAt,
    lat: s.lat,
    lon: s.lon,
    ultima_fatura_flag: s.ultimaFaturaFlag,
    ultimo_comprovante: s.ultimoComprovante,
    is_status_carried_forward: s.isStatusCarriedForward,
    raw: s.raw, // utility_account_state.raw is NOT NULL
  };
}

export function toMonthlyConsumptionRow(m: MonthlyConsumption): Row {
  return {
    billing_account_id: deterministicUuid(m.billingAccountId),
    competencia: m.competencia,
    kwh_billed: m.kwhBilled,
    kwh_recorded: m.kwhRecorded,
    source: m.source,
  };
}

export function toChargeRow(
  c: Charge,
  validStation: ValidStation,
  opts: { includeStatus: boolean },
): Row {
  // Objective, sheet-derived columns — always safe to overwrite on re-sync.
  const dataOnly: Row = {
    kind: c.kind,
    competencia: c.competencia,
    competencia_source: c.competenciaSource,
    amount: c.amount ?? 0, // charges.amount NOT NULL (unparseable Valor → 0, matchStatus already needs_review)
    expected_amount: c.expectedAmount,
    due_date: c.dueDate,
    payment_method: c.paymentMethod,
    banco: c.banco,
    agencia: c.agencia,
    conta: c.conta,
    chave_pix: c.chavePix,
    linha_digitavel: c.linhaDigitavel,
    nota_fiscal: c.notaFiscal,
    documento_numero: c.documentoNumero,
    issuer_cnpj: c.issuerCnpj,
    source: c.source,
    dedupe_key: c.dedupeKey,
    legacy_ref: c.legacyRef,
    raw: c.raw,
    notes: c.notes,
  };
  // H2 + match/flag stickiness: for pipeline-owned rows (status_source='sync')
  // the sync also writes the human-ownable columns (attribution, flags, status).
  // For rows a human/RPC set (status_source='rpc' — confirm/record_payment/
  // gerar_mes/resolve_unmatched_charge/assign_station_to_account), the upsert
  // OMITS billing_account_id/station_id/match_status/flags/status so a re-sync
  // never clobbers the human attribution, gerar_mes flags, or paid state.
  if (opts.includeStatus) {
    return {
      ...dataOnly,
      billing_account_id: c.billingAccountId ? deterministicUuid(c.billingAccountId) : null,
      station_id: validStation(c.stationId),
      match_status: c.matchStatus,
      flags: c.flags ?? [],
      status: c.status,
      status_source: "sync",
    };
  }
  return dataOnly;
}

export function toEnergyDetailRow(d: ChargeEnergyDetails, chargeUuid: string): Row {
  return {
    charge_id: chargeUuid,
    nf: d.nf,
    tariff_c1: d.tariffC1,
    tariff_c2: d.tariffC2,
    tariff_c3: d.tariffC3,
    tariff_c4: d.tariffC4,
    tariff_c5: d.tariffC5,
    tariff_c6: d.tariffC6,
    classificacao: d.classificacao,
    modalidade: d.modalidade,
    tipo_fornecimento: d.tipoFornecimento,
    tusd_kwh: d.tusdKwh,
    tusd_amount: d.tusdAmount,
    te_kwh: d.teKwh,
    te_amount: d.teAmount,
    cip: d.cip,
    sub_faturamento: d.subFaturamento,
    total: d.total,
    leitura_anterior: d.leituraAnterior,
    leitura_atual: d.leituraAtual,
    auto_debit: d.autoDebit,
    auto_debit_registration: d.autoDebitRegistration,
    fatura_drive_url: d.faturaDriveUrl,
    fiscal_exported: d.fiscalExported,
    fiscal_exported_at: d.fiscalExportedAt,
  };
}

export function toChargeLineRow(l: ChargeLine, chargeUuid: string): Row {
  return {
    id: deterministicUuid(`${chargeUuid}:${l.lineKind}`),
    charge_id: chargeUuid,
    line_kind: l.lineKind,
    description: l.description,
    amount: l.amount,
    competencia: l.competencia,
    competencia_source: l.competenciaSource,
  };
}

/** Rows the sentinel counterparty must exist for (NOT NULL FK). */
export function sentinelCounterpartyRow(): Row {
  return {
    id: deterministicUuid(SENTINEL_COUNTERPARTY_ID),
    name: "(sem contraparte)",
    cnpj_cpf: null,
    kind: "outro",
    notes: "sentinel — contrato sem locador cadastrado",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// H2 charge partitioning (pure)
// ═══════════════════════════════════════════════════════════════════════════

export interface ChargePartition {
  /** New rows + rows the pipeline owns (status_source='sync'): write status. */
  syncCharges: Charge[];
  /** Rows a human/RPC set (status_source='rpc'): update data, preserve status. */
  rpcCharges: Charge[];
}

/** Splits snapshot charges by the existing row's status_source (H2). */
export function partitionChargesByStatusSource(
  charges: Charge[],
  existingStatusSource: Map<string, "sync" | "rpc">,
): ChargePartition {
  const syncCharges: Charge[] = [];
  const rpcCharges: Charge[] = [];
  for (const c of charges) {
    if (existingStatusSource.get(c.dedupeKey) === "rpc") rpcCharges.push(c);
    else syncCharges.push(c);
  }
  return { syncCharges, rpcCharges };
}

// ═══════════════════════════════════════════════════════════════════════════
// runSheetSync
// ═══════════════════════════════════════════════════════════════════════════

export interface SheetSyncResult {
  jobId: string | null;
  status: "success" | "error" | "skipped_locked";
  rowsRead: number;
  rowsUpserted: number;
  rowsSkipped: number;
  maxScrapedAt: string | null;
  counts: Record<string, number>;
  fiscalExportedTrue: number;
  referentialFixes: {
    nulledAccountStations: number;
    nulledChargeStations: number;
    coalescedStationStatus: number;
    coalescedContractStatus: number;
    coalescedContractType: number;
    coalescedChargeAmount: number;
    stickyAccountsPreserved: number;
  };
  issues: NormalizationIssue[];
  /** Present on success — the backfill script verifies against it. */
  snapshot?: DomainSnapshot;
  error?: string;
}

export interface RunSheetSyncOptions {
  admin: ChargingClient;
  loadRaw: () => Promise<RawTabs>;
  /** 'cron' | 'manual:{email}' | 'manual:backfill'. */
  trigger: string;
  now?: Date;
}

async function upsertAll(
  admin: ChargingClient,
  table: string,
  rows: Row[],
  onConflict: string,
  ignoreDuplicates = false,
): Promise<void> {
  for (const c of chunk(rows, BATCH)) {
    const { error } = await admin
      .from(table)
      .upsert(c, { onConflict, ignoreDuplicates });
    if (error) throw new Error(`upsert charging.${table} failed: ${error.message}`);
  }
}

async function upsertChargesReturning(
  admin: ChargingClient,
  rows: Row[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const c of chunk(rows, BATCH)) {
    const { data, error } = await admin
      .from("charges")
      .upsert(c, { onConflict: "dedupe_key" })
      .select("id,dedupe_key");
    if (error) throw new Error(`upsert charging.charges failed: ${error.message}`);
    for (const r of (data ?? []) as { id: string; dedupe_key: string }[]) {
      out.set(r.dedupe_key, r.id);
    }
  }
  return out;
}

/** Fetches every existing charge's dedupe_key → status_source (paginated). */
async function fetchExistingStatusSource(
  admin: ChargingClient,
): Promise<Map<string, "sync" | "rpc">> {
  const map = new Map<string, "sync" | "rpc">();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("charges")
      .select("dedupe_key,status_source")
      .order("dedupe_key", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`charges preflight failed: ${error.message}`);
    const rows = (data ?? []) as { dedupe_key: string; status_source: "sync" | "rpc" }[];
    for (const r of rows) map.set(r.dedupe_key, r.status_source);
    if (rows.length < 1000) break;
  }
  return map;
}

/** Set of billing_account uuids with a human match (never overwrite station). */
async function fetchStickyAccountIds(admin: ChargingClient): Promise<Set<string>> {
  const set = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("billing_accounts")
      .select("id")
      .not("matched_by_email", "is", null)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`sticky accounts preflight failed: ${error.message}`);
    const rows = (data ?? []) as { id: string }[];
    for (const r of rows) set.add(r.id);
    if (rows.length < 1000) break;
  }
  return set;
}

/**
 * Runs one full idempotent sync. Claims a job lease first (returns
 * skipped_locked if another run holds it), records everything in one job_runs
 * row, and re-throws on error after finalizing that row.
 */
export async function runSheetSync(
  opts: RunSheetSyncOptions,
): Promise<SheetSyncResult> {
  const { admin, loadRaw, trigger } = opts;
  const now = opts.now ?? new Date();
  const syncedAt = now.toISOString();

  const jobId = await claimJob(admin, SHEET_SYNC_JOB_NAME);
  if (!jobId) {
    return {
      jobId: null,
      status: "skipped_locked",
      rowsRead: 0,
      rowsUpserted: 0,
      rowsSkipped: 0,
      maxScrapedAt: null,
      counts: {},
      fiscalExportedTrue: 0,
      referentialFixes: {
        nulledAccountStations: 0,
        nulledChargeStations: 0,
        coalescedStationStatus: 0,
        coalescedContractStatus: 0,
        coalescedContractType: 0,
        coalescedChargeAmount: 0,
        stickyAccountsPreserved: 0,
      },
      issues: [],
    };
  }

  try {
    const raw = await loadRaw();
    const snapshot = normalizeSnapshot(raw);

    const stationIdSet = new Set(snapshot.stations.map((s) => s.id));
    const validStation: ValidStation = (id) =>
      id !== null && stationIdSet.has(id) ? id : null;

    // referential / coalesce metrics (computed, not mutated in mappers)
    const nulledAccountStations = snapshot.billingAccounts.filter(
      (a) => a.stationId !== null && !stationIdSet.has(a.stationId),
    ).length;
    const nulledChargeStations = snapshot.charges.filter(
      (c) => c.stationId !== null && !stationIdSet.has(c.stationId),
    ).length;
    const coalescedStationStatus = snapshot.stations.filter(
      (s) => s.status === null,
    ).length;
    const coalescedContractStatus = snapshot.contracts.filter(
      (c) => c.status === null,
    ).length;
    const coalescedContractType = snapshot.contracts.filter(
      (c) => c.contractType === null,
    ).length;
    const coalescedChargeAmount = snapshot.charges.filter(
      (c) => c.amount === null,
    ).length;
    const needsSentinel = snapshot.contracts.some((c) => c.counterpartyId === null);

    // ── stations ─────────────────────────────────────────────────────────
    await upsertAll(
      admin,
      "stations",
      snapshot.stations.map((s) => toStationRow(s, syncedAt)),
      "id",
    );

    // ── counterparties (+ sentinel only if a contract lacks one) ───────────
    const counterpartyRows = snapshot.counterparties.map(toCounterpartyRow);
    if (needsSentinel) counterpartyRows.push(sentinelCounterpartyRow());
    await upsertAll(admin, "counterparties", counterpartyRows, "id");

    // ── contracts ──────────────────────────────────────────────────────────
    await upsertAll(
      admin,
      "contracts",
      snapshot.contracts.map((c) => toContractRow(c, validStation)),
      "id",
    );

    // ── billing_accounts (sticky human matches preserved) ──────────────────
    // Sticky and non-sticky rows have DIFFERENT column sets (sticky omits
    // station_id/match_status). PostgREST builds the DO UPDATE SET clause from
    // the batch's columns, so they MUST be upserted as separate homogeneous
    // batches — mixing them would null the human match on the sticky rows.
    const stickyIds = await fetchStickyAccountIds(admin);
    const stickyRows: Row[] = [];
    const normalRows: Row[] = [];
    for (const a of snapshot.billingAccounts) {
      if (stickyIds.has(deterministicUuid(a.id))) {
        stickyRows.push(toBillingAccountRow(a, validStation, { sticky: true }));
      } else {
        normalRows.push(toBillingAccountRow(a, validStation, { sticky: false }));
      }
    }
    const stickyPreserved = stickyRows.length;
    await upsertAll(admin, "billing_accounts", normalRows, "id");
    await upsertAll(admin, "billing_accounts", stickyRows, "id");

    // ── utility_account_state ──────────────────────────────────────────────
    await upsertAll(
      admin,
      "utility_account_state",
      snapshot.utilityAccountStates.map(toUtilityStateRow),
      "billing_account_id",
    );

    // ── monthly_consumption ─────────────────────────────────────────────────
    await upsertAll(
      admin,
      "monthly_consumption",
      snapshot.monthlyConsumption.map(toMonthlyConsumptionRow),
      "billing_account_id,competencia",
    );

    // ── charges (H2 partition) + read back uuids ────────────────────────────
    const existingStatusSource = await fetchExistingStatusSource(admin);
    const { syncCharges, rpcCharges } = partitionChargesByStatusSource(
      snapshot.charges,
      existingStatusSource,
    );
    const chargeUuidByDedupe = new Map<string, string>();
    for (const [k, v] of await upsertChargesReturning(
      admin,
      syncCharges.map((c) => toChargeRow(c, validStation, { includeStatus: true })),
    )) {
      chargeUuidByDedupe.set(k, v);
    }
    for (const [k, v] of await upsertChargesReturning(
      admin,
      rpcCharges.map((c) => toChargeRow(c, validStation, { includeStatus: false })),
    )) {
      chargeUuidByDedupe.set(k, v);
    }

    // ── charge_energy_details (charge uuid resolved) ────────────────────────
    const detailRows = snapshot.chargeEnergyDetails
      .map((d) => {
        const uuid = chargeUuidByDedupe.get(d.chargeId);
        return uuid ? toEnergyDetailRow(d, uuid) : null;
      })
      .filter((r): r is Row => r !== null);
    await upsertAll(admin, "charge_energy_details", detailRows, "charge_id");

    // ── charge_lines (sync-exclusive → deterministic id upsert) ─────────────
    const lineRows = snapshot.chargeLines
      .map((l) => {
        const uuid = chargeUuidByDedupe.get(l.chargeId);
        return uuid ? toChargeLineRow(l, uuid) : null;
      })
      .filter((r): r is Row => r !== null);
    await upsertAll(admin, "charge_lines", lineRows, "id");

    // ── raw_sheet_rows (skip-unchanged by (tab,row_hash)) ───────────────────
    const rawRows: Row[] = [];
    let rowsRead = 0;
    for (const [tab, rows] of Object.entries(raw)) {
      for (const row of rows) {
        rowsRead += 1;
        const data: Record<string, string> = {};
        for (const [k, v] of Object.entries(row)) {
          if (k !== SHEET_ROW_KEY) data[k] = v;
        }
        const sheetRow = row[SHEET_ROW_KEY];
        rawRows.push({
          job_run_id: jobId,
          tab,
          sheet_row_number: sheetRow ? Number(sheetRow) : null,
          row_hash: rowHash(data),
          data,
        });
      }
    }
    await upsertAll(admin, "raw_sheet_rows", rawRows, "tab,row_hash", true);

    // ── finalize ─────────────────────────────────────────────────────────
    const scrapes = snapshot.utilityAccountStates
      .map((s) => s.scrapedAt)
      .filter((v): v is string => v !== null)
      .sort();
    const maxScrapedAt = scrapes.length > 0 ? scrapes[scrapes.length - 1] : null;
    const fiscalExportedTrue = snapshot.chargeEnergyDetails.filter(
      (d) => d.fiscalExported,
    ).length;

    const counts: Record<string, number> = {
      stations: snapshot.stations.length,
      counterparties: counterpartyRows.length,
      contracts: snapshot.contracts.length,
      billing_accounts: snapshot.billingAccounts.length,
      utility_account_state: snapshot.utilityAccountStates.length,
      monthly_consumption: snapshot.monthlyConsumption.length,
      charges: snapshot.charges.length,
      charge_energy_details: detailRows.length,
      charge_lines: lineRows.length,
      raw_sheet_rows: rawRows.length,
    };
    const rowsUpserted = Object.values(counts).reduce((a, b) => a + b, 0);
    const referentialFixes = {
      nulledAccountStations,
      nulledChargeStations,
      coalescedStationStatus,
      coalescedContractStatus,
      coalescedContractType,
      coalescedChargeAmount,
      stickyAccountsPreserved: stickyPreserved,
    };

    await finalizeJob(admin, jobId, {
      status: "success",
      trigger,
      source_ref: "sheets",
      rows_read: rowsRead,
      rows_upserted: rowsUpserted,
      rows_skipped: rpcCharges.length,
      max_scraped_at: maxScrapedAt,
      stats: { counts, issues: snapshot.issues, referentialFixes, fiscalExportedTrue },
    });

    return {
      jobId,
      status: "success",
      rowsRead,
      rowsUpserted,
      rowsSkipped: rpcCharges.length,
      maxScrapedAt,
      counts,
      fiscalExportedTrue,
      referentialFixes,
      issues: snapshot.issues,
      snapshot,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finalizeJob(admin, jobId, {
      status: "error",
      trigger,
      error: message,
    }).catch(() => {
      /* finalize best-effort; original error is what matters */
    });
    throw err;
  }
}
