/**
 * Station matching suggestions (Phase 2.5 R4, request 6; scraper feed #34) — the
 * in-app equivalent of Vammo-Enel's "match semanal", replacing the Slack loop.
 * Two methods, one shape (`MatchCandidate`):
 *   - GEODESIC (`suggestStations`): when the account has concessionária lat/lon,
 *     rank the nearest stations by great-circle distance. Thresholds mirror the
 *     scraper: AUTO_MATCH_THRESHOLD_M = 20 m, HIGH_CONFIDENCE_M = 100 m.
 *   - ADDRESS (`suggestByAddress`): when the account has NO coordinates — the
 *     usual case for a fresh scraper-feed installation, which sends `address`
 *     but not lat/lon — rank stations by normalized address-token similarity.
 * `suggestMatches` picks geodesic when coordinates exist, else falls back to
 * address. Pure + unit-tested; the screen renders Confirmar / Escolher outra /
 * Não é Vammo. No candidate is ever auto-linked in the app — a human confirms.
 */

export const AUTO_MATCH_THRESHOLD_M = 20;
export const HIGH_CONFIDENCE_M = 100;
/** Address-similarity thresholds (0..1 Jaccard over normalized tokens). */
export const HIGH_ADDRESS_SCORE = 0.5;
export const MIN_ADDRESS_SCORE = 0.2;
const EARTH_RADIUS_M = 6_371_000;

export type MatchMethod = "geo" | "address";

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
  method: MatchMethod;
  /** metres — geodesic candidates only; null for address matches. */
  distanceM: number | null;
  /** 0..1 token similarity — address candidates only; null for geodesic. */
  addressScore: number | null;
  confidence: "high" | "low";
  /** distance ≤ 20 m (geodesic only) — safe to auto-link; always false for address. */
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
      method: "geo",
      distanceM,
      addressScore: null,
      confidence: distanceM < HIGH_CONFIDENCE_M ? "high" : "low",
      autoMatch: distanceM <= AUTO_MATCH_THRESHOLD_M,
    });
  }
  scored.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
  return scored.slice(0, limit);
}

// ── address-similarity fallback (no coordinates) ────────────────────────────

/**
 * Tokens that carry no discriminating signal for SP-metro station matching:
 * connectors, the ubiquitous city/state, and street-type words. Stripping them
 * keeps the street name + house number + neighbourhood — the parts that
 * actually distinguish one installation from another.
 */
const ADDRESS_STOPWORDS = new Set([
  "de", "da", "do", "dos", "das", "e", "n", "no", "na", "s",
  "sp", "sao", "paulo", "brasil", "br", "cep",
  "rua", "r", "av", "avenida", "al", "alameda", "tv", "travessa",
  "estr", "estrada", "rod", "rodovia", "pca", "praca", "largo", "via", "viela",
]);

/** Deaccented, lowercased, punctuation-stripped, stop-worded, de-duplicated tokens. */
export function normalizeAddressTokens(addr: string | null | undefined): string[] {
  if (!addr) return [];
  const deaccented = addr.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const cleaned = deaccented.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const toks = cleaned
    .split(" ")
    .filter((t) => t.length >= 2 && !ADDRESS_STOPWORDS.has(t));
  return [...new Set(toks)];
}

/** 0..1 Jaccard similarity of two address token-sets, + a boost for a shared house number. */
export function addressSimilarity(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const ta = normalizeAddressTokens(a);
  const tb = normalizeAddressTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const sb = new Set(tb);
  let inter = 0;
  for (const t of ta) if (sb.has(t)) inter++;
  const union = ta.length + tb.length - inter;
  let score = union === 0 ? 0 : inter / union;
  // a shared multi-digit number (house number / CEP) is strong evidence
  const numsB = new Set(tb.filter((t) => /^\d{2,}$/.test(t)));
  if (ta.some((t) => /^\d{2,}$/.test(t) && numsB.has(t))) {
    score = Math.min(1, score + 0.15);
  }
  return score;
}

/**
 * Top-`limit` stations by address similarity to `address`, best first. Returns
 * [] when the account has no address or nothing clears MIN_ADDRESS_SCORE.
 */
export function suggestByAddress(
  address: string | null | undefined,
  stations: GeoStation[],
  limit = 3,
): MatchCandidate[] {
  if (!address) return [];
  const scored: MatchCandidate[] = [];
  for (const s of stations) {
    const score = addressSimilarity(address, s.address);
    if (score < MIN_ADDRESS_SCORE) continue;
    scored.push({
      stationId: s.id,
      stationName: s.name,
      address: s.address,
      method: "address",
      distanceM: null,
      addressScore: score,
      confidence: score >= HIGH_ADDRESS_SCORE ? "high" : "low",
      autoMatch: false,
    });
  }
  scored.sort((a, b) => (b.addressScore ?? 0) - (a.addressScore ?? 0));
  return scored.slice(0, limit);
}

/**
 * The account's best candidates: geodesic when it has coordinates, else the
 * address fallback (the common case for a fresh scraper-feed installation).
 */
export function suggestMatches(
  account: { lat: number | null; lon: number | null; address: string | null },
  stations: GeoStation[],
  limit = 3,
): MatchCandidate[] {
  const geo = suggestStations(account.lat, account.lon, stations, limit);
  if (geo.length > 0) return geo;
  return suggestByAddress(account.address, stations, limit);
}
