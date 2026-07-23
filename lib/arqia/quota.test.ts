import { describe, expect, it } from "vitest";

import {
  parseDataUnitMb,
  proRataQuotaMb,
  usagePct,
  monthElapsedPct,
} from "./quota";

describe("parseDataUnitMb", () => {
  it("converte unidades (base 1024)", () => {
    expect(parseDataUnitMb("300.00 MB")).toBeCloseTo(300);
    expect(parseDataUnitMb("1 GB")).toBeCloseTo(1024);
    expect(parseDataUnitMb("1024 KB")).toBeCloseTo(1);
    expect(parseDataUnitMb("500")).toBeCloseTo(500); // sem unidade → MB
  });
  it("degrada a 0 em entradas inválidas", () => {
    expect(parseDataUnitMb(null)).toBe(0);
    expect(parseDataUnitMb("")).toBe(0);
    expect(parseDataUnitMb("abc")).toBe(0);
  });
});

describe("proRataQuotaMb", () => {
  it("SIM de mês anterior conta a quota cheia DO CHIP (da API)", () => {
    const now = new Date(2026, 6, 15); // 15/jul/2026
    expect(proRataQuotaMb([{ firstSeenOn: "2026-05-28", quotaMb: 500 }], now)).toBe(500);
  });
  it("usa a quota própria de cada chip (500 aqui, não um valor fixo)", () => {
    const now = new Date(2026, 6, 15);
    const q = proRataQuotaMb(
      [
        { firstSeenOn: "2026-04-01", quotaMb: 500 },
        { firstSeenOn: "2026-04-01", quotaMb: 300 },
      ],
      now,
    );
    expect(q).toBe(800); // 500 + 300 — quotas distintas por chip
  });
  it("SIM criado no mês corrente pró-rateia a quota DO CHIP ((lastDay-day+2)/lastDay)", () => {
    const now = new Date(2026, 6, 20); // julho tem 31 dias
    // dia 10 → (31-10+2)/31 * 500 = 23/31*500 ≈ 370.97 → arredonda
    expect(proRataQuotaMb([{ firstSeenOn: "2026-07-10", quotaMb: 500 }], now)).toBe(
      Math.round((23 / 31) * 500),
    );
  });
  it("soma múltiplos SIMs (quota cheia quando de meses anteriores)", () => {
    const now = new Date(2026, 6, 20);
    const q = proRataQuotaMb(
      [
        { firstSeenOn: "2026-05-01", quotaMb: 500 },
        { firstSeenOn: "2026-06-15", quotaMb: 500 },
      ],
      now,
    );
    expect(q).toBe(1000);
  });
  it("quota ausente/0 do chip contribui 0 (não inventa valor)", () => {
    const now = new Date(2026, 6, 20);
    expect(proRataQuotaMb([{ firstSeenOn: "2026-05-01", quotaMb: 0 }], now)).toBe(0);
  });
  it("frota vazia = 0", () => {
    expect(proRataQuotaMb([], new Date(2026, 6, 20))).toBe(0);
  });
});

describe("usagePct / monthElapsedPct", () => {
  it("uso %", () => {
    expect(usagePct(150, 300)).toBe(50);
    expect(usagePct(10, 0)).toBe(0); // sem quota
  });
  it("mês decorrido %", () => {
    expect(monthElapsedPct(new Date(2026, 6, 31))).toBe(100); // último dia de julho
  });
});
