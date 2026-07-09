import "server-only";

/**
 * Contract-intake review reader (Q10): every `charging.contract_intake` row
 * left `status='pending'` by the n8n webhook. Reads directly from `charging`
 * (the DomainSnapshot doesn't carry intakes), degrading to an empty queue when
 * Supabase env is absent (sheets/dev backend).
 *
 * Each row carries the raw AI extraction mapped to typed prefill defaults
 * (contractIntakePrefill) so the confirm dialog opens pre-filled. Also returns
 * the station option list the dialog's picker needs (decision #28 — the app
 * attaches to existing stations, never creates them).
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  contractIntakePrefill,
  type ContractIntakePrefill,
} from "@/lib/ingest/contratos";

export interface StationOption {
  id: number;
  name: string | null;
}

export interface ContratoIntakeRow extends ContractIntakePrefill {
  id: string;
  documentId: string | null;
  driveFileId: string | null;
  webViewLink: string | null;
  nomeArquivo: string | null;
  createdAt: string;
}

export interface ContratoQueueData {
  available: boolean;
  rows: ContratoIntakeRow[];
  stations: StationOption[];
}

const EMPTY: ContratoQueueData = { available: false, rows: [], stations: [] };
const PAGE = 1000;

interface Pageable {
  range(
    from: number,
    to: number,
  ): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
}
async function readAll<T>(build: () => unknown): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await (build() as Pageable).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

interface IntakeRow {
  id: string;
  document_id: string | null;
  drive_file_id: string | null;
  web_view_link: string | null;
  nome_arquivo: string | null;
  ai_extraction: Record<string, unknown> | null;
  created_at: string;
}

export async function readContratoQueue(): Promise<ContratoQueueData> {
  try {
    const admin = supabaseAdmin();

    const intakes = await readAll<IntakeRow>(() =>
      admin
        .from("contract_intake")
        .select("id, document_id, drive_file_id, web_view_link, nome_arquivo, ai_extraction, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    );

    const stationRows = await readAll<{ id: number; name: string | null }>(() =>
      admin.from("stations").select("id, name").order("id"),
    );
    const stations: StationOption[] = stationRows.map((s) => ({ id: s.id, name: s.name }));

    const rows: ContratoIntakeRow[] = intakes.map((i) => ({
      ...contractIntakePrefill(i.ai_extraction ?? {}),
      id: i.id,
      documentId: i.document_id,
      driveFileId: i.drive_file_id,
      webViewLink: i.web_view_link,
      nomeArquivo: i.nome_arquivo,
      createdAt: i.created_at,
    }));

    return { available: true, rows, stations };
  } catch {
    return EMPTY;
  }
}

/** Count of pending intakes for the /revisao hub + sidebar badge. Never throws. */
export async function countPendingContractIntakes(): Promise<number> {
  try {
    const admin = supabaseAdmin();
    const { count, error } = await admin
      .from("contract_intake")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}
