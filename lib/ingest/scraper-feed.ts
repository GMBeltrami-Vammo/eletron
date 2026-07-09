/**
 * scraper-feed.ts — the Vammo-Enel scraper → app ingestion feed (decision #34).
 *
 * The scrapers dual-write: they keep their Google-Sheet append AND POST the same
 * row-dicts here (POST /api/ingest/scraper). Because the payload carries THE SAME
 * dicts the scraper builds for the sheet, we assemble them into a PARTIAL raw-tab
 * shape (only the provider's two tabs populated, the rest empty) and run the
 * existing `normalizeSnapshot` verbatim — so ingested rows come out identical to
 * cloned rows (same money/date/auto-debit/dedupe parsing).
 *
 * The upsert (`runScraperIngest`) mirrors `runSheetSync`'s ordering + H2
 * stickiness but is SCOPED to the energy entities, with one critical deviation:
 *
 *  - billing_accounts — INSERT NEW ONLY. A per-installation POST has no
 *    Vammo_data/Metabase, so it carries no station mapping. We match by the
 *    natural key (enel_id / uc); an EXISTING account is NEVER updated (its
 *    station_id / match_status / counterparty are preserved), and only a
 *    genuinely-new installation is inserted (unmatched, station null → surfaces
 *    in /revisão › Instalações). This is the spec's station-preserve rule.
 *  - charges — station/match are enriched from the account's CURRENT DB station
 *    (the account is the source of truth for the mapping the POST lacks), then
 *    upserted on `dedupe_key` (`enel:{id}:{due}` / `edp:{uc}:{due}`, decision
 *    #20) so a re-POST converges with the clone/manual rows instead of
 *    duplicating. Rows a human/RPC set (`status_source='rpc'`) keep their
 *    status/flags/fiscal via `toChargeRow(..., { includeStatus:false })`.
 *  - utility_account_state / monthly_consumption / charge_energy_details —
 *    upserted on their natural keys (scraper-owned fields).
 *
 * State 1 (Detectada) falls out for free: an installation with an `account` but
 * empty `faturas` normalizes to a utility_account_state row and NO charge, so
 * Q11's Ciclo shows Detectada — no placeholder charge is ever synthesized.
 *
 * Pure-ish + injectable client (like cobrancas.ts): no `server-only` import, so
 * the mapping is unit-testable against an in-memory fake ChargingClient.
 */

import { z } from "zod";

import type { ChargingClient } from "@/lib/data/supabase-repository";
import {
  MATCH_STATUS,
  type BillingAccount,
  type DomainSnapshot,
} from "@/lib/domain";
import { normalizeSnapshot } from "@/lib/ingest/normalize";
import type { RawRow, RawTabs, TabName } from "@/lib/ingest/raw-tabs";
import {
  partitionChargesByStatusSource,
  toBillingAccountRow,
  toChargeRow,
  toEnergyDetailRow,
  toMonthlyConsumptionRow,
  toUtilityStateRow,
  upsertAll,
  upsertChargesReturning,
} from "@/lib/sync/sheet-sync";

type Row = Record<string, unknown>;

export type ScraperProvider = "enel" | "edp";

// ── payload schema (lenient — the dicts ARE the sheet headers, kept verbatim) ─

const RowDict = z.record(z.string(), z.unknown());

const InstallationSchema = z
  .object({
    installationKey: z.union([z.string(), z.number()]).nullish(),
    account: RowDict.default({}),
    faturas: z.array(RowDict).default([]),
  })
  .loose();

export const ScraperPayloadSchema = z
  .object({
    provider: z.string(),
    installations: z.array(InstallationSchema).default([]),
  })
  .loose();

export type RawScraperPayload = z.infer<typeof ScraperPayloadSchema>;

/**
 * Abuse/DoS guard: a single POST should carry a scrape batch, not the whole
 * fleet. The scraper streams per-installation (usually 1) and chunks at 100/
 * session, so this is generous headroom. Correctness of the H2 status-source
 * partition does NOT depend on this cap — the preflight reads chunk their keys
 * (READ_KEY_CHUNK) so they are never truncated regardless of batch size.
 */
export const MAX_INSTALLATIONS_PER_POST = 1000;

export interface ScraperInstallation {
  installationKey: string | null;
  account: Record<string, unknown>;
  faturas: Record<string, unknown>[];
}

export interface ScraperPayload {
  provider: ScraperProvider;
  installations: ScraperInstallation[];
}

export class ScraperIngestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ScraperIngestError";
  }
}

/**
 * Validates + narrows the POST body. `provider` is normalized to lowercase and
 * must be 'enel' | 'edp'; missing `faturas` → []. Throws ScraperIngestError(400)
 * on a shape/provider failure.
 */
export function parseScraperPayload(body: unknown): ScraperPayload {
  const parsed = ScraperPayloadSchema.safeParse(body);
  if (!parsed.success) {
    throw new ScraperIngestError(400, `payload inválido: ${parsed.error.message}`);
  }
  const provider = String(parsed.data.provider).trim().toLowerCase();
  if (provider !== "enel" && provider !== "edp") {
    throw new ScraperIngestError(
      400,
      `provider inválido: '${parsed.data.provider}' (esperado 'enel' ou 'edp')`,
    );
  }
  if (parsed.data.installations.length > MAX_INSTALLATIONS_PER_POST) {
    throw new ScraperIngestError(
      400,
      `lote grande demais: ${parsed.data.installations.length} instalações ` +
        `(máx ${MAX_INSTALLATIONS_PER_POST} por POST — divida em lotes menores)`,
    );
  }
  const installations: ScraperInstallation[] = parsed.data.installations.map((i) => ({
    installationKey: i.installationKey == null ? null : String(i.installationKey),
    account: (i.account ?? {}) as Record<string, unknown>,
    faturas: (i.faturas ?? []) as Record<string, unknown>[],
  }));
  return { provider, installations };
}

// ── assemble → the partial raw-tabs shape normalize expects ──────────────────

/** A full RawTabs with every tab empty (normalize `.forEach`s over each one). */
function emptyRawTabs(): RawTabs {
  return {
    Vammo_data: [],
    enel_data: [],
    edp_data: [],
    Faturas_ENEL: [],
    Faturas_EDP: [],
    MatchingQualityCheck: [],
    "1_Cadastro": [],
    "2_Pagamentos": [],
    "3_Reajustes": [],
  };
}

/** A row-dict (verbatim sheet headers) → the string-valued RawRow normalize reads. */
function toRawRow(dict: Record<string, unknown>): RawRow {
  const row: RawRow = {};
  for (const [k, v] of Object.entries(dict)) {
    row[k] = v === null || v === undefined ? "" : String(v);
  }
  return row;
}

/**
 * Places the provider's account rows into enel_data/edp_data and the fatura rows
 * into Faturas_ENEL/Faturas_EDP; every other tab stays empty. normalize then
 * produces only these installations' accounts/states/charges/details/consumption.
 */
export function assembleRawTabs(payload: ScraperPayload): RawTabs {
  const raw = emptyRawTabs();
  const accountTab: TabName = payload.provider === "enel" ? "enel_data" : "edp_data";
  const faturaTab: TabName = payload.provider === "enel" ? "Faturas_ENEL" : "Faturas_EDP";
  for (const inst of payload.installations) {
    raw[accountTab].push(toRawRow(inst.account));
    for (const f of inst.faturas) raw[faturaTab].push(toRawRow(f));
  }
  return raw;
}

// ── the scoped, station-preserving upsert ────────────────────────────────────

export interface ScraperIngestStats {
  provider: ScraperProvider;
  installations: number;
  accountsInserted: number;
  statesUpserted: number;
  chargesUpserted: number;
  detailsUpserted: number;
  /** normalize() issues (rows dropped/coerced) — non-zero signals a shape problem. */
  normalizeIssues: number;
}

interface ExistingAccountRow {
  enel_id: string | null;
  edp_uc: string | null;
  station_id: number | null;
}

/**
 * Max keys per `.in(...)` preflight SELECT. PostgREST caps a response at
 * `db-max-rows` (default 1000); a single `.in()` over more keys than that would
 * silently truncate its result, and a truncated charges-preflight would
 * misclassify an existing `status_source='rpc'` charge as `sync` and clobber a
 * human-set status/flags/fiscal. Chunking the keys keeps every response well
 * under the cap, so the partition is correct for any payload size.
 */
const READ_KEY_CHUNK = 500;

/** Runs `runChunk` over `keys` in READ_KEY_CHUNK-sized slices and concatenates. */
async function selectByKeysChunked<T>(
  keys: string[],
  runChunk: (chunkKeys: string[]) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < keys.length; i += READ_KEY_CHUNK) {
    out.push(...(await runChunk(keys.slice(i, i + READ_KEY_CHUNK))));
  }
  return out;
}

/**
 * Upserts a normalized partial snapshot into `charging`, scoped to the energy
 * entities, preserving existing station matches (see file header). `meta.provider`
 * selects the natural key; `meta.installations` is the payload count for stats.
 */
export async function runScraperIngest(
  admin: ChargingClient,
  snapshot: DomainSnapshot,
  meta: { provider: ScraperProvider; installations: number },
): Promise<ScraperIngestStats> {
  const { provider } = meta;
  const naturalCol = provider === "enel" ? "enel_id" : "edp_uc";
  const accountType = provider === "enel" ? "energy_enel" : "energy_edp";
  const naturalKey = (a: BillingAccount): string | null =>
    provider === "enel" ? a.enelId : a.edpUc;

  // ── existing accounts by NATURAL key (station-preserve) ──────────────────
  const keys = snapshot.billingAccounts
    .map(naturalKey)
    .filter((k): k is string => k !== null);
  const existingKeys = new Set<string>();
  const stationByStringId = new Map<string, number | null>();
  const existingAccounts = await selectByKeysChunked<ExistingAccountRow>(
    keys,
    async (chunkKeys) => {
      const { data, error } = await admin
        .from("billing_accounts")
        .select("enel_id, edp_uc, station_id")
        .eq("account_type", accountType)
        .in(naturalCol, chunkKeys);
      if (error) throw new Error(`billing_accounts read failed: ${error.message}`);
      return (data ?? []) as ExistingAccountRow[];
    },
  );
  for (const r of existingAccounts) {
    const nk = provider === "enel" ? r.enel_id : r.edp_uc;
    if (nk === null) continue;
    existingKeys.add(nk);
    stationByStringId.set(
      provider === "enel" ? `enel:${nk}` : `edp:${nk}`,
      r.station_id,
    );
  }

  // ── INSERT NEW accounts only — NEVER update an existing one ───────────────
  // A new account is inserted unmatched with station null (the POST has no
  // reliable station mapping); an existing account is left entirely untouched,
  // preserving its station_id / match_status / counterparty.
  const nullStation = (): number | null => null;
  const newAccounts = snapshot.billingAccounts.filter((a) => {
    const nk = naturalKey(a);
    return nk !== null && !existingKeys.has(nk);
  });
  let accountsInserted = 0;
  if (newAccounts.length > 0) {
    const rows = newAccounts.map((a) =>
      toBillingAccountRow(a, nullStation, { sticky: false }),
    );
    // upsert-ignore on the PK (deterministic from the natural key): idempotent
    // if two POSTs race on the same new installation. `ignoreDuplicates` means
    // DO NOTHING on conflict, so an account that already exists is NEVER
    // updated — the station-preserve rule holds even under a concurrent insert.
    const { error } = await admin
      .from("billing_accounts")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new Error(`billing_accounts insert failed: ${error.message}`);
    accountsInserted = rows.length;
  }

  // ── enrich charge station/match from the account's CURRENT DB station ─────
  // The POST lacks the station mapping, so a charge inherits it from its
  // account (matched → the DB station; new/unmatched → null). This mirrors what
  // a full sheet-sync produces and prevents a re-scrape from un-matching a
  // charge on an already-matched account.
  for (const c of snapshot.charges) {
    const station = c.billingAccountId
      ? (stationByStringId.get(c.billingAccountId) ?? null)
      : null;
    c.stationId = station;
    c.matchStatus =
      station !== null ? MATCH_STATUS.autoMatched : MATCH_STATUS.unmatched;
  }
  const validStation = (id: number | null): number | null => id;

  // ── utility_account_state (scraper-owned dynamic fields) ──────────────────
  await upsertAll(
    admin,
    "utility_account_state",
    snapshot.utilityAccountStates.map(toUtilityStateRow),
    "billing_account_id",
  );

  // ── monthly_consumption ───────────────────────────────────────────────────
  await upsertAll(
    admin,
    "monthly_consumption",
    snapshot.monthlyConsumption.map(toMonthlyConsumptionRow),
    "billing_account_id,competencia",
  );

  // ── charges (H2 partition on dedupe_key; scoped to this payload's keys) ────
  const dedupeKeys = snapshot.charges.map((c) => c.dedupeKey);
  const existingStatusSource = new Map<string, "sync" | "rpc">();
  const existingCharges = await selectByKeysChunked<{
    dedupe_key: string;
    status_source: "sync" | "rpc";
  }>(dedupeKeys, async (chunkKeys) => {
    const { data, error } = await admin
      .from("charges")
      .select("dedupe_key, status_source")
      .in("dedupe_key", chunkKeys);
    if (error) throw new Error(`charges preflight failed: ${error.message}`);
    return (data ?? []) as { dedupe_key: string; status_source: "sync" | "rpc" }[];
  });
  for (const r of existingCharges) {
    existingStatusSource.set(r.dedupe_key, r.status_source);
  }
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

  // ── charge_energy_details (charge uuid resolved from the upsert) ──────────
  const detailRows = snapshot.chargeEnergyDetails
    .map((d) => {
      const uuid = chargeUuidByDedupe.get(d.chargeId);
      return uuid ? toEnergyDetailRow(d, uuid) : null;
    })
    .filter((r): r is Row => r !== null);
  await upsertAll(admin, "charge_energy_details", detailRows, "charge_id");

  const stats: ScraperIngestStats = {
    provider,
    installations: meta.installations,
    accountsInserted,
    statesUpserted: snapshot.utilityAccountStates.length,
    chargesUpserted: snapshot.charges.length,
    detailsUpserted: detailRows.length,
    normalizeIssues: snapshot.issues.length,
  };

  // ── one audit event per run (counts by provider) ──────────────────────────
  await admin.from("audit_events").insert({
    entity_table: "job",
    entity_id: `ingest-scraper:${provider}`,
    event_type: "scraper_ingest",
    actor_email: "system:scraper-ingest",
    detail: {
      provider,
      installations: stats.installations,
      accounts_inserted: stats.accountsInserted,
      states_upserted: stats.statesUpserted,
      charges_upserted: stats.chargesUpserted,
      details_upserted: stats.detailsUpserted,
      normalize_issues: stats.normalizeIssues,
    },
  });

  return stats;
}

/**
 * Full processing: assemble the POSTed row-dicts into a partial raw-tabs shape,
 * run `normalizeSnapshot`, then the scoped station-preserving upsert.
 */
export async function ingestScraperPayload(
  admin: ChargingClient,
  payload: ScraperPayload,
): Promise<ScraperIngestStats> {
  const raw = assembleRawTabs(payload);
  const snapshot = normalizeSnapshot(raw);
  return runScraperIngest(admin, snapshot, {
    provider: payload.provider,
    installations: payload.installations.length,
  });
}
