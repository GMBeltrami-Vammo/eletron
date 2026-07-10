/**
 * PIX-key normalization + fuzzy equality — port of the n8n
 * `PDF_Comprovante_Processor` `normalizeChave` / `keysMatch` helpers (Apps
 * Script A7 lineage). Pure + test-importable (no `server-only`).
 *
 * `normalizePixKey` produces the canonical comparison form (lowercased, with
 * whitespace and `( ) - . , / \` stripped) plus a best-effort classification.
 * `pixKeysMatch` reproduces n8n's tolerant equality (exact, trailing-`.com`
 * trim, and BR phone `+55` normalization) so the matcher agrees with the
 * legacy flow on every real receipt.
 */

export type PixKeyType = "email" | "cnpj" | "cpf" | "phone" | "uuid" | "other";

const STRIP_RE = /[\s()\-.,/\\]/g;
const UUID_RE = /^[\da-f]{8}-?[\da-f]{4}-?[\da-f]{4}-?[\da-f]{4}-?[\da-f]{12}$/i;

/** n8n `normalizeChave`: lowercase + strip ` ( ) - . , / \`. */
function normalizeChave(raw: string): string {
  return raw.toLowerCase().replace(STRIP_RE, "");
}

function classify(raw: string): PixKeyType {
  const trimmed = raw.trim();
  if (trimmed.includes("@")) return "email";
  if (UUID_RE.test(trimmed)) return "uuid";
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 14) return "cnpj";
  if (digits.length === 11) return "cpf";
  if (digits.length === 10 || (digits.length >= 12 && digits.startsWith("55")))
    return "phone";
  return "other";
}

/**
 * Canonical comparison key + type for a raw PIX key. Empty/`null` input yields
 * `{ key: '', keyType: 'other' }`.
 */
export function normalizePixKey(
  raw: string | null | undefined,
): { key: string; keyType: PixKeyType } {
  if (!raw) return { key: "", keyType: "other" };
  return { key: normalizeChave(raw), keyType: classify(raw) };
}

/**
 * Leading-zero-insensitive equality for pure-digit keys. The sheet clone stored
 * documento-keys in NUMERIC cells, so `01610670000192` became `1610670000192`;
 * banks conversely zero-pad (`000228202278-56`). Both sides digits-only and
 * equal after stripping leading zeros ⇒ same key. Never used for barcodes
 * (linha digitável zeros are significant).
 *
 * Accepted residual risk: a 10-digit landline pix key could zero-equal an
 * 11-digit CPF of a DIFFERENT owner. In practice charges' phone keys carry the
 * +55 prefix (never bare 10 digits), and a false hit still needs the same
 * amount AND the pinned competência to auto-bind.
 */
export function digitKeysEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return false;
  const sa = a.replace(/^0+/, "");
  const sb = b.replace(/^0+/, "");
  return sa.length > 0 && sa === sb;
}

/**
 * n8n `keysMatch`: tolerant equality between two raw PIX keys. Normalizes both,
 * then tries exact, trailing-`com` trim, `+55`/`55` phone variants, and the
 * leading-zero-insensitive digit compare (clone keys lost leading zeros).
 */
export function pixKeysMatch(
  rawA: string | null | undefined,
  rawB: string | null | undefined,
): boolean {
  if (!rawA || !rawB) return false;
  const a = normalizeChave(rawA);
  const b = normalizeChave(rawB);
  if (!a || !b) return false;
  if (a === b) return true;
  if (digitKeysEqual(a, b)) return true;

  const aNoCom = a.replace(/\.?com$/, "");
  const bNoCom = b.replace(/\.?com$/, "");
  if (aNoCom === bNoCom) return true;

  const possibleA = [a, aNoCom];
  const possibleB = [b, bNoCom];
  if (/^\d{10,11}$/.test(a) && !a.startsWith("55")) {
    possibleA.push(`+55${a}`, `55${a}`);
  }
  if (/^\d{10,11}$/.test(b) && !b.startsWith("55")) {
    possibleB.push(`+55${b}`, `55${b}`);
  }
  for (const aa of possibleA) {
    for (const bb of possibleB) {
      if (aa === bb) return true;
    }
  }
  return false;
}
