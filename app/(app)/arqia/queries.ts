import "server-only";

/**
 * ARQIA page reads (Gabriel 2026-07-22) — snapshots (gráfico), SIMs ativos,
 * compras do mês e alertas. Lê via supabaseAdmin (as tabelas arqia_* não têm
 * policy de leitura pro JWT do usuário — mesmo padrão dos deep-dives). Degrada
 * a { available:false } sem env Supabase / sem sessão.
 */

import { getSessionEmail } from "@/lib/http/guards";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { arqiaEnv } from "@/lib/arqia/client";
import { slackConfigured } from "@/lib/slack/send";

export interface ArqiaSnapshotPoint {
  snapshotOn: string;
  consumptionMb: number;
  effectiveQuotaMb: number;
  baseQuotaMb: number;
  purchasedMb: number;
  simCount: number;
  pct: number;
}
export interface ArqiaAlertRow {
  id: string;
  snapshotOn: string;
  pct: number;
  consumptionMb: number;
  effectiveQuotaMb: number;
  threshold: number;
  message: string;
  sentTo: string[];
  slackOk: boolean;
  createdAt: string;
}
export interface ArqiaPurchaseRow {
  id: string;
  mbAdded: number;
  note: string | null;
  actorEmail: string | null;
  createdAt: string;
}
export interface ArqiaData {
  available: boolean;
  configured: { arqia: boolean; slack: boolean };
  activeSimCount: number;
  latest: ArqiaSnapshotPoint | null;
  monthSeries: ArqiaSnapshotPoint[];
  purchases: ArqiaPurchaseRow[];
  purchasedThisMonthMb: number;
  alerts: ArqiaAlertRow[];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function getArqiaData(now: Date = new Date()): Promise<ArqiaData> {
  const empty: ArqiaData = {
    available: false,
    configured: { arqia: false, slack: false },
    activeSimCount: 0,
    latest: null,
    monthSeries: [],
    purchases: [],
    purchasedThisMonthMb: 0,
    alerts: [],
  };

  const email = await getSessionEmail();
  if (!email) return empty;
  let admin: ReturnType<typeof supabaseAdmin>;
  try {
    admin = supabaseAdmin();
  } catch {
    return empty;
  }

  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  try {
    const [{ count }, snaps, purch, alerts] = await Promise.all([
      admin.from("arqia_sims").select("*", { count: "exact", head: true }).eq("status", "active"),
      admin
        .from("arqia_snapshots")
        .select("*")
        .gte("snapshot_on", monthStart)
        .order("snapshot_on", { ascending: true }),
      admin
        .from("arqia_data_purchases")
        .select("*")
        .eq("competencia", monthStart)
        .order("created_at", { ascending: false }),
      admin.from("arqia_alerts").select("*").order("created_at", { ascending: false }).limit(20),
    ]);

    const monthSeries: ArqiaSnapshotPoint[] = (
      (snaps.data ?? []) as Record<string, unknown>[]
    ).map((s) => ({
      snapshotOn: String(s.snapshot_on),
      consumptionMb: num(s.consumption_mb),
      effectiveQuotaMb: num(s.effective_quota_mb),
      baseQuotaMb: num(s.base_quota_mb),
      purchasedMb: num(s.purchased_mb),
      simCount: num(s.sim_count),
      pct: num(s.pct),
    }));

    const purchases: ArqiaPurchaseRow[] = (
      (purch.data ?? []) as Record<string, unknown>[]
    ).map((p) => ({
      id: String(p.id),
      mbAdded: num(p.mb_added),
      note: (p.note as string | null) ?? null,
      actorEmail: (p.actor_email as string | null) ?? null,
      createdAt: String(p.created_at),
    }));

    return {
      available: true,
      configured: { arqia: arqiaEnv() !== null, slack: slackConfigured() },
      activeSimCount: count ?? 0,
      latest: monthSeries.length > 0 ? monthSeries[monthSeries.length - 1] : null,
      monthSeries,
      purchases,
      purchasedThisMonthMb: purchases.reduce((s, p) => s + p.mbAdded, 0),
      alerts: ((alerts.data ?? []) as Record<string, unknown>[]).map((a) => ({
        id: String(a.id),
        snapshotOn: String(a.snapshot_on),
        pct: num(a.pct),
        consumptionMb: num(a.consumption_mb),
        effectiveQuotaMb: num(a.effective_quota_mb),
        threshold: num(a.threshold),
        message: String(a.message),
        sentTo: Array.isArray(a.sent_to) ? (a.sent_to as string[]) : [],
        slackOk: a.slack_ok === true,
        createdAt: String(a.created_at),
      })),
    };
  } catch {
    return empty;
  }
}
