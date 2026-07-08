import "server-only";

/**
 * Direct reads for the /admin Phase 2 cards — user_roles and job_runs — outside
 * the Repository interface (H3), via the service-role client behind the auth
 * gate. Both degrade to `configured: false` when Supabase env is absent so the
 * cards render a notice instead of crashing. Colocated under components/admin
 * so the page + the polling action import them without route-group parens.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { num } from "@/lib/data/supabase-repository";

export interface UserRoleRow {
  email: string;
  role: "admin" | "operator";
  /** Who last set/changed the role (audit actor, or original creator). */
  actorEmail: string | null;
  at: string | null;
}

export interface JobRunRow {
  id: string;
  jobName: string;
  /** 'cron' | 'manual:{email}'. */
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  rowsRead: number | null;
  rowsUpserted: number | null;
  rowsSkipped: number | null;
  stats: Record<string, unknown> | null;
  error: string | null;
}

export interface AdminTableResult<T> {
  configured: boolean;
  rows: T[];
}

interface AuditRow {
  entity_id: string;
  actor_email: string;
  created_at: string;
}

export async function readUserRoles(): Promise<AdminTableResult<UserRoleRow>> {
  try {
    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("user_roles")
      .select("email, role, created_by_email, created_at")
      .order("email", { ascending: true })
      .limit(1000);
    if (error) throw new Error(error.message);

    const { data: auditData } = await admin
      .from("audit_events")
      .select("entity_id, actor_email, created_at")
      .eq("entity_table", "user_roles")
      .order("created_at", { ascending: false })
      .limit(2000);
    const latest = new Map<string, { actor: string; at: string }>();
    for (const a of (auditData ?? []) as AuditRow[]) {
      if (!latest.has(a.entity_id)) {
        latest.set(a.entity_id, { actor: a.actor_email, at: a.created_at });
      }
    }

    const rows = ((data ?? []) as {
      email: string;
      role: "admin" | "operator";
      created_by_email: string | null;
      created_at: string;
    }[]).map((r) => {
      const l = latest.get(r.email);
      return {
        email: r.email,
        role: r.role,
        actorEmail: l?.actor ?? r.created_by_email,
        at: l?.at ?? r.created_at,
      };
    });
    return { configured: true, rows };
  } catch {
    return { configured: false, rows: [] };
  }
}

export async function readJobRuns(
  limit = 50,
): Promise<AdminTableResult<JobRunRow>> {
  try {
    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("job_runs")
      .select(
        "id, job_name, trigger, started_at, finished_at, status, rows_read, rows_upserted, rows_skipped, stats, error",
      )
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as {
      id: string;
      job_name: string;
      trigger: string;
      started_at: string;
      finished_at: string | null;
      status: string;
      rows_read: number | null;
      rows_upserted: number | null;
      rows_skipped: number | null;
      stats: Record<string, unknown> | null;
      error: string | null;
    }[]).map((r) => ({
      id: r.id,
      jobName: r.job_name,
      trigger: r.trigger,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      status: r.status,
      rowsRead: num(r.rows_read),
      rowsUpserted: num(r.rows_upserted),
      rowsSkipped: num(r.rows_skipped),
      stats: r.stats,
      error: r.error,
    }));
    return { configured: true, rows };
  } catch {
    return { configured: false, rows: [] };
  }
}
