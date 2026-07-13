import "server-only";

/**
 * Bulk resolve contracts' Postgres uuid + inactivated_on, keyed by cadastro_id,
 * for the /alugueis list "Contrato Ativo" toggle (#51). The domain Contract.id
 * is synthetic (`contract:{cadastro_id}`), so the uuid-typed set_contract_active
 * RPC needs the real id. Degrades to an empty map without Supabase env
 * (sheets/dev) — the toggle then renders read-only. Contracts without a
 * cadastro_id (app-created) are not keyable here and fall back to read-only.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export interface ContractListRef {
  uuid: string;
  inactivatedOn: string | null;
}

const PAGE = 1000;

export async function readContractRefs(): Promise<Map<number, ContractListRef>> {
  const out = new Map<number, ContractListRef>();
  try {
    const admin = supabaseAdmin();
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from("contracts")
        .select("id, cadastro_id, inactivated_on")
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) return out;
      const rows = (data ?? []) as {
        id: string;
        cadastro_id: number | null;
        inactivated_on: string | null;
      }[];
      for (const r of rows) {
        if (r.cadastro_id !== null) {
          out.set(r.cadastro_id, { uuid: r.id, inactivatedOn: r.inactivated_on });
        }
      }
      if (rows.length < PAGE) break;
    }
  } catch {
    return out;
  }
  return out;
}
