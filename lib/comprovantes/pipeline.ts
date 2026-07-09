import "server-only";

/**
 * Comprovante pipeline (service-role). Idempotent orchestration:
 *   download (Drive) → encrypted/empty guards → extract (unpdf) → parse →
 *   upsert receipts on (document_id, page_number, segment_index) → match each
 *   against OPEN charges → on `auto`: insert payment(source='auto_match') + flip
 *   the charge OPEN→'pago' (status_source='rpc', H2) + audit; on
 *   `ambiguous`/`none`: mark the receipt needs_review.
 *
 * A linked comprovante (auto-match here, or manual via `record_payment`) is
 * treated as PAID — deterministic no-AI matching is trusted, so an auto-match
 * flips the charge straight to 'pago' (amends decisions #8/#24's "auto-match →
 * conciliado, await human confirm"). `confirm_charge` remains the path for any
 * legacy 'conciliado' rows. Re-running is safe: receipts are upserted, payments
 * are UNIQUE (charge_id, receipt_id), and the flip only fires from an OPEN
 * status. Never throws for expected failures — sets `documents.processing_status`
 * and returns a summary.
 */

import {
  DOC_PROCESSING_STATUS,
  PAYMENT_METHOD,
  RECEIPT_TYPE,
  type DocProcessingStatus,
  type MatchStatus,
  type PaymentMethod,
  type ReceiptType,
} from "@/lib/domain";
import { num, type ChargingClient } from "@/lib/data/supabase-repository";
import { downloadFile } from "@/lib/drive/client";
import { matchReceipt } from "./match";
import { parseComprovantePages } from "./parse";
import {
  extractPdfText,
  hasNoExtractableText,
  PdfEncryptedError,
} from "./extract";
import type { MatchOutcome, OpenChargeCandidate, ParsedReceipt } from "./types";

const OPEN_STATUSES = ["pendente", "boleto_recebido", "atrasado"] as const;
const PIPELINE_ACTOR = "system:comprovante-pipeline";

export interface ReceiptOutcome {
  page: number;
  segment: number;
  type: ReceiptType;
  amount: number | null;
  paidAt: string | null;
  outcome: MatchOutcome;
  chargeId?: string;
}

export interface PipelineResult {
  documentId: string;
  status: DocProcessingStatus;
  receipts: number;
  auto: number;
  review: number;
  outcomes: ReceiptOutcome[];
  error?: string;
}

interface DocumentRow {
  id: string;
  drive_file_id: string;
  content_hash: string;
  page_count: number | null;
}

function toOne<T>(v: unknown): T | null {
  if (Array.isArray(v)) return (v[0] as T) ?? null;
  return (v as T) ?? null;
}

function paymentMethodFor(type: ReceiptType): PaymentMethod | null {
  switch (type) {
    case RECEIPT_TYPE.pix:
      return PAYMENT_METHOD.pix;
    case RECEIPT_TYPE.ted:
      return PAYMENT_METHOD.transferencia;
    case RECEIPT_TYPE.debitoAutomatico:
      return PAYMENT_METHOD.debitoAutomatico;
    default:
      return null;
  }
}

async function raiseEncryptedAlert(
  admin: ChargingClient,
  documentId: string,
  contentHash: string,
): Promise<void> {
  await admin.from("alerts").upsert(
    {
      alert_type: "encrypted_comprovante",
      severity: "warning",
      dedupe_key: `encrypted_comprovante:${contentHash}`,
      payload: { document_id: documentId, reason: "comprovante protegido por senha" },
      last_detected_at: new Date().toISOString(),
    },
    { onConflict: "dedupe_key" },
  );
}

async function finalizeDoc(
  admin: ChargingClient,
  documentId: string,
  status: DocProcessingStatus,
  error?: string,
): Promise<void> {
  await admin
    .from("documents")
    .update({
      processing_status: status,
      processing_error: error ?? null,
      processed_at: new Date().toISOString(),
    })
    .eq("id", documentId);
}

// ── candidate pool: OPEN charges + billing account + counterparty tolerance ──
interface CandidateRow {
  id: string;
  amount: number | string | null;
  competencia: string | null;
  due_date: string | null;
  chave_pix: string | null;
  issuer_cnpj: string | null;
  agencia: string | null;
  conta: string | null;
  linha_digitavel: string | null;
  billing_accounts: unknown;
  charge_energy_details: unknown;
}

async function loadOpenCandidates(
  admin: ChargingClient,
): Promise<OpenChargeCandidate[]> {
  const out: OpenChargeCandidate[] = [];
  const select =
    "id, amount, competencia, due_date, chave_pix, issuer_cnpj, agencia, conta, linha_digitavel, " +
    "billing_accounts(auto_debit_registration, counterparties(value_tolerance)), " +
    "charge_energy_details(auto_debit_registration)";
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("charges")
      .select(select)
      .in("status", OPEN_STATUSES as unknown as string[])
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`open charges read failed: ${error.message}`);
    const rows = (data ?? []) as unknown as CandidateRow[];
    for (const r of rows) {
      const ba = toOne<{
        auto_debit_registration: string | null;
        counterparties: unknown;
      }>(r.billing_accounts);
      const cp = toOne<{ value_tolerance: number | string | null }>(ba?.counterparties);
      const ed = toOne<{ auto_debit_registration: string | null }>(r.charge_energy_details);
      out.push({
        chargeId: r.id,
        amount: num(r.amount),
        competencia: r.competencia,
        dueDate: r.due_date,
        chavePix: r.chave_pix,
        issuerCnpj: r.issuer_cnpj,
        agencia: r.agencia,
        conta: r.conta,
        linhaDigitavel: r.linha_digitavel,
        autoDebitRegistration:
          ed?.auto_debit_registration ?? ba?.auto_debit_registration ?? null,
        valueTolerance: num(cp?.value_tolerance) ?? 0.01,
      });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

// ── receipts: select-then-insert/update so match state is never clobbered ───
async function upsertReceipt(
  admin: ChargingClient,
  documentId: string,
  r: ParsedReceipt,
): Promise<{ id: string; matchStatus: MatchStatus }> {
  const fields = {
    receipt_type: r.receiptType,
    amount: r.amount,
    paid_at: r.paidAt,
    chave_pix: r.chavePix,
    cnpj_cpf: r.cnpjCpf,
    banco: r.banco,
    agencia: r.agencia,
    conta: r.conta,
    identificacao: r.identificacao,
    autenticacao: r.autenticacao,
    codigo_barras: r.codigoBarras,
    ctrl: r.ctrl,
    raw_text: r.rawText,
  };
  const { data: existing, error: selErr } = await admin
    .from("receipts")
    .select("id, match_status")
    .eq("document_id", documentId)
    .eq("page_number", r.pageNumber)
    .eq("segment_index", r.segmentIndex)
    .maybeSingle();
  if (selErr) throw new Error(`receipts read failed: ${selErr.message}`);

  if (existing) {
    const row = existing as { id: string; match_status: MatchStatus };
    // do NOT overwrite match_status on re-run
    const { error } = await admin.from("receipts").update(fields).eq("id", row.id);
    if (error) throw new Error(`receipts update failed: ${error.message}`);
    return { id: row.id, matchStatus: row.match_status };
  }

  const { data: ins, error } = await admin
    .from("receipts")
    .insert({
      document_id: documentId,
      page_number: r.pageNumber,
      segment_index: r.segmentIndex,
      match_status: "unmatched",
      ...fields,
    })
    .select("id")
    .single();
  if (error) throw new Error(`receipts insert failed: ${error.message}`);
  return { id: (ins as { id: string }).id, matchStatus: "unmatched" };
}

/**
 * Processes ONE comprovante document by id. `admin` must be a service-role
 * client (`supabaseAdmin()`); the two ingestion paths (upload route, drive
 * poller) both call this after inserting the `documents` row.
 */
export async function processComprovanteDocument(
  documentId: string,
  admin: ChargingClient,
): Promise<PipelineResult> {
  const base: PipelineResult = {
    documentId,
    status: DOC_PROCESSING_STATUS.pending,
    receipts: 0,
    auto: 0,
    review: 0,
    outcomes: [],
  };

  // 1. load the document row
  const { data: docData, error: docErr } = await admin
    .from("documents")
    .select("id, drive_file_id, content_hash, page_count")
    .eq("id", documentId)
    .single();
  if (docErr || !docData) {
    return { ...base, status: DOC_PROCESSING_STATUS.failed, error: "documento não encontrado" };
  }
  const doc = docData as DocumentRow;

  try {
    // 2. download bytes
    const buffer = await downloadFile(doc.drive_file_id);

    // 3. extract (encrypted / empty guards)
    let pages: string[];
    try {
      const extracted = await extractPdfText(buffer);
      pages = extracted.pages;
    } catch (err) {
      if (err instanceof PdfEncryptedError) {
        await raiseEncryptedAlert(admin, documentId, doc.content_hash);
        await finalizeDoc(
          admin,
          documentId,
          DOC_PROCESSING_STATUS.needsReview,
          "comprovante protegido por senha",
        );
        return { ...base, status: DOC_PROCESSING_STATUS.needsReview, review: 1 };
      }
      throw err;
    }

    if (hasNoExtractableText(pages)) {
      await finalizeDoc(
        admin,
        documentId,
        DOC_PROCESSING_STATUS.needsReview,
        "comprovante sem texto extraível — imagem escaneada",
      );
      return { ...base, status: DOC_PROCESSING_STATUS.needsReview, review: 1 };
    }

    // 4. parse
    const parsed = parseComprovantePages(pages);
    if (parsed.length === 0) {
      await finalizeDoc(
        admin,
        documentId,
        DOC_PROCESSING_STATUS.needsReview,
        "nenhum comprovante reconhecido no PDF",
      );
      return { ...base, status: DOC_PROCESSING_STATUS.needsReview, review: 1 };
    }

    // 5. candidate pool (once)
    const candidates = await loadOpenCandidates(admin);
    const nowIso = new Date().toISOString();

    let auto = 0;
    let review = 0;
    const outcomes: ReceiptOutcome[] = [];

    for (const r of parsed) {
      const { id: receiptId, matchStatus } = await upsertReceipt(admin, documentId, r);

      // already resolved by a prior run / human — leave it alone
      if (matchStatus === "auto_matched" || matchStatus === "manually_matched") {
        outcomes.push({
          page: r.pageNumber,
          segment: r.segmentIndex,
          type: r.receiptType,
          amount: r.amount,
          paidAt: r.paidAt,
          outcome: "auto",
        });
        continue;
      }

      const match = matchReceipt(r, candidates);
      const notes = match.reasons.join("; ");

      if (match.outcome === "auto" && match.chargeId) {
        const chargeId = match.chargeId;
        // Bind the comprovante FIRST, flip to pago LAST — so the invariant
        // "pago ⟹ a bound comprovante exists" holds even if a step fails
        // mid-way (review finding). A linked comprovante is trusted as paid —
        // no human confirm step (amends #8/#24).
        await admin.from("payments").upsert(
          {
            charge_id: chargeId,
            receipt_id: receiptId,
            amount: r.amount,
            paid_at: r.paidAt,
            method: paymentMethodFor(r.receiptType),
            source: "auto_match",
            created_by_email: PIPELINE_ACTOR,
          },
          { onConflict: "charge_id,receipt_id", ignoreDuplicates: true },
        );

        await admin
          .from("receipts")
          .update({
            match_status: "auto_matched",
            matched_at: nowIso,
            match_notes: notes,
          })
          .eq("id", receiptId);

        // OPEN → pago (H2 sticky); only if still open, and only now that the
        // payment + receipt are bound.
        const { data: flip } = await admin
          .from("charges")
          .update({ status: "pago", status_source: "rpc" })
          .eq("id", chargeId)
          .in("status", OPEN_STATUSES as unknown as string[])
          .select("id");
        const flipped = (flip?.length ?? 0) === 1;

        await admin.from("audit_events").insert({
          entity_table: "charges",
          entity_id: chargeId,
          event_type: "auto_matched",
          actor_email: PIPELINE_ACTOR,
          detail: {
            receipt_id: receiptId,
            document_id: documentId,
            rule: match.rule,
            amount: r.amount,
            paid_at: r.paidAt,
            flipped_to_pago: flipped,
            reasons: match.reasons,
          },
        });
        auto += 1;
        outcomes.push({
          page: r.pageNumber,
          segment: r.segmentIndex,
          type: r.receiptType,
          amount: r.amount,
          paidAt: r.paidAt,
          outcome: "auto",
          chargeId,
        });
      } else {
        const candidateNote =
          match.candidateIds && match.candidateIds.length > 0
            ? `${notes} | candidatos: ${match.candidateIds.join(", ")}`
            : notes;
        await admin
          .from("receipts")
          .update({ match_status: "needs_review", match_notes: candidateNote })
          .eq("id", receiptId);
        review += 1;
        outcomes.push({
          page: r.pageNumber,
          segment: r.segmentIndex,
          type: r.receiptType,
          amount: r.amount,
          paidAt: r.paidAt,
          outcome: match.outcome,
        });
      }
    }

    const status =
      review > 0 ? DOC_PROCESSING_STATUS.needsReview : DOC_PROCESSING_STATUS.processed;
    await finalizeDoc(admin, documentId, status);

    return {
      documentId,
      status,
      receipts: parsed.length,
      auto,
      review,
      outcomes,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finalizeDoc(admin, documentId, DOC_PROCESSING_STATUS.failed, message).catch(
      () => {
        /* best-effort */
      },
    );
    return { ...base, status: DOC_PROCESSING_STATUS.failed, error: message };
  }
}
