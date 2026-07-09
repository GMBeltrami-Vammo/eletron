/**
 * Constant-time `Authorization: Bearer` checks for the /api/ingest/* webhooks.
 * Separate secrets per producer so each flow rotates independently of the
 * schedulers (CRON_SECRET) and of each other: N8N_INGEST_SECRET for the n8n
 * email/contract webhooks (decisions #27/#30) and SCRAPER_INGEST_SECRET for the
 * Vammo-Enel scraper feed (decision #34). The routes are middleware-exempt, so
 * this is their only guard.
 */

import { timingSafeEqual } from "crypto";

/** Constant-time compare of the request's Bearer token against `secret`. */
function bearerMatches(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const provided = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** n8n email-cobrança + contract-onboarding webhooks (Bearer N8N_INGEST_SECRET). */
export function isAuthorizedIngest(req: Request): boolean {
  return bearerMatches(req, process.env.N8N_INGEST_SECRET);
}

/** Vammo-Enel scraper feed (Bearer SCRAPER_INGEST_SECRET, decision #34). */
export function isAuthorizedScraperIngest(req: Request): boolean {
  return bearerMatches(req, process.env.SCRAPER_INGEST_SECRET);
}
