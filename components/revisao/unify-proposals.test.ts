import { describe, expect, it } from "vitest";

import type { MergeTargetRow, ReviewChargeRow } from "@/app/(app)/revisao/cobrancas/queries";
import { buildUnifyProposals } from "./unify-proposals";

function dup(o: Partial<ReviewChargeRow>): ReviewChargeRow {
  return {
    id: "dup-1",
    kind: "aluguel",
    competencia: "2026-05-01",
    amount: 1500,
    expectedAmount: null,
    status: "boleto_recebido",
    matchStatus: "needs_review",
    dueDate: "2026-06-05",
    source: "email_ai",
    dedupeKey: "email:doc-1:aluguel:2026-05",
    stationId: null,
    stationName: null,
    cadastroId: null,
    parceiro: null,
    issuerCnpj: "15809084000186",
    paymentMethod: "boleto_email",
    banco: null,
    agencia: null,
    conta: null,
    chavePix: null,
    linhaDigitavel: "0339902033...",
    notes: null,
    emailSender: null,
    documentId: "doc-1",
    webViewLink: null,
    documentFilename: null,
    documentCreatedAt: null,
    documentSource: "email_ai",
    energyLineAmount: null,
    ...o,
  };
}

function target(o: Partial<MergeTargetRow>): MergeTargetRow {
  return {
    id: "tgt-1",
    dedupeKey: "pag:7:2026-05:aluguel",
    kind: "aluguel",
    competencia: "2026-05-01",
    amount: 1500,
    status: "pago",
    stationId: 1232,
    stationName: "Bandeirantes",
    issuerCnpj: "15809084000186",
    emailSender: null,
    sourceDocumentId: "doc-1",
    ...o,
  };
}

describe("buildUnifyProposals", () => {
  it("proposes mesmo_documento when duplicate and target share the doc + amount (Arinella)", () => {
    const p = buildUnifyProposals([dup({})], [target({})]);
    expect(p).toHaveLength(1);
    expect(p[0].reason).toBe("mesmo_documento");
    expect(p[0].target.id).toBe("tgt-1");
  });

  it("proposes remetente_valor for the ND↔boleto shape (same CNPJ + competência + valor)", () => {
    const p = buildUnifyProposals(
      [dup({ documentId: "doc-boleto", linhaDigitavel: "0339..." })],
      [target({ sourceDocumentId: "doc-nd" })],
    );
    expect(p).toHaveLength(1);
    expect(p[0].reason).toBe("remetente_valor");
  });

  it("does NOT propose when amounts differ", () => {
    expect(
      buildUnifyProposals([dup({ amount: 1500 })], [target({ amount: 1400 })]),
    ).toHaveLength(0);
  });

  it("does NOT propose remetente_valor across competências", () => {
    expect(
      buildUnifyProposals(
        [dup({ documentId: "a" })],
        [target({ sourceDocumentId: "b", competencia: "2026-06-01" })],
      ),
    ).toHaveLength(0);
  });

  it("skips ambiguous duplicates (two viable targets in the same tier)", () => {
    const p = buildUnifyProposals(
      [dup({})],
      [target({ id: "t1" }), target({ id: "t2", stationId: 99 })],
    );
    expect(p).toHaveLength(0);
  });

  it("compares CNPJ leading-zero-insensitively (clone lost zeros)", () => {
    const p = buildUnifyProposals(
      [dup({ documentId: "x", issuerCnpj: "01610670000192" })],
      [target({ sourceDocumentId: "y", issuerCnpj: "1610670000192" })],
    );
    expect(p).toHaveLength(1);
    expect(p[0].reason).toBe("remetente_valor");
  });

  it("never proposes an unidentified open target (adds no identity)", () => {
    const p = buildUnifyProposals(
      [dup({})],
      [
        target({
          stationId: null,
          status: "boleto_recebido",
          dedupeKey: "email:other:aluguel:2026-05",
        }),
      ],
    );
    expect(p).toHaveLength(0);
  });

  it("one target absorbs at most one duplicate (second stays manual)", () => {
    const p = buildUnifyProposals(
      [dup({ id: "d1" }), dup({ id: "d2" })],
      [target({})],
    );
    expect(p).toHaveLength(1);
    expect(p[0].duplicate.id).toBe("d1");
  });

  it("prefers mesmo_documento over remetente_valor when both exist", () => {
    const p = buildUnifyProposals(
      [dup({})],
      [
        target({ id: "by-doc" }),
        target({ id: "by-key", sourceDocumentId: "outro-doc", stationId: 42 }),
      ],
    );
    expect(p).toHaveLength(1);
    expect(p[0].target.id).toBe("by-doc");
    expect(p[0].reason).toBe("mesmo_documento");
  });

  it("does NOT merge across DIFFERENT stations (same landlord, N stations, same value)", () => {
    // duplicate resolved to station 100; target is station 200's rent — same
    // CNPJ, competência, value. Merging would cancel station 100's real rent.
    const p = buildUnifyProposals(
      [dup({ documentId: "boleto-100", stationId: 100 })],
      [target({ sourceDocumentId: "nd-200", stationId: 200 })],
    );
    expect(p).toHaveLength(0);
  });

  it("still merges when the duplicate is station-less (redelivery / DIA banco)", () => {
    const p = buildUnifyProposals(
      [dup({ stationId: null })],
      [target({ stationId: 200 })],
    );
    expect(p).toHaveLength(1);
    expect(p[0].reason).toBe("mesmo_documento");
  });

  it("merges when both sides carry the SAME station", () => {
    const p = buildUnifyProposals(
      [dup({ documentId: "x", stationId: 200 })],
      [target({ sourceDocumentId: "y", stationId: 200 })],
    );
    expect(p).toHaveLength(1);
    expect(p[0].reason).toBe("remetente_valor");
  });

  it("does NOT merge across DIFFERENT kinds", () => {
    const p = buildUnifyProposals(
      [dup({ kind: "aluguel" })],
      [target({ kind: "energia" })],
    );
    expect(p).toHaveLength(0);
  });

  it("skips a nao_aplicavel duplicate (RPC would refuse — no dead proposal)", () => {
    const p = buildUnifyProposals([dup({ status: "nao_aplicavel" })], [target({})]);
    expect(p).toHaveLength(0);
  });
});
