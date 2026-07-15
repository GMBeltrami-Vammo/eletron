"use client";

import * as React from "react";
import Link from "next/link";
import {
  Camera,
  Check,
  ChevronsUpDown,
  CircleCheck,
  LocateFixed,
  MapPin,
  RefreshCcw,
  Send,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { createMeterReading } from "@/app/actions/meter-readings";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatNumber } from "@/lib/format";

/** Serialized station option passed from the server component. */
export interface StationOption {
  id: number;
  name: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
}

/** Metered energy account for the picker (only shown when a station has >1). */
export interface MeterAccountOption {
  /** charging billing_account uuid. */
  id: string;
  label: string;
}

/** Last live reading per station, for the sanity line + success delta. */
export interface LastReading {
  kwh: number;
  date: string;
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

/** SP-local `YYYY-MM-DD` today (default reading date). */
function saoPauloToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
}

/** Integer or pt-BR decimal (comma or dot), up to 7 digits — kWh reading. */
const LEITURA_RE = /^\d{1,7}([.,]\d{1,3})?$/;

interface UploadOk {
  documentId: string;
  warnings: string[];
}

/** POST the photo with upload progress (fetch can't stream upload progress). */
function uploadMeterPhoto(
  file: File,
  stationId: number,
  onProgress: (pct: number) => void,
): Promise<UploadOk> {
  return new Promise<UploadOk>((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("stationId", String(stationId));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads/meter-photo");
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });
    xhr.addEventListener("load", () => {
      let body: { documentId?: string; warnings?: unknown; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText) as typeof body;
      } catch {
        /* non-JSON body handled below */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.documentId) {
        resolve({
          documentId: body.documentId,
          warnings: Array.isArray(body.warnings)
            ? body.warnings.map((w) => String(w))
            : [],
        });
      } else {
        reject(new Error(body.error ?? `falha no upload da foto (${xhr.status})`));
      }
    });
    xhr.addEventListener("error", () =>
      reject(new Error("erro de rede ao enviar a foto")),
    );
    xhr.send(form);
  });
}

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

interface SuccessInfo {
  stationLabel: string;
  kwh: number;
  previousKwh: number | null;
}

export function NovaLeituraFlow({
  stations,
  initialStationId,
  meteredAccountsByStation,
  lastReadingByStation,
  canWrite,
  userEmail,
}: {
  stations: StationOption[];
  initialStationId: number | null;
  meteredAccountsByStation: Record<number, MeterAccountOption[]>;
  lastReadingByStation: Record<number, LastReading>;
  canWrite: boolean;
  userEmail: string | null;
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
  const [notes, setNotes] = React.useState("");
  const [name, setName] = React.useState("");
  const [nameEdited, setNameEdited] = React.useState(false);
  const [readingDate, setReadingDate] = React.useState(saoPauloToday);
  const [accountId, setAccountId] = React.useState<string | null>(null);
  const [coords, setCoords] = React.useState<{ lat: number; lon: number } | null>(
    null,
  );
  const [phase, setPhase] = React.useState<"idle" | "uploading" | "saving">(
    "idle",
  );
  const [progress, setProgress] = React.useState(0);
  const [uploadedPhotoId, setUploadedPhotoId] = React.useState<string | null>(
    null,
  );
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<SuccessInfo | null>(null);
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
              setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
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

  const accounts = stationId !== null
    ? (meteredAccountsByStation[stationId] ?? [])
    : [];
  const needsAccount = accounts.length > 1;
  const lastReading =
    stationId !== null ? (lastReadingByStation[stationId] ?? null) : null;

  // Prefill the editable name from the selected station unless the user typed.
  React.useEffect(() => {
    if (nameEdited) return;
    if (selected === null) {
      setName("");
      return;
    }
    setName(
      selected.address
        ? `${selected.id} - ${selected.address}`
        : `${selected.id}`,
    );
  }, [selected, nameEdited]);

  // Reset the account choice + name-prefill lock whenever the station changes
  // (the default name is station-specific, so it should follow the station).
  React.useEffect(() => {
    setAccountId(null);
    setNameEdited(false);
  }, [stationId]);

  const parsedLeitura = React.useMemo(() => {
    const trimmed = leitura.trim();
    if (!LEITURA_RE.test(trimmed)) return null;
    const value = Number(trimmed.replace(",", "."));
    return Number.isFinite(value) ? value : null;
  }, [leitura]);

  const busy = phase !== "idle";
  const canSubmit =
    selected !== null &&
    photo !== null &&
    parsedLeitura !== null &&
    name.trim() !== "" &&
    readingDate !== "" &&
    (!needsAccount || accountId !== null);

  const missing: string[] = [];
  if (selected === null) missing.push("selecione a estação");
  if (photo === null) missing.push("tire a foto do medidor");
  if (parsedLeitura === null) missing.push("informe a leitura em kWh");
  if (name.trim() === "") missing.push("informe o nome da leitura");
  if (needsAccount && accountId === null) missing.push("escolha o medidor");

  function openCamera() {
    fileInputRef.current?.click();
  }

  function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    setPhoto(file);
    setPreviewUrl(URL.createObjectURL(file));
    // New bytes → the previously uploaded document no longer matches.
    setUploadedPhotoId(null);
    setWarnings([]);
    setErrorMsg(null);
    // Reset so retaking the exact same file still fires onChange.
    e.target.value = "";
  }

  async function handleSubmit() {
    if (!canSubmit || !canWrite || busy || selected === null || photo === null) {
      return;
    }
    setErrorMsg(null);

    let photoDocumentId = uploadedPhotoId;
    try {
      if (!photoDocumentId) {
        setPhase("uploading");
        setProgress(0);
        const uploaded = await uploadMeterPhoto(photo, selected.id, setProgress);
        photoDocumentId = uploaded.documentId;
        setUploadedPhotoId(uploaded.documentId);
        setWarnings(uploaded.warnings);
      }
    } catch (err) {
      setPhase("idle");
      const message = err instanceof Error ? err.message : "falha no upload";
      setErrorMsg(message);
      toast.error("Falha ao enviar a foto", { description: message });
      return;
    }

    setPhase("saving");
    try {
      const result = await createMeterReading({
        stationId: selected.id,
        billingAccountId: needsAccount ? accountId : null,
        name: name.trim(),
        readingDate,
        readingKwh: parsedLeitura as number,
        photoDocumentId,
        notes: notes.trim() === "" ? null : notes.trim(),
      });
      setPhase("idle");
      if (!result.ok) {
        setErrorMsg(result.error);
        toast.error("Não foi possível registrar a leitura", {
          description: result.error,
        });
        return;
      }
      setSuccess({
        stationLabel: selected.name
          ? `${selected.id} — ${selected.name}`
          : `${selected.id}`,
        kwh: parsedLeitura as number,
        previousKwh: lastReading?.kwh ?? null,
      });
      toast.success("Leitura registrada");
    } catch (err) {
      setPhase("idle");
      const message = err instanceof Error ? err.message : "falha ao registrar";
      setErrorMsg(message);
      toast.error("Não foi possível registrar a leitura", {
        description: message,
      });
    }
  }

  function resetAll() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setStationId(null);
    setPhoto(null);
    setPreviewUrl(null);
    setLeitura("");
    setNotes("");
    setName("");
    setNameEdited(false);
    setReadingDate(saoPauloToday());
    setAccountId(null);
    setUploadedPhotoId(null);
    setWarnings([]);
    setErrorMsg(null);
    setSuccess(null);
    setPhase("idle");
  }

  if (success !== null) {
    const delta =
      success.previousKwh !== null ? success.kwh - success.previousKwh : null;
    return (
      <div className="space-y-6 py-4 text-center">
        <div className="flex flex-col items-center gap-3">
          <span className="flex size-16 items-center justify-center rounded-full bg-success-subtle text-success-emphasis">
            <CircleCheck className="size-9" strokeWidth={2} />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Leitura registrada
            </h2>
            <p className="text-sm text-muted-foreground">
              A leitura foi salva com a foto e o registro auditado.
            </p>
          </div>
        </div>

        <dl className="mx-auto max-w-xs space-y-1.5 rounded-xl border border-border bg-card p-4 text-left text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Estação</dt>
            <dd className="text-right font-medium">{success.stationLabel}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Leitura</dt>
            <dd className="text-right font-medium tabular-nums">
              {formatNumber(success.kwh)} kWh
            </dd>
          </div>
          {delta !== null ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Variação</dt>
              <dd className="text-right tabular-nums">
                {delta >= 0 ? "+" : "−"}
                {formatNumber(Math.abs(delta))} kWh
              </dd>
            </div>
          ) : null}
        </dl>

        <div className="mx-auto flex max-w-xs flex-col gap-2">
          <Button className="h-12 text-base" onClick={resetAll}>
            <Camera className="size-4" strokeWidth={2} />
            Registrar outra
          </Button>
          <Button
            variant="outline"
            className="h-11"
            render={<Link href="/leituras" />}
          >
            Ver leituras
          </Button>
        </div>
      </div>
    );
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
                <CommandGroup heading={coords ? "Perto de você" : "Estações"}>
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
                  {lastReading
                    ? `Última: ${formatNumber(lastReading.kwh)} kWh em ${formatDate(lastReading.date)}`
                    : "Última leitura: — (nenhuma registrada)"}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {/* Medidor — só quando a estação tem mais de uma conta de energia */}
        {needsAccount ? (
          <div className="space-y-1.5 pt-1">
            <Label htmlFor="leitura-medidor">Medidor (instalação)</Label>
            <Select
              value={accountId}
              onValueChange={(v) => setAccountId(v as string)}
            >
              <SelectTrigger id="leitura-medidor" className="h-11 w-full">
                <SelectValue placeholder="Escolha a instalação…" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Esta estação tem mais de um medidor — informe qual foi lido.
            </p>
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
              disabled={busy}
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
        {warnings.length > 0 ? (
          <div className="space-y-1 rounded-lg border border-warning/40 bg-warning-subtle/40 p-2.5">
            <p className="flex items-center gap-1.5 text-xs font-medium text-warning-emphasis">
              <TriangleAlert className="size-3.5" strokeWidth={2} />
              Avisos da foto (não impedem o envio)
            </p>
            <ul className="space-y-0.5 pl-5 text-xs text-warning-emphasis">
              {warnings.map((w, i) => (
                <li key={i} className="list-disc">
                  {w}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
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

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="leitura-data">Data da leitura</Label>
            <DateField
              id="leitura-data"
              value={readingDate}
              max={saoPauloToday()}
              onValueChange={setReadingDate}
              className="h-11 tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Responsável</Label>
            <div className="flex h-11 items-center truncate rounded-lg border border-border bg-muted/50 px-3 text-sm text-muted-foreground">
              {userEmail ?? "você"}
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="leitura-nome">Nome da leitura</Label>
          <Input
            id="leitura-nome"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameEdited(true);
            }}
            placeholder="Ex.: 1268 - Av. Paulista, 1000"
            className="h-11"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="leitura-observacao">
            Observação{" "}
            <span className="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Textarea
            id="leitura-observacao"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex.: medidor de difícil acesso, leitura estimada…"
          />
        </div>
      </section>

      {/* Enviar */}
      <div className="space-y-2 pt-1">
        {errorMsg ? (
          <p className="rounded-lg border border-error/40 bg-error-subtle/60 p-2.5 text-xs text-error-emphasis">
            {errorMsg}
            {uploadedPhotoId
              ? " — a foto já foi enviada; toque em enviar para tentar salvar de novo."
              : ""}
          </p>
        ) : null}
        <span
          className="block"
          title={canWrite ? undefined : "Requer papel operador para registrar"}
        >
          <Button
            className="h-12 w-full text-base"
            disabled={!canSubmit || busy || !canWrite}
            onClick={handleSubmit}
          >
            {phase === "uploading" ? (
              <>Enviando foto… {progress}%</>
            ) : phase === "saving" ? (
              <>Salvando…</>
            ) : (
              <>
                <Send className="size-4" strokeWidth={2} />
                Enviar leitura
              </>
            )}
          </Button>
        </span>
        {!canWrite ? (
          <p className="text-center text-xs text-muted-foreground">
            Registro exige papel operador.
          </p>
        ) : canSubmit ? (
          <p className="flex items-center justify-center gap-1 text-center text-xs text-muted-foreground">
            <Check className="size-3.5" strokeWidth={2} />
            Pronto para enviar
          </p>
        ) : (
          <p className="text-center text-xs text-muted-foreground">
            Para enviar: {missing.join(" · ")}.
          </p>
        )}
      </div>
    </div>
  );
}
