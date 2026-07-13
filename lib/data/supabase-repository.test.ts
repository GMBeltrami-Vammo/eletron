/**
 * Pure-logic tests for the Supabase read layer: numeric coercion + the
 * deterministic domain-id reconstruction. The headline test is the
 * sync↔repository round-trip: mapping every fixture entity to a DB row (as the
 * sync writes it) and reconstructing the domain id back must reproduce the
 * original Phase-1 string id — the property that makes the two backends
 * interchangeable behind URLs/ids.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { DomainSnapshot } from "@/lib/domain";
import { loadRawTabsFromFixtures } from "@/lib/ingest/fixtures-loader";
import { normalizeSnapshot } from "@/lib/ingest/normalize";
import {
  deterministicUuid,
  toBillingAccountRow,
  toContractRow,
  toCounterpartyRow,
} from "@/lib/sync/sheet-sync";
import {
  num,
  reconstructAccountId,
  reconstructContractId,
  reconstructCounterpartyId,
  type AccountIdContext,
} from "./supabase-repository";

describe("num() — PostgREST numeric-as-string coercion", () => {
  it("passes numbers through and parses numeric strings", () => {
    expect(num(289.47)).toBe(289.47);
    expect(num("1042.29")).toBe(1042.29);
    expect(num("6663")).toBe(6663);
    expect(num("0")).toBe(0);
  });
  it("maps null / empty / junk to null (never NaN)", () => {
    expect(num(null)).toBeNull();
    expect(num(undefined)).toBeNull();
    expect(num("")).toBeNull();
    expect(num("   ")).toBeNull();
    expect(num("abc")).toBeNull();
    expect(num(Number.NaN)).toBeNull();
  });
});

describe("id reconstruction (synthetic)", () => {
  it("counterparty id: cnpj wins, else name-slug", () => {
    expect(reconstructCounterpartyId("12345678000199", "Foo Ltda")).toBe(
      "cp:12345678000199",
    );
    expect(reconstructCounterpartyId(null, "Mc Donalds")).toBe("cp:name:mc-donalds");
  });

  it("contract id: cadastro_id, else uuid fallback", () => {
    expect(reconstructContractId(42, "uuid-x")).toBe("contract:42");
    expect(reconstructContractId(null, "uuid-x")).toBe("contract:uuid-x");
  });

  it("account id: all four types, incl. name-only 3p via slug", () => {
    const cpUuid = "cp-uuid";
    const contractUuid = "contract-uuid";
    const ctx: AccountIdContext = {
      cadastroByContractUuid: new Map([[contractUuid, 7]]),
      counterpartyByUuid: new Map([[cpUuid, { cnpjCpf: null, name: "Mc Donalds" }]]),
    };
    const base = {
      enel_id: null,
      edp_uc: null,
      contract_id: null,
      counterparty_id: null,
      station_id: null,
    };
    expect(
      reconstructAccountId(
        { ...base, account_type: "energy_enel", enel_id: "204454589" },
        ctx,
      ),
    ).toBe("enel:204454589");
    expect(
      reconstructAccountId(
        { ...base, account_type: "energy_edp", edp_uc: "151436233" },
        ctx,
      ),
    ).toBe("edp:151436233");
    expect(
      reconstructAccountId(
        { ...base, account_type: "rent", contract_id: contractUuid },
        ctx,
      ),
    ).toBe("rent:7");
    expect(
      reconstructAccountId(
        {
          ...base,
          account_type: "third_party",
          counterparty_id: cpUuid,
          station_id: 553,
        },
        ctx,
      ),
    ).toBe("3p:name:mc-donalds:553");
  });
});

describe("sync ↔ repository round-trip over the real fixtures", () => {
  let snapshot: DomainSnapshot;
  let stationIds: Set<number>;
  const validStation = (id: number | null): number | null =>
    id !== null && stationIds.has(id) ? id : null;

  // Explicit timeout: the xlsx fixture load flakes past the 10s hook default
  // under OneDrive rehydration / suite load (GT-harness precedent, 76c7060).
  beforeAll(async () => {
    snapshot = normalizeSnapshot(await loadRawTabsFromFixtures());
    stationIds = new Set(snapshot.stations.map((s) => s.id));
  }, 60_000);

  it("reconstructs every counterparty id from its written row", () => {
    for (const cp of snapshot.counterparties) {
      const row = toCounterpartyRow(cp);
      expect(
        reconstructCounterpartyId(row.cnpj_cpf as string | null, row.name as string),
      ).toBe(cp.id);
    }
  });

  it("reconstructs every contract id from its written row", () => {
    for (const c of snapshot.contracts) {
      const row = toContractRow(c, validStation);
      expect(
        reconstructContractId(row.cadastro_id as number | null, row.id as string),
      ).toBe(c.id);
    }
  });

  it("reconstructs every billing-account id from its written row (528 accounts)", () => {
    // Build the uuid→natural lookups exactly as loadChargingWorld does.
    const cadastroByContractUuid = new Map<string, number | null>();
    for (const c of snapshot.contracts) {
      const row = toContractRow(c, validStation);
      cadastroByContractUuid.set(row.id as string, row.cadastro_id as number | null);
    }
    const counterpartyByUuid = new Map<
      string,
      { cnpjCpf: string | null; name: string }
    >();
    for (const cp of snapshot.counterparties) {
      const row = toCounterpartyRow(cp);
      counterpartyByUuid.set(row.id as string, {
        cnpjCpf: row.cnpj_cpf as string | null,
        name: row.name as string,
      });
    }
    const ctx: AccountIdContext = { cadastroByContractUuid, counterpartyByUuid };

    let checked = 0;
    for (const a of snapshot.billingAccounts) {
      const row = toBillingAccountRow(a, validStation, { sticky: false });
      expect(
        reconstructAccountId(
          {
            account_type: row.account_type as (typeof a)["accountType"],
            enel_id: row.enel_id as string | null,
            edp_uc: row.edp_uc as string | null,
            contract_id: row.contract_id as string | null,
            counterparty_id: row.counterparty_id as string | null,
            station_id: row.station_id as number | null,
          },
          ctx,
        ),
      ).toBe(a.id);
      checked += 1;
    }
    expect(checked).toBe(snapshot.billingAccounts.length);
  });

  it("deterministicUuid is stable and 1:1 across the account id space", () => {
    const uuids = snapshot.billingAccounts.map((a) => deterministicUuid(a.id));
    // valid v5-shaped uuids
    for (const u of uuids) {
      expect(u).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
    // no collisions (distinct string ids → distinct uuids)
    expect(new Set(uuids).size).toBe(uuids.length);
    // stable
    expect(deterministicUuid("enel:204454589")).toBe(
      deterministicUuid("enel:204454589"),
    );
  });
});
