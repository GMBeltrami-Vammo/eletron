/**
 * Monthly matrix derivation tests (R3): the M6 decision table (both/one/none
 * paid, aguardando-DA vs em-aberto, rent-manual, aluguel_energia satisfies
 * both), and the metric exclusions (kWh ≤ 0 / active_boxes null).
 */

import { describe, expect, it } from "vitest";
import type {
  BillingAccount,
  Charge,
  ChargeEnergyDetails,
  ChargeStatus,
  Contract,
  DomainSnapshot,
  MonthlyConsumption,
  Station,
  UtilityAccountState,
} from "@/lib/domain";

import { deriveMonthlyMatrix } from "./derive";

const MONTH = "2026-07";

function empty(): DomainSnapshot {
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

function station(id: number, activeBoxes: number | null = null): Station {
  return {
    id,
    name: `Estação ${id}`,
    address: null,
    latitude: null,
    longitude: null,
    status: "ACTIVE",
    sourceCreatedAt: null,
    activeBoxes,
    boxesSyncedAt: null,
    hidden: false,
    raw: {},
  };
}

function account(
  id: string,
  stationId: number,
  accountType: BillingAccount["accountType"],
): BillingAccount {
  return {
    id,
    stationId,
    accountType,
    enelId: accountType === "energy_enel" ? id : null,
    edpUc: null,
    edpContractId: null,
    contractId: accountType === "rent" ? `c:${stationId}` : null,
    counterpartyId: null,
    externalRef: null,
    autoDebitRegistration: null,
    matchStatus: "auto_matched",
    isActive: true,
    notes: null,
  };
}

function contract(stationId: number, over: Partial<Contract> = {}): Contract {
  return {
    id: `c:${stationId}`,
    cadastroId: stationId,
    stationId,
    counterpartyId: null,
    status: "ACTIVE",
    address: null,
    contactName: null,
    phone: null,
    email: null,
    enelConnectionNumber: null,
    contractType: "fixo",
    boxCount: 10,
    minBox: null,
    valorPorBox: null,
    valorMensal: 1000,
    dueDay: 10,
    paymentMethod: "pix",
    banco: null,
    agencia: null,
    conta: null,
    chavePix: null,
    startsOn: null,
    endsOn: null,
    observations: null,
    rentManual: false,
    raw: {},
    ...over,
  };
}

function charge(over: Partial<Charge> & Pick<Charge, "id" | "kind">): Charge {
  return {
    billingAccountId: null,
    stationId: null,
    competencia: `${MONTH}-01`,
    competenciaSource: "explicit",
    amount: 100,
    expectedAmount: null,
    dueDate: null,
    status: "pendente" as ChargeStatus,
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
    source: "gerar_mes",
    dedupeKey: over.id,
    legacyRef: null,
    notes: null,
    raw: {},
    ...over,
  };
}

function state(
  billingAccountId: string,
  autoDebit: UtilityAccountState["autoDebit"],
): UtilityAccountState {
  return {
    billingAccountId,
    providerStationStatus: null,
    address: null,
    neighborhood: null,
    city: null,
    billStatus: null,
    billStatusRaw: null,
    lastBilling: null,
    dueDate: null,
    autoDebit,
    autoDebitRegistration: null,
    accountEmail: null,
    negotiatedInvoices: [],
    negotiatedCompetencias: [],
    invoiceHistory: [],
    invoiceHistoryStatuses: [],
    shutdownDate: null,
    shutdownStart: null,
    shutdownEnd: null,
    firstSeenAt: null,
    scrapedAt: null,
    lat: null,
    lon: null,
    ultimaFaturaFlag: null,
    ultimoComprovante: null,
    ultimoComprovanteDate: null,
    isStatusCarriedForward: false,
    raw: {},
  };
}

function consumption(billingAccountId: string, kwhBilled: number | null): MonthlyConsumption {
  return {
    billingAccountId,
    competencia: `${MONTH}-01`,
    kwhBilled,
    kwhRecorded: null,
    source: "scraper_enel",
  };
}

function energyDetails(chargeId: string, tusdKwh: number | null): ChargeEnergyDetails {
  return {
    chargeId,
    nf: null,
    tariffC1: null, tariffC2: null, tariffC3: null,
    tariffC4: null, tariffC5: null, tariffC6: null,
    classificacao: null, modalidade: null, tipoFornecimento: null,
    tusdKwh, tusdAmount: null, teKwh: null, teAmount: null,
    cip: null, subFaturamento: null, total: null,
    leituraAnterior: null, leituraAtual: null,
    autoDebit: "desconhecido", autoDebitRegistration: null,
    faturaDriveUrl: null, fiscalExported: false, fiscalExportedAt: null,
  };
}

describe("deriveMonthlyMatrix — decision table", () => {
  it("both settled → ambas", () => {
    const s = empty();
    s.stations = [station(1)];
    s.contracts = [contract(1)];
    s.billingAccounts = [account("e1", 1, "energy_enel"), account("r1", 1, "rent")];
    s.charges = [
      charge({ id: "en", kind: "energia", stationId: 1, billingAccountId: "e1", status: "pago" }),
      charge({ id: "al", kind: "aluguel", stationId: 1, billingAccountId: "r1", status: "conciliado" }),
    ];
    const m = deriveMonthlyMatrix(s, MONTH);
    expect(m.rows[0].group).toBe("ambas");
    expect(m.rows[0].energy.paid).toBe(true);
    expect(m.rows[0].rent.paid).toBe(true);
    expect(m.groups.ambas).toBe(1);
  });

  it("energy paid, rent open → so_energia", () => {
    const s = empty();
    s.stations = [station(1)];
    s.contracts = [contract(1)];
    s.billingAccounts = [account("e1", 1, "energy_enel"), account("r1", 1, "rent")];
    s.charges = [
      charge({ id: "en", kind: "energia", stationId: 1, billingAccountId: "e1", status: "pago" }),
      charge({ id: "al", kind: "aluguel", stationId: 1, billingAccountId: "r1", status: "pendente" }),
    ];
    const m = deriveMonthlyMatrix(s, MONTH);
    expect(m.rows[0].group).toBe("so_energia");
    expect(m.rows[0].rent.detail).toContain("pix");
  });

  it("rent paid, energy open → so_aluguel", () => {
    const s = empty();
    s.stations = [station(1)];
    s.contracts = [contract(1)];
    s.billingAccounts = [account("e1", 1, "energy_enel"), account("r1", 1, "rent")];
    s.charges = [
      charge({ id: "en", kind: "energia", stationId: 1, billingAccountId: "e1", status: "pendente" }),
      charge({ id: "al", kind: "aluguel", stationId: 1, billingAccountId: "r1", status: "pago" }),
    ];
    expect(deriveMonthlyMatrix(s, MONTH).rows[0].group).toBe("so_aluguel");
  });

  it("both open → nenhuma", () => {
    const s = empty();
    s.stations = [station(1)];
    s.contracts = [contract(1)];
    s.billingAccounts = [account("e1", 1, "energy_enel"), account("r1", 1, "rent")];
    s.charges = [
      charge({ id: "en", kind: "energia", stationId: 1, billingAccountId: "e1", status: "pendente" }),
      charge({ id: "al", kind: "aluguel", stationId: 1, billingAccountId: "r1", status: "pendente" }),
    ];
    expect(deriveMonthlyMatrix(s, MONTH).rows[0].group).toBe("nenhuma");
  });

  it("open energy with DA registered → aguardando_da (collected, not missing)", () => {
    const s = empty();
    s.stations = [station(1)];
    s.billingAccounts = [account("e1", 1, "energy_enel")];
    s.utilityAccountStates = [state("e1", "cadastrado")];
    s.charges = [
      charge({ id: "en", kind: "energia", stationId: 1, billingAccountId: "e1", status: "pendente" }),
    ];
    const row = deriveMonthlyMatrix(s, MONTH).rows[0];
    expect(row.energy.state).toBe("aguardando_da");
    expect(row.energy.detail).toContain("débito automático");
  });

  it("rent_manual contract without a charge → cobranca_manual", () => {
    const s = empty();
    s.stations = [station(1)];
    s.contracts = [contract(1, { rentManual: true })];
    s.billingAccounts = [account("r1", 1, "rent")];
    const row = deriveMonthlyMatrix(s, MONTH).rows[0];
    expect(row.rent.state).toBe("cobranca_manual");
    expect(row.group).toBe("nenhuma"); // manual + unpaid = an obligation unmet
  });

  it("settled aluguel_energia satisfies BOTH axes", () => {
    const s = empty();
    s.stations = [station(1)];
    s.contracts = [contract(1)];
    s.billingAccounts = [account("e1", 1, "energy_enel"), account("r1", 1, "rent")];
    s.charges = [
      charge({ id: "ae", kind: "aluguel_energia", stationId: 1, billingAccountId: "r1", status: "pago" }),
    ];
    const row = deriveMonthlyMatrix(s, MONTH).rows[0];
    expect(row.energy.paid).toBe(true);
    expect(row.rent.paid).toBe(true);
    expect(row.group).toBe("ambas");
  });

  it("multi energy account: one settled one open → energy NOT paid", () => {
    const s = empty();
    s.stations = [station(1)];
    s.billingAccounts = [
      account("e1", 1, "energy_enel"),
      account("e2", 1, "energy_enel"),
    ];
    s.charges = [
      charge({ id: "en1", kind: "energia", stationId: 1, billingAccountId: "e1", status: "pago" }),
      charge({ id: "en2", kind: "energia", stationId: 1, billingAccountId: "e2", status: "pendente" }),
    ];
    const row = deriveMonthlyMatrix(s, MONTH).rows[0];
    expect(row.energy.paid).toBe(false);
    expect(row.energy.state).toBe("em_aberto");
  });
});

describe("deriveMonthlyMatrix — metrics", () => {
  it("kWh cost = amount / kWh; excludes rows with no kWh", () => {
    const s = empty();
    s.stations = [station(1), station(2)];
    s.billingAccounts = [account("e1", 1, "energy_enel"), account("e2", 2, "energy_enel")];
    s.charges = [
      charge({ id: "en1", kind: "energia", stationId: 1, billingAccountId: "e1", amount: 600, status: "pago" }),
      charge({ id: "en2", kind: "energia", stationId: 2, billingAccountId: "e2", amount: 500, status: "pago" }),
    ];
    s.chargeEnergyDetails = [energyDetails("en1", 1000)]; // station 1: 600/1000 = 0.6
    // station 2: no details, no consumption → excluded
    const m = deriveMonthlyMatrix(s, MONTH);
    expect(m.metrics.kwhCostByStation).toHaveLength(1);
    expect(m.metrics.kwhCostByStation[0].value).toBeCloseTo(0.6);
    expect(m.metrics.avgKwhCost).toBeCloseTo(0.6);
    expect(m.metrics.excludedKwh).toBe(1);
  });

  it("uses monthly consumption kWh when energyDetails absent", () => {
    const s = empty();
    s.stations = [station(1)];
    s.billingAccounts = [account("e1", 1, "energy_enel")];
    s.charges = [
      charge({ id: "en1", kind: "energia", stationId: 1, billingAccountId: "e1", amount: 400, status: "pago" }),
    ];
    s.monthlyConsumption = [consumption("e1", 800)]; // 400/800 = 0.5
    expect(deriveMonthlyMatrix(s, MONTH).metrics.avgKwhCost).toBeCloseTo(0.5);
  });

  it("box cost = rent / active_boxes; excludes null active_boxes", () => {
    const s = empty();
    s.stations = [station(1, 10), station(2, null)];
    s.contracts = [contract(1), contract(2)];
    s.billingAccounts = [account("r1", 1, "rent"), account("r2", 2, "rent")];
    s.charges = [
      charge({ id: "al1", kind: "aluguel", stationId: 1, billingAccountId: "r1", amount: 1000, status: "pago" }),
      charge({ id: "al2", kind: "aluguel", stationId: 2, billingAccountId: "r2", amount: 900, status: "pago" }),
    ];
    const m = deriveMonthlyMatrix(s, MONTH);
    expect(m.metrics.boxCostByStation).toHaveLength(1);
    expect(m.metrics.boxCostByStation[0].value).toBeCloseTo(100); // 1000/10
    expect(m.metrics.excludedBox).toBe(1);
    expect(m.metrics.rentTotal).toBe(1900);
  });

  it("only counts the requested month; a missing charge surfaces as sem_cobranca", () => {
    const s = empty();
    s.stations = [station(1)];
    s.contracts = [contract(1)];
    s.billingAccounts = [account("r1", 1, "rent")];
    s.charges = [
      charge({ id: "al1", kind: "aluguel", stationId: 1, billingAccountId: "r1", amount: 1000, status: "pago", competencia: "2026-06-01" }),
    ];
    const m = deriveMonthlyMatrix(s, MONTH);
    // the active contract still owes July rent → row present, not paid, R$0 counted
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0].rent.state).toBe("sem_cobranca");
    expect(m.rows[0].group).toBe("nenhuma");
    expect(m.metrics.rentTotal).toBe(0); // June amount excluded from July
  });
});
