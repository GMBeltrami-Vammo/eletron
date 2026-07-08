import "server-only";

/**
 * Direct read of `charging.meter_readings` — the SupabaseRepository does NOT
 * cover meter readings (H3: documents/readings are read outside the Repository
 * interface). Reads run via the service client behind the calling server
 * component's @vammo.com gate. Live rows only (`is_superseded = false`; a
 * correction supersedes the old row).
 *
 * Degrades to `{ available: false, readings: [] }` when the Supabase env is
 * absent (dev / sheets backend) — the page shows a notice and still lists the
 * ACTIVE stations as candidates, never crashes.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

/** One live meter reading, JSON-serialized for the client view. */
export interface ReadingRow {
  id: string;
  stationId: number;
  billingAccountId: string | null;
  /** Editable label, default `{stationId} - {address}`. */
  name: string;
  /** ISO `YYYY-MM-DD`. */
  readingDate: string;
  /** ISO `YYYY-MM-01` — the month it counts toward. */
  competencia: string;
  readingKwh: number;
  photoDocumentId: string;
  readByEmail: string;
  notes: string | null;
  photoTakenAt: string | null;
  photoWarnings: string[];
  createdAt: string;
}

export interface ReadingsReadResult {
  /** False when the charging backend is unavailable (env missing / error). */
  available: boolean;
  readings: ReadingRow[];
}

interface RawReadingRow {
  id: string;
  station_id: number;
  billing_account_id: string | null;
  name: string | null;
  reading_date: string;
  competencia: string;
  reading_kwh: number | string | null;
  photo_document_id: string;
  read_by_email: string;
  notes: string | null;
  photo_taken_at: string | null;
  photo_warnings: string[] | null;
  created_at: string;
}

function toNumber(v: number | string | null): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export async function readMeterReadings(): Promise<ReadingsReadResult> {
  try {
    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("meter_readings")
      .select(
        "id, station_id, billing_account_id, name, reading_date, competencia, reading_kwh, photo_document_id, read_by_email, notes, photo_taken_at, photo_warnings, created_at",
      )
      .eq("is_superseded", false)
      .order("reading_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error || !data) return { available: false, readings: [] };

    const readings = (data as unknown as RawReadingRow[]).map(
      (r): ReadingRow => ({
        id: r.id,
        stationId: r.station_id,
        billingAccountId: r.billing_account_id,
        name: r.name ?? `${r.station_id}`,
        readingDate: r.reading_date.slice(0, 10),
        competencia: r.competencia.slice(0, 10),
        readingKwh: toNumber(r.reading_kwh),
        photoDocumentId: r.photo_document_id,
        readByEmail: r.read_by_email,
        notes: r.notes,
        photoTakenAt: r.photo_taken_at,
        photoWarnings: Array.isArray(r.photo_warnings) ? r.photo_warnings : [],
        createdAt: r.created_at,
      }),
    );
    return { available: true, readings };
  } catch {
    return { available: false, readings: [] };
  }
}
