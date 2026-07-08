/**
 * Screen-local pt-BR labels for the comprovantes UX. lib/labels.ts is the
 * canonical home for the shared domain enums (charge/match status), but the
 * receipt-type, processing-status and origem vocabularies are specific to this
 * screen set, and lib/** is outside its ownership — so they live here.
 */

import type { BadgeColor } from "@/components/vammo/status-badge";
import type {
  DocProcessingStatus,
  IngestSource,
  ReceiptType,
} from "@/lib/domain";

type LabelBadge = { label: string; color: BadgeColor };

/** charging.receipt_type → pt-BR label + badge color. */
export const RECEIPT_TYPE_UI: Record<ReceiptType, LabelBadge> = {
  pix: { label: "PIX", color: "green" },
  ted: { label: "TED", color: "blue" },
  debito_automatico: { label: "Débito automático", color: "brown" },
  boleto_barcode: { label: "Boleto", color: "grey" },
  outro: { label: "Outro", color: "grey" },
};

/** charging.doc_processing_status → inbox "Processamento" badge. */
export const PROCESSING_STATUS_UI: Record<DocProcessingStatus, LabelBadge> = {
  pending: { label: "Na fila", color: "grey" },
  processed: { label: "Concluído", color: "green" },
  needs_review: { label: "Revisar", color: "orange" },
  failed: { label: "Erro", color: "red" },
};

/** A document is still moving through the pipeline (drives the 5 s poll). */
export function isProcessingPending(status: DocProcessingStatus): boolean {
  return status === "pending";
}

/** Origem chip: distilled to Upload vs Drive vs the raw ingest label. */
export function origemLabel(source: IngestSource): string {
  switch (source) {
    case "app_upload":
      return "Upload";
    case "drive_poll":
      return "Drive";
    case "email_ai":
      return "E-mail";
    default:
      return "Outro";
  }
}
