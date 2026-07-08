/**
 * Constant-time `Authorization: Bearer ${N8N_INGEST_SECRET}` check for the
 * /api/ingest/* webhook (decision #27). Separate secret from CRON_SECRET so
 * the n8n email flow can be rotated independently of the schedulers. The route
 * is middleware-exempt, so this is its only guard.
 */

import { timingSafeEqual } from "crypto";

export function isAuthorizedIngest(req: Request): boolean {
  const secret = process.env.N8N_INGEST_SECRET;
  if (!secret) return false;
  const provided = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
