import "server-only";

/**
 * Meter-photo processing (security-ops §5.7, decision P3): extract EXIF
 * (DateTimeOriginal + GPS) for verification, THEN re-encode with sharp to strip
 * EXIF and neutralize polyglot payloads. HEIC is decoded by `heic-convert`
 * first (D9 — sharp's prebuilt Vercel binary lacks HEIF decode).
 *
 * The returned `exif` object is stored verbatim in `documents.exif`; the
 * `create_meter_reading` RPC reads `taken_at` / `gps` / `warnings` off it.
 */

import convert from "heic-convert";
import { parse as exifrParse } from "exifr";
import sharp from "sharp";

/** Shape persisted to `documents.exif` (RPC reads these keys). */
export interface MeterPhotoExif {
  taken_at: string | null;
  gps: { lat: number; lon: number } | null;
  warnings: string[];
}

export interface ProcessedMeterPhoto {
  /** EXIF-stripped, orientation-baked JPEG. */
  buffer: Buffer;
  contentType: "image/jpeg";
  exif: MeterPhotoExif;
}

const STALE_HOURS = 24;
const GPS_MAX_METERS = 200;

/** Haversine distance in metres. */
function distanceMeters(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

interface RawExif {
  DateTimeOriginal?: unknown;
  CreateDate?: unknown;
  latitude?: unknown;
  longitude?: unknown;
}

async function readExif(buffer: Buffer): Promise<{
  takenAt: string | null;
  gps: { lat: number; lon: number } | null;
}> {
  try {
    const parsed = (await exifrParse(buffer, {
      tiff: true,
      exif: true,
      gps: true,
    })) as RawExif | undefined;
    if (!parsed) return { takenAt: null, gps: null };

    const dt = parsed.DateTimeOriginal ?? parsed.CreateDate;
    let takenAt: string | null = null;
    if (dt instanceof Date && !Number.isNaN(dt.getTime())) {
      takenAt = dt.toISOString();
    } else if (typeof dt === "string") {
      const d = new Date(dt);
      if (!Number.isNaN(d.getTime())) takenAt = d.toISOString();
    }

    const lat = typeof parsed.latitude === "number" ? parsed.latitude : null;
    const lon = typeof parsed.longitude === "number" ? parsed.longitude : null;
    const gps = lat !== null && lon !== null ? { lat, lon } : null;

    return { takenAt, gps };
  } catch {
    return { takenAt: null, gps: null };
  }
}

/**
 * Converts (if HEIC), extracts EXIF, re-encodes to a clean JPEG, and computes
 * non-blocking pt-BR verification warnings.
 */
export async function processMeterPhoto(opts: {
  buffer: Buffer;
  sniffedMime: string;
  stationLat?: number | null;
  stationLon?: number | null;
  now?: Date;
}): Promise<ProcessedMeterPhoto> {
  const now = opts.now ?? new Date();

  // EXIF is read from the ORIGINAL bytes (survives before any re-encode/convert).
  const { takenAt, gps } = await readExif(opts.buffer);

  // HEIC → JPEG before sharp (prebuilt sharp lacks HEIF decode).
  let jpegSource: Buffer = opts.buffer;
  if (opts.sniffedMime === "image/heic") {
    const out = await convert({
      buffer: new Uint8Array(opts.buffer),
      format: "JPEG",
      quality: 0.92,
    });
    jpegSource = Buffer.from(out);
  }

  // Re-encode: .rotate() bakes orientation; JPEG re-encode drops all EXIF.
  const buffer = await sharp(jpegSource).rotate().jpeg({ quality: 82 }).toBuffer();

  const warnings: string[] = [];
  if (!takenAt) {
    warnings.push("sem data de captura (EXIF ausente)");
  } else {
    const ageHours = (now.getTime() - new Date(takenAt).getTime()) / 3_600_000;
    if (ageHours > STALE_HOURS) {
      warnings.push(`foto tirada há mais de 24 h (${Math.round(ageHours)} h)`);
    }
  }
  if (!gps) {
    warnings.push("sem localização (GPS ausente)");
  } else if (
    typeof opts.stationLat === "number" &&
    typeof opts.stationLon === "number"
  ) {
    const d = distanceMeters(gps.lat, gps.lon, opts.stationLat, opts.stationLon);
    if (d > GPS_MAX_METERS) {
      warnings.push(`foto a mais de 200 m da estação (~${Math.round(d)} m)`);
    }
  }

  return {
    buffer,
    contentType: "image/jpeg",
    exif: { taken_at: takenAt, gps, warnings },
  };
}
