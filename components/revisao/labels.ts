import type { IngestSource } from "@/lib/domain";

/**
 * pt-BR labels for ingest sources — screen-local because lib/labels.ts does
 * not cover this enum yet (lib/** is outside this screen set's ownership).
 */
export const INGEST_SOURCE_LABEL: Record<IngestSource, string> = {
  scraper_enel: "Scraper Enel",
  scraper_edp: "Scraper EDP",
  email_ai: "E-mail (IA)",
  drive_poll: "Drive",
  manual: "Manual",
  metabase_sync: "Metabase",
  sheet_backfill: "Planilha",
  gerar_mes: "Gerar mês",
  auto_match: "Conciliação (auto)",
  app_upload: "Upload no app",
};

/** Display mask for normalized digits-only CNPJ/CPF (never an identity key). */
export function formatCnpjCpf(digits: string | null | undefined): string {
  if (!digits) return "—";
  if (digits.length === 14) {
    return digits.replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      "$1.$2.$3/$4-$5",
    );
  }
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  return digits;
}
