import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { getRepository } from "@/lib/data/repository.server";
import { IRREGULARITY_ALERT_TYPES } from "@/lib/ingest/derive";
import { countPendingContractIntakes } from "./revisao/contratos/queries";
import { countEmailDocPending } from "./revisao/cobrancas/queries";
import { Providers } from "@/components/providers";
import { AppSidebar } from "@/components/vammo/sidebar";
import { MobileNav } from "@/components/vammo/mobile-nav";
import type { NavBadgeCounts } from "@/components/vammo/nav-items";
import { Toaster } from "@/components/ui/sonner";

import { signOutAction } from "./actions";

/**
 * Render the entire authenticated app per-request. Every route here reads the
 * live Google Sheets snapshot and the session cookie, so none can be statically
 * prerendered — forcing dynamic keeps `next build` from executing (and timing
 * out on) Sheets calls during static generation. Cross-request caching still
 * comes from the repository's `unstable_cache` (15-min TTL); this only disables
 * build-time prerendering, not the data cache. Cascades to all child segments.
 */
export const dynamic = "force-dynamic";

/** Badge counts must never break the shell — snapshot load failures show 0. */
async function loadBadgeCounts(): Promise<NavBadgeCounts | undefined> {
  try {
    const repo = getRepository();
    const [alerts, irregularities, pendingContratos, emailDocPending] =
      await Promise.all([
        repo.getAlerts(),
        repo.getIrregularities(),
        countPendingContractIntakes(),
        countEmailDocPending(),
      ]);
    return {
      // Join irregularities live in /revisão, not the /alertas badge.
      alertas: alerts.filter(
        (a) => a.status === "open" && !IRREGULARITY_ALERT_TYPES.has(a.alertType),
      ).length,
      revisao:
        irregularities.joinAlerts.length +
        irregularities.unmatchedAccounts.length +
        irregularities.unmatchedCharges.length +
        pendingContratos,
      // documentos de e-mail aguardando análise (#47) — same isEmailDocRow
      // predicate as the /pagamentos tab, so badge and tab never drift.
      pagamentos: emailDocPending,
    };
  } catch {
    return undefined;
  }
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const counts = await loadBadgeCounts();

  return (
    <Providers>
      <div className="flex min-h-svh bg-background">
        <AppSidebar
          user={{
            name: session.user.name,
            email: session.user.email,
            image: session.user.image,
          }}
          counts={counts}
          onSignOut={signOutAction}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileNav counts={counts} />
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
      <Toaster position="top-right" />
    </Providers>
  );
}
