/**
 * Tests for the contract-onboarding ingestion core (Q10):
 *  - parseContratoPayload: flat AI fields + envelope; `dados`/`extractedData`
 *    unwrap (object + JSON string); top-level keys win
 *  - contractIntakePrefill: pt-BR → enum mapping + modality field coalescing
 *  - ingestContratoPayload against an in-memory fake client: creates a pending
 *    intake + a document; document dedupe by content_hash; idempotent
 *    re-delivery (same drive_file_id → one intake, not reopened once reviewed).
 */

import { describe, expect, it } from "vitest";

import {
  contractIntakePrefill,
  ingestContratoPayload,
  parseContratoPayload,
} from "./contratos";

// ── pure layer ───────────────────────────────────────────────────────────────

describe("parseContratoPayload", () => {
  it("accepts a flat AI payload + envelope and tolerates missing fields", () => {
    const p = parseContratoPayload({
      swap_station_id: 553,
      parceiro_locador: "Imobiliária X",
      tipo_de_contrato: "Fixo",
      drive_file_id: "f1",
      web_view_link: "https://drive/f1",
      nome_arquivo: "contrato.pdf",
    });
    expect(p.driveFileId).toBe("f1");
    expect(p.webViewLink).toBe("https://drive/f1");
    expect(p.nomeArquivo).toBe("contrato.pdf");
    expect(p.extraction.swap_station_id).toBe(553);
    expect(p.extraction.parceiro_locador).toBe("Imobiliária X");
  });

  it("unwraps a JSON-string `dados` and lets top-level keys win", () => {
    const p = parseContratoPayload({
      dados: JSON.stringify({ parceiro_locador: "Nested Co", tipo_de_contrato: "Fixo" }),
      parceiro_locador: "Top Co", // top-level overrides the nested copy
      drive_file_id: "f2",
    });
    expect(p.extraction.parceiro_locador).toBe("Top Co");
    expect(p.extraction.tipo_de_contrato).toBe("Fixo");
  });

  it("unwraps a nested `extractedData` object", () => {
    const p = parseContratoPayload({
      extractedData: { swap_station_id: 12, cnpj_ou_cpf: "12345678000199" },
      drive_file_id: "f3",
    });
    expect(p.extraction.swap_station_id).toBe(12);
    expect(p.extraction.cnpj_ou_cpf).toBe("12345678000199");
  });
});

describe("contractIntakePrefill", () => {
  it("maps pt-BR status/type/payment to enums and coalesces modality fields", () => {
    const pf = contractIntakePrefill({
      status_da_locacao: "Ativa",
      tipo_de_contrato: "Por box c/ mínimo",
      tipo_pagamento: "Boleto (telefone)",
      qtd_boxes_por_box_minimo: 5,
      minimo_boxes: 3,
      valor_por_box_minimo: 120.5,
      dia_vencimento: 10,
      cnpj_ou_cpf: "12345678000199",
      parceiro_locador: "Loc X",
    });
    expect(pf.status).toBe("ACTIVE");
    expect(pf.contractType).toBe("por_box_minimo");
    expect(pf.paymentMethod).toBe("boleto_celular"); // "Boleto (telefone)" ≡ celular
    expect(pf.boxCount).toBe(5); // coalesced from qtd_boxes_por_box_minimo
    expect(pf.minBox).toBe(3);
    expect(pf.valorPorBox).toBe(120.5);
    expect(pf.dueDay).toBe(10);
    expect(pf.counterpartyCnpj).toBe("12345678000199");
  });

  it("maps 'Em negociação' → PRE_INSTALLATION and 'Fixo'/'Pix' with a fixed value", () => {
    const pf = contractIntakePrefill({
      status_da_locacao: "Em negociação",
      tipo_de_contrato: "Fixo",
      tipo_pagamento: "Pix",
      qtd_boxes_fixo: 4,
      valor_mensal_fixo: 1500,
      chave_pix: "a@b.com",
    });
    expect(pf.status).toBe("PRE_INSTALLATION");
    expect(pf.contractType).toBe("fixo");
    expect(pf.paymentMethod).toBe("pix");
    expect(pf.boxCount).toBe(4);
    expect(pf.valorMensal).toBe(1500);
    expect(pf.chavePix).toBe("a@b.com");
  });

  it("defaults status to ACTIVE and contractType to null when the AI left them out", () => {
    const pf = contractIntakePrefill({});
    expect(pf.status).toBe("ACTIVE");
    expect(pf.contractType).toBeNull();
    expect(pf.paymentMethod).toBeNull();
  });
});

// ── in-memory fake ChargingClient ─────────────────────────────────────────────
// Supports exactly the query shapes ingestContratoPayload uses.

type Row = Record<string, unknown>;

class FakeQuery {
  private op: "select" | "insert" | "update" = "select";
  private filters: Array<[string, unknown]> = [];
  private payload: Row | Row[] | null = null;
  private patch: Row | null = null;
  constructor(
    private store: Record<string, Row[]>,
    private table: string,
    private idSeq: { n: number },
  ) {}

  select() {
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push([col, val]);
    return this;
  }
  insert(payload: Row | Row[]) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.patch = patch;
    return this;
  }

  private match(): Row[] {
    const rows = this.store[this.table] ?? [];
    return rows.filter((r) => this.filters.every(([c, v]) => r[c] === v));
  }
  private doInsert(): Row[] {
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
    const inserted = rows.map((r) => ({ id: `id-${this.idSeq.n++}`, ...r }));
    (this.store[this.table] ??= []).push(...inserted);
    return inserted;
  }
  private doUpdate(): void {
    for (const r of this.match()) Object.assign(r, this.patch);
  }

  async maybeSingle() {
    if (this.op === "insert") {
      const [row] = this.doInsert();
      return { data: row, error: null };
    }
    const hits = this.match();
    return { data: hits[0] ?? null, error: null };
  }
  async single() {
    if (this.op === "insert") {
      const [row] = this.doInsert();
      return { data: row, error: null };
    }
    const hits = this.match();
    return { data: hits[0] ?? null, error: hits[0] ? null : { message: "not found" } };
  }
  // direct await (no maybeSingle/single) — insert without select, or update
  then(resolve: (v: { data: unknown; error: null }) => void) {
    if (this.op === "insert") {
      this.doInsert();
      resolve({ data: null, error: null });
    } else if (this.op === "update") {
      this.doUpdate();
      resolve({ data: null, error: null });
    } else {
      resolve({ data: this.match(), error: null });
    }
  }
}

function fakeClient(store: Record<string, Row[]>) {
  const idSeq = { n: 1 };
  return {
    from(table: string) {
      return new FakeQuery(store, table, idSeq);
    },
  } as never;
}

const DOWNLOAD = async () => Buffer.from("%PDF-1.4\nfake pdf bytes\n%%EOF");

function payload(driveFileId = "drive-abc") {
  return parseContratoPayload({
    swap_station_id: 553,
    status_da_locacao: "Ativa",
    tipo_de_contrato: "Fixo",
    parceiro_locador: "Imobiliária Teste",
    valor_mensal_fixo: 1500,
    drive_file_id: driveFileId,
    web_view_link: "https://drive/x",
    nome_arquivo: "contrato.pdf",
  });
}

describe("ingestContratoPayload", () => {
  it("creates a pending intake + a document when none exists", async () => {
    const store: Record<string, Row[]> = {
      documents: [],
      contract_intake: [],
      audit_events: [],
    };
    const stats = await ingestContratoPayload(fakeClient(store), payload(), DOWNLOAD);

    expect(store.documents).toHaveLength(1);
    expect(store.contract_intake).toHaveLength(1);
    const intake = store.contract_intake[0];
    expect(intake.status).toBe("pending");
    expect(intake.drive_file_id).toBe("drive-abc");
    expect(intake.document_id).toBe(stats.documentId);
    expect((intake.ai_extraction as Row).parceiro_locador).toBe("Imobiliária Teste");
    expect(store.audit_events).toHaveLength(1);
    expect(stats.status).toBe("pending");
    expect(stats.documentReused).toBe(false);
    expect(stats.intakeReused).toBe(false);
  });

  it("dedupes the document + intake by content_hash on redelivery", async () => {
    const store: Record<string, Row[]> = {
      documents: [],
      contract_intake: [],
      audit_events: [],
    };
    await ingestContratoPayload(fakeClient(store), payload(), DOWNLOAD);
    const r2 = await ingestContratoPayload(fakeClient(store), payload(), DOWNLOAD);

    expect(store.documents).toHaveLength(1); // same sha256 → reused
    expect(store.contract_intake).toHaveLength(1); // same document → reused
    expect(r2.documentReused).toBe(true);
    expect(r2.intakeReused).toBe(true);
    expect(r2.status).toBe("pending");
  });

  it("dedupes the intake by content even when re-uploaded under a NEW drive_file_id", async () => {
    const store: Record<string, Row[]> = {
      documents: [],
      contract_intake: [],
      audit_events: [],
    };
    // same signed PDF (same bytes → same content_hash) dropped twice under
    // different Drive file ids must NOT create a second pending intake
    await ingestContratoPayload(fakeClient(store), payload("drive-A"), DOWNLOAD);
    const r2 = await ingestContratoPayload(fakeClient(store), payload("drive-B"), DOWNLOAD);

    expect(store.documents).toHaveLength(1); // same bytes → one document
    expect(store.contract_intake).toHaveLength(1); // same document → one intake
    expect(r2.documentReused).toBe(true);
    expect(r2.intakeReused).toBe(true);
  });

  it("does not reopen an already-confirmed intake on redelivery", async () => {
    const store: Record<string, Row[]> = {
      documents: [],
      contract_intake: [],
      audit_events: [],
    };
    await ingestContratoPayload(fakeClient(store), payload(), DOWNLOAD);
    // human confirmed it (leaves 'pending')
    store.contract_intake[0].status = "confirmed";
    store.contract_intake[0].contract_id = "contract-1";

    const r2 = await ingestContratoPayload(fakeClient(store), payload(), DOWNLOAD);
    expect(r2.intakeReused).toBe(true);
    expect(r2.status).toBe("confirmed");
    expect(store.contract_intake).toHaveLength(1);
    // untouched — still confirmed, still linked to the created contract
    expect(store.contract_intake[0].status).toBe("confirmed");
    expect(store.contract_intake[0].contract_id).toBe("contract-1");
  });

  it("promotes an app-staged awaiting_extraction intake to pending (#48 app-drop flow)", async () => {
    const store: Record<string, Row[]> = {
      documents: [],
      contract_intake: [],
      audit_events: [],
    };
    // simulate the app upload: a document + an empty awaiting_extraction intake
    // already exist for this content when n8n's extraction POST arrives.
    await ingestContratoPayload(fakeClient(store), payload(), DOWNLOAD);
    const docId = store.documents[0].id;
    store.contract_intake[0].status = "awaiting_extraction";
    store.contract_intake[0].ai_extraction = {};

    const r2 = await ingestContratoPayload(fakeClient(store), payload(), DOWNLOAD);

    expect(store.contract_intake).toHaveLength(1); // same document → reused
    expect(r2.intakeReused).toBe(true);
    expect(r2.status).toBe("pending"); // flipped by the extraction
    const intake = store.contract_intake[0];
    expect(intake.status).toBe("pending");
    expect(intake.document_id).toBe(docId);
    // the extraction now fills what the app left empty
    expect((intake.ai_extraction as Row).parceiro_locador).toBe("Imobiliária Teste");
  });

  it("throws a 422 when drive_file_id is missing", async () => {
    const store: Record<string, Row[]> = { documents: [], contract_intake: [], audit_events: [] };
    await expect(
      ingestContratoPayload(fakeClient(store), payload(""), DOWNLOAD),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("throws a 422 when the Drive download fails", async () => {
    const store: Record<string, Row[]> = { documents: [], contract_intake: [], audit_events: [] };
    const failing = async () => {
      throw new Error("drive 404");
    };
    await expect(
      ingestContratoPayload(fakeClient(store), payload(), failing),
    ).rejects.toMatchObject({ status: 422 });
  });
});
