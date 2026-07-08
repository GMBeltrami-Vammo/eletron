"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, ExternalLink, ListChecks, Minus, Paperclip } from "lucide-react";

import { ComprovanteChip } from "@/components/vammo/comprovante-chip";
import { DataTable } from "@/components/vammo/data-table";
import { StatusBadge } from "@/components/vammo/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ACCOUNT_TYPE_UI, AUTO_DEBIT_UI, FISCAL_EXPORT_UI } from "@/lib/labels";
import {
  formatBRL,
  formatCompetencia,
  formatDate,
  formatNumber,
} from "@/lib/format";

import { ManualBillDialog } from "./manual-bill-dialog";
import { StationCell } from "./station-cell";
import type { EnergyAccountOption, FaturaRow } from "./types";

/** Typed CSV-override meta (DataTable reads `meta.csvValue`). */
function csvMeta(
  csvValue: (row: FaturaRow) => unknown,
): ColumnDef<FaturaRow, unknown>["meta"] {
  return { csvValue } as ColumnDef<FaturaRow, unknown>["meta"];
}

/** 'x kWh · R$ y' cell for TUSD/TE (two-value energy components). */
function EnergyComponent({
  kwh,
  amount,
}: {
  kwh: number | null;
  amount: number | null;
}) {
  if (kwh === null && amount === null) {
    return <span className="block text-right text-muted-foreground">—</span>;
  }
  return (
    <span className="block text-right tabular-nums">
      {kwh !== null ? `${formatNumber(kwh)} kWh` : "—"}
      <span className="block text-xs text-muted-foreground">
        {formatBRL(amount)}
      </span>
    </span>
  );
}

const columns: ColumnDef<FaturaRow, unknown>[] = [
  {
    id: "provedor",
    header: "Provedor",
    accessorFn: (r) => ACCOUNT_TYPE_UI[r.provider].label,
    cell: ({ row }) => {
      const ui = ACCOUNT_TYPE_UI[row.original.provider];
      return (
        <span className="flex items-center gap-1">
          <StatusBadge color={ui.color}>{ui.label}</StatusBadge>
          {row.original.source === "manual" ? (
            <StatusBadge color="grey" outline>
              Manual
            </StatusBadge>
          ) : null}
        </span>
      );
    },
  },
  {
    id: "instalacao",
    header: "Instalação",
    accessorFn: (r) => r.installationKey,
    cell: ({ row }) => (
      <span className="font-medium tabular-nums">
        {row.original.installationKey}
      </span>
    ),
  },
  {
    id: "estacao",
    header: "Estação",
    accessorFn: (r) => r.stationId ?? -1,
    cell: ({ row }) => (
      <StationCell
        stationId={row.original.stationId}
        matchStatus={row.original.matchStatus}
      />
    ),
    meta: csvMeta((r) => r.stationId ?? `(${r.matchStatus})`),
  },
  {
    id: "competencia",
    header: "Competência",
    accessorFn: (r) => r.competencia ?? "",
    cell: ({ row }) => (
      <span className="tabular-nums">
        {formatCompetencia(row.original.competencia)}
      </span>
    ),
  },
  {
    id: "vencimento",
    header: "Vencimento",
    accessorFn: (r) => r.dueDate ?? "",
    cell: ({ row }) => (
      <span className="tabular-nums">{formatDate(row.original.dueDate)}</span>
    ),
  },
  {
    id: "valor",
    header: "Valor",
    accessorFn: (r) => r.amount ?? Number.MIN_SAFE_INTEGER,
    cell: ({ row }) => (
      <span className="block text-right font-medium tabular-nums">
        {formatBRL(row.original.amount)}
      </span>
    ),
    meta: csvMeta((r) => r.amount ?? ""),
  },
  {
    id: "nf",
    header: "NF",
    accessorFn: (r) => r.nf ?? "",
    cell: ({ row }) => (
      <span className="tabular-nums text-muted-foreground">
        {row.original.nf ?? "—"}
      </span>
    ),
  },
  {
    id: "tusd",
    header: "TUSD",
    accessorFn: (r) => r.tusdKwh ?? Number.MIN_SAFE_INTEGER,
    cell: ({ row }) => (
      <EnergyComponent
        kwh={row.original.tusdKwh}
        amount={row.original.tusdAmount}
      />
    ),
    meta: csvMeta((r) =>
      r.tusdKwh !== null || r.tusdAmount !== null
        ? `${r.tusdKwh ?? ""} kWh / ${r.tusdAmount ?? ""}`
        : "",
    ),
  },
  {
    id: "te",
    header: "TE",
    accessorFn: (r) => r.teKwh ?? Number.MIN_SAFE_INTEGER,
    cell: ({ row }) => (
      <EnergyComponent kwh={row.original.teKwh} amount={row.original.teAmount} />
    ),
    meta: csvMeta((r) =>
      r.teKwh !== null || r.teAmount !== null
        ? `${r.teKwh ?? ""} kWh / ${r.teAmount ?? ""}`
        : "",
    ),
  },
  {
    id: "cip",
    header: "CIP",
    accessorFn: (r) => r.cip ?? Number.MIN_SAFE_INTEGER,
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">
        {formatBRL(row.original.cip)}
      </span>
    ),
    meta: csvMeta((r) => r.cip ?? ""),
  },
  {
    id: "total",
    header: "Total",
    accessorFn: (r) => r.total ?? Number.MIN_SAFE_INTEGER,
    cell: ({ row }) => (
      <span className="block text-right font-medium tabular-nums">
        {formatBRL(row.original.total)}
      </span>
    ),
    meta: csvMeta((r) => r.total ?? ""),
  },
  {
    id: "leituras",
    header: "Leituras",
    accessorFn: (r) =>
      r.leituraAnterior || r.leituraAtual
        ? `${r.leituraAnterior ?? "—"} → ${r.leituraAtual ?? "—"}`
        : "",
    cell: ({ row }) => {
      const { leituraAnterior, leituraAtual } = row.original;
      if (!leituraAnterior && !leituraAtual) {
        return <span className="text-muted-foreground">—</span>;
      }
      return (
        <span className="tabular-nums text-muted-foreground">
          {formatDate(leituraAnterior)} → {formatDate(leituraAtual)}
        </span>
      );
    },
  },
  {
    id: "classeTarifaria",
    header: "Classe tarifária",
    accessorFn: (r) => r.tariffClass ?? "",
    cell: ({ row }) => (
      <span
        className="block max-w-[200px] truncate text-muted-foreground"
        title={row.original.tariffClass ?? undefined}
      >
        {row.original.tariffClass ?? "—"}
      </span>
    ),
  },
  {
    id: "fiscal",
    header: FISCAL_EXPORT_UI.header,
    accessorFn: (r) => (r.fiscalExported ? "Sim" : "Não"),
    cell: ({ row }) => (
      <span
        className="flex justify-center"
        title={FISCAL_EXPORT_UI.tooltip}
      >
        {row.original.fiscalExported ? (
          <Check className="size-4 text-success-emphasis" strokeWidth={2} />
        ) : (
          <Minus className="size-4 text-muted-foreground" strokeWidth={2} />
        )}
      </span>
    ),
  },
  {
    id: "debitoAutomatico",
    header: "Débito automático",
    accessorFn: (r) => AUTO_DEBIT_UI[r.autoDebit].label,
    cell: ({ row }) => {
      const ui = AUTO_DEBIT_UI[row.original.autoDebit];
      return (
        <span title={row.original.autoDebitRegistration ?? undefined}>
          <StatusBadge color={ui.color}>{ui.label}</StatusBadge>
        </span>
      );
    },
    meta: csvMeta((r) =>
      r.autoDebitRegistration
        ? `${AUTO_DEBIT_UI[r.autoDebit].label} (${r.autoDebitRegistration})`
        : AUTO_DEBIT_UI[r.autoDebit].label,
    ),
  },
  {
    id: "comprovante",
    header: "Comprovante",
    accessorFn: (r) =>
      r.payment ? "Vinculado" : r.hasComprovante ? "Planilha" : "Não",
    cell: ({ row }) => {
      const { payment, hasComprovante, comprovanteDate } = row.original;
      // R1: linked charging payment wins — deep-links the deep-dive page
      if (payment) {
        return (
          <span className="flex justify-center">
            <ComprovanteChip summary={payment} />
          </span>
        );
      }
      if (!hasComprovante) {
        return <span className="block text-center text-muted-foreground">—</span>;
      }
      // sheet-era installation-level receipt — historical fallback
      return (
        <span
          className="flex items-center justify-center gap-1 text-muted-foreground"
          title="Último comprovante registrado na instalação (era da planilha)"
        >
          <Paperclip className="size-3.5" strokeWidth={2} />
          {comprovanteDate ? (
            <span className="text-xs tabular-nums">
              {formatDate(comprovanteDate)}
            </span>
          ) : null}
        </span>
      );
    },
  },
  {
    id: "fatura",
    header: "Fatura",
    enableSorting: false,
    accessorFn: (r) => r.faturaDriveUrl ?? "",
    cell: ({ row }) =>
      row.original.faturaDriveUrl ? (
        <a
          href={row.original.faturaDriveUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          Ver fatura
          <ExternalLink className="size-3.5" strokeWidth={2} />
        </a>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];

export function FaturasTable({
  rows,
  accounts,
  canWrite,
}: {
  rows: FaturaRow[];
  accounts: EnergyAccountOption[];
  canWrite: boolean;
}) {
  const [provider, setProvider] = React.useState("all");
  const [month, setMonth] = React.useState("all");
  const [missingOnly, setMissingOnly] = React.useState(false);

  const months = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.competencia) set.add(r.competencia.slice(0, 7));
    }
    return [...set].sort().reverse();
  }, [rows]);

  const filtered = React.useMemo(
    () =>
      rows.filter((r) => {
        if (provider !== "all" && r.provider !== provider) return false;
        if (month !== "all" && r.competencia?.slice(0, 7) !== month) {
          return false;
        }
        if (missingOnly && (r.hasComprovante || r.payment !== null)) return false;
        return true;
      }),
    [rows, provider, month, missingOnly],
  );

  return (
    <DataTable
      columns={columns}
      data={filtered}
      searchPlaceholder="Buscar fatura, NF, instalação…"
      csvFilename="faturas-energia"
      initialSorting={[{ id: "vencimento", desc: true }]}
      emptyMessage="Nenhuma fatura encontrada."
      toolbarLeft={
        <>
          <Select
            value={provider}
            onValueChange={(v) => setProvider(v as string)}
          >
            <SelectTrigger size="sm" className="bg-card">
              <SelectValue>
                {provider === "all"
                  ? "Provedor: todos"
                  : ACCOUNT_TYPE_UI[provider as "energy_enel" | "energy_edp"]
                      .label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Provedor: todos</SelectItem>
              <SelectItem value="energy_enel">Enel</SelectItem>
              <SelectItem value="energy_edp">EDP</SelectItem>
            </SelectContent>
          </Select>
          <Select value={month} onValueChange={(v) => setMonth(v as string)}>
            <SelectTrigger size="sm" className="bg-card">
              <SelectValue>
                {month === "all" ? "Mês: todos" : formatCompetencia(`${month}-01`)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Mês: todos</SelectItem>
              {months.map((m) => (
                <SelectItem key={m} value={m}>
                  {formatCompetencia(`${m}-01`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={missingOnly}
              onCheckedChange={(checked) => setMissingOnly(checked === true)}
            />
            Sem comprovante
          </label>
        </>
      }
      toolbarRight={
        <>
          <ManualBillDialog accounts={accounts} canWrite={canWrite} />
          <span title="Marcado pelo export fiscal (Apps Script) — importação na fase 3">
            <Button variant="outline" size="sm" className="h-9 bg-card" disabled>
              <ListChecks className="size-4" strokeWidth={2} />
              Enviar ao fiscal em lote
            </Button>
          </span>
        </>
      }
    />
  );
}
