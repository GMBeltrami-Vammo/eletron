"use server";

/**
 * Read-only server action feeding the "Vincular documento" picker (feature D).
 * Thin wrapper over the server-only reader (same shape as the comprovantes
 * fetchOpenCharges wrapper).
 */

import {
  readSourceDocuments,
  type SourceDocumentOption,
} from "@/lib/data/source-documents";

export async function fetchSourceDocuments(): Promise<SourceDocumentOption[]> {
  return readSourceDocuments();
}
