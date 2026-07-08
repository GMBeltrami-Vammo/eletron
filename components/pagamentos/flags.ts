/**
 * Canonical pt-BR labels + badge colors for charge `flags` (the gerar_mes /
 * pipeline flags that replace the sheet's cell colors — see charges.flags,
 * migration 3 gerar_mes). One definition, consumed by the Gerar mês preview
 * dialog AND the ledger rows created from it. `lib/labels.ts` is committed
 * (read-only) so the flag map lives here in the owned pagamentos scope.
 */

import type { BadgeColor } from "@/components/vammo/status-badge";

type FlagBadge = { label: string; color: BadgeColor; description: string };

export const CHARGE_FLAG_UI: Record<string, FlagBadge> = {
  boxes_mismatch: {
    label: "Boxes ≠ contrato",
    color: "orange",
    description: "Boxes ativos no Metabase divergem do box_count do contrato",
  },
  pro_rata: {
    label: "Pro-rata",
    color: "blue",
    description: "Estação criada no mês — valor proporcional aos dias",
  },
  no_metabase_data: {
    label: "Sem Metabase",
    color: "red",
    description: "Sem dados de boxes ativos — usou o valor mensal do contrato",
  },
  boxes_stale: {
    label: "Boxes desatualizados",
    color: "yellow",
    description: "Contagem de boxes sincronizada há mais de 48 h",
  },
  new_station: {
    label: "Nova estação",
    color: "blue",
    description: "Estação criada no mês da competência",
  },
};

/** Preview-only pseudo-flag: a charge with this dedupe key already exists. */
export const ALREADY_EXISTS_FLAG = "already_exists";
