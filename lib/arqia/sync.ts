import "server-only";

/**
 * runArqiaSync — the app-side replacement for the n8n `Alerta - SIM_Data_Arqia`
 * (Gabriel 2026-07-22). Fetches the fleet + consumption from the Arqia API,
 * reconciles charging.arqia_sims (new→active, sumido→inactive), computes the
 * pró-rata quota (a quota de CADA chip, vinda da API) + Σ compras do mês, writes
 * the daily snapshot, and —
 * if usage > threshold — records an alert and pushes it to Slack.
 *
 * First-ever run (empty table): new SIMs get first_seen_on = 1º do mês (frota
 * estabelecida = quota cheia, sem pró-rata). Depois disso, SIM novo = hoje
 * (pró-rateado). Degrada a {status:'unconfigured'} sem as envs Arqia.
 */

import type { ChargingClient } from "@/lib/data/supabase-repository";
import { fetchArqiaSnapshot } from "./client";
import {
  monthElapsedPct,
  proRataQuotaMb,
  round2,
  usagePct,
  type QuotaSim,
} from "./quota";
import { sendArqiaAlert } from "@/lib/slack/send";

export type ArqiaSyncResult =
  | { status: "unconfigured" }
  | {
      status: "success";
      simCount: number;
      baseQuotaMb: number;
      purchasedMb: number;
      effectiveQuotaMb: number;
      consumptionMb: number;
      pct: number;
      alerted: boolean;
    };

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function monthStartISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

interface SimRow {
  iccid: string;
  first_seen_on: string;
  status: string;
}

async function readAllSims(admin: ChargingClient): Promise<SimRow[]> {
  const out: SimRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("arqia_sims")
      .select("iccid, first_seen_on, status")
      .order("iccid", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`arqia_sims read: ${error.message}`);
    const rows = (data ?? []) as unknown as SimRow[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function runArqiaSync(
  admin: ChargingClient,
  now: Date,
  opts: { sendAlerts: boolean },
): Promise<ArqiaSyncResult> {
  const snap = await fetchArqiaSnapshot();
  if (!snap) return { status: "unconfigured" };

  const fetched = new Set(snap.iccids);
  const existing = await readAllSims(admin);
  const existingById = new Map(existing.map((s) => [s.iccid, s]));
  const firstRun = existing.length === 0;
  const baseline = firstRun ? monthStartISO(now) : isoDate(now);

  // Insert genuinely-new SIMs.
  const newIccids = snap.iccids.filter((i) => !existingById.has(i));
  for (const c of chunk(newIccids, 500)) {
    const rows = c.map((iccid) => ({
      iccid,
      first_seen_on: baseline,
      status: "active",
      account_name: snap.accountName,
    }));
    const { error } = await admin.from("arqia_sims").insert(rows);
    if (error) throw new Error(`arqia_sims insert: ${error.message}`);
  }

  // Reactivate any returning SIM that was inactive.
  const toActivate = snap.iccids.filter(
    (i) => existingById.get(i)?.status === "inactive",
  );
  for (const c of chunk(toActivate, 500)) {
    await admin
      .from("arqia_sims")
      .update({ status: "active", updated_at: now.toISOString() })
      .in("iccid", c);
  }

  // Deactivate SIMs that dropped out of the fleet.
  const toDeactivate = existing
    .filter((s) => s.status === "active" && !fetched.has(s.iccid))
    .map((s) => s.iccid);
  for (const c of chunk(toDeactivate, 500)) {
    await admin
      .from("arqia_sims")
      .update({ status: "inactive", updated_at: now.toISOString() })
      .in("iccid", c);
  }

  // Pró-rata quota over the ACTIVE fleet (fetched), preserving first_seen_on.
  // A quota de cada chip vem da API (snap.quotaByIccid); só a rampa temporal de
  // um chip visto pela 1ª vez no mês reduz a fração — não há mais valor fixo.
  const activeSims: QuotaSim[] = snap.iccids.map((iccid) => ({
    firstSeenOn: existingById.get(iccid)?.first_seen_on ?? baseline,
    quotaMb: snap.quotaByIccid[iccid] ?? 0,
  }));
  const baseQuotaMb = proRataQuotaMb(activeSims, now);

  // Σ compras do mês.
  const comp = monthStartISO(now);
  const { data: purchaseData } = await admin
    .from("arqia_data_purchases")
    .select("mb_added")
    .eq("competencia", comp);
  const purchasedMb = round2(
    ((purchaseData ?? []) as { mb_added: number | string }[]).reduce(
      (s, p) => s + Number(p.mb_added ?? 0),
      0,
    ),
  );

  const effectiveQuotaMb = round2(baseQuotaMb + purchasedMb);
  const consumptionMb = snap.consumptionMb;
  const pct = usagePct(consumptionMb, effectiveQuotaMb);
  const snapshotOn = isoDate(now);

  await admin.from("arqia_snapshots").upsert(
    {
      snapshot_on: snapshotOn,
      sim_count: snap.iccids.length,
      base_quota_mb: baseQuotaMb,
      purchased_mb: purchasedMb,
      effective_quota_mb: effectiveQuotaMb,
      consumption_mb: consumptionMb,
      pct,
    },
    { onConflict: "snapshot_on" },
  );

  // Alert over threshold (default 80%, Gabriel 2026-07-23) — SÓ quando
  // sendAlerts (o cron diário). O botão "Atualizar" passa sendAlerts=false:
  // atualiza os dados/snapshot e NUNCA manda Slack nem grava alerta.
  const threshold = Number(process.env.ARQIA_ALERT_THRESHOLD ?? 80);
  let alerted = false;
  if (opts.sendAlerts && pct > threshold) {
    const gb = (mb: number) => (mb / 1024).toFixed(2);
    const message =
      `⚠️ Alerta de uso de dados (Arqia):\n` +
      `📊 Limite do mês: ${gb(effectiveQuotaMb)} GB\n` +
      `📈 Consumo: ${gb(consumptionMb)} GB\n` +
      `📉 Uso: ${pct.toFixed(2)}%\n` +
      `📅 Mês decorrido: ${monthElapsedPct(now).toFixed(2)}%\n` +
      `💾 Restante: ${gb(Math.max(0, effectiveQuotaMb - consumptionMb))} GB\n` +
      `📶 SIMs ativos: ${snap.iccids.length}`;
    const slack = await sendArqiaAlert(message);
    await admin.from("arqia_alerts").insert({
      snapshot_on: snapshotOn,
      pct,
      effective_quota_mb: effectiveQuotaMb,
      consumption_mb: consumptionMb,
      threshold,
      message,
      sent_to: slack.sentTo,
      slack_ok: slack.ok,
    });
    alerted = true;
  }

  return {
    status: "success",
    simCount: snap.iccids.length,
    baseQuotaMb,
    purchasedMb,
    effectiveQuotaMb,
    consumptionMb,
    pct,
    alerted,
  };
}
