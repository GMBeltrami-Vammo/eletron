"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/vammo/status-badge";
import type { BadgeColor } from "@/components/vammo/status-badge";
import { runJobNow } from "@/app/actions/admin";
import { formatDateTime } from "@/lib/format";
import { refreshJobRuns } from "./admin-actions";
import type { AdminTableResult, JobRunRow } from "./admin-data";

const STATUS_UI: Record<string, { label: string; color: BadgeColor }> = {
  running: { label: "Em execução", color: "blue" },
  success: { label: "Concluído", color: "green" },
  partial: { label: "Parcial", color: "orange" },
  error: { label: "Erro", color: "red" },
  skipped_locked: { label: "Pulado (lock)", color: "grey" },
};

function statusUi(status: string): { label: string; color: BadgeColor } {
  return STATUS_UI[status] ?? { label: status, color: "grey" };
}

function triggerLabel(trigger: string): string {
  if (trigger === "cron") return "cron";
  if (trigger.startsWith("manual:")) return `manual · ${trigger.slice(7)}`;
  return trigger;
}

function duration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return "em curso";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1).replace(".", ",")} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s % 60)} s`;
}

type RunnableJob = "metabase-sync" | "alerts-eval" | "daily";

const JOB_OPTIONS: { job: RunnableJob; label: string; hint: string }[] = [
  {
    job: "daily",
    label: "Rotina diária",
    hint: "Sincroniza o Metabase e reavalia os alertas",
  },
  {
    job: "metabase-sync",
    label: "Sincronizar Metabase",
    hint: "Atualiza estações e boxes ativos direto do Metabase",
  },
  {
    job: "alerts-eval",
    label: "Avaliar alertas",
    hint: "Reavalia e regrava o painel de alertas",
  },
];

/**
 * Manual job trigger (rendered in the card header). A dropdown picks which
 * job — rotina diária is the first/default choice; each runs the job to
 * completion (runJobNow awaits it), then toasts and invalidates the Jobs
 * query. runJobNow re-checks the session server-side, so this is only the
 * affordance (roles suspended — any @vammo.com session may run jobs).
 */
function RunJobMenu({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = React.useState<RunnableJob | null>(null);

  async function trigger(job: RunnableJob, label: string) {
    if (!window.confirm(`Executar "${label}" agora?`)) return;
    setPending(job);
    try {
      const res = await runJobNow(job);
      if (res.ok) {
        toast.success(`${label}: execução concluída`);
        queryClient.invalidateQueries({ queryKey: ["job-runs"] });
        router.refresh();
      } else {
        toast.error(res.error);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Falha ao executar o job",
      );
    } finally {
      setPending(null);
    }
  }

  if (!isAdmin) {
    return (
      <span
        title="Requer papel de administrador"
        className="inline-flex cursor-not-allowed"
      >
        <Button variant="outline" size="sm" disabled>
          <Play className="size-3.5" strokeWidth={2} />
          Executar agora
        </Button>
      </span>
    );
  }

  const busy = pending !== null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" />}
        disabled={busy}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
        ) : (
          <Play className="size-3.5" strokeWidth={2} />
        )}
        {busy ? "Executando…" : "Executar agora"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Executar job agora</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {JOB_OPTIONS.map((opt) => (
          <DropdownMenuItem
            key={opt.job}
            onClick={() => trigger(opt.job, opt.label)}
            className="flex-col items-start gap-0.5"
          >
            <span className="text-sm font-medium">{opt.label}</span>
            <span className="text-xs text-muted-foreground">{opt.hint}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function JobRunsCard({
  initial,
  isAdmin,
}: {
  initial: AdminTableResult<JobRunRow>;
  isAdmin: boolean;
}) {
  const { data: rows } = useQuery({
    queryKey: ["job-runs"],
    queryFn: async () => {
      const res = await refreshJobRuns(50);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    initialData: initial.rows,
    enabled: initial.configured,
    // Poll only while a run is in progress.
    refetchInterval: (query) =>
      query.state.data?.some((r) => r.status === "running") ? 30_000 : false,
  });

  if (!initial.configured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Jobs</CardTitle>
          <CardDescription>
            Execuções de sincronização, alertas e comprovantes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Indisponível — requer o backend Supabase configurado.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Jobs</CardTitle>
        <CardDescription>
          Últimas execuções dos jobs (sincronização, alertas, comprovantes).
          Atualiza automaticamente enquanto há execução em curso.
        </CardDescription>
        <CardAction>
          <RunJobMenu isAdmin={isAdmin} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Disparo</TableHead>
                <TableHead>Início</TableHead>
                <TableHead>Duração</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Detalhes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-16 text-center text-sm text-muted-foreground"
                  >
                    Nenhuma execução registrada.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => {
                  const ui = statusUi(r.status);
                  const statEntries = r.stats
                    ? Object.entries(r.stats).filter(
                        ([k]) => k !== "issues",
                      )
                    : [];
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="py-2 text-sm font-medium whitespace-nowrap">
                        {r.jobName}
                      </TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {triggerLabel(r.trigger)}
                      </TableCell>
                      <TableCell className="py-2 text-xs tabular-nums whitespace-nowrap">
                        {formatDateTime(r.startedAt)}
                      </TableCell>
                      <TableCell className="py-2 text-xs tabular-nums whitespace-nowrap">
                        {duration(r.startedAt, r.finishedAt)}
                      </TableCell>
                      <TableCell className="py-2">
                        <StatusBadge
                          color={ui.color}
                          className={r.status === "running" ? "animate-pulse" : undefined}
                        >
                          {ui.label}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="py-2 text-xs">
                        <div className="flex flex-col gap-1">
                          {statEntries.length > 0 ? (
                            <Popover>
                              <PopoverTrigger
                                render={<Button variant="ghost" size="xs" />}
                              >
                                stats
                              </PopoverTrigger>
                              <PopoverContent align="start" className="w-auto">
                                <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-xs">
                                  {statEntries.map(([k, v]) => (
                                    <React.Fragment key={k}>
                                      <dt className="text-muted-foreground">
                                        {k}
                                      </dt>
                                      <dd className="text-right tabular-nums">
                                        {typeof v === "object"
                                          ? JSON.stringify(v)
                                          : String(v)}
                                      </dd>
                                    </React.Fragment>
                                  ))}
                                </dl>
                              </PopoverContent>
                            </Popover>
                          ) : null}
                          {r.error ? (
                            <details className="max-w-64">
                              <summary className="cursor-pointer text-destructive">
                                erro
                              </summary>
                              <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-muted p-2 text-[11px] text-muted-foreground">
                                {r.error}
                              </pre>
                            </details>
                          ) : null}
                          {statEntries.length === 0 && !r.error ? (
                            <span className="text-muted-foreground">—</span>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
