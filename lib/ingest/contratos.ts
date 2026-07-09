/**
 * Contract-onboarding ingestion core (Q10, decision #10/#28) — receives the
 * n8n Fill_Cadastro_Form AI output via POST /api/ingest/contratos and STAGES it
 * in `charging.contract_intake` (status 'pending'), replacing n8n's old
 * Google-Form prefill URL + Slack message.
 *
 * Contract: the POST body carries the OpenAI extraction (the systemMessage
 * fields — swap_station_id, status_da_locacao, tipo_de_contrato, … ) plus the
 * envelope `{ drive_file_id, web_view_link, nome_arquivo }`. Fields may arrive
 * at the top level OR nested under `extractedData` / `dados` (object or JSON
 * string) — both are accepted; top-level keys win.
 *
 * Rules (mirror the email-cobrança flow):
 *  - NO AI here: n8n does all extraction; the app only stages + lets a human
 *    confirm. The confirm (charging.confirm_contract_intake RPC) is the only
 *    path that creates a real contract — decision #8's trust boundary.
 *  - Document deduped by sha256 `content_hash` (kind 'contrato', source
 *    'email_ai', drive_folder_kind 'other'); a Drive-download failure throws
 *    ContratoIngestError(422) so n8n retries.
 *  - Intake upserted by `drive_file_id` (idempotent re-delivery): a redelivery
 *    of a still-`pending` intake refreshes the raw extraction; a redelivery of
 *    an already confirmed/rejected intake is left UNTOUCHED (never reopened —
 *    same idempotency fix as cobrancas H4).
 *
 * No `server-only` here: the Drive download is injected so the pure mapping is
 * unit-testable (mirrors cobrancas.ts / runSheetSync).
 */

import { z } from "zod";

import type { ChargingClient } from "@/lib/data/supabase-repository";
import {
  DOCUMENT_KIND,
  PAYMENT_METHOD,
  STATION_STATUS,
  type ContractType,
  type PaymentMethod,
  type StationStatus,
} from "@/lib/domain";
import {
  CONTRACT_TYPE_MAP,
  PAYMENT_METHOD_MAP,
  cleanCell,
  deaccent,
} from "@/lib/ingest/normalize";
import { pdfPageCount, PdfEncryptedError } from "@/lib/comprovantes/extract";
import { validateUpload } from "@/lib/uploads/validate";

// ── payload schema (lenient — envelope only; AI keys ride along loosely) ─────

export const ContratoPayloadSchema = z
  .object({
    drive_file_id: z.string().nullish(),
    web_view_link: z.string().nullish(),
    webViewLink: z.string().nullish(),
    nome_arquivo: z.string().nullish(),
    // n8n sometimes nests the AI output under `extractedData` / `dados`
    // (object or JSON string) — unwrapped in parseContratoPayload().
    extractedData: z.unknown().nullish(),
    dados: z.unknown().nullish(),
  })
  .loose();

export type ContratoPayload = z.infer<typeof ContratoPayloadSchema>;

/** The AI extraction keys from the n8n systemMessage (see context/Fill_Cadastro_Form.json). */
const AI_KEYS = [
  "swap_station_id",
  "status_da_locacao",
  "numero_da_conexao",
  "endereco_completo",
  "parceiro_locador",
  "nome_do_contato",
  "telefone",
  "email",
  "cnpj_ou_cpf",
  "tipo_de_contrato",
  "qtd_boxes_por_box",
  "valor_por_box",
  "qtd_boxes_por_box_minimo",
  "minimo_boxes",
  "valor_por_box_minimo",
  "qtd_boxes_fixo",
  "valor_mensal_fixo",
  "dia_vencimento",
  "tipo_pagamento",
  "chave_pix",
  "banco",
  "agencia",
  "conta",
  "observacoes",
] as const;

export interface ParsedContratoPayload {
  /** The raw AI extraction (stored verbatim in contract_intake.ai_extraction). */
  extraction: Record<string, unknown>;
  driveFileId: string;
  webViewLink: string | null;
  nomeArquivo: string | null;
}

export class ContratoIngestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ContratoIngestError";
  }
}

/**
 * Parses + unwraps the POST body: pulls the AI extraction from `extractedData`/
 * `dados` (object or JSON string) and/or the top level (top-level keys win).
 * Throws ContratoIngestError(400) on shape failure.
 */
export function parseContratoPayload(body: unknown): ParsedContratoPayload {
  const parsed = ContratoPayloadSchema.safeParse(body);
  if (!parsed.success) {
    throw new ContratoIngestError(400, `payload inválido: ${parsed.error.message}`);
  }
  const p = parsed.data as Record<string, unknown>;

  let extraction: Record<string, unknown> = {};
  const nested = p.extractedData ?? p.dados;
  if (nested != null) {
    let obj: unknown = nested;
    if (typeof obj === "string") {
      try {
        obj = JSON.parse(obj);
      } catch {
        throw new ContratoIngestError(400, "campo 'extractedData'/'dados' não é JSON válido");
      }
    }
    if (obj && typeof obj === "object") {
      extraction = { ...(obj as Record<string, unknown>) };
    }
  }
  // top-level AI keys win over the nested copy
  for (const k of AI_KEYS) {
    if (p[k] !== undefined) extraction[k] = p[k];
  }

  return {
    extraction,
    driveFileId: cleanCell(String(p.drive_file_id ?? "")),
    webViewLink: (p.web_view_link ?? p.webViewLink ?? null) as string | null,
    nomeArquivo: (p.nome_arquivo ?? null) as string | null,
  };
}

// ── pt-BR → enum prefill (for the review dialog) ─────────────────────────────

/** status_da_locacao ("Ativa"|"Em negociação"|"Suspensa") → charging.station_status. */
const STATUS_LOCACAO_MAP: Record<string, StationStatus> = {
  ativa: STATION_STATUS.ACTIVE,
  "em negociacao": STATION_STATUS.PRE_INSTALLATION,
  suspensa: STATION_STATUS.INACTIVE,
};

export interface ContractIntakePrefill {
  swapStationId: number | null;
  status: StationStatus;
  contractType: ContractType | null;
  counterpartyName: string | null;
  counterpartyCnpj: string | null;
  numeroConexao: string | null;
  endereco: string | null;
  contato: string | null;
  telefone: string | null;
  email: string | null;
  boxCount: number | null;
  minBox: number | null;
  valorPorBox: number | null;
  valorMensal: number | null;
  dueDay: number | null;
  paymentMethod: PaymentMethod | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chavePix: string | null;
  observacoes: string | null;
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = cleanCell(String(v));
  return s === "" ? null : s;
}

/** Tolerant number parse (AI emits en-US plain numbers; pt-BR handled defensively). */
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/[r$\s]/gi, "");
  if (s === "") return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
}

function toInt(v: unknown): number | null {
  const n = toNum(v);
  return n === null ? null : Math.trunc(n);
}

/**
 * Maps a raw AI extraction to typed defaults for the confirm dialog, reusing the
 * canonical normalize.ts maps (CONTRACT_TYPE_MAP / PAYMENT_METHOD_MAP). The
 * modality-specific box/valor fields are coalesced into the contract's generic
 * columns. CPF/CNPJ is NOT normalized here (the server action does that right
 * before the RPC); the dialog shows what the AI extracted.
 */
export function contractIntakePrefill(extraction: Record<string, unknown>): ContractIntakePrefill {
  const e = extraction;

  const statusRaw = deaccent(String(e.status_da_locacao ?? "").toLowerCase().trim());
  const status = STATUS_LOCACAO_MAP[statusRaw] ?? STATION_STATUS.ACTIVE;

  const typeRaw = deaccent(String(e.tipo_de_contrato ?? "").toLowerCase().trim());
  const contractType = CONTRACT_TYPE_MAP[typeRaw] ?? null;

  const payRaw = deaccent(String(e.tipo_pagamento ?? "").toLowerCase().trim());
  const paymentMethod: PaymentMethod | null = payRaw.includes("telefone")
    ? PAYMENT_METHOD.boletoCelular // n8n's "Boleto (telefone)" ≡ the "celular" boleto
    : (PAYMENT_METHOD_MAP[payRaw] ??
        (payRaw.startsWith("boleto")
          ? PAYMENT_METHOD.boletoEmail
          : payRaw !== ""
            ? PAYMENT_METHOD.outro
            : null));

  return {
    swapStationId: toInt(e.swap_station_id),
    status,
    contractType,
    counterpartyName: strOrNull(e.parceiro_locador),
    counterpartyCnpj: strOrNull(e.cnpj_ou_cpf),
    numeroConexao: strOrNull(e.numero_da_conexao),
    endereco: strOrNull(e.endereco_completo),
    contato: strOrNull(e.nome_do_contato),
    telefone: strOrNull(e.telefone),
    email: strOrNull(e.email),
    // modality-specific fields → generic contract columns
    boxCount:
      toInt(e.qtd_boxes_por_box) ??
      toInt(e.qtd_boxes_por_box_minimo) ??
      toInt(e.qtd_boxes_fixo),
    minBox: toInt(e.minimo_boxes),
    valorPorBox: toNum(e.valor_por_box) ?? toNum(e.valor_por_box_minimo),
    valorMensal: toNum(e.valor_mensal_fixo),
    dueDay: toInt(e.dia_vencimento),
    paymentMethod,
    banco: strOrNull(e.banco),
    agencia: strOrNull(e.agencia),
    conta: strOrNull(e.conta),
    chavePix: strOrNull(e.chave_pix),
    observacoes: strOrNull(e.observacoes),
  };
}

// ── DB processing ────────────────────────────────────────────────────────────

export interface ContratoIngestStats {
  documentId: string | null;
  documentReused: boolean;
  intakeId: string | null;
  intakeReused: boolean;
  status: "pending" | "confirmed" | "rejected" | null;
  warnings: string[];
}

async function one<T>(
  q: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  what: string,
): Promise<T | null> {
  const { data, error } = await q;
  if (error) throw new ContratoIngestError(500, `${what}: ${error.message}`);
  return (data as T) ?? null;
}

/**
 * Full webhook processing: download the PDF → dedupe the document by
 * content_hash → upsert the `contract_intake` row by drive_file_id → one audit
 * event. `download` is injected (Drive SA in prod, a stub in tests). NO AI.
 */
export async function ingestContratoPayload(
  admin: ChargingClient,
  payload: ParsedContratoPayload,
  download: (fileId: string) => Promise<Buffer>,
): Promise<ContratoIngestStats> {
  const stats: ContratoIngestStats = {
    documentId: null,
    documentReused: false,
    intakeId: null,
    intakeReused: false,
    status: null,
    warnings: [],
  };

  const driveFileId = payload.driveFileId;
  if (driveFileId === "") {
    throw new ContratoIngestError(422, "drive_file_id ausente no payload");
  }

  // ── document (dedupe by sha256; Drive failure → 422 so n8n retries) ──────
  let buffer: Buffer;
  try {
    buffer = await download(driveFileId);
  } catch (err) {
    throw new ContratoIngestError(
      422,
      `falha ao baixar o PDF do Drive (${driveFileId}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const v = validateUpload(
    {
      buffer,
      // Trusted server-side Drive download, validated by magic bytes below —
      // ensure a `.pdf` name so the extension gate doesn't 422 a genuine PDF
      // whose Drive title lacks the extension (review finding).
      filename:
        payload.nomeArquivo && /\.pdf$/i.test(payload.nomeArquivo)
          ? payload.nomeArquivo
          : `${driveFileId}.pdf`,
      claimedMime: "application/pdf",
    },
    "pdf",
  );
  if (!v.ok) throw new ContratoIngestError(422, v.error);

  const existingDoc = await one<{ id: string }>(
    admin.from("documents").select("id").eq("content_hash", v.sha256).maybeSingle(),
    "documents read",
  );
  let documentId: string;
  if (existingDoc) {
    documentId = existingDoc.id;
    stats.documentReused = true;
  } else {
    let pageCount: number | null = null;
    try {
      pageCount = await pdfPageCount(buffer);
    } catch (err) {
      if (!(err instanceof PdfEncryptedError)) {
        stats.warnings.push("contagem de páginas falhou");
      }
    }
    const inserted = await one<{ id: string }>(
      admin
        .from("documents")
        .insert({
          kind: DOCUMENT_KIND.contrato,
          source: "email_ai",
          drive_file_id: driveFileId,
          drive_folder_kind: "other", // n8n's Contratos_Aluguel watch folder
          web_view_link: payload.webViewLink ?? null,
          original_filename: payload.nomeArquivo ?? null,
          content_hash: v.sha256,
          mime_type: "application/pdf",
          byte_size: buffer.length,
          page_count: pageCount,
          processing_status: "processed",
        })
        .select("id")
        .single(),
      "documents insert",
    );
    if (!inserted) throw new ContratoIngestError(500, "falha ao registrar o documento");
    documentId = inserted.id;
  }
  stats.documentId = documentId;

  // ── contract_intake (dedupe by the PDF's DOCUMENT — content_hash-stable, so
  // the SAME contract re-uploaded under a new drive_file_id maps to the SAME
  // intake instead of a duplicate pending row that could confirm into a second
  // contract; review finding) ──
  const existingIntake = await one<{ id: string; status: ContratoIngestStats["status"] }>(
    admin
      .from("contract_intake")
      .select("id, status")
      .eq("document_id", documentId)
      .maybeSingle(),
    "contract_intake read",
  );
  if (existingIntake) {
    stats.intakeId = existingIntake.id;
    stats.intakeReused = true;
    stats.status = existingIntake.status;
    if (existingIntake.status === "pending") {
      // refresh the raw extraction + document link with the latest delivery;
      // a confirmed/rejected intake is left untouched (never reopened).
      const { error } = await admin
        .from("contract_intake")
        .update({
          ai_extraction: payload.extraction,
          document_id: documentId,
          web_view_link: payload.webViewLink ?? null,
          nome_arquivo: payload.nomeArquivo ?? null,
        })
        .eq("id", existingIntake.id);
      if (error) {
        throw new ContratoIngestError(500, `contract_intake update: ${error.message}`);
      }
    }
  } else {
    const inserted = await one<{ id: string }>(
      admin
        .from("contract_intake")
        .insert({
          document_id: documentId,
          drive_file_id: driveFileId,
          web_view_link: payload.webViewLink ?? null,
          nome_arquivo: payload.nomeArquivo ?? null,
          ai_extraction: payload.extraction,
          status: "pending",
        })
        .select("id")
        .single(),
      "contract_intake insert",
    );
    if (!inserted) {
      throw new ContratoIngestError(500, "falha ao registrar o cadastro de contrato");
    }
    stats.intakeId = inserted.id;
    stats.status = "pending";
  }

  // one audit event per delivery (machine ingestion)
  await admin.from("audit_events").insert({
    entity_table: "contract_intake",
    entity_id: stats.intakeId ?? `ingest-contratos:${driveFileId}`,
    event_type: "intake_received",
    actor_email: "system:ingest-contratos",
    detail: {
      document_id: documentId,
      document_reused: stats.documentReused,
      intake_reused: stats.intakeReused,
      status: stats.status,
      drive_file_id: driveFileId,
      nome_arquivo: payload.nomeArquivo ?? null,
      web_view_link: payload.webViewLink ?? null,
      ai_extraction: payload.extraction, // excess-of-info: raw AI output retained
    },
  });

  return stats;
}
