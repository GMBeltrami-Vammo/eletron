import { StatusBadge } from "@/components/vammo/status-badge";
import { formatBRL } from "@/lib/format";
import type { Contract } from "@/lib/domain";

/**
 * Shared helpers for the /alugueis screens (list + detail). Pure functions +
 * one presentational chip — no hooks, safe on server and client.
 */

/** Human summary of the pricing modality ("Por box c/ mínimo: MAX(3; 2) × R$ 400"). */
export function contractFormulaSummary(
  contract: Pick<
    Contract,
    "contractType" | "boxCount" | "minBox" | "valorPorBox" | "valorMensal"
  >,
): string | null {
  const { contractType, boxCount, minBox, valorPorBox } = contract;
  switch (contractType) {
    case "por_box":
      return `${boxCount ?? "?"} box × ${formatBRL(valorPorBox)}`;
    case "por_box_minimo":
      return `MAX(${minBox ?? "?"}; ${boxCount ?? "?"}) × ${formatBRL(valorPorBox)}`;
    case "fixo":
      return "Valor fixo mensal";
    case "gratuito":
      return "Sem cobrança de aluguel";
    case "casa_vammo":
      return "Imóvel Vammo — sem aluguel";
    default:
      return null;
  }
}

export interface ContractEndInfo {
  /** Whole calendar months until endsOn (negative when past). */
  monthsToEnd: number;
  isPast: boolean;
}

/**
 * Compute end-of-contract proximity ON THE SERVER (pass the result to client
 * components as plain data — avoids hydration drift from re-reading the clock).
 */
export function contractEndInfo(
  endsOn: string | null,
  now: Date,
): ContractEndInfo | null {
  if (!endsOn) return null;
  const [datePart] = endsOn.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  if (!y || !m || !d) return null;
  const monthsToEnd =
    (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth());
  const end = new Date(y, m - 1, d, 23, 59, 59);
  return { monthsToEnd, isPast: end.getTime() < now.getTime() };
}

/** Orange "vence em X meses" chip (≤6 months), red "Vencido" when past. */
export function EndsChip({ info }: { info: ContractEndInfo | null }) {
  if (info === null) return null;
  if (info.isPast) return <StatusBadge color="red">Vencido</StatusBadge>;
  if (info.monthsToEnd > 6) return null;
  const label =
    info.monthsToEnd <= 0
      ? "Vence este mês"
      : `Vence em ${info.monthsToEnd} ${info.monthsToEnd === 1 ? "mês" : "meses"}`;
  return <StatusBadge color="orange">{label}</StatusBadge>;
}

/** Mask everything but the last 4 characters ("•••• 0001"). */
export function maskTail(value: string | null | undefined): string {
  if (!value) return "—";
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "••••";
  return `•••• ${trimmed.slice(-4)}`;
}

/** Display formatting for an already-normalized digits-only CNPJ/CPF. */
export function formatCnpjCpf(digits: string | null | undefined): string {
  if (!digits) return "—";
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  return digits;
}

/** Label/value row for the detail cards (wrap in a <dl>). */
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}
