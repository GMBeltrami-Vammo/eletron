import "server-only";

/**
 * Read-side projection of the `gerar_mes` RPC (migration 3). Computes, WITHOUT
 * writing, exactly what the RPC would create for a given competência so the
 * operator can review before confirming. This mirrors the SQL pricing branch
 * for branch — keep the two in sync if either changes.
 *
 * Reads contracts + stations + existing dedupe keys through the service-role
 * client (same rationale as repository.server.ts: server components sit behind
 * the auth gate and charging SELECT RLS is a uniform is_vammo_user()).
 */

import type { ContractType, PaymentMethod, StationStatus } from "@/lib/domain";
import { num, type ChargingClient } from "@/lib/data/supabase-repository";
import { CONTRACT_TYPE_UI } from "@/lib/labels";
import { formatBRL } from "@/lib/format";
import type {
  GerarMesPreviewRow,
  GerarMesProjection,
  GerarMesSkippedRow,
} from "./gerar-mes-types";

interface ContractRow {
  id: string;
  cadastro_id: number | null;
  station_id: number | null;
  status: StationStatus;
  contract_type: ContractType;
  box_count: number | null;
  min_box: number | null;
  valor_por_box: string | number | null;
  valor_mensal: string | number | null;
  due_day: number | null;
  payment_method: PaymentMethod | null;
}

interface StationRow {
  id: number;
  name: string | null;
  active_boxes: number | null;
  boxes_synced_at: string | null;
  source_created_at: string | null;
}

const PAGE = 1000;

/** Minimal shape of a range-able PostgREST query (untyped charging schema). */
interface Pageable {
  range(
    from: number,
    to: number,
  ): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
}

/** Reads every row of a query factory in 1000-row pages (H3 pagination). */
async function readAll<T>(build: () => unknown): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await (build() as Pageable).range(
      from,
      from + PAGE - 1,
    );
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

function ym(month: Date): string {
  const y = month.getUTCFullYear();
  const m = String(month.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** First-of-month (UTC) for any date in the target month. */
export function monthStart(competencia: string): Date {
  const [y, m] = competencia.split("-").map(Number);
  return new Date(Date.UTC(y || 1970, (m || 1) - 1, 1));
}

export async function computeGerarMesProjection(
  admin: ChargingClient,
  month: Date,
): Promise<GerarMesProjection> {
  const monthYm = ym(month);
  const competencia = `${monthYm}-01`;

  const contracts = await readAll<ContractRow>(() =>
    admin
      .from("contracts")
      .select(
        "id, cadastro_id, station_id, status, contract_type, box_count, min_box, valor_por_box, valor_mensal, due_day, payment_method",
      )
      .order("id", { ascending: true }),
  );
  const stationRows = await readAll<StationRow>(() =>
    admin
      .from("stations")
      .select("id, name, active_boxes, boxes_synced_at, source_created_at")
      .order("id", { ascending: true }),
  );
  const existing = await readAll<{ dedupe_key: string }>(() =>
    admin
      .from("charges")
      .select("dedupe_key")
      .like("dedupe_key", `pag:%:${monthYm}:aluguel`)
      .order("dedupe_key", { ascending: true }),
  );

  const stationById = new Map(stationRows.map((s) => [s.id, s]));
  const existingKeys = new Set(existing.map((r) => r.dedupe_key));
  const now = Date.now();

  const rows: GerarMesPreviewRow[] = [];
  const skipped: GerarMesSkippedRow[] = [];

  for (const c of contracts) {
    const station =
      c.station_id !== null ? stationById.get(c.station_id) : undefined;
    const stationName = station?.name ?? null;

    // RPC loop filter: ACTIVE contracts paid by pix/transferência only.
    if (c.status !== "ACTIVE") {
      skipped.push({
        cadastroId: c.cadastro_id,
        stationId: c.station_id,
        stationName,
        contractType: c.contract_type,
        reason: `Locação não ativa (${c.status})`,
      });
      continue;
    }
    if (c.payment_method !== "pix" && c.payment_method !== "transferencia") {
      skipped.push({
        cadastroId: c.cadastro_id,
        stationId: c.station_id,
        stationName,
        contractType: c.contract_type,
        reason: `Pagamento ${c.payment_method ?? "não informado"} — só Pix/Transferência`,
      });
      continue;
    }

    const boxes = station?.active_boxes ?? null;
    const valorMensal = num(c.valor_mensal);
    const valorPorBox = num(c.valor_por_box);
    const flags: string[] = [];
    let amount: number | null;
    let formulaBody: string;

    switch (c.contract_type) {
      case "fixo":
        amount = valorMensal;
        formulaBody = `Valor fixo = ${formatBRL(amount)}`;
        break;
      case "por_box":
        if (boxes === null) {
          amount = valorMensal;
          flags.push("no_metabase_data");
          formulaBody = `Valor mensal (sem dados de boxes) = ${formatBRL(amount)}`;
        } else if (boxes === c.box_count) {
          amount = valorMensal;
          formulaBody = `${boxes} box × ${formatBRL(valorPorBox)} = ${formatBRL(amount)}`;
        } else {
          amount = valorPorBox !== null ? boxes * valorPorBox : null;
          flags.push("boxes_mismatch");
          formulaBody = `${boxes} box × ${formatBRL(valorPorBox)} = ${formatBRL(amount)}`;
        }
        break;
      case "por_box_minimo":
        if (boxes === null) {
          amount = valorMensal;
          flags.push("no_metabase_data");
          formulaBody = `Valor mensal (sem dados de boxes) = ${formatBRL(amount)}`;
        } else {
          const effective = Math.max(c.min_box ?? 0, boxes);
          amount = valorPorBox !== null ? effective * valorPorBox : null;
          if (boxes !== c.box_count) flags.push("boxes_mismatch");
          formulaBody = `MAX(${c.min_box ?? 0}; ${boxes}) × ${formatBRL(valorPorBox)} = ${formatBRL(amount)}`;
        }
        break;
      default:
        // gratuito / casa_vammo — nothing to bill (RPC `continue`).
        skipped.push({
          cadastroId: c.cadastro_id,
          stationId: c.station_id,
          stationName,
          contractType: c.contract_type,
          reason: "Sem cobrança de aluguel (gratuito / casa Vammo)",
        });
        continue;
    }

    if (amount === null || amount <= 0) {
      skipped.push({
        cadastroId: c.cadastro_id,
        stationId: c.station_id,
        stationName,
        contractType: c.contract_type,
        reason: "Valor calculado inválido ou zero",
      });
      continue;
    }

    // M5 pro-rata: station created within the competência month.
    if (station?.source_created_at) {
      const created = new Date(station.source_created_at);
      if (
        created.getUTCFullYear() === month.getUTCFullYear() &&
        created.getUTCMonth() === month.getUTCMonth()
      ) {
        const createdDay = created.getUTCDate();
        if (createdDay >= 5) {
          const prorata = Math.max((30 - createdDay + 1) / 30, 1 / 30);
          amount = Math.round(amount * prorata * 100) / 100;
          flags.push("new_station", "pro_rata");
          formulaBody += ` × (30−${createdDay}+1)/30 = ${formatBRL(amount)}`;
        } else {
          flags.push("new_station");
        }
      }
    }

    if (station?.boxes_synced_at) {
      const age = now - new Date(station.boxes_synced_at).getTime();
      if (age > 48 * 3600 * 1000) flags.push("boxes_stale");
    }

    const dedupeKey = `pag:${c.cadastro_id ?? c.id}:${monthYm}:aluguel`;
    const label = CONTRACT_TYPE_UI[c.contract_type]?.label ?? c.contract_type;

    rows.push({
      dedupeKey,
      cadastroId: c.cadastro_id,
      stationId: c.station_id,
      stationName,
      contractType: c.contract_type,
      amount,
      formula: `${label}: ${formulaBody}`,
      flags,
      alreadyExists: existingKeys.has(dedupeKey),
    });
  }

  rows.sort((a, b) => (a.stationId ?? Infinity) - (b.stationId ?? Infinity));
  skipped.sort((a, b) => (a.stationId ?? Infinity) - (b.stationId ?? Infinity));

  const toCreate = rows.filter((r) => !r.alreadyExists);
  return {
    competencia,
    rows,
    skipped,
    toCreateCount: toCreate.length,
    toCreateTotal: toCreate.reduce((sum, r) => sum + r.amount, 0),
    alreadyExistsCount: rows.length - toCreate.length,
    flaggedCount: toCreate.filter((r) => r.flags.length > 0).length,
  };
}
