import { Suspense } from "react";
import type { Metadata } from "next";

import { BackLink } from "@/components/revisao/back-link";
import {
  UnmatchedAccountsTable,
  type UnmatchedAccountRow,
} from "@/components/revisao/unmatched-accounts-table";
import { DataTableSkeleton } from "@/components/vammo/data-table";
import { FreshnessDot } from "@/components/vammo/freshness-dot";
import { PageHeader } from "@/components/vammo/page-header";
import { getRepository } from "@/lib/data/repository.server";

export const metadata: Metadata = { title: "Instalações não vinculadas" };

const DESCRIPTION =
  "Instalações coletadas pelo scraper sem estação correspondente — o vínculo manual substitui o loop do Slack na fase 2";

export default function InstalacoesPage() {
  return (
    <div>
      <BackLink />
      <Suspense fallback={<PageSkeleton />}>
        <InstalacoesContent />
      </Suspense>
    </div>
  );
}

async function InstalacoesContent() {
  const repo = getRepository();
  const [irregularities, snapshot, freshness] = await Promise.all([
    repo.getIrregularities(),
    repo.getSnapshot(),
    repo.getFreshness(),
  ]);

  const stateByAccount = new Map(
    snapshot.utilityAccountStates.map((state) => [state.billingAccountId, state]),
  );

  const rows: UnmatchedAccountRow[] = irregularities.unmatchedAccounts.map(
    (account) => {
      const state = stateByAccount.get(account.id);
      return {
        id: account.id,
        accountType: account.accountType,
        externalKey:
          account.enelId ?? account.edpUc ?? account.externalRef ?? account.id,
        matchStatus: account.matchStatus,
        address: state?.address ?? null,
        neighborhood: state?.neighborhood ?? null,
        city: state?.city ?? null,
        providerStationStatus: state?.providerStationStatus ?? null,
        billStatus: state?.billStatus ?? null,
        lastBilling: state?.lastBilling ?? null,
        dueDate: state?.dueDate ?? null,
        firstSeenAt: state?.firstSeenAt ?? null,
        scrapedAt: state?.scrapedAt ?? null,
        notes: account.notes,
      };
    },
  );

  return (
    <div>
      <PageHeader
        title="Instalações não vinculadas"
        description={DESCRIPTION}
        actions={
          <FreshnessDot
            timestamp={freshness.maxScrapedAt}
            label="Última coleta"
          />
        }
      />
      <UnmatchedAccountsTable rows={rows} />
    </div>
  );
}

function PageSkeleton() {
  return (
    <div>
      <PageHeader title="Instalações não vinculadas" description={DESCRIPTION} />
      <DataTableSkeleton />
    </div>
  );
}
