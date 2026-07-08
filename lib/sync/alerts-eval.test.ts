/**
 * Pure-logic tests for alerts-eval: the FK-resolving row mapper and the
 * auto-resolve selection (only rule-driven alerts that cleared; never muted
 * rows). Phase 2.5: the retired scraper_stale/sheet_sync_stale types ARE in
 * the auto-resolve set (one release) so lingering open ones self-resolve.
 */

import { describe, expect, it } from "vitest";
import type { Alert } from "@/lib/domain";
import { alertRow, alertsToAutoResolve } from "./alerts-eval";

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "overdue:enel:1:2026-07-01",
    alertType: "overdue_bill",
    severity: "critical",
    stationId: 10,
    billingAccountId: "enel:1",
    chargeId: null,
    dedupeKey: "overdue:enel:1:2026-07-01",
    payload: { dueDate: "2026-07-01" },
    status: "open",
    ...overrides,
  };
}

describe("alertRow", () => {
  const accountUuid = new Map([["enel:1", "uuid-1"]]);

  it("resolves billing_account_id string→uuid and sets last_detected_at", () => {
    const row = alertRow(alert(), accountUuid, "2026-07-08T12:00:00Z");
    expect(row.billing_account_id).toBe("uuid-1");
    expect(row.station_id).toBe(10);
    expect(row.charge_id).toBeNull();
    expect(row.last_detected_at).toBe("2026-07-08T12:00:00Z");
  });

  it("omits status/first_detected_at so upserts preserve human state", () => {
    const row = alertRow(alert(), accountUuid, "2026-07-08T12:00:00Z");
    expect("status" in row).toBe(false);
    expect("first_detected_at" in row).toBe(false);
  });

  it("null billing account → null FK (irregularity join alerts)", () => {
    const row = alertRow(
      alert({ billingAccountId: null }),
      accountUuid,
      "2026-07-08T12:00:00Z",
    );
    expect(row.billing_account_id).toBeNull();
  });
});

describe("alertsToAutoResolve", () => {
  it("resolves only cleared, open/acknowledged, rule-driven alerts", () => {
    const existing = [
      { dedupe_key: "overdue:enel:1", status: "open", alert_type: "overdue_bill" },
      { dedupe_key: "overdue:enel:2", status: "open", alert_type: "overdue_bill" },
      { dedupe_key: "no_auto_debit:enel:3", status: "muted", alert_type: "no_auto_debit" },
      { dedupe_key: "scraper_stale:enel:4", status: "acknowledged", alert_type: "scraper_stale" },
      { dedupe_key: "sheet_sync_stale:sheet-sync", status: "open", alert_type: "sheet_sync_stale" },
    ];
    // still-detected: enel:2 only
    const evaluatedKeys = new Set(["overdue:enel:2"]);
    const resolved = alertsToAutoResolve(evaluatedKeys, existing);

    // enel:1 (cleared open) + enel:4 (cleared acknowledged) + the retired
    // sheet_sync_stale (never emitted anymore) → resolve
    expect(resolved).toEqual([
      "overdue:enel:1",
      "scraper_stale:enel:4",
      "sheet_sync_stale:sheet-sync",
    ]);
    // enel:2 still detected; enel:3 muted → untouched
    expect(resolved).not.toContain("overdue:enel:2");
    expect(resolved).not.toContain("no_auto_debit:enel:3");
  });
});
