import "server-only";

/**
 * Scoped googleapis JWT clients built from `GSHEETS_SA_KEY_B64` for the Phase 2
 * WRITE surfaces:
 *  - `getDriveClient()`  — Drive v3, scope `.../auth/drive` (upload photos,
 *    comprovantes, manual-bill PDFs; proxy downloads).
 *  - `getSheetsRwClient()` — Sheets v4, scope `.../auth/spreadsheets` (append
 *    manual-bill rows to Faturas_ENEL/EDP — the writeback outbox).
 *
 * The read-only Sheets loader (lib/ingest/sheets-loader.ts) keeps its own
 * narrow-scope client and is untouched.
 */

import { google, type drive_v3, type sheets_v4 } from "googleapis";
import { parseServiceAccountKey } from "./service-account";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const SHEETS_RW_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

function jwtAuth(scopes: string[]): InstanceType<typeof google.auth.JWT> {
  const b64 = process.env.GSHEETS_SA_KEY_B64;
  if (!b64) throw new Error("GSHEETS_SA_KEY_B64 not configured");
  const key = parseServiceAccountKey(b64);
  return new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes,
  });
}

/** Drive v3 client with read/write scope (service account). */
export function getDriveClient(): drive_v3.Drive {
  return google.drive({ version: "v3", auth: jwtAuth([DRIVE_SCOPE]) });
}

/** Sheets v4 client with read/write scope (service account). */
export function getSheetsRwClient(): sheets_v4.Sheets {
  return google.sheets({ version: "v4", auth: jwtAuth([SHEETS_RW_SCOPE]) });
}
