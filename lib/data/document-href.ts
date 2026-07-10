/**
 * resolveDocumentHref — the single source of truth for "where do I open a
 * charge's SOURCE bill (boleto/fatura/nota)?" used by the /pagamentos
 * "Documento de origem" column (feature D).
 *
 * Two mechanisms, deliberately distinct (see the design spec + decision #17):
 *  - a charge bound to a `charging.documents` row (rent/manual/webhook boletos)
 *    is served through the session-checked proxy `/api/files/{documentId}`;
 *  - an energy fatura has no documents row — its PDF is a raw Drive link parsed
 *    from the scraper's `link_fatura` into `charge_energy_details.faturaDriveUrl`.
 *
 * The proxy wins when both exist (internal, session-gated). Returns null when
 * neither is present, so the cell renders "—". Pure + unit-tested.
 */
export function resolveDocumentHref(
  sourceDocumentId: string | null,
  faturaDriveUrl: string | null,
): string | null {
  if (sourceDocumentId) return `/api/files/${sourceDocumentId}`;
  if (faturaDriveUrl) return faturaDriveUrl;
  return null;
}
