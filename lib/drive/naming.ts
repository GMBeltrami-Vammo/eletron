/**
 * Drive filename builders — pure + test-importable. Mirror the Vammo-Enel
 * scraper's canonical names so the app and scraper converge on the same Drive
 * objects (enel_helpers.py `_pdf_filename`, edp_helpers.py `_edp_pdf_filename`).
 */

/** Strip Drive/sheet-hostile + control chars; keep accents and hyphens; collapse spaces. */
export function sanitizeDriveName(name: string): string {
  const noControl = Array.from(name)
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return c >= 0x20 && c !== 0x7f;
    })
    .join("");
  return noControl
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** `YYYY-MM-DD` (ISO or full ISO) -> `YYYY-MM`; '' when unparseable. */
export function monthTag(dueDateIso: string | null | undefined): string {
  if (!dueDateIso) return "";
  const m = dueDateIso.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : "";
}

/**
 * Meter-photo name: `{stationId} - {sanitized address} - {YYYY-MM-DD}.jpg`
 * (C3). `address` blank -> `sem endereco`.
 */
export function buildMeterPhotoName(
  stationId: number,
  address: string | null | undefined,
  isoDate: string,
): string {
  const addr = sanitizeDriveName(address ?? "") || "sem endereco";
  return `${stationId} - ${addr} - ${isoDate}.jpg`;
}

/**
 * Bill PDF name: `Fatura-Enel-{id}-{YYYY-MM}.pdf` / `Fatura-EDP-{uc}-{YYYY-MM}.pdf`
 * (scraper parity — note the `Enel`/`EDP` capitalization from the Python).
 */
export function buildBillPdfName(
  provider: "enel" | "edp",
  externalId: string,
  dueDateIso: string,
): string {
  const label = provider === "enel" ? "Enel" : "EDP";
  return `Fatura-${label}-${externalId}-${monthTag(dueDateIso)}.pdf`;
}

/** Inserts `suffix` before the file extension (`a.jpg` + ` -2` -> `a -2.jpg`). */
export function insertSuffixBeforeExt(name: string, suffix: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}${suffix}`;
  return `${name.slice(0, dot)}${suffix}${name.slice(dot)}`;
}

/** Meter-photo collision name: ` -2`, ` -3`, ... before `.jpg`. */
export function meterPhotoCollisionName(base: string, n: number): string {
  return insertSuffixBeforeExt(base, ` -${n}`);
}

/** Manual-bill collision name: `-manual-1`, `-manual-2`, ... before `.pdf`. */
export function billCollisionName(base: string, n: number): string {
  return insertSuffixBeforeExt(base, `-manual-${n}`);
}
