/**
 * Supabase-backed Repository (Phase 2). Reads the `charging` schema and
 * assembles the SAME `DomainSnapshot` the sheets backend produces, so every
 * screen is backend-agnostic behind the `Repository` interface. All derived
 * logic (rollups, alerts, filters, freshness) is inherited from
 * `SnapshotRepository` — this file only turns rows into a snapshot.
 *
 * Key invariants (review-resolutions H3):
 * - Every table read is paginated with `.range()` in 1000-row loops (PostgREST
 *   caps a single response at 1000; never assume fewer rows).
 * - Domain ids stay the Phase-1 deterministic strings so URLs/ids match the
 *   sheets backend: `station.id` = swap_station_id int; billing account id =
 *   `enel:{enel_id}` / `edp:{uc}` / `rent:{cadastro_id}` / `3p:{key}:{station}`
 *   (reconstructed here from columns using the SAME recipe as normalize.ts);
 *   `charge.id` = `dedupe_key`. The DB uuids never leak into the domain.
 * - Postgres `numeric` comes back over PostgREST as a STRING; every money/kWh
 *   column is coerced with `num()` (integers/doubles pass through).
 *
 * New entities (meter_readings, documents/receipts/payments, job_runs,
 * user_roles) are OUT of the Repository interface — read directly via
 * `supabaseForUser` in server components (H3), not here.
 *
 * Runtime-agnostic (no Next.js / server-only imports): tests construct it with
 * a fake client; repository.server.ts injects the cached loader + admin client.
 */

import type { supabaseForUser } from "@/lib/supabase/client";

import {
  type AccountType,
  type AdjustmentIndex,
  type AdjustmentStatus,
  type AutoDebitStatus,
  type BillingAccount,
  type Charge,
  type ChargeEnergyDetails,
  type ChargeKind,
  type ChargeLine,
  type ChargeLineKind,
  type ChargeStatus,
  type CompetenciaSource,
  type Contract,
  type ContractType,
  type Counterparty,
  type CounterpartyKind,
  type IngestSource,
  type MatchStatus,
  type MonthlyConsumption,
  type NormalizationIssue,
  type PaymentMethod,
  type RentAdjustment,
  type Station,
  type StationStatus,
  type UtilityAccountState,
  type UtilityBillStatus,
} from "@/lib/domain";
import {
  extractLeadingIsoDate,
  parseBillStatus,
  parseMonthYearLabel,
  slug,
} from "@/lib/ingest/normalize";
import { SnapshotRepository, type LoadedSnapshot } from "./repository";

/**
 * The charging-schema Supabase client type (from `supabaseForUser` /
 * `supabaseAdmin`, both `db.schema='charging'`). Derived so the schema generic
 * matches; imported as a type only, so this module stays runtime-agnostic.
 */
export type ChargingClient = ReturnType<typeof supabaseForUser>;

// ═══════════════════════════════════════════════════════════════════════════
// Coercion + pagination
// ═══════════════════════════════════════════════════════════════════════════

/** Postgres numeric → number (PostgREST returns it as a string); null-safe. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const PAGE_SIZE = 1000;

/**
 * Reads an entire charging table in 1000-row pages (H3). Orders by a stable
 * key so pages don't overlap or gap; throws with the table name on error.
 */
async function selectAll<T>(
  client: ChargingClient,
  table: string,
  order: [string] | [string, string],
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const sel = client.from(table).select("*");
    const ordered =
      order.length === 2
        ? sel.order(order[0], { ascending: true }).order(order[1], { ascending: true })
        : sel.order(order[0], { ascending: true });
    const { data, error } = await ordered.range(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`charging.${table} read failed: ${error.message}`);
    }
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Deterministic domain-id reconstruction (mirror of normalize.ts recipes)
// ═══════════════════════════════════════════════════════════════════════════

/** `cp:{cnpj}` when a CNPJ/CPF exists, else `cp:name:{slug}` (normalize parity). */
export function reconstructCounterpartyId(
  cnpjCpf: string | null,
  name: string,
): string {
  return cnpjCpf ? `cp:${cnpjCpf}` : `cp:name:${slug(name)}`;
}

/** `contract:{cadastro_id}` (app-created rows fall back to the uuid). */
export function reconstructContractId(
  cadastroId: number | null,
  fallbackUuid: string,
): string {
  return cadastroId !== null ? `contract:${cadastroId}` : `contract:${fallbackUuid}`;
}

export interface AccountIdContext {
  cadastroByContractUuid: Map<string, number | null>;
  counterpartyByUuid: Map<string, { cnpjCpf: string | null; name: string }>;
}

/**
 * Reconstructs the Phase-1 billing-account domain id from DB columns, matching
 * normalize.ts exactly: `enel:{enel_id}` / `edp:{uc}` / `rent:{cadastro_id}` /
 * `3p:{cnpj|name-slug}:{station|'unmatched'}`.
 */
export function reconstructAccountId(
  row: {
    account_type: AccountType;
    enel_id: string | null;
    edp_uc: string | null;
    contract_id: string | null;
    counterparty_id: string | null;
    station_id: number | null;
  },
  ctx: AccountIdContext,
): string {
  switch (row.account_type) {
    case "energy_enel":
      return `enel:${row.enel_id}`;
    case "energy_edp":
      return `edp:${row.edp_uc}`;
    case "rent": {
      const cad = row.contract_id
        ? (ctx.cadastroByContractUuid.get(row.contract_id) ?? null)
        : null;
      return `rent:${cad ?? "unknown"}`;
    }
    case "third_party": {
      const cp = row.counterparty_id
        ? ctx.counterpartyByUuid.get(row.counterparty_id)
        : undefined;
      const cpKey = cp?.cnpjCpf ?? `name:${slug(cp?.name ?? "")}`;
      return `3p:${cpKey}:${row.station_id ?? "unmatched"}`;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DB row shapes (only the columns the snapshot needs). numeric() = string|number.
// ═══════════════════════════════════════════════════════════════════════════

type Numeric = string | number | null;

interface StationRow {
  id: number;
  name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  status: StationStatus;
  source_created_at: string | null;
  active_boxes: number | null;
  boxes_synced_at: string | null;
  raw: Record<string, string> | null;
}
interface CounterpartyRow {
  id: string;
  name: string;
  cnpj_cpf: string | null;
  kind: CounterpartyKind;
  notes: string | null;
}
interface ContractRow {
  id: string;
  cadastro_id: number | null;
  station_id: number | null;
  counterparty_id: string | null;
  status: StationStatus;
  address: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  enel_connection_number: string | null;
  contract_type: ContractType;
  box_count: number | null;
  min_box: number | null;
  valor_por_box: Numeric;
  valor_mensal: Numeric;
  due_day: number | null;
  payment_method: PaymentMethod | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chave_pix: string | null;
  starts_on: string | null;
  ends_on: string | null;
  observations: string | null;
  rent_manual: boolean | null;
}
interface BillingAccountRow {
  id: string;
  station_id: number | null;
  account_type: AccountType;
  enel_id: string | null;
  edp_uc: string | null;
  edp_contract_id: string | null;
  contract_id: string | null;
  counterparty_id: string | null;
  external_ref: string | null;
  auto_debit_registration: string | null;
  match_status: MatchStatus;
  is_active: boolean;
  notes: string | null;
}
interface UtilityStateRow {
  billing_account_id: string;
  provider_station_status: string | null;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  bill_status: UtilityBillStatus | null;
  bill_status_raw: string | null;
  last_billing: Numeric;
  due_date: string | null;
  auto_debit: AutoDebitStatus;
  auto_debit_registration: string | null;
  account_email: string | null;
  negotiated_invoices: string[] | null;
  invoice_history: string[] | null;
  shutdown_date: string | null;
  shutdown_start: string | null;
  shutdown_end: string | null;
  first_seen_at: string | null;
  scraped_at: string | null;
  lat: number | null;
  lon: number | null;
  ultima_fatura_flag: string | null;
  ultimo_comprovante: string | null;
  is_status_carried_forward: boolean;
  raw: Record<string, string> | null;
}
interface MonthlyConsumptionRow {
  billing_account_id: string;
  competencia: string;
  kwh_billed: Numeric;
  kwh_recorded: Numeric;
  source: IngestSource;
}
interface ChargeRow {
  id: string;
  billing_account_id: string | null;
  station_id: number | null;
  kind: ChargeKind;
  competencia: string | null;
  competencia_source: CompetenciaSource;
  amount: Numeric;
  expected_amount: Numeric;
  due_date: string | null;
  status: ChargeStatus;
  status_source: "sync" | "rpc";
  match_status: MatchStatus;
  flags: string[] | null;
  payment_method: PaymentMethod | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chave_pix: string | null;
  linha_digitavel: string | null;
  nota_fiscal: string | null;
  documento_numero: string | null;
  issuer_cnpj: string | null;
  source: IngestSource;
  dedupe_key: string;
  legacy_ref: { tab: string; rowNumber: number } | null;
  raw: Record<string, string> | null;
  notes: string | null;
}
interface EnergyDetailRow {
  charge_id: string;
  nf: string | null;
  tariff_c1: string | null;
  tariff_c2: string | null;
  tariff_c3: string | null;
  tariff_c4: string | null;
  tariff_c5: string | null;
  tariff_c6: string | null;
  classificacao: string | null;
  modalidade: string | null;
  tipo_fornecimento: string | null;
  tusd_kwh: Numeric;
  tusd_amount: Numeric;
  te_kwh: Numeric;
  te_amount: Numeric;
  cip: Numeric;
  sub_faturamento: Numeric;
  total: Numeric;
  leitura_anterior: string | null;
  leitura_atual: string | null;
  auto_debit: AutoDebitStatus;
  auto_debit_registration: string | null;
  fatura_drive_url: string | null;
  fiscal_exported: boolean;
  fiscal_exported_at: string | null;
}
interface ChargeLineRow {
  id: string;
  charge_id: string;
  line_kind: ChargeLineKind;
  description: string | null;
  amount: Numeric;
  competencia: string | null;
  competencia_source: CompetenciaSource | null;
}
interface RentAdjustmentRow {
  id: string;
  contract_id: string | null;
  negotiated_on: string | null;
  index_type: AdjustmentIndex;
  index_pct: Numeric;
  old_amount: Numeric;
  new_amount: Numeric;
  effective_from: string | null;
  status: AdjustmentStatus;
  notes: string | null;
}
interface JobRunStatsRow {
  stats: { issues?: NormalizationIssue[] } | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Snapshot assembly
// ═══════════════════════════════════════════════════════════════════════════

/** Latest sheet-sync run's captured issues (feeds getIrregularities/IngestHealthCard). */
async function loadLatestSyncIssues(
  client: ChargingClient,
): Promise<NormalizationIssue[]> {
  const { data, error } = await client
    .from("job_runs")
    .select("stats")
    .eq("job_name", "sheet-sync")
    .eq("status", "success")
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`charging.job_runs read failed: ${error.message}`);
  const rows = (data ?? []) as JobRunStatsRow[];
  return rows[0]?.stats?.issues ?? [];
}

/**
 * Loads the whole `charging` world and returns the assembled snapshot plus the
 * `accountStringId → uuid` map (the map is what alerts-eval needs to resolve
 * alert FKs; the repository ignores it).
 */
export async function loadChargingWorld(
  client: ChargingClient,
  now: Date,
): Promise<{ snapshot: LoadedSnapshot; accountUuidByStringId: Map<string, string> }> {
  const [
    stationRows,
    cpRows,
    contractRows,
    accountRows,
    stateRows,
    mcRows,
    chargeRows,
    edRows,
    lineRows,
    adjRows,
    issues,
  ] = await Promise.all([
    selectAll<StationRow>(client, "stations", ["id"]),
    selectAll<CounterpartyRow>(client, "counterparties", ["id"]),
    selectAll<ContractRow>(client, "contracts", ["id"]),
    selectAll<BillingAccountRow>(client, "billing_accounts", ["id"]),
    selectAll<UtilityStateRow>(client, "utility_account_state", ["billing_account_id"]),
    selectAll<MonthlyConsumptionRow>(client, "monthly_consumption", [
      "billing_account_id",
      "competencia",
    ]),
    selectAll<ChargeRow>(client, "charges", ["id"]),
    selectAll<EnergyDetailRow>(client, "charge_energy_details", ["charge_id"]),
    selectAll<ChargeLineRow>(client, "charge_lines", ["id"]),
    selectAll<RentAdjustmentRow>(client, "rent_adjustments", ["id"]),
    loadLatestSyncIssues(client),
  ]);

  // ── uuid ↔ deterministic-string maps ─────────────────────────────────────
  const counterpartyByUuid = new Map(
    cpRows.map((r) => [r.id, { cnpjCpf: r.cnpj_cpf, name: r.name }]),
  );
  const cpStringIdByUuid = new Map(
    cpRows.map((r) => [r.id, reconstructCounterpartyId(r.cnpj_cpf, r.name)]),
  );
  const cadastroByContractUuid = new Map(
    contractRows.map((r) => [r.id, r.cadastro_id]),
  );
  const contractStringIdByUuid = new Map(
    contractRows.map((r) => [r.id, reconstructContractId(r.cadastro_id, r.id)]),
  );
  const stationByContractUuid = new Map(
    contractRows.map((r) => [r.id, r.station_id]),
  );
  const accountIdCtx: AccountIdContext = {
    cadastroByContractUuid,
    counterpartyByUuid,
  };
  const accountStringIdByUuid = new Map(
    accountRows.map((r) => [r.id, reconstructAccountId(r, accountIdCtx)]),
  );
  const accountUuidByStringId = new Map<string, string>();
  for (const [uuid, stringId] of accountStringIdByUuid) {
    accountUuidByStringId.set(stringId, uuid);
  }
  const dedupeByChargeUuid = new Map(chargeRows.map((r) => [r.id, r.dedupe_key]));

  const acct = (uuid: string | null): string | null =>
    uuid ? (accountStringIdByUuid.get(uuid) ?? null) : null;

  // ── domain arrays ────────────────────────────────────────────────────────
  const stations: Station[] = stationRows.map((r) => ({
    id: r.id,
    name: r.name,
    address: r.address,
    latitude: num(r.latitude),
    longitude: num(r.longitude),
    status: r.status,
    sourceCreatedAt: r.source_created_at,
    activeBoxes: r.active_boxes,
    boxesSyncedAt: r.boxes_synced_at,
    raw: r.raw ?? {},
  }));

  const counterparties: Counterparty[] = cpRows.map((r) => ({
    id: cpStringIdByUuid.get(r.id) as string,
    name: r.name,
    cnpjCpf: r.cnpj_cpf,
    kind: r.kind,
    notes: r.notes,
  }));

  const contracts: Contract[] = contractRows.map((r) => ({
    id: contractStringIdByUuid.get(r.id) as string,
    cadastroId: r.cadastro_id,
    stationId: r.station_id,
    counterpartyId: r.counterparty_id
      ? (cpStringIdByUuid.get(r.counterparty_id) ?? null)
      : null,
    status: r.status,
    address: r.address,
    contactName: r.contact_name,
    phone: r.phone,
    email: r.email,
    enelConnectionNumber: r.enel_connection_number,
    contractType: r.contract_type,
    boxCount: r.box_count,
    minBox: r.min_box,
    valorPorBox: num(r.valor_por_box),
    valorMensal: num(r.valor_mensal),
    dueDay: r.due_day,
    paymentMethod: r.payment_method,
    banco: r.banco,
    agencia: r.agencia,
    conta: r.conta,
    chavePix: r.chave_pix,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    observations: r.observations,
    rentManual: r.rent_manual ?? false,
    raw: {},
  }));

  const billingAccounts: BillingAccount[] = accountRows.map((r) => ({
    id: accountStringIdByUuid.get(r.id) as string,
    stationId: r.station_id,
    accountType: r.account_type,
    enelId: r.enel_id,
    edpUc: r.edp_uc,
    edpContractId: r.edp_contract_id,
    contractId: r.contract_id
      ? (contractStringIdByUuid.get(r.contract_id) ?? null)
      : null,
    counterpartyId: r.counterparty_id
      ? (cpStringIdByUuid.get(r.counterparty_id) ?? null)
      : null,
    externalRef: r.external_ref,
    autoDebitRegistration: r.auto_debit_registration,
    matchStatus: r.match_status,
    isActive: r.is_active,
    notes: r.notes,
  }));

  const utilityAccountStates: UtilityAccountState[] = stateRows.map((r) => {
    const negotiatedInvoices = r.negotiated_invoices ?? [];
    const invoiceHistory = r.invoice_history ?? [];
    return {
      billingAccountId: acct(r.billing_account_id) as string,
      providerStationStatus: r.provider_station_status,
      address: r.address,
      neighborhood: r.neighborhood,
      city: r.city,
      billStatus: r.bill_status,
      billStatusRaw: r.bill_status_raw,
      lastBilling: num(r.last_billing),
      dueDate: r.due_date,
      autoDebit: r.auto_debit,
      autoDebitRegistration: r.auto_debit_registration,
      accountEmail: r.account_email,
      negotiatedInvoices,
      negotiatedCompetencias: negotiatedInvoices
        .map((l) => parseMonthYearLabel(l))
        .filter((c): c is string => c !== null),
      invoiceHistory,
      invoiceHistoryStatuses: invoiceHistory.map((h) => parseBillStatus(h).status),
      shutdownDate: r.shutdown_date,
      shutdownStart: r.shutdown_start,
      shutdownEnd: r.shutdown_end,
      firstSeenAt: r.first_seen_at,
      scrapedAt: r.scraped_at,
      lat: num(r.lat),
      lon: num(r.lon),
      ultimaFaturaFlag: r.ultima_fatura_flag,
      ultimoComprovante: r.ultimo_comprovante,
      ultimoComprovanteDate: extractLeadingIsoDate(r.ultimo_comprovante ?? ""),
      isStatusCarriedForward: r.is_status_carried_forward,
      raw: r.raw ?? {},
    };
  });

  const monthlyConsumption: MonthlyConsumption[] = mcRows.map((r) => ({
    billingAccountId: acct(r.billing_account_id) as string,
    competencia: r.competencia,
    kwhBilled: num(r.kwh_billed),
    kwhRecorded: num(r.kwh_recorded),
    source: r.source,
  }));

  const charges: Charge[] = chargeRows.map((r) => ({
    id: r.dedupe_key,
    billingAccountId: acct(r.billing_account_id),
    stationId: r.station_id,
    kind: r.kind,
    competencia: r.competencia,
    competenciaSource: r.competencia_source,
    amount: num(r.amount),
    expectedAmount: num(r.expected_amount),
    dueDate: r.due_date,
    status: r.status,
    statusSource: r.status_source,
    matchStatus: r.match_status,
    flags: r.flags ?? [],
    paymentMethod: r.payment_method,
    banco: r.banco,
    agencia: r.agencia,
    conta: r.conta,
    chavePix: r.chave_pix,
    linhaDigitavel: r.linha_digitavel,
    notaFiscal: r.nota_fiscal,
    documentoNumero: r.documento_numero,
    issuerCnpj: r.issuer_cnpj,
    source: r.source,
    dedupeKey: r.dedupe_key,
    legacyRef: r.legacy_ref,
    notes: r.notes,
    raw: r.raw ?? {},
  }));

  const chargeEnergyDetails: ChargeEnergyDetails[] = edRows
    .map((r): ChargeEnergyDetails | null => {
      const chargeId = dedupeByChargeUuid.get(r.charge_id);
      if (chargeId === undefined) return null;
      return {
        chargeId,
        nf: r.nf,
        tariffC1: r.tariff_c1,
        tariffC2: r.tariff_c2,
        tariffC3: r.tariff_c3,
        tariffC4: r.tariff_c4,
        tariffC5: r.tariff_c5,
        tariffC6: r.tariff_c6,
        classificacao: r.classificacao,
        modalidade: r.modalidade,
        tipoFornecimento: r.tipo_fornecimento,
        tusdKwh: num(r.tusd_kwh),
        tusdAmount: num(r.tusd_amount),
        teKwh: num(r.te_kwh),
        teAmount: num(r.te_amount),
        cip: num(r.cip),
        subFaturamento: num(r.sub_faturamento),
        total: num(r.total),
        leituraAnterior: r.leitura_anterior,
        leituraAtual: r.leitura_atual,
        autoDebit: r.auto_debit,
        autoDebitRegistration: r.auto_debit_registration,
        faturaDriveUrl: r.fatura_drive_url,
        fiscalExported: r.fiscal_exported,
        fiscalExportedAt: r.fiscal_exported_at,
      };
    })
    .filter((d): d is ChargeEnergyDetails => d !== null);

  const chargeLines: ChargeLine[] = lineRows
    .map((r): ChargeLine | null => {
      const chargeId = dedupeByChargeUuid.get(r.charge_id);
      if (chargeId === undefined) return null;
      return {
        id: `${chargeId}:${r.line_kind}`,
        chargeId,
        lineKind: r.line_kind,
        description: r.description,
        amount: num(r.amount) ?? 0,
        competencia: r.competencia,
        competenciaSource: r.competencia_source,
      };
    })
    .filter((l): l is ChargeLine => l !== null);

  const rentAdjustments: RentAdjustment[] = adjRows.map((r) => ({
    id: `reajuste:${r.id}`,
    contractId: r.contract_id
      ? (contractStringIdByUuid.get(r.contract_id) ?? null)
      : null,
    stationId: r.contract_id
      ? (stationByContractUuid.get(r.contract_id) ?? null)
      : null,
    negotiatedOn: r.negotiated_on,
    indexType: r.index_type,
    indexPct: num(r.index_pct),
    oldAmount: num(r.old_amount),
    newAmount: num(r.new_amount),
    effectiveFrom: r.effective_from,
    status: r.status,
    notes: r.notes,
    raw: {},
  }));

  const snapshot: LoadedSnapshot = {
    stations,
    counterparties,
    contracts,
    billingAccounts,
    utilityAccountStates,
    monthlyConsumption,
    charges,
    chargeLines,
    chargeEnergyDetails,
    rentAdjustments,
    issues,
    fetchedAt: now.toISOString(),
  };
  return { snapshot, accountUuidByStringId };
}

/** LoadedSnapshot only (the Repository entry point). */
export async function loadChargingSnapshot(
  client: ChargingClient,
  now: Date,
): Promise<LoadedSnapshot> {
  const { snapshot } = await loadChargingWorld(client, now);
  return snapshot;
}

/**
 * Reads all 8 methods from the `charging` schema. Pass `supabaseForUser(token)`
 * for RLS reads or `supabaseAdmin()` for jobs. `snapshotLoader` lets
 * repository.server.ts inject a 15-min-cached loader for server components
 * (the class's own memo only dedupes within one instance/request).
 */
export class SupabaseRepository extends SnapshotRepository {
  constructor(
    private readonly client: ChargingClient,
    clock: () => Date = () => new Date(),
    private readonly snapshotLoader?: () => Promise<LoadedSnapshot>,
  ) {
    super(clock);
  }

  protected loadSnapshot(): Promise<LoadedSnapshot> {
    if (this.snapshotLoader) return this.snapshotLoader();
    return loadChargingSnapshot(this.client, this.clock());
  }
}
