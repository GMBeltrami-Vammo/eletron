"use client";

import { RouteError } from "@/components/revisao/route-error";

export default function AlertasError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="Não foi possível carregar os alertas" reset={reset} />;
}
