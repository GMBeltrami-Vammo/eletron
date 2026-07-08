import "server-only";

/**
 * Resolves a contract's Postgres uuid + current rent_manual flag from its
 * cadastro_id, so the contract page's alteration controls (cancel_contract,
 * set_rent_manual) can call the uuid-typed RPCs. Degrades to null when
 * Supabase env is absent (sheets/dev) — the page then hides the controls.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export interface ContractRef {
  uuid: string;
  rentManual: boolean;
  status: string | null;
}

export async function readContractRef(cadastroId: number): Promise<ContractRef | null> {
  try {
    const { data, error } = await supabaseAdmin()
      .from("contracts")
      .select("id, rent_manual, status")
      .eq("cadastro_id", cadastroId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { id: string; rent_manual: boolean | null; status: string | null };
    return { uuid: row.id, rentManual: row.rent_manual ?? false, status: row.status };
  } catch {
    return null;
  }
}
