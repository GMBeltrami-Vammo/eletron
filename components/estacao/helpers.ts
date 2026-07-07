/**
 * Station 360° screen helpers — pure functions over already-normalized domain
 * values (no raw sheet parsing here; that is lib/ingest/normalize.ts's job).
 *
 * Lives in components/estacao/ (not lib/) per the parallel-agent file
 * ownership rule; candidates for promotion to lib/ later.
 */

import type {
  AccountType,
  AdjustmentIndex,
  AdjustmentStatus,
  Alert,
  Charge,
  ChargeLineKind,
} from "@/lib/domain";
import type { AccountWithState } from "@/lib/data/repository";
import { formatBRL, formatCompetencia, formatDate } from "@/lib/format";

/** Staleness caveat for carried-forward 'Sem contas' statuses (spec §3). */
export const CARRIED_FORWARD_NOTE =
  "Status pode estar defasado — carregado da última coleta";

/** pt-BR labels missing from lib/labels.ts (label-only, no color semantics). */
export const CHARGE_LINE_KIND_LABEL: Record<ChargeLineKind, string> = {
  aluguel: "Aluguel",
  energia: "Energia",
  desconto: "Desconto",
  multa_juros: "Multa/juros",
  outro: "Outro",
};

export const ADJUSTMENT_INDEX_LABEL: Record<AdjustmentIndex, string> = {
  igpm: "IGPM",
  ipca: "IPCA",
  inpc: "INPC",
  outro: "Outro",
};

export const ADJUSTMENT_STATUS_LABEL: Record<AdjustmentStatus, string> = {
  pendente: "Pendente",
  negociando: "Negociando",
  aplicado: "Aplicado",
  recusado: "Recusado",
};

export function isEnergyAccount(type: AccountType): boolean {
  return type === "energy_enel" || type === "energy_edp";
}

/** External key shown next to an account (enel_id, UC, cadastro, CNPJ…). */
export function accountKeyLabel(entry: AccountWithState): string {
  const { account, counterparty, contract } = entry;
  if (account.enelId) return account.enelId;
  if (account.edpUc) return `UC ${account.edpUc}`;
  if (account.accountType === "rent" && contract?.cadastroId != null) {
    return `Cadastro ${contract.cadastroId}`;
  }
  if (counterparty) return counterparty.name;
  return account.externalRef ?? account.id;
}

/** Great-circle distance in meters (station pin vs utility pin). */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Display mask for normalized CNPJ (14) / CPF (11) digit strings. */
export function formatCnpjCpf(digits: string | null | undefined): string {
  if (!digits) return "—";
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  return digits;
}

/** ISO date/competência → 'YYYY-MM' bucket key (null-safe). */
export function monthKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const key = iso.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(key) ? key : null;
}

/** The `count` month keys ending at `now`'s month, ascending. */
export function lastMonthKeys(now: Date, count: number): string[] {
  const keys: string[] = [];
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - i, 1),
    );
    keys.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }
  return keys;
}

/** Whole days from `now` until an ISO date (negative = past). */
export function daysUntil(iso: string, now: Date): number {
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return Number.NaN;
  return Math.floor((target.getTime() - now.getTime()) / 86_400_000);
}

/** Whole months from `now` until an ISO date (negative = past). */
export function monthsUntil(iso: string, now: Date): number {
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return Number.NaN;
  return (
    (target.getUTCFullYear() - now.getUTCFullYear()) * 12 +
    (target.getUTCMonth() - now.getUTCMonth())
  );
}

/** Most recent charge by due date (falls back to competência). */
export function latestCharge(charges: Charge[]): Charge | null {
  let best: Charge | null = null;
  let bestKey = "";
  for (const charge of charges) {
    const key = charge.dueDate ?? charge.competencia ?? "";
    if (best === null || key > bestKey) {
      best = charge;
      bestKey = key;
    }
  }
  return best;
}

/** Best-effort event date for an alert, from its typed payload fields. */
export function alertDate(alert: Alert): string | null {
  const p = alert.payload;
  for (const key of [
    "dueDate",
    "shutdownDate",
    "firstSeenAt",
    "scrapedAt",
  ] as const) {
    const value = p[key];
    if (typeof value === "string" && value.length >= 10) return value;
  }
  const competencia = p["competencia"];
  if (typeof competencia === "string" && competencia.length >= 7) {
    return `${competencia.slice(0, 7)}-01`;
  }
  return null;
}

/** Human pt-BR detail line rendered from an alert's payload. */
export function alertDetail(alert: Alert): string {
  const p = alert.payload;
  const parts: string[] = [];
  if (typeof p.dueDate === "string") {
    parts.push(`vencimento ${formatDate(p.dueDate)}`);
  }
  if (typeof p.lastBilling === "number") parts.push(formatBRL(p.lastBilling));
  if (typeof p.daysUntilDue === "number") {
    parts.push(`em ${p.daysUntilDue} dias`);
  }
  if (typeof p.ageDays === "number") {
    parts.push(`há ${p.ageDays} dias sem coleta`);
  }
  if (typeof p.competencia === "string") {
    parts.push(`competência ${formatCompetencia(`${p.competencia}-01`)}`);
  }
  if (typeof p.shutdownDate === "string") {
    let window = formatDate(p.shutdownDate);
    if (
      typeof p.shutdownStart === "string" &&
      typeof p.shutdownEnd === "string"
    ) {
      window += ` (${p.shutdownStart}–${p.shutdownEnd})`;
    }
    parts.push(`desligamento em ${window}`);
  }
  if (typeof p.firstSeenAt === "string") {
    parts.push(`vista em ${formatDate(p.firstSeenAt)}`);
  }
  if (typeof p.address === "string" && p.address) parts.push(p.address);
  return parts.join(" · ");
}
