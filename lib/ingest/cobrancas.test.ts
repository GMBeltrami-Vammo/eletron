/**
 * Tests for the email-cobrança ingestion core (R2):
 *  - parsePayload: lenient shape + `dados` unwrap
 *  - normalizeCobranca: kind/competência/valor/pix-vs-boleto/status
 *  - cobrancaDedupeKey: C1 — MATCHED aluguel claims the gerar_mes `pag:` key
 *    (convergence in both orders), everything else the content `email:` key
 *  - ingestCobrancasPayload against an in-memory fake client: create vs
 *    converge, H4 (only pendente → boleto_recebido; human amount preserved),
 *    M5 (document dedupe by content_hash), NOT_A_BILL short-circuit.
 */

import { describe, expect, it } from "vitest";

import {
  cobrancaDedupeKey,
  ingestCobrancasPayload,
  normalizeCobranca,
  parsePayload,
  type RawCobranca,
} from "./cobrancas";

// ── pure layer ───────────────────────────────────────────────────────────────

describe("parsePayload", () => {
  it("accepts the n8n envelope and tolerates missing fields", () => {
    const p = parsePayload({
      cobrancas: [{ status: "MATCHED", "Tipo de Cobrança": "Aluguel" }],
      drive_file_id: "f1",
      nome_arquivo: "boleto.pdf",
    });
    expect(p.cobrancas).toHaveLength(1);
    expect(p.drive_file_id).toBe("f1");
  });

  it("unwraps cobrancas nested under a JSON-string `dados`", () => {
    const p = parsePayload({
      dados: JSON.stringify({ cobrancas: [{ status: "UNIDENTIFIED" }] }),
      drive_file_id: "f2",
    });
    expect(p.cobrancas).toHaveLength(1);
    expect(p.cobrancas[0].status).toBe("UNIDENTIFIED");
  });
});

describe("normalizeCobranca", () => {
  it("maps kind, competência (day≤10 rule already applied), and status", () => {
    const c = normalizeCobranca({
      status: "matched",
      "Tipo de Cobrança": "Aluguel + Energia",
      Mês: "Julho",
      Ano: "2026",
      cadastro_id: "44",
      swap_station_id: "553",
    } as RawCobranca);
    expect(c.kind).toBe("aluguel_energia");
    expect(c.competencia).toBe("2026-07-01");
    expect(c.status).toBe("MATCHED");
    expect(c.cadastroId).toBe(44);
    expect(c.stationId).toBe(553);
  });

  it("classifies a 47-digit code as linha digitável, an email as pix", () => {
    const boleto = normalizeCobranca({
      "Chave Pix / Código do Boleto": "34191.79001 01043.510047 91020.150008 8 91234567890123",
    } as RawCobranca);
    expect(boleto.linhaDigitavel).not.toBeNull();
    expect(boleto.chavePix).toBeNull();

    const pix = normalizeCobranca({
      "Chave Pix / Código do Boleto": "financeiro@parceiro.com",
    } as RawCobranca);
    expect(pix.chavePix).toBe("financeiro@parceiro.com");
    expect(pix.linhaDigitavel).toBeNull();
  });

  it("defaults an unknown status to UNIDENTIFIED", () => {
    expect(normalizeCobranca({ status: "weird" } as RawCobranca).status).toBe(
      "UNIDENTIFIED",
    );
  });
});

describe("cobrancaDedupeKey (C1)", () => {
  const matchedRent = normalizeCobranca({
    status: "MATCHED",
    "Tipo de Cobrança": "Aluguel",
    Mês: "Julho",
    Ano: "2026",
    cadastro_id: "44",
  } as RawCobranca);

  it("MATCHED aluguel claims the gerar_mes pag: key (convergence)", () => {
    const key = cobrancaDedupeKey(matchedRent, "drive1", new Map());
    // MUST equal migration 8 gerar_mes: 'pag:{cadastro}:{YYYY-MM}:aluguel'
    expect(key).toBe("pag:44:2026-07:aluguel");
  });

  it("UNIDENTIFIED / energy cobranças use the content email: key", () => {
    const energy = normalizeCobranca({
      status: "MATCHED",
      "Tipo de Cobrança": "Energia",
      Mês: "Julho",
      Ano: "2026",
    } as RawCobranca);
    expect(cobrancaDedupeKey(energy, "drive9", new Map())).toBe(
      "email:drive9:energia:2026-07",
    );
    const unid = normalizeCobranca({ status: "UNIDENTIFIED" } as RawCobranca);
    expect(cobrancaDedupeKey(unid, "drive9", new Map())).toBe(
      "email:drive9:aluguel:na",
    );
  });

  it("suffixes in-payload collisions deterministically", () => {
    const taken = new Map<string, number>();
    expect(cobrancaDedupeKey(matchedRent, "d", taken)).toBe("pag:44:2026-07:aluguel");
    expect(cobrancaDedupeKey(matchedRent, "d", taken)).toBe("pag:44:2026-07:aluguel#2");
  });
});

// ── in-memory fake ChargingClient ─────────────────────────────────────────────
// Supports exactly the query shapes ingestCobrancasPayload uses.

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
  order() {
    return this;
  }
  limit() {
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push([col, val]);
    return this;
  }
  in() {
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
  // direct await (no maybeSingle/single) — insert without select, update, or list read
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

function payloadMatchedRent(overrides: Partial<RawCobranca> = {}) {
  return {
    cobrancas: [
      {
        status: "MATCHED",
        "Tipo de Cobrança": "Aluguel",
        Mês: "Julho",
        Ano: "2026",
        cadastro_id: "44",
        swap_station_id: "553",
        Valor: "1500,00",
        "Tipo de Pagamento": "Pix",
        "Chave Pix / Código do Boleto": "financeiro@parceiro.com",
        ...overrides,
      },
    ],
    drive_file_id: "drive-abc",
    nome_arquivo: "boleto.pdf",
    remetente: "cobranca@parceiro.com",
    gmail_message_id: "gmail-1",
  };
}

describe("ingestCobrancasPayload", () => {
  it("creates a needs_review charge on the pag: key when none exists", async () => {
    const store: Record<string, Row[]> = {
      stations: [{ id: 553, name: "Estação 553" }],
      contracts: [{ id: "c1", cadastro_id: 44, station_id: 553 }],
      billing_accounts: [
        { id: "ba1", contract_id: "c1", account_type: "rent", station_id: 553 },
      ],
      charges: [],
      documents: [],
      charge_lines: [],
      audit_events: [],
    };
    const stats = await ingestCobrancasPayload(
      fakeClient(store),
      parsePayload(payloadMatchedRent()),
      DOWNLOAD,
    );
    expect(stats.created).toBe(1);
    expect(stats.converged).toBe(0);
    expect(store.charges).toHaveLength(1);
    const c = store.charges[0];
    expect(c.dedupe_key).toBe("pag:44:2026-07:aluguel");
    expect(c.match_status).toBe("needs_review"); // requirement 4.1
    expect(c.billing_account_id).toBe("ba1");
    expect(c.status).toBe("boleto_recebido");
  });

  it("converges onto an existing gerar_mes charge, advancing only pendente (H4)", async () => {
    const store: Record<string, Row[]> = {
      stations: [{ id: 553, name: "Estação 553" }],
      contracts: [{ id: "c1", cadastro_id: 44, station_id: 553 }],
      billing_accounts: [
        { id: "ba1", contract_id: "c1", account_type: "rent", station_id: 553 },
      ],
      // gerar_mes already generated this month, human-set amount, still pendente
      charges: [
        {
          id: "chg-1",
          dedupe_key: "pag:44:2026-07:aluguel",
          status: "pendente",
          amount: 1400,
          expected_amount: 1400,
          flags: [],
          source_document_id: null,
          banco: null,
          agencia: null,
          conta: null,
          chave_pix: null,
          linha_digitavel: null,
          payment_method: null,
        },
      ],
      documents: [],
      charge_lines: [],
      audit_events: [],
    };
    const stats = await ingestCobrancasPayload(
      fakeClient(store),
      parsePayload(payloadMatchedRent()),
      DOWNLOAD,
    );
    expect(stats.created).toBe(0);
    expect(stats.converged).toBe(1);
    expect(stats.statusAdvanced).toBe(1);
    expect(store.charges).toHaveLength(1); // NO duplicate
    const c = store.charges[0];
    expect(c.status).toBe("boleto_recebido"); // pendente advanced
    expect(c.source_document_id).not.toBeNull(); // document attached
    expect(c.chave_pix).toBe("financeiro@parceiro.com"); // empty field filled
    expect(c.match_status).toBe("needs_review");
  });

  it("never regresses a pago charge (H4): attach only, no status/amount change", async () => {
    const store: Record<string, Row[]> = {
      stations: [{ id: 553 }],
      contracts: [{ id: "c1", cadastro_id: 44, station_id: 553 }],
      billing_accounts: [
        { id: "ba1", contract_id: "c1", account_type: "rent", station_id: 553 },
      ],
      charges: [
        {
          id: "chg-1",
          dedupe_key: "pag:44:2026-07:aluguel",
          status: "pago",
          amount: 1400,
          expected_amount: 1400,
          flags: [],
          source_document_id: null,
          banco: null,
          agencia: null,
          conta: null,
          chave_pix: null,
          linha_digitavel: null,
          payment_method: null,
        },
      ],
      documents: [],
      charge_lines: [],
      audit_events: [],
    };
    const stats = await ingestCobrancasPayload(
      fakeClient(store),
      parsePayload(payloadMatchedRent()),
      DOWNLOAD,
    );
    expect(stats.statusAdvanced).toBe(0);
    expect(store.charges[0].status).toBe("pago"); // untouched
    expect(store.charges[0].source_document_id).not.toBeNull(); // still attached
  });

  it("dedupes the document by content_hash across redeliveries (M5)", async () => {
    const base = {
      stations: [{ id: 553 }],
      contracts: [{ id: "c1", cadastro_id: 44, station_id: 553 }],
      billing_accounts: [
        { id: "ba1", contract_id: "c1", account_type: "rent", station_id: 553 },
      ],
      charge_lines: [] as Row[],
      audit_events: [] as Row[],
    };
    const store: Record<string, Row[]> = { ...base, charges: [], documents: [] };
    await ingestCobrancasPayload(fakeClient(store), parsePayload(payloadMatchedRent()), DOWNLOAD);
    const r2 = await ingestCobrancasPayload(
      fakeClient(store),
      parsePayload(payloadMatchedRent()),
      DOWNLOAD,
    );
    expect(store.documents).toHaveLength(1); // same sha256 → reused
    expect(r2.documentReused).toBe(true);
    expect(store.charges).toHaveLength(1); // and the charge converged, not duplicated
  });

  it("short-circuits NOT_A_BILL with no rows", async () => {
    const store: Record<string, Row[]> = {
      charges: [],
      documents: [],
      audit_events: [],
    };
    const stats = await ingestCobrancasPayload(
      fakeClient(store),
      parsePayload({
        cobrancas: [{ status: "NOT_A_BILL" }],
        drive_file_id: "d",
      }),
      DOWNLOAD,
    );
    expect(stats.notABill).toBe(1);
    expect(stats.created).toBe(0);
    expect(store.charges).toHaveLength(0);
    expect(store.documents).toHaveLength(0);
    expect(store.audit_events).toHaveLength(1); // skipped event recorded
  });
});
