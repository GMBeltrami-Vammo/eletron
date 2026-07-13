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
import { computeBoxDaysProrata, inactivationFraction } from "./box-prorata";
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
  rent_manual: boolean | null;
  inactivated_on: string | null;
}

interface StationRow {
  id: number;
  name: string | null;
  active_boxes: number | null;
  boxes_synced_at: string | null;
  source_created_at: string | null;
  /** BRT activation dates of active boxes (#50) — one per box, or null. */
  box_activations: (string | null)[] | null;
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
        "id, cadastro_id, station_id, status, contract_type, box_count, min_box, valor_por_box, valor_mensal, due_day, payment_method, rent_manual, inactivated_on",
      )
      .order("id", { ascending: true }),
  );
  const stationRows = await readAll<StationRow>(() =>
    admin
      .from("stations")
      .select("id, name, active_boxes, boxes_synced_at, source_created_at, box_activations")
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

    // A contract inactivated WITHIN this competência is still billed (its last
    // month, pro-rata'd to the inactivation day — #51); any other non-ACTIVE
    // contract is skipped, exactly like the RPC filter.
    const terminal =
      c.status === "INACTIVE" &&
      c.inactivated_on != null &&
      c.inactivated_on.slice(0, 7) === monthYm;
    if (c.status !== "ACTIVE" && !terminal) {
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
    // RPC also excludes rent_manual contracts (M7 — reminded, never generated).
    if (c.rent_manual === true) {
      skipped.push({
        cadastroId: c.cadastro_id,
        stationId: c.station_id,
        stationName,
        contractType: c.contract_type,
        reason: "Aluguel manual — lembrete, não gerado automaticamente",
      });
      continue;
    }

    const boxes = station?.active_boxes ?? null;
    const valorMensal = num(c.valor_mensal);
    const flags: string[] = [];
    let amount: number | null;
    let formulaBody: string;

    switch (c.contract_type) {
      case "fixo":
        amount = valorMensal;
        formulaBody = `Valor fixo = ${formatBRL(amount)}`;
        break;
      // por_box / por_box_minimo bill the AGREED valor_mensal (Metabase never
      // changes the amount — it only flags box drift). Mirrors the RPC.
      case "por_box":
      case "por_box_minimo":
        amount = valorMensal;
        if (boxes === null) {
          flags.push("no_metabase_data");
          formulaBody = `Valor mensal (sem dados de boxes do Metabase) = ${formatBRL(amount)}`;
        } else if (c.box_count !== null && boxes !== c.box_count) {
          // Match SQL: `v_boxes <> box_count` is NULL (not true) when box_count
          // is null, so a null contract box_count is NOT a mismatch.
          flags.push("boxes_mismatch");
          formulaBody = `Valor mensal ${formatBRL(amount)} · Metabase ${boxes} box ≠ contrato ${c.box_count} box`;
        } else {
          formulaBody = `Valor mensal (${boxes} box) = ${formatBRL(amount)}`;
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

    if (terminal && c.inactivated_on) {
      // terminal: last month billed for days 1..D (valor_mensal × D/30, #51).
      // Overrides box/station-creation pro-rata.
      const day = Number(c.inactivated_on.slice(8, 10));
      const frac = inactivationFraction(day);
      amount = Math.round(amount * frac * 100) / 100;
      flags.push("encerrado");
      if (frac < 1) flags.push("pro_rata");
      formulaBody += ` × ${day}/30 (encerrado) = ${formatBRL(amount)}`;
    } else {
      // new_station (informational): station created within the competência month.
      const createdInMonth =
        station?.source_created_at != null &&
        new Date(station.source_created_at).getUTCFullYear() ===
          month.getUTCFullYear() &&
        new Date(station.source_created_at).getUTCMonth() === month.getUTCMonth();
      if (createdInMonth) flags.push("new_station");

      // box-day pro-rata (decisão #50) — box-priced contracts with box data;
      // supersedes the station-creation pro-rata. Mirrors the SQL / box-prorata.ts.
      let usedBoxProrata = false;
      if (c.contract_type === "por_box" || c.contract_type === "por_box_minimo") {
        const basis = computeBoxDaysProrata(station?.box_activations ?? null, monthYm);
        if (basis) {
          usedBoxProrata = true;
          if (basis.fraction < 1) {
            amount = Math.round(amount * basis.fraction * 100) / 100;
            flags.push("pro_rata");
            formulaBody += ` × ${basis.boxDays}/(30×${basis.presentBoxes}) box-dia = ${formatBRL(amount)}`;
          }
        }
      }

      // station-creation pro-rata (M5) — fixo, or por_box without box data.
      if (!usedBoxProrata && createdInMonth && station?.source_created_at) {
        const createdDay = new Date(station.source_created_at).getUTCDate();
        if (createdDay >= 5) {
          const prorata = Math.max((30 - createdDay + 1) / 30, 1 / 30);
          amount = Math.round(amount * prorata * 100) / 100;
          flags.push("pro_rata");
          formulaBody += ` × (30−${createdDay}+1)/30 = ${formatBRL(amount)}`;
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
