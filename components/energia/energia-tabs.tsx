"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { FaturasTable } from "./faturas-table";
import { InstalacoesTable } from "./instalacoes-table";
import type { EnergyAccountOption, FaturaRow, InstalacaoRow } from "./types";

/** /energia — 'Instalações' (per enel_id/UC) + 'Faturas' (invoice ledger). */
export function EnergiaTabs({
  instalacoes,
  faturas,
  accounts,
  canWrite,
}: {
  instalacoes: InstalacaoRow[];
  faturas: FaturaRow[];
  accounts: EnergyAccountOption[];
  canWrite: boolean;
}) {
  return (
    <Tabs defaultValue="instalacoes">
      <TabsList>
        <TabsTrigger value="instalacoes">
          Instalações
          <span className="text-xs tabular-nums text-muted-foreground">
            {instalacoes.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="faturas">
          Faturas
          <span className="text-xs tabular-nums text-muted-foreground">
            {faturas.length}
          </span>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="instalacoes" className="mt-3">
        <InstalacoesTable rows={instalacoes} />
      </TabsContent>
      <TabsContent value="faturas" className="mt-3">
        <FaturasTable rows={faturas} accounts={accounts} canWrite={canWrite} />
      </TabsContent>
    </Tabs>
  );
}
