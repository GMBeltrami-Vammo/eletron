import { Suspense } from "react";
import type { Metadata } from "next";

import { ArqiaView } from "@/components/arqia/arqia-view";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/vammo/page-header";
import { getSessionEmail, isOperatorEmail, userClientFor } from "@/lib/http/guards";
import { getArqiaData } from "./queries";

export const metadata: Metadata = { title: "Arqia — Eletron" };

const DESCRIPTION =
  "Monitoramento dos SIMs IoT (Arqia): consumo vs limite do mês, alertas e dados móveis comprados";

export default function ArqiaPage() {
  return (
    <div>
      <Suspense fallback={<PageSkeleton />}>
        <Content />
      </Suspense>
    </div>
  );
}

async function currentIsOperator(): Promise<boolean> {
  try {
    const email = await getSessionEmail();
    if (!email) return false;
    const client = await userClientFor(email);
    return await isOperatorEmail(client, email);
  } catch {
    return false;
  }
}

async function Content() {
  const [data, isOperator] = await Promise.all([getArqiaData(), currentIsOperator()]);
  return (
    <div>
      <PageHeader title="Arqia" description={DESCRIPTION} />
      <ArqiaView data={data} isOperator={isOperator} />
    </div>
  );
}

function PageSkeleton() {
  return (
    <div>
      <PageHeader title="Arqia" description={DESCRIPTION} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="mt-4 h-64 rounded-xl" />
    </div>
  );
}
