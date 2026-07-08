import { Suspense } from "react";
import type { Metadata } from "next";
import { CircleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTableSkeleton } from "@/components/vammo/data-table";
import { FreshnessDot } from "@/components/vammo/freshness-dot";
import { PageHeader } from "@/components/vammo/page-header";
import { EnergiaTabs } from "@/components/energia/energia-tabs";
import { readEnergyAccounts } from "@/components/energia/energy-accounts";
import type {
  EnergyProvider,
  FaturaRow,
  InstalacaoRow,
} from "@/components/energia/types";
import { getRepository } from "@/lib/data/repository.server";
import {
  readPaymentLinks,
  summarizeLinks,
  type PaymentLinkIndex,
} from "@/lib/data/payment-links";
import {
  getSessionEmail,
  isOperatorEmail,
  userClientFor,
} from "@/lib/http/guards";
import {
  ACCOUNT_TYPE,
  type ChargeEnergyDetails,
  type MonthlyConsumption,
} from "@/lib/domain";
import type {
  FreshnessInfo,
  LoadedSnapshot,
} from "@/lib/data/repository";

export const metadata: Metadata = { title: "Energia — Eletron" };

/** EDP is scraped manually, on a much slower cadence than ENEL's nightly run. */
const EDP_WARN_HOURS = 24 * 7;
const EDP_CRITICAL_HOURS = 24 * 30;

/**
 * Latest month having BOTH kWh faturado (F) and registrado (R):
 * (billed − recorded) / billed × 100.
 */
function frDivergence(consumption: MonthlyConsumption[]): {
  pct: number | null;
  month: string | null;
} {
  let latest: MonthlyConsumption | null = null;
  for (const m of consumption) {
    if (m.kwhBilled === null || m.kwhRecorded === null || m.kwhBilled === 0) {
      continue;
    }
    if (latest === null || m.competencia > latest.competencia) latest = m;
  }
  if (latest === null) return { pct: null, month: null };
  const billed = latest.kwhBilled as number;
  const recorded = latest.kwhRecorded as number;
  return {
    pct: ((billed - recorded) / billed) * 100,
    month: latest.competencia.slice(0, 7),
  };
}

/** ENEL C1–C6 joined, or EDP classificação · modalidade. */
function tariffClass(d: ChargeEnergyDetails): string | null {
  if (d.classificacao) {
    return [d.classificacao, d.modalidade]
      .filter((v): v is string => v !== null && v !== "")
      .join(" · ");
  }
  const cs = [
    d.tariffC1,
    d.tariffC2,
    d.tariffC3,
    d.tariffC4,
    d.tariffC5,
    d.tariffC6,
  ].filter((v): v is string => v !== null && v !== "");
  return cs.length > 0 ? cs.join(" · ") : null;
}

function buildRows(
  snapshot: LoadedSnapshot,
  links: PaymentLinkIndex,
): {
  instalacoes: InstalacaoRow[];
  faturas: FaturaRow[];
} {
  const stateByAccount = new Map(
    snapshot.utilityAccountStates.map((s) => [s.billingAccountId, s]),
  );
  const consumptionByAccount = new Map<string, MonthlyConsumption[]>();
  for (const m of snapshot.monthlyConsumption) {
    const list = consumptionByAccount.get(m.billingAccountId) ?? [];
    list.push(m);
    consumptionByAccount.set(m.billingAccountId, list);
  }

  const energyAccounts = snapshot.billingAccounts.filter(
    (a) =>
      a.accountType === ACCOUNT_TYPE.energyEnel ||
      a.accountType === ACCOUNT_TYPE.energyEdp,
  );

  const instalacoes: InstalacaoRow[] = energyAccounts.map((account) => {
    const state = stateByAccount.get(account.id) ?? null;
    const fr = frDivergence(consumptionByAccount.get(account.id) ?? []);
    return {
      accountId: account.id,
      provider: account.accountType as EnergyProvider,
      installationKey: account.enelId ?? account.edpUc ?? account.id,
      stationId: account.stationId,
      matchStatus: account.matchStatus,
      address: state?.address ?? null,
      neighborhood: state?.neighborhood ?? null,
      city: state?.city ?? null,
      billStatus: state?.billStatus ?? null,
      isStatusCarriedForward: state?.isStatusCarriedForward ?? false,
      lastBilling: state?.lastBilling ?? null,
      dueDate: state?.dueDate ?? null,
      autoDebit: state?.autoDebit ?? "desconhecido",
      autoDebitRegistration:
        state?.autoDebitRegistration ?? account.autoDebitRegistration,
      accountEmail: state?.accountEmail ?? null,
      negotiatedCount: state?.negotiatedInvoices.length ?? 0,
      negotiatedCompetencias: state?.negotiatedCompetencias ?? [],
      shutdownDate: state?.shutdownDate ?? null,
      firstSeenAt: state?.firstSeenAt ?? null,
      scrapedAt: state?.scrapedAt ?? null,
      frDivergencePct: fr.pct,
      frDivergenceMonth: fr.month,
      lat: state?.lat ?? null,
      lon: state?.lon ?? null,
    };
  });

  const chargeById = new Map(snapshot.charges.map((c) => [c.id, c]));
  const accountById = new Map(snapshot.billingAccounts.map((a) => [a.id, a]));

  const faturas: FaturaRow[] = [];
  for (const details of snapshot.chargeEnergyDetails) {
    const charge = chargeById.get(details.chargeId);
    if (!charge) continue;
    const account =
      charge.billingAccountId !== null
        ? accountById.get(charge.billingAccountId)
        : undefined;
    if (
      !account ||
      (account.accountType !== ACCOUNT_TYPE.energyEnel &&
        account.accountType !== ACCOUNT_TYPE.energyEdp)
    ) {
      continue;
    }
    const state = stateByAccount.get(account.id);
    faturas.push({
      chargeId: charge.id,
      provider: account.accountType as EnergyProvider,
      installationKey: account.enelId ?? account.edpUc ?? account.id,
      stationId: charge.stationId,
      matchStatus: charge.matchStatus,
      source: charge.source,
      competencia: charge.competencia,
      dueDate: charge.dueDate,
      amount: charge.amount,
      nf: details.nf,
      tusdKwh: details.tusdKwh,
      tusdAmount: details.tusdAmount,
      teKwh: details.teKwh,
      teAmount: details.teAmount,
      cip: details.cip,
      total: details.total,
      leituraAnterior: details.leituraAnterior,
      leituraAtual: details.leituraAtual,
      tariffClass: tariffClass(details),
      fiscalExported: details.fiscalExported,
      autoDebit: state?.autoDebit ?? "desconhecido",
      autoDebitRegistration:
        state?.autoDebitRegistration ?? account.autoDebitRegistration,
      hasComprovante: Boolean(state?.ultimoComprovante),
      comprovanteDate: state?.ultimoComprovanteDate ?? null,
      // dedupe_key join works on both backends; uuid join when id IS the uuid
      payment: summarizeLinks(
        links.byDedupeKey.get(charge.dedupeKey) ??
          links.byChargeUuid.get(charge.id),
      ),
      faturaDriveUrl: details.faturaDriveUrl,
    });
  }

  return { instalacoes, faturas };
}

/** Best-effort operator check for the manual-bill write gate (fails closed). */
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

async function EnergiaContent() {
  let snapshot: LoadedSnapshot;
  let freshness: FreshnessInfo;
  try {
    const repo = getRepository();
    [snapshot, freshness] = await Promise.all([
      repo.getSnapshot(),
      repo.getFreshness(),
    ]);
  } catch {
    return (
      <>
        <PageHeader
          title="Energia"
          description="Instalações e faturas de energia — Enel e EDP"
        />
        <Alert variant="destructive">
          <CircleAlert strokeWidth={2} />
          <AlertTitle>Não foi possível carregar os dados de energia</AlertTitle>
          <AlertDescription>
            Falha ao ler a planilha do scraper. Recarregue a página para tentar
            novamente.
          </AlertDescription>
        </Alert>
      </>
    );
  }

  const [accounts, canWrite, paymentLinks] = await Promise.all([
    readEnergyAccounts(),
    currentIsOperator(),
    readPaymentLinks(),
  ]);
  const { instalacoes, faturas } = buildRows(snapshot, paymentLinks);

  return (
    <>
      <PageHeader
        title="Energia"
        description="Instalações e faturas de energia — Enel e EDP"
        actions={
          <div className="flex flex-col items-end gap-0.5">
            <FreshnessDot
              label="Enel"
              timestamp={freshness.byProvider.enel.maxScrapedAt}
            />
            <FreshnessDot
              label="EDP"
              timestamp={freshness.byProvider.edp.maxScrapedAt}
              warnHours={EDP_WARN_HOURS}
              criticalHours={EDP_CRITICAL_HOURS}
            />
          </div>
        }
      />
      <EnergiaTabs
        instalacoes={instalacoes}
        faturas={faturas}
        accounts={accounts}
        canWrite={canWrite}
      />
    </>
  );
}

function EnergiaSkeleton() {
  return (
    <>
      <div className="flex items-start justify-between pb-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-24" />
        </div>
      </div>
      <Skeleton className="mb-3 h-8 w-56" />
      <DataTableSkeleton />
    </>
  );
}

export default function EnergiaPage() {
  return (
    <Suspense fallback={<EnergiaSkeleton />}>
      <EnergiaContent />
    </Suspense>
  );
}
