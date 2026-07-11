import "server-only";

/**
 * Server-only read layer for the comprovantes UX. The Repository interface does
 * not cover documents/receipts/payments (H3), so these helpers read the
 * `charging` schema directly via `supabaseAdmin()`.
 *
 * Safety:
 * - Reads sit behind the `@vammo.com` middleware gate, and the charging SELECT
 *   RLS is a uniform `is_vammo_user()` (no row filtering), so the service role
 *   returns the same rows any vammo user would see (mirrors repository.server).
 *   Every function still re-checks the session so the `"use server"` wrappers in
 *   `actions.ts` (independently reachable) never leak charging data.
 * - When Supabase env is absent (dev without secrets) every function DEGRADES to
 *   an empty/unavailable shape — it never throws, so the screens render their
 *   empty states instead of crashing.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSessionEmail } from "@/lib/http/guards";
import type {
  ChargeKind,
  ChargeStatus,
  DocProcessingStatus,
  IngestSource,
  MatchStatus,
  PaymentMethod,
  ReceiptType,
} from "@/lib/domain";
import type {
  DeepDiveData,
  InboxData,
  OpenChargeOption,
  PaymentView,
  ReceiptBadgeKind,
  ReceiptView,
  ReviewCandidate,
  ReviewData,
  ReviewReceiptRow,
  ViewerContext,
} from "./types";

type Admin = ReturnType<typeof supabaseAdmin>;

const OPEN_STATUSES = ["pendente", "boleto_recebido", "atrasado"];
const MATCHABLE_STATUSES = [
  "pendente",
  "boleto_recebido",
  "atrasado",
  "conciliado",
  "antecipado",
  "negociada",
  "em_compensacao",
];

function chargingEnvPresent(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

/** Session-gated admin client, or null when unavailable (→ degrade to empty). */
async function gatedAdmin(): Promise<{ admin: Admin; email: string } | null> {
  if (!chargingEnvPresent()) return null;
  const email = await getSessionEmail();
  if (!email) return null;
  try {
    return { admin: supabaseAdmin(), email };
  } catch {
    return null;
  }
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toOne<T>(v: unknown): T | null {
  if (Array.isArray(v)) return (v[0] as T) ?? null;
  return (v as T) ?? null;
}

async function fetchStationNames(
  admin: Admin,
  ids: number[],
): Promise<Map<number, string | null>> {
  const map = new Map<number, string | null>();
  if (ids.length === 0) return map;
  const { data } = await admin
    .from("stations")
    .select("id, name")
    .in("id", ids);
  for (const row of (data ?? []) as unknown as {
    id: number;
    name: string | null;
  }[]) {
    map.set(row.id, row.name ?? null);
  }
  return map;
}

// ── Viewer context (write-role gating) ──────────────────────────────────────

export async function getViewerContext(): Promise<ViewerContext> {
  const email = await getSessionEmail();
  const base: ViewerContext = {
    email,
    role: null,
    isOperator: false,
    isAdmin: false,
  };
  // ROLES SUSPENDED (decision #26): any authenticated @vammo.com session with
  // Supabase configured gets full write affordances (role 'admin'), exactly
  // like getViewer() (components/admin/viewer.ts) and matching migration 8's
  // is_operator()/is_admin() → is_vammo_user() in Postgres. The old
  // charging.user_roles lookup that lived here is the restoration point.
  if (!email || !chargingEnvPresent()) return base;
  return { email, role: "admin", isOperator: true, isAdmin: true };
}

// ── Inbox ─────────────────────────────────────────────────────────────────

interface DocRow {
  id: string;
  original_filename: string | null;
  page_count: number | null;
  processing_status: DocProcessingStatus;
  processing_error: string | null;
  source: IngestSource;
  uploaded_by_email: string | null;
  created_at: string | null;
}

interface ReceiptLiteRow {
  id: string;
  document_id: string;
  match_status: MatchStatus;
}

interface PaymentStatusRow {
  receipt_id: string | null;
  charges: { status: ChargeStatus } | { status: ChargeStatus }[] | null;
}

const EMPTY_INBOX: InboxData = {
  available: false,
  rows: [],
  kpis: {
    enviadosMes: 0,
    recibosExtraidos: 0,
    conciliadosConfirmados: 0,
    aguardandoRevisao: 0,
  },
};

export async function getInboxData(): Promise<InboxData> {
  const gated = await gatedAdmin();
  if (!gated) return EMPTY_INBOX;
  const { admin } = gated;
  try {
    const { data: docData, error: docErr } = await admin
      .from("documents")
      .select(
        "id, original_filename, page_count, processing_status, processing_error, source, uploaded_by_email, created_at",
      )
      .eq("kind", "comprovante")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (docErr) return EMPTY_INBOX;
    const docs = (docData ?? []) as unknown as DocRow[];
    const docIds = docs.map((d) => d.id);

    let receipts: ReceiptLiteRow[] = [];
    if (docIds.length) {
      const { data } = await admin
        .from("receipts")
        .select("id, document_id, match_status")
        .in("document_id", docIds);
      receipts = (data ?? []) as unknown as ReceiptLiteRow[];
    }
    const receiptIds = receipts.map((r) => r.id);

    const confirmedReceiptIds = new Set<string>();
    if (receiptIds.length) {
      const { data } = await admin
        .from("payments")
        .select("receipt_id, charges(status)")
        .in("receipt_id", receiptIds);
      for (const p of (data ?? []) as unknown as PaymentStatusRow[]) {
        const charge = toOne<{ status: ChargeStatus }>(p.charges);
        if (p.receipt_id && charge?.status === "pago") {
          confirmedReceiptIds.add(p.receipt_id);
        }
      }
    }

    const byDoc = new Map<
      string,
      { total: number; conc: number; amb: number; sem: number }
    >();
    let aguardandoRevisao = 0;
    for (const r of receipts) {
      const bucket = byDoc.get(r.document_id) ?? {
        total: 0,
        conc: 0,
        amb: 0,
        sem: 0,
      };
      bucket.total += 1;
      if (
        r.match_status === "auto_matched" ||
        r.match_status === "manually_matched"
      ) {
        bucket.conc += 1;
      } else if (r.match_status === "needs_review") {
        bucket.amb += 1;
        aguardandoRevisao += 1;
      } else if (r.match_status === "unmatched") {
        bucket.sem += 1;
        aguardandoRevisao += 1;
      }
      byDoc.set(r.document_id, bucket);
    }

    const now = new Date();
    const monthStartMs = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
    ).getTime();
    const enviadosMes = docs.filter((d) => {
      if (!d.created_at) return false;
      const t = new Date(d.created_at).getTime();
      return Number.isFinite(t) && t >= monthStartMs;
    }).length;

    const rows = docs.map((d) => {
      const b = byDoc.get(d.id) ?? { total: 0, conc: 0, amb: 0, sem: 0 };
      return {
        id: d.id,
        filename: d.original_filename,
        uploadedByEmail: d.uploaded_by_email,
        createdAt: d.created_at,
        pageCount: d.page_count,
        receiptCount: b.total,
        conciliados: b.conc,
        ambiguos: b.amb,
        semCorresp: b.sem,
        processingStatus: d.processing_status,
        processingError: d.processing_error,
        source: d.source,
      };
    });

    return {
      available: true,
      rows,
      kpis: {
        enviadosMes,
        recibosExtraidos: receipts.length,
        conciliadosConfirmados: confirmedReceiptIds.size,
        aguardandoRevisao,
      },
    };
  } catch {
    return EMPTY_INBOX;
  }
}

// ── Deep-dive ─────────────────────────────────────────────────────────────

interface DocHeaderRow {
  id: string;
  original_filename: string | null;
  content_hash: string;
  uploaded_by_email: string | null;
  created_at: string | null;
  processed_at: string | null;
  processing_status: DocProcessingStatus;
  processing_error: string | null;
  page_count: number | null;
  web_view_link: string | null;
  source: IngestSource;
}

interface ReceiptRow {
  id: string;
  page_number: number;
  segment_index: number;
  receipt_type: ReceiptType;
  amount: unknown;
  paid_at: string | null;
  chave_pix: string | null;
  cnpj_cpf: string | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  identificacao: string | null;
  autenticacao: string | null;
  codigo_barras: string | null;
  ctrl: string | null;
  match_status: MatchStatus;
  matched_by_email: string | null;
  matched_at: string | null;
  match_notes: string | null;
  raw_text: string | null;
}

interface ChargeEmbed {
  id: string;
  station_id: number | null;
  kind: ChargeKind;
  competencia: string | null;
  amount: unknown;
  status: ChargeStatus;
  due_date: string | null;
  dedupe_key: string;
}

interface PaymentJoinRow {
  id: string;
  amount: unknown;
  paid_at: string | null;
  method: PaymentMethod | null;
  source: IngestSource;
  created_by_email: string | null;
  created_at: string | null;
  receipt_id: string | null;
  charge_id: string;
  charges: ChargeEmbed | ChargeEmbed[] | null;
}

const EMPTY_DEEP_DIVE: DeepDiveData = {
  available: false,
  found: false,
  document: null,
  receipts: [],
  payments: [],
  stations: [],
  totals: { receiptsSum: null, allocatedSum: 0, remaining: null },
};

export async function getDeepDiveData(
  documentId: string,
): Promise<DeepDiveData> {
  const gated = await gatedAdmin();
  if (!gated) return EMPTY_DEEP_DIVE;
  const { admin } = gated;
  try {
    const { data: docData } = await admin
      .from("documents")
      .select(
        "id, original_filename, content_hash, uploaded_by_email, created_at, processed_at, processing_status, processing_error, page_count, web_view_link, source",
      )
      .eq("id", documentId)
      .maybeSingle();
    if (!docData) return { ...EMPTY_DEEP_DIVE, available: true, found: false };
    const doc = docData as unknown as DocHeaderRow;

    const { data: recData } = await admin
      .from("receipts")
      .select(
        "id, page_number, segment_index, receipt_type, amount, paid_at, chave_pix, cnpj_cpf, banco, agencia, conta, identificacao, autenticacao, codigo_barras, ctrl, match_status, matched_by_email, matched_at, match_notes, raw_text",
      )
      .eq("document_id", documentId)
      .order("page_number", { ascending: true })
      .order("segment_index", { ascending: true });
    const recRows = (recData ?? []) as unknown as ReceiptRow[];
    const receiptIds = recRows.map((r) => r.id);

    let payRows: PaymentJoinRow[] = [];
    if (receiptIds.length) {
      const { data: payData } = await admin
        .from("payments")
        .select(
          "id, amount, paid_at, method, source, created_by_email, created_at, receipt_id, charge_id, charges(id, station_id, kind, competencia, amount, status, due_date, dedupe_key)",
        )
        .in("receipt_id", receiptIds);
      payRows = (payData ?? []) as unknown as PaymentJoinRow[];
    }

    const stationIds = [
      ...new Set(
        payRows
          .map((p) => toOne<ChargeEmbed>(p.charges)?.station_id)
          .filter((x): x is number => typeof x === "number"),
      ),
    ];
    const stationNames = await fetchStationNames(admin, stationIds);

    const payViews: PaymentView[] = payRows.map((p) => {
      const c = toOne<ChargeEmbed>(p.charges);
      const sid = c?.station_id ?? null;
      const status = c?.status ?? "pendente";
      return {
        id: p.id,
        amount: toNum(p.amount),
        paidAt: p.paid_at,
        method: p.method,
        source: p.source,
        createdByEmail: p.created_by_email,
        createdAt: p.created_at,
        receiptId: p.receipt_id,
        chargeId: c?.id ?? p.charge_id,
        chargeKind: c?.kind ?? "energia",
        chargeCompetencia: c?.competencia ?? null,
        chargeAmount: toNum(c?.amount),
        chargeStatus: status,
        chargeDueDate: c?.due_date ?? null,
        stationId: sid,
        stationName: sid !== null ? (stationNames.get(sid) ?? null) : null,
        confirmed: status === "pago",
      };
    });

    const payByReceipt = new Map<string, PaymentView[]>();
    for (const pv of payViews) {
      if (!pv.receiptId) continue;
      const arr = payByReceipt.get(pv.receiptId) ?? [];
      arr.push(pv);
      payByReceipt.set(pv.receiptId, arr);
    }

    const receipts: ReceiptView[] = recRows.map((r) => {
      const ps = payByReceipt.get(r.id) ?? [];
      const amount = toNum(r.amount);
      const allocated = ps.reduce((s, p) => s + (p.amount ?? 0), 0);
      const remaining = amount === null ? null : round2(amount - allocated);
      let badge: ReceiptBadgeKind;
      let awaitingChargeId: string | null = null;
      if (ps.length > 0) {
        const allConfirmed = ps.every((p) => p.confirmed);
        badge = allConfirmed ? "conciliado" : "awaiting";
        if (!allConfirmed) {
          awaitingChargeId =
            ps.find((p) => p.chargeStatus === "conciliado")?.chargeId ??
            ps.find((p) => !p.confirmed)?.chargeId ??
            null;
        }
      } else {
        badge = r.match_status === "needs_review" ? "ambiguous" : "unmatched";
      }
      return {
        id: r.id,
        pageNumber: r.page_number,
        segmentIndex: r.segment_index,
        receiptType: r.receipt_type,
        amount,
        paidAt: r.paid_at,
        chavePix: r.chave_pix,
        cnpjCpf: r.cnpj_cpf,
        banco: r.banco,
        agencia: r.agencia,
        conta: r.conta,
        identificacao: r.identificacao,
        autenticacao: r.autenticacao,
        codigoBarras: r.codigo_barras,
        ctrl: r.ctrl,
        matchStatus: r.match_status,
        matchedByEmail: r.matched_by_email,
        matchedAt: r.matched_at,
        matchNotes: r.match_notes,
        rawText: r.raw_text,
        remaining,
        payments: ps,
        badge,
        awaitingChargeId,
      };
    });

    const receiptsSum = recRows.reduce<number | null>((acc, r) => {
      const a = toNum(r.amount);
      if (a === null) return acc;
      return (acc ?? 0) + a;
    }, null);
    const allocatedSum = round2(
      payViews.reduce((s, p) => s + (p.amount ?? 0), 0),
    );
    const remaining =
      receiptsSum === null ? null : round2(receiptsSum - allocatedSum);

    return {
      available: true,
      found: true,
      document: {
        id: doc.id,
        filename: doc.original_filename,
        contentHash: doc.content_hash,
        uploadedByEmail: doc.uploaded_by_email,
        createdAt: doc.created_at,
        processedAt: doc.processed_at,
        processingStatus: doc.processing_status,
        processingError: doc.processing_error,
        pageCount: doc.page_count,
        webViewLink: doc.web_view_link,
        source: doc.source,
      },
      receipts,
      payments: payViews,
      stations: stationIds.map((id) => ({
        id,
        name: stationNames.get(id) ?? null,
      })),
      totals: { receiptsSum, allocatedSum, remaining },
    };
  } catch {
    return EMPTY_DEEP_DIVE;
  }
}

// ── Charge picker options ────────────────────────────────────────────────

interface ChargeOptRow {
  id: string;
  station_id: number | null;
  kind: ChargeKind;
  competencia: string | null;
  amount: unknown;
  due_date: string | null;
  status: ChargeStatus;
  dedupe_key: string;
}

export async function searchOpenChargesData(
  onlyOpen: boolean,
): Promise<OpenChargeOption[]> {
  const gated = await gatedAdmin();
  if (!gated) return [];
  const { admin } = gated;
  const statuses = onlyOpen ? OPEN_STATUSES : MATCHABLE_STATUSES;
  try {
    const { data } = await admin
      .from("charges")
      .select(
        "id, station_id, kind, competencia, amount, due_date, status, dedupe_key",
      )
      .in("status", statuses)
      .order("competencia", { ascending: false, nullsFirst: false })
      .limit(500);
    const rows = (data ?? []) as unknown as ChargeOptRow[];
    const chargeIds = rows.map((r) => r.id);

    const allocated = new Map<string, number>();
    if (chargeIds.length) {
      const { data: pd } = await admin
        .from("payments")
        .select("charge_id, amount")
        .in("charge_id", chargeIds);
      for (const p of (pd ?? []) as unknown as {
        charge_id: string;
        amount: unknown;
      }[]) {
        allocated.set(
          p.charge_id,
          (allocated.get(p.charge_id) ?? 0) + (toNum(p.amount) ?? 0),
        );
      }
    }

    const stationIds = [
      ...new Set(
        rows
          .map((r) => r.station_id)
          .filter((x): x is number => typeof x === "number"),
      ),
    ];
    const stationNames = await fetchStationNames(admin, stationIds);

    return rows.map((r) => {
      const amount = toNum(r.amount);
      const paid = allocated.get(r.id) ?? 0;
      const openAmount =
        amount === null ? null : round2(Math.max(0, amount - paid));
      return {
        id: r.id,
        kind: r.kind,
        competencia: r.competencia,
        amount,
        openAmount,
        dueDate: r.due_date,
        status: r.status,
        stationId: r.station_id,
        stationName:
          r.station_id !== null
            ? (stationNames.get(r.station_id) ?? null)
            : null,
        dedupeKey: r.dedupe_key,
      };
    });
  } catch {
    return [];
  }
}

// ── Review queue ────────────────────────────────────────────────────────────

interface ReviewRow {
  id: string;
  document_id: string;
  page_number: number;
  segment_index: number;
  receipt_type: ReceiptType;
  amount: unknown;
  paid_at: string | null;
  chave_pix: string | null;
  cnpj_cpf: string | null;
  agencia: string | null;
  conta: string | null;
  banco: string | null;
  identificacao: string | null;
  codigo_barras: string | null;
  match_status: MatchStatus;
  match_notes: string | null;
  raw_text: string | null;
  documents:
    | {
        id: string;
        original_filename: string | null;
        created_at: string | null;
        uploaded_by_email: string | null;
      }
    | {
        id: string;
        original_filename: string | null;
        created_at: string | null;
        uploaded_by_email: string | null;
      }[]
    | null;
}

/** Charge row for candidate hydration — enriched for the review confirm dialog. */
interface CandidateChargeRow {
  id: string;
  station_id: number | null;
  kind: ChargeKind;
  competencia: string | null;
  amount: unknown;
  due_date: string | null;
  status: ChargeStatus;
  dedupe_key: string;
  chave_pix: string | null;
  issuer_cnpj: string | null;
  agencia: string | null;
  conta: string | null;
  billing_accounts: unknown;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Extract candidate charge uuids the matcher recorded in `match_notes`. */
function parseCandidateIds(notes: string | null): string[] {
  if (!notes) return [];
  const idx = notes.lastIndexOf("candidatos:");
  if (idx < 0) return [];
  return notes
    .slice(idx + "candidatos:".length)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s));
}

export async function getReviewData(): Promise<ReviewData> {
  const gated = await gatedAdmin();
  if (!gated) return { available: false, rows: [] };
  const { admin } = gated;
  try {
    const { data } = await admin
      .from("receipts")
      .select(
        "id, document_id, page_number, segment_index, receipt_type, amount, paid_at, chave_pix, cnpj_cpf, agencia, conta, banco, identificacao, codigo_barras, match_status, match_notes, raw_text, documents(id, original_filename, created_at, uploaded_by_email)",
      )
      .in("match_status", ["unmatched", "needs_review"])
      .order("created_at", { ascending: false })
      .limit(500);
    const rows = (data ?? []) as unknown as ReviewRow[];

    const allCandidateIds = new Set<string>();
    const perRowCandidates = rows.map((r) => {
      const ids = parseCandidateIds(r.match_notes);
      ids.forEach((id) => allCandidateIds.add(id));
      return ids;
    });

    const candidateMap = new Map<string, ReviewCandidate>();
    if (allCandidateIds.size) {
      const { data: cd } = await admin
        .from("charges")
        .select(
          "id, station_id, kind, competencia, amount, due_date, status, dedupe_key, chave_pix, issuer_cnpj, agencia, conta, billing_accounts(counterparties(name))",
        )
        .in("id", [...allCandidateIds]);
      const charges = (cd ?? []) as unknown as CandidateChargeRow[];
      const stationIds = [
        ...new Set(
          charges
            .map((c) => c.station_id)
            .filter((x): x is number => typeof x === "number"),
        ),
      ];
      const stationNames = await fetchStationNames(admin, stationIds);
      for (const c of charges) {
        const ba = toOne<{ counterparties: unknown }>(c.billing_accounts);
        const cp = toOne<{ name: string | null }>(ba?.counterparties);
        candidateMap.set(c.id, {
          id: c.id,
          kind: c.kind,
          competencia: c.competencia,
          amount: toNum(c.amount),
          stationId: c.station_id,
          stationName:
            c.station_id !== null
              ? (stationNames.get(c.station_id) ?? null)
              : null,
          dueDate: c.due_date,
          status: c.status,
          dedupeKey: c.dedupe_key,
          counterpartyName: cp?.name ?? null,
          chavePix: c.chave_pix,
          issuerCnpj: c.issuer_cnpj,
          agencia: c.agencia,
          conta: c.conta,
        });
      }
    }

    const reviewRows: ReviewReceiptRow[] = rows.map((r, i) => {
      const doc = toOne<{
        id: string;
        original_filename: string | null;
        created_at: string | null;
        uploaded_by_email: string | null;
      }>(r.documents);
      const candidateIds = perRowCandidates[i];
      return {
        id: r.id,
        documentId: r.document_id,
        filename: doc?.original_filename ?? null,
        createdAt: doc?.created_at ?? null,
        uploadedByEmail: doc?.uploaded_by_email ?? null,
        pageNumber: r.page_number,
        segmentIndex: r.segment_index,
        receiptType: r.receipt_type,
        amount: toNum(r.amount),
        paidAt: r.paid_at,
        chavePix: r.chave_pix,
        cnpjCpf: r.cnpj_cpf,
        agencia: r.agencia,
        conta: r.conta,
        banco: r.banco,
        identificacao: r.identificacao,
        codigoBarras: r.codigo_barras,
        matchStatus: r.match_status,
        matchNotes: r.match_notes,
        rawText: r.raw_text,
        candidateIds,
        candidates: candidateIds
          .map((id) => candidateMap.get(id))
          .filter((c): c is ReviewCandidate => c !== undefined),
      };
    });

    return { available: true, rows: reviewRows };
  } catch {
    return { available: false, rows: [] };
  }
}
