"use client";

/**
 * Document picker (shadcn `Command`) for feature D Part 2b — binds a charge's
 * SOURCE bill (boleto/fatura/nota) via set_charge_document, so an incomplete /
 * unlinked webhook document can be completed by hand. Lists source-bill
 * documents only (the query + the RPC both exclude comprovante/foto/contrato).
 * Self-contained fetch (no QueryClient dependency on /pagamentos).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { setChargeDocument } from "@/app/actions/charges";
import { fetchSourceDocuments } from "@/app/actions/documents";
import type { SourceDocumentOption } from "@/lib/data/source-documents";
import { formatDate } from "@/lib/format";

const KIND_LABEL: Record<string, string> = {
  fatura_enel: "Fatura Enel",
  fatura_edp: "Fatura EDP",
  boleto_aluguel: "Boleto aluguel",
  boleto_condominio: "Boleto condomínio",
  nota_debito: "Nota de débito",
  nfse: "NFS-e",
  outro: "Outro",
};

export function DocumentPicker({
  open,
  onOpenChange,
  chargeId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chargeId: string;
}) {
  const router = useRouter();
  const [docs, setDocs] = React.useState<SourceDocumentOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    let alive = true;
    setLoading(true);
    fetchSourceDocuments()
      .then((d) => {
        if (alive) setDocs(d);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  function docLabel(d: SourceDocumentOption): string {
    return `${d.filename ?? "sem nome"} ${KIND_LABEL[d.kind] ?? d.kind} ${d.createdAt ?? ""}`;
  }

  function submit() {
    if (!selectedId) return;
    startTransition(async () => {
      const res = await setChargeDocument({ chargeId, documentId: selectedId });
      if (res.ok) {
        toast.success("Documento vinculado.");
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Vincular documento à cobrança</DialogTitle>
          <DialogDescription>
            Selecione a fatura/boleto de origem desta cobrança. Comprovantes de
            pagamento não aparecem aqui — eles são vinculados em Comprovantes.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border">
          <Command shouldFilter>
            <CommandInput placeholder="Buscar por nome do arquivo…" />
            <CommandList>
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" strokeWidth={2} />
                  Carregando documentos…
                </div>
              ) : (
                <>
                  <CommandEmpty>Nenhum documento encontrado.</CommandEmpty>
                  <CommandGroup heading="Faturas / boletos">
                    {docs.map((d) => (
                      <CommandItem
                        key={d.id}
                        value={docLabel(d)}
                        data-checked={d.id === selectedId}
                        onSelect={() => setSelectedId(d.id)}
                        className="gap-2 py-2"
                      >
                        <FileText
                          className="size-4 shrink-0 text-muted-foreground"
                          strokeWidth={2}
                        />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-medium">
                            {d.filename ?? "(sem nome)"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {KIND_LABEL[d.kind] ?? d.kind}
                            {d.createdAt ? ` · ${formatDate(d.createdAt)}` : ""}
                            {d.pageCount ? ` · ${d.pageCount} pág.` : ""}
                          </span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || !selectedId}>
            <Link2 className="size-4" strokeWidth={2} />
            Vincular
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
