"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  acknowledgeAlert,
  muteAlert,
  resolveAlert,
} from "@/app/actions/alerts";
import type { AlertStatus } from "@/lib/domain";
import { formatDate } from "@/lib/format";
import {
  ALERT_ACTION_LABEL,
  allowedActions,
  type AlertActionKind,
} from "./alert-lifecycle-ui";

const DONE_LABEL: Record<AlertActionKind, string> = {
  acknowledge: "reconhecido(s)",
  resolve: "resolvido(s)",
  mute: "silenciado(s)",
};

type MuteDuration = "7d" | "30d" | "custom";

function composeMuteNote(
  duration: MuteDuration,
  customDate: string,
  reason: string,
): string {
  const until =
    duration === "7d"
      ? "por 7 dias"
      : duration === "30d"
        ? "por 30 dias"
        : `até ${formatDate(customDate)}`;
  return `Silenciado ${until} · ${reason.trim()}`;
}

/** Per-row action menu — only the transitions the state machine allows. */
export function RowActionsMenu({
  status,
  canWrite,
  onAction,
}: {
  status: AlertStatus;
  canWrite: boolean;
  onAction: (kind: AlertActionKind) => void;
}) {
  const actions = allowedActions(status);
  if (actions.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (!canWrite) {
    return (
      <span title="Requer papel operador/admin" className="inline-flex">
        <Button variant="outline" size="xs" disabled>
          Ações
          <ChevronDown className="size-3" strokeWidth={2} />
        </Button>
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="xs" />}
      >
        Ações
        <ChevronDown className="size-3" strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((kind) => (
          <DropdownMenuItem key={kind} onClick={() => onAction(kind)}>
            {ALERT_ACTION_LABEL[kind]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Shared confirm dialog for one alert or a bulk selection. mute_alert has no
 * duration column (RPC takes only a note), so the chosen duration + reason are
 * composed into the note (persisted in audit_events, shown as the mute tooltip).
 */
export function AlertActionDialog({
  mode,
  targetIds,
  onClose,
  onDone,
}: {
  mode: AlertActionKind | null;
  targetIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [note, setNote] = React.useState("");
  const [duration, setDuration] = React.useState<MuteDuration>("30d");
  const [customDate, setCustomDate] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  // Reset the form whenever the dialog target changes.
  React.useEffect(() => {
    if (mode) {
      setNote("");
      setDuration("30d");
      setCustomDate("");
      setReason("");
    }
  }, [mode, targetIds]);

  const count = targetIds.length;
  const muteReasonMissing = mode === "mute" && reason.trim() === "";
  const customDateMissing =
    mode === "mute" && duration === "custom" && customDate === "";

  function run() {
    if (!mode || count === 0) return;
    const finalNote =
      mode === "mute"
        ? composeMuteNote(duration, customDate, reason)
        : note.trim() || null;
    startTransition(async () => {
      let ok = 0;
      const errors: string[] = [];
      for (const id of targetIds) {
        const res =
          mode === "acknowledge"
            ? await acknowledgeAlert({ alertId: id, note: finalNote })
            : mode === "resolve"
              ? await resolveAlert({ alertId: id, note: finalNote })
              : await muteAlert({ alertId: id, note: finalNote });
        if (res.ok) ok += 1;
        else errors.push(res.error);
      }
      if (ok > 0) toast.success(`${ok} alerta(s) ${DONE_LABEL[mode]}.`);
      if (errors.length > 0) {
        toast.error(`${errors.length} falhou(aram): ${errors[0]}`);
      }
      onDone();
      onClose();
      router.refresh();
    });
  }

  const title =
    mode === "acknowledge"
      ? "Reconhecer alerta(s)"
      : mode === "resolve"
        ? "Resolver alerta(s)"
        : "Silenciar alerta(s)";

  return (
    <Dialog open={mode !== null} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {count > 1 ? `${count} alertas selecionados. ` : ""}
            {mode === "mute"
              ? "Escolha por quanto tempo e o motivo. Fica registrado no histórico."
              : "A ação fica registrada no histórico com o seu nome."}
          </DialogDescription>
        </DialogHeader>

        {mode === "mute" ? (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="mute-duration">Silenciar por</Label>
              <Select
                value={duration}
                onValueChange={(v) => setDuration(v as MuteDuration)}
              >
                <SelectTrigger id="mute-duration" className="w-full bg-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">7 dias</SelectItem>
                  <SelectItem value="30d">30 dias</SelectItem>
                  <SelectItem value="custom">Até uma data…</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {duration === "custom" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="mute-date">Até</Label>
                <DateField
                  id="mute-date"
                  value={customDate}
                  onValueChange={setCustomDate}
                />
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="mute-reason">Motivo</Label>
              <Textarea
                id="mute-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex.: negociação em andamento com a concessionária…"
                aria-invalid={muteReasonMissing}
              />
            </div>
          </div>
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor="action-note">Observação (opcional)</Label>
            <Textarea
              id="action-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Contexto para o histórico…"
            />
          </div>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
          <Button
            onClick={run}
            disabled={pending || muteReasonMissing || customDateMissing}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" strokeWidth={2} />
            ) : (
              <Check className="size-4" strokeWidth={2} />
            )}
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
