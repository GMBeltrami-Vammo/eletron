import { describe, expect, it } from "vitest";
import type {
  BillingAccount,
  DomainSnapshot,
  Station,
  UtilityAccountState,
} from "@/lib/domain";
import {
  BILL_STATUS_SEVERITY,
  daysSince,
  daysUntil,
  evaluateAlerts,
  monthOf,
  stationRollups,
} from "./derive";

const NOW = new Date("2026-07-07T12:00:00-03:00");

function station(id: number, status: Station["status"] = "ACTIVE"): Station {
  return {
    id,
    name: `Estação ${id}`,
    address: null,
    latitude: null,
    longitude: null,
    status,
    sourceCreatedAt: null,
    raw: {},
  };
}

function account(
  id: string,
  stationId: number | null,
  accountType: BillingAccount["accountType"],
): BillingAccount {
  return {
    id,
    stationId,
    accountType,
    enelId: accountType === "energy_enel" ? id.split(":")[1] : null,
    edpUc: accountType === "energy_edp" ? id.split(":")[1] : null,
    edpContractId: null,
    contractId: null,
    counterpartyId: null,
    externalRef: null,
    autoDebitRegistration: null,
    matchStatus: stationId !== null ? "auto_matched" : "unmatched",
    isActive: true,
    notes: null,
  };
}

function state(
  billingAccountId: string,
  overrides: Partial<UtilityAccountState> = {},
): UtilityAccountState {
  return {
    billingAccountId,
    providerStationStatus: null,
    address: null,
    neighborhood: null,
    city: null,
    billStatus: "paga",
    billStatusRaw: "Paga",
    lastBilling: 100,
    dueDate: null,
    autoDebit: "cadastrado",
    autoDebitRegistration: null,
    accountEmail: null,
    negotiatedInvoices: [],
    negotiatedCompetencias: [],
    invoiceHistory: [],
    invoiceHistoryStatuses: [],
    shutdownDate: null,
    shutdownStart: null,
    shutdownEnd: null,
    firstSeenAt: "2026-01-01T00:00:00",
    scrapedAt: "2026-07-07T03:00:00",
    lat: null,
    lon: null,
    ultimaFaturaFlag: null,
    ultimoComprovante: null,
    ultimoComprovanteDate: null,
    isStatusCarriedForward: false,
    raw: {},
    ...overrides,
  };
}

function emptySnapshot(): DomainSnapshot {
  return {
    stations: [],
    counterparties: [],
    contracts: [],
    billingAccounts: [],
    utilityAccountStates: [],
    monthlyConsumption: [],
    charges: [],
    chargeLines: [],
    chargeEnergyDetails: [],
    rentAdjustments: [],
    issues: [],
  };
}

describe("date helpers", () => {
  it("computes whole-day distances deterministically", () => {
    expect(daysUntil("2026-07-12", NOW)).toBe(5);
    expect(daysUntil("2026-07-07", NOW)).toBe(0);
    expect(daysSince("2026-07-04T03:00:00", NOW)).toBe(3);
    expect(monthOf(NOW)).toBe("2026-07");
    expect(monthOf(NOW, -1)).toBe("2026-06");
  });
});

describe("stationRollups", () => {
  it("takes the worst-of bill status in the documented severity order", () => {
    expect(BILL_STATUS_SEVERITY.vencida).toBeGreaterThan(
      BILL_STATUS_SEVERITY.pendente,
    );
    expect(BILL_STATUS_SEVERITY.pendente).toBeGreaterThan(
      BILL_STATUS_SEVERITY.a_vencer,
    );
    expect(BILL_STATUS_SEVERITY.a_vencer).toBeGreaterThan(
      BILL_STATUS_SEVERITY.em_compensacao,
    );
    expect(BILL_STATUS_SEVERITY.em_compensacao).toBeGreaterThan(
      BILL_STATUS_SEVERITY.fatura_negociada,
    );
    expect(BILL_STATUS_SEVERITY.fatura_negociada).toBeGreaterThan(
      BILL_STATUS_SEVERITY.sem_contas,
    );
    expect(BILL_STATUS_SEVERITY.sem_contas).toBeGreaterThan(
      BILL_STATUS_SEVERITY.paga,
    );
    expect(BILL_STATUS_SEVERITY.paga).toBeGreaterThan(BILL_STATUS_SEVERITY.na);

    const snapshot = emptySnapshot();
    snapshot.stations = [station(1)];
    snapshot.billingAccounts = [
      account("enel:a", 1, "energy_enel"),
      account("enel:b", 1, "energy_enel"),
    ];
    snapshot.utilityAccountStates = [
      state("enel:a", { billStatus: "paga", lastBilling: 10 }),
      state("enel:b", {
        billStatus: "pendente",
        lastBilling: 20.5,
        dueDate: "2026-07-20",
        autoDebit: "nao_cadastrado",
        scrapedAt: "2026-07-01T03:00:00",
      }),
    ];
    const [rollup] = stationRollups(snapshot, NOW);
    expect(rollup.worstBillStatus).toBe("pendente");
    expect(rollup.lastBillingTotal).toBe(30.5);
    expect(rollup.earliestOpenDueDate).toBe("2026-07-20");
    expect(rollup.autoDebitAggregate).toBe("parcial");
    expect(rollup.freshness).toBe("2026-07-01T03:00:00"); // min scrapedAt
    expect(rollup.sources.enel).toBe(2);
  });

  it("computes F/R divergence for the latest month with both values", () => {
    const snapshot = emptySnapshot();
    snapshot.stations = [station(1)];
    snapshot.billingAccounts = [account("enel:a", 1, "energy_enel")];
    snapshot.utilityAccountStates = [state("enel:a")];
    snapshot.monthlyConsumption = [
      {
        billingAccountId: "enel:a",
        competencia: "2026-05-01",
        kwhBilled: 100,
        kwhRecorded: 100,
        source: "scraper_enel",
      },
      {
        billingAccountId: "enel:a",
        competencia: "2026-06-01",
        kwhBilled: 200,
        kwhRecorded: 150,
        source: "scraper_enel",
      },
      {
        billingAccountId: "enel:a",
        competencia: "2026-07-01",
        kwhBilled: 50,
        kwhRecorded: null, // incomplete month — ignored
        source: "scraper_enel",
      },
    ];
    const [rollup] = stationRollups(snapshot, NOW);
    expect(rollup.frDivergenceMonth).toBe("2026-06");
    expect(rollup.frDivergencePct).toBe(25);
  });

  it("reports rent status of the current month, worst wins", () => {
    const snapshot = emptySnapshot();
    snapshot.stations = [station(1)];
    snapshot.billingAccounts = [account("rent:1", 1, "rent")];
    snapshot.charges = [
      {
        id: "pag:1:2026-07:aluguel",
        billingAccountId: "rent:1",
        stationId: 1,
        kind: "aluguel",
        competencia: "2026-07-01",
        competenciaSource: "explicit",
        amount: 500,
        expectedAmount: null,
        dueDate: null,
        status: "pendente",
        matchStatus: "manually_matched",
        paymentMethod: null,
        banco: null,
        agencia: null,
        conta: null,
        chavePix: null,
        linhaDigitavel: null,
        notaFiscal: null,
        documentoNumero: null,
        issuerCnpj: null,
        source: "sheet_backfill",
        dedupeKey: "pag:1:2026-07:aluguel",
        legacyRef: null,
        notes: null,
        raw: {},
      },
    ];
    const [rollup] = stationRollups(snapshot, NOW);
    expect(rollup.rentStatusCurrentMonth).toBe("pendente");
  });
});

describe("evaluateAlerts", () => {
  it("raises overdue_bill for 'Vencida' states, minus receipted EDP", () => {
    const snapshot = emptySnapshot();
    snapshot.stations = [station(1), station(2)];
    snapshot.billingAccounts = [
      account("edp:1", 1, "energy_edp"),
      account("edp:2", 2, "energy_edp"),
    ];
    snapshot.utilityAccountStates = [
      state("edp:1", {
        billStatus: "vencida",
        dueDate: "2026-07-03",
        ultimoComprovanteDate: "2026-07-03", // receipt registered on due date
      }),
      state("edp:2", { billStatus: "vencida", dueDate: "2026-07-03" }),
    ];
    const alerts = evaluateAlerts(snapshot, NOW);
    const overdue = alerts.filter((a) => a.alertType === "overdue_bill");
    expect(overdue).toHaveLength(1);
    expect(overdue[0].billingAccountId).toBe("edp:2");
    expect(overdue[0].dedupeKey).toBe("overdue:edp:2:2026-07-03");
    expect(overdue[0].severity).toBe("critical");
  });

  it("raises overdue_bill from a 'Vencida' invoice-history entry", () => {
    const snapshot = emptySnapshot();
    snapshot.stations = [station(1)];
    snapshot.billingAccounts = [account("enel:9", 1, "energy_enel")];
    snapshot.utilityAccountStates = [
      state("enel:9", {
        billStatus: "pendente",
        dueDate: "2026-07-20",
        invoiceHistory: ["Vencida", "Paga"],
        invoiceHistoryStatuses: ["vencida", "paga"],
      }),
    ];
    const alerts = evaluateAlerts(snapshot, NOW);
    const overdue = alerts.filter((a) => a.alertType === "overdue_bill");
    expect(overdue).toHaveLength(1);
    expect(overdue[0].payload.fromHistory).toBe(true);
  });

  it("raises due_soon_no_auto_debit only inside the 0–7 day window", () => {
    const snapshot = emptySnapshot();
    snapshot.stations = [station(1)];
    snapshot.billingAccounts = [
      account("enel:soon", 1, "energy_enel"),
      account("enel:far", 1, "energy_enel"),
      account("enel:covered", 1, "energy_enel"),
    ];
    snapshot.utilityAccountStates = [
      state("enel:soon", {
        billStatus: "a_vencer",
        dueDate: "2026-07-12",
        autoDebit: "nao_cadastrado",
      }),
      state("enel:far", {
        billStatus: "a_vencer",
        dueDate: "2026-07-20", // 13 days — outside the window
        autoDebit: "nao_cadastrado",
      }),
      state("enel:covered", {
        billStatus: "a_vencer",
        dueDate: "2026-07-12",
        autoDebit: "cadastrado", // auto-debit covers it
      }),
    ];
    const alerts = evaluateAlerts(snapshot, NOW);
    const dueSoon = alerts.filter(
      (a) => a.alertType === "due_soon_no_auto_debit",
    );
    expect(dueSoon).toHaveLength(1);
    expect(dueSoon[0].dedupeKey).toBe("due_soon:enel:soon:2026-07-12");
  });

  it("raises no_auto_debit only for freshly-scraped accounts", () => {
    const snapshot = emptySnapshot();
    snapshot.stations = [station(1)];
    snapshot.billingAccounts = [
      account("enel:fresh", 1, "energy_enel"),
      account("enel:stale", 1, "energy_enel"),
    ];
    snapshot.utilityAccountStates = [
      state("enel:fresh", {
        autoDebit: "nao_cadastrado",
        scrapedAt: "2026-07-05T03:00:00", // 2 days
      }),
      state("enel:stale", {
        autoDebit: "nao_cadastrado",
        scrapedAt: "2026-06-01T03:00:00", // 36 days
      }),
    ];
    const alerts = evaluateAlerts(snapshot, NOW);
    const noAd = alerts.filter((a) => a.alertType === "no_auto_debit");
    expect(noAd).toHaveLength(1);
    expect(noAd[0].dedupeKey).toBe("no_auto_debit:enel:fresh");
  });

  it("never raises the retired scraper_stale (Phase 2.5 sever)", () => {
    const snapshot = emptySnapshot();
    snapshot.stations = [station(1)];
    snapshot.billingAccounts = [account("enel:stale", 1, "energy_enel")];
    snapshot.utilityAccountStates = [
      state("enel:stale", { scrapedAt: "2026-06-08T13:41:16" }), // 29 days
    ];
    const alerts = evaluateAlerts(snapshot, NOW);
    expect(alerts.filter((a) => a.alertType === "scraper_stale")).toHaveLength(0);
  });

  it("gates overdue_bill / due_soon on scrape recency (frozen data goes quiet)", () => {
    const snapshot = emptySnapshot();
    snapshot.stations = [station(1)];
    snapshot.billingAccounts = [
      account("enel:frozen", 1, "energy_enel"),
      account("enel:live", 1, "energy_enel"),
    ];
    snapshot.utilityAccountStates = [
      state("enel:frozen", {
        billStatus: "vencida",
        dueDate: "2026-07-10", // 3 days ahead — inside the due_soon window
        autoDebit: "nao_cadastrado",
        scrapedAt: "2026-05-01T03:00:00", // 67 days — frozen clone
      }),
      state("enel:live", {
        billStatus: "vencida",
        dueDate: "2026-07-03",
        scrapedAt: "2026-07-06T03:00:00", // 1 day — fresh
      }),
    ];
    const alerts = evaluateAlerts(snapshot, NOW);
    const overdue = alerts.filter((a) => a.alertType === "overdue_bill");
    expect(overdue).toHaveLength(1);
    expect(overdue[0].billingAccountId).toBe("enel:live");
    expect(
      alerts.filter((a) => a.alertType === "due_soon_no_auto_debit"),
    ).toHaveLength(0);
  });

  it("raises new_installation for accounts first seen under 3 days ago", () => {
    const snapshot = emptySnapshot();
    snapshot.stations = [station(1)];
    snapshot.billingAccounts = [
      account("enel:new", 1, "energy_enel"),
      account("enel:old", 1, "energy_enel"),
    ];
    snapshot.utilityAccountStates = [
      state("enel:new", { firstSeenAt: "2026-07-06T09:05:14" }),
      state("enel:old", { firstSeenAt: "2026-04-27T09:05:14" }),
    ];
    const alerts = evaluateAlerts(snapshot, NOW);
    const fresh = alerts.filter((a) => a.alertType === "new_installation");
    expect(fresh).toHaveLength(1);
    expect(fresh[0].billingAccountId).toBe("enel:new");
    expect(fresh[0].severity).toBe("info");
  });

  it("raises negotiated_invoice for current/previous month only", () => {
    const snapshot = emptySnapshot();
    snapshot.stations = [station(1)];
    snapshot.billingAccounts = [account("enel:neg", 1, "energy_enel")];
    snapshot.utilityAccountStates = [
      state("enel:neg", {
        negotiatedInvoices: ["Junho/26", "Julho/26", "Março/26"],
        negotiatedCompetencias: ["2026-06", "2026-07", "2026-03"],
      }),
    ];
    const alerts = evaluateAlerts(snapshot, NOW);
    const negotiated = alerts.filter(
      (a) => a.alertType === "negotiated_invoice",
    );
    expect(negotiated.map((a) => a.payload.competencia).sort()).toEqual([
      "2026-06",
      "2026-07",
    ]);
  });

  it("raises scheduled_shutdown for outages in the next 7 days", () => {
    const snapshot = emptySnapshot();
    snapshot.stations = [station(1)];
    snapshot.billingAccounts = [
      account("enel:s1", 1, "energy_enel"),
      account("enel:s2", 1, "energy_enel"),
    ];
    snapshot.utilityAccountStates = [
      state("enel:s1", {
        shutdownDate: "2026-07-12",
        shutdownStart: "10:00",
        shutdownEnd: "16:00",
      }),
      state("enel:s2", { shutdownDate: "2026-07-21" }), // 14 days out
    ];
    const alerts = evaluateAlerts(snapshot, NOW);
    const shutdowns = alerts.filter(
      (a) => a.alertType === "scheduled_shutdown",
    );
    expect(shutdowns).toHaveLength(1);
    expect(shutdowns[0].dedupeKey).toBe("shutdown:enel:s1:2026-07-12");
    expect(shutdowns[0].payload.shutdownStart).toBe("10:00");
  });

  it("computes the two irregularity outer joins", () => {
    const snapshot = emptySnapshot();
    snapshot.stations = [station(1), station(2), station(3, "INACTIVE")];
    snapshot.contracts = [
      {
        id: "contract:10",
        cadastroId: 10,
        stationId: 1,
        counterpartyId: null,
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
        valorMensal: 500,
        dueDay: 5,
        paymentMethod: "pix",
        banco: null,
        agencia: null,
        conta: null,
        chavePix: null,
        startsOn: null,
        endsOn: null,
        observations: null,
        raw: {},
      },
      {
        id: "contract:11",
        cadastroId: 11,
        stationId: null, // never matched to a station
        counterpartyId: null,
        status: "ACTIVE",
        address: "Rua X",
        contactName: null,
        phone: null,
        email: null,
        enelConnectionNumber: null,
        contractType: "fixo",
        boxCount: null,
        minBox: null,
        valorPorBox: null,
        valorMensal: 700,
        dueDay: 5,
        paymentMethod: "pix",
        banco: null,
        agencia: null,
        conta: null,
        chavePix: null,
        startsOn: null,
        endsOn: null,
        observations: null,
        raw: {},
      },
    ];
    const alerts = evaluateAlerts(snapshot, NOW);
    const withoutContract = alerts.filter(
      (a) => a.alertType === "station_without_contract",
    );
    const withoutStation = alerts.filter(
      (a) => a.alertType === "contract_without_station",
    );
    // station 2 is ACTIVE without contract; station 3 is INACTIVE → ignored.
    expect(withoutContract.map((a) => a.stationId)).toEqual([2]);
    expect(withoutStation.map((a) => a.dedupeKey)).toEqual([
      "contract_without_station:contract:11",
    ]);
  });

  it("emits unique deterministic dedupe keys", () => {
    const snapshot = emptySnapshot();
    snapshot.stations = [station(1)];
    snapshot.billingAccounts = [account("enel:x", 1, "energy_enel")];
    snapshot.utilityAccountStates = [
      state("enel:x", {
        billStatus: "vencida",
        dueDate: "2026-07-01",
        autoDebit: "nao_cadastrado",
        shutdownDate: "2026-07-10",
        negotiatedCompetencias: ["2026-07"],
        firstSeenAt: "2026-07-06T00:00:00",
      }),
    ];
    const alerts = evaluateAlerts(snapshot, NOW);
    const keys = alerts.map((a) => a.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(alerts.length).toBeGreaterThanOrEqual(5);
  });
});
