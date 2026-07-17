import "server-only";

/**
 * Document deep-dive reader (Gabriel 2026-07-14): the boleto analogue of the
 * comprovante deep-dive (/comprovantes/[id]). Given a `documents` id, returns
 * the document header + EVERY charge bound to it (source_document_id) in the
 * ReviewChargeRow shape the shared ChargeEditorDialog already consumes — staged
 * (needs_review), approved (in the ledger) and manually-added alike, so the
 * page shows the whole document, not just the staging slice.
 *
 * Reads `charging` directly via supabaseAdmin (session-gated), degrading to
 * {available:false} without Supabase env — same contract as the comprovante
 * deep-dive. A document's charges are few (1 boleto, or ~10 ND lines), so the
 * enrichment reads are tiny and unpaginated.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  ChargeKind,
  ChargeStatus,
  MatchStatus,
  PaymentMethod,
} from "@/lib/domain";
import type { ReviewChargeRow } from "@/app/(app)/revisao/cobrancas/queries";

export interface DocumentHeader {
  id: string;
  filename: string | null;
  contentHash: string | null;
  createdAt: string | null;
  source: string | null;
  webViewLink: string | null;
  pageCount: number | null;
  /** All e-mail addresses the document arrived through (email_context, #47). */
  addresses: string[];
  remetente: string | null;
}

export interface DocumentDeepDive {
  available: boolean;
  found: boolean;
  document: DocumentHeader | null;
  charges: ReviewChargeRow[];
  /** Distinct station ids the document's charges touch — "Estações relacionadas". */
  stationIds: number[];
  /** Sum of the charges' amounts (nulls ignored). */
  totalAmount: number;
}

const EMPTY: DocumentDeepDive = {
  available: false,
  found: false,
  document: null,
  charges: [],
  stationIds: [],
  totalAmount: 0,
};

interface ChargeRow {
  id: string;
  kind: ChargeKind;
  competencia: string | null;
  amount: number | null;
  expected_amount: number | null;
  status: ChargeStatus;
  match_status: MatchStatus;
  due_date: string | null;
  source: string;
  dedupe_key: string;
  station_id: number | null;
  billing_account_id: string | null;
  issuer_cnpj: string | null;
  payment_method: PaymentMethod | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chave_pix: string | null;
  linha_digitavel: string | null;
  nota_fiscal: string | null;
  notes: string | null;
  email_sender: string | null;
  source_document_id: string | null;
}

interface DocumentRow {
  id: string;
  original_filename: string | null;
  content_hash: string | null;
  created_at: string | null;
  source: string | null;
  web_view_link: string | null;
  page_count: number | null;
  email_context: { addresses?: string[]; remetente_raw?: string } | null;
}

export async function getDocumentDeepDive(
  documentId: string,
): Promise<DocumentDeepDive> {
  try {
    const admin = supabaseAdmin();

    const { data: docData, error: docErr } = await admin
      .from("documents")
      .select(
        "id, original_filename, content_hash, created_at, source, web_view_link, page_count, email_context",
      )
      .eq("id", documentId)
      .maybeSingle();
    if (docErr) throw new Error(docErr.message);
    if (!docData) return { ...EMPTY, available: true, found: false };
    const doc = docData as DocumentRow;

    const { data: chargeData, error: chErr } = await admin
      .from("charges")
      .select(
        "id, kind, competencia, amount, expected_amount, status, match_status, due_date, source, dedupe_key, station_id, billing_account_id, issuer_cnpj, payment_method, banco, agencia, conta, chave_pix, linha_digitavel, nota_fiscal, notes, email_sender, source_document_id",
      )
      .eq("source_document_id", documentId)
      .order("competencia", { ascending: false })
      .order("id", { ascending: true });
    if (chErr) throw new Error(chErr.message);
    const charges = (chargeData ?? []) as ChargeRow[];

    // station names
    const stationIds = [
      ...new Set(charges.map((c) => c.station_id).filter((x): x is number => x !== null)),
    ];
    const stationName = new Map<number, string | null>();
    if (stationIds.length > 0) {
      const { data } = await admin
        .from("stations")
        .select("id, name")
        .in("id", stationIds);
      for (const s of (data ?? []) as { id: number; name: string | null }[]) {
        stationName.set(s.id, s.name);
      }
    }

    // billing_account → cadastro + counterparty (parceiro razão social)
    const acctIds = [
      ...new Set(
        charges.map((c) => c.billing_account_id).filter((x): x is string => !!x),
      ),
    ];
    const acctInfo = new Map<
      string,
      { cadastroId: number | null; parceiro: string | null }
    >();
    if (acctIds.length > 0) {
      const { data: accts } = await admin
        .from("billing_accounts")
        .select("id, contract_id, counterparty_id")
        .in("id", acctIds);
      const rows = (accts ?? []) as {
        id: string;
        contract_id: string | null;
        counterparty_id: string | null;
      }[];
      const contractIds = [
        ...new Set(rows.map((r) => r.contract_id).filter((x): x is string => !!x)),
      ];
      const cpIds = [
        ...new Set(rows.map((r) => r.counterparty_id).filter((x): x is string => !!x)),
      ];
      const cadByContract = new Map<string, number | null>();
      if (contractIds.length > 0) {
        const { data: cs } = await admin
          .from("contracts")
          .select("id, cadastro_id")
          .in("id", contractIds);
        for (const c of (cs ?? []) as { id: string; cadastro_id: number | null }[]) {
          cadByContract.set(c.id, c.cadastro_id);
        }
      }
      const nameByCp = new Map<string, string | null>();
      if (cpIds.length > 0) {
        const { data: cps } = await admin
          .from("counterparties")
          .select("id, name")
          .in("id", cpIds);
        for (const c of (cps ?? []) as { id: string; name: string | null }[]) {
          nameByCp.set(c.id, c.name);
        }
      }
      for (const r of rows) {
        acctInfo.set(r.id, {
          cadastroId: r.contract_id ? (cadByContract.get(r.contract_id) ?? null) : null,
          parceiro: r.counterparty_id ? (nameByCp.get(r.counterparty_id) ?? null) : null,
        });
      }
    }

    const addresses = doc.email_context?.addresses ?? [];
    const document: DocumentHeader = {
      id: doc.id,
      filename: doc.original_filename,
      contentHash: doc.content_hash,
      createdAt: doc.created_at,
      source: doc.source,
      webViewLink: doc.web_view_link,
      pageCount: doc.page_count,
      addresses,
      remetente: doc.email_context?.remetente_raw ?? null,
    };

    const rows: ReviewChargeRow[] = charges.map((c) => {
      const acct = c.billing_account_id ? acctInfo.get(c.billing_account_id) : undefined;
      return {
        id: c.id,
        kind: c.kind,
        competencia: c.competencia,
        amount: c.amount,
        expectedAmount: c.expected_amount,
        status: c.status,
        matchStatus: c.match_status,
        dueDate: c.due_date,
        source: c.source,
        dedupeKey: c.dedupe_key,
        stationId: c.station_id,
        stationName: c.station_id !== null ? (stationName.get(c.station_id) ?? null) : null,
        cadastroId: acct?.cadastroId ?? null,
        parceiro: acct?.parceiro ?? null,
        issuerCnpj: c.issuer_cnpj,
        paymentMethod: c.payment_method,
        banco: c.banco,
        agencia: c.agencia,
        conta: c.conta,
        chavePix: c.chave_pix,
        linhaDigitavel: c.linha_digitavel,
        notaFiscal: c.nota_fiscal,
        notes: c.notes,
        emailSender: c.email_sender,
        documentId: c.source_document_id,
        webViewLink: doc.web_view_link,
        documentFilename: doc.original_filename,
        documentCreatedAt: doc.created_at,
        documentSource: doc.source,
        documentAddresses: addresses,
        energyLineAmount: null,
      };
    });

    return {
      available: true,
      found: true,
      document,
      charges: rows,
      stationIds,
      totalAmount: rows.reduce((s, r) => s + (r.amount ?? 0), 0),
    };
  } catch {
    return EMPTY;
  }
}
