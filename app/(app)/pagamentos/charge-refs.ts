import "server-only";

/**
 * Resolves each ledger charge's `dedupe_key` (the Phase-1 domain id) → its
 * Postgres uuid, so the row lifecycle actions can call the RPCs (which take the
 * uuid — charges.ts H3). Also attaches the last audit actor/timestamp for the
 * AuditByline on human-touched (`status_source='rpc'`) charges.
 *
 * Degrades to an empty map when Supabase env is absent (sheets/dev backend):
 * every row then renders its actions disabled. Never crashes the page.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export interface ChargeRef {
  uuid: string;
  lastActorEmail: string | null;
  lastActorAt: string | null;
}

const PAGE = 1000;
/** Recent charge audit events scanned for bylines (bounded single read). */
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

interface ChargeRow {
  id: string;
  dedupe_key: string;
  status_source: "sync" | "rpc";
}
interface AuditRow {
  entity_id: string;
  actor_email: string;
  created_at: string;
}

export async function readChargeRefs(): Promise<Map<string, ChargeRef>> {
  const map = new Map<string, ChargeRef>();
  try {
    const admin = supabaseAdmin();

    const charges = await readAll<ChargeRow>(() =>
      admin
        .from("charges")
        .select("id, dedupe_key, status_source")
        .order("id", { ascending: true }),
    );

    // Latest audit event per charge (bylines only matter for rpc-touched rows).
    const { data: auditData, error } = await admin
      .from("audit_events")
      .select("entity_id, actor_email, created_at")
      .eq("entity_table", "charges")
      .order("created_at", { ascending: false })
      .limit(AUDIT_SCAN_LIMIT);
    if (error) throw new Error(error.message);
    const latestByUuid = new Map<string, { actor: string; at: string }>();
    for (const a of (auditData ?? []) as AuditRow[]) {
      if (!latestByUuid.has(a.entity_id)) {
        latestByUuid.set(a.entity_id, { actor: a.actor_email, at: a.created_at });
      }
    }

    for (const c of charges) {
      const last = c.status_source === "rpc" ? latestByUuid.get(c.id) : undefined;
      map.set(c.dedupe_key, {
        uuid: c.id,
        lastActorEmail: last?.actor ?? null,
        lastActorAt: last?.at ?? null,
      });
    }
  } catch {
    return new Map();
  }
  return map;
}
