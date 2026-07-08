"use server";

/**
 * Meter-reading write actions (decision P3, C3). The photo is uploaded first via
 * `POST /api/uploads/meter-photo`; these actions reference the returned
 * `photoDocumentId`. The RPC sets the reading's `read_by_email` from the session
 * (never a param) and copies EXIF off the photo document.
 */

import { revalidatePath } from "next/cache";

import { revalidateSnapshot } from "@/lib/data/repository.server";
import { unwrapRpc, withOperator, type ActionResult } from "@/lib/http/actions";

export interface CreateMeterReadingInput {
  /** swap_station_id (integer PK). */
  stationId: number;
  /** charging billing_account uuid — only when the station has >1 metered account (M14). */
  billingAccountId?: string | null;
  /** Editable label; default `{stationId} - {address}` (C3). */
  name: string;
  /** ISO `YYYY-MM-DD`. */
  readingDate: string;
  readingKwh: number;
  /** `documents.id` of the mandatory meter photo (kind `foto_medidor`). */
  photoDocumentId: string;
  notes?: string | null;
}

/** Registers a meter reading. Returns the new reading uuid. */
export async function createMeterReading(
  input: CreateMeterReadingInput,
): Promise<ActionResult<string>> {
  return withOperator(async (client) => {
    const id = unwrapRpc(
      await client.rpc("create_meter_reading", {
        p_station_id: input.stationId,
        p_billing_account_id: input.billingAccountId ?? null,
        p_name: input.name,
        p_reading_date: input.readingDate,
        p_reading_kwh: input.readingKwh,
        p_photo_document_id: input.photoDocumentId,
        p_notes: input.notes ?? null,
      }),
    ) as string;
    revalidatePath("/leituras");
    await revalidateSnapshot();
    return id;
  });
}

export interface CorrectMeterReadingInput {
  /** Reading uuid being superseded. */
  readingId: string;
  readingDate: string;
  readingKwh: number;
  /** New photo document uuid. */
  photoDocumentId: string;
  name?: string | null;
  notes?: string | null;
}

/** Appends a corrected reading (supersedes the old row). Returns the new uuid. */
export async function correctMeterReading(
  input: CorrectMeterReadingInput,
): Promise<ActionResult<string>> {
  return withOperator(async (client) => {
    const id = unwrapRpc(
      await client.rpc("correct_meter_reading", {
        p_reading_id: input.readingId,
        p_reading_date: input.readingDate,
        p_reading_kwh: input.readingKwh,
        p_photo_document_id: input.photoDocumentId,
        p_name: input.name ?? null,
        p_notes: input.notes ?? null,
      }),
    ) as string;
    revalidatePath("/leituras");
    await revalidateSnapshot();
    return id;
  });
}
