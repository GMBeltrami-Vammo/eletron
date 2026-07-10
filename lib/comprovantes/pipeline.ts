import "server-only";

/**
 * Comprovante pipeline (service-role). Idempotent orchestration:
 *   download (Drive) → encrypted/empty guards → extract (unpdf) → parse →
 *   upsert receipts on (document_id, page_number, segment_index) → match each
 *   against candidate charges → on `auto`: insert payment(source='auto_match') +
 *   flip an OPEN charge → 'pago' + EAGERLY isolate the matched page to Supabase
 *   Storage + audit; on `ambiguous`/`none`: mark the receipt needs_review.
 *
 * Two entry points share the same match/bind core:
 *   - `processComprovanteChunk(documentId, from, to)` — the interactive path:
 *     the client uploads the whole PDF, then loops 10-page chunks so every
 *     request stays well under the Vercel function limit while a progress bar
 *     advances (Gabriel 2026-07-10). Each chunk is stateless + idempotent.
 *   - `processComprovanteDocument(documentId)` — whole-document pass used by the
 *     daily sweep / "Reprocessar" (non-interactive catch-up).
 *
 * Matching reaches OPEN charges AND `pago` charges that have NO comprovante
 * bound yet (the clone's sync/portal-derived `pago` rows): a dropped comprovante
 * binds to them + records the payment, satisfying "pago ⟺ comprovante"
 * (decision #29) without touching the parallel scraper/portal status. A `pago`
 * charge already carrying a receipted payment is excluded (never re-matched).
 *
 * A linked comprovante (auto-match here, or manual via `record_payment`) is
 * treated as PAID — deterministic no-AI matching is trusted, so an auto-match
 * flips an open charge straight to 'pago' (amends decisions #8/#24). Re-running
 * is safe: receipts are upserted, payments are UNIQUE (charge_id, receipt_id),
 * the flip only fires from an OPEN status, and page isolation is upsert-by-path.
 * Never throws for expected failures — sets `documents.processing_status` and
 * returns a summary.
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
import { isolatePages } from "./split";
import type { MatchOutcome, OpenChargeCandidate, ParsedReceipt } from "./types";

const OPEN_STATUSES = ["pendente", "boleto_recebido", "atrasado"] as const;
const PIPELINE_ACTOR = "system:comprovante-pipeline";
const BUCKET = "comprovante_pages";
/** Pages processed per interactive chunk request (Gabriel: "10 pages at a time"). */
export const CHUNK_SIZE = 10;

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

/** One 10-page chunk's outcome (the interactive progress-bar contract). */
export interface ChunkResult {
  documentId: string;
  /** Total pages of the document (authoritative, from extraction). */
  pageCount: number;
  /** Highest page reached so far (progress = pagesProcessed / pageCount). */
  pagesProcessed: number;
  /** True once the final page range has been processed. */
  done: boolean;
  status: DocProcessingStatus;
  /** Auto-matches / needs-review / receipts produced by THIS chunk. */
  auto: number;
  review: number;
  receipts: number;
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

/** Advances the durable progress counter (monotonic) and backfills page_count. */
async function updateProgress(
  admin: ChargingClient,
  documentId: string,
  pagesProcessed: number,
  pageCount?: number,
): Promise<void> {
  const { data } = await admin
    .from("documents")
    .select("pages_processed")
    .eq("id", documentId)
    .maybeSingle();
  const current = (data as { pages_processed: number } | null)?.pages_processed ?? 0;
  const patch: Record<string, unknown> = {
    pages_processed: Math.max(current, pagesProcessed),
  };
  if (pageCount !== undefined) patch.page_count = pageCount;
  await admin.from("documents").update(patch).eq("id", documentId);
}

// ── candidate pool: OPEN + comprovante-less `pago` charges ───────────────────
interface CandidateRow {
  id: string;
  status: string;
  kind: string;
  billing_account_id: string | null;
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

function isEnergyCandidate(
  accountType: string | null | undefined,
  billingAccountId: string | null,
  kind: string,
): boolean {
  return (
    accountType === "energy_enel" ||
    accountType === "energy_edp" ||
    (billingAccountId == null && kind === "energia")
  );
}

/** charge_ids that already carry a comprovante-backed payment (never re-match). */
async function loadReceiptedChargeIds(admin: ChargingClient): Promise<Set<string>> {
  const ids = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("payments")
      .select("charge_id")
      .not("receipt_id", "is", null)
      .order("charge_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`receipted payments read failed: ${error.message}`);
    const rows = (data ?? []) as { charge_id: string }[];
    for (const r of rows) ids.add(r.charge_id);
    if (rows.length < PAGE) break;
  }
  return ids;
}

async function loadCandidates(admin: ChargingClient): Promise<OpenChargeCandidate[]> {
  const receipted = await loadReceiptedChargeIds(admin);
  const out: OpenChargeCandidate[] = [];
  const select =
    "id, status, kind, billing_account_id, amount, competencia, due_date, chave_pix, issuer_cnpj, agencia, conta, linha_digitavel, " +
    "billing_accounts(account_type, auto_debit_registration, counterparties(value_tolerance)), " +
    "charge_energy_details(auto_debit_registration)";
  const statuses = [...OPEN_STATUSES, "pago"];
  const openSet = new Set<string>(OPEN_STATUSES);
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("charges")
      .select(select)
      .in("status", statuses)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`candidate charges read failed: ${error.message}`);
    const rows = (data ?? []) as unknown as CandidateRow[];
    for (const r of rows) {
      const ba = toOne<{
        account_type: string | null;
        auto_debit_registration: string | null;
        counterparties: unknown;
      }>(r.billing_accounts);
      const isOpen = openSet.has(r.status);
      // `pago` charges join the pool ONLY for ENERGY (the clone marked energy
      // paid via portal status, so a comprovante binds retroactively). For rent
      // / third-party, a paid prior month must NOT compete with the open charge
      // (Gabriel 2026-07-10). A pago charge that already has a comprovante is done.
      if (!isOpen) {
        if (receipted.has(r.id)) continue;
        if (!isEnergyCandidate(ba?.account_type, r.billing_account_id, r.kind)) {
          continue;
        }
      }
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
        isOpen,
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
 * Eagerly isolates each matched physical page into the private
 * `comprovante_pages` Storage bucket + records `document_pages`, loading the
 * source PDF ONCE (isolatePages). Best-effort: a failure here never fails the
 * match — the lazy /api/files/[id]/page/[n] route regenerates the page on hover.
 */
async function isolateAndStore(
  admin: ChargingClient,
  documentId: string,
  whole: Buffer,
  pages: number[],
): Promise<void> {
  if (pages.length === 0) return;
  let bytesByPage: Map<number, Uint8Array>;
  try {
    bytesByPage = await isolatePages(new Uint8Array(whole), pages);
  } catch {
    return; // regenerated lazily on hover
  }
  for (const [page, bytes] of bytesByPage) {
    const storagePath = `${documentId}/${page}.pdf`;
    try {
      await admin.storage
        .from(BUCKET)
        .upload(storagePath, Buffer.from(bytes), {
          contentType: "application/pdf",
          upsert: true,
        });
      await admin.from("document_pages").upsert(
        {
          document_id: documentId,
          page_number: page,
          storage_path: storagePath,
          byte_size: bytes.byteLength,
        },
        { onConflict: "document_id,page_number" },
      );
    } catch {
      /* best-effort per page */
    }
  }
}

interface MatchBatch {
  auto: number;
  review: number;
  outcomes: ReceiptOutcome[];
}

/**
 * Upserts + matches a set of parsed receipts against the candidate pool, binding
 * auto-matches and eagerly isolating their pages. Shared by the chunk and
 * whole-document paths; `whole` is the full PDF (for isolatePages).
 */
async function matchAndBind(
  admin: ChargingClient,
  documentId: string,
  whole: Buffer,
  parsed: ParsedReceipt[],
  candidates: OpenChargeCandidate[],
  nowIso: string,
): Promise<MatchBatch> {
  let auto = 0;
  let review = 0;
  const outcomes: ReceiptOutcome[] = [];
  const matchedPages = new Set<number>();
  // Mutable copy: once a receipt auto-binds a charge, that charge leaves the
  // pool so a second receipt in the SAME batch can't bind it again. This keeps
  // the chunk path equivalent to (a) the cross-chunk exclusion loadCandidates
  // already applies (loadReceiptedChargeIds) and (b) the whole-doc path — a
  // charge is auto-bound by at most one receipt per run (no double-count,
  // boundary-independent). Review finding #1.
  const pool = candidates.slice();

  for (const r of parsed) {
    const { id: receiptId, matchStatus } = await upsertReceipt(admin, documentId, r);

    // already resolved by a prior run / human — leave the link, re-isolate page
    if (matchStatus === "auto_matched" || matchStatus === "manually_matched") {
      matchedPages.add(r.pageNumber);
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

    const match = matchReceipt(r, pool);
    const notes = match.reasons.join("; ");

    if (match.outcome === "auto" && match.chargeId) {
      const chargeId = match.chargeId;
      // drop the just-bound charge so the next receipt can't re-bind it
      const poolIdx = pool.findIndex((c) => c.chargeId === chargeId);
      if (poolIdx >= 0) pool.splice(poolIdx, 1);
      // Bind the comprovante FIRST, flip to pago LAST — so the invariant
      // "pago ⟹ a bound comprovante exists" holds even if a step fails midway.
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

      // OPEN → pago (H2 sticky); a `pago`-without-comprovante candidate simply
      // stays pago (flip is a no-op) but now carries a bound comprovante.
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
      matchedPages.add(r.pageNumber);
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

  await isolateAndStore(admin, documentId, whole, [...matchedPages]);
  return { auto, review, outcomes };
}

async function loadDocument(
  admin: ChargingClient,
  documentId: string,
): Promise<DocumentRow | null> {
  // kind guard (review finding #5): the chunk endpoint + reprocess take an
  // arbitrary documentId — never run the comprovante pipeline over a fatura /
  // contract / meter photo (would fabricate receipts/payments).
  const { data, error } = await admin
    .from("documents")
    .select("id, drive_file_id, content_hash, page_count")
    .eq("id", documentId)
    .eq("kind", "comprovante")
    .single();
  if (error || !data) return null;
  return data as DocumentRow;
}

/** Counts total + needs-review receipts to derive the terminal status. */
async function receiptCounts(
  admin: ChargingClient,
  documentId: string,
): Promise<{ total: number; review: number }> {
  const total = await admin
    .from("receipts")
    .select("id", { count: "exact", head: true })
    .eq("document_id", documentId);
  const review = await admin
    .from("receipts")
    .select("id", { count: "exact", head: true })
    .eq("document_id", documentId)
    .eq("match_status", "needs_review");
  return { total: total.count ?? 0, review: review.count ?? 0 };
}

/**
 * Processes ONE 10-page range `[from, to]` (1-based, inclusive) of a comprovante
 * document. Stateless + idempotent — the client loops chunks and drives the
 * progress bar; the final chunk finalizes the document status. A transient chunk
 * error leaves the document `pending` (client retry / daily sweep resumes it),
 * never `failed`.
 */
export async function processComprovanteChunk(
  documentId: string,
  from: number,
  to: number,
  admin: ChargingClient,
): Promise<ChunkResult> {
  const base: ChunkResult = {
    documentId,
    pageCount: 0,
    pagesProcessed: 0,
    done: false,
    status: DOC_PROCESSING_STATUS.pending,
    auto: 0,
    review: 0,
    receipts: 0,
    outcomes: [],
  };

  const doc = await loadDocument(admin, documentId);
  if (!doc) {
    return { ...base, status: DOC_PROCESSING_STATUS.failed, done: true, error: "documento não encontrado" };
  }
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
    return { ...base, status: DOC_PROCESSING_STATUS.failed, error: "intervalo de páginas inválido" };
  }

  try {
    const buffer = await downloadFile(doc.drive_file_id);

    let pages: string[];
    let pageCount: number;
    try {
      const extracted = await extractPdfText(buffer);
      pages = extracted.pages;
      pageCount = extracted.pageCount;
    } catch (err) {
      if (err instanceof PdfEncryptedError) {
        await raiseEncryptedAlert(admin, documentId, doc.content_hash);
        await finalizeDoc(admin, documentId, DOC_PROCESSING_STATUS.needsReview, "comprovante protegido por senha");
        return { ...base, status: DOC_PROCESSING_STATUS.needsReview, done: true };
      }
      throw err;
    }

    // scanned-image guard: only the first chunk can judge the whole document.
    if (from <= 1 && hasNoExtractableText(pages)) {
      await finalizeDoc(admin, documentId, DOC_PROCESSING_STATUS.needsReview, "comprovante sem texto extraível — imagem escaneada");
      await updateProgress(admin, documentId, pageCount, pageCount);
      return { ...base, pageCount, pagesProcessed: pageCount, status: DOC_PROCESSING_STATUS.needsReview, done: true };
    }

    const clampTo = Math.min(to, pageCount);
    const chunkPages = pages.slice(from - 1, clampTo);
    const parsed = parseComprovantePages(chunkPages, from);

    const candidates = await loadCandidates(admin);
    const nowIso = new Date().toISOString();
    const { auto, review, outcomes } = await matchAndBind(
      admin,
      documentId,
      buffer,
      parsed,
      candidates,
      nowIso,
    );

    await updateProgress(admin, documentId, clampTo, pageCount);

    const done = clampTo >= pageCount;
    let status: DocProcessingStatus = DOC_PROCESSING_STATUS.pending;
    if (done) {
      const counts = await receiptCounts(admin, documentId);
      status =
        counts.total === 0 || counts.review > 0
          ? DOC_PROCESSING_STATUS.needsReview
          : DOC_PROCESSING_STATUS.processed;
      await finalizeDoc(
        admin,
        documentId,
        status,
        counts.total === 0 ? "nenhum comprovante reconhecido no PDF" : undefined,
      );
    }

    return {
      documentId,
      pageCount,
      pagesProcessed: clampTo,
      done,
      status,
      auto,
      review,
      receipts: parsed.length,
      outcomes,
    };
  } catch (err) {
    // transient: leave the document `pending` so the client can retry the chunk
    // or the daily sweep can resume it (idempotent). Do NOT mark it failed.
    return {
      ...base,
      pageCount: doc.page_count ?? 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Processes an ENTIRE comprovante document in one pass (daily sweep /
 * "Reprocessar"). `admin` must be a service-role client (`supabaseAdmin()`).
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

  const doc = await loadDocument(admin, documentId);
  if (!doc) {
    return { ...base, status: DOC_PROCESSING_STATUS.failed, error: "documento não encontrado" };
  }

  try {
    const buffer = await downloadFile(doc.drive_file_id);

    let pages: string[];
    let pageCount: number;
    try {
      const extracted = await extractPdfText(buffer);
      pages = extracted.pages;
      pageCount = extracted.pageCount;
    } catch (err) {
      if (err instanceof PdfEncryptedError) {
        await raiseEncryptedAlert(admin, documentId, doc.content_hash);
        await finalizeDoc(admin, documentId, DOC_PROCESSING_STATUS.needsReview, "comprovante protegido por senha");
        return { ...base, status: DOC_PROCESSING_STATUS.needsReview, review: 1 };
      }
      throw err;
    }

    if (hasNoExtractableText(pages)) {
      await finalizeDoc(admin, documentId, DOC_PROCESSING_STATUS.needsReview, "comprovante sem texto extraível — imagem escaneada");
      await updateProgress(admin, documentId, pageCount, pageCount);
      return { ...base, status: DOC_PROCESSING_STATUS.needsReview, review: 1 };
    }

    const parsed = parseComprovantePages(pages, 1);
    if (parsed.length === 0) {
      await finalizeDoc(admin, documentId, DOC_PROCESSING_STATUS.needsReview, "nenhum comprovante reconhecido no PDF");
      await updateProgress(admin, documentId, pageCount, pageCount);
      return { ...base, status: DOC_PROCESSING_STATUS.needsReview, review: 1 };
    }

    const candidates = await loadCandidates(admin);
    const nowIso = new Date().toISOString();
    const { auto, review, outcomes } = await matchAndBind(
      admin,
      documentId,
      buffer,
      parsed,
      candidates,
      nowIso,
    );

    const status =
      review > 0 ? DOC_PROCESSING_STATUS.needsReview : DOC_PROCESSING_STATUS.processed;
    await finalizeDoc(admin, documentId, status);
    await updateProgress(admin, documentId, pageCount, pageCount);

    return { documentId, status, receipts: parsed.length, auto, review, outcomes };
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
