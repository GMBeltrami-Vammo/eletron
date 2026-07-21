"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { ExternalLink, Wrench } from "lucide-react";
import { toast } from "sonner";

import { adjustCharge } from "@/app/actions/alterations";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable } from "@/components/vammo/data-table";
import { StatusBadge } from "@/components/vammo/status-badge";
import { formatBRL, formatCompetencia, formatDate } from "@/lib/format";
import { FATURA_GAP_UI, type FaturaGap } from "@/lib/energia/fatura-a-arrumar";

/** Energy fatura the API received with a critical field missing (server-built). */
export interface FaturaAArrumarRow {
  /** dedupe_key (domain charge id) — stable key. */
  chargeId: string;
  /** real uuid for adjust_charge; null in sheets mode → ação desabilitada. */
  chargeUuid: string | null;
  provider: "Enel" | "EDP";
  installationKey: string | null;
  stationId: number | null;
  stationName: string | null;
  competencia: string | null;
  dueDate: string | null;
  amount: number | null;
  nf: string | null;
  gaps: FaturaGap[];
  faturaDriveUrl: string | null;
}

/** Money string → number (or null). Handles both a pt-BR value the user types
 * ("1.829,06" / "1829,06" — comma = decimal) AND the pre-filled `String(amount)`
 * ("1829.06" — dot = decimal), so an untouched field round-trips exactly. */
function parseBRL(s: string): number | null {
  const t = s.trim().replace(/\s/g, "");
  if (t === "") return null;
  // Comma present → pt-BR (dot = thousands). No comma → dot is the decimal point.
  const cleaned = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const columns: ColumnDef<FaturaAArrumarRow, unknown>[] = [
  {
    id: "provedor",
    header: "Provedor",
    accessorFn: (r) => r.provider,
    cell: ({ row }) => (
      <StatusBadge color={row.original.provider === "Enel" ? "blue" : "dark-green"}>
        {row.original.provider}
      </StatusBadge>
    ),
  },
  {
    id: "instalacao",
    header: "Instalação",
    accessorFn: (r) => r.installationKey ?? "—",
    cell: ({ getValue }) => (
      <span className="font-mono text-xs tabular-nums">{String(getValue())}</span>
    ),
  },
  {
    id: "estacao",
    header: "Estação",
    accessorFn: (r) => r.stationId ?? -1,
    cell: ({ row }) => {
      const { stationId, stationName } = row.original;
      if (stationId === null) return <span className="text-muted-foreground">sem estação</span>;
      return (
        <Link href={`/estacoes/${stationId}`} className="font-medium hover:underline">
          <span className="tabular-nums">#{stationId}</span>
          {stationName ? (
            <span className="font-normal text-muted-foreground"> · {stationName}</span>
          ) : null}
        </Link>
      );
    },
  },
  {
    id: "competencia",
    header: "Competência",
    accessorFn: (r) => r.competencia ?? "",
    cell: ({ row }) =>
      row.original.competencia ? (
        <span className="tabular-nums">{formatCompetencia(row.original.competencia)}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "vencimento",
    header: "Vencimento",
    accessorFn: (r) => r.dueDate ?? "",
    cell: ({ row }) =>
      row.original.dueDate ? (
        <span className="tabular-nums">{formatDate(row.original.dueDate)}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "valor",
    header: "Valor",
    accessorFn: (r) => r.amount ?? "",
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">{formatBRL(row.original.amount)}</span>
    ),
    meta: { csvValue: (row: FaturaAArrumarRow) => row.amount },
  },
  {
    id: "nf",
    header: "Nota fiscal",
    accessorFn: (r) => r.nf ?? "",
    cell: ({ row }) =>
      row.original.nf ? (
        <span className="font-mono text-xs tabular-nums">{row.original.nf}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "falta",
    header: "Falta",
    enableSorting: false,
    accessorFn: (r) => r.gaps.map((g) => FATURA_GAP_UI[g]).join(", "),
    cell: ({ row }) => (
      <span className="flex flex-wrap gap-1">
        {row.original.gaps.map((g) => (
          <StatusBadge key={g} color="orange" outline>
            {FATURA_GAP_UI[g]}
          </StatusBadge>
        ))}
      </span>
    ),
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
        >
          Ver fatura
          <ExternalLink className="size-3.5" strokeWidth={2} />
        </a>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "acoes",
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => <CorrigirButton row={row.original} />,
  },
];

/** Corrige valor/vencimento (reusa adjust_charge). NF/competência aguardam o feed do scraper. */
function CorrigirButton({ row }: { row: FaturaAArrumarRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(row.amount != null ? String(row.amount) : "");
  const [due, setDue] = useState(row.dueDate ?? "");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function save() {
    if (!row.chargeUuid) return;
    startTransition(async () => {
      const res = await adjustCharge({
        chargeId: row.chargeUuid as string,
        newAmount: parseBRL(amount),
        newDueDate: due || null,
        reason: reason.trim(),
      });
      if (res.ok) {
        toast.success("Fatura ajustada.");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="flex justify-end">
      <Button
        size="xs"
        variant="outline"
        disabled={!row.chargeUuid}
        onClick={() => setOpen(true)}
      >
        <Wrench className="size-3.5" strokeWidth={2} />
        Corrigir valor/venc.
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Corrigir valor / vencimento</DialogTitle>
            <DialogDescription>
              {row.provider} · {row.installationKey ?? "—"}. Nota fiscal e competência não são
              editáveis aqui — são preenchidas quando o scraper reenvia a fatura completa.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="faa-valor">Valor (R$)</Label>
              <Input
                id="faa-valor"
                inputMode="decimal"
                placeholder="0,00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="faa-venc">Vencimento</Label>
              <DateField id="faa-venc" value={due} onValueChange={setDue} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="faa-motivo">Motivo</Label>
              <Input
                id="faa-motivo"
                placeholder="Ex.: corrigir vencimento recebido errado"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button
              onClick={save}
              disabled={pending || !reason.trim() || (parseBRL(amount) === null && !due)}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function FaturasAArrumarTable({ rows }: { rows: FaturaAArrumarRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Buscar instalação, estação…"
      csvFilename="faturas-a-arrumar"
      pageSize={25}
      filterableColumnIds="all"
      emptyMessage="Nenhuma fatura a arrumar — tudo com vencimento, competência, valor e NF."
    />
  );
}
