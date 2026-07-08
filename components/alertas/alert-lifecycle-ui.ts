/**
 * Lifecycle-panel helpers for /alertas (Phase 2, persisted charging.alerts).
 * The plain row shape + the acknowledge/resolve/mute state → badge mapping.
 * Reuses ALERT_SEVERITY_UI / alertDetail / installationLabel from ./alert-ui.
 */

import type { BadgeColor } from "@/components/vammo/status-badge";
import type { AlertSeverity, AlertStatus } from "@/lib/domain";
import { ALERT_SEVERITY_UI } from "./alert-ui";

/** A persisted alert + resolved station name + last-transition metadata. */
export interface LifecycleAlertRow {
  /** charging.alerts uuid (the RPCs take this). */
  id: string;
  alertType: string;
  severity: AlertSeverity;
  stationId: number | null;
  stationName: string | null;
  billingAccountId: string | null;
  payload: Record<string, unknown>;
  status: AlertStatus;
  /** Actor + timestamp of the last lifecycle transition (null while open). */
  actorEmail: string | null;
  actorAt: string | null;
  /** Latest audit note (mute duration+reason, resolve/ack note). */
  note: string | null;
  firstDetectedAt: string | null;
}

export const ALERT_LIFECYCLE_LABEL: Record<AlertStatus, string> = {
  open: "Ativo",
  acknowledged: "Reconhecido",
  resolved: "Resolvido",
  muted: "Silenciado",
};

/** Ativo takes the severity color (red/orange/blue); the rest are fixed. */
export function lifecycleColor(
  status: AlertStatus,
  severity: AlertSeverity,
): BadgeColor {
  switch (status) {
    case "open":
      return ALERT_SEVERITY_UI[severity].color;
    case "acknowledged":
      return "blue";
    case "resolved":
      return "dark-green";
    case "muted":
      return "grey";
  }
}

export type AlertActionKind = "acknowledge" | "resolve" | "mute";

export const ALERT_ACTION_LABEL: Record<AlertActionKind, string> = {
  acknowledge: "Reconhecer",
  resolve: "Resolver",
  mute: "Silenciar",
};

/** Which transitions the state machine (migration 3) allows from a status. */
export function allowedActions(status: AlertStatus): AlertActionKind[] {
  switch (status) {
    case "open":
      return ["acknowledge", "resolve", "mute"];
    case "acknowledged":
      return ["resolve", "mute"];
    default:
      return [];
  }
}

export const LIFECYCLE_FILTERS: { value: AlertStatus | "all"; label: string }[] =
  [
    { value: "open", label: "Ativos" },
    { value: "acknowledged", label: "Reconhecidos" },
    { value: "muted", label: "Silenciados" },
    { value: "resolved", label: "Resolvidos" },
    { value: "all", label: "Todos" },
  ];
