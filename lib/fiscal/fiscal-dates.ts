/**
 * Pure fiscal date helpers — NO imports, so both the server send (fiscal-row.ts
 * → fiscal-sheet.ts → sheets-loader server-only) AND client components (the
 * locação simulação dialog) can use them without dragging server-only code into
 * the client bundle. One canonical definition (extracted from fiscal-row.ts).
 */

/** ISO 'YYYY-MM-DD' → 'DD/MM/YYYY' (returns the input unchanged if it doesn't match). */
export function formatDueDateBR(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Today in São Paulo as ISO 'YYYY-MM-DD' (the fiscal day). */
export function fiscalTodayISO(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
