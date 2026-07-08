/**
 * Parses the base64 service-account JSON in `GSHEETS_SA_KEY_B64`.
 *
 * NOTE: `lib/ingest/sheets-loader.ts` (the committed read-only Sheets loader)
 * keeps its own private copy of this logic and is intentionally NOT touched by
 * this workstream. This module is the shared parser for the new read/WRITE
 * Google clients (Drive + Sheets RW); the duplication is deliberate and
 * documented — the loader is a frozen input here.
 */

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

/** True when `GSHEETS_SA_KEY_B64` is present (does not validate its shape). */
export function serviceAccountEnvPresent(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(env.GSHEETS_SA_KEY_B64);
}

/** Decodes + validates the base64 service-account JSON. Throws on bad input. */
export function parseServiceAccountKey(b64: string): ServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch (err) {
    throw new Error(
      `GSHEETS_SA_KEY_B64 is not valid base64-encoded JSON: ${String(err)}`,
    );
  }
  const key = parsed as Partial<ServiceAccountKey>;
  if (
    typeof key.client_email !== "string" ||
    typeof key.private_key !== "string"
  ) {
    throw new Error("GSHEETS_SA_KEY_B64 JSON is missing client_email/private_key");
  }
  return { client_email: key.client_email, private_key: key.private_key };
}
