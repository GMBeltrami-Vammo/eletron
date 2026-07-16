import { describe, expect, it } from "vitest";

import { buildUploadDriveName, sanitizeDriveName } from "./naming";

describe("sanitizeDriveName", () => {
  it("keeps accents/hyphens, strips hostile chars, collapses spaces", () => {
    expect(sanitizeDriveName("Comprovante 07/Julho.pdf")).toBe(
      "Comprovante 07 Julho.pdf",
    );
    expect(sanitizeDriveName("  a   b  ")).toBe("a b");
  });
});

describe("buildUploadDriveName", () => {
  const SHA = "e46ad9f3abc123";

  it("uses the sanitized original filename — no hash prefix", () => {
    expect(buildUploadDriveName("Comprovante-07-Julho.pdf", SHA)).toBe(
      "Comprovante-07-Julho.pdf",
    );
  });
  it("adds .pdf when the original lacks it", () => {
    expect(buildUploadDriveName("Comprovante", SHA)).toBe("Comprovante.pdf");
  });
  it("falls back to a short hash name when the original sanitizes to nothing", () => {
    expect(buildUploadDriveName("///", SHA)).toBe("documento-e46ad9f3.pdf");
    expect(buildUploadDriveName("", SHA)).toBe("documento-e46ad9f3.pdf");
  });
});
