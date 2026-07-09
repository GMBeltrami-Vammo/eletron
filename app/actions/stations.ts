"use server";

/**
 * Station curation actions. Request #5: the manual hide list — toggle a
 * station's `hidden` flag (declutter the /estacoes list) via set_station_hidden.
 * RPC-backed behind `withOperator` (roles suspended → any @vammo.com session).
 */

import { revalidatePath } from "next/cache";

import { revalidateSnapshot } from "@/lib/data/repository.server";
import { unwrapRpc, withOperator, type ActionResult } from "@/lib/http/actions";

export async function setStationHidden(input: {
  stationId: number;
  hidden: boolean;
}): Promise<ActionResult> {
  return withOperator(async (client) => {
    unwrapRpc(
      await client.rpc("set_station_hidden", {
        p_station_id: input.stationId,
        p_hidden: input.hidden,
      }),
    );
    revalidatePath("/estacoes");
    await revalidateSnapshot();
  });
}
