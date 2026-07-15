/**
 * dd/MM/aaaa date-field helpers (pure). The native <input type="date"> renders
 * in the browser's UI locale (mm/dd/yyyy on an en-US Chrome) regardless of the
 * page `lang`, so the app uses a masked text field that ALWAYS shows dd/MM/aaaa
 * and stores/returns ISO 'yyyy-MM-dd'. These helpers do the conversion + a
 * progressive input mask; kept pure so they're unit-testable.
 */

/** Progressive dd/MM/aaaa mask over raw input — keeps digits, inserts slashes. */
export function maskBrDate(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  const parts = [d.slice(0, 2), d.slice(2, 4), d.slice(4, 8)].filter(
    (p) => p.length > 0,
  );
  return parts.join("/");
}

/** ISO 'yyyy-MM-dd' (or full ISO datetime) → 'dd/MM/aaaa'; '' when empty/invalid. */
export function isoToBrDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * 'dd/MM/aaaa' → ISO 'yyyy-MM-dd', or null when incomplete / not a real calendar
 * date (rejects rollovers like 31/02). Used to emit the value only once complete.
 */
export function brToIsoDate(br: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1000) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() + 1 !== month ||
    dt.getUTCDate() !== day
  ) {
    return null; // e.g. 31/02 rolled over
  }
  return iso;
}
