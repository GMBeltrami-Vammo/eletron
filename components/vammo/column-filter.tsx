"use client";

import * as React from "react";
import type { Column } from "@tanstack/react-table";
import { Filter, Search, X } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Spreadsheet-style ("AutoFilter") per-column filter: a funnel on the column
 * header opens a searchable checkbox list of the column's DISTINCT values (from
 * TanStack faceted unique values) with counts + "Selecionar tudo" / "Limpar".
 * Multi-select — picking values keeps only rows whose cell matches one of them.
 *
 * Pairs with `DataTable`'s `filterableColumnIds` prop, which wires the shared
 * `multiSelect` filter fn onto these columns. The filter value is `string[]`
 * (or `undefined` when cleared), matched against the column's accessor value.
 */
export function ColumnFilter<TData>({
  column,
  title,
}: {
  column: Column<TData, unknown>;
  title: string;
}) {
  const [query, setQuery] = React.useState("");

  const selected = (column.getFilterValue() as string[] | undefined) ?? [];
  const selectedSet = new Set(selected);

  // Optional value→label map (e.g. status codes → pt-BR labels), so coded
  // columns show human text in the checklist while still filtering on the raw
  // accessor value. The filter value stays the raw value; only display differs.
  const meta = column.columnDef.meta as
    | { filterLabel?: (value: string) => string }
    | undefined;
  const labelFor = (value: string) => meta?.filterLabel?.(value) ?? value;

  // Distinct values present in the column (accessor output), sorted pt-BR by label.
  const facets = column.getFacetedUniqueValues();
  const options: { value: string; label: string; count: number }[] = [];
  const seen = new Map<string, number>();
  for (const [raw, count] of facets) {
    if (raw === null || raw === undefined) continue;
    const value = String(raw).trim();
    if (value === "") continue;
    seen.set(value, (seen.get(value) ?? 0) + count);
  }
  for (const [value, count] of seen) {
    options.push({ value, label: labelFor(value), count });
  }
  options.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

  const q = query.trim().toLowerCase();
  const shown = q
    ? options.filter((o) => o.label.toLowerCase().includes(q))
    : options;

  const active = selected.length > 0;

  function commit(next: string[]) {
    column.setFilterValue(next.length ? next : undefined);
  }
  function toggle(value: string) {
    commit(
      selectedSet.has(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  }
  function selectAllShown() {
    commit([...new Set([...selected, ...shown.map((o) => o.value)])]);
  }

  return (
    <Popover>
      <PopoverTrigger
        render={<button type="button" />}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Filtrar ${title}`}
        title={
          active ? `${title}: ${selected.length} selecionado(s)` : `Filtrar ${title}`
        }
        className={cn(
          "inline-flex size-5 items-center justify-center rounded outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
          active
            ? "text-primary"
            : "text-muted-foreground/40 hover:text-foreground",
        )}
      >
        <Filter
          className="size-3.5"
          strokeWidth={2}
          fill={active ? "currentColor" : "none"}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 gap-2 p-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-0.5">
          <span className="text-xs font-medium text-foreground">{title}</span>
          {active ? (
            <button
              type="button"
              onClick={() => commit([])}
              className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" strokeWidth={2} />
              Limpar
            </button>
          ) : null}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar valor…"
            className="h-7 pl-7 text-xs"
          />
        </div>

        {shown.length > 0 ? (
          <Button
            variant="ghost"
            size="xs"
            className="h-6 justify-start px-1 text-xs text-primary"
            onClick={selectAllShown}
          >
            Selecionar {q ? `os ${shown.length} exibidos` : "tudo"}
          </Button>
        ) : null}

        <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
          {shown.length === 0 ? (
            <span className="px-1 py-2 text-xs text-muted-foreground">
              Nenhum valor.
            </span>
          ) : (
            shown.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                className="flex items-center gap-2 rounded px-1 py-1 text-left hover:bg-muted"
              >
                <Checkbox
                  checked={selectedSet.has(o.value)}
                  tabIndex={-1}
                  className="pointer-events-none"
                />
                <span className="flex-1 truncate text-xs" title={o.label}>
                  {o.label}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {o.count}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
