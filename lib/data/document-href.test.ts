import { describe, expect, it } from "vitest";

import { resolveDocumentHref } from "./document-href";

describe("resolveDocumentHref", () => {
  it("rent/manual charge → the session-checked /api/files proxy", () => {
    expect(resolveDocumentHref("doc-123", null)).toBe("/api/files/doc-123");
  });

  it("energy charge (no bound document) → the raw Drive fatura link", () => {
    const drive = "https://drive.google.com/file/d/abc/view";
    expect(resolveDocumentHref(null, drive)).toBe(drive);
  });

  it("proxy wins when both a bound document and a Drive link exist", () => {
    expect(
      resolveDocumentHref("doc-123", "https://drive.google.com/file/d/abc/view"),
    ).toBe("/api/files/doc-123");
  });

  it("neither → null (cell renders —)", () => {
    expect(resolveDocumentHref(null, null)).toBeNull();
  });

  it("treats empty strings as absent", () => {
    expect(resolveDocumentHref("", "")).toBeNull();
  });
});
