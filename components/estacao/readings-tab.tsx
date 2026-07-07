"use client";

import Link from "next/link";
import { Camera } from "lucide-react";

import { Button } from "@/components/ui/button";

import { EmptyState } from "./empty-state";

/** Meter readings: capture flow exists, persisted history arrives in Phase 2. */
export function ReadingsTab({ stationId }: { stationId: number }) {
  return (
    <EmptyState
      icon={Camera}
      title="Nenhuma leitura registrada"
      description="O histórico de leituras manuais fica disponível na fase 2. Você já pode iniciar uma captura pelo fluxo de nova leitura."
      action={
        <Button render={<Link href={`/leituras/nova?station=${stationId}`} />}>
          <Camera className="size-4" strokeWidth={2} aria-hidden />
          Nova leitura
        </Button>
      }
    />
  );
}
