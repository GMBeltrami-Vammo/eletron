/**
 * Monthly matrix + metrics derivation (Phase 2.5 R3, request 5). Pure over the
 * DomainSnapshot so it runs on either backend and is unit-tested independently
 * of the UI.
 *
 * Per station × competência it derives an ENERGY axis and a RENT axis, each a
 * `SideResult` (state + settled? + a "where is it stuck" detail), then buckets
 * the station into ambas/só-energia/só-aluguel/nenhuma over the APPLICABLE
 * sides (M6 decision table). `aluguel_energia` satisfies both axes.
 *
 * Metrics (M6): custo médio por kWh and custo por box, global + per station
 * with top-N, plus monthly totals. Rows with kwh ≤ 0 / active_boxes ≤ 0 / null
 * are excluded from the averages and counted separately.
 */

import type {
  Charge,
  ChargeEnergyDetails,
  ChargeLine,
  Contract,
  DomainSnapshot,
  MonthlyConsumption,
  Station,
} from "@/lib/domain";
import { SETTLED_CHARGE_STATUSES } from "@/lib/ingest/derive";

export type SideState =
  | "paga"
  | "conciliada"
  | "aguardando_da"
  | "boleto_recebido"
  | "em_aberto"
  | "sem_cobranca"
  | "cobranca_manual"
  | "gratuito"
  | "na";

export interface SideResult {
  state: SideState;
  /** Settled = pago | conciliado | antecipado. */
  paid: boolean;
  /** Does this side apply to the station at all? */
  applies: boolean;
  /** "Where is it stuck" line for the drilldown. */
  detail: string;
}

export type MonthGroup =
  | "ambas"
  | "so_energia"
  | "so_aluguel"
  | "nenhuma"
  | "sem_obrigacoes";

export interface StationMonthRow {
  stationId: number;
  stationName: string | null;
  energy: SideResult;
  rent: SideResult;
  group: MonthGroup;
  energyAmount: number | null;
  rentAmount: number | null;
}

export interface StationMetric {
  stationId: number;
  stationName: string | null;
  value: number;
}

export interface MonthlyMetrics {
  energyTotal: number;
  rentTotal: number;
  avgKwhCost: number | null;
  avgBoxCost: number | null;
  kwhCostByStation: StationMetric[]; // desc, for top-N
  boxCostByStation: StationMetric[]; // desc, for top-N
  excludedKwh: number;
  excludedBox: number;
}

export interface MonthlyMatrix {
  month: string; // 'YYYY-MM'
  rows: StationMonthRow[];
  groups: Record<MonthGroup, number>;
  metrics: MonthlyMetrics;
}


/** 'YYYY-MM-01' | null → 'YYYY-MM' | null. */
function monthOf(competencia: string | null): string | null {
  return competencia ? competencia.slice(0, 7) : null;
}

/** Sum kWh for an energy charge: energyDetails first, monthly consumption fallback. */
function kwhForCharge(
  charge: Charge,
  details: ChargeEnergyDetails | undefined,
  consumption: MonthlyConsumption | undefined,
): number | null {
  if (details) {
    const sum = (details.tusdKwh ?? 0) + (details.teKwh ?? 0);
    if (sum > 0) return sum;
  }
  if (consumption?.kwhBilled != null && consumption.kwhBilled > 0) {
    return consumption.kwhBilled;
  }
  return null;
}

/** Best (most-complete) of two side states, by rank. */
const RANK: Record<SideState, number> = {
  gratuito: 8, // satisfied (free) — outranks all, no charge competes
  paga: 7,
  conciliada: 6,
  aguardando_da: 5,
  boleto_recebido: 4,
  em_aberto: 3,
  cobranca_manual: 2,
  sem_cobranca: 1,
  na: 0,
};

function worst(a: SideState, b: SideState): SideState {
  return RANK[a] <= RANK[b] ? a : b;
}

function chargeSettled(c: Charge): boolean {
  return SETTLED_CHARGE_STATUSES.has(c.status);
}

/**
 * Energy state for ONE account in a month, given its charges + portal state.
 * "aguardando_da" = an open charge on an account whose auto-debit is
 * registered (collected, will settle automatically — request 5's distinction).
 */
function energyAccountState(
  charges: Charge[],
  autoDebitRegistered: boolean,
): SideResult {
  if (charges.length === 0) {
    return {
      state: "sem_cobranca",
      paid: false,
      applies: true,
      detail: "fatura não coletada",
    };
  }
  const settled = charges.find(chargeSettled);
  if (settled) {
    return {
      state: settled.status === "conciliado" ? "conciliada" : "paga",
      paid: true,
      applies: true,
      detail: "",
    };
  }
  const received = charges.find((c) => c.status === "boleto_recebido");
  if (received) {
    return {
      state: "boleto_recebido",
      paid: false,
      applies: true,
      detail: "fatura recebida, aguardando pagamento",
    };
  }
  // open charge
  if (autoDebitRegistered) {
    return {
      state: "aguardando_da",
      paid: false,
      applies: true,
      detail: "coletada — aguardando débito automático",
    };
  }
  return {
    state: "em_aberto",
    paid: false,
    applies: true,
    detail: "fatura em aberto (sem débito automático)",
  };
}

function rentStateFrom(
  charges: Charge[],
  contract: Contract | undefined,
): SideResult {
  // casa_vammo / gratuito: rent is free — satisfied automatically, so a "só
  // energia" month means a MISSED rent, not a free contract (Gabriel). Takes
  // precedence over any (anomalous) charge for these types.
  if (
    contract?.contractType === "casa_vammo" ||
    contract?.contractType === "gratuito"
  ) {
    return {
      state: "gratuito",
      paid: true,
      applies: true,
      detail: "contrato gratuito / casa Vammo — sem cobrança de aluguel",
    };
  }
  const manual = contract?.rentManual === true;
  if (charges.length === 0) {
    if (manual) {
      return {
        state: "cobranca_manual",
        paid: false,
        applies: true,
        detail: "cobrança manual — gerar/enviar fora do sistema",
      };
    }
    return {
      state: "sem_cobranca",
      paid: false,
      applies: true,
      detail: "aluguel não gerado para o mês",
    };
  }
  const settled = charges.find(chargeSettled);
  if (settled) {
    return {
      state: settled.status === "conciliado" ? "conciliada" : "paga",
      paid: true,
      applies: true,
      detail: "",
    };
  }
  const received = charges.find((c) => c.status === "boleto_recebido");
  if (received) {
    return {
      state: "boleto_recebido",
      paid: false,
      applies: true,
      detail: "boleto recebido, aguardando pagamento",
    };
  }
  const method = contract?.paymentMethod;
  const via =
    method === "pix"
      ? "aguardando pagamento (pix)"
      : method === "transferencia"
        ? "aguardando pagamento (transferência)"
        : method?.startsWith("boleto")
          ? "aguardando pagamento (boleto)"
          : "aluguel em aberto";
  return { state: "em_aberto", paid: false, applies: true, detail: via };
}

function groupOf(energy: SideResult, rent: SideResult): MonthGroup {
  const eApplies = energy.applies;
  const rApplies = rent.applies;
  if (!eApplies && !rApplies) return "sem_obrigacoes";
  const energyOk = !eApplies || energy.paid;
  const rentOk = !rApplies || rent.paid;
  if (energyOk && rentOk) return "ambas";
  if (energy.paid && !rentOk) return "so_energia";
  if (rent.paid && !energyOk) return "so_aluguel";
  return "nenhuma";
}

export function deriveMonthlyMatrix(
  snapshot: DomainSnapshot,
  month: string,
): MonthlyMatrix {
  const stateByAccount = new Map(
    snapshot.utilityAccountStates.map((s) => [s.billingAccountId, s]),
  );
  const detailsByCharge = new Map(
    snapshot.chargeEnergyDetails.map((d) => [d.chargeId, d]),
  );
  const linesByCharge = new Map<string, ChargeLine[]>();
  for (const l of snapshot.chargeLines) {
    const list = linesByCharge.get(l.chargeId) ?? [];
    list.push(l);
    linesByCharge.set(l.chargeId, list);
  }
  const consumptionByAccountMonth = new Map<string, MonthlyConsumption>();
  for (const m of snapshot.monthlyConsumption) {
    if (monthOf(m.competencia) === month) {
      consumptionByAccountMonth.set(m.billingAccountId, m);
    }
  }
  // active contract per station (prefer ACTIVE, else any)
  const contractByStation = new Map<number, Contract>();
  for (const c of snapshot.contracts) {
    if (c.stationId === null) continue;
    const cur = contractByStation.get(c.stationId);
    if (!cur || (c.status === "ACTIVE" && cur.status !== "ACTIVE")) {
      contractByStation.set(c.stationId, c);
    }
  }

  // month charges bucketed by station
  const chargesByStation = new Map<number, Charge[]>();
  for (const c of snapshot.charges) {
    if (monthOf(c.competencia) !== month || c.stationId === null) continue;
    const list = chargesByStation.get(c.stationId) ?? [];
    list.push(c);
    chargesByStation.set(c.stationId, list);
  }

  // energy accounts per station
  const energyAccountsByStation = new Map<number, string[]>();
  for (const a of snapshot.billingAccounts) {
    if (
      (a.accountType === "energy_enel" || a.accountType === "energy_edp") &&
      a.stationId !== null
    ) {
      const list = energyAccountsByStation.get(a.stationId) ?? [];
      list.push(a.id);
      energyAccountsByStation.set(a.stationId, list);
    }
  }

  const stationById = new Map(snapshot.stations.map((s) => [s.id, s]));
  const stationIds = new Set<number>([
    ...snapshot.stations.map((s) => s.id),
    ...chargesByStation.keys(),
  ]);

  const rows: StationMonthRow[] = [];
  const groups: Record<MonthGroup, number> = {
    ambas: 0,
    so_energia: 0,
    so_aluguel: 0,
    nenhuma: 0,
    sem_obrigacoes: 0,
  };
  const kwhCostByStation: StationMetric[] = [];
  const boxCostByStation: StationMetric[] = [];
  let energyTotal = 0;
  let rentTotal = 0;
  let excludedKwh = 0;
  let excludedBox = 0;

  for (const stationId of stationIds) {
    const station: Station | undefined = stationById.get(stationId);
    const monthCharges = chargesByStation.get(stationId) ?? [];
    const energyCharges = monthCharges.filter((c) => c.kind === "energia");
    const bundled = monthCharges.filter((c) => c.kind === "aluguel_energia");
    const rentCharges = monthCharges.filter((c) => c.kind === "aluguel");
    const energyAccounts = energyAccountsByStation.get(stationId) ?? [];
    const contract = contractByStation.get(stationId);

    // ── energy side ──
    let energy: SideResult;
    const settledBundled = bundled.find(chargeSettled);
    const hasEnergy =
      energyAccounts.length > 0 || energyCharges.length > 0 || bundled.length > 0;
    if (!hasEnergy) {
      energy = { state: "na", paid: false, applies: false, detail: "" };
    } else if (settledBundled) {
      energy = {
        state: settledBundled.status === "conciliado" ? "conciliada" : "paga",
        paid: true,
        applies: true,
        detail: "",
      };
    } else if (energyAccounts.length > 0) {
      // aggregate per-account; station paid iff ALL accounts settled
      let agg: SideResult | null = null;
      for (const accId of energyAccounts) {
        const accCharges = energyCharges.filter((c) => c.billingAccountId === accId);
        const daReg = stateByAccount.get(accId)?.autoDebit === "cadastrado";
        const res = energyAccountState(accCharges, daReg);
        agg =
          agg === null
            ? res
            : worst(agg.state, res.state) === res.state
              ? res
              : agg;
      }
      energy = agg ?? { state: "sem_cobranca", paid: false, applies: true, detail: "" };
    } else {
      // loose energy charges without a resolved account
      energy = energyAccountState(energyCharges, false);
    }

    // ── rent side ──
    const rentSourceCharges = [...rentCharges, ...bundled];
    const hasRent = contract !== undefined || rentSourceCharges.length > 0;
    let rent: SideResult;
    if (!hasRent) {
      rent = { state: "na", paid: false, applies: false, detail: "" };
    } else {
      rent = rentStateFrom(rentSourceCharges, contract);
    }

    const group = groupOf(energy, rent);
    groups[group] += 1;

    // amounts (bundled split by lines when present)
    let eAmt = 0;
    let rAmt = 0;
    let eHas = false;
    let rHas = false;
    for (const c of energyCharges) {
      if (c.amount != null) {
        eAmt += c.amount;
        eHas = true;
      }
    }
    for (const c of rentCharges) {
      if (c.amount != null) {
        rAmt += c.amount;
        rHas = true;
      }
    }
    for (const c of bundled) {
      const lines = linesByCharge.get(c.id) ?? [];
      if (lines.length > 0) {
        for (const l of lines) {
          if (l.lineKind === "energia") {
            eAmt += l.amount;
            eHas = true;
          } else {
            rAmt += l.amount;
            rHas = true;
          }
        }
      } else if (c.amount != null) {
        rAmt += c.amount;
        rHas = true;
      }
    }
    energyTotal += eAmt;
    rentTotal += rAmt;

    rows.push({
      stationId,
      stationName: station?.name ?? null,
      energy,
      rent,
      group,
      energyAmount: eHas ? eAmt : null,
      rentAmount: rHas ? rAmt : null,
    });

    // ── metrics ──
    // kWh cost: total energy kWh (from all energy charges) vs energy amount
    let kwh = 0;
    for (const c of energyCharges) {
      const accConsumption = c.billingAccountId
        ? consumptionByAccountMonth.get(c.billingAccountId)
        : undefined;
      const k = kwhForCharge(c, detailsByCharge.get(c.id), accConsumption);
      if (k != null) kwh += k;
    }
    if (eHas && kwh > 0) {
      kwhCostByStation.push({
        stationId,
        stationName: station?.name ?? null,
        value: eAmt / kwh,
      });
    } else if (eHas) {
      excludedKwh += 1;
    }

    // box cost: rent amount / current active_boxes
    const boxes = station?.activeBoxes ?? null;
    if (rHas && boxes != null && boxes > 0) {
      boxCostByStation.push({
        stationId,
        stationName: station?.name ?? null,
        value: rAmt / boxes,
      });
    } else if (rHas) {
      excludedBox += 1;
    }
  }

  kwhCostByStation.sort((a, b) => b.value - a.value);
  boxCostByStation.sort((a, b) => b.value - a.value);

  const avgKwhCost =
    kwhCostByStation.length > 0
      ? kwhCostByStation.reduce((s, m) => s + m.value, 0) / kwhCostByStation.length
      : null;
  const avgBoxCost =
    boxCostByStation.length > 0
      ? boxCostByStation.reduce((s, m) => s + m.value, 0) / boxCostByStation.length
      : null;

  // only stations with an obligation are worth showing in the matrix
  const shown = rows.filter((r) => r.group !== "sem_obrigacoes");

  return {
    month,
    rows: shown,
    groups,
    metrics: {
      energyTotal,
      rentTotal,
      avgKwhCost,
      avgBoxCost,
      kwhCostByStation,
      boxCostByStation,
      excludedKwh,
      excludedBox,
    },
  };
}
