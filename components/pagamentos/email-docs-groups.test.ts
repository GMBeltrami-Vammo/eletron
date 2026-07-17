import { describe, expect, it } from "vitest";

import type { ReviewChargeRow } from "@/app/(app)/revisao/cobrancas/queries";
import {
  buildEmailDocGroups,
  chargeReadiness,
  isDiscardableEmailCharge,
  isEmailDocRow,
  isStagedEmailCharge,
} from "./email-docs-groups";

function row(o: Partial<ReviewChargeRow>): ReviewChargeRow {
  return {
    id: "c-1",
    kind: "aluguel",
    competencia: "2026-06-01",
    amount: 1500,
    expectedAmount: null,
    status: "boleto_recebido",
    matchStatus: "needs_review",
    dueDate: "2026-07-05",
    source: "email_ai",
    dedupeKey: "email:doc-1:aluguel:2026-06",
    stationId: null,
    stationName: null,
    cadastroId: null,
    parceiro: null,
    issuerCnpj: null,
    paymentMethod: "boleto_email",
    banco: null,
    agencia: null,
    conta: null,
    chavePix: null,
    linhaDigitavel: "0339...",
    notaFiscal: null,
    notes: null,
    emailSender: "locador@exemplo.com",
    documentId: "doc-1",
    webViewLink: null,
    documentFilename: "boleto-junho.pdf",
    documentCreatedAt: "2026-07-12T16:33:00Z",
    documentSource: "email_ai",
    documentAddresses: ["locador@exemplo.com"],
    energyLineAmount: null,
    ...o,
  };
}

describe("predicate matrix (staged vs tab membership)", () => {
  it("webhook-created needs_review → staged AND in the tab", () => {
    const r = row({});
    expect(isStagedEmailCharge(r)).toBe(true);
    expect(isEmailDocRow(r)).toBe(true);
  });

  it("converged gerar_mes with email doc → in the tab, NEVER staged", () => {
    const r = row({ source: "gerar_mes", dedupeKey: "pag:7:2026-06:aluguel" });
    expect(isStagedEmailCharge(r)).toBe(false);
    expect(isEmailDocRow(r)).toBe(true);
  });

  it("approved email charge (manually_matched) → neither", () => {
    const r = row({ matchStatus: "manually_matched" });
    expect(isStagedEmailCharge(r)).toBe(false);
    expect(isEmailDocRow(r)).toBe(false);
  });

  it("clone-era UNIDENTIFIED (no document, non-email source) → neither", () => {
    const r = row({
      source: "sheet_backfill",
      documentId: null,
      documentSource: null,
      documentFilename: null,
      documentCreatedAt: null,
    });
    expect(isStagedEmailCharge(r)).toBe(false);
    expect(isEmailDocRow(r)).toBe(false);
  });

  it("needs_review with a NON-email document (e.g. app upload) → not in the tab", () => {
    const r = row({ source: "manual", documentSource: "app_upload" });
    expect(isStagedEmailCharge(r)).toBe(false);
    expect(isEmailDocRow(r)).toBe(false);
  });

  it("matcher-paid staged charge exits staging AND the tab (re-enters the ledger)", () => {
    // the comprovante matcher flips status→pago WITHOUT touching match_status;
    // that paid money must show in the ledger, not sit stuck in the tab
    const r = row({ status: "pago" });
    expect(isStagedEmailCharge(r)).toBe(false);
    expect(isEmailDocRow(r)).toBe(false);
  });

  it("discarded (cancelada) charge is neither staged nor in the tab", () => {
    const r = row({ status: "cancelada" });
    expect(isStagedEmailCharge(r)).toBe(false);
    expect(isEmailDocRow(r)).toBe(false);
  });
});

describe("isDiscardableEmailCharge", () => {
  it("ordinary email: keyed charge is discardable", () => {
    expect(isDiscardableEmailCharge(row({}))).toBe(true);
  });

  it("pag:-keyed email charge is NOT (it IS the month's rent — gerar_mes convergence)", () => {
    expect(
      isDiscardableEmailCharge(row({ dedupeKey: "pag:123:2026-08:aluguel" })),
    ).toBe(false);
  });

  it("converged non-email charge is NOT discardable", () => {
    expect(isDiscardableEmailCharge(row({ source: "gerar_mes" }))).toBe(false);
  });
});

describe("buildEmailDocGroups", () => {
  it("groups N charges under 1 document (the ND case)", () => {
    const groups = buildEmailDocGroups([
      row({ id: "a", documentId: "nd-1" }),
      row({ id: "b", documentId: "nd-1" }),
      row({ id: "c", documentId: "outro" }),
    ]);
    expect(groups).toHaveLength(2);
    const nd = groups.find((g) => g.documentId === "nd-1");
    expect(nd?.charges.map((c) => c.id).sort()).toEqual(["a", "b"]);
  });

  it("orders charges by dueDate asc, nulls last", () => {
    const groups = buildEmailDocGroups([
      row({ id: "late", dueDate: "2026-08-01" }),
      row({ id: "none", dueDate: null }),
      row({ id: "soon", dueDate: "2026-07-01" }),
    ]);
    expect(groups[0].charges.map((c) => c.id)).toEqual(["soon", "late", "none"]);
  });

  it("orders groups by receivedAt desc; no-doc bucket sinks last", () => {
    const groups = buildEmailDocGroups([
      row({ id: "old", documentId: "d-old", documentCreatedAt: "2026-07-01T00:00:00Z" }),
      row({
        id: "nodoc",
        documentId: null,
        documentCreatedAt: null,
        documentFilename: null,
      }),
      row({ id: "new", documentId: "d-new", documentCreatedAt: "2026-07-12T00:00:00Z" }),
    ]);
    expect(groups.map((g) => g.documentId)).toEqual(["d-new", "d-old", null]);
  });

  it("fills remetente from the first charge that carries one", () => {
    const groups = buildEmailDocGroups([
      row({ id: "a", emailSender: null }),
      row({ id: "b", emailSender: "dia@dia.com.br" }),
    ]);
    expect(groups[0].remetente).toBe("dia@dia.com.br");
  });

  it("unions the involved addresses across the document's charges (#47)", () => {
    const groups = buildEmailDocGroups([
      row({ id: "a", documentAddresses: ["a@x.com", "shared@vammo.com"] }),
      row({ id: "b", documentAddresses: ["b@y.com", "shared@vammo.com"] }),
    ]);
    expect(groups[0].addresses).toEqual(["a@x.com", "shared@vammo.com", "b@y.com"]);
  });
});

describe("chargeReadiness", () => {
  it("complete charge has no gaps", () => {
    expect(chargeReadiness(row({ stationId: 100 }))).toEqual([]);
  });

  it("flags every missing field (advisory only)", () => {
    expect(
      chargeReadiness(
        row({ amount: null, stationId: null, dueDate: null, paymentMethod: null }),
      ),
    ).toEqual(["valor", "estacao", "vencimento", "metodo"]);
  });

  it("zero/negative valor counts as missing", () => {
    expect(chargeReadiness(row({ amount: 0, stationId: 1 }))).toEqual(["valor"]);
  });
});
