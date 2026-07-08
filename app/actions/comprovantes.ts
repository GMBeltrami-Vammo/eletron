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
import { withOperator, type ActionResult } from "@/lib/http/actions";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  createManualBillFromUpload,
  type ManualBillUploadResult,
} from "@/lib/uploads/manual-bill";

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
