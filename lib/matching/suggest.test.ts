/**
 * Matching-suggestion tests (R4): haversine accuracy, ranked candidates,
 * confidence + auto-match thresholds (20 m / 100 m), coordinate-less handling.
 */

import { describe, expect, it } from "vitest";

import {
  AUTO_MATCH_THRESHOLD_M,
  HIGH_CONFIDENCE_M,
  haversineMeters,
  suggestStations,
  type GeoStation,
} from "./suggest";

describe("haversineMeters", () => {
  it("is ~0 for identical points", () => {
    expect(haversineMeters(-23.5, -46.6, -23.5, -46.6)).toBeCloseTo(0, 5);
  });

  it("matches a known short distance (~157 m per 0.001° lat in SP)", () => {
    const d = haversineMeters(-23.5, -46.6, -23.501, -46.6);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120); // ~111 m
  });
});

describe("suggestStations", () => {
  const base = { lat: -23.55052, lon: -46.633308 }; // Sé, SP
  const stations: GeoStation[] = [
    { id: 1, name: "Muito perto", address: "a", lat: -23.550515, lon: -46.633308 }, // ~1 m
    { id: 2, name: "Perto", address: "b", lat: -23.5510, lon: -46.6333 }, // ~53 m
    { id: 3, name: "Média", address: "c", lat: -23.5520, lon: -46.6333 }, // ~165 m
    { id: 4, name: "Longe", address: "d", lat: -23.60, lon: -46.70 }, // km
    { id: 5, name: "Sem coord", address: "e", lat: null, lon: null },
  ];

  it("ranks nearest-first and caps at the limit", () => {
    const out = suggestStations(base.lat, base.lon, stations, 3);
    expect(out.map((c) => c.stationId)).toEqual([1, 2, 3]);
    expect(out[0].distanceM).toBeLessThan(out[1].distanceM);
  });

  it("flags auto-match ≤20 m and high confidence <100 m", () => {
    const out = suggestStations(base.lat, base.lon, stations, 5);
    const near = out.find((c) => c.stationId === 1)!;
    const mid = out.find((c) => c.stationId === 3)!;
    const far = out.find((c) => c.stationId === 4)!;
    expect(near.autoMatch).toBe(true);
    expect(near.distanceM).toBeLessThanOrEqual(AUTO_MATCH_THRESHOLD_M);
    expect(mid.autoMatch).toBe(false);
    expect(mid.confidence).toBe(far.distanceM < HIGH_CONFIDENCE_M ? "high" : "low");
    expect(far.confidence).toBe("low");
  });

  it("skips stations without coordinates", () => {
    const out = suggestStations(base.lat, base.lon, stations, 5);
    expect(out.map((c) => c.stationId)).not.toContain(5);
  });

  it("returns nothing when the account has no coordinates", () => {
    expect(suggestStations(null, -46.6, stations)).toEqual([]);
    expect(suggestStations(-23.5, null, stations)).toEqual([]);
  });
});
