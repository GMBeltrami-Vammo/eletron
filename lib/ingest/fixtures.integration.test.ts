/**
 * Integration tests over the REAL xlsx fixtures in context/ — the same files
 * the dev fallback serves. Numbers asserted here were verified against the
 * fixtures directly (2026-07-07 audit) and pin the normalize pipeline:
 * if the fixtures change, these change with them.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { DomainSnapshot } from "@/lib/domain";
import { SheetSnapshotRepository } from "@/lib/data/repository";
import { loadRawTabsFromFixtures } from "./fixtures-loader";
import { normalizeSnapshot } from "./normalize";
import type { RawTabs } from "./raw-tabs";

let raw: RawTabs;
let snapshot: DomainSnapshot;

// Explicit timeout: the xlsx fixture load flakes past the 10s hook default
// when OneDrive is rehydrating context/ or the suite runs under load (same
// class as the GT-harness fix, commit 76c7060).
beforeAll(async () => {
  raw = await loadRawTabsFromFixtures();
  snapshot = normalizeSnapshot(raw);
}, 60_000);

describe("fixtures loader", () => {
  it("loads all nine tabs with the expected row counts", () => {
    expect(raw["Vammo_data"]).toHaveLength(300);
    expect(raw["enel_data"]).toHaveLength(254);
    expect(raw["edp_data"]).toHaveLength(17);
    expect(raw["Faturas_ENEL"]).toHaveLength(465);
    expect(raw["Faturas_EDP"]).toHaveLength(28);
    expect(raw["MatchingQualityCheck"]).toHaveLength(188);
    expect(raw["1_Cadastro"]).toHaveLength(244);
    expect(raw["2_Pagamentos"]).toHaveLength(366);
    expect(raw["3_Reajustes"]).toHaveLength(0);
  });

  it("repairs the broken '#REF!' header into the Pago boolean column", () => {
    const row = raw["2_Pagamentos"][0];
    expect(row).not.toHaveProperty("#REF!");
    expect(row).toHaveProperty("Pago");
    expect(["TRUE", "FALSE"]).toContain(row["Pago"]);
  });

  it("keeps link_fatura as an =HYPERLINK formula string (FORMULA parity)", () => {
    const withLink = raw["Faturas_ENEL"].find((r) =>
      r["link_fatura"]?.startsWith("=HYPERLINK"),
    );
    expect(withLink).toBeDefined();
    expect(withLink?.["link_fatura"]).toMatch(
      /^=HYPERLINK\("https:\/\/drive\.google\.com\//,
    );
  });

  it("expands scientific-notation renderings to full digit strings", () => {
    // edp_id cells render '2.80969E+11' in the raw export; the loader must
    // emit the stored full-precision number instead.
    for (const row of raw["edp_data"]) {
      expect(row["edp_id"]).not.toMatch(/E\+/i);
      expect(row["edp_id"]).toMatch(/^\d+$/);
    }
  });
});

describe("stations and billing accounts", () => {
  it("normalizes all 300 stations", () => {
    expect(snapshot.stations).toHaveLength(300);
    const ids = new Set(snapshot.stations.map((s) => s.id));
    expect(ids.size).toBe(300);
  });

  it("yields 254 energy_enel + 17 energy_edp + 244 rent + 13 third_party accounts", () => {
    const byType = (t: string) =>
      snapshot.billingAccounts.filter((a) => a.accountType === t);
    expect(byType("energy_enel")).toHaveLength(254);
    expect(byType("energy_edp")).toHaveLength(17);
    expect(byType("rent")).toHaveLength(244);
    expect(byType("third_party")).toHaveLength(13);
  });

  it("station 553 has exactly 3 energy_enel billing accounts", () => {
    const accounts = snapshot.billingAccounts.filter(
      (a) => a.stationId === 553 && a.accountType === "energy_enel",
    );
    expect(accounts.map((a) => a.enelId).sort()).toEqual([
      "204454589",
      "204543107",
      "204767183",
    ]);
  });

  it.each([[1373], [968], [1043]])(
    "station %i has exactly 2 energy_edp billing accounts",
    (stationId) => {
      const accounts = snapshot.billingAccounts.filter(
        (a) => a.stationId === stationId && a.accountType === "energy_edp",
      );
      expect(accounts).toHaveLength(2);
    },
  );

  it("UNIDENTIFIED/blank enel_data rows become unmatched accounts (never dropped)", () => {
    // Fixture: 3 'Unidentified' + 16 blank swap_station_id rows.
    const unmatchedEnel = snapshot.billingAccounts.filter(
      (a) =>
        a.accountType === "energy_enel" &&
        a.stationId === null &&
        a.matchStatus === "unmatched",
    );
    expect(unmatchedEnel).toHaveLength(19);
    // Every one still has its scraper state attached.
    const stateIds = new Set(
      snapshot.utilityAccountStates.map((s) => s.billingAccountId),
    );
    for (const account of unmatchedEnel) {
      expect(stateIds.has(account.id)).toBe(true);
    }
  });

  it("keeps the 2 station-less edp_data rows as unmatched accounts", () => {
    const unmatchedEdp = snapshot.billingAccounts.filter(
      (a) => a.accountType === "energy_edp" && a.stationId === null,
    );
    expect(unmatchedEdp).toHaveLength(2);
    expect(unmatchedEdp.map((a) => a.edpUc).sort()).toEqual([
      "151500714",
      "151504341",
    ]);
  });
});

describe("utility account states", () => {
  it("creates one state per scraper row (254 ENEL + 17 EDP)", () => {
    expect(snapshot.utilityAccountStates).toHaveLength(271);
  });

  it("'Sem contas' rows get isStatusCarriedForward=true (54 in the fixture)", () => {
    const carried = snapshot.utilityAccountStates.filter(
      (s) => s.isStatusCarriedForward,
    );
    expect(carried).toHaveLength(54);
    for (const s of carried) {
      expect(s.billStatus).toBe("sem_contas");
      expect(s.billStatusRaw).toBe("Sem contas");
    }
    // And no other row carries the flag.
    const notCarried = snapshot.utilityAccountStates.filter(
      (s) => !s.isStatusCarriedForward && s.billStatus === "sem_contas",
    );
    expect(notCarried).toHaveLength(0);
  });

  it("parses EDP DD/MM/YY due dates and pt-BR money", () => {
    const s = snapshot.utilityAccountStates.find(
      (s) => s.billingAccountId === "edp:151436233",
    );
    expect(s).toBeDefined();
    expect(s?.dueDate).toBe("2026-07-03");
    expect(s?.lastBilling).toBe(7028.04);
    expect(s?.billStatus).toBe("vencida");
    expect(s?.ultimoComprovanteDate).toBe("2026-07-03");
  });

  it("unpivots the month matrices for both providers", () => {
    const edpJun = snapshot.monthlyConsumption.find(
      (m) =>
        m.billingAccountId === "edp:151436233" &&
        m.competencia === "2026-06-01",
    );
    expect(edpJun?.kwhBilled).toBe(6663);
    expect(edpJun?.kwhRecorded).toBeNull();
    expect(edpJun?.source).toBe("scraper_edp");

    // The stale English-cased duplicates ('Jun26') must not double-count:
    const edpAccount = snapshot.monthlyConsumption.filter(
      (m) => m.billingAccountId === "edp:151436233",
    );
    expect(new Set(edpAccount.map((m) => m.competencia)).size).toBe(
      edpAccount.length,
    );

    const enelRows = snapshot.monthlyConsumption.filter(
      (m) => m.source === "scraper_enel",
    );
    expect(enelRows.length).toBeGreaterThan(0);
    expect(enelRows.some((m) => m.kwhRecorded !== null)).toBe(true);
  });
});

describe("charges from Faturas_ENEL / Faturas_EDP", () => {
  it("yields 464 ENEL charges (465 rows − 1 byte-identical duplicate) with clean FKs", () => {
    const enelCharges = snapshot.charges.filter(
      (c) => c.source === "scraper_enel",
    );
    expect(enelCharges).toHaveLength(464);

    const accountIds = new Set(snapshot.billingAccounts.map((a) => a.id));
    for (const charge of enelCharges) {
      expect(charge.billingAccountId).not.toBeNull();
      expect(accountIds.has(charge.billingAccountId as string)).toBe(true);
      expect(charge.kind).toBe("energia");
      expect(charge.dedupeKey.startsWith("enel:")).toBe(true);
    }
    // The duplicate was reported, not silently dropped.
    const dupIssues = snapshot.issues.filter(
      (i) => i.tab === "Faturas_ENEL" && i.code === "duplicate_dedupe_key",
    );
    expect(dupIssues).toHaveLength(1);
    expect(dupIssues[0].rawValue).toBe("enel:204497514:2026-06-22");
  });

  it("yields 27 EDP charges (28 rows − 1 duplicate) with clean FKs", () => {
    const edpCharges = snapshot.charges.filter(
      (c) => c.source === "scraper_edp",
    );
    expect(edpCharges).toHaveLength(27);
    const accountIds = new Set(snapshot.billingAccounts.map((a) => a.id));
    for (const charge of edpCharges) {
      expect(charge.billingAccountId).not.toBeNull();
      expect(accountIds.has(charge.billingAccountId as string)).toBe(true);
    }
    const dupIssues = snapshot.issues.filter(
      (i) => i.tab === "Faturas_EDP" && i.code === "duplicate_dedupe_key",
    );
    expect(dupIssues).toHaveLength(1);
    expect(dupIssues[0].rawValue).toBe("edp:150400460:2026-05-26");
  });

  it("attaches 1:1 energy details with parsed numbers and the Drive URL", () => {
    const charge = snapshot.charges.find(
      (c) => c.dedupeKey === "enel:39882551:2026-07-01",
    );
    expect(charge).toBeDefined();
    expect(charge?.amount).toBe(289.47);
    expect(charge?.status).toBe("pago"); // has a Comprovante link (not from the fiscal flag)
    expect(charge?.competencia).toBe("2026-07-01");
    expect(charge?.competenciaSource).toBe("inferred_due_date");
    // Charge-level fiscal flag mirrors the "Financeiro Check" detail (Q8).
    expect(charge?.fiscalExported).toBe(true);

    const details = snapshot.chargeEnergyDetails.find(
      (d) => d.chargeId === charge?.id,
    );
    expect(details).toBeDefined();
    expect(details?.tusdKwh).toBe(282.64);
    expect(details?.tusdAmount).toBe(155.81);
    expect(details?.cip).toBe(21.43);
    expect(details?.total).toBe(289.47);
    expect(details?.leituraAnterior).toBe("2026-05-16");
    expect(details?.leituraAtual).toBe("2026-06-12");
    expect(details?.faturaDriveUrl).toMatch(/^https:\/\/drive\.google\.com\//);
    expect(details?.fiscalExported).toBe(true);
  });

  it("every utility charge has energy details", () => {
    const utilityCharges = snapshot.charges.filter(
      (c) => c.source === "scraper_enel" || c.source === "scraper_edp",
    );
    const detailIds = new Set(
      snapshot.chargeEnergyDetails.map((d) => d.chargeId),
    );
    expect(utilityCharges.every((c) => detailIds.has(c.id))).toBe(true);
    expect(snapshot.chargeEnergyDetails).toHaveLength(utilityCharges.length);
  });
});

describe("charges from 2_Pagamentos", () => {
  it("yields one rent-sheet charge per row (366), never dropping any", () => {
    const pagCharges = snapshot.charges.filter(
      (c) => c.source === "sheet_backfill",
    );
    expect(pagCharges).toHaveLength(366);
    const byKind = (k: string) => pagCharges.filter((c) => c.kind === k);
    expect(byKind("aluguel")).toHaveLength(351);
    expect(byKind("energia")).toHaveLength(12);
    expect(byKind("aluguel_energia")).toHaveLength(3);
  });

  it("maps the Pago boolean to charge status", () => {
    const pagCharges = snapshot.charges.filter(
      (c) => c.source === "sheet_backfill",
    );
    expect(pagCharges.filter((c) => c.status === "pago")).toHaveLength(175);
    expect(pagCharges.filter((c) => c.status === "pendente")).toHaveLength(191);
  });

  it("maps the 'No Fiscal' boolean to charge.fiscalExported (Q8)", () => {
    const pagCharges = snapshot.charges.filter(
      (c) => c.source === "sheet_backfill",
    );
    // Fixture 2_Pagamentos "No Fiscal" (col R): 342 TRUE, 10 FALSE, 14 blank.
    // Boolean-aware parse (like energy's "Financeiro Check"): TRUE ⇒ true;
    // FALSE and blank ⇒ false. A naive non-empty check would wrongly flag the
    // 10 explicit FALSE rows as sent (352), so this pins the parse.
    expect(pagCharges.filter((c) => c.fiscalExported === true)).toHaveLength(342);
    expect(pagCharges.filter((c) => c.fiscalExported === false)).toHaveLength(24);
  });

  it("parses the polluted Documento/Planilha/Energia Valor cells into splits", () => {
    const kitchen = snapshot.charges.find(
      (c) =>
        c.source === "sheet_backfill" &&
        c.notes?.includes("Documento: 5639.8 / Planilha: 1000 / Energia: 4726.8"),
    );
    expect(kitchen).toBeDefined();
    expect(kitchen?.amount).toBe(5639.8);
    expect(kitchen?.expectedAmount).toBe(1000);
    const line = snapshot.chargeLines.find(
      (l) => l.chargeId === kitchen?.id && l.lineKind === "energia",
    );
    expect(line?.amount).toBe(4726.8);

    // Fixture-wide: 12 'Energia:' labels → 12 energia lines,
    // 10 'Locação:' labels → 10 aluguel lines.
    expect(
      snapshot.chargeLines.filter((l) => l.lineKind === "energia"),
    ).toHaveLength(12);
    expect(
      snapshot.chargeLines.filter((l) => l.lineKind === "aluguel"),
    ).toHaveLength(10);
  });

  it("keeps competência explicit from Mês+Ano", () => {
    const pagCharges = snapshot.charges.filter(
      (c) => c.source === "sheet_backfill",
    );
    for (const charge of pagCharges) {
      expect(charge.competencia).toMatch(/^2026-(05|06)-01$/);
      expect(charge.competenciaSource).toBe("explicit");
    }
  });

  it("UNIDENTIFIED cadastro rows survive as unmatched/suffixed charges", () => {
    const unidentified = snapshot.charges.filter(
      (c) =>
        c.source === "sheet_backfill" &&
        c.dedupeKey.startsWith("pag:unidentified:"),
    );
    expect(unidentified).toHaveLength(4);
    // 3 of them collide on (unidentified, 2026-05, energia) → #2/#3 suffixes.
    const collisions = snapshot.issues.filter(
      (i) => i.tab === "2_Pagamentos" && i.code === "duplicate_dedupe_key",
    );
    expect(collisions).toHaveLength(2);
  });
});

describe("contracts and counterparties", () => {
  it("normalizes all 244 contracts with typed enums and money", () => {
    expect(snapshot.contracts).toHaveLength(244);
    const byType = (t: string) =>
      snapshot.contracts.filter((c) => c.contractType === t);
    expect(byType("por_box")).toHaveLength(137);
    expect(byType("fixo")).toHaveLength(94);
    expect(byType("por_box_minimo")).toHaveLength(4);
    expect(byType("gratuito")).toHaveLength(3);
    expect(byType("casa_vammo")).toHaveLength(6);

    const first = snapshot.contracts.find((c) => c.cadastroId === 1);
    expect(first?.stationId).toBe(1579);
    expect(first?.status).toBe("DECOMMISSIONED");
    expect(first?.valorMensal).toBe(300);
    expect(first?.paymentMethod).toBe("pix");
  });

  it("normalizes both casings of 'Boleto (email)' to one enum value", () => {
    const boletoEmail = snapshot.contracts.filter(
      (c) => c.paymentMethod === "boleto_email",
    );
    expect(boletoEmail).toHaveLength(60); // 55 'Boleto (Email)' + 5 'Boleto (email)'
  });

  it("dedupes counterparties by CNPJ digits", () => {
    for (const cp of snapshot.counterparties) {
      if (cp.cnpjCpf !== null) {
        expect(cp.cnpjCpf).toMatch(/^\d+$/);
      }
    }
    const ids = snapshot.counterparties.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("issues — nothing silently dropped", () => {
  it("captures the junk installation_id from Vammo_data", () => {
    const junk = snapshot.issues.find(
      (i) =>
        i.tab === "Vammo_data" &&
        i.column === "installation_id" &&
        i.code === "invalid_value",
    );
    expect(junk).toBeDefined();
    expect(junk?.rawValue).toContain("hg");
  });

  it("row counts reconcile: no enel_data/edp_data row lost", () => {
    const enelAccounts = snapshot.billingAccounts.filter(
      (a) => a.accountType === "energy_enel",
    );
    expect(enelAccounts.length).toBe(raw["enel_data"].length);
    const edpAccounts = snapshot.billingAccounts.filter(
      (a) => a.accountType === "energy_edp",
    );
    expect(edpAccounts.length).toBe(raw["edp_data"].length);
  });
});

describe("SheetSnapshotRepository over the fixtures", () => {
  const NOW = new Date("2026-07-07T12:00:00-03:00");
  const repo = new SheetSnapshotRepository(
    () => loadRawTabsFromFixtures(),
    () => NOW,
  );

  // 60s: the FIRST repo call in this describe pays the lazy xlsx fixture load,
  // which flakes past the 5s default under OneDrive/suite load (76c7060 class).
  it("getStations returns one rollup per station", async () => {
    const rollups = await repo.getStations();
    expect(rollups).toHaveLength(300);
    const s553 = rollups.find((r) => r.stationId === 553);
    expect(s553?.sources.enel).toBe(3);
  }, 60_000);

  it("getStation(553) assembles the 360° object", async () => {
    const station360 = await repo.getStation(553);
    expect(station360).not.toBeNull();
    expect(
      station360?.accounts.filter(
        (a) => a.account.accountType === "energy_enel",
      ),
    ).toHaveLength(3);
    // Each energy account carries its scraper state.
    for (const acc of station360?.accounts ?? []) {
      if (acc.account.accountType === "energy_enel") {
        expect(acc.state).not.toBeNull();
      }
    }
  });

  it("getCharges filters work", async () => {
    const overdueOpen = await repo.getCharges({
      kind: "energia",
      status: "pendente",
    });
    for (const c of overdueOpen) {
      expect(c.kind).toBe("energia");
      expect(c.status).toBe("pendente");
    }
    const unmatched = await repo.getCharges({ unmatchedOnly: true });
    for (const c of unmatched) {
      expect(["unmatched", "needs_review"]).toContain(c.matchStatus);
    }
  });

  it("getAlerts produces unique dedupe keys", async () => {
    const alerts = await repo.getAlerts();
    const keys = alerts.map((a) => a.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(alerts.length).toBeGreaterThan(0);
  });

  it("getFreshness reports per-provider scrape windows", async () => {
    const freshness = await repo.getFreshness();
    expect(freshness.minScrapedAt).not.toBeNull();
    expect(freshness.byProvider.edp.maxScrapedAt).toMatch(/^2026-07-07T/);
    expect(freshness.fetchedAt).toBe(NOW.toISOString());
  });

  it("getIrregularities surfaces unmatched accounts and issues", async () => {
    const irregularities = await repo.getIrregularities();
    expect(irregularities.unmatchedAccounts.length).toBeGreaterThanOrEqual(21);
    expect(irregularities.issues.length).toBeGreaterThan(0);
  });
});
