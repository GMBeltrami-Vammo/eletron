import { Suspense } from "react";
import { Map, ScrollText } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { FreshnessDot } from "@/components/vammo/freshness-dot";
import { PageHeader } from "@/components/vammo/page-header";
import { StatusBadge } from "@/components/vammo/status-badge";
import { IngestIssues } from "@/components/admin/ingest-issues";
import { getViewer } from "@/components/admin/viewer";
import { readJobRuns, readUserRoles } from "@/components/admin/admin-data";
import { UserRolesCard } from "@/components/admin/user-roles-card";
import { JobRunsCard } from "@/components/admin/job-runs-card";
import { getRepository } from "@/lib/data/repository.server";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Configurações" };

export default function AdminPage() {
  return (
    <div>
      <PageHeader
        title="Configurações"
        description="Saúde da ingestão, mapeamentos e auditoria"
      />
      <div className="space-y-4">
        <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
          <IngestHealthCard />
        </Suspense>

        <Suspense fallback={<Skeleton className="h-72 w-full rounded-xl" />}>
          <AdminManagementCards />
        </Suspense>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Mapeamentos</CardTitle>
              <CardDescription>
                Tabelas de correspondência mantidas manualmente: loja DIA ↔
                estação, endereço Hubees ↔ estação e CNPJs das SPEs (Kitchen
                Central).
              </CardDescription>
              <CardAction>
                <StatusBadge color="grey" outline>
                  Fase 3
                </StatusBadge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                <Map
                  className="mr-1.5 inline size-4 align-text-bottom"
                  strokeWidth={2}
                />
                A edição chega junto com a ingestão de cobranças de terceiros —
                até lá os mapeamentos vivem no pipeline de normalização.
              </p>
            </CardContent>
            <CardFooter>
              <span title="Disponível na fase 3">
                <Button variant="outline" disabled>
                  Gerenciar mapeamentos
                </Button>
              </span>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Auditoria</CardTitle>
              <CardDescription>
                Registro de eventos de escrita — quem marcou pago, remapeou
                conta ou editou contrato, e quando (padrão goBuy
                request_events).
              </CardDescription>
              <CardAction>
                <StatusBadge color="grey" outline>
                  Fase 2
                </StatusBadge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                <ScrollText
                  className="mr-1.5 inline size-4 align-text-bottom"
                  strokeWidth={2}
                />
                A fase 1 é somente leitura — o log de auditoria nasce com as
                primeiras escritas no Supabase.
              </p>
            </CardContent>
            <CardFooter>
              <span title="Disponível na fase 2">
                <Button variant="outline" disabled>
                  Ver auditoria
                </Button>
              </span>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}

async function AdminManagementCards() {
  const viewer = await getViewer();
  const isAdmin = viewer.role === "admin";
  const [userRoles, jobRuns] = await Promise.all([
    isAdmin ? readUserRoles() : Promise.resolve(null),
    readJobRuns(50),
  ]);
  return (
    <div className="space-y-4">
      {isAdmin && userRoles ? <UserRolesCard data={userRoles} /> : null}
      <JobRunsCard initial={jobRuns} isAdmin={isAdmin} />
    </div>
  );
}

async function IngestHealthCard() {
  const repo = getRepository();
  const [freshness, irregularities] = await Promise.all([
    repo.getFreshness(),
    repo.getIrregularities(),
  ]);
  const issues = irregularities.issues;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Saúde da ingestão</CardTitle>
        <CardDescription>
          Frescor das fontes de dados e problemas de normalização do último
          snapshot
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-3">
            <FreshnessDot
              label="Enel"
              timestamp={freshness.byProvider.enel.maxScrapedAt}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Coleta mais recente:{" "}
              <span className="tabular-nums">
                {formatDateTime(freshness.byProvider.enel.maxScrapedAt)}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              Mais antiga:{" "}
              <span className="tabular-nums">
                {formatDateTime(freshness.byProvider.enel.minScrapedAt)}
              </span>
            </p>
          </div>

          <div className="rounded-lg border border-border p-3">
            <FreshnessDot
              label="EDP"
              timestamp={freshness.byProvider.edp.maxScrapedAt}
              warnHours={7 * 24}
              criticalHours={30 * 24}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Coleta mais recente:{" "}
              <span className="tabular-nums">
                {formatDateTime(freshness.byProvider.edp.maxScrapedAt)}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              Coleta manual — cadência própria, mais espaçada que a Enel.
            </p>
          </div>

          <div className="rounded-lg border border-border p-3">
            <FreshnessDot
              label="Planilha"
              timestamp={freshness.fetchedAt}
              warnHours={1}
              criticalHours={3}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Snapshot carregado em:{" "}
              <span className="tabular-nums">
                {formatDateTime(freshness.fetchedAt)}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              Cache de ~15 min sobre a leitura do Google Sheets.
            </p>
          </div>
        </div>

        <Separator />

        <IngestIssues issues={issues.slice(0, 50)} total={issues.length} />
      </CardContent>
    </Card>
  );
}
