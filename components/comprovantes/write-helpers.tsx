"use client";

/**
 * Shared client-side write plumbing for the comprovantes screens:
 * - `useRunAction`  → runs a committed server action returning `ActionResult`,
 *   surfaces a Sonner toast, invalidates the given TanStack queries and calls
 *   `router.refresh()` (decision #7/#24: every write shows a toast + invalidate).
 * - `Gate`          → wraps a disabled write control in the "operador/admin"
 *   title tooltip when the viewer lacks the write role (role is server-checked
 *   in the RPC; this is only the affordance).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";

// Type-only import: `@/lib/http/actions` is `server-only`; `import type` is
// erased at build time so nothing server-only reaches the client bundle.
import type { ActionResult } from "@/lib/http/actions";

export const NOT_OPERATOR = "Requer papel operador ou admin";

export function useRunAction() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = React.useState(false);

  const run = React.useCallback(
    async <T,>(
      action: () => Promise<ActionResult<T>>,
      // success may derive from the action's data (e.g. "N descartadas")
      opts: { success: string | ((data: T) => string); invalidate?: QueryKey[] },
    ): Promise<boolean> => {
      setPending(true);
      try {
        const res = await action();
        if (res.ok) {
          toast.success(
            typeof opts.success === "function" ? opts.success(res.data) : opts.success,
          );
          opts.invalidate?.forEach((queryKey) =>
            queryClient.invalidateQueries({ queryKey }),
          );
          router.refresh();
          return true;
        }
        toast.error(res.error);
        return false;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha na operação");
        return false;
      } finally {
        setPending(false);
      }
    },
    [queryClient, router],
  );

  return { run, pending };
}

/** Wraps a (disabled) write control with the not-operator title when gated. */
export function Gate({
  isOperator,
  children,
}: {
  isOperator: boolean;
  children: React.ReactNode;
}) {
  if (isOperator) return <>{children}</>;
  return (
    <span title={NOT_OPERATOR} className="inline-flex cursor-not-allowed">
      {children}
    </span>
  );
}

// Pure mapping lives in its own JSX-free module (so pure code can import it);
// re-exported here for the existing client-side consumers.
export { paymentMethodForReceipt } from "./payment-method";
