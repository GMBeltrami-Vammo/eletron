/**
 * Tests for the scraper → app ingestion feed (decision #34), against an
 * in-memory fake ChargingClient (same style as contratos.test.ts):
 *  (a) a state-2 ENEL installation → account (new) + state + charge +
 *      energy_detail with the expected dedupe_key + fatura_drive_url
 *  (b) a state-1 installation (faturas:[]) → state row, NO charge (Ciclo Detectada)
 *  (c) an EXISTING matched account (station_id set) is NOT updated — station_id /
 *      match_status preserved; only its state + charges upsert
 *  (d) a re-POST of the same fatura → no duplicate charge (dedupe converges)
 *  (e) an existing rpc-status charge is not clobbered (includeStatus:false path)
 *  + one EDP case (edp_uc natural key + classificacao/modalidade detail)
 */

import { describe, expect, it } from "vitest";

import { deterministicUuid } from "@/lib/sync/sheet-sync";
import {
  ingestScraperPayload,
  MAX_INSTALLATIONS_PER_POST,
  parseScraperPayload,
  type ScraperProvider,
} from "./scraper-feed";

// ── in-memory fake ChargingClient ─────────────────────────────────────────────
// Supports exactly the query shapes runScraperIngest uses: select().eq().in(),
// insert(), upsert(rows,{onConflict}) [+ optional .select()].

type Row = Record<string, unknown>;

class FakeQuery {
  private op: "select" | "insert" | "upsert" = "select";
  private eqFilters: Array<[string, unknown]> = [];
  private inFilters: Array<[string, unknown[]]> = [];
  private payload: Row | Row[] | null = null;
  private onConflict: string | null = null;
  private ignoreDuplicates = false;
  private returnData = false;
  constructor(
    private store: Record<string, Row[]>,
    private table: string,
    private idSeq: { n: number },
  ) {}

  select() {
    this.returnData = true;
    return this;
  }
  eq(col: string, val: unknown) {
    this.eqFilters.push([col, val]);
    return this;
  }
  in(col: string, arr: unknown[]) {
    this.inFilters.push([col, arr]);
    return this;
  }
  insert(payload: Row | Row[]) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  upsert(payload: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.op = "upsert";
    this.payload = payload;
    this.onConflict = opts?.onConflict ?? null;
    this.ignoreDuplicates = opts?.ignoreDuplicates ?? false;
    return this;
  }

  private table_(): Row[] {
    return (this.store[this.table] ??= []);
  }
  private match(): Row[] {
    let rows = this.store[this.table] ?? [];
    for (const [c, v] of this.eqFilters) rows = rows.filter((r) => r[c] === v);
    for (const [c, arr] of this.inFilters) rows = rows.filter((r) => arr.includes(r[c]));
    return rows;
  }
  private doInsert(): Row[] {
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
    const table = this.table_();
    const inserted = rows.map((r) => ({ id: `id-${this.idSeq.n++}`, ...r }));
    table.push(...inserted);
    return inserted;
  }
  private doUpsert(): Row[] {
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
    const cols = (this.onConflict ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const table = this.table_();
    const out: Row[] = [];
    for (const r of rows) {
      const existing =
        cols.length > 0
          ? table.find((er) => cols.every((c) => er[c] === r[c]))
          : undefined;
      if (existing) {
        if (!this.ignoreDuplicates) Object.assign(existing, r); // else DO NOTHING
        out.push(existing);
      } else {
        const inserted = { id: `id-${this.idSeq.n++}`, ...r };
        table.push(inserted);
        out.push(inserted);
      }
    }
    return out;
  }

  async single() {
    if (this.op === "insert") return { data: this.doInsert()[0], error: null };
    if (this.op === "upsert") return { data: this.doUpsert()[0], error: null };
    const hits = this.match();
    return { data: hits[0] ?? null, error: hits[0] ? null : { message: "not found" } };
  }
  async maybeSingle() {
    if (this.op === "insert") return { data: this.doInsert()[0], error: null };
    if (this.op === "upsert") return { data: this.doUpsert()[0], error: null };
    return { data: this.match()[0] ?? null, error: null };
  }
  // direct await — select() list, or insert/upsert (with/without a .select())
  then(resolve: (v: { data: unknown; error: null }) => void) {
    if (this.op === "insert") {
      const ins = this.doInsert();
      resolve({ data: this.returnData ? ins : null, error: null });
    } else if (this.op === "upsert") {
      const up = this.doUpsert();
      resolve({ data: this.returnData ? up : null, error: null });
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

function emptyStore(): Record<string, Row[]> {
  return {
    billing_accounts: [],
    utility_account_state: [],
    monthly_consumption: [],
    charges: [],
    charge_energy_details: [],
    audit_events: [],
  };
}

// ── fixtures (row-dicts = verbatim sheet headers the scraper builds) ──────────

const ENEL_ID = "204454589";
const ENEL_DUE = "2026-07-20";
const ENEL_DRIVE_URL = "https://drive.google.com/file/d/abc123/view";
const ENEL_ACCOUNT_UUID = deterministicUuid(`enel:${ENEL_ID}`);

function enelAccountRow(): Record<string, unknown> {
  return {
    enel_id: ENEL_ID,
    swap_station_id: "", // external — the scraper does NOT write it
    station_status: "Ativo",
    address: "Rua Teste, 100",
    auto_debit: "Cadastrado",
    auto_debit_registration: "REG-123",
    email: "energia@vammo.com",
    status: "Pendente",
    last_billing: "R$ 1.234,56",
    due_date: ENEL_DUE,
    negotiated_invoices: "",
    invoice_history: "Pendente, A vencer",
    shutdown_date: "",
    first_seen_time: "2026-01-01 10:00:00",
    scraping_time: "2026-07-09 03:00:00",
    lat: "-23,55",
    lon: "-46,63",
    F_JUL26: "123,4",
    R_JUL26: "120,0",
  };
}

function enelFaturaRow(): Record<string, unknown> {
  return {
    enel_id: ENEL_ID,
    value: "R$ 1.234,56",
    due_date: ENEL_DUE,
    auto_debit: "",
    auto_debit_registration: "REG-123",
    NF: "NF-987",
    link_fatura: `=HYPERLINK("${ENEL_DRIVE_URL}";"Ver Fatura")`,
    "Financeiro Check": "FALSE",
    Comprovante: "",
    C1: "0,1",
    C2: "",
    C3: "",
    C4: "",
    C5: "",
    C6: "",
    "TUSD (kWh)": "100,0",
    "TUSD (R$)": "50,0",
    "TE (kWh)": "80,0",
    "TE (R$)": "40,0",
    CIP: "10,0",
    Sub_Faturamento: "",
    Total: "1234,56",
    "Leitura Anterior": "2026-06-15",
    "Leitura Atual": "2026-07-15",
  };
}

function enelState2Payload(provider: ScraperProvider = "enel") {
  return parseScraperPayload({
    provider,
    installations: [
      { installationKey: ENEL_ID, account: enelAccountRow(), faturas: [enelFaturaRow()] },
    ],
  });
}

const EDP_UC = "123456";
const EDP_DUE = "2026-07-25";
const EDP_DRIVE_URL = "https://drive.google.com/file/d/edp1/view";

function edpState2Payload() {
  return parseScraperPayload({
    provider: "edp",
    installations: [
      {
        installationKey: EDP_UC,
        account: {
          uc: EDP_UC,
          edp_id: "EDP-CONTRACT-1",
          swap_station_id: "",
          station_status: "Ativo",
          address: "Av EDP, 200",
          neighborhood: "Centro",
          city: "Santos",
          auto_debit: "Nao Cadastrado",
          auto_debit_registration: "",
          email: "energia@vammo.com",
          status: "A vencer",
          last_billing: "R$ 500,00",
          due_date: EDP_DUE,
          first_seen_time: "2026-02-01 09:00:00",
          scraping_time: "2026-07-09 03:00:00",
          lat: "-23,96",
          lon: "-46,33",
          jul26: "300,0",
        },
        faturas: [
          {
            uc: EDP_UC,
            value: "R$ 500,00",
            due_date: EDP_DUE,
            auto_debit: "",
            auto_debit_registration: "",
            NF: "NF-EDP-1",
            link_fatura: `=HYPERLINK("${EDP_DRIVE_URL}";"Ver Fatura")`,
            "Financeiro Check": "FALSE",
            Comprovante: "",
            classificacao: "Comercial",
            modalidade: "Convencional",
            tipo_fornecimento: "Trifasico",
            "TUSD (kWh)": "200,0",
            "TUSD (R$)": "120,0",
            "TE (kWh)": "150,0",
            "TE (R$)": "90,0",
            CIP: "8,0",
            Total: "500,00",
            "Leitura Anterior": "2026-06-20",
            "Leitura Atual": "2026-07-20",
          },
        ],
      },
    ],
  });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("parseScraperPayload", () => {
  it("normalizes provider casing and defaults faturas to []", () => {
    const p = parseScraperPayload({
      provider: "ENEL",
      installations: [{ installationKey: 999, account: { enel_id: "999" } }],
    });
    expect(p.provider).toBe("enel");
    expect(p.installations[0].faturas).toEqual([]);
    expect(p.installations[0].installationKey).toBe("999");
  });

  it("rejects an unknown provider with a 400", () => {
    expect(() => parseScraperPayload({ provider: "cpfl", installations: [] })).toThrow(
      /provider inválido/,
    );
  });

  it("rejects a batch over the per-POST cap with a 400", () => {
    const installations = Array.from(
      { length: MAX_INSTALLATIONS_PER_POST + 1 },
      (_, i) => ({ installationKey: String(i), account: { enel_id: String(i) } }),
    );
    expect(() => parseScraperPayload({ provider: "enel", installations })).toThrow(
      /lote grande demais/,
    );
  });
});

describe("ingestScraperPayload — ENEL", () => {
  it("(a) state-2: inserts account + state + charge + energy_detail", async () => {
    const store = emptyStore();
    const stats = await ingestScraperPayload(fakeClient(store), enelState2Payload());

    expect(stats).toMatchObject({
      provider: "enel",
      installations: 1,
      accountsInserted: 1,
      statesUpserted: 1,
      chargesUpserted: 1,
      detailsUpserted: 1,
    });

    expect(store.billing_accounts).toHaveLength(1);
    const acct = store.billing_accounts[0];
    expect(acct.id).toBe(ENEL_ACCOUNT_UUID);
    expect(acct.enel_id).toBe(ENEL_ID);
    expect(acct.station_id).toBeNull(); // new → unmatched, no station
    expect(acct.match_status).toBe("unmatched");

    expect(store.utility_account_state).toHaveLength(1);

    expect(store.charges).toHaveLength(1);
    const charge = store.charges[0];
    expect(charge.dedupe_key).toBe(`enel:${ENEL_ID}:${ENEL_DUE}`);
    expect(charge.status_source).toBe("sync");
    expect(charge.kind).toBe("energia");

    expect(store.charge_energy_details).toHaveLength(1);
    expect(store.charge_energy_details[0].fatura_drive_url).toBe(ENEL_DRIVE_URL);

    expect(store.audit_events).toHaveLength(1);
    expect(store.audit_events[0].event_type).toBe("scraper_ingest");
  });

  it("(b) state-1 (no faturas): state row, NO charge → Ciclo Detectada", async () => {
    const store = emptyStore();
    const payload = parseScraperPayload({
      provider: "enel",
      installations: [{ installationKey: ENEL_ID, account: enelAccountRow(), faturas: [] }],
    });
    const stats = await ingestScraperPayload(fakeClient(store), payload);

    expect(stats.statesUpserted).toBe(1);
    expect(stats.chargesUpserted).toBe(0);
    expect(store.billing_accounts).toHaveLength(1);
    expect(store.utility_account_state).toHaveLength(1);
    expect(store.charges).toHaveLength(0);
    expect(store.charge_energy_details).toHaveLength(0);
  });

  it("(c) an EXISTING matched account is NOT updated (station/match preserved)", async () => {
    const store = emptyStore();
    // pre-existing account already matched to station 553 by a human
    store.billing_accounts.push({
      id: ENEL_ACCOUNT_UUID,
      account_type: "energy_enel",
      enel_id: ENEL_ID,
      edp_uc: null,
      station_id: 553,
      match_status: "manually_matched",
    });

    const stats = await ingestScraperPayload(fakeClient(store), enelState2Payload());

    expect(stats.accountsInserted).toBe(0); // no new account
    expect(store.billing_accounts).toHaveLength(1);
    const acct = store.billing_accounts[0];
    expect(acct.station_id).toBe(553); // preserved
    expect(acct.match_status).toBe("manually_matched"); // preserved

    // state + charge still upsert, and the charge inherits the account's station
    expect(store.utility_account_state).toHaveLength(1);
    expect(store.charges).toHaveLength(1);
    expect(store.charges[0].station_id).toBe(553);
    expect(store.charges[0].match_status).toBe("auto_matched");
  });

  it("(d) re-POST of the same fatura converges — no duplicate charge", async () => {
    const store = emptyStore();
    await ingestScraperPayload(fakeClient(store), enelState2Payload());
    await ingestScraperPayload(fakeClient(store), enelState2Payload());

    expect(store.charges).toHaveLength(1);
    expect(store.charge_energy_details).toHaveLength(1);
    expect(store.billing_accounts).toHaveLength(1);
  });

  it("(e) an existing rpc-status charge is not clobbered", async () => {
    const store = emptyStore();
    store.billing_accounts.push({
      id: ENEL_ACCOUNT_UUID,
      account_type: "energy_enel",
      enel_id: ENEL_ID,
      edp_uc: null,
      station_id: 553,
      match_status: "manually_matched",
    });
    // a human already marked this charge paid + sent to fiscal (status_source rpc)
    store.charges.push({
      id: "charge-rpc-1",
      dedupe_key: `enel:${ENEL_ID}:${ENEL_DUE}`,
      status: "pago",
      status_source: "rpc",
      station_id: 553,
      match_status: "manually_matched",
      fiscal_exported: true,
      flags: ["adjusted"],
      amount: 1234.56,
    });

    await ingestScraperPayload(fakeClient(store), enelState2Payload());

    expect(store.charges).toHaveLength(1);
    const charge = store.charges[0];
    expect(charge.status).toBe("pago"); // preserved (includeStatus:false)
    expect(charge.status_source).toBe("rpc"); // preserved
    expect(charge.fiscal_exported).toBe(true); // preserved
    expect(charge.flags).toEqual(["adjusted"]); // preserved
    expect(charge.station_id).toBe(553); // not un-matched
  });

  it("(f) surfaces normalize issues — a fatura without its key is dropped, not ingested", async () => {
    const store = emptyStore();
    const fatura = enelFaturaRow();
    delete (fatura as Record<string, unknown>).enel_id; // fatura loses its key → dropped + logged
    const payload = parseScraperPayload({
      provider: "enel",
      installations: [
        { installationKey: ENEL_ID, account: enelAccountRow(), faturas: [fatura] },
      ],
    });
    const stats = await ingestScraperPayload(fakeClient(store), payload);

    expect(stats.normalizeIssues).toBeGreaterThan(0); // the drop is reported, not silent
    expect(stats.chargesUpserted).toBe(0); // no charge from the malformed fatura
    expect(store.charges).toHaveLength(0);
    expect(store.billing_accounts).toHaveLength(1); // the account row still landed
  });
});

describe("ingestScraperPayload — EDP", () => {
  it("state-2: inserts edp account (edp_uc key) + charge + detail", async () => {
    const store = emptyStore();
    const stats = await ingestScraperPayload(fakeClient(store), edpState2Payload());

    expect(stats).toMatchObject({
      provider: "edp",
      accountsInserted: 1,
      chargesUpserted: 1,
      detailsUpserted: 1,
    });

    expect(store.billing_accounts).toHaveLength(1);
    expect(store.billing_accounts[0].edp_uc).toBe(EDP_UC);
    expect(store.billing_accounts[0].account_type).toBe("energy_edp");

    expect(store.charges).toHaveLength(1);
    expect(store.charges[0].dedupe_key).toBe(`edp:${EDP_UC}:${EDP_DUE}`);

    expect(store.charge_energy_details).toHaveLength(1);
    expect(store.charge_energy_details[0].fatura_drive_url).toBe(EDP_DRIVE_URL);
    expect(store.charge_energy_details[0].classificacao).toBe("Comercial");
  });
});
