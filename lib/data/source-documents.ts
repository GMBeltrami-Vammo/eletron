import "server-only";

import type { DocumentKind } from "@/lib/domain";
import { getSessionEmail } from "@/lib/http/guards";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Server-only reader for the "Vincular documento" picker (feature D, Part 2b):
 * lists SOURCE-BILL documents (boleto/fatura/nota) a charge can be bound to via
 * set_charge_document. Excludes comprovante/foto_medidor/contrato (the RPC also
 * rejects those — this just keeps them out of the picker). Session-gated;
 * degrades to [] when there is no session or Supabase env (sheets/dev).
 */

/** document_kind values that are a charge's source bill (not a payment proof). */
export const SOURCE_BILL_KINDS: readonly DocumentKind[] = [
  "fatura_enel",
  "fatura_edp",
  "boleto_aluguel",
  "boleto_condominio",
  "nota_debito",
  "nfse",
  "outro",
];

export interface SourceDocumentOption {
  id: string;
  kind: DocumentKind;
  filename: string | null;
  createdAt: string | null;
  pageCount: number | null;
}

interface DocRow {
  id: string;
  kind: DocumentKind;
  original_filename: string | null;
  created_at: string | null;
  page_count: number | null;
}

function hasSupabaseEnv(): boolean {
  return (
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export async function readSourceDocuments(
  limit = 500,
): Promise<SourceDocumentOption[]> {
  const email = await getSessionEmail();
  if (!email || !hasSupabaseEnv()) return [];
  try {
    const { data } = await supabaseAdmin()
      .from("documents")
      .select("id, kind, original_filename, created_at, page_count")
      .in("kind", SOURCE_BILL_KINDS as unknown as string[])
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    return ((data ?? []) as unknown as DocRow[]).map((r) => ({
      id: r.id,
      kind: r.kind,
      filename: r.original_filename,
      createdAt: r.created_at,
      pageCount: r.page_count,
    }));
  } catch {
    return [];
  }
}
