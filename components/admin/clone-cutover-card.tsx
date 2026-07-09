"use client";

/**
 * One-time cutover clone card (decision #25). Runs the final Sheets → Supabase
 * clone from the DEPLOYED app (Vercel env has the sheets SA key + Supabase
 * service role), so no local credentials are needed. Shows the resulting row
 * counts. After a successful clone, the operator sets REPOSITORY_BACKEND=supabase
 * in Vercel so the app serves from Supabase.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { DatabaseZap } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/vammo/status-badge";
import { runFinalClone } from "@/app/actions/admin";

interface CloneCounts {
  status: string;
  rowsRead: number;
  rowsUpserted: number;
  counts: Record<string, number>;
}

export function CloneCutoverCard() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<CloneCounts | null>(null);

  async function run() {
    if (
      !window.confirm(
        "Clonar as planilhas para o Supabase agora?\n\n" +
          "Lê as planilhas do scraper/aluguéis UMA vez e popula o banco (idempotente). " +
          "Depois, defina REPOSITORY_BACKEND=supabase na Vercel para o app passar a ler do Supabase.",
      )
    ) {
      return;
    }
    setPending(true);
    try {
      const res = await runFinalClone();
      if (res.ok) {
        setResult(res.data as CloneCounts);
        toast.success(
          `Clone concluído — ${res.data.rowsUpserted} linhas gravadas`,
        );
        router.refresh();
      } else {
        toast.error(res.error);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha no clone");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clonar planilhas → Supabase (cutover único)</CardTitle>
        <CardDescription>
          Popula o banco a partir das planilhas, uma última vez. Roda no servidor
          (usa as credenciais da Vercel) — não precisa rodar nada localmente.
          Depois do clone, defina <code>REPOSITORY_BACKEND=supabase</code> na
          Vercel.
        </CardDescription>
        <CardAction>
          <StatusBadge color="orange" outline>
            Uma vez
          </StatusBadge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={run} disabled={pending}>
          <DatabaseZap className="size-4" strokeWidth={2} />
          {pending ? "Clonando…" : "Clonar agora"}
        </Button>
        {result ? (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">
              {result.status} · {result.rowsUpserted} linhas gravadas (
              {result.rowsRead} lidas)
            </p>
            <ul className="mt-1 grid grid-cols-2 gap-x-4 text-xs tabular-nums text-muted-foreground sm:grid-cols-3">
              {Object.entries(result.counts).map(([tab, n]) => (
                <li key={tab}>
                  {tab}: {n}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
