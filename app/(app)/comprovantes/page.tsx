import type { Metadata } from "next";
import { Suspense } from "react";

import { ComprovantesInbox } from "@/components/comprovantes/inbox-table";
import {
  getInboxData,
  getViewerContext,
} from "@/components/comprovantes/queries";
import { DataTableSkeleton } from "@/components/vammo/data-table";
import { PageHeader } from "@/components/vammo/page-header";

export const metadata: Metadata = { title: "Comprovantes" };

const DESCRIPTION =
  "Inbox de comprovantes de pagamento — envio, conciliação e revisão";

export default function ComprovantesPage() {
  return (
    <div>
      <PageHeader title="Comprovantes" description={DESCRIPTION} />
      <Suspense fallback={<DataTableSkeleton />}>
        <InboxContent />
      </Suspense>
    </div>
  );
}

async function InboxContent() {
  const [data, viewer] = await Promise.all([
    getInboxData(),
    getViewerContext(),
  ]);
  return <ComprovantesInbox initialData={data} viewer={viewer} />;
}
