import { SignJWT } from "jose";

/**
 * Deterministic UUID from an email (SHA-256, Web Crypto). Supabase casts the
 * JWT `sub` to uuid; a valid UUID avoids cast errors. RLS keys off the `email`
 * claim, not `sub`. Ported from goBuy lib/supabase/token.ts.
 */
async function emailToSub(email: string): Promise<string> {
  const data = new TextEncoder().encode(email.toLowerCase());
  const buf = await crypto.subtle.digest("SHA-256", data);
  const h = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${
    ((parseInt(h[16], 16) & 3) | 8).toString(16)
  }${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Mints a short-lived Supabase HS256 JWT so server code can call `charging`
 * RPCs / read under RLS AS that user. Minted PER CALL, server-side only — the
 * token is never stored in the NextAuth session or exposed to the browser
 * (decision #23).
 *
 * The `app: "eletron"` claim is the isolation guard: charging.is_vammo_user()
 * requires it, so tokens minted by other apps (e.g. goBuy) on the same shared
 * JWT secret cannot read this schema.
 */
export async function mintSupabaseToken(
  email: string,
  ttl = "8h",
): Promise<string> {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error("SUPABASE_JWT_SECRET not configured");
  return new SignJWT({
    role: "authenticated",
    email: email.toLowerCase(),
    sub: await emailToSub(email),
    aud: "authenticated",
    app: "eletron",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(new TextEncoder().encode(secret));
}
