import "server-only";

/**
 * Server-side read of energy billing accounts WITH their real charging uuids.
 *
 * The Repository deliberately hides DB uuids (domain ids are deterministic
 * strings like `enel:{id}` / `edp:{uc}`), but the `create_manual_bill` and
 * `create_meter_reading` RPCs take the uuid — so this reads
 * `charging.billing_accounts` directly via the service client. Reads are safe
 * here: the calling server component already sits behind the @vammo.com gate,
 * and no uuid ever reaches the client except as the account the user picks.
 *
 * Degrades to `[]` when the Supabase env is absent (dev / sheets backend) —
 * callers render an empty/disabled state, never crash (decision #18, M14/#20).
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { EnergyAccountOption, EnergyProvider } from "./types";

interface StationEmbed {
  name: string | null;
  address: string | null;
}

interface AccountRow {
  id: string;
  account_type: string;
  enel_id: string | null;
  edp_uc: string | null;
  station_id: number | null;
  meter_reading_required: boolean | null;
  /** PostgREST returns a to-one embed as an object; normalize array-or-object. */
  stations: StationEmbed | StationEmbed[] | null;
}

function stationEmbed(s: AccountRow["stations"]): StationEmbed | null {
  if (!s) return null;
  return Array.isArray(s) ? (s[0] ?? null) : s;
}

/**
 * All active Enel/EDP billing accounts, sorted by station then installation.
 * Empty when the charging backend is unavailable.
 */
export async function readEnergyAccounts(): Promise<EnergyAccountOption[]> {
  try {
    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("billing_accounts")
      .select(
        "id, account_type, enel_id, edp_uc, station_id, meter_reading_required, is_active, stations(name, address)",
      )
      .in("account_type", ["energy_enel", "energy_edp"])
      .eq("is_active", true);
    if (error || !data) return [];

    return (data as unknown as AccountRow[])
      .map((r): EnergyAccountOption => {
        const provider = r.account_type as EnergyProvider;
        const installationKey =
          (provider === "energy_enel" ? r.enel_id : r.edp_uc) ?? "";
        const station = stationEmbed(r.stations);
        return {
          id: r.id,
          provider,
          installationKey,
          stationId: r.station_id,
          stationName: station?.name ?? null,
          address: station?.address ?? null,
          meterReadingRequired: r.meter_reading_required ?? false,
        };
      })
      .filter((a) => a.installationKey !== "")
      .sort((a, b) => {
        const s = (a.stationId ?? Number.MAX_SAFE_INTEGER) -
          (b.stationId ?? Number.MAX_SAFE_INTEGER);
        return s !== 0 ? s : a.installationKey.localeCompare(b.installationKey);
      });
  } catch {
    return [];
  }
}
