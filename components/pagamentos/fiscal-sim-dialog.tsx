"use client";

/**
 * "Enviar ao fiscal (simulação)" — Head-only preview of the locação → FISCAL
 * rows (decision #66). Gabriel 2026-07-17: DO NOT send locação to the sheet yet;
 * this button only SIMULATES — it builds the exact rows that WOULD be appended
 * (pure buildLocacaoFiscalRow, method-aware) and shows them, marking nothing and
 * writing nothing. The real send + local dedup stay dormant (#65); Enel/EDP keep
 * their real send (#42). Head gate is scaffolded (#55): any @vammo.com for now.
 */

import * as React from "react";
import { Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildLocacaoFiscalRow,
  type RentFiscalKind,
  type RentFiscalMethod,
} from "@/lib/fiscal/rent-fiscal-row";
import { fiscalTodayISO, formatDueDateBR } from "@/lib/fiscal/fiscal-dates";
import { viewerCanApproveFiscalEdit } from "@/lib/permissions/fiscal-lock";
import type { PaymentMethod } from "@/lib/domain";
import type { PagamentoRow } from "./types";

const HEADERS = [
  "Data envio",
  "Método",
  "Parceiro",
  "Valor",
  "Ref/NF",
  "Descrição",
  "Vencimento",
  "Categoria",
  "COGS",
  "Documento",
  "Status",
];

const TERMINAL = new Set(["cancelada", "nao_aplicavel"]);

function fiscalMethod(m: PaymentMethod | null): RentFiscalMethod {
  if (m === "pix") return "pix";
  if (m === "transferencia") return "transferencia";
  if (m === "boleto_email" || m === "boleto_celular") return "boleto";
  return null;
}

/** Rows that WOULD be sent: locação, not yet fiscal-exported, with a due date. */
export function eligibleForFiscalSim(rows: PagamentoRow[]): PagamentoRow[] {
  return rows.filter(
    (r) =>
      !r.fiscalExported &&
      r.dueDate !== null &&
      r.amount !== null &&
      !TERMINAL.has(r.status),
  );
}

export function FiscalSimDialog({ rows }: { rows: PagamentoRow[] }) {
  const [open, setOpen] = React.useState(false);
  const canSend = viewerCanApproveFiscalEdit();

  const { built, skipped } = React.useMemo(() => {
    const dateSent = formatDueDateBR(fiscalTodayISO(new Date()));
    const eligible = eligibleForFiscalSim(rows);
    const builtRows = eligible.map((r) =>
      buildLocacaoFiscalRow({
        kind: r.kind as RentFiscalKind,
        method: fiscalMethod(r.paymentMethod),
        cnpj: r.cnpj,
        dateSent,
        parceiro: r.parceiro ?? "",
        valorTotal: r.amount ?? 0,
        notaFiscal: r.notaFiscal ?? "",
        competencia: r.competencia,
        endereco: r.stationAddress ?? "",
        dueDate: formatDueDateBR(r.dueDate ?? ""),
        documentUrl: r.documentHref ?? "",
        contractRentAmount: r.contractRentAmount,
      }),
    );
    return { built: builtRows, skipped: rows.length - eligible.length };
  }, [rows]);

  if (!canSend) {
    return (
      <span title="Somente heads podem enviar ao fiscal (papéis suspensos por ora)">
        <Button variant="outline" size="sm" disabled>
          <Send className="size-4" strokeWidth={2} />
          Enviar ao fiscal (simulação)
        </Button>
      </span>
    );
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Send className="size-4" strokeWidth={2} />
        Enviar ao fiscal (simulação)
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Enviar ao fiscal — simulação</DialogTitle>
            <DialogDescription>
              Pré-visualização das {built.length} linha(s) que SERIAM enviadas à
              planilha fiscal — uma por estação. Nada é escrito nem marcado
              (simulação). O envio real de aluguel está desligado; Enel/EDP têm
              envio próprio na aba Energia.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
            {built.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Nenhuma cobrança de locação pendente de envio ao fiscal.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                  <tr>
                    {HEADERS.map((h) => (
                      <th
                        key={h}
                        className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-muted-foreground"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {built.map((row, i) => (
                    <tr key={i} className="border-t border-border align-top">
                      {row.map((cell, j) => (
                        <td
                          key={j}
                          className="max-w-64 px-2 py-1 [overflow-wrap:anywhere]"
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {skipped > 0 ? (
            <p className="text-xs text-muted-foreground">
              {skipped} cobrança(s) fora da simulação (já enviada ao fiscal, sem
              vencimento, sem valor ou cancelada).
            </p>
          ) : null}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Fechar</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
