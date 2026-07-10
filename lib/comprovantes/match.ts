/**
 * Receipt → open-charge matcher. Pure + test-importable (no `server-only`, no
 * I/O). NEW ranked design (review-resolutions M12); the value/date rules mirror
 * the n8n matchers so results agree on real data.
 *
 * Ranked keys — the FIRST rank with ≥1 key-hit is the winning rank; the amount
 * and date filters are then applied WITHIN that rank (drive-comprovantes §4.3):
 *   1. codigoBarras / linha_digitável (barcode; débito-automático code ⊂ the
 *      charge's auto_debit_registration, or exact linha_digitável) — date-exempt.
 *   2. chave_pix (tolerant, via pixKeysMatch).
 *   3. cnpj_cpf (digits-only equality).
 *   4. agência + conta (digits-only equality).
 * Exactly one survivor ⇒ `auto`; ≥2 ⇒ `ambiguous`; 0 ⇒ `none`.
 */

import { pixKeysMatch } from "./normalize-pix";
import type {
  MatchResult,
  MatchRule,
  OpenChargeCandidate,
  ParsedReceipt,
} from "./types";

function digits(v: string | null | undefined): string {
  return v ? v.replace(/\D/g, "") : "";
}

function monthIndex(iso: string | null): number | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
}

/**
 * n8n date gate: when both the charge's competência and the receipt date are
 * known, the payment must fall in the competência month on/after the 25th, OR
 * in the following month on/before the 10th. When either is unknown, the gate
 * passes (no date signal to filter on).
 */
function passesDateWindow(paidAt: string | null, competencia: string | null): boolean {
  const comp = monthIndex(competencia);
  if (comp === null || !paidAt) return true;
  const paid = monthIndex(paidAt);
  const day = Number(paidAt.slice(8, 10));
  if (paid === null || !Number.isFinite(day)) return true;
  const inCurrent = paid === comp && day >= 25;
  const inNext = paid === comp + 1 && day <= 10;
  return inCurrent || inNext;
}

interface Rank {
  rule: MatchRule;
  /** True when the receipt carries the key this rank needs. */
  applicable: boolean;
  /** Candidates whose key matches the receipt. */
  hits: OpenChargeCandidate[];
  /** Rank 1 is exempt from the date window (barcodes are globally unique). */
  dateExempt: boolean;
}

function buildRanks(
  receipt: ParsedReceipt,
  candidates: OpenChargeCandidate[],
): Rank[] {
  const rc = digits(receipt.codigoBarras);
  const rCnpj = digits(receipt.cnpjCpf);
  const rAg = digits(receipt.agencia);
  const rConta = digits(receipt.conta);

  return [
    {
      rule: "codigo_barras",
      applicable: rc.length > 0,
      dateExempt: true,
      hits: candidates.filter((c) => {
        const linha = digits(c.linhaDigitavel);
        const adr = digits(c.autoDebitRegistration);
        return (
          (linha.length > 0 && linha === rc) ||
          (adr.length > 0 && adr.includes(rc))
        );
      }),
    },
    {
      rule: "chave_pix",
      applicable: !!receipt.chavePix,
      dateExempt: false,
      hits: candidates.filter((c) => pixKeysMatch(receipt.chavePix, c.chavePix)),
    },
    {
      rule: "cnpj_cpf",
      applicable: rCnpj.length > 0,
      dateExempt: false,
      hits: candidates.filter((c) => digits(c.issuerCnpj) === rCnpj),
    },
    {
      rule: "agencia_conta",
      applicable: rAg.length > 0 && rConta.length > 0,
      dateExempt: false,
      hits: candidates.filter(
        (c) => digits(c.agencia) === rAg && digits(c.conta) === rConta,
      ),
    },
  ];
}

/**
 * Ranks `candidates` for one `receipt` and decides the outcome. Never mutates
 * its inputs.
 */
export function matchReceipt(
  receipt: ParsedReceipt,
  candidates: OpenChargeCandidate[],
): MatchResult {
  const reasons: string[] = [];
  const ranks = buildRanks(receipt, candidates);

  const winning = ranks.find((r) => r.applicable && r.hits.length > 0);
  if (!winning) {
    return { outcome: "none", reasons: ["nenhuma cobrança em aberto casou com o comprovante"] };
  }
  reasons.push(`chave de conciliação: ${winning.rule} (${winning.hits.length} candidato(s))`);

  // amount within the per-candidate tolerance
  let survivors = winning.hits.filter((c) => {
    if (receipt.amount === null || c.amount === null) return false;
    return Math.abs(receipt.amount - c.amount) <= c.valueTolerance;
  });
  if (survivors.length < winning.hits.length) {
    reasons.push("filtrado por valor (tolerância por contraparte)");
  }

  // date window (rank 1 exempt)
  if (!winning.dateExempt) {
    const dated = survivors.filter((c) => passesDateWindow(receipt.paidAt, c.competencia));
    if (dated.length > 0 && dated.length < survivors.length) {
      reasons.push("desambiguado pela janela de data (dia ≥ 25 / ≤ 10)");
      survivors = dated;
    }
  }

  // Prefer the single OPEN survivor when already-paid charges also matched
  // (energy keeps paid charges in the pool; a comprovante should settle the
  // still-open charge, not re-bind an already-paid one).
  if (survivors.length >= 2) {
    const open = survivors.filter((c) => c.isOpen);
    if (open.length === 1) {
      reasons.push("desambiguado: única cobrança em aberto (as demais já pagas)");
      survivors = open;
    }
  }

  if (survivors.length === 1) {
    return {
      outcome: "auto",
      chargeId: survivors[0].chargeId,
      rule: winning.rule,
      candidateIds: [survivors[0].chargeId],
      reasons,
    };
  }
  if (survivors.length >= 2) {
    reasons.push(`${survivors.length} cobranças em aberto com mesmo valor/chave — revisão manual`);
    return {
      outcome: "ambiguous",
      rule: winning.rule,
      candidateIds: survivors.map((c) => c.chargeId),
      reasons,
    };
  }
  reasons.push("valor não bateu com nenhuma cobrança da chave vencedora");
  return { outcome: "none", rule: winning.rule, reasons };
}
