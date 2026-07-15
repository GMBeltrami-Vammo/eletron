"use client";

/**
 * Fiscal-lock warning (#24): shown before editing a charge already "enviada ao
 * fiscal". In the test env any @vammo.com may proceed (roles suspended, #26) —
 * the change is still audited. See lib/permissions/fiscal-lock.ts.
 */

import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FISCAL_LOCK_MESSAGE,
  FISCAL_LOCK_TITLE,
  viewerCanApproveFiscalEdit,
} from "@/lib/permissions/fiscal-lock";

export function FiscalLockDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const canApprove = viewerCanApproveFiscalEdit();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert className="size-5 text-warning-emphasis" strokeWidth={2} />
            {FISCAL_LOCK_TITLE}
          </DialogTitle>
          <DialogDescription>{FISCAL_LOCK_MESSAGE}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={onConfirm} disabled={pending || !canApprove}>
            Prosseguir mesmo assim
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
