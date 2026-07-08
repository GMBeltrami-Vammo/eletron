/**
 * Canonical pt-BR labels + badge colors for every domain enum.
 * ONE definition per concept (workspace rule) — every screen imports from
 * here; no screen defines its own status→color mapping.
 *
 * Badge colors follow the convention documented in
 * components/vammo/status-badge.tsx.
 */

import type { BadgeColor } from "@/components/vammo/status-badge";
import type {
  AccountType,
  AutoDebitStatus,
  ChargeKind,
  ChargeStatus,
  ContractType,
  MatchStatus,
  PaymentMethod,
  StationStatus,
  UtilityBillStatus,
} from "@/lib/domain";

type LabelBadge = { label: string; color: BadgeColor };

export const STATION_STATUS_UI: Record<StationStatus, LabelBadge> = {
  ACTIVE: { label: "Ativa", color: "green" },
  INACTIVE: { label: "Inativa", color: "grey" },
  DECOMMISSIONED: { label: "Descomissionada", color: "black" },
  PRE_INSTALLATION: { label: "Pré-instalação", color: "blue" },
};

export const UTILITY_BILL_STATUS_UI: Record<UtilityBillStatus, LabelBadge> = {
  vencida: { label: "Vencida", color: "red" },
  pendente: { label: "Pendente", color: "yellow" },
  a_vencer: { label: "A vencer", color: "blue" },
  em_compensacao: { label: "Em compensação", color: "grey" },
  fatura_negociada: { label: "Negociada", color: "orange" },
  sem_contas: { label: "Sem contas", color: "grey" },
  paga: { label: "Paga", color: "green" },
  na: { label: "N/A", color: "white" },
};

/** Severity order for worst-of rollups (index 0 = worst). */
export const UTILITY_BILL_STATUS_SEVERITY: UtilityBillStatus[] = [
  "vencida",
  "pendente",
  "a_vencer",
  "em_compensacao",
  "fatura_negociada",
  "sem_contas",
  "paga",
  "na",
];

export const CHARGE_STATUS_UI: Record<ChargeStatus, LabelBadge> = {
  pago: { label: "Pago", color: "green" },
  pendente: { label: "Pendente", color: "yellow" },
  boleto_recebido: { label: "Boleto recebido", color: "blue" },
  conciliado: { label: "Conciliado", color: "blue" },
  atrasado: { label: "Atrasado", color: "red" },
  antecipado: { label: "Antecipado", color: "dark-green" },
  em_compensacao: { label: "Em compensação", color: "grey" },
  negociada: { label: "Negociada", color: "orange" },
  cancelada: { label: "Cancelada", color: "black" },
  nao_aplicavel: { label: "N/A", color: "white" },
};

export const CHARGE_KIND_UI: Record<ChargeKind, LabelBadge> = {
  aluguel: { label: "Aluguel", color: "blue" },
  energia: { label: "Energia", color: "yellow" },
  aluguel_energia: { label: "Aluguel + Energia", color: "orange" },
};

export const CONTRACT_TYPE_UI: Record<ContractType, LabelBadge> = {
  por_box: { label: "Por box", color: "blue" },
  fixo: { label: "Fixo", color: "grey" },
  por_box_minimo: { label: "Por box c/ mínimo", color: "brown" },
  gratuito: { label: "Gratuito", color: "dark-green" },
  casa_vammo: { label: "Casa Vammo", color: "black" },
};

export const AUTO_DEBIT_UI: Record<AutoDebitStatus | "parcial", LabelBadge> = {
  cadastrado: { label: "Cadastrado", color: "green" },
  nao_cadastrado: { label: "Não cadastrado", color: "red" },
  parcial: { label: "Parcial", color: "orange" },
  desconhecido: { label: "—", color: "grey" },
};

export const ACCOUNT_TYPE_UI: Record<AccountType, LabelBadge> = {
  energy_enel: { label: "Enel", color: "blue" },
  energy_edp: { label: "EDP", color: "dark-green" },
  rent: { label: "Aluguel", color: "grey" },
  third_party: { label: "Terceiro", color: "brown" },
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  pix: "Pix",
  boleto_celular: "Boleto (celular)",
  boleto_email: "Boleto (e-mail)",
  transferencia: "Transferência",
  debito_automatico: "Débito automático",
  outro: "Outro",
};

export const MATCH_STATUS_UI: Record<MatchStatus, LabelBadge> = {
  auto_matched: { label: "Vinculada (auto)", color: "green" },
  manually_matched: { label: "Vinculada (manual)", color: "dark-green" },
  unmatched: { label: "Não vinculada", color: "red" },
  needs_review: { label: "Revisar", color: "orange" },
  rejected: { label: "Rejeitada", color: "black" },
  superseded: { label: "Substituída", color: "grey" },
};

/** Alert categories (derive.ts rules) → pt-BR label + severity color. */
export const ALERT_TYPE_UI: Record<string, LabelBadge & { description: string }> = {
  overdue_bill: {
    label: "Faturas vencidas",
    color: "red",
    description: "Faturas de energia com status Vencida",
  },
  due_soon_no_auto_debit: {
    label: "Vence em 7 dias sem DA",
    color: "orange",
    description: "Vencimento próximo sem débito automático cadastrado",
  },
  no_auto_debit: {
    label: "Sem débito automático",
    color: "yellow",
    description: "Instalações ativas sem débito automático",
  },
  scraper_stale: {
    label: "Scraper parado",
    color: "yellow",
    description: "Sem coleta entre 3 e 30 dias — scraper quebrado ou estação removida",
  },
  new_installation: {
    label: "Novas instalações",
    color: "blue",
    description: "Instalações vistas pela primeira vez há menos de 3 dias",
  },
  negotiated_invoice: {
    label: "Faturas negociadas",
    color: "orange",
    description: "Negociações no mês atual ou anterior",
  },
  scheduled_shutdown: {
    label: "Desligamentos programados",
    color: "orange",
    description: "Desligamentos Enel nos próximos 7 dias",
  },
  station_without_contract: {
    label: "Estação sem contrato",
    color: "red",
    description: "Estação ativa no Metabase sem cadastro de locação",
  },
  contract_without_station: {
    label: "Contrato sem estação",
    color: "orange",
    description: "Cadastro cuja estação não existe mais",
  },
};

/**
 * Canonical UI strings for the Faturas `fiscal_exported` flag (sheet
 * "Financeiro Check"). It means "exported to the FISCAL spreadsheet", NOT paid
 * (decision #21) — the label must never suggest payment.
 */
export const FISCAL_EXPORT_UI = {
  header: "Enviado ao fiscal",
  tooltip: "Exportado à planilha fiscal — não significa pago",
  yes: "Enviado ao fiscal",
  no: "Não enviado ao fiscal",
} as const;
