"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Check,
  ExternalLink,
  ListChecks,
  Loader2,
  Minus,
  Paperclip,
  SearchCheck,
  Send,
} from "lucide-react";
import { toast } from "sonner";

import {
  sendFaturaToFiscal,
  sendToFiscal,
  verifyFaturasOnFiscal,
} from "@/app/actions/fiscal";
import type { SendOneOutcome } from "@/lib/fiscal/send-fiscal";
import { ComprovanteCell } from "@/components/vammo/comprovante-cell";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { comprovantePageSrc } from "@/lib/data/payment-links.shared";
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
import {
  ACCOUNT_TYPE_UI,
  AUTO_DEBIT_UI,
  CICLO_UI,
  FISCAL_EXPORT_UI,
} from "@/lib/labels";
import {
  formatBRL,
  formatCompetencia,
  formatDate,
  formatNumber,
} from "@/lib/format";

import { FiscalManualDialog } from "./fiscal-manual-dialog";
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
    id: "ciclo",
    // Q11 — OUR lifecycle stage of this fatura (same scale as Instalações):
    // 1 Detectada · 2 Analisada · 3 Enviada ao fiscal · 4 Paga.
    header: "Ciclo",
    accessorFn: (r) => CICLO_UI[r.ciclo].label,
    cell: ({ row }) => {
      const r = row.original;
      const ui = CICLO_UI[r.ciclo];
      const badge = (
        <span title={`Estágio ${r.ciclo} de 4`}>
          <StatusBadge color={ui.color}>{ui.label}</StatusBadge>
        </span>
      );
      // Ciclo 4 = Paga: hovering shows the bound comprovante's isolated page.
      const pageSrc = r.ciclo === 4 ? comprovantePageSrc(r.payment) : null;
      if (!pageSrc) return badge;
      return (
        <HoverCard>
          <HoverCardTrigger render={<span className="cursor-help" />}>
            {badge}
          </HoverCardTrigger>
          <HoverCardContent className="w-[360px] max-w-[90vw]">
            <iframe
              src={pageSrc}
              title="Comprovante da fatura paga"
              className="h-[460px] w-full rounded-md border-0 bg-white"
            />
          </HoverCardContent>
        </HoverCard>
      );
    },
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
      const reg = row.original.autoDebitRegistration;
      return (
        <span className="flex flex-col items-start gap-0.5">
          <StatusBadge color={ui.color}>{ui.label}</StatusBadge>
          {reg ? (
            <span
              className="font-mono text-[11px] tabular-nums text-muted-foreground"
              title="Nº de registro do débito automático"
            >
              {reg}
            </span>
          ) : null}
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
      const { payment, hasComprovante, comprovanteDate, chargeId, amount } =
        row.original;
      // sheet-era installation-level receipt (no charging payment) — historical
      // fallback, not a blank cell, so it doesn't offer manual binding.
      if (!payment && hasComprovante) {
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
      }
      // Linked → chip; blank → "Vincular" (charge-first matcher).
      return (
        <ComprovanteCell
          dedupeKey={chargeId}
          amount={amount}
          summary={payment}
          align="center"
        />
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

// Display order (Gabriel 2026-07-10): identity + status first, energy detail
// columns (TUSD…Classe) pushed to the end.
const COLUMN_ORDER = [
  "provedor",
  "instalacao",
  "estacao",
  "competencia",
  "debitoAutomatico",
  "valor",
  "vencimento",
  "ciclo",
  "fiscal",
  "fatura",
  "comprovante",
  "nf",
  "tusd",
  "te",
  "cip",
  "total",
  "leituras",
  "classeTarifaria",
];
const orderedColumns = COLUMN_ORDER.map((id) =>
  columns.find((c) => c.id === id),
).filter((c): c is ColumnDef<FaturaRow, unknown> => Boolean(c));

/** Per-bill send outcome → toast copy + tone. */
const SEND_ONE_UI: Record<
  SendOneOutcome,
  { message: string; tone: "success" | "info" | "error" }
> = {
  sent: { message: "Enviada ao fiscal", tone: "success" },
  registered: { message: "Já estava na planilha fiscal", tone: "info" },
  zero: { message: "Valor 0 — marcada como paga e conferida", tone: "success" },
  noValor: { message: "Sem valor — não enviada", tone: "info" },
  ignoredPast: { message: "Vencimento ≤ 2025 — ignorada", tone: "info" },
  blockedFuture: { message: "2027+ bloqueado — rever função", tone: "error" },
  pastDue: { message: "Vencida — não enviada", tone: "info" },
  naoCadastrado: {
    message: "Sem débito automático — use o fluxo manual (não enviada)",
    tone: "info",
  },
  semAba: { message: "Mês sem aba na planilha fiscal", tone: "info" },
  verifyFailed: {
    message: "Formato inválido (self-verify) — não enviada",
    tone: "error",
  },
  appendFailed: { message: "Falha ao gravar na planilha", tone: "error" },
  notFound: { message: "Fatura não encontrada", tone: "error" },
};

/**
 * Per-row "Enviar ao fiscal" (Gabriel 2026-07-14) — sends THIS fatura with the
 * same rules as the batch; the outcome (sent / já na planilha / sem DA / …) is
 * reported by a toast. No link to the sheet is ever exposed. Disabled once the
 * fatura is already fiscal-exported.
 */
function FaturaFiscalSendButton({
  row,
  canWrite,
}: {
  row: FaturaRow;
  canWrite: boolean;
}) {
  const [pending, setPending] = React.useState(false);
  const run = async () => {
    setPending(true);
    try {
      const res = await sendFaturaToFiscal(row.chargeId);
      if (res.ok) {
        const ui = SEND_ONE_UI[res.data.outcome];
        if (ui.tone === "success") toast.success(ui.message);
        else if (ui.tone === "error") toast.error(ui.message);
        else toast.info(ui.message);
      } else {
        toast.error(res.error);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Falha ao enviar ao fiscal",
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
      <Button
        variant="ghost"
        size="xs"
        disabled={pending || !canWrite || row.fiscalExported}
        onClick={run}
        title={
          row.fiscalExported
            ? "Já enviada ao fiscal"
            : "Enviar esta fatura ao fiscal (mesmas regras do envio em lote)"
        }
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
        ) : (
          <Send className="size-3.5" strokeWidth={2} />
        )}
        Enviar
      </Button>
    </div>
  );
}

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
  const [checkingFiscal, setCheckingFiscal] = React.useState(false);
  const [sendingFiscal, setSendingFiscal] = React.useState(false);

  // Decision #40: verify every fatura against the FISCAL spreadsheet and SYNC
  // "Enviada ao fiscal" (fiscal_exported) to what was found there. The column +
  // Ciclo refresh via revalidation; the toast reports the não/sem-aba breakdown.
  const runFiscalCheck = React.useCallback(async () => {
    setCheckingFiscal(true);
    try {
      const res = await verifyFaturasOnFiscal();
      if (res.ok) {
        const s = res.data.summary;
        toast.success(
          `Fiscal: ${s.registered} registrada(s) · ${s.notRegistered} não · ${s.noTab} sem aba (de ${s.total}). ${res.data.promoted} marcada(s) como enviada(s) ao fiscal.`,
        );
      } else {
        toast.error(res.error);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Falha ao verificar no fiscal",
      );
    } finally {
      setCheckingFiscal(false);
    }
  }, []);

  // Decision #42: WRITE eligible faturas (2026, débito automático, not yet on
  // the sheet) to the FISCAL spreadsheet. Direct send; the row format is
  // self-verified per row before append.
  const runSendToFiscal = React.useCallback(async () => {
    setSendingFiscal(true);
    try {
      const res = await sendToFiscal();
      if (res.ok) {
        const s = res.data;
        const parts = [`${s.sent} enviada(s) ao fiscal`];
        if (s.alreadyOnSheet) parts.push(`${s.alreadyOnSheet} já na planilha`);
        if (s.zeroValue) parts.push(`${s.zeroValue} valor 0 (pagas)`);
        if (s.pastDue) parts.push(`${s.pastDue} vencidas (não enviadas)`);
        if (s.naoCadastrado) parts.push(`${s.naoCadastrado} sem débito automático`);
        if (s.ignoredPast) parts.push(`${s.ignoredPast} ignorada(s) (≤2025)`);
        if (s.semAba) parts.push(`${s.semAba} sem aba`);
        if (s.verifyFailed) parts.push(`${s.verifyFailed} formato inválido`);
        if (s.appendFailed) parts.push(`${s.appendFailed} falha ao gravar`);
        toast.success(parts.join(" · "));
        if (s.blockedWarning) {
          toast.warning(`${s.blockedWarning} (${s.blockedFuture} fatura(s) de 2027+)`);
        }
      } else {
        toast.error(res.error);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Falha ao enviar ao fiscal",
      );
    } finally {
      setSendingFiscal(false);
    }
  }, []);

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

  // Append the per-row "Enviar ao fiscal" action (closes over canWrite).
  const tableColumns = React.useMemo<ColumnDef<FaturaRow, unknown>[]>(
    () => [
      ...orderedColumns,
      {
        id: "acoes",
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <FaturaFiscalSendButton row={row.original} canWrite={canWrite} />
        ),
      },
    ],
    [canWrite],
  );

  return (
    <DataTable
      columns={tableColumns}
      data={filtered}
      searchPlaceholder="Buscar fatura, NF, instalação…"
      csvFilename="faturas-energia"
      pinnedRightColumnIds={["acoes"]}
      initialSorting={[{ id: "vencimento", desc: true }]}
      filterableColumnIds="all"
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
          <Button
            variant="outline"
            size="sm"
            className="h-9 bg-card"
            onClick={runFiscalCheck}
            disabled={checkingFiscal}
            title="Confere cada fatura na planilha FISCAL (somente leitura)"
          >
            {checkingFiscal ? (
              <Loader2 className="size-4 animate-spin" strokeWidth={2} />
            ) : (
              <SearchCheck className="size-4" strokeWidth={2} />
            )}
            Verificar no fiscal
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 bg-card"
            onClick={runSendToFiscal}
            disabled={sendingFiscal || !canWrite}
            title="Grava na planilha FISCAL as faturas elegíveis: 2026, com débito automático, ainda não na planilha"
          >
            {sendingFiscal ? (
              <Loader2 className="size-4 animate-spin" strokeWidth={2} />
            ) : (
              <ListChecks className="size-4" strokeWidth={2} />
            )}
            Enviar ao fiscal em lote
          </Button>
          <FiscalManualDialog canWrite={canWrite} />
        </>
      }
    />
  );
}
