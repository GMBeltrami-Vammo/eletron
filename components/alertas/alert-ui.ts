/**
 * Presentation helpers for /alertas: the plain-JSON row shape passed from the
 * server page into the client panel, severity labels (screen-local — not in
 * lib/labels.ts), and the payload → detail-line builder for each rule
 * evaluated by lib/ingest/derive.ts.
 */

import type { BadgeColor } from "@/components/vammo/status-badge";
import type { AlertSeverity } from "@/lib/domain";
import { formatBRL, formatCompetencia, formatDate } from "@/lib/format";

/** Plain-serializable alert row (Alert + resolved station name). */
export interface AlertRow {
  id: string;
  alertType: string;
  severity: AlertSeverity;
  stationId: number | null;
  stationName: string | null;
  billingAccountId: string | null;
  payload: Record<string, unknown>;
}

/** The 7 rule categories always shown as cards, even at zero. */
export const CORE_ALERT_TYPES = [
  "overdue_bill",
  "due_soon_no_auto_debit",
  "no_auto_debit",
  "scraper_stale",
  "new_installation",
  "negotiated_invoice",
  "scheduled_shutdown",
] as const;

export const ALERT_SEVERITY_UI: Record<
  AlertSeverity,
  { label: string; color: BadgeColor }
> = {
  critical: { label: "Crítico", color: "red" },
  warning: { label: "Atenção", color: "orange" },
  info: { label: "Info", color: "blue" },
};

/** Worst-first, for chips and server-side pre-sorting. */
export const SEVERITY_ORDER: AlertSeverity[] = ["critical", "warning", "info"];

export const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 'enel:7005...' → 'Enel 7005...' — deterministic domain ids, not raw text. */
export function installationLabel(
  billingAccountId: string | null,
): string | null {
  if (!billingAccountId) return null;
  const separator = billingAccountId.indexOf(":");
  if (separator === -1) return billingAccountId;
  const prefix = billingAccountId.slice(0, separator);
  const key = billingAccountId.slice(separator + 1);
  switch (prefix) {
    case "enel":
      return `Enel ${key}`;
    case "edp":
      return `EDP ${key}`;
    case "rent":
      return `Cadastro ${key}`;
    case "3p":
      return `Terceiro ${key}`;
    default:
      return billingAccountId;
  }
}

/** Human detail line from the typed payload each derive.ts rule emits. */
export function alertDetail(row: AlertRow): string {
  const p = row.payload;
  switch (row.alertType) {
    case "overdue_bill": {
      const parts: string[] = [];
      const due = str(p.dueDate);
      if (due) parts.push(`Vencimento ${formatDate(due)}`);
      const value = num(p.lastBilling);
      if (value !== null) parts.push(formatBRL(value));
      if (p.fromHistory === true) parts.push("consta no histórico de faturas");
      return parts.length > 0 ? parts.join(" · ") : "Fatura vencida";
    }
    case "due_soon_no_auto_debit": {
      const parts: string[] = [];
      const days = num(p.daysUntilDue);
      if (days !== null) {
        parts.push(
          days === 0
            ? "Vence hoje"
            : `Vence em ${days} ${days === 1 ? "dia" : "dias"}`,
        );
      }
      const due = str(p.dueDate);
      if (due) parts.push(formatDate(due));
      const value = num(p.lastBilling);
      if (value !== null) parts.push(formatBRL(value));
      return parts.length > 0
        ? parts.join(" · ")
        : "Vencimento próximo sem débito automático";
    }
    case "no_auto_debit": {
      const scraped = str(p.scrapedAt);
      return scraped
        ? `Sem débito automático · coleta de ${formatDate(scraped)}`
        : "Sem débito automático cadastrado";
    }
    case "scraper_stale": {
      const parts: string[] = [];
      const age = num(p.ageDays);
      if (age !== null) parts.push(`Sem coleta há ${age} dias`);
      const scraped = str(p.scrapedAt);
      if (scraped) parts.push(`última em ${formatDate(scraped)}`);
      return parts.length > 0 ? parts.join(" · ") : "Coleta parada";
    }
    case "new_installation": {
      const first = str(p.firstSeenAt);
      return first
        ? `Primeira coleta em ${formatDate(first)}`
        : "Instalação nova no portal";
    }
    case "negotiated_invoice": {
      const competencia = str(p.competencia);
      return competencia
        ? `Competência ${formatCompetencia(competencia)} negociada — pagamento manual`
        : "Fatura negociada — pagamento manual";
    }
    case "scheduled_shutdown": {
      const date = str(p.shutdownDate);
      const start = str(p.shutdownStart);
      const end = str(p.shutdownEnd);
      const window = start && end ? `, das ${start} às ${end}` : "";
      return date
        ? `Desligamento em ${formatDate(date)}${window}`
        : "Desligamento programado";
    }
    case "station_without_contract":
      return "Estação ativa sem cadastro de locação";
    case "contract_without_station": {
      const parts: string[] = [];
      const cadastro = num(p.cadastroId);
      if (cadastro !== null) parts.push(`Cadastro ${cadastro}`);
      const address = str(p.address);
      if (address) parts.push(address);
      return parts.length > 0
        ? parts.join(" · ")
        : "Contrato sem estação correspondente";
    }
    default:
      return "";
  }
}
