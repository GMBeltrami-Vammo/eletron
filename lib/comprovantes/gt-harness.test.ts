/**
 * Ground-truth harness (Gabriel 2026-07-10): scores the parser+matcher against
 * the REAL 05.06 rent comprovante (163 pages) and its gabarito — the 148
 * 2_Pagamentos rows whose Comprovante cell points at this PDF, each mapping ONE
 * page → (cadastroId, competência, valor).
 *
 * Runs only when the local gitignored fixtures exist (context/ holds real PII
 * data and is never committed):
 *   - context/comprovante-05-06.pdf            (the real PDF)
 *   - context/comprovante-1LBlu3gQ-ground-truth.json
 *   - context/gt-pool-snapshot.json            (charge pool pulled from prod)
 *
 * Faithfully replicates matchAndBind's sequential behavior: receipts are
 * matched in page order and an auto-bound charge leaves the pool. HARD
 * assertions: zero auto-WRONG binds and zero wrongly-discarded GT pages —
 * a wrong automatic action is worse than any miss.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { extractPdfText } from "./extract";
import { matchReceipt } from "./match";
import { parseComprovantePages } from "./parse";
import type { OpenChargeCandidate, ParsedReceipt } from "./types";

const CTX = path.resolve(__dirname, "../../context");
const PDF = path.join(CTX, "comprovante-05-06.pdf");
const GT = path.join(CTX, "comprovante-1LBlu3gQ-ground-truth.json");
const POOL = path.join(CTX, "gt-pool-snapshot.json");

const fixturesExist = existsSync(PDF) && existsSync(GT) && existsSync(POOL);

interface GtPayment {
  page: number;
  cadastroId: number;
  swapStationId: number;
  mes: string;
  ano: number;
  valorParsed: number;
  cnpj: unknown;
}

interface PoolRow extends OpenChargeCandidate {
  dedupeKey: string | null;
  status: string;
  accountType: string | null;
}

const MES: Record<string, string> = {
  janeiro: "01", fevereiro: "02", "março": "03", marco: "03", abril: "04",
  maio: "05", junho: "06", julho: "07", agosto: "08", setembro: "09",
  outubro: "10", novembro: "11", dezembro: "12",
};

describe.runIf(fixturesExist)("GT harness — 05.06 comprovante vs gabarito", () => {
  it("auto-matches the GT pages with ZERO wrong binds and ZERO wrong discards", async () => {
    const gt = JSON.parse(readFileSync(GT, "utf8")) as { payments: GtPayment[] };
    const rawPool = JSON.parse(readFileSync(POOL, "utf8")) as PoolRow[];
    const pool: PoolRow[] = rawPool.map((c) => ({
      ...c,
      amount: c.amount === null ? null : Number(c.amount),
      valueTolerance: Number(c.valueTolerance ?? 0.01),
      isOpen: Boolean(c.isOpen),
    }));

    // expected chargeId per GT page, via the rent dedupe key (#20)
    const byDedupe = new Map(pool.map((c) => [c.dedupeKey, c]));
    const expectedByPage = new Map<number, string>();
    for (const p of gt.payments) {
      const mm = MES[p.mes.toLowerCase()];
      const key = `pag:${p.cadastroId}:${p.ano}-${mm}:aluguel`;
      const charge = byDedupe.get(key);
      expect(charge, `GT page ${p.page}: charge ${key} ausente do pool`).toBeTruthy();
      expectedByPage.set(p.page, (charge as PoolRow).chargeId);
    }

    // parse the real PDF exactly like the pipeline does
    const { pages, pageCount } = await extractPdfText(readFileSync(PDF));
    const parsed: ParsedReceipt[] = parseComprovantePages(pages, 1);

    // sequential match with pool-splice (matchAndBind parity; `pool` stays
    // whole for the rule-1 value check, exactly like the pipeline)
    const live: OpenChargeCandidate[] = pool.slice();
    const results = parsed.map((r) => {
      const m = matchReceipt(r, live, pool);
      if (m.outcome === "auto" && m.chargeId) {
        const i = live.findIndex((c) => c.chargeId === m.chargeId);
        if (i >= 0) live.splice(i, 1);
      }
      return { r, m };
    });

    // ── score ──
    let autoCorrect = 0;
    const autoWrong: string[] = [];
    let reviewWithExpected = 0;
    let reviewOther = 0;
    const discardWrong: string[] = [];
    let missNone = 0;
    const missDetail: string[] = [];
    let nonGtAuto = 0;
    const nonGtAutoDetail: string[] = [];
    let nonGtDiscarded = 0;
    let nonGtReview = 0;

    const receiptPages = new Set(parsed.map((p) => p.pageNumber));
    for (const { r, m } of results) {
      const expected = expectedByPage.get(r.pageNumber);
      if (expected) {
        if (m.outcome === "auto") {
          if (m.chargeId === expected) autoCorrect++;
          else autoWrong.push(`p${r.pageNumber}: auto→${m.chargeId} esperado ${expected}`);
        } else if (m.outcome === "discard") {
          discardWrong.push(`p${r.pageNumber}: descartado (amt=${r.amount}) — ${m.reasons.join("; ")}`);
        } else if (m.candidateIds?.includes(expected)) {
          reviewWithExpected++;
        } else if (m.outcome === "ambiguous") {
          reviewOther++;
        } else {
          missNone++;
          if (missDetail.length < 12) {
            missDetail.push(
              `p${r.pageNumber}: none (amt=${r.amount} chave=${r.chavePix} cnpj=${r.cnpjCpf} ag/ct=${r.agencia}/${r.conta}) ${m.reasons.join("; ")}`,
            );
          }
        }
      } else {
        // non-GT page: an auto-bind here is a FALSE match
        if (m.outcome === "auto") {
          nonGtAuto++;
          nonGtAutoDetail.push(`p${r.pageNumber}: auto→${m.chargeId} (amt=${r.amount})`);
        } else if (m.outcome === "discard") nonGtDiscarded++;
        else nonGtReview++;
      }
    }
    const gtPagesWithoutReceipt = [...expectedByPage.keys()].filter(
      (p) => !receiptPages.has(p),
    );

     
    console.log(
      `\n=== GT HARNESS (pdf ${pageCount}pg, ${parsed.length} receipts, GT ${gt.payments.length}) ===\n` +
        `GT pages   → auto CORRETOS: ${autoCorrect}/${gt.payments.length}` +
        `  | revisão c/ candidato certo: ${reviewWithExpected}` +
        `  | revisão outros: ${reviewOther}  | sem match: ${missNone}\n` +
        `           → auto ERRADOS: ${autoWrong.length}  | descartados ERRADOS: ${discardWrong.length}` +
        `  | páginas GT sem receipt parseado: ${gtPagesWithoutReceipt.length} ${JSON.stringify(gtPagesWithoutReceipt)}\n` +
        `non-GT (${parsed.length - gt.payments.length} receipts) → auto (FALSOS): ${nonGtAuto}` +
        `  | descartados: ${nonGtDiscarded}  | revisão: ${nonGtReview}\n` +
        (autoWrong.length ? `AUTO-ERRADOS:\n  ${autoWrong.join("\n  ")}\n` : "") +
        (discardWrong.length ? `DESCARTES-ERRADOS:\n  ${discardWrong.join("\n  ")}\n` : "") +
        (nonGtAutoDetail.length ? `FALSOS-AUTO (non-GT):\n  ${nonGtAutoDetail.join("\n  ")}\n` : "") +
        (missDetail.length ? `SEM-MATCH (amostra):\n  ${missDetail.join("\n  ")}\n` : ""),
    );

    // Hard gates: a wrong automatic action is unacceptable.
    expect(autoWrong).toEqual([]);
    expect(discardWrong).toEqual([]);
    expect(nonGtAuto).toBe(0);
    // Floor on the auto-accept rate. 146/148 is the safe maximum on this GT:
    // the 2 remaining pages are the genuine N↔N pair (same person, two
    // same-value stations) which lands in review WITH the right candidates —
    // resolved in one click by the "Resolver grupo" panel.
    expect(autoCorrect).toBeGreaterThanOrEqual(146);
    expect(reviewWithExpected).toBeGreaterThanOrEqual(2);
  });
});
