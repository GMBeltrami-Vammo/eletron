/**
 * Constant-time `Authorization: Bearer ${CRON_SECRET}` check for the /api/cron/*
 * routes (called by n8n schedulers + the Vercel daily cron). These routes are
 * exempt from the next-auth middleware gate, so this is their only guard.
 */

import { timingSafeEqual } from "crypto";

export function isAuthorizedCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch; the length guard is unavoidable.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
