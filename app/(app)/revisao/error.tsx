"use client";

import { RouteError } from "@/components/revisao/route-error";

export default function RevisaoError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      title="Não foi possível carregar as filas de revisão"
      reset={reset}
    />
  );
}
