"use server";

/**
 * Manual-bill action — the form-action counterpart of
 * `POST /api/uploads/manual-bill`, sharing the same core
 * (`createManualBillFromUpload`): validate → Drive upload → `create_manual_bill`
 * RPC → enqueue + drain the sheet writeback. Accepts a `FormData` (Next server
 * actions receive `File` fields natively).
 */

import { revalidatePath } from "next/cache";

import { revalidateSnapshot } from "@/lib/data/repository.server";
import { unwrapRpc, withOperator, type ActionResult } from "@/lib/http/actions";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { processComprovanteDocument } from "@/lib/comprovantes/pipeline";
import { deleteFile } from "@/lib/drive/client";
import {
  createManualBillFromUpload,
  type ManualBillUploadResult,
} from "@/lib/uploads/manual-bill";

const PAGES_BUCKET = "comprovante_pages";

export interface ResetComprovantesResult {
  charges_reset: number;
  payments_deleted: number;
  pages_deleted: number;
  receipts_deleted: number;
  documents_deleted: number;
}

/**
 * Fields: `file` (PDF), `billingAccountId` (energy account uuid), `value`,
 * `dueDate` (YYYY-MM-DD), optional `competencia`, `nf`, `notes`.
 */
export async function createManualBill(
  formData: FormData,
): Promise<ActionResult<ManualBillUploadResult>> {
  return withOperator(async (client, email) => {
    const file = formData.get("file");
    if (!(file instanceof File)) throw new Error("arquivo ausente");
    const billingAccountId = String(formData.get("billingAccountId") ?? "");
    const value = String(formData.get("value") ?? "");
    const dueDate = String(formData.get("dueDate") ?? "");
    if (!billingAccountId || !value || !dueDate) {
      throw new Error("billingAccountId, value e dueDate são obrigatórios");
    }
    const result = await createManualBillFromUpload({
      userClient: client,
      admin: supabaseAdmin(),
      email,
      fileBuffer: Buffer.from(await file.arrayBuffer()),
      filename: file.name,
      billingAccountId,
      value,
      dueDate,
      competencia: formData.get("competencia") ? String(formData.get("competencia")) : null,
      nf: formData.get("nf") ? String(formData.get("nf")) : null,
      notes: formData.get("notes") ? String(formData.get("notes")) : null,
    });
    revalidatePath("/energia");
    revalidatePath("/pagamentos");
    await revalidateSnapshot();
    return result;
  });
}

/**
 * Re-runs the extraction/match pipeline on a document (the inbox / deep-dive
 * "Reprocessar" control for stuck-pending or failed docs). Idempotent — safe to
 * re-run; receipts upsert and payments are unique. Operator-gated; the pipeline
 * itself writes with the service role.
 */
export async function reprocessComprovante(
  documentId: string,
): Promise<ActionResult<{ receipts: number; auto: number; review: number }>> {
  return withOperator(async () => {
    const result = await processComprovanteDocument(documentId, supabaseAdmin());
    revalidatePath("/comprovantes");
    revalidatePath(`/comprovantes/${documentId}`);
    revalidatePath("/revisao/comprovantes");
    return result;
  });
}

/**
 * Resets ALL comprovante state so the cold clone can re-run the matching stress
 * test (Gabriel 2026-07-10). Unbinds every comprovante-backed payment, walks
 * comprovante-driven `pago` charges back to open (sync/portal `pago` preserved),
 * deletes the parsed receipts + isolated per-page rows + the comprovante
 * `documents` rows (RPC), then best-effort purges the per-page Storage bucket
 * and the whole-PDF Drive files so a re-drop of the same PDFs starts clean.
 * DESTRUCTIVE — the inbox surfaces it behind an explicit confirmation.
 */
export async function resetComprovanteMatches(): Promise<
  ActionResult<ResetComprovantesResult>
> {
  return withOperator(async (client) => {
    const admin = supabaseAdmin();

    // Drive file ids must be read BEFORE the RPC deletes the document rows.
    const { data: docs } = await admin
      .from("documents")
      .select("id, drive_file_id")
      .eq("kind", "comprovante");
    const driveDocs = (docs ?? []) as { id: string; drive_file_id: string | null }[];

    const summary = unwrapRpc(
      await client.rpc("reset_comprovante_matches"),
    ) as ResetComprovantesResult;

    // Purge the isolated per-page PDFs (best-effort, per document prefix).
    for (const d of driveDocs) {
      try {
        const { data: objs } = await admin.storage.from(PAGES_BUCKET).list(d.id);
        const paths = (objs ?? []).map((o) => `${d.id}/${o.name}`);
        if (paths.length > 0) await admin.storage.from(PAGES_BUCKET).remove(paths);
      } catch {
        /* best-effort */
      }
    }

    // Delete the whole-PDF Drive archives (best-effort).
    for (const d of driveDocs) {
      if (!d.drive_file_id) continue;
      try {
        await deleteFile(d.drive_file_id);
      } catch {
        /* best-effort */
      }
    }

    revalidatePath("/comprovantes");
    revalidatePath("/revisao/comprovantes");
    revalidatePath("/pagamentos");
    revalidatePath("/energia");
    await revalidateSnapshot();
    return summary;
  });
}

/**
 * Marks an unmatched/needs-review receipt as "não é comprovante" (rejected), so
 * it stops surfacing in the review queue. Refuses if payments are allocated.
 */
export async function rejectReceipt(
  receiptId: string,
  reason: string,
): Promise<ActionResult<void>> {
  return withOperator(async (client) => {
    unwrapRpc(
      await client.rpc("reject_receipt", {
        p_receipt_id: receiptId,
        p_reason: reason,
      }),
    );
    revalidatePath("/revisao/comprovantes");
    revalidatePath("/comprovantes");
  });
}
