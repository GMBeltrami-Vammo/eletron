"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Alert variant="destructive">
      <TriangleAlert strokeWidth={2} />
      <AlertTitle>Erro ao carregar as configurações</AlertTitle>
      <AlertDescription>
        Não foi possível carregar os dados de saúde da ingestão. Tente
        novamente em instantes.
        {error.digest ? (
          <span className="mt-1 block text-xs">Ref: {error.digest}</span>
        ) : null}
      </AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={reset}>
          <RotateCcw className="size-4" strokeWidth={2} />
          Tentar novamente
        </Button>
      </AlertAction>
    </Alert>
  );
}
