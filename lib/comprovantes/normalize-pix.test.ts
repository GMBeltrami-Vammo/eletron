import { describe, expect, it } from "vitest";

import { normalizePixKey, pixKeysMatch } from "./normalize-pix";

describe("normalizePixKey", () => {
  it("lowercases and strips separators from an email", () => {
    expect(normalizePixKey("Financeiro@Fornecedor.com").key).toBe(
      "financeiro@fornecedorcom",
    );
    expect(normalizePixKey("a@b.com").keyType).toBe("email");
  });

  it("reduces a formatted CNPJ to digits and classifies it", () => {
    const r = normalizePixKey("12.345.678/0001-99");
    expect(r.key).toBe("12345678000199");
    expect(r.keyType).toBe("cnpj");
  });

  it("classifies CPF, phone and uuid", () => {
    expect(normalizePixKey("123.456.789-09").keyType).toBe("cpf");
    expect(normalizePixKey("+55 11 99999-8888").keyType).toBe("phone");
    expect(
      normalizePixKey("123e4567-e89b-42d3-a456-426614174000").keyType,
    ).toBe("uuid");
  });

  it("returns empty for null/blank", () => {
    expect(normalizePixKey(null)).toEqual({ key: "", keyType: "other" });
    expect(normalizePixKey("")).toEqual({ key: "", keyType: "other" });
  });
});

describe("pixKeysMatch", () => {
  it("matches exact after normalization (case / separators)", () => {
    expect(pixKeysMatch("Financeiro@Fornecedor.com", "financeiro@fornecedor.com")).toBe(
      true,
    );
    expect(pixKeysMatch("12.345.678/0001-99", "12345678000199")).toBe(true);
  });

  it("matches with trailing .com trimmed", () => {
    expect(pixKeysMatch("financeiro@fornecedor.com", "financeiro@fornecedor")).toBe(
      true,
    );
  });

  it("matches a BR phone with and without 55 prefix", () => {
    expect(pixKeysMatch("11999998888", "5511999998888")).toBe(true);
  });

  it("does not match different keys", () => {
    expect(pixKeysMatch("financeiro@a.com", "financeiro@b.com")).toBe(false);
    expect(pixKeysMatch("12345678000199", "98765432000111")).toBe(false);
  });

  it("is false when either key is empty", () => {
    expect(pixKeysMatch(null, "x")).toBe(false);
    expect(pixKeysMatch("x", "")).toBe(false);
  });
});
