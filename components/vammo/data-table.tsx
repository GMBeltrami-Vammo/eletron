"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
  Settings2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * TableControls + paginated-table lockup (mirrors vammo-ui's table shell:
 * search / column visibility / refresh slot / dense rows). Column header
 * strings double as CSV headers; provide `meta.csvValue` on a column to
 * override the exported value.
 */
export function DataTable<TData>({
  columns,
  data,
  searchPlaceholder = "Buscar…",
  initialSorting,
  initialColumnVisibility,
  pageSize = 50,
  toolbarLeft,
  toolbarRight,
  csvFilename,
  onRowClick,
  rowClassName,
  emptyMessage = "Nenhum resultado.",
  columnFilters,
  onColumnFiltersChange,
}: {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  searchPlaceholder?: string;
  initialSorting?: SortingState;
  initialColumnVisibility?: VisibilityState;
  pageSize?: number;
  /** Facet filter chips/selects, rendered left of the search box. */
  toolbarLeft?: React.ReactNode;
  toolbarRight?: React.ReactNode;
  /** Enables the CSV export button. */
  csvFilename?: string;
  onRowClick?: (row: TData) => void;
  rowClassName?: (row: TData) => string | undefined;
  emptyMessage?: string;
  /** Controlled column filters (for external facet bars). */
  columnFilters?: ColumnFiltersState;
  onColumnFiltersChange?: (filters: ColumnFiltersState) => void;
}) {
  const [sorting, setSorting] = React.useState<SortingState>(
    initialSorting ?? [],
  );
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>(initialColumnVisibility ?? {});
  const [internalFilters, setInternalFilters] =
    React.useState<ColumnFiltersState>([]);

  const filters = columnFilters ?? internalFilters;

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, columnVisibility, columnFilters: filters },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnFiltersChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(filters) : updater;
      if (onColumnFiltersChange) onColumnFiltersChange(next);
      else setInternalFilters(next);
    },
    globalFilterFn: "includesString",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  function exportCsv() {
    const visible = table
      .getAllLeafColumns()
      .filter((c) => c.getIsVisible() && c.columnDef.header !== undefined);
    const header = visible.map((c) =>
      typeof c.columnDef.header === "string" ? c.columnDef.header : c.id,
    );
    const rows = table.getFilteredRowModel().rows.map((row) =>
      visible.map((col) => {
        const meta = col.columnDef.meta as
          | { csvValue?: (row: TData) => unknown }
          | undefined;
        const value = meta?.csvValue
          ? meta.csvValue(row.original)
          : row.getValue(col.id);
        const text = value === null || value === undefined ? "" : String(value);
        return `"${text.replaceAll('"', '""')}"`;
      }),
    );
    const csv = [header.map((h) => `"${h}"`).join(";"), ...rows.map((r) => r.join(";"))].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${csvFilename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      {/* TableControls */}
      <div className="flex flex-wrap items-center gap-2">
        {toolbarLeft}
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 w-56 bg-card pl-8"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" className="h-9 bg-card" />
            }
          >
            <Settings2 className="size-4" strokeWidth={2} />
            Colunas
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
            <DropdownMenuLabel>Colunas visíveis</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {table
              .getAllLeafColumns()
              .filter((c) => c.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onCheckedChange={(v) => column.toggleVisibility(!!v)}
                >
                  {typeof column.columnDef.header === "string"
                    ? column.columnDef.header
                    : column.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {csvFilename ? (
          <Button
            variant="outline"
            size="sm"
            className="h-9 bg-card"
            onClick={exportCsv}
          >
            <Download className="size-4" strokeWidth={2} />
            CSV
          </Button>
        ) : null}
        {toolbarRight}
      </div>

      {/* Table card */}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        "whitespace-nowrap text-xs",
                        canSort && "cursor-pointer select-none",
                      )}
                      onClick={
                        canSort
                          ? header.column.getToggleSortingHandler()
                          : undefined
                      }
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {canSort &&
                          (sorted === "asc" ? (
                            <ArrowUp className="size-3" />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="size-3" />
                          ) : (
                            <ArrowUpDown className="size-3 opacity-40" />
                          ))}
                      </span>
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(
                    onRowClick && "cursor-pointer",
                    rowClassName?.(row.original),
                  )}
                  onClick={
                    onRowClick ? () => onRowClick(row.original) : undefined
                  }
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className="whitespace-nowrap py-2 text-sm"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="tabular-nums">
          {table.getFilteredRowModel().rows.length} linhas
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 bg-card"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="tabular-nums">
            {table.getState().pagination.pageIndex + 1} /{" "}
            {Math.max(1, table.getPageCount())}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 bg-card"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Skeleton matching the DataTable layout (loading states rule: no spinners). */
export function DataTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Skeleton className="ml-auto h-9 w-56" />
        <Skeleton className="h-9 w-24" />
      </div>
      <div className="space-y-2 rounded-lg border border-border bg-card p-4">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  );
}
