import { describe, expect, it } from "vitest";

import { brToIsoDate, isoToBrDate, maskBrDate } from "./date-mask";

describe("maskBrDate", () => {
  it("inserts slashes progressively", () => {
    expect(maskBrDate("1")).toBe("1");
    expect(maskBrDate("15")).toBe("15");
    expect(maskBrDate("150")).toBe("15/0");
    expect(maskBrDate("1507")).toBe("15/07");
    expect(maskBrDate("15072")).toBe("15/07/2");
    expect(maskBrDate("15072026")).toBe("15/07/2026");
  });
  it("drops non-digits and caps at 8 digits", () => {
    expect(maskBrDate("15/07/2026")).toBe("15/07/2026");
    expect(maskBrDate("15072026999")).toBe("15/07/2026");
    expect(maskBrDate("ab15cd07")).toBe("15/07");
  });
  it("empty stays empty", () => {
    expect(maskBrDate("")).toBe("");
  });
});

describe("isoToBrDate", () => {
  it("ISO date → dd/MM/aaaa", () => {
    expect(isoToBrDate("2026-07-15")).toBe("15/07/2026");
    expect(isoToBrDate("2026-01-05")).toBe("05/01/2026");
  });
  it("tolerates a full ISO datetime", () => {
    expect(isoToBrDate("2026-07-15T12:00:00Z")).toBe("15/07/2026");
  });
  it("empty/invalid → ''", () => {
    expect(isoToBrDate("")).toBe("");
    expect(isoToBrDate(null)).toBe("");
    expect(isoToBrDate(undefined)).toBe("");
    expect(isoToBrDate("15/07/2026")).toBe("");
  });
});

describe("brToIsoDate", () => {
  it("complete valid date → ISO", () => {
    expect(brToIsoDate("15/07/2026")).toBe("2026-07-15");
    expect(brToIsoDate("05/01/2026")).toBe("2026-01-05");
    expect(brToIsoDate("29/02/2024")).toBe("2024-02-29"); // leap year
  });
  it("incomplete → null", () => {
    expect(brToIsoDate("15/07")).toBeNull();
    expect(brToIsoDate("15/07/20")).toBeNull();
    expect(brToIsoDate("")).toBeNull();
  });
  it("impossible calendar dates → null (no rollover)", () => {
    expect(brToIsoDate("31/02/2026")).toBeNull();
    expect(brToIsoDate("00/07/2026")).toBeNull();
    expect(brToIsoDate("15/13/2026")).toBeNull();
    expect(brToIsoDate("29/02/2026")).toBeNull(); // 2026 not leap
  });
  it("round-trips with isoToBrDate", () => {
    expect(isoToBrDate(brToIsoDate("15/07/2026")!)).toBe("15/07/2026");
  });
});
