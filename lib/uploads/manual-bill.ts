import "server-only";

/**
 * Manual energy-bill upload core — shared by the route (/api/uploads/manual-bill)
 * and the `createManualBill` server action so there is ONE canonical definition
 * (drive-comprovantes §3.3, decision #17/#20).
 *
 * Ordering (D7 — a DB row never points at a missing file):
 *   validate → resolve account → hash-dedupe → Drive upload (shareAnyoneReader,
 *   collision → `-manual-N` never overwriting the scraper's file) → insert
 *   `documents` → `create_manual_bill` RPC (C1 dedupe guard inside).
 * Phase 2.5 (sheets severed): the `sheet_writebacks` enqueue + drain that
 * followed the RPC is GONE — the DB is the only record; the Drive PDF upload
 * stays (scraper folder naming kept for continuity).
 */

import { DOCUMENT_KIND, type DocumentKind } from "@/lib/domain";
import type { ChargingClient } from "@/lib/data/supabase-repository";
import { parseBrMoney } from "@/lib/comprovantes/parse";
import { driveFolderId, findByName, uploadFile } from "@/lib/drive/client";
import { billCollisionName, buildBillPdfName } from "@/lib/drive/naming";
import { UploadError } from "@/lib/http/errors";
import type { UserClient } from "@/lib/http/guards";
import { validateUpload } from "./validate";

export interface ManualBillUploadInput {
  userClient: UserClient;
  admin: ChargingClient;
  email: string;
  fileBuffer: Buffer;
  filename: string;
  /** charging billing_account uuid (must be an energy account). */
  billingAccountId: string;
  value: number | string;
  /** ISO `YYYY-MM-DD`. */
  dueDate: string;
  /** `YYYY-MM` or `YYYY-MM-DD` (normalized to first-of-month). */
  competencia?: string | null;
  nf?: string | null;
  notes?: string | null;
  /**
   * Manual payment method (Gabriel 2026-07-17): 'da' → débito automático,
   * 'boleto' → boleto. Sets the charge's payment_method AND the per-bill DA fact
   * (charge_energy_details.auto_debit) that the fiscal send reads for column B
   * (#42). null → left unset (today's behavior; the send-freeze fills it).
   */
  metodo?: "da" | "boleto" | null;
  /** Extra Faturas detail fields for `charge_energy_details`. */
  energyDetails?: Record<string, unknown> | null;
}

/** método → the charge's payment_method + the per-bill auto_debit fact. */
function metodoFields(
  metodo: "da" | "boleto" | null | undefined,
): { payment_method: string; auto_debit: string } | null {
  if (metodo === "da") {
    return { payment_method: "debito_automatico", auto_debit: "cadastrado" };
  }
  if (metodo === "boleto") {
    return { payment_method: "boleto_email", auto_debit: "nao_cadastrado" };
  }
  return null;
}

export interface ManualBillUploadResult {
  chargeId: string;
  documentId: string;
  webViewLink: string;
  possibleDuplicate: boolean;
  warnings: string[];
}

interface AccountRow {
  account_type: string;
  enel_id: string | null;
  edp_uc: string | null;
  station_id: number | null;
  auto_debit_registration: string | null;
}

function normalizeCompetencia(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-01` : null;
}

async function resolveUploadName(
  folderId: string,
  base: string,
): Promise<{ name: string; possibleDuplicate: boolean }> {
  const hit = await findByName(folderId, base);
  if (!hit) return { name: base, possibleDuplicate: false };
  // never overwrite the scraper's file — suffix -manual-N
  for (let n = 1; n <= 50; n += 1) {
    const candidate = billCollisionName(base, n);
    if (!(await findByName(folderId, candidate))) {
      return { name: candidate, possibleDuplicate: true };
    }
  }
  return { name: billCollisionName(base, Date.now()), possibleDuplicate: true };
}

export async function createManualBillFromUpload(
  input: ManualBillUploadInput,
): Promise<ManualBillUploadResult> {
  const warnings: string[] = [];

  // 1. validate the PDF (sniff-based; content type never trusted from client)
  const validated = validateUpload(
    { buffer: input.fileBuffer, filename: input.filename, claimedMime: "application/pdf" },
    "pdf",
  );
  if (!validated.ok) throw new UploadError(validated.status, validated.error);

  const amount = parseBrMoney(String(input.value)) ?? Number(input.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new UploadError(400, "valor inválido");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) {
    throw new UploadError(400, "vencimento inválido (esperado YYYY-MM-DD)");
  }

  // 2. resolve the billing account (energy only)
  const { data: acctData, error: acctErr } = await input.admin
    .from("billing_accounts")
    .select("account_type, enel_id, edp_uc, station_id, auto_debit_registration")
    .eq("id", input.billingAccountId)
    .maybeSingle();
  if (acctErr) throw new UploadError(500, `falha ao ler a conta: ${acctErr.message}`);
  if (!acctData) throw new UploadError(404, "conta de cobrança não encontrada");
  const account = acctData as AccountRow;

  const provider: "enel" | "edp" | null =
    account.account_type === "energy_enel"
      ? "enel"
      : account.account_type === "energy_edp"
        ? "edp"
        : null;
  if (!provider) {
    throw new UploadError(422, "faturas manuais são apenas para contas de energia (Enel/EDP)");
  }
  const externalId = provider === "enel" ? account.enel_id : account.edp_uc;
  if (!externalId) {
    throw new UploadError(422, `conta sem ${provider === "enel" ? "enel_id" : "edp_uc"}`);
  }

  const sha = validated.sha256;

  // 3. hash-dedupe: reuse an existing document row + Drive file if bytes match
  const { data: existingDoc } = await input.admin
    .from("documents")
    .select("id, drive_file_id, web_view_link")
    .eq("content_hash", sha)
    .maybeSingle();

  let documentId: string;
  let webViewLink: string;
  let possibleDuplicate = false;

  if (existingDoc) {
    const d = existingDoc as { id: string; drive_file_id: string; web_view_link: string | null };
    documentId = d.id;
    webViewLink = d.web_view_link ?? "";
    warnings.push("PDF idêntico já enviado antes — arquivo reaproveitado");
  } else {
    // 4. Drive upload (shareAnyoneReader — scraper parity for the =HYPERLINK)
    const folderId = driveFolderId("bills");
    const base = buildBillPdfName(provider, externalId, input.dueDate);
    const resolved = await resolveUploadName(folderId, base);
    possibleDuplicate = resolved.possibleDuplicate;
    if (possibleDuplicate) {
      warnings.push("uma fatura com esse nome já existe no Drive — enviada como -manual-N");
    }
    const uploaded = await uploadFile({
      folderId,
      name: resolved.name,
      mimeType: "application/pdf",
      buffer: input.fileBuffer,
      shareAnyoneReader: true,
    });
    webViewLink = uploaded.webViewLink;

    // 5. insert the documents row
    const kind: DocumentKind =
      provider === "enel" ? DOCUMENT_KIND.faturaEnel : DOCUMENT_KIND.faturaEdp;
    const { data: docIns, error: docErr } = await input.admin
      .from("documents")
      .insert({
        kind,
        source: "manual",
        drive_file_id: uploaded.fileId,
        drive_folder_kind: "bills",
        web_view_link: webViewLink,
        original_filename: input.filename,
        content_hash: sha,
        mime_type: "application/pdf",
        byte_size: input.fileBuffer.length,
        processing_status: "processed",
        uploaded_by_email: input.email,
      })
      .select("id")
      .single();
    if (docErr) throw new UploadError(500, `falha ao registrar o documento: ${docErr.message}`);
    documentId = (docIns as { id: string }).id;
  }

  // 6. create_manual_bill RPC (C1 dedupe guard raises pt-BR on duplicate)
  const metodo = metodoFields(input.metodo);
  const energyDetails = {
    nf: input.nf ?? null,
    auto_debit_registration: account.auto_debit_registration ?? null,
    fatura_drive_url: webViewLink,
    ...(metodo ?? {}),
    ...(input.energyDetails ?? {}),
  };
  const { data: chargeData, error: rpcErr } = await input.userClient.rpc(
    "create_manual_bill",
    {
      p_billing_account_id: input.billingAccountId,
      p_competencia: normalizeCompetencia(input.competencia),
      p_due_date: input.dueDate,
      p_amount: amount,
      p_document_id: documentId,
      p_nf: input.nf ?? null,
      p_energy_details: energyDetails,
      p_notes: input.notes ?? null,
    },
  );
  if (rpcErr) {
    // C1 duplicate → 409; other guard failures → 422
    const dup = /já existe/i.test(rpcErr.message);
    throw new UploadError(dup ? 409 : 422, rpcErr.message);
  }
  const chargeId = chargeData as string;

  return { chargeId, documentId, webViewLink, possibleDuplicate, warnings };
}
