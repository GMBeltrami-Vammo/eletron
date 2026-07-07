"use client";

import { ExternalLink, FileText } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/vammo/status-badge";
import { formatCompetencia } from "@/lib/format";
import type { Station360 } from "@/lib/data/repository";
import { CHARGE_KIND_UI } from "@/lib/labels";

import { EmptyState } from "./empty-state";
import { accountKeyLabel } from "./helpers";

interface DocumentRef {
  url: string;
  /** 'Fatura' (mirrored bill PDF) or 'Documento' (other Drive link). */
  kind: "fatura" | "documento";
  context: string;
}

/**
 * Every distinct document reference reachable from this station's data:
 * energy-detail fatura links + Drive links present on charge payloads.
 * URL detection is structural (https?://…drive/docs host), not pt-BR parsing —
 * the normalize.ts quarantine stays intact.
 */
export function DocumentsTab({ data }: { data: Station360 }) {
  const chargeById = new Map(data.charges.map((c) => [c.id, c]));
  const accountEntryById = new Map(
    data.accounts.map((a) => [a.account.id, a]),
  );

  const seen = new Set<string>();
  const docs: DocumentRef[] = [];

  for (const details of data.energyDetails) {
    if (!details.faturaDriveUrl || seen.has(details.faturaDriveUrl)) continue;
    seen.add(details.faturaDriveUrl);
    const charge = chargeById.get(details.chargeId);
    const entry = charge?.billingAccountId
      ? accountEntryById.get(charge.billingAccountId)
      : undefined;
    docs.push({
      url: details.faturaDriveUrl,
      kind: "fatura",
      context: [
        entry ? accountKeyLabel(entry) : null,
        charge?.competencia ? formatCompetencia(charge.competencia) : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }

  for (const charge of data.charges) {
    for (const value of Object.values(charge.raw)) {
      if (!isDriveUrl(value) || seen.has(value)) continue;
      seen.add(value);
      docs.push({
        url: value,
        kind: "documento",
        context: [
          CHARGE_KIND_UI[charge.kind].label,
          charge.competencia ? formatCompetencia(charge.competencia) : null,
        ]
          .filter(Boolean)
          .join(" · "),
      });
    }
  }

  if (docs.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="Nenhum documento vinculado"
        description="Links de faturas e comprovantes aparecem aqui conforme são coletados. O upload direto de documentos chega na fase 2."
      />
    );
  }

  return (
    <Card size="sm">
      <CardContent>
        <ul className="divide-y divide-border">
          {docs.map((doc) => (
            <li key={doc.url} className="flex items-center gap-3 py-2 text-sm">
              <StatusBadge color={doc.kind === "fatura" ? "blue" : "grey"}>
                {doc.kind === "fatura" ? "Fatura" : "Documento"}
              </StatusBadge>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {doc.context || "—"}
              </span>
              <a
                href={doc.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-info-emphasis hover:underline"
              >
                Abrir
                <ExternalLink className="size-3" strokeWidth={2} aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function isDriveUrl(value: string): boolean {
  if (!/^https?:\/\/\S+$/.test(value)) return false;
  try {
    const host = new URL(value).hostname;
    return host === "drive.google.com" || host === "docs.google.com";
  } catch {
    return false;
  }
}
