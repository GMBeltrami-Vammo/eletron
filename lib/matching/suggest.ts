/**
 * Geodesic matching suggestions (Phase 2.5 R4, request 6) — the in-app
 * equivalent of Vammo-Enel's "match semanal": for an unmatched energy account
 * (with concessionária lat/lon) rank the nearest stations by great-circle
 * distance and flag confidence. Mirrors the scraper's thresholds:
 *   AUTO_MATCH_THRESHOLD_M = 20 m  (safe to auto-link)
 *   HIGH_CONFIDENCE_M      = 100 m ("High" in the weekly loop)
 *
 * Pure + unit-tested; the screen feeds it station/account coordinates from the
 * snapshot and renders the Confirmar / Escolher outra / Não é Vammo controls.
 * Frozen-data caveat (H5): the account coordinates come from the last scrape,
 * so this is a backlog-cleanup tool until a scraper→Supabase feed returns.
 */

export const AUTO_MATCH_THRESHOLD_M = 20;
export const HIGH_CONFIDENCE_M = 100;
const EARTH_RADIUS_M = 6_371_000;

export interface GeoStation {
  id: number;
  name: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
}

export interface MatchCandidate {
  stationId: number;
  stationName: string | null;
  address: string | null;
  distanceM: number;
  confidence: "high" | "low";
  /** distance ≤ 20 m — safe to auto-link. */
  autoMatch: boolean;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in metres (haversine). */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hasCoords(s: GeoStation): s is GeoStation & { lat: number; lon: number } {
  return s.lat !== null && s.lon !== null && Number.isFinite(s.lat) && Number.isFinite(s.lon);
}

/**
 * Top-`limit` nearest stations to (accountLat, accountLon), nearest first.
 * Returns [] when the account has no coordinates (nothing to suggest).
 */
export function suggestStations(
  accountLat: number | null,
  accountLon: number | null,
  stations: GeoStation[],
  limit = 3,
): MatchCandidate[] {
  if (
    accountLat === null ||
    accountLon === null ||
    !Number.isFinite(accountLat) ||
    !Number.isFinite(accountLon)
  ) {
    return [];
  }
  const scored: MatchCandidate[] = [];
  for (const s of stations) {
    if (!hasCoords(s)) continue;
    const distanceM = haversineMeters(accountLat, accountLon, s.lat, s.lon);
    scored.push({
      stationId: s.id,
      stationName: s.name,
      address: s.address,
      distanceM,
      confidence: distanceM < HIGH_CONFIDENCE_M ? "high" : "low",
      autoMatch: distanceM <= AUTO_MATCH_THRESHOLD_M,
    });
  }
  scored.sort((a, b) => a.distanceM - b.distanceM);
  return scored.slice(0, limit);
}
