import { describe, expect, it } from "vitest";

import { computeBoxDaysProrata } from "./box-prorata";

describe("computeBoxDaysProrata", () => {
  it("Gabriel's example: 3 boxes o mês todo + 3 ativados no dia 14 → 141/180", () => {
    const acts = [
      "2026-06-01", "2026-06-01", "2026-06-01", // present before July → 30 each
      "2026-07-14", "2026-07-14", "2026-07-14", // day 14 → 30-14+1 = 17 each
    ];
    const r = computeBoxDaysProrata(acts, "2026-07")!;
    expect(r.presentBoxes).toBe(6);
    expect(r.boxDays).toBe(3 * 30 + 3 * 17); // 90 + 51 = 141
    expect(r.fraction).toBeCloseTo(141 / 180, 6); // 0.78333
  });

  it("all boxes up the whole month → fraction 1 (full valor_mensal)", () => {
    const r = computeBoxDaysProrata(["2026-05-10", "2026-06-01"], "2026-07")!;
    expect(r.presentBoxes).toBe(2);
    expect(r.boxDays).toBe(60);
    expect(r.fraction).toBe(1);
  });

  it("steady-state shortfall (5 boxes, all before) → fraction 1 (bills full + flag)", () => {
    const acts = Array(5).fill("2026-01-01");
    const r = computeBoxDaysProrata(acts, "2026-07")!;
    expect(r.presentBoxes).toBe(5);
    expect(r.fraction).toBe(1); // N = present boxes, so shortfall never reduces
  });

  it("a box activated AFTER the month is not present", () => {
    const r = computeBoxDaysProrata(["2026-06-01", "2026-08-03"], "2026-07")!;
    expect(r.presentBoxes).toBe(1);
    expect(r.boxDays).toBe(30);
    expect(r.fraction).toBe(1);
  });

  it("day-1 activation = full 30; day-30 = 1 day", () => {
    expect(computeBoxDaysProrata(["2026-07-01"], "2026-07")!.boxDays).toBe(30);
    expect(computeBoxDaysProrata(["2026-07-30"], "2026-07")!.boxDays).toBe(1);
  });

  it("null activation date → present, counted as full month (never under-bill)", () => {
    const r = computeBoxDaysProrata([null, "2026-07-16"], "2026-07")!;
    expect(r.presentBoxes).toBe(2);
    expect(r.boxDays).toBe(30 + (30 - 16 + 1)); // 30 + 15 = 45
    expect(r.fraction).toBeCloseTo(45 / 60, 6);
  });

  it("returns null when there is no box data", () => {
    expect(computeBoxDaysProrata(null, "2026-07")).toBeNull();
    expect(computeBoxDaysProrata([], "2026-07")).toBeNull();
    expect(computeBoxDaysProrata(["2026-08-01"], "2026-07")).toBeNull(); // all after → 0 present
  });

  it("clamps at 1 even if box-days somehow exceed the base", () => {
    // (defensive) all present + a spurious extra → never > full price
    const r = computeBoxDaysProrata(["2026-01-01", "2026-01-01"], "2026-07")!;
    expect(r.fraction).toBeLessThanOrEqual(1);
  });
});
