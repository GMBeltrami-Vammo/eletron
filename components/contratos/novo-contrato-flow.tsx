"use client";

/**
 * "Novo contrato" single-page flow (decisão #48): drop a PDF → the app uploads
 * it to the Contratos_Aluguel Drive folder + stages a `contract_intake`
 * (awaiting_extraction) → this page POLLS while n8n's Drive trigger extracts →
 * when the extraction lands (intake → pending) the revisable form fills in with
 * the contract's FIRST PAGE side-by-side → confirm creates the real contract.
 */

import * as React from "react";
import Link from "next/link";
import {
  Check,
  ClipboardCheck,
  FileUp,
  Loader2,
  RotateCw,
  ScanText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  UploadDropzone,
  type UploadItem,
} from "@/components/vammo/upload-dropzone";
import { PdfViewer } from "@/components/comprovantes/pdf-viewer";
import { ContractIntakeFields } from "@/components/contratos/contract-intake-fields";
import { createCasaVammoContract, pollContractIntake } from "@/app/actions/contracts";
import type { ContractIntakePrefill } from "@/lib/ingest/contratos";
import type { StationOption } from "@/app/(app)/revisao/contratos/queries";

const MAX_BYTES = 4_400_000; // Vercel request-body ceiling (same as comprovantes)
const POLL_MS = 4000;
const SLOW_AFTER_MS = 90_000; // hint that extraction is taking longer than usual

type Phase =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "awaiting"; intakeId: string; documentId: string | null; since: number }
  | {
      kind: "ready";
      intakeId: string;
      documentId: string | null;
      prefill: ContractIntakePrefill;
      nomeArquivo: string | null;
      /** Casa Vammo (#68): no PDF; confirm via createCasaVammoContract. */
      casaVammo?: boolean;
    }
  | { kind: "done" }
  | { kind: "error"; message: string };

export type ContratoMode = "extract" | "manual" | "casa_vammo";

/** Empty prefill for a Casa Vammo (gratuito, no PDF) — seeds the deep-linked station. */
function casaVammoPrefill(stationId: number | null): ContractIntakePrefill {
  return {
    swapStationId: stationId,
    status: "ACTIVE",
    contractType: "casa_vammo",
    counterpartyName: null,
    counterpartyCnpj: null,
    numeroConexao: null,
    endereco: null,
    contato: null,
    telefone: null,
    email: null,
    boxCount: null,
    minBox: null,
    valorPorBox: null,
    valorMensal: null,
    dueDay: null,
    paymentMethod: null,
    banco: null,
    agencia: null,
    conta: null,
    chavePix: null,
    observacoes: null,
  };
}

export function NovoContratoFlow({
  stations,
  canWrite,
  initialMode = "extract",
  initialStationId = null,
}: {
  stations: StationOption[];
  canWrite: boolean;
  /** 'manual' = fill the form immediately (skip the AI extraction wait). */
  initialMode?: ContratoMode;
  /** Pre-select this station in manual mode (e.g. deep-linked from a station). */
  initialStationId?: number | null;
}) {
  const [phase, setPhase] = React.useState<Phase>({ kind: "idle" });
  const [item, setItem] = React.useState<UploadItem | null>(null);
  const [slow, setSlow] = React.useState(false);
  const [mode, setMode] = React.useState<ContratoMode>(initialMode);

  async function upload(file: File) {
    setItem({ id: file.name, file, state: { status: "uploading", progress: 0 } });
    setPhase({ kind: "uploading" });
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("mode", mode);
      const res = await fetch("/api/uploads/contrato", { method: "POST", body });
      const data = (await res.json()) as {
        intakeId?: string;
        documentId?: string;
        status?: string;
        error?: string;
      };
      if (!res.ok || !data.intakeId) {
        throw new Error(data.error ?? "falha no upload");
      }
      setItem((p) => (p ? { ...p, state: { status: "done" } } : p));
      if (data.status === "confirmed") {
        setPhase({
          kind: "error",
          message: "Este contrato já foi confirmado anteriormente.",
        });
        return;
      }
      if (data.status === "rejected") {
        setPhase({
          kind: "error",
          message: "Este contrato foi rejeitado antes. Reabra pela revisão se necessário.",
        });
        return;
      }
      // pending (doc already extracted) OR awaiting_extraction → resolve via poll
      setPhase({
        kind: "awaiting",
        intakeId: data.intakeId,
        documentId: data.documentId ?? null,
        since: Date.now(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "falha no upload do contrato";
      setItem((p) => (p ? { ...p, state: { status: "error", message } } : p));
      setPhase({ kind: "error", message });
    }
  }

  // Poll the intake while awaiting the n8n extraction.
  const awaitingIntakeId = phase.kind === "awaiting" ? phase.intakeId : null;
  const awaitingSince = phase.kind === "awaiting" ? phase.since : 0;
  React.useEffect(() => {
    if (!awaitingIntakeId) return;
    let cancelled = false;
    setSlow(false);

    async function check() {
      const r = await pollContractIntake(awaitingIntakeId as string);
      if (cancelled) return;
      if (r.status === "pending" && r.prefill) {
        setPhase({
          kind: "ready",
          intakeId: awaitingIntakeId as string,
          documentId: r.documentId,
          // manual mode arrives with an empty prefill — seed the deep-linked
          // station so the human starts on the right one
          prefill: { ...r.prefill, swapStationId: r.prefill.swapStationId ?? initialStationId },
          nomeArquivo: r.nomeArquivo,
        });
      } else if (r.status === "confirmed") {
        setPhase({ kind: "error", message: "Contrato já confirmado." });
      } else if (r.status === "rejected") {
        setPhase({ kind: "error", message: "Contrato rejeitado." });
      } else if (Date.now() - awaitingSince > SLOW_AFTER_MS) {
        setSlow(true);
      }
    }

    void check();
    const id = setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [awaitingIntakeId, awaitingSince, initialStationId]);

  if (!canWrite) {
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Sem permissão</CardTitle>
          <CardDescription>
            Criar contratos requer papel de operador. Fale com um admin.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (phase.kind === "ready") {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="lg:sticky lg:top-6 lg:self-start">
          {phase.documentId ? (
            <PdfViewer documentId={phase.documentId} page={1} />
          ) : phase.casaVammo ? (
            <div className="rounded-lg border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Casa Vammo — sem PDF</p>
              <p className="mt-1">
                Casas Vammo são gratuitas e não têm contrato de locação em PDF.
                Preencha os dados ao lado e confirme.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">PDF indisponível.</p>
          )}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Revisar e confirmar</CardTitle>
            <CardDescription>
              {phase.casaVammo
                ? "Preencha os dados da Casa Vammo (gratuito). Ao confirmar, o contrato é criado — sem PDF."
                : "Confira cada campo extraído pela IA com o contrato ao lado. Ao confirmar, o contrato, o parceiro locador e a conta de aluguel são criados."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ContractIntakeFields
              intakeId={phase.intakeId}
              prefill={phase.prefill}
              stations={stations}
              // ContractIntakeFields already toasts "Contrato criado" via
              // useRunAction — just advance the flow here (no double toast).
              onConfirmed={() => setPhase({ kind: "done" })}
              submit={phase.casaVammo ? createCasaVammoContract : undefined}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (phase.kind === "done") {
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Check className="size-5 text-success-emphasis" strokeWidth={2.5} />
            Contrato criado
          </CardTitle>
          <CardDescription>
            O contrato, o parceiro locador e a conta de aluguel foram criados.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button render={<Link href="/alugueis" />}>Ver aluguéis</Button>
          <Button
            variant="outline"
            onClick={() => {
              setItem(null);
              setPhase({ kind: "idle" });
            }}
          >
            Novo contrato
          </Button>
        </CardContent>
      </Card>
    );
  }

  // idle / uploading / awaiting / error — the drop + progress card
  const isManual = mode === "manual";
  const isCasaVammo = mode === "casa_vammo";
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Enviar contrato</CardTitle>
        <CardDescription>
          {isCasaVammo
            ? "Casa Vammo é gratuita e não tem contrato em PDF — vincule a estação, preencha os dados e confirme."
            : isManual
              ? "Solte o PDF e preencha os dados do contrato na hora, sem esperar a extração — para vincular rápido um contrato a uma estação."
              : "Solte o PDF do contrato. Ele vai para o Drive e é extraído automaticamente; em seguida você revisa e confirma aqui mesmo."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {phase.kind === "idle" ? (
          <div className="inline-flex rounded-lg border border-border p-0.5 text-sm">
            <button
              type="button"
              onClick={() => setMode("extract")}
              className={
                mode === "extract"
                  ? "rounded-md bg-accent px-3 py-1.5 font-medium text-vammo-blue"
                  : "rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground"
              }
            >
              Extrair com IA
            </button>
            <button
              type="button"
              onClick={() => setMode("manual")}
              className={
                mode === "manual"
                  ? "rounded-md bg-accent px-3 py-1.5 font-medium text-vammo-blue"
                  : "rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground"
              }
            >
              Preencher manualmente
            </button>
            <button
              type="button"
              onClick={() => setMode("casa_vammo")}
              className={
                mode === "casa_vammo"
                  ? "rounded-md bg-accent px-3 py-1.5 font-medium text-vammo-blue"
                  : "rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground"
              }
            >
              Casa Vammo (sem PDF)
            </button>
          </div>
        ) : null}

        {isCasaVammo && phase.kind === "idle" ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Casas Vammo são gratuitas e não têm contrato de locação em PDF.
              Nada é enviado ao Drive — você vincula a estação e preenche os
              dados na próxima tela.
            </p>
            <Button
              onClick={() =>
                setPhase({
                  kind: "ready",
                  intakeId: "",
                  documentId: null,
                  prefill: casaVammoPrefill(initialStationId),
                  nomeArquivo: null,
                  casaVammo: true,
                })
              }
            >
              Continuar
            </Button>
          </div>
        ) : (
          <>
        <ol className="space-y-3">
          <Step
            icon={FileUp}
            title="Upload do contrato"
            state={phase.kind === "idle" ? "current" : "done"}
          />
          <Step
            icon={ScanText}
            title={isManual ? "Preencher os dados" : "Extração por IA"}
            state={
              phase.kind === "awaiting"
                ? "current"
                : phase.kind === "idle" || phase.kind === "uploading"
                  ? "todo"
                  : "done"
            }
            hint={
              phase.kind === "awaiting" && !isManual
                ? slow
                  ? "Está demorando mais que o normal — pode deixar aberto ou conferir depois em Revisão › Contratos."
                  : "Processando o documento…"
                : undefined
            }
          />
          <Step icon={ClipboardCheck} title="Revisar e confirmar" state="todo" />
        </ol>

        {phase.kind === "idle" ? (
          <UploadDropzone
            accept=".pdf,application/pdf"
            maxBytes={MAX_BYTES}
            items={item ? [item] : []}
            onFiles={(files) => files[0] && upload(files[0])}
            hint="PDF do contrato de locação (uma ou várias páginas)."
          />
        ) : null}

        {phase.kind === "uploading" || phase.kind === "awaiting" ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" strokeWidth={2} />
            {phase.kind === "uploading"
              ? "Enviando o PDF…"
              : isManual
                ? "Preparando o formulário…"
                : "Aguardando a extração da IA…"}
          </div>
        ) : null}

        {phase.kind === "error" ? (
          <div className="space-y-3">
            <p className="rounded-lg border border-error-subtle bg-error-subtle px-3 py-2 text-sm text-error-emphasis">
              {phase.message}
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setItem(null);
                setPhase({ kind: "idle" });
              }}
            >
              <RotateCw className="size-4" strokeWidth={2} />
              Tentar de novo
            </Button>
          </div>
        ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Step({
  icon: Icon,
  title,
  state,
  hint,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  state: "todo" | "current" | "done";
  hint?: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={
          state === "done"
            ? "flex size-8 shrink-0 items-center justify-center rounded-lg bg-success-subtle text-success-emphasis"
            : state === "current"
              ? "flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-vammo-blue"
              : "flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
        }
      >
        {state === "done" ? (
          <Check className="size-4" strokeWidth={2.5} />
        ) : state === "current" ? (
          <Loader2 className="size-4 animate-spin" strokeWidth={2} />
        ) : (
          <Icon className="size-4" strokeWidth={2} />
        )}
      </span>
      <div>
        <p className={state === "todo" ? "text-sm text-muted-foreground" : "text-sm font-medium"}>
          {title}
        </p>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      </div>
    </li>
  );
}
