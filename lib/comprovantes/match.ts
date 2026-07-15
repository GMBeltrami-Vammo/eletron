/**
 * Receipt → charge matcher. Pure + test-importable (no `server-only`, no I/O).
 * Ranked design (review-resolutions M12) + Gabriel's two GENERAL rules
 * (2026-07-10, GT-calibrated against the 148-payment 05.06 comprovante):
 *   Rule 1 — an amount matching NO charge in the whole pool → `discard`
 *            (automatic; noise never reaches the review queue).
 *   Rule 2 — the payment date pins the competência: [20/MM, 20/MM+1) → MM.
 *            Auto-match only inside the pinned competência; a key+value match
 *            in another competência goes to human review.
 *
 * Ranked keys — the FIRST rank with ≥1 key-hit is the winning rank; the amount
 * and competência filters are then applied WITHIN that rank:
 *   1. codigoBarras / linha_digitável (barcode; débito-automático code ⊂ the
 *      charge's auto_debit_registration, or exact linha_digitável) —
 *      competência-exempt (a barcode identifies THE bill).
 *   2. chave_pix (tolerant, via pixKeysMatch).
 *   3. cnpj_cpf (digits-only equality).
 *   4. agência + conta (digits-only equality).
 * Exactly one survivor ⇒ `auto`; ≥2 ⇒ `ambiguous`; 0 key-hits ⇒ `none`.
 */

import { RECEIPT_TYPE } from "@/lib/domain";
import { digitKeysEqual, pixKeysMatch } from "./normalize-pix";
import type {
  MatchResult,
  MatchRule,
  OpenChargeCandidate,
  ParsedReceipt,
} from "./types";

function digits(v: string | null | undefined): string {
  return v ? v.replace(/\D/g, "") : "";
}

/**
 * Gabriel's date rule (2026-07-10, general): a payment dated between the 20th
 * of month M and the 20th of month M+1 belongs to competência M — day ≥ 20 →
 * the payment's own month; day < 20 → the previous month. Auto-matching is
 * allowed ONLY within the pinned competência; binding to any other competência
 * requires human validation. Returns `YYYY-MM`, or null when the date is
 * missing/unparseable (no date signal → no gate).
 */
export function pinnedCompetencia(paidAt: string | null): string | null {
  if (!paidAt) return null;
  const m = paidAt.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  let year = Number(m[1]);
  let month = Number(m[2]);
  const day = Number(m[3]);
  // A garbage extraction ("2026-34-12") must never pin anything.
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (day < 20) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** True when the receipt's amount matches SOME charge in the pool (tolerance-aware). */
function amountMatchesSomewhere(
  amount: number | null,
  candidates: OpenChargeCandidate[],
): boolean {
  if (amount === null) return false;
  return candidates.some(
    (c) => c.amount !== null && Math.abs(amount - c.amount) <= c.valueTolerance,
  );
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
      // leading-zero-insensitive: the clone lost leading zeros (numeric cells)
      // and banks zero-pad ("000228202278-56" is CPF 22820227856).
      hits: candidates.filter((c) => digitKeysEqual(digits(c.issuerCnpj), rCnpj)),
    },
    {
      rule: "agencia_conta",
      applicable: rAg.length > 0 && rConta.length > 0,
      dateExempt: false,
      hits: candidates.filter(
        (c) =>
          digitKeysEqual(digits(c.agencia), rAg) &&
          digitKeysEqual(digits(c.conta), rConta),
      ),
    },
  ];
}

/** The bill's DA snapshot is decisive only when known (not desconhecido/null). */
function billTypeKnown(c: OpenChargeCandidate): boolean {
  return c.billAutoDebit === "cadastrado" || c.billAutoDebit === "nao_cadastrado";
}

/**
 * Does the candidate's payment TYPE match the receipt's? (Gabriel 2026-07-14.)
 * A débito-automático receipt belongs to a `cadastrado` bill; a manual receipt
 * (boleto/pix/ted/outro) to a `nao_cadastrado` bill. When the bill's DA flag is
 * unknown (desconhecido/null — e.g. rent, or a fatura not yet sent to fiscal)
 * the gate does NOT fire, so behaviour degrades to the pre-gate matcher.
 */
function samePaymentType(c: OpenChargeCandidate, receiptIsDA: boolean): boolean {
  if (!billTypeKnown(c)) return true;
  return (c.billAutoDebit === "cadastrado") === receiptIsDA;
}

/**
 * Payment-type gate over the ranked matcher (Gabriel 2026-07-14): a DA comprovante
 * only auto-binds a DA bill and a manual comprovante only a non-DA bill — the
 * immutable per-bill flag (charge_energy_details.auto_debit) is the authority,
 * NOT the station's mutable enrollment. A wrong-type match is NOT bound; instead
 * it is surfaced as a DIRECTED review ("provavelmente destes pagamentos, mas o
 * tipo de pagamento diverge"). Unknown-type bills (rent, not-yet-fiscal) are not
 * gated. Fixes the page-253 case: a manual concessionária receipt no longer
 * auto-binds a DA fatura.
 */
export function matchReceipt(
  receipt: ParsedReceipt,
  candidates: OpenChargeCandidate[],
  fullPool: OpenChargeCandidate[] = candidates,
): MatchResult {
  const receiptIsDA = receipt.receiptType === RECEIPT_TYPE.debitoAutomatico;
  const sameType = candidates.filter((c) => samePaymentType(c, receiptIsDA));
  const crossType = candidates.filter((c) => !samePaymentType(c, receiptIsDA));

  const res = rankMatch(receipt, sameType, fullPool);
  if (res.outcome === "auto" || res.outcome === "ambiguous") return res;

  // No same-type bind. If the WRONG payment type would have matched (value/key),
  // do NOT bind — hand it to a human as a directed suggestion.
  if (crossType.length > 0) {
    const cross = rankMatch(receipt, crossType, fullPool);
    if (cross.outcome === "auto" || cross.outcome === "ambiguous") {
      const ids =
        cross.candidateIds ?? (cross.chargeId ? [cross.chargeId] : []);
      return {
        outcome: "ambiguous",
        rule: cross.rule,
        candidateIds: ids,
        reasons: [
          ...cross.reasons,
          "tipo de pagamento diverge (débito automático × manual) — não vinculado; provavelmente referente a estas cobranças (validação humana)",
        ],
      };
    }
  }
  return res;
}

/**
 * Ranks `candidates` for one `receipt` and decides the outcome. Never mutates
 * its inputs. `fullPool` is the UNSPLICED candidate list (matchAndBind shrinks
 * `candidates` as the batch binds charges) — rule-1's "matches no value at all"
 * must be judged against everything, or a same-value receipt later in the batch
 * would be discarded just because an earlier receipt consumed the charge.
 */
function rankMatch(
  receipt: ParsedReceipt,
  candidates: OpenChargeCandidate[],
  fullPool: OpenChargeCandidate[] = candidates,
): MatchResult {
  const reasons: string[] = [];
  const ranks = buildRanks(receipt, candidates);
  const applicable = ranks.filter((r) => r.applicable && r.hits.length > 0);

  // Rule 1 (Gabriel, general): a receipt that matches NOTHING — no key hit AND
  // an amount that matches no charge in the whole pool — is not one of ours →
  // automatic discard (noise like health plans/suppliers never reaches review).
  // A KEY hit (a known landlord/installation) always goes to a human instead,
  // even when the amount diverges (juros/multa, stale amount): a wrong discard
  // is an invisible loss. A null amount never discards (parser failure ≠ alien).
  if (applicable.length === 0) {
    if (
      receipt.amount !== null &&
      !amountMatchesSomewhere(receipt.amount, fullPool)
    ) {
      return {
        outcome: "discard",
        reasons: ["valor não corresponde a nenhuma cobrança — descartado automaticamente"],
      };
    }
    return { outcome: "none", reasons: ["nenhuma cobrança em aberto casou com o comprovante"] };
  }

  // Ranks FALL THROUGH (n8n parity: chave OU cnpj OU ag+conta): a higher rank
  // whose hits all fail the value/competência filters yields to the next rank
  // instead of ending the match. The first rank that produces ≥1 in-competência
  // value survivor decides; an out-of-competência key+value match is remembered
  // as the human-review fallback (rule 2: cross-competência needs a human).
  let humanFallback: MatchResult | null = null;
  const pinned = pinnedCompetencia(receipt.paidAt);

  for (const rank of applicable) {
    reasons.push(`chave de conciliação: ${rank.rule} (${rank.hits.length} candidato(s))`);

    // amount within the per-candidate tolerance
    let survivors = rank.hits.filter((c) => {
      if (receipt.amount === null || c.amount === null) return false;
      return Math.abs(receipt.amount - c.amount) <= c.valueTolerance;
    });
    if (survivors.length === 0) {
      // A barcode names THE bill; when its amount disagrees, letting a weaker
      // key auto-bind a SIBLING charge would contradict the receipt's own
      // barcode — that conflict is a human call, not a fall-through.
      if (rank.dateExempt) {
        reasons.push(
          "código de barras identifica a cobrança mas o valor não bate — revisão manual",
        );
        return {
          outcome: "ambiguous",
          rule: rank.rule,
          candidateIds: rank.hits.map((c) => c.chargeId),
          reasons,
        };
      }
      reasons.push(`valor não bateu em ${rank.rule} — tentando próxima chave`);
      continue;
    }

    // Rule 2 (Gabriel, general): the payment DATE pins the competência — a
    // payment in [20/MM, 20/MM+1) belongs to competência MM. Auto-matching is
    // allowed only inside the pinned competência. Rank 1 (barcode/linha
    // digitável) is exempt — an exact barcode identifies THE bill.
    if (!rank.dateExempt && pinned !== null) {
      const inComp = survivors.filter(
        (c) => c.competencia !== null && c.competencia.startsWith(pinned),
      );
      // A null competência is ABSENCE of evidence, not a mismatch: when such a
      // survivor exists it can't be ruled out, so the pin may not auto-decide.
      const unknownComp = survivors.filter((c) => c.competencia === null);
      if (inComp.length === 0) {
        if (!humanFallback) {
          humanFallback = {
            outcome: "ambiguous",
            rule: rank.rule,
            candidateIds: survivors.map((c) => c.chargeId),
            reasons: [
              ...reasons,
              `chave e valor casam, mas nenhuma cobrança na competência ${pinned} da data do pagamento — validação humana`,
            ],
          };
        }
        continue;
      }
      if (unknownComp.length > 0) {
        reasons.push(
          `cobrança(s) sem competência não podem ser descartadas pela data — revisão manual`,
        );
        return {
          outcome: "ambiguous",
          rule: rank.rule,
          candidateIds: [...inComp, ...unknownComp].map((c) => c.chargeId),
          reasons,
        };
      }
      if (inComp.length < survivors.length) {
        reasons.push(`competência ${pinned} pinada pela data do pagamento`);
      }
      survivors = inComp;
    }

    // Prefer the single OPEN survivor when already-paid charges also matched
    // (paid charges stay in the pool so a comprovante can settle them; but when
    // an open charge of the same competência competes, settle the open one).
    // ONLY within a single competência (or the barcode rank): for a DATELESS
    // receipt whose key+value hits many months, "the one still open" is a
    // guess, not evidence — that stays with a human.
    if (survivors.length >= 2) {
      const comps = new Set(survivors.map((c) => c.competencia ?? "null"));
      if (rank.dateExempt || comps.size === 1) {
        const open = survivors.filter((c) => c.isOpen);
        if (open.length === 1) {
          reasons.push("desambiguado: única cobrança em aberto (as demais já pagas)");
          survivors = open;
        }
      }
    }

    if (survivors.length === 1) {
      return {
        outcome: "auto",
        chargeId: survivors[0].chargeId,
        rule: rank.rule,
        candidateIds: [survivors[0].chargeId],
        reasons,
      };
    }
    reasons.push(`${survivors.length} cobranças com mesmo valor/chave — revisão manual`);
    return {
      outcome: "ambiguous",
      rule: rank.rule,
      candidateIds: survivors.map((c) => c.chargeId),
      reasons,
    };
  }

  if (humanFallback) return humanFallback;
  reasons.push("valor não bateu com nenhuma cobrança das chaves encontradas");
  return { outcome: "none", rule: applicable[0].rule, reasons };
}
