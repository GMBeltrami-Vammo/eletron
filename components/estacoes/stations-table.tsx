"use client";

/**
 * Sections B + C of /estacoes: quick-filter chips (the n8n warning categories
 * made permanent), facet selects writing TanStack columnFilters, and the
 * dense station DataTable. Deep links via ?filtro= (KPI cards).
 */

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ColumnFiltersState } from "@tanstack/react-table";
import { Clock, Eye, EyeOff, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { DataTable } from "@/components/vammo/data-table";
import { useRunAction } from "@/components/comprovantes/write-helpers";
import { setStationHidden } from "@/app/actions/stations";
import { cn } from "@/lib/utils";
import {
  ALERT_TYPE_UI,
  AUTO_DEBIT_UI,
  CHARGE_STATUS_UI,
  STATION_STATUS_UI,
  UTILITY_BILL_STATUS_SEVERITY,
  UTILITY_BILL_STATUS_UI,
} from "@/lib/labels";

import {
  buildColumns,
  INITIAL_COLUMN_VISIBILITY,
  RENT_OPEN_SENTINEL,
} from "./columns";
import type { EstacaoRow } from "./types";

/** Chip order: the 7 recurring n8n warning categories (spec §2 C). */
const CHIP_TYPES = [
  "overdue_bill",
  "due_soon_no_auto_debit",
  "no_auto_debit",
  "scraper_stale",
  "new_installation",
  "negotiated_invoice",
  "scheduled_shutdown",
] as const;

/** ?filtro= → preselected chip. */
const FILTRO_TO_CHIP: Record<string, (typeof CHIP_TYPES)[number]> = {
  vencidas: "overdue_bill",
  venceSemDA: "due_soon_no_auto_debit",
  semDA: "no_auto_debit",
  scraperParado: "scraper_stale",
  novas: "new_installation",
  negociadas: "negotiated_invoice",
  desligamento: "scheduled_shutdown",
};

/**
 * ?filtro= → preselected facet columnFilter. `status` is a multi-select column
 * (shares the header-funnel's `string[]` value format); `aluguelMes` keeps its
 * custom single-string filter fn.
 */
const FILTRO_TO_FACET: Record<string, { id: string; value: string | string[] }> = {
  ativas: { id: "status", value: ["ACTIVE"] },
  aluguelPendente: { id: "aluguelMes", value: RENT_OPEN_SENTINEL },
};

function chipsFor(filtro: string | null): Set<string> {
  const chip = filtro ? FILTRO_TO_CHIP[filtro] : undefined;
  return chip ? new Set([chip]) : new Set();
}

function filtersFor(filtro: string | null): ColumnFiltersState {
  const facet = filtro ? FILTRO_TO_FACET[filtro] : undefined;
  return facet ? [{ id: facet.id, value: facet.value }] : [];
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Freshness filter (B): hide stations whose last scraper collection is older than this. */
const FRESHNESS_STALE_DAYS = 7;

/**
 * Whole days between an ISO timestamp and now. Client-safe (no server-only
 * import): a station's `freshness` is min(scrapedAt) across its utility
 * accounts. Returns null when there is no collection to age (rent-only rows),
 * so the freshness filter leaves those visible.
 */
function daysSinceCollection(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((now - then) / 86_400_000);
}

interface FacetOption {
  value: string;
  label: string;
}

/**
 * One facet select bound to a TanStack columnFilter id. When `multi`, it reads
 * and writes the `string[]` value format that the column's header funnel also
 * uses (so the select and the funnel target the same column without conflict);
 * the dropdown reflects the first selected value. Otherwise it uses a plain
 * string value (for columns with a custom single-value filter fn).
 */
function FacetSelect({
  label,
  columnId,
  options,
  filters,
  onChange,
  multi = false,
}: {
  label: string;
  columnId: string;
  options: FacetOption[];
  filters: ColumnFiltersState;
  onChange: (columnId: string, value: string | string[] | null) => void;
  multi?: boolean;
}) {
  const current = filters.find((f) => f.id === columnId);
  const raw = current?.value;
  const value = multi
    ? Array.isArray(raw) && raw.length > 0
      ? String(raw[0])
      : "all"
    : typeof raw === "string"
      ? raw
      : "all";
  const selected = options.find((o) => o.value === value);

  return (
    <Select
      value={value}
      onValueChange={(v) =>
        onChange(columnId, v === "all" ? null : multi ? [String(v)] : String(v))
      }
    >
      <SelectTrigger
        size="sm"
        className={cn("bg-card text-xs", value !== "all" && "border-ring")}
        aria-label={label}
      >
        <span className="text-muted-foreground">{label}:</span>{" "}
        <span className="font-medium">{selected?.label ?? "Todos"}</span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todos</SelectItem>
        {options
          .filter((o) => o.value !== "all")
          .map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

export function StationsTable({ rows }: { rows: EstacaoRow[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filtro = searchParams.get("filtro");
  const { run } = useRunAction();

  const [activeChips, setActiveChips] = React.useState<Set<string>>(() =>
    chipsFor(filtro),
  );
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    () => filtersFor(filtro),
  );
  // Declutter toggles (request #5): (A) manual hide-list view —
  // 'default' hides hidden, 'show' includes them, 'only' shows just the hidden
  // ones (to review / re-exibir); (B) hide stations with a stale collection.
  const [hiddenView, setHiddenView] = React.useState<
    "default" | "show" | "only"
  >("default");
  const [hideStale, setHideStale] = React.useState(false);

  const handleToggleHidden = React.useCallback(
    (row: EstacaoRow) => {
      void run(
        () =>
          setStationHidden({ stationId: row.stationId, hidden: !row.hidden }),
        { success: row.hidden ? "Estação exibida novamente" : "Estação ocultada" },
      );
    },
    [run],
  );

  // KPI clicks while mounted change ?filtro= without remounting — re-apply.
  const lastFiltro = React.useRef(filtro);
  React.useEffect(() => {
    if (filtro === lastFiltro.current) return;
    lastFiltro.current = filtro;
    setActiveChips(chipsFor(filtro));
    setColumnFilters(filtersFor(filtro));
  }, [filtro]);

  const today = React.useMemo(localToday, []);
  const columns = React.useMemo(
    () => buildColumns(today, handleToggleHidden),
    [today, handleToggleHidden],
  );

  const hiddenCount = React.useMemo(
    () => rows.filter((r) => r.hidden).length,
    [rows],
  );
  const staleCount = React.useMemo(() => {
    const now = Date.now();
    return rows.filter((r) => {
      const days = daysSinceCollection(r.freshness, now);
      return days !== null && days > FRESHNESS_STALE_DAYS;
    }).length;
  }, [rows]);

  /**
   * Base set after the two declutter filters (manual hide + freshness) but
   * BEFORE the alert chips. Chip badge counts AND the table both derive from
   * this, so the counts always match what the table shows — one canonical count
   * per concept, no chip-vs-table divergence (decision #16).
   */
  const baseRows = React.useMemo(() => {
    const now = Date.now();
    return rows.filter((r) => {
      if (hiddenView === "default" && r.hidden) return false;
      if (hiddenView === "only" && !r.hidden) return false;
      if (hideStale) {
        const days = daysSinceCollection(r.freshness, now);
        if (days !== null && days > FRESHNESS_STALE_DAYS) return false;
      }
      return true;
    });
  }, [rows, hiddenView, hideStale]);

  const chipCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const type of CHIP_TYPES) {
      counts.set(
        type,
        baseRows.filter((r) => r.alertTypes.includes(type)).length,
      );
    }
    return counts;
  }, [baseRows]);

  /** Alert-chip filter over the decluttered base set. */
  const filteredRows = React.useMemo(() => {
    if (activeChips.size === 0) return baseRows;
    return baseRows.filter((r) => r.alertTypes.some((t) => activeChips.has(t)));
  }, [baseRows, activeChips]);

  function toggleChip(type: string) {
    setActiveChips((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function setFacet(columnId: string, value: string | string[] | null) {
    setColumnFilters((prev) => {
      const next = prev.filter((f) => f.id !== columnId);
      const isEmpty =
        value === null || (Array.isArray(value) && value.length === 0);
      if (!isEmpty) next.push({ id: columnId, value });
      return next;
    });
  }

  const hasFilters = activeChips.size > 0 || columnFilters.length > 0;

  function clearFilters() {
    setActiveChips(new Set());
    setColumnFilters([]);
    if (filtro !== null) router.replace("/estacoes", { scroll: false });
  }

  return (
    <div className="space-y-3">
      {/* Quick-filter chips — n8n warning categories made permanent */}
      <div className="flex flex-wrap items-center gap-1.5">
        {CHIP_TYPES.map((type) => {
          const ui = ALERT_TYPE_UI[type];
          const active = activeChips.has(type);
          const count = chipCounts.get(type) ?? 0;
          return (
            <button
              key={type}
              type="button"
              aria-pressed={active}
              onClick={() => toggleChip(type)}
              title={ui.description}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
                !active &&
                  "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              style={
                active
                  ? {
                      backgroundColor: `var(--badge-${ui.color}-bg)`,
                      borderColor: `var(--badge-${ui.color}-bg)`,
                      color: `var(--badge-${ui.color}-text)`,
                    }
                  : undefined
              }
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{
                  backgroundColor: active
                    ? `var(--badge-${ui.color}-text)`
                    : `var(--badge-${ui.color}-bg)`,
                }}
              />
              {ui.label}
              <span className="tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Declutter toggles (request #5): manual hide list + freshness filter */}
      <div className="flex flex-wrap items-center gap-1.5">
        {hiddenCount > 0 ? (
          <>
            <button
              type="button"
              aria-pressed={hiddenView === "show"}
              onClick={() =>
                setHiddenView((v) => (v === "show" ? "default" : "show"))
              }
              title="Inclui as estações ocultas na lista"
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
                hiddenView === "show"
                  ? "border-ring bg-muted text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Eye className="size-3.5" strokeWidth={2} />
              Mostrar ocultas
              <span className="tabular-nums">{hiddenCount}</span>
            </button>
            <button
              type="button"
              aria-pressed={hiddenView === "only"}
              onClick={() =>
                setHiddenView((v) => (v === "only" ? "default" : "only"))
              }
              title="Mostra somente as estações ocultas (para revisar ou reexibir)"
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
                hiddenView === "only"
                  ? "border-ring bg-muted text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <EyeOff className="size-3.5" strokeWidth={2} />
              Apenas ocultas
              <span className="tabular-nums">{hiddenCount}</span>
            </button>
          </>
        ) : null}
        <button
          type="button"
          aria-pressed={hideStale}
          onClick={() => setHideStale((v) => !v)}
          title={
            "Oculta estações cuja última coleta do scraper é anterior a 7 dias. " +
            "Atenção: os dados do scraper estão congelados desde a clonagem para o " +
            "Supabase (decisão #25), então com o tempo isso oculta quase todas as estações."
          }
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
            hideStale
              ? "border-ring bg-muted text-foreground"
              : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Clock className="size-3.5" strokeWidth={2} />
          Ocultar coleta &gt; 7 dias
          {staleCount > 0 ? (
            <span className="tabular-nums">{staleCount}</span>
          ) : null}
        </button>
      </div>

      <DataTable<EstacaoRow>
        columns={columns}
        data={filteredRows}
        searchPlaceholder="Buscar por nome, endereço, id…"
        initialSorting={[{ id: "id", desc: false }]}
        initialColumnVisibility={INITIAL_COLUMN_VISIBILITY}
        pageSize={50}
        csvFilename="estacoes"
        emptyMessage="Nenhuma estação encontrada."
        filterableColumnIds="all"
        onRowClick={(row) => router.push(`/estacoes/${row.stationId}`)}
        columnFilters={columnFilters}
        onColumnFiltersChange={setColumnFilters}
        toolbarLeft={
          <div className="flex flex-wrap items-center gap-1.5">
            <FacetSelect
              label="Status"
              columnId="status"
              multi
              options={Object.entries(STATION_STATUS_UI).map(([value, ui]) => ({
                value,
                label: ui.label,
              }))}
              filters={columnFilters}
              onChange={setFacet}
            />
            <FacetSelect
              label="Provedor"
              columnId="fontes"
              options={[
                { value: "enel", label: "Enel" },
                { value: "edp", label: "EDP" },
                { value: "rent", label: "Aluguel" },
                { value: "third_party", label: "Terceiro" },
              ]}
              filters={columnFilters}
              onChange={setFacet}
            />
            <FacetSelect
              label="Fatura"
              columnId="statusFatura"
              multi
              options={UTILITY_BILL_STATUS_SEVERITY.map((status) => ({
                value: status,
                label: UTILITY_BILL_STATUS_UI[status].label,
              }))}
              filters={columnFilters}
              onChange={setFacet}
            />
            <FacetSelect
              label="DA"
              columnId="debitoAutomatico"
              multi
              options={Object.entries(AUTO_DEBIT_UI).map(([value, ui]) => ({
                value,
                label: ui.label,
              }))}
              filters={columnFilters}
              onChange={setFacet}
            />
            <FacetSelect
              label="Aluguel"
              columnId="aluguelMes"
              options={[
                { value: RENT_OPEN_SENTINEL, label: "Em aberto" },
                ...Object.entries(CHARGE_STATUS_UI).map(([value, ui]) => ({
                  value,
                  label: ui.label,
                })),
              ]}
              filters={columnFilters}
              onChange={setFacet}
            />
            {hasFilters ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={clearFilters}
              >
                <X className="size-3.5" strokeWidth={2} />
                Limpar filtros
              </Button>
            ) : null}
          </div>
        }
      />
    </div>
  );
}
