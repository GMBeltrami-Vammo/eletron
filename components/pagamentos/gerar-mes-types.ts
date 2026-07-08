/**
 * Plain, JSON-serializable shapes for the Gerar mês preview. Computed
 * server-side (app/(app)/pagamentos/gerar-mes-projection.ts, mirroring the
 * gerar_mes RPC) and rendered client-side (gerar-mes-dialog.tsx) — so both the
 * server action and the dialog import these types, never the server module.
 */

import type { ContractType } from "@/lib/domain";

/** One contract the RPC would bill (or skip because it already exists). */
export interface GerarMesPreviewRow {
  /** dedupe_key the RPC would use (`pag:{cadastro|uuid}:{YYYY-MM}:aluguel`). */
  dedupeKey: string;
  cadastroId: number | null;
  stationId: number | null;
  stationName: string | null;
  contractType: ContractType;
  /** Calculated amount (BRL), already rounded like the RPC. */
  amount: number;
  /** Rendered formula, e.g. "Por box c/ mínimo: MAX(3; 2) × R$ 400,00 = R$ 1.200,00". */
  formula: string;
  /** Raw flag keys (see components/pagamentos/flags.ts). */
  flags: string[];
  /** True when a charge with this dedupe key already exists → RPC skips it. */
  alreadyExists: boolean;
}

/** One contract the RPC would NOT touch, with a human reason (collapsible). */
export interface GerarMesSkippedRow {
  cadastroId: number | null;
  stationId: number | null;
  stationName: string | null;
  contractType: ContractType | null;
  reason: string;
}

export interface GerarMesProjection {
  /** Competência first-of-month, `YYYY-MM-01`. */
  competencia: string;
  rows: GerarMesPreviewRow[];
  skipped: GerarMesSkippedRow[];
  /** Rows that would actually be created (alreadyExists === false). */
  toCreateCount: number;
  toCreateTotal: number;
  alreadyExistsCount: number;
  flaggedCount: number;
}
