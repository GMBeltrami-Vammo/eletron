/**
 * Matching-suggestion tests (R4): haversine accuracy, ranked candidates,
 * confidence + auto-match thresholds (20 m / 100 m), coordinate-less handling.
 */

import { describe, expect, it } from "vitest";

import {
  AUTO_MATCH_THRESHOLD_M,
  HIGH_CONFIDENCE_M,
  addressSimilarity,
  haversineMeters,
  normalizeAddressTokens,
  suggestByAddress,
  suggestMatches,
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
    expect(out[0].distanceM!).toBeLessThan(out[1].distanceM!);
    expect(out.every((c) => c.method === "geo")).toBe(true);
  });

  it("flags auto-match ≤20 m and high confidence <100 m", () => {
    const out = suggestStations(base.lat, base.lon, stations, 5);
    const near = out.find((c) => c.stationId === 1)!;
    const mid = out.find((c) => c.stationId === 3)!;
    const far = out.find((c) => c.stationId === 4)!;
    expect(near.autoMatch).toBe(true);
    expect(near.distanceM).toBeLessThanOrEqual(AUTO_MATCH_THRESHOLD_M);
    expect(mid.autoMatch).toBe(false);
    expect(mid.confidence).toBe(far.distanceM! < HIGH_CONFIDENCE_M ? "high" : "low");
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

describe("normalizeAddressTokens", () => {
  it("deaccents, lowercases, and drops street-type/city stopwords", () => {
    // "São Paulo", "Rua", "SP", connectors dropped; street name + number kept
    expect(normalizeAddressTokens("Rua Sapopemba, 13456 - São Paulo - SP")).toEqual([
      "sapopemba",
      "13456",
    ]);
  });

  it("returns [] for empty/nullish", () => {
    expect(normalizeAddressTokens(null)).toEqual([]);
    expect(normalizeAddressTokens("  ")).toEqual([]);
  });
});

describe("addressSimilarity", () => {
  it("scores a same-street+number pair high and unrelated pairs at zero", () => {
    const same = addressSimilarity(
      "AV SAPOPEMBA 13456 SAO PAULO - SP",
      "Av. Sapopemba, 13456 - São Paulo",
    );
    expect(same).toBeGreaterThanOrEqual(0.5);
    // different street/number, only city tokens (stripped) in common → 0
    expect(
      addressSimilarity(
        "AV SAPOPEMBA 13456 SAO PAULO - SP",
        "R. Iaptus, 16 - São Mateus - São Paulo - SP",
      ),
    ).toBe(0);
  });

  it("is 0 when either side is empty", () => {
    expect(addressSimilarity(null, "Rua X, 1")).toBe(0);
    expect(addressSimilarity("Rua X, 1", "")).toBe(0);
  });
});

describe("suggestByAddress", () => {
  const stations: GeoStation[] = [
    { id: 10, name: "Sapopemba", address: "Av. Sapopemba, 13456 - São Paulo", lat: null, lon: null },
    { id: 11, name: "Iaptus", address: "R. Iaptus, 16 - São Mateus", lat: null, lon: null },
    { id: 12, name: "Sem endereço", address: null, lat: null, lon: null },
  ];

  it("ranks by address similarity and tags method='address'", () => {
    const out = suggestByAddress("AV SAPOPEMBA 13456 SAO PAULO SP", stations, 3);
    expect(out[0].stationId).toBe(10);
    expect(out[0].method).toBe("address");
    expect(out[0].distanceM).toBeNull();
    expect(out[0].addressScore).toBeGreaterThan(0);
    expect(out[0].autoMatch).toBe(false); // address never auto-links
  });

  it("filters out sub-threshold noise and empty-address stations", () => {
    const out = suggestByAddress("Rua Totalmente Diferente, 999", stations, 3);
    expect(out).toEqual([]);
  });

  it("returns [] when the account has no address", () => {
    expect(suggestByAddress(null, stations)).toEqual([]);
  });
});

describe("suggestMatches (geo-first, address fallback)", () => {
  const stations: GeoStation[] = [
    { id: 1, name: "Perto", address: "Av. Sapopemba, 13456", lat: -23.5505, lon: -46.6333 },
    { id: 2, name: "Longe", address: "R. Outra, 9", lat: -23.7, lon: -46.9 },
  ];

  it("uses geodesic when the account has coordinates", () => {
    const out = suggestMatches(
      { lat: -23.5505, lon: -46.6333, address: "qualquer" },
      stations,
      3,
    );
    expect(out[0].method).toBe("geo");
    expect(out[0].stationId).toBe(1);
  });

  it("falls back to address when the account has no coordinates", () => {
    const out = suggestMatches(
      { lat: null, lon: null, address: "AV SAPOPEMBA 13456 SAO PAULO" },
      stations,
      3,
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].method).toBe("address");
    expect(out[0].stationId).toBe(1);
  });

  it("returns [] when neither coordinates nor a usable address match", () => {
    expect(
      suggestMatches({ lat: null, lon: null, address: null }, stations, 3),
    ).toEqual([]);
  });
});
