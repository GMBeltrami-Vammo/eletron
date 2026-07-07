"use client";

import { AlertCircle } from "lucide-react";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Shared destructive error state for the alertas/revisao route segments. */
export function RouteError({
  title,
  reset,
}: {
  title: string;
  reset: () => void;
}) {
  return (
    <Alert variant="destructive" className="max-w-xl">
      <AlertCircle strokeWidth={2} />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        Não foi possível carregar os dados da planilha. Verifique sua conexão e
        tente novamente.
      </AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={reset}>
          Tentar novamente
        </Button>
      </AlertAction>
    </Alert>
  );
}
