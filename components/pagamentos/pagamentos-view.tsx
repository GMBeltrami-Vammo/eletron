"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, ExternalLink, Minus } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AuditByline } from "@/components/vammo/audit-byline";
import { ComprovanteChip } from "@/components/vammo/comprovante-chip";
import { DataTable } from "@/components/vammo/data-table";
import { PageHeader } from "@/components/vammo/page-header";
import { StatCard } from "@/components/vammo/stat-card";
import { StatusBadge } from "@/components/vammo/status-badge";
import {
  ACCOUNT_TYPE_UI,
  AUTO_DEBIT_UI,
  CHARGE_KIND_UI,
  CHARGE_STATUS_UI,
  FISCAL_EXPORT_UI,
  MATCH_STATUS_UI,
  PAYMENT_METHOD_LABEL,
} from "@/lib/labels";
import { formatBRL, formatCompetencia, formatDate } from "@/lib/format";
import type { ChargeStatus, IngestSource } from "@/lib/domain";
import { cn } from "@/lib/utils";

import type { PagamentoRow, StationOption } from "./types";
import type { ReviewQueueData } from "@/app/(app)/revisao/cobrancas/queries";
import { APagarPanel, isAPagar } from "./a-pagar-panel";
import { EmailDocsPanel } from "./email-docs-panel";
import { isEmailDocRow, isStagedEmailCharge } from "./email-docs-groups";
import { GerarMesDialog } from "./gerar-mes-dialog";
import { StatusActions } from "./status-actions";
import { FlagBadges } from "./flag-badges";
import { PagamentoDrawer } from "./pagamento-drawer";
import { NovaCobrancaDialog } from "./nova-cobranca-dialog";

/**
 * Ingest source → pt-BR badge label (labels.ts has no ingest-source map yet;
 * Phase 1 rows are all 'sheet_backfill' = planilha).
 */
const SOURCE_LABEL: Record<IngestSource, string> = {
  sheet_backfill: "planilha",
  scraper_enel: "scraper Enel",
  scraper_edp: "scraper EDP",
  email_ai: "e-mail",
  drive_poll: "Drive",
  manual: "manual",
  metabase_sync: "Metabase",
  gerar_mes: "Gerado",
  auto_match: "conciliação",
  app_upload: "upload",
};

const PAID_STATUSES: ChargeStatus[] = ["pago", "antecipado"];

/** Typed CSV-override meta (DataTable reads `meta.csvValue`). */
function csvMeta(
  csvValue: (row: PagamentoRow) => unknown,
): ColumnDef<PagamentoRow, unknown>["meta"] {
  return { csvValue } as ColumnDef<PagamentoRow, unknown>["meta"];
}

function hasMismatch(row: PagamentoRow): boolean {
  return (
    row.amount !== null &&
    row.expectedAmount !== null &&
    Math.abs(row.amount - row.expectedAmount) > 0.01
  );
}

/**
 * Parceiro display: the resolved counterparty name, else — for Enel/EDP energy
 * charges that have no counterparty (the concessionária isn't a partner) — the
 * provider label ("Enel"/"EDP"). Null when neither applies.
 */
function partnerLabel(row: PagamentoRow): string | null {
  if (row.parceiro) return row.parceiro;
  // Enel/EDP energy charges have no counterparty (the concessionária isn't a
  // partner) — show the provider label instead. Rent/third-party charges with
  // an unresolved counterparty fall through to "—" (the account-type label
  // like "Aluguel" is not a partner name).
  if (row.accountType === "energy_enel" || row.accountType === "energy_edp") {
    return ACCOUNT_TYPE_UI[row.accountType].label;
  }
  return null;
}

const baseColumns: ColumnDef<PagamentoRow, unknown>[] = [
  {
    id: "estacao",
    header: "Estação",
    // Unmatched (UNIDENTIFIED) rows sort to the top of the station grouping.
    accessorFn: (r) => r.stationId ?? -1,
    cell: ({ row }) => {
      const { stationId, stationName, matchStatus } = row.original;
      if (stationId === null) {
        const ui = MATCH_STATUS_UI[matchStatus];
        return (
          <Link
            href="/revisao"
            title="Abrir fila de revisão"
            onClick={(e) => e.stopPropagation()}
          >
            <StatusBadge color={ui.color}>{ui.label}</StatusBadge>
          </Link>
        );
      }
      return (
        <Link
          href={`/estacoes/${stationId}`}
          className="block underline-offset-2 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="font-medium tabular-nums">#{stationId}</span>
          {stationName ? (
            <span className="block max-w-[220px] truncate text-xs text-muted-foreground">
              {stationName}
            </span>
          ) : null}
        </Link>
      );
    },
    meta: csvMeta((r) =>
      r.stationId !== null
        ? `${r.stationId} ${r.stationName ?? ""}`.trim()
        : `(${r.matchStatus})`,
    ),
  },
  {
    id: "instalacao",
    header: "Instalação",
    accessorFn: (r) => r.installationKey ?? "",
    cell: ({ row }) =>
      row.original.installationKey ? (
        <span className="tabular-nums text-muted-foreground">
          {row.original.installationKey}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
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
    // Vencimento (faturas-sheet due_date) — populated for energy; rent charges
    // carry no due_date on the charge, so they read "—".
    id: "vencimento",
    header: "Vencimento",
    accessorFn: (r) => r.dueDate ?? "",
    cell: ({ row }) => (
      <span className="tabular-nums text-muted-foreground">
        {row.original.dueDate ? formatDate(row.original.dueDate) : "—"}
      </span>
    ),
  },
  {
    // Débito automático (faturas-sheet auto_debit) — energy account only.
    id: "debitoAutomatico",
    header: "Débito automático",
    accessorFn: (r) => (r.autoDebit ? AUTO_DEBIT_UI[r.autoDebit].label : ""),
    cell: ({ row }) => {
      const da = row.original.autoDebit;
      if (!da) return <span className="text-muted-foreground">—</span>;
      const ui = AUTO_DEBIT_UI[da];
      return <StatusBadge color={ui.color}>{ui.label}</StatusBadge>;
    },
    meta: csvMeta((r) => (r.autoDebit ? AUTO_DEBIT_UI[r.autoDebit].label : "")),
  },
  {
    id: "tipo",
    header: "Tipo",
    accessorFn: (r) => CHARGE_KIND_UI[r.kind].label,
    cell: ({ row }) => {
      const ui = CHARGE_KIND_UI[row.original.kind];
      return <StatusBadge color={ui.color}>{ui.label}</StatusBadge>;
    },
  },
  {
    id: "parceiro",
    header: "Parceiro",
    accessorFn: (r) => partnerLabel(r) ?? "",
    cell: ({ row }) => {
      const label = partnerLabel(row.original);
      return (
        <span className="block max-w-[220px] truncate" title={label ?? undefined}>
          {label ?? "—"}
        </span>
      );
    },
  },
  {
    id: "valor",
    header: "Valor",
    accessorFn: (r) => r.amount ?? Number.MIN_SAFE_INTEGER,
    cell: ({ row }) => {
      const mismatch = hasMismatch(row.original);
      return (
        <span
          className={cn(
            "block rounded px-1 text-right font-medium tabular-nums",
            mismatch && "bg-error-subtle text-error-emphasis",
          )}
          title={
            mismatch
              ? `Difere do previsto: ${formatBRL(row.original.expectedAmount)}`
              : undefined
          }
        >
          {formatBRL(row.original.amount)}
        </span>
      );
    },
    meta: csvMeta((r) => r.amount ?? ""),
  },
  {
    id: "previsto",
    header: "Previsto",
    accessorFn: (r) => r.expectedAmount ?? Number.MIN_SAFE_INTEGER,
    cell: ({ row }) => (
      <span className="block text-right tabular-nums text-muted-foreground">
        {formatBRL(row.original.expectedAmount)}
      </span>
    ),
    meta: csvMeta((r) => r.expectedAmount ?? ""),
  },
  {
    id: "status",
    header: "Status",
    accessorFn: (r) => CHARGE_STATUS_UI[r.status].label,
    cell: ({ row }) => {
      const r = row.original;
      const ui = CHARGE_STATUS_UI[r.status];
      // A linked comprovante is paid: auto-matches land on 'pago' (→ green
      // "Pago"). 'conciliado' is now a legacy state — render it with the one
      // canonical badge; its confirm action still lives in StatusActions.
      return (
        <div className="space-y-0.5">
          <StatusBadge color={ui.color}>{ui.label}</StatusBadge>
          {r.statusSource === "rpc" && r.lastActorAt ? (
            <AuditByline
              actorEmail={r.lastActorEmail}
              at={r.lastActorAt}
              className="block"
            />
          ) : null}
        </div>
      );
    },
  },
  {
    id: "flags",
    header: "Sinalizações",
    enableSorting: false,
    accessorFn: (r) => r.flags.join(" "),
    cell: ({ row }) => <FlagBadges flags={row.original.flags} />,
    meta: csvMeta((r) => r.flags.join(", ")),
  },
  {
    id: "pagamento",
    header: "Pagamento",
    accessorFn: (r) =>
      r.paymentMethod ? PAYMENT_METHOD_LABEL[r.paymentMethod] : "",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.paymentMethod
          ? PAYMENT_METHOD_LABEL[row.original.paymentMethod]
          : "—"}
      </span>
    ),
  },
  {
    id: "comprovante",
    header: "Comprovante",
    accessorFn: (r) => (r.payment ? "Vinculado" : ""),
    cell: ({ row }) =>
      row.original.payment ? (
        <ComprovanteChip summary={row.original.payment} />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    meta: csvMeta((r) => (r.payment ? "vinculado" : "")),
  },
  {
    // Source bill (boleto/fatura/nota) — distinct from the payment-proof
    // "Comprovante" column. Energy → Drive fatura link; rent/manual → the
    // /api/files proxy; resolved by resolveDocumentHref in buildRows.
    id: "documento",
    header: "Documento de origem",
    enableSorting: false,
    accessorFn: (r) => (r.documentHref ? "Vinculado" : ""),
    cell: ({ row }) =>
      row.original.documentHref ? (
        <a
          href={row.original.documentHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          Ver documento
          <ExternalLink className="size-3.5" strokeWidth={2} />
        </a>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    meta: csvMeta((r) => (r.documentHref ? "vinculado" : "")),
  },
  {
    id: "fiscal",
    // "Enviado ao fiscal" = exported to the FISCAL sheet, NOT paid (#21/Q8).
    header: FISCAL_EXPORT_UI.header,
    accessorFn: (r) => (r.fiscalExported ? "Sim" : "Não"),
    cell: ({ row }) => (
      <span className="flex justify-center" title={FISCAL_EXPORT_UI.tooltip}>
        {row.original.fiscalExported ? (
          <Check
            className="size-4 text-success-emphasis"
            strokeWidth={2}
            aria-label={FISCAL_EXPORT_UI.yes}
          />
        ) : (
          <Minus
            className="size-4 text-muted-foreground"
            strokeWidth={2}
            aria-label={FISCAL_EXPORT_UI.no}
          />
        )}
      </span>
    ),
    meta: csvMeta((r) => (r.fiscalExported ? "sim" : "não")),
  },
  {
    id: "notaFiscal",
    header: "Nota fiscal",
    accessorFn: (r) => r.notaFiscal ?? "",
    cell: ({ row }) => (
      <span className="tabular-nums text-muted-foreground">
        {row.original.notaFiscal ?? "—"}
      </span>
    ),
  },
  {
    id: "origem",
    header: "Origem",
    accessorFn: (r) => SOURCE_LABEL[r.source],
    cell: ({ row }) => (
      <StatusBadge color="grey" outline>
        {SOURCE_LABEL[row.original.source]}
      </StatusBadge>
    ),
  },
  {
    id: "observacoes",
    header: "Observações",
    accessorFn: (r) => r.notes ?? "",
    cell: ({ row }) => (
      <span
        className="block max-w-[240px] truncate text-muted-foreground"
        title={row.original.notes ?? undefined}
      >
        {row.original.notes ?? "—"}
      </span>
    ),
  },
  {
    id: "dedupe",
    header: "Chave dedupe",
    accessorFn: (r) => r.dedupeKey,
    cell: ({ row }) => (
      <span className="text-xs tabular-nums text-muted-foreground">
        {row.original.dedupeKey}
      </span>
    ),
  },
];

interface LedgerSummary {
  previstoSum: number;
  pagoCount: number;
  pagoSum: number;
  pendenteCount: number;
  pendenteSum: number;
}

/** Totals over a row set: previsto (amount∥expected), pago, pendente. */
function summarize(rows: PagamentoRow[]): LedgerSummary {
  let previstoSum = 0;
  let pagoCount = 0;
  let pagoSum = 0;
  let pendenteCount = 0;
  let pendenteSum = 0;
  for (const r of rows) {
    previstoSum += r.amount ?? r.expectedAmount ?? 0;
    if (PAID_STATUSES.includes(r.status)) {
      pagoCount += 1;
      pagoSum += r.amount ?? 0;
    } else if (r.status !== "cancelada" && r.status !== "nao_aplicavel") {
      pendenteCount += 1;
      pendenteSum += r.amount ?? r.expectedAmount ?? 0;
    }
  }
  return { previstoSum, pagoCount, pagoSum, pendenteCount, pendenteSum };
}

/** One tab body: summary StatCards over its rows + the ledger DataTable. */
function LedgerPanel({
  rows,
  columns,
  monthLabel,
  csvFilename,
  onRowClick,
}: {
  rows: PagamentoRow[];
  columns: ColumnDef<PagamentoRow, unknown>[];
  monthLabel: string;
  csvFilename: string;
  onRowClick?: (row: PagamentoRow) => void;
}) {
  const summary = summarize(rows);
  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label={`Total previsto (${monthLabel})`}
          value={formatBRL(summary.previstoSum)}
          sub={`${rows.length} cobranças`}
        />
        <StatCard
          label="Pago"
          value={formatBRL(summary.pagoSum)}
          sub={`${summary.pagoCount} de ${rows.length} cobranças`}
          tone="success"
        />
        <StatCard
          label="Pendente"
          value={formatBRL(summary.pendenteSum)}
          sub={`${summary.pendenteCount} de ${rows.length} cobranças`}
          tone={summary.pendenteCount > 0 ? "warning" : "default"}
        />
      </div>
      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder="Buscar estação, parceiro…"
        csvFilename={csvFilename}
        initialSorting={[{ id: "estacao", desc: false }]}
        initialColumnVisibility={{ dedupe: false }}
        filterableColumnIds="all"
        pinnedRightColumnIds={["acoes"]}
        onRowClick={onRowClick}
        emptyMessage="Nenhuma cobrança encontrada para o período."
      />
    </>
  );
}

export function PagamentosView({
  rows,
  stations,
  review,
  canWrite,
  isAdmin,
}: {
  rows: PagamentoRow[];
  /** Station options for the "Nova cobrança manual" picker. */
  stations: StationOption[];
  /** needs_review queue data — feeds the "Documentos de e-mail" staging tab. */
  review: ReviewQueueData;
  /** operator or admin — enables Gerar mês + lifecycle actions. */
  canWrite: boolean;
  /** admin — additionally enables the "Cancelada" transition. */
  isAdmin: boolean;
}) {
  // Staging exclusion (decisão #47): webhook-created cobranças stay OUT of the
  // ledger tabs (Enel/EDP, Locação, A pagar) and their KPIs/month picker until
  // a human approves them in the Documentos de e-mail tab. Single choke point —
  // everything below derives from ledgerRows.
  const ledgerRows = React.useMemo(
    () => rows.filter((r) => !isStagedEmailCharge(r)),
    [rows],
  );

  const months = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of ledgerRows) {
      if (r.competencia) set.add(r.competencia.slice(0, 7));
    }
    return [...set].sort().reverse();
  }, [ledgerRows]);
  const hasNoCompetencia = React.useMemo(
    () => ledgerRows.some((r) => r.competencia === null),
    [ledgerRows],
  );

  // Default to all months: energy competências are frozen (decision #25) while
  // rent keeps advancing, so the latest month is usually rent-only — defaulting
  // to it would open the Enel/EDP tab empty. "Todos os meses" shows both tabs
  // populated; the picker narrows.
  const [month, setMonth] = React.useState<string>("all");
  const [drawerRow, setDrawerRow] = React.useState<PagamentoRow | null>(null);

  const filtered = React.useMemo(() => {
    if (month === "all") return ledgerRows;
    if (month === "none") return ledgerRows.filter((r) => r.competencia === null);
    return ledgerRows.filter((r) => r.competencia?.slice(0, 7) === month);
  }, [ledgerRows, month]);

  // The staging tab deliberately IGNORES the month picker: it's a review queue,
  // not a ledger slice — and its count must equal the sidebar badge
  // (countEmailDocPending applies the same isEmailDocRow predicate).
  const emailRows = React.useMemo(
    () => review.rows.filter(isEmailDocRow),
    [review.rows],
  );

  const isEnelEdp = (r: PagamentoRow) =>
    r.accountType === "energy_enel" || r.accountType === "energy_edp";
  const enelEdpRows = React.useMemo(
    () => filtered.filter(isEnelEdp),
    [filtered],
  );
  const outrosRows = React.useMemo(
    () => filtered.filter((r) => !isEnelEdp(r)),
    [filtered],
  );
  // "A pagar" (spec 2026-07-11): every open charge across BOTH account types,
  // due-date ordered inside the panel — the operational payables queue.
  const aPagarRows = React.useMemo(() => filtered.filter(isAPagar), [filtered]);

  const columns = React.useMemo<ColumnDef<PagamentoRow, unknown>[]>(
    () => [
      ...baseColumns,
      {
        id: "acoes",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <StatusActions
            row={row.original}
            canWrite={canWrite}
            isAdmin={isAdmin}
          />
        ),
      },
    ],
    [canWrite, isAdmin],
  );

  const monthLabel =
    month === "all"
      ? "Todos os meses"
      : month === "none"
        ? "Sem competência"
        : formatCompetencia(`${month}-01`);

  return (
    <>
      <PageHeader
        title="Pagamentos"
        description="Ledger mensal de cobranças por estação — aluguel e energia"
        actions={
          <>
            <Select value={month} onValueChange={(v) => setMonth(v as string)}>
              <SelectTrigger className="bg-card">
                <SelectValue>{monthLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m} value={m}>
                    {formatCompetencia(`${m}-01`)}
                  </SelectItem>
                ))}
                {hasNoCompetencia ? (
                  <SelectItem value="none">Sem competência</SelectItem>
                ) : null}
                <SelectItem value="all">Todos os meses</SelectItem>
              </SelectContent>
            </Select>
            <NovaCobrancaDialog canWrite={canWrite} stations={stations} />
            <GerarMesDialog canWrite={canWrite} />
          </>
        }
      />

      <Tabs defaultValue="enel_edp">
        <TabsList>
          <TabsTrigger value="enel_edp">
            Enel/EDP
            <span className="rounded bg-muted px-1 text-xs tabular-nums">
              {enelEdpRows.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="outros">
            Locação
            <span className="rounded bg-muted px-1 text-xs tabular-nums">
              {outrosRows.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="a_pagar">
            A pagar
            <span className="rounded bg-muted px-1 text-xs tabular-nums">
              {aPagarRows.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="email_docs">
            Documentos de e-mail
            {emailRows.length > 0 ? (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--badge-red-bg)] px-1.5 text-[11px] font-semibold leading-5 text-[var(--badge-red-text)] tabular-nums">
                {emailRows.length > 99 ? "99+" : emailRows.length}
              </span>
            ) : (
              <span className="rounded bg-muted px-1 text-xs tabular-nums">0</span>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="enel_edp">
          <LedgerPanel
            rows={enelEdpRows}
            columns={columns}
            monthLabel={monthLabel}
            csvFilename="pagamentos-enel-edp"
            onRowClick={setDrawerRow}
          />
        </TabsContent>
        <TabsContent value="outros">
          <LedgerPanel
            rows={outrosRows}
            columns={columns}
            monthLabel={monthLabel}
            csvFilename="pagamentos-aluguel-outros"
            onRowClick={setDrawerRow}
          />
        </TabsContent>
        <TabsContent value="a_pagar">
          <APagarPanel
            rows={aPagarRows}
            monthLabel={monthLabel}
            actionsColumn={columns[columns.length - 1]}
            onRowClick={setDrawerRow}
          />
        </TabsContent>
        <TabsContent value="email_docs">
          <EmailDocsPanel review={review} emailRows={emailRows} canWrite={canWrite} />
        </TabsContent>
      </Tabs>

      <PagamentoDrawer
        row={drawerRow}
        open={drawerRow !== null}
        onOpenChange={(o) => {
          if (!o) setDrawerRow(null);
        }}
        canWrite={canWrite}
        isAdmin={isAdmin}
      />
    </>
  );
}
