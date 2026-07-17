import "server-only";

/**
 * Review-queue reader (R2): the email-classification queue is every charge left
 * `match_status='needs_review'` — the n8n webhook lands its cobranças there
 * (requirement 4.1) alongside any clone-era UNIDENTIFIED rows. Reads directly
 * from `charging` (the DomainSnapshot doesn't carry uuids/documents), degrading
 * to an empty queue when Supabase env is absent (sheets/dev backend).
 *
 * Also returns the option lists the reclassify dialog needs: stations and
 * contracts (cadastro pickers).
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { isEmailDocRow } from "@/components/pagamentos/email-docs-groups";
import type { ChargeKind, ChargeStatus, MatchStatus, PaymentMethod } from "@/lib/domain";

export interface ReviewChargeRow {
  id: string;
  kind: ChargeKind;
  competencia: string | null;
  amount: number | null;
  expectedAmount: number | null;
  status: ChargeStatus;
  matchStatus: MatchStatus;
  dueDate: string | null;
  source: string;
  dedupeKey: string;
  stationId: number | null;
  stationName: string | null;
  cadastroId: number | null;
  parceiro: string | null;
  issuerCnpj: string | null;
  paymentMethod: PaymentMethod | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chavePix: string | null;
  linhaDigitavel: string | null;
  notaFiscal: string | null;
  notes: string | null;
  /** Normalized sender (charges.email_sender) — merge-proposal signal (#38). */
  emailSender: string | null;
  /** Linked email/bill document (for the PDF proxy viewer). */
  documentId: string | null;
  webViewLink: string | null;
  /** Document metadata for the Documentos de e-mail group headers (#47). */
  documentFilename: string | null;
  documentCreatedAt: string | null;
  /** documents.source — 'email_ai' marks an email-intake document. */
  documentSource: string | null;
  /** All e-mail addresses the document arrived through (documents.email_context, #47). */
  documentAddresses: string[];
  energyLineAmount: number | null;
}

/**
 * A possible merge TARGET for a review-queue duplicate (spec 2026-07-11 Peça 2):
 * an identified/settled charge sharing the duplicate's document, sender or CNPJ.
 */
export interface MergeTargetRow {
  id: string;
  dedupeKey: string;
  kind: ChargeKind;
  competencia: string | null;
  amount: number | null;
  status: ChargeStatus;
  stationId: number | null;
  stationName: string | null;
  issuerCnpj: string | null;
  emailSender: string | null;
  sourceDocumentId: string | null;
}

export interface StationOption {
  id: number;
  name: string | null;
}
export interface CadastroOption {
  cadastroId: number;
  stationId: number | null;
  parceiro: string | null;
}

export interface ReviewQueueData {
  available: boolean;
  rows: ReviewChargeRow[];
  stations: StationOption[];
  cadastros: CadastroOption[];
  /** Identified/settled charges that can absorb a review-queue duplicate. */
  mergeTargets: MergeTargetRow[];
}

const EMPTY: ReviewQueueData = {
  available: false,
  rows: [],
  stations: [],
  cadastros: [],
  mergeTargets: [],
};
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

export async function readReviewQueue(): Promise<ReviewQueueData> {
  try {
    const admin = supabaseAdmin();

    const charges = await readAll<ChargeRow>(() =>
      admin
        .from("charges")
        .select(
          "id, kind, competencia, amount, expected_amount, status, match_status, due_date, source, dedupe_key, station_id, billing_account_id, issuer_cnpj, payment_method, banco, agencia, conta, chave_pix, linha_digitavel, nota_fiscal, notes, email_sender, source_document_id",
        )
        .eq("match_status", "needs_review")
        // id tiebreaker: competencia is non-unique — without it the paginated
        // .range() windows have unstable order and can skip/duplicate rows
        .order("competencia", { ascending: false })
        .order("id", { ascending: true }),
    );

    // linked documents (PDF proxy + group-header metadata) — only for charges
    // that have one
    const docIds = [
      ...new Set(charges.map((c) => c.source_document_id).filter((x): x is string => !!x)),
    ];
    interface DocMetaRow {
      id: string;
      web_view_link: string | null;
      original_filename: string | null;
      created_at: string | null;
      source: string | null;
      email_context: { addresses?: string[] } | null;
    }
    const docMeta = new Map<string, DocMetaRow>();
    for (let i = 0; i < docIds.length; i += 200) {
      const { data } = await admin
        .from("documents")
        .select("id, web_view_link, original_filename, created_at, source, email_context")
        .in("id", docIds.slice(i, i + 200));
      for (const d of (data ?? []) as DocMetaRow[]) {
        docMeta.set(d.id, d);
      }
    }

    // energia charge-lines (composite Valor split) for these charges
    const chargeIds = charges.map((c) => c.id);
    const energyByCharge = new Map<string, number>();
    for (let i = 0; i < chargeIds.length; i += 200) {
      const { data } = await admin
        .from("charge_lines")
        .select("charge_id, line_kind, amount")
        .in("charge_id", chargeIds.slice(i, i + 200))
        .eq("line_kind", "energia");
      for (const l of (data ?? []) as { charge_id: string; amount: number | null }[]) {
        if (l.amount !== null) {
          energyByCharge.set(l.charge_id, (energyByCharge.get(l.charge_id) ?? 0) + l.amount);
        }
      }
    }

    // billing_account → contract cadastro + counterparty name (for parceiro)
    const acctIds = [
      ...new Set(charges.map((c) => c.billing_account_id).filter((x): x is string => !!x)),
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

    // option lists for the dialog
    const stationRows = await readAll<{ id: number; name: string | null }>(() =>
      admin.from("stations").select("id, name").order("id"),
    );
    const stations: StationOption[] = stationRows.map((s) => ({ id: s.id, name: s.name }));
    const nameById = new Map(stationRows.map((s) => [s.id, s.name]));

    const contractRows = await readAll<{
      cadastro_id: number | null;
      station_id: number | null;
      counterparty_id: string | null;
    }>(() =>
      admin
        .from("contracts")
        .select("cadastro_id, station_id, counterparty_id")
        .not("cadastro_id", "is", null)
        .order("cadastro_id"),
    );
    // counterparty names for cadastro option labels
    const allCpIds = [
      ...new Set(contractRows.map((c) => c.counterparty_id).filter((x): x is string => !!x)),
    ];
    const cpName = new Map<string, string | null>();
    for (let i = 0; i < allCpIds.length; i += 200) {
      const { data } = await admin
        .from("counterparties")
        .select("id, name")
        .in("id", allCpIds.slice(i, i + 200));
      for (const c of (data ?? []) as { id: string; name: string | null }[]) {
        cpName.set(c.id, c.name);
      }
    }
    const cadastros: CadastroOption[] = contractRows
      .filter((c) => c.cadastro_id !== null)
      .map((c) => ({
        cadastroId: c.cadastro_id as number,
        stationId: c.station_id,
        parceiro: c.counterparty_id ? (cpName.get(c.counterparty_id) ?? null) : null,
      }));

    // ── merge targets (spec 2026-07-11 Peça 2): identified/settled charges that
    // share a review row's DOCUMENT, CNPJ or SENDER — candidates to absorb the
    // duplicate. Volume is bounded by the review rows' own key sets.
    const reviewIds = new Set(charges.map((c) => c.id));
    const cnpjs = [
      ...new Set(charges.map((c) => c.issuer_cnpj).filter((x): x is string => !!x)),
    ];
    const senders = [
      ...new Set(charges.map((c) => c.email_sender).filter((x): x is string => !!x)),
    ];
    const comps = [
      ...new Set(charges.map((c) => c.competencia).filter((x): x is string => !!x)),
    ];
    const targetSelect =
      "id, dedupe_key, kind, competencia, amount, status, station_id, issuer_cnpj, email_sender, source_document_id";
    interface TargetRow {
      id: string;
      dedupe_key: string;
      kind: ChargeKind;
      competencia: string | null;
      amount: number | null;
      status: ChargeStatus;
      station_id: number | null;
      issuer_cnpj: string | null;
      email_sender: string | null;
      source_document_id: string | null;
    }
    const targetById = new Map<string, TargetRow>();
    const collectTargets = (rows2: TargetRow[]) => {
      for (const t of rows2) {
        if (!reviewIds.has(t.id)) targetById.set(t.id, t);
      }
    };
    // Paginate every target read (readAll, PAGE=1000) — a common biller CNPJ or
    // sender can map to more charges per competência than the PostgREST max-rows
    // cap, and a silent truncation could collapse an ambiguous candidate set to
    // a single false "confident" proposal (same discipline as scraper-feed.ts).
    for (let i = 0; i < docIds.length; i += 200) {
      const keys = docIds.slice(i, i + 200);
      collectTargets(
        await readAll<TargetRow>(() =>
          admin.from("charges").select(targetSelect).in("source_document_id", keys),
        ),
      );
    }
    if (comps.length > 0) {
      for (let i = 0; i < cnpjs.length; i += 200) {
        const keys = cnpjs.slice(i, i + 200);
        collectTargets(
          await readAll<TargetRow>(() =>
            admin
              .from("charges")
              .select(targetSelect)
              .in("issuer_cnpj", keys)
              .in("competencia", comps),
          ),
        );
      }
      for (let i = 0; i < senders.length; i += 200) {
        const keys = senders.slice(i, i + 200);
        collectTargets(
          await readAll<TargetRow>(() =>
            admin
              .from("charges")
              .select(targetSelect)
              .in("email_sender", keys)
              .in("competencia", comps),
          ),
        );
      }
    }
    const mergeTargets: MergeTargetRow[] = [...targetById.values()].map((t) => ({
      id: t.id,
      dedupeKey: t.dedupe_key,
      kind: t.kind,
      competencia: t.competencia,
      amount: t.amount,
      status: t.status,
      stationId: t.station_id,
      stationName: t.station_id !== null ? (nameById.get(t.station_id) ?? null) : null,
      issuerCnpj: t.issuer_cnpj,
      emailSender: t.email_sender,
      sourceDocumentId: t.source_document_id,
    }));

    const rows: ReviewChargeRow[] = charges.map((c) => {
      const info = c.billing_account_id ? acctInfo.get(c.billing_account_id) : undefined;
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
        stationName: c.station_id !== null ? (nameById.get(c.station_id) ?? null) : null,
        cadastroId: info?.cadastroId ?? null,
        parceiro: info?.parceiro ?? null,
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
        webViewLink: c.source_document_id
          ? (docMeta.get(c.source_document_id)?.web_view_link ?? null)
          : null,
        documentFilename: c.source_document_id
          ? (docMeta.get(c.source_document_id)?.original_filename ?? null)
          : null,
        documentCreatedAt: c.source_document_id
          ? (docMeta.get(c.source_document_id)?.created_at ?? null)
          : null,
        documentSource: c.source_document_id
          ? (docMeta.get(c.source_document_id)?.source ?? null)
          : null,
        documentAddresses: c.source_document_id
          ? // Array.isArray guards a hand-edited/legacy jsonb row (a non-array
            // `addresses` would later crash .join / spread) — writers always
            // produce string[], so this is pure defense.
            (() => {
              const a = docMeta.get(c.source_document_id)?.email_context?.addresses;
              return Array.isArray(a) ? a : [];
            })()
          : [],
        energyLineAmount: energyByCharge.get(c.id) ?? null,
      };
    });

    return { available: true, rows, stations, cadastros, mergeTargets };
  } catch {
    return EMPTY;
  }
}

/**
 * Pending count for the Documentos de e-mail badge (sidebar + tab, #47).
 * MUST count exactly what the tab lists — it applies the same `isEmailDocRow`
 * predicate over a skinny read (the review queue is human-sized; two cheap
 * round-trips). try/catch → 0: a badge must never break the app shell.
 */
export async function countEmailDocPending(): Promise<number> {
  try {
    const admin = supabaseAdmin();
    const rows = await readAll<{
      id: string;
      source: string;
      status: string;
      source_document_id: string | null;
    }>(() =>
      admin
        .from("charges")
        .select("id, source, status, source_document_id")
        .eq("match_status", "needs_review")
        // stable pagination — unordered .range() windows can skip/duplicate
        .order("id", { ascending: true }),
    );

    const docIds = [
      ...new Set(rows.map((r) => r.source_document_id).filter((x): x is string => !!x)),
    ];
    const docSource = new Map<string, string | null>();
    for (let i = 0; i < docIds.length; i += 200) {
      const { data } = await admin
        .from("documents")
        .select("id, source")
        .in("id", docIds.slice(i, i + 200));
      for (const d of (data ?? []) as { id: string; source: string | null }[]) {
        docSource.set(d.id, d.source);
      }
    }

    return rows.filter((r) =>
      isEmailDocRow({
        matchStatus: "needs_review",
        source: r.source,
        status: r.status,
        documentId: r.source_document_id,
        documentSource: r.source_document_id
          ? (docSource.get(r.source_document_id) ?? null)
          : null,
      }),
    ).length;
  } catch {
    return 0;
  }
}
