import "server-only";

/**
 * Direct read of the persisted charging.alerts (Phase 2) with lifecycle fields,
 * resolved station names, and the latest audit note per alert. Outside the
 * Repository interface (H3) — the Repository.getAlerts() recomputes alerts from
 * the snapshot and has no lifecycle. Uses the service-role client behind the
 * auth gate (repository.server.ts rationale).
 *
 * Degrades to `configured: false` when Supabase env is absent / the read fails,
 * so the page falls back to the Phase-1 computed view. Never crashes.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AlertSeverity, AlertStatus } from "@/lib/domain";
import type { LifecycleAlertRow } from "@/components/alertas/alert-lifecycle-ui";

export interface PersistedAlertsResult {
  /** Supabase reachable (env present + read succeeded). */
  configured: boolean;
  rows: LifecycleAlertRow[];
  lastScrapedAt: string | null;
}

const PAGE = 1000;
const AUDIT_SCAN_LIMIT = 3000;

interface Pageable {
  range(
    from: number,
    to: number,
  ): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
}

async function readAll<T>(build: () => unknown): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await (build() as Pageable).range(
      from,
      from + PAGE - 1,
    );
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

interface AlertDbRow {
  id: string;
  alert_type: string;
  severity: AlertSeverity;
  station_id: number | null;
  billing_account_id: string | null;
  payload: Record<string, unknown> | null;
  status: AlertStatus;
  acknowledged_by_email: string | null;
  acknowledged_at: string | null;
  muted_by_email: string | null;
  muted_at: string | null;
  resolved_by_email: string | null;
  resolved_at: string | null;
  first_detected_at: string | null;
}
interface AuditRow {
  entity_id: string;
  detail: { note?: string | null } | null;
  created_at: string;
}

function transition(row: AlertDbRow): { actorEmail: string | null; actorAt: string | null } {
  switch (row.status) {
    case "acknowledged":
      return { actorEmail: row.acknowledged_by_email, actorAt: row.acknowledged_at };
    case "muted":
      return { actorEmail: row.muted_by_email, actorAt: row.muted_at };
    case "resolved":
      return { actorEmail: row.resolved_by_email, actorAt: row.resolved_at };
    default:
      return { actorEmail: null, actorAt: null };
  }
}

export async function readPersistedAlerts(): Promise<PersistedAlertsResult> {
  try {
    const admin = supabaseAdmin();

    const [alerts, stations] = await Promise.all([
      readAll<AlertDbRow>(() =>
        admin
          .from("alerts")
          .select(
            "id, alert_type, severity, station_id, billing_account_id, payload, status, acknowledged_by_email, acknowledged_at, muted_by_email, muted_at, resolved_by_email, resolved_at, first_detected_at",
          )
          .order("id", { ascending: true }),
      ),
      readAll<{ id: number; name: string | null }>(() =>
        admin.from("stations").select("id, name").order("id", { ascending: true }),
      ),
    ]);

    const stationName = new Map(stations.map((s) => [s.id, s.name]));

    // Latest audit note per alert (mute duration+reason, ack/resolve note).
    const { data: auditData, error: auditErr } = await admin
      .from("audit_events")
      .select("entity_id, detail, created_at")
      .eq("entity_table", "alerts")
      .order("created_at", { ascending: false })
      .limit(AUDIT_SCAN_LIMIT);
    if (auditErr) throw new Error(auditErr.message);
    const noteByAlert = new Map<string, string>();
    for (const a of (auditData ?? []) as AuditRow[]) {
      const note = a.detail?.note;
      if (note && !noteByAlert.has(a.entity_id)) noteByAlert.set(a.entity_id, note);
    }

    // Freshness signal for the header (latest scraper timestamp).
    const { data: freshData } = await admin
      .from("utility_account_state")
      .select("scraped_at")
      .order("scraped_at", { ascending: false, nullsFirst: false })
      .limit(1);
    const lastScrapedAt =
      ((freshData ?? [])[0] as { scraped_at?: string } | undefined)?.scraped_at ??
      null;

    const rows: LifecycleAlertRow[] = alerts.map((a) => {
      const t = transition(a);
      return {
        id: a.id,
        alertType: a.alert_type,
        severity: a.severity,
        stationId: a.station_id,
        stationName: a.station_id !== null ? (stationName.get(a.station_id) ?? null) : null,
        billingAccountId: a.billing_account_id,
        payload: a.payload ?? {},
        status: a.status,
        actorEmail: t.actorEmail,
        actorAt: t.actorAt,
        note: noteByAlert.get(a.id) ?? null,
        firstDetectedAt: a.first_detected_at,
      };
    });

    return { configured: true, rows, lastScrapedAt };
  } catch {
    return { configured: false, rows: [], lastScrapedAt: null };
  }
}
