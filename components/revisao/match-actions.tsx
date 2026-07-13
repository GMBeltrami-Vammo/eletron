"use client";

/**
 * Per-account matching controls (R4, request 6): one-click confirm on each
 * geodesic suggestion, a searchable "escolher outra estação" combobox, and
 * "Não é Vammo" (reject_account). Wired to the matching server actions; toasts
 * + refresh via useRunAction.
 */

import * as React from "react";
import { Ban, Check, MapPin, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusBadge } from "@/components/vammo/status-badge";
import { useRunAction } from "@/components/comprovantes/write-helpers";
import { confirmStationMatch, rejectAccount } from "@/app/actions/matching";
import type { MatchCandidate } from "@/lib/matching/suggest";

export interface StationChoice {
  id: number;
  name: string | null;
}

export function MatchActions({
  billingAccountId,
  suggestions,
  stations,
}: {
  billingAccountId: string;
  suggestions: MatchCandidate[];
  stations: StationChoice[];
}) {
  const { run, pending } = useRunAction();
  const [pickerOpen, setPickerOpen] = React.useState(false);

  const confirm = (stationId: number, distanceM: number | null) =>
    run(() => confirmStationMatch({ billingAccountId, stationId, distanceM }), {
      success: `Vinculado à estação #${stationId}`,
    });

  const reject = () => {
    if (!window.confirm("Marcar esta instalação como não-Vammo?")) return;
    void run(() => rejectAccount({ billingAccountId, reason: "não é Vammo" }), {
      success: "Instalação rejeitada",
    });
  };

  return (
    <div className="flex flex-col items-stretch gap-1.5">
      {suggestions.length === 0 ? (
        <span className="text-xs text-muted-foreground">sem sugestão — busque a estação</span>
      ) : (
        suggestions.map((c) => (
          <button
            key={c.stationId}
            type="button"
            disabled={pending}
            onClick={() => confirm(c.stationId, c.distanceM)}
            title={c.address ?? undefined}
            className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-left text-xs hover:bg-accent disabled:opacity-50"
          >
            <MapPin className="size-3 shrink-0" strokeWidth={2} />
            <span className="min-w-0 flex-1 truncate">
              #{c.stationId} {c.stationName ?? ""}
            </span>
            <StatusBadge color={c.confidence === "high" ? "green" : "orange"}>
              {c.method === "geo" && c.distanceM !== null
                ? `${Math.round(c.distanceM)} m`
                : `${Math.round((c.addressScore ?? 0) * 100)}%`}
            </StatusBadge>
            {c.autoMatch ? (
              <Check className="size-3 text-success-emphasis" strokeWidth={2.5} />
            ) : null}
          </button>
        ))
      )}
      <div className="flex gap-1.5">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger
            render={
              <Button size="xs" variant="outline" disabled={pending}>
                <Search className="size-3.5" strokeWidth={2} />
                Outra
              </Button>
            }
          />
          <PopoverContent className="w-72 p-0" align="end">
            <Command>
              <CommandInput placeholder="Buscar estação por # ou nome…" />
              <CommandList>
                <CommandEmpty>Nenhuma estação.</CommandEmpty>
                {stations.map((s) => (
                  <CommandItem
                    key={s.id}
                    value={`${s.id} ${s.name ?? ""}`}
                    onSelect={() => {
                      setPickerOpen(false);
                      void confirm(s.id, null);
                    }}
                  >
                    #{s.id} {s.name ?? ""}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <Button
          size="xs"
          variant="outline"
          disabled={pending}
          onClick={reject}
          title="Não é uma instalação Vammo"
        >
          <Ban className="size-3.5" strokeWidth={2} />
          Não é Vammo
        </Button>
      </div>
    </div>
  );
}
