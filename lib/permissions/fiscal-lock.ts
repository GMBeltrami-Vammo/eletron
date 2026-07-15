/**
 * Fiscal-lock + roles-per-action scaffolding (#24, Gabriel 2026-07-14).
 *
 * A charge already "enviada ao fiscal" (fiscalExported, Ciclo ≥ 3) is a
 * SENSITIVE edit: the FISCAL sheet already carries it, so re-pricing / re-dating
 * / re-classifying it can desync the two. The UI therefore WARNS before any such
 * edit — "só heads podem aprovar esta alteração".
 *
 * Enforcement is SCAFFOLDED, not active: roles are suspended (decision #26), so
 * in this test environment any @vammo.com may proceed after acknowledging the
 * warning, and the change is still fully audited by the underlying RPC (flags
 * are append-only, nothing is ever lost). The two functions below are the single
 * RESTORATION POINT — when the `head` role exists, make `viewerCanApproveFiscalEdit`
 * read it (viewer.role === "head") and the confirm button becomes a real gate.
 */

/** Roles the app recognizes per action (only `head` gates fiscal edits today). */
export type ActionRole = "operator" | "head";

export interface FiscalLockable {
  fiscalExported: boolean;
}

/** True once the charge has been exported to the FISCAL sheet (#21/#40/#42). */
export function isFiscalLocked(row: FiscalLockable): boolean {
  return row.fiscalExported === true;
}

/**
 * The role a given action requires WHEN the charge is fiscal-locked. Editing a
 * fiscal-exported charge needs `head`; everything else is `operator`. Kept as a
 * map so new head-gated actions are declared in one place.
 */
export const FISCAL_LOCKED_ACTION_ROLE: Record<string, ActionRole> = {
  registrar_pagamento: "head",
  confirmar_pagamento: "head",
  ajustar: "head",
  reclassificar: "head",
  mudar_status: "head",
  vincular_documento: "head",
  desvincular_documento: "head",
  editar: "head",
};

export const FISCAL_LOCK_TITLE = "Cobrança já enviada ao fiscal";
export const FISCAL_LOCK_MESSAGE =
  "Esta cobrança já foi enviada ao fiscal. Quando os papéis forem restaurados, " +
  "alterá-la exigirá aprovação de um head — a planilha fiscal já a contém e a " +
  "mudança precisa ser reconciliada. No ambiente de teste você pode prosseguir; " +
  "a alteração fica registrada na auditoria.";

/**
 * Whether the current viewer may approve a fiscal-locked edit. TEST ENV: always
 * true (roles suspended, #26). RESTORATION POINT — replace with a real check
 * (e.g. `viewer.role === "head"`) to actually enforce head-only approval.
 */
export function viewerCanApproveFiscalEdit(): boolean {
  return true;
}
