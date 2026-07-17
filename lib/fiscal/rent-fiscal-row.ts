/**
 * Pure rent/boleto fiscal-row construction (decision #65) — the WRITE-side row
 * for sending an approved boleto to the FISCAL sheet. DORMANT: the orchestrator
 * (send-rent-fiscal.ts) is flag-gated OFF, so nothing is written yet. NO
 * `server-only`, no I/O → unit-testable; the exact format is pinned by tests.
 *
 * Layout (11 columns, Gabriel 2026-07-17). One row PER STATION — a multi-station
 * ND repeats the document link across its rows (the caller emits one input per
 * charge). Column B is always "Boletos outros bancos" (a rent/boleto is never
 * débito automático). The category/COGS pair (cols H, I) depends on the kind:
 *   aluguel         → 402 Cabinets Real Estate
 *   energia         → 401 Electricity
 *   aluguel_energia → the Rateio split in BOTH H and I; rent = the contract
 *                     valor_mensal, energia = total − rent (Gabriel).
 */

export const RENT_FISCAL_STATUS =
  "Enviada via Eletron - Aguardando validaçao Fiscal";
const RENT_COLUMN_B = "Boletos outros bancos";
const CAT_RENT = "402: Charging Infra/Energy: Cabinets Real Estate";
const COGS_RENT = "COGS - 402: Charging Infra/Energy: Cabinets Real Estate";
const CAT_ENERGY = "401: Charging Infra/Energy: Electricity";
const COGS_ENERGY = "COGS - 401: Charging Infra/Energy: Electricity";

export type RentFiscalKind = "aluguel" | "energia" | "aluguel_energia";

/** 1020 → "1.020,00" (pt-BR: '.' thousands, ',' cents — per the sample). */
export function formatValorBRThousands(n: number): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** 'YYYY-MM-DD' | 'YYYY-MM' → 'MM/YYYY' for the description (empty when null). */
export function competenciaLabelBR(competencia: string | null): string {
  if (!competencia) return "";
  const m = /^(\d{4})-(\d{2})/.exec(competencia);
  return m ? `${m[2]}/${m[1]}` : competencia;
}

export interface RentFiscalRowInput {
  kind: RentFiscalKind;
  /** Send date, DD/MM/YYYY. */
  dateSent: string;
  /** Counterparty razão social. */
  parceiro: string;
  /** Total charge amount (energia+aluguel for the combined case). */
  valorTotal: number;
  notaFiscal: string;
  /** 'YYYY-MM(-01)' | null. */
  competencia: string | null;
  /** Station address. */
  endereco: string;
  /** Due date, DD/MM/YYYY. */
  dueDate: string;
  documentUrl: string;
  /**
   * For `aluguel_energia`: the rent portion = the station's contract
   * valor_mensal; energia = valorTotal − this. Ignored for the other kinds.
   */
  contractRentAmount?: number | null;
}

/** "Rateio CC401 Energia R$ 3.985,20 (80%) CC402 Aluguel R$ 1.020,00 (20%)". */
export function buildRateioLabel(energy: number, rent: number): string {
  const total = energy + rent;
  const pct = (part: number) =>
    total > 0 ? Math.round((part / total) * 100) : 0;
  return (
    `Rateio CC401 Energia R$ ${formatValorBRThousands(energy)} (${pct(energy)}%) ` +
    `CC402 Aluguel R$ ${formatValorBRThousands(rent)} (${pct(rent)}%)`
  );
}

/** The category/COGS pair (cols H, I) for the charge kind. */
export function fiscalCategoryPair(input: RentFiscalRowInput): {
  category: string;
  cogs: string;
} {
  if (input.kind === "energia") {
    return { category: CAT_ENERGY, cogs: COGS_ENERGY };
  }
  if (input.kind === "aluguel_energia") {
    const rent = input.contractRentAmount ?? 0;
    const energy = input.valorTotal - rent;
    const rateio = buildRateioLabel(energy, rent);
    return { category: rateio, cogs: rateio };
  }
  return { category: CAT_RENT, cogs: COGS_RENT };
}

/** Builds the 11-column rent/boleto fiscal row. `sep` = ';' on a pt-BR sheet. */
export function buildRentFiscalRow(
  input: RentFiscalRowInput,
  sep: ";" | "," = ";",
): string[] {
  const { category, cogs } = fiscalCategoryPair(input);
  const descricao = `Aluguel - Mensalidade Box Vammo - ${competenciaLabelBR(
    input.competencia,
  )} - ${input.endereco}`;
  const link = input.documentUrl
    ? `=HYPERLINK("${input.documentUrl}"${sep}"Documento")`
    : "Documento";
  return [
    input.dateSent, // A
    RENT_COLUMN_B, // B
    input.parceiro, // C
    formatValorBRThousands(input.valorTotal), // D
    input.notaFiscal, // E
    descricao, // F
    input.dueDate, // G
    category, // H
    cogs, // I
    link, // J
    RENT_FISCAL_STATUS, // K
  ];
}
