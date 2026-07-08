"use server";

/**
 * Gerar mês server actions. `previewGerarMes` runs the read-side A5 projection
 * (no writes) so the dialog shows a before-write gate; the confirm step calls
 * the committed `gerarMes` RPC action (app/actions/charges.ts). Operator-gated
 * here as a UX pre-check — the RPC re-checks inside Postgres.
 *
 * Colocated under components/pagamentos (not the (app) route group) so the
 * client dialog imports it without a route-group parenthesis in the specifier.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getViewer } from "@/components/admin/viewer";
import type { ActionResult } from "@/lib/http/actions";
import type { GerarMesProjection } from "./gerar-mes-types";
import { computeGerarMesProjection, monthStart } from "./gerar-mes-projection";

export async function previewGerarMes(input: {
  competencia: string;
}): Promise<ActionResult<GerarMesProjection>> {
  const viewer = await getViewer();
  if (!viewer.email) return { ok: false, error: "não autenticado" };
  if (viewer.role === null) {
    return { ok: false, error: "permissão de operador necessária" };
  }
  if (!viewer.supabaseConfigured) {
    return { ok: false, error: "Supabase não configurado neste ambiente" };
  }
  try {
    const projection = await computeGerarMesProjection(
      supabaseAdmin(),
      monthStart(input.competencia),
    );
    return { ok: true, data: projection };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
