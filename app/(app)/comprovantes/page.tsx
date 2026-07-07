import { FileUp, GitMerge, Inbox, ScanLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/vammo/page-header";
import { StatusBadge } from "@/components/vammo/status-badge";

export const metadata = { title: "Comprovantes" };

const FEATURES = [
  {
    icon: FileUp,
    title: "Upload de comprovantes",
    description:
      "Envio de PDFs com múltiplas páginas — cada página vira um comprovante, com dedupe por hash em reenvios.",
  },
  {
    icon: ScanLine,
    title: "Parser automático",
    description:
      "Extração de valor, data e chave de comprovantes PIX, TED, débito automático e boleto (código de barras).",
  },
  {
    icon: GitMerge,
    title: "Conciliação automática",
    description:
      "Cada comprovante é casado com a cobrança correspondente por valor, chave/CNPJ e janela de datas.",
  },
  {
    icon: Inbox,
    title: "Fila de revisão",
    description:
      "Comprovantes ambíguos ou sem correspondência caem em uma fila de revisão — nada é conciliado sem confirmação humana.",
  },
];

export default function ComprovantesPage() {
  return (
    <div>
      <PageHeader
        title="Comprovantes"
        description="Inbox de comprovantes de pagamento"
      />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Disponível na fase 2</CardTitle>
          <CardDescription>
            Este módulo substitui o fluxo atual do n8n
            (PDF_Comprovante_Processor) que monitora a pasta do Drive — com
            resultados visíveis e idempotentes.
          </CardDescription>
          <CardAction>
            <StatusBadge color="grey" outline>
              Fase 2
            </StatusBadge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ul className="space-y-4">
            {FEATURES.map((feature) => (
              <li key={feature.title} className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <feature.icon className="size-4" strokeWidth={2} />
                </span>
                <div>
                  <p className="text-sm font-medium">{feature.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
        <CardFooter>
          <span title="Disponível na fase 2">
            <Button disabled>
              <FileUp className="size-4" strokeWidth={2} />
              Enviar comprovantes
            </Button>
          </span>
        </CardFooter>
      </Card>
    </div>
  );
}
