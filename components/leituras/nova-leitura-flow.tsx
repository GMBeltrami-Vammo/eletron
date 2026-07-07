"use client";

import * as React from "react";
import {
  Camera,
  ChevronsUpDown,
  LocateFixed,
  MapPin,
  RefreshCcw,
  Send,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";

/** Serialized station option passed from the server component. */
export interface StationOption {
  id: number;
  name: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
}

/** Great-circle distance in km (pure client math for "perto de você"). */
function haversineKm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1).replace(".", ",")} km`;
}

/** Integer or pt-BR decimal (comma or dot), up to 7 digits — kWh reading. */
const LEITURA_RE = /^\d{1,7}([.,]\d{1,3})?$/;

function StepLabel({
  n,
  title,
  hint,
}: {
  n: number;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="flex size-6 shrink-0 translate-y-1 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground tabular-nums">
        {n}
      </span>
      <span className="text-sm font-semibold text-foreground">{title}</span>
      {hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

export function NovaLeituraFlow({
  stations,
  initialStationId,
}: {
  stations: StationOption[];
  initialStationId: number | null;
}) {
  const [stationId, setStationId] = React.useState<number | null>(() =>
    initialStationId !== null && stations.some((s) => s.id === initialStationId)
      ? initialStationId
      : null,
  );
  const [comboOpen, setComboOpen] = React.useState(false);
  const [photo, setPhoto] = React.useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [leitura, setLeitura] = React.useState("");
  const [observacao, setObservacao] = React.useState("");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [coords, setCoords] = React.useState<{
    lat: number;
    lon: number;
  } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // "Perto de você" only when the geolocation permission is ALREADY granted —
  // never prompts (the photo input needs no permission either).
  React.useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !navigator.permissions ||
      !navigator.geolocation
    ) {
      return;
    }
    let cancelled = false;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        if (cancelled || status.state !== "granted") return;
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (!cancelled) {
              setCoords({
                lat: pos.coords.latitude,
                lon: pos.coords.longitude,
              });
            }
          },
          () => {},
          { maximumAge: 300_000, timeout: 10_000 },
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Revoke stale object URLs (each cleanup runs with the previous URL).
  React.useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const sortedStations = React.useMemo(() => {
    const withDistance = stations.map((station) => ({
      station,
      distanceKm:
        coords !== null && station.lat !== null && station.lon !== null
          ? haversineKm(coords.lat, coords.lon, station.lat, station.lon)
          : null,
    }));
    if (coords !== null) {
      withDistance.sort((a, b) => {
        if (a.distanceKm === null && b.distanceKm === null)
          return a.station.id - b.station.id;
        if (a.distanceKm === null) return 1;
        if (b.distanceKm === null) return -1;
        return a.distanceKm - b.distanceKm;
      });
    }
    return withDistance;
  }, [stations, coords]);

  const selected = React.useMemo(
    () => stations.find((s) => s.id === stationId) ?? null,
    [stations, stationId],
  );

  const parsedLeitura = React.useMemo(() => {
    const trimmed = leitura.trim();
    if (!LEITURA_RE.test(trimmed)) return null;
    const value = Number(trimmed.replace(",", "."));
    return Number.isFinite(value) ? value : null;
  }, [leitura]);

  const canSubmit =
    selected !== null && photo !== null && parsedLeitura !== null;

  const missing: string[] = [];
  if (selected === null) missing.push("selecione a estação");
  if (photo === null) missing.push("tire a foto do medidor");
  if (parsedLeitura === null) missing.push("informe a leitura em kWh");

  function openCamera() {
    fileInputRef.current?.click();
  }

  function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    setPhoto(file);
    setPreviewUrl(URL.createObjectURL(file));
    // Reset so retaking the exact same file still fires onChange.
    e.target.value = "";
  }

  function handleSubmit() {
    if (!canSubmit) return;
    setDialogOpen(true);
    toast.info("Registro disponível na fase 2 — a leitura não foi salva.");
  }

  return (
    <div className="space-y-6">
      {/* Passo 1 — Estação */}
      <section className="space-y-2">
        <StepLabel n={1} title="Estação" />
        <Popover open={comboOpen} onOpenChange={setComboOpen}>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                className="h-11 w-full justify-between px-3 font-normal"
              />
            }
          >
            {selected ? (
              <span className="truncate text-left">
                <span className="tabular-nums">{selected.id}</span>
                {selected.name ? ` — ${selected.name}` : ""}
              </span>
            ) : (
              <span className="text-muted-foreground">Buscar estação…</span>
            )}
            <ChevronsUpDown
              className="size-4 shrink-0 opacity-50"
              strokeWidth={2}
            />
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={6}
            className="w-[min(28rem,calc(100vw-2rem))] p-0"
          >
            <Command>
              <CommandInput placeholder="Id, nome ou endereço…" />
              <CommandList>
                <CommandEmpty>Nenhuma estação encontrada.</CommandEmpty>
                <CommandGroup
                  heading={coords ? "Perto de você" : "Estações"}
                >
                  {sortedStations.map(({ station, distanceKm }) => (
                    <CommandItem
                      key={station.id}
                      value={`${station.id} ${station.name ?? ""} ${station.address ?? ""}`}
                      data-checked={station.id === stationId}
                      onSelect={() => {
                        setStationId(station.id);
                        setComboOpen(false);
                      }}
                      className="py-2.5"
                    >
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-medium">
                          <span className="tabular-nums">{station.id}</span>
                          {station.name ? ` — ${station.name}` : ""}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {station.address ?? "Endereço não informado"}
                        </span>
                      </div>
                      {distanceKm !== null ? (
                        <span className="ml-2 shrink-0 text-xs text-muted-foreground tabular-nums">
                          {formatDistance(distanceKm)}
                        </span>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {coords !== null ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <LocateFixed className="size-3.5" strokeWidth={2} />
            Ordenado por proximidade
          </p>
        ) : null}
        {selected ? (
          <div className="rounded-xl border border-border bg-card p-3 text-sm">
            <div className="flex items-start gap-2">
              <MapPin
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                strokeWidth={2}
              />
              <div className="min-w-0">
                <p className="font-medium text-foreground">
                  <span className="tabular-nums">{selected.id}</span>
                  {selected.name ? ` — ${selected.name}` : ""}
                </p>
                <p className="text-muted-foreground">
                  {selected.address ?? "Endereço não informado"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Última leitura: — (nenhuma registrada)
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {/* Passo 2 — Foto (obrigatória) */}
      <section className="space-y-2">
        <StepLabel n={2} title="Foto do medidor" hint="obrigatória" />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onPhotoChange}
        />
        {previewUrl ? (
          <div className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- blob object URL preview; next/image não otimiza blobs */}
            <img
              src={previewUrl}
              alt="Foto do medidor"
              className="max-h-80 w-full rounded-xl border border-border bg-muted object-contain"
            />
            {photo ? (
              <p className="truncate text-xs text-muted-foreground">
                {photo.name} ·{" "}
                <span className="tabular-nums">
                  {Math.max(1, Math.round(photo.size / 1024))} KB
                </span>
              </p>
            ) : null}
            <Button
              variant="outline"
              className="h-11 w-full"
              onClick={openCamera}
            >
              <RefreshCcw className="size-4" strokeWidth={2} />
              Tirar novamente
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            className="h-14 w-full border-dashed text-base"
            onClick={openCamera}
          >
            <Camera className="size-5" strokeWidth={2} />
            Tirar foto do medidor
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          Sem foto não dá para enviar — ela comprova a leitura.
        </p>
      </section>

      {/* Passo 3 — Leitura */}
      <section className="space-y-3">
        <StepLabel n={3} title="Leitura" />
        <div className="space-y-1.5">
          <Label htmlFor="leitura-kwh">Leitura do medidor</Label>
          <div className="relative">
            <Input
              id="leitura-kwh"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              value={leitura}
              onChange={(e) => setLeitura(e.target.value)}
              aria-invalid={leitura.trim() !== "" && parsedLeitura === null}
              className="h-11 pr-12 text-lg tabular-nums"
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">
              kWh
            </span>
          </div>
          {leitura.trim() !== "" && parsedLeitura === null ? (
            <p className="text-xs text-destructive">
              Número inválido — use vírgula para decimais, ex.: 4755,3
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="leitura-observacao">
            Observação{" "}
            <span className="font-normal text-muted-foreground">
              (opcional)
            </span>
          </Label>
          <Textarea
            id="leitura-observacao"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Ex.: medidor de difícil acesso, leitura estimada…"
          />
        </div>
      </section>

      {/* Enviar */}
      <div className="space-y-2 pt-1">
        <Button
          className="h-12 w-full text-base"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          <Send className="size-4" strokeWidth={2} />
          Enviar leitura
        </Button>
        {canSubmit ? (
          <p className="text-center text-xs text-muted-foreground">
            Fase 1: a leitura não será salva.
          </p>
        ) : (
          <p className="text-center text-xs text-muted-foreground">
            Para enviar: {missing.join(" · ")}.
          </p>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registro disponível na fase 2</DialogTitle>
            <DialogDescription>
              A leitura não foi salva. O fluxo completo (foto obrigatória +
              registro auditado) entra com o banco de dados.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button className="h-11 sm:h-8" />}>
              Entendi
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
