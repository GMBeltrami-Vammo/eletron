/**
 * Pure-logic tests for the sheet-sync core: hashing, the H2 status partition,
 * and the snapshot→DB-row mappers (NOT NULL coalescing, sticky-match
 * preservation, phantom-station nulling, H2 status omission).
 */

import { describe, expect, it } from "vitest";
import type {
  BillingAccount,
  Charge,
  Contract,
  Station,
} from "@/lib/domain";
import {
  deterministicUuid,
  partitionChargesByStatusSource,
  rowHash,
  toBillingAccountRow,
  toChargeRow,
  toContractRow,
  toStationRow,
} from "./sheet-sync";

const anyStation = (id: number | null): number | null => id; // treats every id as valid
const noStation = (): number | null => null; // treats every id as phantom

function charge(overrides: Partial<Charge> = {}): Charge {
  return {
    id: "enel:1:2026-07-01",
    billingAccountId: "enel:1",
    stationId: 10,
    kind: "energia",
    competencia: "2026-07-01",
    competenciaSource: "inferred_due_date",
    amount: 100,
    expectedAmount: null,
    dueDate: "2026-07-01",
    status: "pendente",
    matchStatus: "auto_matched",
    paymentMethod: null,
    banco: null,
    agencia: null,
    conta: null,
    chavePix: null,
    linhaDigitavel: null,
    notaFiscal: null,
    documentoNumero: null,
    issuerCnpj: null,
    source: "scraper_enel",
    dedupeKey: "enel:1:2026-07-01",
    legacyRef: null,
    notes: null,
    raw: {},
    ...overrides,
  };
}

describe("deterministicUuid / rowHash", () => {
  it("deterministicUuid is stable, valid, collision-free for distinct input", () => {
    expect(deterministicUuid("x")).toBe(deterministicUuid("x"));
    expect(deterministicUuid("x")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(deterministicUuid("a")).not.toBe(deterministicUuid("b"));
  });

  it("rowHash is order-independent and content-sensitive", () => {
    expect(rowHash({ a: "1", b: "2" })).toBe(rowHash({ b: "2", a: "1" }));
    expect(rowHash({ a: "1" })).not.toBe(rowHash({ a: "2" }));
  });
});

describe("partitionChargesByStatusSource (H2)", () => {
  it("routes only existing rpc rows to the status-preserving batch", () => {
    const charges = [
      charge({ dedupeKey: "k1" }),
      charge({ dedupeKey: "k2" }),
      charge({ dedupeKey: "k3" }),
    ];
    const existing = new Map<string, "sync" | "rpc">([
      ["k2", "rpc"],
      ["k3", "sync"],
    ]);
    const { syncCharges, rpcCharges } = partitionChargesByStatusSource(
      charges,
      existing,
    );
    expect(syncCharges.map((c) => c.dedupeKey)).toEqual(["k1", "k3"]);
    expect(rpcCharges.map((c) => c.dedupeKey)).toEqual(["k2"]);
  });
});

describe("toChargeRow", () => {
  it("includeStatus=true writes status + status_source='sync'", () => {
    const row = toChargeRow(charge(), anyStation, { includeStatus: true });
    expect(row.status).toBe("pendente");
    expect(row.status_source).toBe("sync");
    expect(row.fiscal_exported).toBe(false); // default when unset
    expect(
      toChargeRow(charge({ fiscalExported: true }), anyStation, {
        includeStatus: true,
      }).fiscal_exported,
    ).toBe(true);
  });

  it("includeStatus=false omits status + all human-owned columns (stickiness)", () => {
    const row = toChargeRow(charge(), anyStation, { includeStatus: false });
    // a re-sync of an rpc-owned row must not clobber human attribution/flags/status
    for (const col of [
      "status",
      "status_source",
      "billing_account_id",
      "station_id",
      "match_status",
      "flags",
      "fiscal_exported",
    ]) {
      expect(col in row, `rpc row must omit ${col}`).toBe(false);
    }
    // ...but still refreshes objective sheet-derived data
    expect(row.amount).toBe(charge().amount ?? 0);
    expect(row.dedupe_key).toBe(charge().dedupeKey);
  });

  it("coalesces a null amount to 0 (charges.amount is NOT NULL)", () => {
    const row = toChargeRow(charge({ amount: null }), anyStation, {
      includeStatus: true,
    });
    expect(row.amount).toBe(0);
  });

  it("nulls a station_id not present in Vammo_data", () => {
    const row = toChargeRow(charge({ stationId: 700 }), noStation, {
      includeStatus: true,
    });
    expect(row.station_id).toBeNull();
  });

  it("defaults flags to []", () => {
    expect(toChargeRow(charge(), anyStation, { includeStatus: true }).flags).toEqual(
      [],
    );
  });
});

describe("toStationRow", () => {
  const station = (status: Station["status"]): Station => ({
    id: 1,
    name: "S",
    address: null,
    latitude: null,
    longitude: null,
    status,
    sourceCreatedAt: null,
    hidden: false,
    raw: {},
  });

  it("coalesces a null status to INACTIVE (NOT NULL column)", () => {
    expect(toStationRow(station(null), "2026-07-08T00:00:00Z").status).toBe(
      "INACTIVE",
    );
    expect(toStationRow(station("ACTIVE"), "2026-07-08T00:00:00Z").status).toBe(
      "ACTIVE",
    );
  });

  it("omits active_boxes so an upsert preserves the 4_Metabase_Boxes value", () => {
    const row = toStationRow(station("ACTIVE"), "2026-07-08T00:00:00Z");
    expect("active_boxes" in row).toBe(false);
    expect("boxes_synced_at" in row).toBe(false);
  });
});

describe("toContractRow", () => {
  const contract = (overrides: Partial<Contract> = {}): Contract => ({
    id: "contract:5",
    cadastroId: 5,
    stationId: 10,
    counterpartyId: "cp:12345678000199",
    status: "ACTIVE",
    address: null,
    contactName: null,
    phone: null,
    email: null,
    enelConnectionNumber: null,
    contractType: "fixo",
    boxCount: null,
    minBox: null,
    valorPorBox: null,
    valorMensal: 300,
    dueDay: 10,
    paymentMethod: "pix",
    banco: null,
    agencia: null,
    conta: null,
    chavePix: null,
    startsOn: null,
    endsOn: null,
    observations: null,
    raw: {},
    ...overrides,
  });

  it("coalesces null contract_type → gratuito and null status → INACTIVE", () => {
    const row = toContractRow(
      contract({ contractType: null, status: null }),
      anyStation,
    );
    expect(row.contract_type).toBe("gratuito");
    expect(row.status).toBe("INACTIVE");
  });

  it("points a counterparty-less contract at the shared sentinel", () => {
    const row = toContractRow(contract({ counterpartyId: null }), anyStation);
    expect(row.counterparty_id).toBe(
      deterministicUuid("cp:sentinel:sem-contraparte"),
    );
  });
});

describe("toBillingAccountRow", () => {
  const account = (overrides: Partial<BillingAccount> = {}): BillingAccount => ({
    id: "enel:1",
    stationId: 10,
    accountType: "energy_enel",
    enelId: "1",
    edpUc: null,
    edpContractId: null,
    contractId: null,
    counterpartyId: null,
    externalRef: null,
    autoDebitRegistration: null,
    matchStatus: "auto_matched",
    isActive: true,
    notes: null,
    ...overrides,
  });

  it("sticky rows omit station_id/match_status (preserve human match)", () => {
    const row = toBillingAccountRow(account(), anyStation, { sticky: true });
    expect("station_id" in row).toBe(false);
    expect("match_status" in row).toBe(false);
  });

  it("non-sticky rows carry the snapshot station + match_status", () => {
    const row = toBillingAccountRow(account(), anyStation, { sticky: false });
    expect(row.station_id).toBe(10);
    expect(row.match_status).toBe("auto_matched");
  });

  it("a phantom station is nulled and the account becomes unmatched", () => {
    const row = toBillingAccountRow(account({ stationId: 700 }), noStation, {
      sticky: false,
    });
    expect(row.station_id).toBeNull();
    expect(row.match_status).toBe("unmatched");
  });
});
