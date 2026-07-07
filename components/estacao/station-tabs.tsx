"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Station360 } from "@/lib/data/repository";

import { DocumentsTab } from "./documents-tab";
import { EnergyTab } from "./energy-tab";
import { HistoryTab } from "./history-tab";
import { OverviewTab } from "./overview-tab";
import { PaymentsTab } from "./payments-tab";
import { ReadingsTab } from "./readings-tab";
import { RentTab } from "./rent-tab";

const TABS = [
  { value: "visao-geral", label: "Visão geral" },
  { value: "energia", label: "Energia" },
  { value: "aluguel", label: "Aluguel" },
  { value: "pagamentos", label: "Pagamentos" },
  { value: "leituras", label: "Leituras" },
  { value: "documentos", label: "Documentos" },
  { value: "historico", label: "Histórico" },
] as const;

export function StationTabs({
  data,
  fetchedAt,
}: {
  data: Station360;
  fetchedAt: string;
}) {
  return (
    <Tabs defaultValue="visao-geral">
      <div className="overflow-x-auto pb-1">
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="px-3">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value="visao-geral">
        <OverviewTab data={data} fetchedAt={fetchedAt} />
      </TabsContent>
      <TabsContent value="energia">
        <EnergyTab data={data} fetchedAt={fetchedAt} />
      </TabsContent>
      <TabsContent value="aluguel">
        <RentTab data={data} fetchedAt={fetchedAt} />
      </TabsContent>
      <TabsContent value="pagamentos">
        <PaymentsTab data={data} />
      </TabsContent>
      <TabsContent value="leituras">
        <ReadingsTab stationId={data.station.id} />
      </TabsContent>
      <TabsContent value="documentos">
        <DocumentsTab data={data} />
      </TabsContent>
      <TabsContent value="historico">
        <HistoryTab data={data} />
      </TabsContent>
    </Tabs>
  );
}
