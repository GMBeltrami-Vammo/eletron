"use server";

/**
 * Thin `"use server"` read wrappers used as TanStack Query `queryFn`s from the
 * client (inbox/deep-dive polling, charge-picker search). They only re-expose
 * the `server-only` read layer; every function there re-checks the session and
 * degrades to empty when Supabase env is absent, so these are safe to call from
 * a client component. No writes live here — mutations go through the committed
 * `app/actions/charges.ts` RPC actions.
 */

import {
  getDeepDiveData,
  getInboxData,
  getReviewData,
  searchOpenChargesData,
} from "./queries";
import type {
  DeepDiveData,
  InboxData,
  OpenChargeOption,
  ReviewData,
} from "./types";

export async function fetchInboxData(): Promise<InboxData> {
  return getInboxData();
}

export async function fetchDeepDiveData(
  documentId: string,
): Promise<DeepDiveData> {
  return getDeepDiveData(documentId);
}

export async function fetchReviewData(): Promise<ReviewData> {
  return getReviewData();
}

export async function fetchOpenCharges(
  value: number | null,
): Promise<OpenChargeOption[]> {
  return searchOpenChargesData(value);
}
