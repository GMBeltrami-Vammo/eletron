/**
 * alerts-eval core — persists the alert panel from the `charging` snapshot.
 * Reuses the existing TS `evaluateAlerts()` verbatim (M3: no SQL re-implementation
 * of the rules) and writes rows with these semantics:
 *
 * - UPSERT by `dedupe_key`, OMITTING `status` / `first_detected_at` so a
 *   re-detected alert keeps its human state (acknowledged/muted) AND a resolved
 *   alert is NOT reopened — only `last_detected_at` / `payload` / `severity` /
 *   FKs refresh (per the parent task's explicit "no reopen").
 * - AUTO-RESOLVE the rule-driven alerts whose condition cleared (present in the
 *   DB as open/acknowledged, absent from this evaluation) →
 *   `resolved_by_email='system:alerts-eval'`. Only the 9 evaluateAlerts types
 *   are auto-resolved; the job-emitted self-alerts are left alone.
 * - Emit / clear `sheet_sync_stale` when the latest successful sheet-sync is
 *   older than 26h (H6).
 *
 * Server-only by convention (service-role writes). Shared by
 * /api/cron/alerts-eval and /api/cron/daily.
 */

import { type Alert } from "@/lib/domain";
import { evaluateAlerts } from "@/lib/ingest/derive";
import {
  loadChargingWorld,
  type ChargingClient,
} from "@/lib/data/supabase-repository";
import { claimJob, finalizeJob } from "./job-runs";
import { SHEET_SYNC_JOB_NAME } from "./sheet-sync";

export const ALERTS_EVAL_JOB_NAME = "alerts-eval";
const STALE_HOURS = 26;
const SHEET_SYNC_STALE_KEY = "sheet_sync_stale:sheet-sync";
const BATCH = 500;

/** The alert types evaluateAlerts() emits — the only ones auto-resolved. */
export const EVAL_ALERT_TYPES: ReadonlySet<string> = new Set([
  "overdue_bill",
  "due_soon_no_auto_debit",
  "no_auto_debit",
  "new_installation",
  "scraper_stale",
  "negotiated_invoice",
  "scheduled_shutdown",
  "station_without_contract",
  "contract_without_station",
]);

type Row = Record<string, unknown>;

interface ExistingAlert {
  dedupe_key: string;
  status: string;
  alert_type: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Maps an evaluated alert to a DB upsert row. `billing_account_id` (a uuid FK)
 * is resolved from the domain string id; `charge_id` is always null
 * (evaluateAlerts never sets one). `status`/`first_detected_at` are omitted so
 * the upsert preserves them on existing rows.
 */
export function alertRow(
  a: Alert,
  accountUuidByStringId: Map<string, string>,
  lastDetectedAt: string,
): Row {
  return {
    alert_type: a.alertType,
    severity: a.severity,
    station_id: a.stationId,
    billing_account_id: a.billingAccountId
      ? (accountUuidByStringId.get(a.billingAccountId) ?? null)
      : null,
    charge_id: null,
    dedupe_key: a.dedupeKey,
    payload: a.payload,
    last_detected_at: lastDetectedAt,
  };
}

/**
 * Rule-driven alerts (EVAL_ALERT_TYPES) that are open/acknowledged in the DB but
 * no longer detected → their dedupe_keys, to auto-resolve. Job-emitted
 * self-alerts are excluded.
 */
export function alertsToAutoResolve(
  evaluatedKeys: Set<string>,
  existing: ExistingAlert[],
): string[] {
  return existing
    .filter(
      (e) =>
        EVAL_ALERT_TYPES.has(e.alert_type) &&
        (e.status === "open" || e.status === "acknowledged") &&
        !evaluatedKeys.has(e.dedupe_key),
    )
    .map((e) => e.dedupe_key);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// runAlertsEval
// ═══════════════════════════════════════════════════════════════════════════

export interface AlertsEvalResult {
  jobId: string | null;
  status: "success" | "error" | "skipped_locked";
  evaluated: number;
  autoResolved: number;
  sheetSyncStale: boolean;
  error?: string;
}

export interface RunAlertsEvalOptions {
  admin: ChargingClient;
  trigger: string;
  now?: Date;
}

async function fetchExistingAlerts(admin: ChargingClient): Promise<ExistingAlert[]> {
  const out: ExistingAlert[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("alerts")
      .select("dedupe_key,status,alert_type")
      .order("dedupe_key", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`alerts preflight failed: ${error.message}`);
    const rows = (data ?? []) as ExistingAlert[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** Whether the most recent successful sheet-sync finished > STALE_HOURS ago. */
async function isSheetSyncStale(
  admin: ChargingClient,
  now: Date,
): Promise<{ stale: boolean; lastSuccessAt: string | null }> {
  const { data, error } = await admin
    .from("job_runs")
    .select("finished_at,started_at")
    .eq("job_name", SHEET_SYNC_JOB_NAME)
    .eq("status", "success")
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`job_runs staleness read failed: ${error.message}`);
  const rows = (data ?? []) as { finished_at: string | null; started_at: string }[];
  const last = rows[0]?.finished_at ?? rows[0]?.started_at ?? null;
  if (last === null) return { stale: true, lastSuccessAt: null };
  const ageHours = (now.getTime() - new Date(last).getTime()) / 3_600_000;
  return { stale: ageHours > STALE_HOURS, lastSuccessAt: last };
}

/**
 * Evaluates + persists alerts over the current charging snapshot. Claims an
 * 'alerts-eval' job lease; returns skipped_locked if another run holds it.
 */
export async function runAlertsEval(
  opts: RunAlertsEvalOptions,
): Promise<AlertsEvalResult> {
  const { admin, trigger } = opts;
  const now = opts.now ?? new Date();
  const detectedAt = now.toISOString();

  const jobId = await claimJob(admin, ALERTS_EVAL_JOB_NAME);
  if (!jobId) {
    return {
      jobId: null,
      status: "skipped_locked",
      evaluated: 0,
      autoResolved: 0,
      sheetSyncStale: false,
    };
  }

  try {
    const { snapshot, accountUuidByStringId } = await loadChargingWorld(admin, now);
    const evaluated = evaluateAlerts(snapshot, now);
    const evaluatedKeys = new Set(evaluated.map((a) => a.dedupeKey));

    // upsert detected alerts (status / first_detected_at preserved on conflict)
    const rows = evaluated.map((a) => alertRow(a, accountUuidByStringId, detectedAt));
    for (const c of chunk(rows, BATCH)) {
      const { error } = await admin
        .from("alerts")
        .upsert(c, { onConflict: "dedupe_key" });
      if (error) throw new Error(`upsert charging.alerts failed: ${error.message}`);
    }

    // auto-resolve rule-driven alerts whose condition cleared
    const existing = await fetchExistingAlerts(admin);
    const toResolve = alertsToAutoResolve(evaluatedKeys, existing);
    for (const c of chunk(toResolve, BATCH)) {
      const { error } = await admin
        .from("alerts")
        .update({
          status: "resolved",
          resolved_by_email: "system:alerts-eval",
          resolved_at: detectedAt,
        })
        .in("dedupe_key", c)
        .in("status", ["open", "acknowledged"]);
      if (error) throw new Error(`auto-resolve alerts failed: ${error.message}`);
    }

    // sheet_sync_stale self-alert (H6)
    const { stale, lastSuccessAt } = await isSheetSyncStale(admin, now);
    if (stale) {
      const { error } = await admin.from("alerts").upsert(
        {
          alert_type: "sheet_sync_stale",
          severity: "critical",
          dedupe_key: SHEET_SYNC_STALE_KEY,
          payload: { lastSuccessAt, thresholdHours: STALE_HOURS },
          last_detected_at: detectedAt,
        },
        { onConflict: "dedupe_key" },
      );
      if (error) throw new Error(`sheet_sync_stale upsert failed: ${error.message}`);
    } else {
      const { error } = await admin
        .from("alerts")
        .update({
          status: "resolved",
          resolved_by_email: "system:alerts-eval",
          resolved_at: detectedAt,
        })
        .eq("dedupe_key", SHEET_SYNC_STALE_KEY)
        .in("status", ["open", "acknowledged"]);
      if (error) throw new Error(`sheet_sync_stale clear failed: ${error.message}`);
    }

    await finalizeJob(admin, jobId, {
      status: "success",
      trigger,
      stats: {
        evaluated: evaluated.length,
        autoResolved: toResolve.length,
        sheetSyncStale: stale,
      },
    });

    return {
      jobId,
      status: "success",
      evaluated: evaluated.length,
      autoResolved: toResolve.length,
      sheetSyncStale: stale,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finalizeJob(admin, jobId, {
      status: "error",
      trigger,
      error: message,
    }).catch(() => {
      /* best-effort */
    });
    throw err;
  }
}
