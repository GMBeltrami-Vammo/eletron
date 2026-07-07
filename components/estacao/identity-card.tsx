import { ExternalLink, MapPin, TriangleAlert } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/vammo/status-badge";
import { STATION_STATUS_UI } from "@/lib/labels";
import { formatDate, formatNumber } from "@/lib/format";
import type { Station360 } from "@/lib/data/repository";

import { accountKeyLabel, haversineMeters, isEnergyAccount } from "./helpers";

/**
 * Left-rail identity card: address, ids, status, Google Maps link and the
 * MatchingQualityCheck warning (utility pin > 100 m from the station pin).
 * No embedded map — plain anchor, no API key (spec deviation noted in build).
 */
export function IdentityCard({ data }: { data: Station360 }) {
  const { station, accounts } = data;

  const rentContract =
    accounts.find((a) => a.account.accountType === "rent")?.contract ??
    data.contracts[0] ??
    null;

  const farMatches =
    station.latitude !== null && station.longitude !== null
      ? accounts
          .filter((a) => isEnergyAccount(a.account.accountType))
          .flatMap((a) => {
            if (a.state?.lat == null || a.state.lon == null) return [];
            const meters = haversineMeters(
              station.latitude as number,
              station.longitude as number,
              a.state.lat,
              a.state.lon,
            );
            return meters > 100 ? [{ key: accountKeyLabel(a), meters }] : [];
          })
      : [];

  const mapsHref =
    station.latitude !== null && station.longitude !== null
      ? `https://www.google.com/maps?q=${station.latitude},${station.longitude}`
      : null;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-start gap-2">
          <MapPin
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            strokeWidth={2}
            aria-hidden
          />
          <span className="text-sm leading-snug">
            {station.address ?? "Endereço não informado"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {mapsHref ? (
          <a
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-info-emphasis hover:underline"
          >
            Ver no Google Maps
            <ExternalLink className="size-3" strokeWidth={2} aria-hidden />
          </a>
        ) : (
          <p className="text-xs text-muted-foreground">
            Sem coordenadas cadastradas
          </p>
        )}

        <dl className="space-y-2 text-sm">
          <IdentityRow label="ID">
            <span className="tabular-nums">{station.id}</span>
          </IdentityRow>
          <IdentityRow label="Nome">{station.name ?? "—"}</IdentityRow>
          <IdentityRow label="Status">
            {station.status ? (
              <StatusBadge color={STATION_STATUS_UI[station.status].color}>
                {STATION_STATUS_UI[station.status].label}
              </StatusBadge>
            ) : (
              <StatusBadge color="grey" outline>
                Sem status
              </StatusBadge>
            )}
          </IdentityRow>
          <IdentityRow label="Boxes (contrato)">
            <span className="tabular-nums">
              {rentContract?.boxCount != null
                ? formatNumber(rentContract.boxCount)
                : "—"}
            </span>
          </IdentityRow>
          <IdentityRow label="Criada em">
            <span className="tabular-nums">
              {formatDate(station.sourceCreatedAt)}
            </span>
          </IdentityRow>
        </dl>

        {farMatches.length > 0 ? (
          <div className="rounded-lg border border-warning/60 bg-warning-subtle p-2.5 text-xs">
            <p className="flex items-center gap-1.5 font-medium text-foreground">
              <TriangleAlert
                className="size-3.5 shrink-0 text-warning-emphasis"
                strokeWidth={2}
                aria-hidden
              />
              Verifique a correspondência por endereço
            </p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {farMatches.map((m) => (
                <li key={m.key}>
                  {m.key}:{" "}
                  <span className="tabular-nums">
                    {formatNumber(Math.round(m.meters))} m
                  </span>{" "}
                  da estação
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function IdentityRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}
