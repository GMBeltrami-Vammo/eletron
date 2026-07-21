"use server";

/**
 * Charge-first manual matcher (Gabriel 2026-07-17, spec
 * 2026-07-17-vincular-comprovante-charge-first): from a blank Comprovante cell,
 * "Vincular" opens a dialog listing the UNBOUND receipts of the same value
 * (±R$0,50) so the human binds one to THIS charge. This is the read side —
 * it resolves the charge (by its synthetic dedupe_key) to the header fields +
 * the candidate receipts. The bind itself reuses `recordPayment` (record_payment
 * RPC: charge → `pago` #29, logged in manual_match_log #60). No new RPC.
 *
 * Read-only + session-gated via supabaseAdmin (receipts/payments have no RLS
 * read policy for the user JWT — same reason the deep-dives read as admin).
 * Degrades to { available:false } without Supabase env (sheets/dev).
 */

import { getSessionEmail } from "@/lib/http/guards";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { PaymentMethod } from "@/lib/domain";

// Manual value-match window (±R$5) — NOT the auto-matcher's strict ±0,50.
// Energy DA payments legitimately differ from the fatura "Total" by small
// amounts (juros/arredondamento). `showAll` removes the filter entirely.
const VALUE_WINDOW = 5;

export interface BindChargeHeader {
  /** Resolved DB uuid — what recordPayment binds to. */
  chargeUuid: string;
  amount: number | null;
  paymentMethod: PaymentMethod | null;
  chavePix: string | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  linhaDigitavel: string | null;
  cnpj: string | null;
  competencia: string | null;
  dueDate: string | null;
  stationId: number | null;
  stationName: string | null;
  kind: string;
}

export interface BindCandidate {
  receiptId: string;
  filename: string | null;
  webViewLink: string | null;
  documentId: string | null;
  pageNumber: number | null;
  receiptType: string | null;
  amount: number | null;
  paidAt: string | null;
  chavePix: string | null;
  cnpjCpf: string | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
}

export interface BindContext {
  available: boolean;
  charge: BindChargeHeader | null;
  candidates: BindCandidate[];
  /** The same-value receipt scan hit its cap — more may exist (no silent cap). */
  truncated: boolean;
}

const RECEIPT_SCAN_LIMIT = 200;
const UNAVAILABLE: BindContext = {
  available: false,
  charge: null,
  candidates: [],
  truncated: false,
};

interface ChargeHeaderRow {
  id: string;
  amount: number | null;
  payment_method: PaymentMethod | null;
  chave_pix: string | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  linha_digitavel: string | null;
  issuer_cnpj: string | null;
  competencia: string | null;
  due_date: string | null;
  station_id: number | null;
  kind: string;
  billing_account_id: string | null;
}

interface ReceiptCandidateRow {
  id: string;
  document_id: string | null;
  page_number: number | null;
  receipt_type: string | null;
  amount: number | null;
  paid_at: string | null;
  chave_pix: string | null;
  cnpj_cpf: string | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  documents: { original_filename: string | null; web_view_link: string | null } | null;
}

export async function loadBindCandidates(
  dedupeKey: string,
  showAll = false,
): Promise<BindContext> {
  const email = await getSessionEmail();
  if (!email) return UNAVAILABLE;

  let admin: ReturnType<typeof supabaseAdmin>;
  try {
    admin = supabaseAdmin();
  } catch {
    return UNAVAILABLE;
  }

  try {
    const { data: chargeData, error: chargeErr } = await admin
      .from("charges")
      .select(
        "id, amount, payment_method, chave_pix, banco, agencia, conta, linha_digitavel, issuer_cnpj, competencia, due_date, station_id, kind, billing_account_id",
      )
      .eq("dedupe_key", dedupeKey)
      .maybeSingle();
    if (chargeErr) throw new Error(chargeErr.message);
    if (!chargeData) {
      return { available: true, charge: null, candidates: [], truncated: false };
    }
    const c = chargeData as ChargeHeaderRow;

    // Station name.
    let stationName: string | null = null;
    if (c.station_id !== null) {
      const { data } = await admin
        .from("stations")
        .select("name")
        .eq("id", c.station_id)
        .maybeSingle();
      stationName = (data as { name: string | null } | null)?.name ?? null;
    }

    // CNPJ: prefer the charge's issuer_cnpj, else the counterparty's.
    let cnpj = c.issuer_cnpj;
    if (!cnpj && c.billing_account_id) {
      const { data: acct } = await admin
        .from("billing_accounts")
        .select("counterparty_id")
        .eq("id", c.billing_account_id)
        .maybeSingle();
      const counterpartyId = (acct as { counterparty_id: string | null } | null)
        ?.counterparty_id;
      if (counterpartyId) {
        const { data: cp } = await admin
          .from("counterparties")
          .select("cnpj_cpf")
          .eq("id", counterpartyId)
          .maybeSingle();
        cnpj = (cp as { cnpj_cpf: string | null } | null)?.cnpj_cpf ?? null;
      }
    }

    const charge: BindChargeHeader = {
      chargeUuid: c.id,
      amount: c.amount,
      paymentMethod: c.payment_method,
      chavePix: c.chave_pix,
      banco: c.banco,
      agencia: c.agencia,
      conta: c.conta,
      linhaDigitavel: c.linha_digitavel,
      cnpj,
      competencia: c.competencia,
      dueDate: c.due_date,
      stationId: c.station_id,
      stationName,
      kind: c.kind,
    };

    // Value filter: ±VALUE_WINDOW around the charge amount, UNLESS `showAll`
    // (the "ver todos os valores" escape) — then list every unbound receipt
    // (capped). A charge with no amount can only be resolved via showAll.
    if (c.amount === null && !showAll) {
      return { available: true, charge, candidates: [], truncated: false };
    }
    const useValueFilter = !showAll && c.amount !== null;
    // Every unbound receipt of this value — Gabriel: "só não vinculados". A
    // `rejected` (bulk-discarded, #43) receipt is still unbound and, since the
    // pool shifted post-#44, may now be the right match, so it is NOT hidden;
    // "bound" (a payment references it) is the only exclusion.
    let recQ = admin
      .from("receipts")
      .select(
        "id, document_id, page_number, receipt_type, amount, paid_at, chave_pix, cnpj_cpf, banco, agencia, conta, documents(original_filename, web_view_link)",
      );
    if (useValueFilter) {
      const amount = c.amount as number;
      recQ = recQ
        .gte("amount", amount - VALUE_WINDOW)
        .lte("amount", amount + VALUE_WINDOW);
    }
    const { data: recData, error: recErr } = await recQ
      .order("paid_at", { ascending: false })
      .limit(RECEIPT_SCAN_LIMIT);
    if (recErr) throw new Error(recErr.message);
    const receipts = (recData ?? []) as unknown as ReceiptCandidateRow[];
    const truncated = receipts.length >= RECEIPT_SCAN_LIMIT;
    if (receipts.length === 0) {
      return { available: true, charge, candidates: [], truncated };
    }

    // Drop the ones already bound to a charge (a payment row references them).
    const receiptIds = receipts.map((r) => r.id);
    const { data: payData, error: payErr } = await admin
      .from("payments")
      .select("receipt_id")
      .in("receipt_id", receiptIds);
    if (payErr) throw new Error(payErr.message);
    const bound = new Set(
      ((payData ?? []) as { receipt_id: string | null }[])
        .map((p) => p.receipt_id)
        .filter((x): x is string => x !== null),
    );

    const candidates: BindCandidate[] = receipts
      .filter((r) => !bound.has(r.id))
      .map((r) => ({
        receiptId: r.id,
        filename: r.documents?.original_filename ?? null,
        webViewLink: r.documents?.web_view_link ?? null,
        documentId: r.document_id,
        pageNumber: r.page_number,
        receiptType: r.receipt_type,
        amount: r.amount,
        paidAt: r.paid_at,
        chavePix: r.chave_pix,
        cnpjCpf: r.cnpj_cpf,
        banco: r.banco,
        agencia: r.agencia,
        conta: r.conta,
      }));

    return { available: true, charge, candidates, truncated };
  } catch {
    return UNAVAILABLE;
  }
}
