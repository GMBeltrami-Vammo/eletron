/**
 * Email-cobrança ingestion core (Phase 2.5 R2, decision #27) — receives the
 * n8n boleto_aluguel AI output via POST /api/ingest/cobrancas and lands it in
 * `charging`, replacing the old n8n → 2_Pagamentos sheet append.
 *
 * Contract (H2): the POST body is what the n8n "Edit Fields" node carries —
 * `{ cobrancas: [...], nome_arquivo, drive_file_id, web_view_link, remetente,
 * gmail_message_id }` — with the AI's accented/spaced keys mapped explicitly
 * below; missing fields are tolerated (lenient zod). `dados` may arrive as a
 * nested object or a JSON string; both are accepted.
 *
 * Rules implemented here (plan review resolutions):
 *  - C1: a MATCHED `aluguel` cobrança claims `pag:{cadastro}:{YYYY-MM}:aluguel`
 *    so gerar_mes and the email flow converge on ONE charge in both orders;
 *    UNIDENTIFIED / energy-bearing cobranças use
 *    `email:{drive_file_id}:{kind}:{competencia}` (+`#n` in-payload suffix).
 *  - H3: attribution replicates normalize.ts's 2_Pagamentos branch — aluguel →
 *    the cadastro's rent account (created if the hub row is missing); energia /
 *    aluguel_energia → counterparty upsert (cnpj, else exact name) +
 *    third_party account keyed (counterparty, station, external_ref='').
 *  - H4: an EXISTING charge is only ever advanced pendente → boleto_recebido;
 *    any other status keeps status/status_source untouched — the webhook just
 *    attaches the document + fills empty payment fields.
 *  - M5: the document is deduped by sha256 `content_hash` (redelivery reuses
 *    the row); a Drive download failure throws CobrancasIngestError(422) so
 *    n8n retries.
 *  - Requirement 4.1: everything the webhook creates or touches lands
 *    `match_status='needs_review'` — the user must check and may reclassify.
 *
 * No `server-only` here: the Drive download is injected (like runSheetSync's
 * loadRaw) so the pure mapping is unit-testable.
 */

import { z } from "zod";

import type { ChargingClient } from "@/lib/data/supabase-repository";
import {
  CHARGE_KIND,
  DOCUMENT_KIND,
  PAYMENT_METHOD,
  type ChargeKind,
  type PaymentMethod,
} from "@/lib/domain";
import {
  CHARGE_KIND_MAP,
  PAYMENT_METHOD_MAP,
  cleanCell,
  deaccent,
  digitsOnly,
  normalizeCnpjCpf,
  parseCompetenciaFromMesAno,
  parseValorCell,
  type ParsedValorCell,
} from "@/lib/ingest/normalize";
import { pdfPageCount, PdfEncryptedError } from "@/lib/comprovantes/extract";
import { validateUpload } from "@/lib/uploads/validate";

// ── payload schema (lenient — n8n AI output keys mapped explicitly) ─────────

const strnum = z.union([z.string(), z.number()]).nullish();

const CobrancaSchema = z
  .object({
    status: z.string().nullish(),
    cadastro_id: strnum,
    swap_station_id: strnum,
    Mês: strnum,
    Mes: strnum, // deaccented variant
    Ano: strnum,
    "Tipo de Cobrança": z.string().nullish(),
    "Tipo de Cobranca": z.string().nullish(),
    Parceiro: z.string().nullish(),
    CNPJ: strnum,
    Valor: strnum,
    Endereço: z.string().nullish(),
    Endereco: z.string().nullish(),
    "Tipo de Pagamento": z.string().nullish(),
    Banco: strnum,
    Agência: strnum,
    Agencia: strnum,
    "Conta Corrente": strnum,
    "Chave Pix / Código do Boleto": strnum,
    "Chave Pix / Codigo do Boleto": strnum,
    // v2 (spec 2026-07-11): due date for the "A pagar" queue + per-line ND
    // reference for the banco proposals. Extra keys still flow into `raw`.
    Vencimento: z.string().nullish(),
    "Valor Documento": strnum,
    "Referencia no Documento": z.string().nullish(),
  })
  .loose();

export const CobrancasPayloadSchema = z
  .object({
    cobrancas: z.array(CobrancaSchema).default([]),
    // n8n's Edit Fields sometimes nests the AI output under `dados` (object or
    // JSON string) — accepted and unwrapped in parsePayload().
    dados: z.unknown().nullish(),
    nome_arquivo: z.string().nullish(),
    drive_file_id: z.string().nullish(),
    web_view_link: z.string().nullish(),
    webViewLink: z.string().nullish(),
    remetente: z.string().nullish(),
    gmail_message_id: z.string().nullish(),
  })
  .loose();

export type RawCobranca = z.infer<typeof CobrancaSchema>;
export type CobrancasPayload = z.infer<typeof CobrancasPayloadSchema>;

export class CobrancasIngestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CobrancasIngestError";
  }
}

/**
 * Parses + unwraps the POST body: `dados` (object or JSON string) may carry
 * `cobrancas`; top-level keys win. Throws CobrancasIngestError(400) on shape
 * failure.
 */
export function parsePayload(body: unknown): CobrancasPayload {
  const parsed = CobrancasPayloadSchema.safeParse(body);
  if (!parsed.success) {
    throw new CobrancasIngestError(400, `payload inválido: ${parsed.error.message}`);
  }
  const payload = parsed.data;
  if (payload.cobrancas.length === 0 && payload.dados != null) {
    let dados: unknown = payload.dados;
    if (typeof dados === "string") {
      try {
        dados = JSON.parse(dados);
      } catch {
        throw new CobrancasIngestError(400, "campo 'dados' não é JSON válido");
      }
    }
    const inner = z.object({ cobrancas: z.array(CobrancaSchema).default([]) }).loose().safeParse(dados);
    if (inner.success) payload.cobrancas = inner.data.cobrancas;
  }
  return payload;
}

// ── pure normalization ──────────────────────────────────────────────────────

export type CobrancaStatus = "MATCHED" | "UNIDENTIFIED" | "NOT_A_BILL";

export interface NormalizedCobranca {
  status: CobrancaStatus;
  cadastroId: number | null;
  stationId: number | null;
  kind: ChargeKind;
  kindKnown: boolean;
  /**
   * 'YYYY-MM-01' or null. n8n's AI derives the fallback month from the
   * vencimento with the canonical day-20 rule (decision #45 — same clock as
   * the matcher's `pinnedCompetencia`); a competência stated in the document
   * always wins over the fallback.
   */
  competencia: string | null;
  /** Boleto due date 'YYYY-MM-DD' (v2 `Vencimento`) — drives the A-pagar queue. */
  dueDate: string | null;
  valor: ParsedValorCell;
  parceiro: string | null;
  cnpj: string | null;
  endereco: string | null;
  paymentMethod: PaymentMethod | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chavePix: string | null;
  linhaDigitavel: string | null;
  raw: RawCobranca;
}

function str(v: string | number | null | undefined): string {
  return v === null || v === undefined ? "" : cleanCell(String(v));
}

function toInt(v: string | number | null | undefined): number | null {
  const s = str(v);
  if (s === "") return null;
  const n = Number.parseInt(s, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function normalizeCobranca(raw: RawCobranca): NormalizedCobranca {
  const statusRaw = str(raw.status).toUpperCase();
  const status: CobrancaStatus =
    statusRaw === "MATCHED" || statusRaw === "NOT_A_BILL"
      ? statusRaw
      : "UNIDENTIFIED";

  const kindRaw = deaccent(
    str(raw["Tipo de Cobrança"] ?? raw["Tipo de Cobranca"]).toLowerCase(),
  );
  const kind = CHARGE_KIND_MAP[kindRaw] ?? CHARGE_KIND.aluguel;

  const competencia = parseCompetenciaFromMesAno(
    str(raw["Mês"] ?? raw.Mes),
    str(raw.Ano),
  );

  // v2 Vencimento: accept ISO 'YYYY-MM-DD' or pt-BR 'DD/MM/YYYY'.
  const vencRaw = str(raw.Vencimento);
  let dueDate: string | null = null;
  {
    const iso = vencRaw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const br = vencRaw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (iso) dueDate = vencRaw;
    else if (br)
      dueDate = `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  }

  const payRaw = deaccent(str(raw["Tipo de Pagamento"]).toLowerCase());
  const paymentMethod: PaymentMethod | null =
    PAYMENT_METHOD_MAP[payRaw] ??
    (payRaw.startsWith("boleto")
      ? PAYMENT_METHOD.boletoEmail
      : payRaw !== ""
        ? PAYMENT_METHOD.outro
        : null);

  // 'Chave Pix / Código do Boleto': a 47/48-digit linha digitável vs a pix key.
  const pixOrBoleto = str(
    raw["Chave Pix / Código do Boleto"] ?? raw["Chave Pix / Codigo do Boleto"],
  );
  const pixDigits = digitsOnly(pixOrBoleto) ?? "";
  const isLinha = pixDigits.length >= 30;

  // Canonical CPF/CNPJ (restores stripped leading zeros, nulls real garbage) so
  // it passes the counterparties.cnpj_cpf CHECK instead of crashing the webhook.
  // The raw value survives in `raw`/the audit event.
  const cnpj = normalizeCnpjCpf(str(raw.CNPJ));

  return {
    status,
    cadastroId: toInt(raw.cadastro_id),
    stationId: toInt(raw.swap_station_id),
    kind,
    kindKnown: CHARGE_KIND_MAP[kindRaw] !== undefined,
    competencia,
    dueDate,
    valor: parseValorCell(str(raw.Valor)),
    parceiro: str(raw.Parceiro) || null,
    cnpj,
    endereco: str(raw["Endereço"] ?? raw.Endereco) || null,
    paymentMethod,
    banco: str(raw.Banco) || null,
    agencia: str(raw["Agência"] ?? raw.Agencia) || null,
    conta: str(raw["Conta Corrente"]) || null,
    chavePix: !isLinha && pixOrBoleto !== "" ? pixOrBoleto : null,
    linhaDigitavel: isLinha ? pixDigits : null,
    raw,
  };
}

/**
 * ONE dedupe recipe per logical charge (decision #20 + C1): MATCHED aluguel
 * with cadastro + competência claims the gerar_mes `pag:` key; everything else
 * gets the content-derived email key. `taken` tracks in-payload collisions —
 * the `#n` suffix is deterministic across re-deliveries of the same payload.
 *
 * `documentKey` MUST be the app's `documents.id` (content-hash-deduped), NEVER
 * the payload's drive_file_id: n8n re-uploads the same PDF under a NEW Drive id
 * on every redelivery, so a drive-based key would mint a duplicate charge per
 * redelivery (live batch 2026-07-12: the same ORION boleto created twice).
 */
export function cobrancaDedupeKey(
  c: NormalizedCobranca,
  documentKey: string,
  taken: Map<string, number>,
): string {
  const base =
    c.status === "MATCHED" &&
    c.kind === CHARGE_KIND.aluguel &&
    c.cadastroId !== null &&
    c.competencia !== null
      ? `pag:${c.cadastroId}:${c.competencia.slice(0, 7)}:aluguel`
      : `email:${documentKey}:${c.kind}:${c.competencia?.slice(0, 7) ?? "na"}`;
  const count = (taken.get(base) ?? 0) + 1;
  taken.set(base, count);
  return count === 1 ? base : `${base}#${count}`;
}

// ── DB processing ───────────────────────────────────────────────────────────

export interface IngestStats {
  documentId: string | null;
  documentReused: boolean;
  created: number;
  converged: number;
  statusAdvanced: number;
  notABill: number;
  warnings: string[];
}

interface ChargeRowLite {
  id: string;
  status: string;
  amount: number | null;
  expected_amount: number | null;
  flags: unknown;
  source_document_id: string | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chave_pix: string | null;
  linha_digitavel: string | null;
  payment_method: string | null;
  email_sender: string | null;
  due_date: string | null;
}

async function one<T>(
  q: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  what: string,
): Promise<T | null> {
  const { data, error } = await q;
  if (error) throw new CobrancasIngestError(500, `${what}: ${error.message}`);
  return (data as T) ?? null;
}

/** "Name <a@b.com>" or a bare address → lowercased address (mirrors SQL normalize_sender). */
export function normalizeSender(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // n8n may send a single "Name <a@b>" OR a ";/,"-joined list of the e-mails
  // involved (body extraction). Internal forwards make @vammo.com addresses
  // useless for sender→station matching/learning — take the FIRST external
  // address; never store an internal one.
  const parts = raw.split(/[;,]/);
  for (const part of parts) {
    const m = part.match(/<([^>]+)>/);
    const addr = (m ? m[1] : part).trim().toLowerCase();
    if (!addr || !addr.includes("@")) continue;
    if (addr.endsWith("@vammo.com")) continue;
    return addr;
  }
  return null;
}

/**
 * ALL distinct addresses in the ";/,"-joined `remetente` list (sender +
 * involved), lowercased, order-preserved — for document traceability (#47).
 * Unlike normalizeSender this keeps @vammo.com forwards too: the point is the
 * full provenance of who the API received the document through.
 */
export function parseInvolvedAddresses(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[;,]/)) {
    const m = part.match(/<([^>]+)>/);
    const addr = (m ? m[1] : part).trim().toLowerCase();
    if (!addr || !addr.includes("@") || seen.has(addr)) continue;
    seen.add(addr);
    out.push(addr);
  }
  return out;
}

export interface DocumentEmailContext {
  addresses: string[];
  remetente_raw: string | null;
}

/** email_context for a document row from the webhook payload (null when no sender). */
export function buildEmailContext(
  remetente: string | null | undefined,
): DocumentEmailContext | null {
  const raw = cleanCell(remetente);
  const addresses = parseInvolvedAddresses(raw);
  if (addresses.length === 0 && !raw) return null;
  return { addresses, remetente_raw: raw || null };
}

/**
 * Pure union of an existing document email_context with an incoming one:
 * accumulates addresses (order-preserved, deduped), keeps the first non-null
 * remetente_raw. Returns null when there is nothing to change (so the caller
 * can skip the UPDATE). Exported for unit testing.
 */
export function unionEmailContext(
  existing: DocumentEmailContext | null,
  incoming: DocumentEmailContext | null,
): DocumentEmailContext | null {
  if (!incoming) return null;
  const base = existing?.addresses ?? [];
  const merged = [...base];
  const seen = new Set(base);
  for (const a of incoming.addresses) {
    if (!seen.has(a)) {
      seen.add(a);
      merged.push(a);
    }
  }
  const remetente_raw = existing?.remetente_raw ?? incoming.remetente_raw ?? null;
  const changed =
    merged.length !== base.length || remetente_raw !== (existing?.remetente_raw ?? null);
  if (!changed) return null;
  return { addresses: merged, remetente_raw };
}

/**
 * Best-effort merge of the incoming addresses into a reused document's
 * email_context (same PDF redelivered from a new forward/address). Never fails
 * ingest — a traceability update is not worth a 500.
 */
async function mergeDocumentEmailContext(
  admin: ChargingClient,
  documentId: string,
  incoming: DocumentEmailContext | null,
): Promise<void> {
  if (!incoming) return;
  try {
    const row = await one<{ email_context: DocumentEmailContext | null }>(
      admin.from("documents").select("email_context").eq("id", documentId).maybeSingle(),
      "documents email_context read",
    );
    const next = unionEmailContext(row?.email_context ?? null, incoming);
    if (!next) return;
    await admin.from("documents").update({ email_context: next }).eq("id", documentId);
  } catch {
    /* traceability merge is best-effort */
  }
}

/**
 * Resolves (or creates) the attribution account per H3. Returns nulls when
 * unattributable. `senderStationId` (feature B) is a learned sender→station
 * hint used only when the AI gave no station.
 */
async function resolveAccount(
  admin: ChargingClient,
  c: NormalizedCobranca,
  warnings: string[],
  senderStationId: number | null,
): Promise<{ billingAccountId: string | null; stationId: number | null }> {
  // station id only kept when it actually exists (FK safety)
  let stationId: number | null = null;
  let stationFromSender = false;
  if (c.stationId !== null) {
    const st = await one<{ id: number }>(
      admin.from("stations").select("id").eq("id", c.stationId).maybeSingle(),
      "stations read",
    );
    if (st) stationId = c.stationId;
    else warnings.push(`estação ${c.stationId} não existe — mantida sem estação`);
  }
  // Feature B: fall back to the sender→station mapping when the AI gave none.
  if (stationId === null && senderStationId !== null) {
    stationId = senderStationId;
    stationFromSender = true;
    warnings.push(`estação ${senderStationId} inferida pelo remetente`);
  }

  const isEnergyBearing =
    c.kind === CHARGE_KIND.energia || c.kind === CHARGE_KIND.aluguelEnergia;

  if (!isEnergyBearing) {
    if (c.cadastroId === null) {
      // No cadastro, but a SENDER-inferred station → attach to that station's
      // active contract's rent account (≤1 ACTIVE per station is guaranteed by
      // the one_active_contract_per_station index). Only for sender-inferred
      // stations — an AI-classified charge with a station but no cadastro keeps
      // its prior behavior (billing_account null), unchanged by feature B.
      if (stationFromSender && stationId !== null) {
        const contract = await one<{ id: string }>(
          admin
            .from("contracts")
            .select("id")
            .eq("station_id", stationId)
            .eq("status", "ACTIVE")
            .limit(1)
            .maybeSingle(),
          "contracts by station read",
        );
        if (contract) {
          const acct = await one<{ id: string }>(
            admin
              .from("billing_accounts")
              .select("id")
              .eq("contract_id", contract.id)
              .eq("account_type", "rent")
              .maybeSingle(),
            "billing_accounts read",
          );
          if (acct) return { billingAccountId: acct.id, stationId };
        }
      }
      return { billingAccountId: null, stationId };
    }
    const contract = await one<{ id: string; station_id: number | null }>(
      admin
        .from("contracts")
        .select("id, station_id")
        .eq("cadastro_id", c.cadastroId)
        .maybeSingle(),
      "contracts read",
    );
    if (!contract) {
      warnings.push(`cadastro ${c.cadastroId} sem contrato — cobrança sem conta`);
      return { billingAccountId: null, stationId };
    }
    const acct = await one<{ id: string }>(
      admin
        .from("billing_accounts")
        .select("id")
        .eq("contract_id", contract.id)
        .eq("account_type", "rent")
        .maybeSingle(),
      "billing_accounts read",
    );
    if (acct) {
      return { billingAccountId: acct.id, stationId: contract.station_id ?? stationId };
    }
    // hub row missing — create it (mirrors reclassify_charge's behavior)
    const created = await one<{ id: string }>(
      admin
        .from("billing_accounts")
        .insert({
          station_id: contract.station_id,
          account_type: "rent",
          contract_id: contract.id,
          match_status: contract.station_id === null ? "unmatched" : "needs_review",
        })
        .select("id")
        .single(),
      "billing_accounts insert",
    );
    return {
      billingAccountId: created?.id ?? null,
      stationId: contract.station_id ?? stationId,
    };
  }

  // energy-bearing → counterparty + third_party account (normalize.ts branch)
  const parceiro = /^unidentified$/i.test(c.parceiro ?? "") ? null : c.parceiro;
  if (c.cnpj === null && parceiro === null) {
    return { billingAccountId: null, stationId };
  }
  let cp: { id: string } | null = null;
  if (c.cnpj !== null) {
    cp = await one<{ id: string }>(
      admin.from("counterparties").select("id").eq("cnpj_cpf", c.cnpj).maybeSingle(),
      "counterparties read",
    );
  }
  if (!cp && parceiro !== null) {
    cp = await one<{ id: string }>(
      admin
        .from("counterparties")
        .select("id")
        .eq("name", parceiro)
        .limit(1)
        .maybeSingle(),
      "counterparties read",
    );
  }
  if (!cp) {
    cp = await one<{ id: string }>(
      admin
        .from("counterparties")
        .insert({ name: parceiro ?? c.cnpj, cnpj_cpf: c.cnpj, kind: "outro" })
        .select("id")
        .single(),
      "counterparties insert",
    );
  }
  if (!cp) return { billingAccountId: null, stationId };

  // third_party account on (counterparty, station, external_ref='') — station
  // null-safe match done client-side (PostgREST can't is-not-distinct-from).
  const candidates =
    (await one<{ id: string; station_id: number | null; external_ref: string | null }[]>(
      admin
        .from("billing_accounts")
        .select("id, station_id, external_ref")
        .eq("account_type", "third_party")
        .eq("counterparty_id", cp.id),
      "billing_accounts read",
    )) ?? [];
  const hit = candidates.find(
    (a) => (a.external_ref ?? "") === "" && a.station_id === stationId,
  );
  if (hit) return { billingAccountId: hit.id, stationId };

  const created = await one<{ id: string }>(
    admin
      .from("billing_accounts")
      .insert({
        station_id: stationId,
        account_type: "third_party",
        counterparty_id: cp.id,
        match_status: stationId === null ? "unmatched" : "needs_review",
      })
      .select("id")
      .single(),
    "billing_accounts insert",
  );
  return { billingAccountId: created?.id ?? null, stationId };
}

/**
 * Full webhook processing: document upsert by content_hash → per-cobrança
 * charge create/converge → one audit summary event. `download` is injected
 * (Drive SA in prod, a stub in tests).
 */
export async function ingestCobrancasPayload(
  admin: ChargingClient,
  payload: CobrancasPayload,
  download: (fileId: string) => Promise<Buffer>,
): Promise<IngestStats> {
  const normalized = payload.cobrancas.map(normalizeCobranca);
  const bills = normalized.filter((c) => c.status !== "NOT_A_BILL");
  const stats: IngestStats = {
    documentId: null,
    documentReused: false,
    created: 0,
    converged: 0,
    statusAdvanced: 0,
    notABill: normalized.length - bills.length,
    warnings: [],
  };

  const driveFileId = cleanCell(payload.drive_file_id ?? "");
  const gmailId = cleanCell(payload.gmail_message_id ?? "") || null;

  // Feature B: normalize the email sender once and resolve any learned
  // sender→station mapping. Stored on each charge; used to pre-fill the station
  // when the AI gave none. Mappings are LEARNED on human reclassify, never here.
  const senderEmail = normalizeSender(payload.remetente);
  // Full involved-address list tagged to the document for traceability (#47).
  const emailContext = buildEmailContext(payload.remetente);
  let senderStationId: number | null = null;
  if (senderEmail) {
    const senderRow = await one<{ station_id: number }>(
      admin
        .from("station_senders")
        .select("station_id")
        .eq("sender_email", senderEmail)
        .maybeSingle(),
      "station_senders read",
    );
    senderStationId = senderRow?.station_id ?? null;
  }

  // NOT_A_BILL short-circuit (H2): 200 + a skipped audit event, zero rows.
  if (bills.length === 0) {
    await admin.from("audit_events").insert({
      entity_table: "job",
      entity_id: `ingest-cobrancas:${driveFileId || gmailId || "sem-arquivo"}`,
      event_type: "skipped",
      actor_email: "system:ingest-cobrancas",
      detail: {
        reason: normalized.length === 0 ? "payload sem cobranças" : "NOT_A_BILL",
        remetente: payload.remetente ?? null,
        nome_arquivo: payload.nome_arquivo ?? null,
        gmail_message_id: gmailId,
      },
    });
    return stats;
  }

  if (driveFileId === "") {
    throw new CobrancasIngestError(422, "drive_file_id ausente no payload");
  }

  // ── document (dedupe by sha256; Drive failure → 422 so n8n retries) ──────
  let buffer: Buffer;
  try {
    buffer = await download(driveFileId);
  } catch (err) {
    throw new CobrancasIngestError(
      422,
      `falha ao baixar o PDF do Drive (${driveFileId}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const v = validateUpload(
    {
      buffer,
      filename: payload.nome_arquivo ?? `${driveFileId}.pdf`,
      claimedMime: "application/pdf",
    },
    "pdf",
  );
  if (!v.ok) throw new CobrancasIngestError(422, v.error);

  const existingDoc = await one<{ id: string }>(
    admin.from("documents").select("id").eq("content_hash", v.sha256).maybeSingle(),
    "documents read",
  );
  if (existingDoc) {
    stats.documentId = existingDoc.id;
    stats.documentReused = true;
    // same PDF redelivered (possibly from a new forward/address) — union the
    // incoming addresses into the document's provenance, best-effort.
    await mergeDocumentEmailContext(admin, existingDoc.id, emailContext);
  } else {
    let pageCount: number | null = null;
    try {
      pageCount = await pdfPageCount(buffer);
    } catch (err) {
      if (!(err instanceof PdfEncryptedError)) {
        stats.warnings.push("contagem de páginas falhou");
      }
    }
    const { data: ins, error: insErr } = await admin
      .from("documents")
      .insert({
        kind: DOCUMENT_KIND.boletoAluguel,
        source: "email_ai",
        drive_file_id: driveFileId,
        drive_folder_kind: "other", // n8n's own archive folder
        web_view_link: payload.web_view_link ?? payload.webViewLink ?? null,
        original_filename: payload.nome_arquivo ?? null,
        content_hash: v.sha256,
        mime_type: "application/pdf",
        byte_size: buffer.length,
        email_message_id: gmailId,
        email_context: emailContext,
        page_count: pageCount,
        processing_status: "processed",
      })
      .select("id")
      .single();
    if (insErr) {
      // Concurrent POSTs of the same bytes (n8n fires items ~20ms apart) can
      // both miss the SELECT and collide on the unique constraints — the loser
      // reuses the winner's row (same fix as the comprovante upload, #41).
      if (insErr.code === "23505") {
        const winner = await one<{ id: string }>(
          admin
            .from("documents")
            .select("id")
            .or(`content_hash.eq.${v.sha256},drive_file_id.eq.${driveFileId}`)
            .limit(1)
            .maybeSingle(),
          "documents dedup re-read",
        );
        if (winner) {
          stats.documentId = winner.id;
          stats.documentReused = true;
          await mergeDocumentEmailContext(admin, winner.id, emailContext);
        } else {
          throw new CobrancasIngestError(500, `documents insert: ${insErr.message}`);
        }
      } else {
        throw new CobrancasIngestError(500, `documents insert: ${insErr.message}`);
      }
    } else {
      if (!ins) throw new CobrancasIngestError(500, "falha ao registrar o documento");
      stats.documentId = (ins as { id: string }).id;
    }
  }
  const documentId = stats.documentId as string;

  // ── charges ───────────────────────────────────────────────────────────────
  const taken = new Map<string, number>();
  for (const c of bills) {
    const { billingAccountId, stationId } = await resolveAccount(
      admin,
      c,
      stats.warnings,
      senderStationId,
    );
    const dedupeKey = cobrancaDedupeKey(c, documentId, taken);

    const existing = await one<ChargeRowLite>(
      admin
        .from("charges")
        .select(
          "id, status, amount, expected_amount, flags, source_document_id, banco, agencia, conta, chave_pix, linha_digitavel, payment_method, email_sender, due_date",
        )
        .eq("dedupe_key", dedupeKey)
        .maybeSingle(),
      "charges read",
    );

    if (existing) {
      // CONVERGENCE (C1/H4): attach the document + fill empty payment fields;
      // only pendente advances to boleto_recebido; human amounts survive.
      // A cloned charge may carry the sheet's combined "Chave Pix / Código do
      // Boleto" cell in chave_pix — when that value is actually a linha
      // digitável (≥30 digits), evict it so the boleto code lives only in
      // linha_digitavel and chave_pix stays a real PIX key (or null).
      const existingChaveIsLinha =
        (existing.chave_pix ?? "").replace(/\D/g, "").length >= 30;
      const patch: Record<string, unknown> = {
        source_document_id: existing.source_document_id ?? documentId,
        banco: existing.banco ?? c.banco,
        agencia: existing.agencia ?? c.agencia,
        conta: existing.conta ?? c.conta,
        chave_pix: existingChaveIsLinha
          ? (c.chavePix ?? null)
          : (existing.chave_pix ?? c.chavePix),
        linha_digitavel: existing.linha_digitavel ?? c.linhaDigitavel,
        payment_method: existing.payment_method ?? c.paymentMethod,
        email_sender: existing.email_sender ?? senderEmail,
        due_date: existing.due_date ?? c.dueDate,
      };
      // H4 idempotency (review fix): only flag needs_review on the FIRST/new
      // document attach to a non-terminal charge. A redelivery of the SAME
      // document, or a terminal (pago/cancelada/nao_aplicavel) charge, is left
      // untouched — so reviewed or paid work never gets dragged back into the
      // /revisao/cobrancas queue. requirement 4.1 is still met on first attach.
      const sameDocument = existing.source_document_id === documentId;
      const terminal =
        existing.status === "pago" ||
        existing.status === "cancelada" ||
        existing.status === "nao_aplicavel";
      if (!sameDocument && !terminal) {
        patch.match_status = "needs_review";
      }
      // H4: only a still-`pendente` charge is mutable by the webhook. Advance
      // it to boleto_recebido and, if its amount is still the auto-set
      // gerar_mes value (not human-adjusted), fill in the boleto's Documento
      // value — leaving expected_amount so the mismatch highlight still works.
      if (existing.status === "pendente") {
        patch.status = "boleto_recebido";
        stats.statusAdvanced += 1;
        const adjusted =
          Array.isArray(existing.flags) && existing.flags.includes("adjusted");
        if (
          c.valor.amount !== null &&
          !adjusted &&
          (existing.amount === null || existing.amount === existing.expected_amount)
        ) {
          patch.amount = c.valor.amount;
        }
      }
      const { error } = await admin.from("charges").update(patch).eq("id", existing.id);
      if (error) {
        throw new CobrancasIngestError(500, `charge update: ${error.message}`);
      }
      stats.converged += 1;
      continue;
    }

    const { error } = await admin.from("charges").insert({
      billing_account_id: billingAccountId,
      station_id: stationId,
      kind: c.kind,
      competencia: c.competencia,
      competencia_source: c.competencia !== null ? "explicit" : "unknown",
      amount: c.valor.amount,
      expected_amount: c.valor.expectedAmount,
      status: "boleto_recebido",
      status_source: "sync",
      match_status: "needs_review", // requirement 4.1
      payment_method: c.paymentMethod,
      banco: c.banco,
      agencia: c.agencia,
      conta: c.conta,
      chave_pix: c.chavePix,
      linha_digitavel: c.linhaDigitavel,
      issuer_cnpj: c.cnpj,
      email_sender: senderEmail,
      due_date: c.dueDate,
      raw: c.raw,
      source: "email_ai",
      source_document_id: documentId,
      dedupe_key: dedupeKey,
      notes: [
        c.endereco ? `Endereço: ${c.endereco}` : null,
        payload.remetente ? `Remetente: ${payload.remetente}` : null,
        !c.kindKnown ? "Tipo de Cobrança desconhecido — assumido aluguel" : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
    });
    if (error) throw new CobrancasIngestError(500, `charge insert: ${error.message}`);
    stats.created += 1;

    // energia split → charge line (mirrors normalize's Valor handling)
    if (c.valor.energyAmount !== null) {
      const created = await one<{ id: string }>(
        admin.from("charges").select("id").eq("dedupe_key", dedupeKey).single(),
        "charges re-read",
      );
      if (created) {
        const { error: lineErr } = await admin.from("charge_lines").insert({
          charge_id: created.id,
          line_kind: "energia",
          description: "Energia (Valor do e-mail)",
          amount: c.valor.energyAmount,
          competencia: c.competencia,
          competencia_source: c.competencia !== null ? "explicit" : null,
        });
        if (lineErr) stats.warnings.push(`charge_line: ${lineErr.message}`);
      }
    }
  }

  // one audit summary per payload (machine ingestion — sync-style)
  await admin.from("audit_events").insert({
    entity_table: "job",
    entity_id: `ingest-cobrancas:${driveFileId}`,
    event_type: "ingested",
    actor_email: "system:ingest-cobrancas",
    detail: {
      document_id: documentId,
      gmail_message_id: gmailId,
      remetente: payload.remetente ?? null,
      created: stats.created,
      converged: stats.converged,
      status_advanced: stats.statusAdvanced,
      not_a_bill: stats.notABill,
      warnings: stats.warnings,
      cobrancas: payload.cobrancas, // excess-of-info: raw AI output retained
    },
  });

  return stats;
}
