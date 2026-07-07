import Link from "next/link";
import { ArrowLeft, ClipboardCheck, FileUp, ScanText } from "lucide-react";

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

export const metadata = { title: "Novo contrato" };

const STEPS = [
  {
    icon: FileUp,
    title: "Upload do contrato",
    description:
      "Você envia o PDF do contrato (aceita múltiplas páginas — o documento inteiro vai para a extração).",
  },
  {
    icon: ScanText,
    title: "Extração por IA",
    description:
      "Os ~25 campos do cadastro (parceiro, CNPJ, modalidade, valores, vencimento, dados bancários, vigência) são extraídos automaticamente.",
  },
  {
    icon: ClipboardCheck,
    title: "Formulário revisável",
    description:
      "Você revisa cada campo com o PDF lado a lado antes de criar o contrato — nada é salvo sem confirmação humana.",
  },
];

export default function NovoContratoPage() {
  return (
    <div>
      <PageHeader
        title="Novo contrato"
        description="Onboarding de contratos de locação"
        actions={
          <Button variant="outline" render={<Link href="/alugueis" />}>
            <ArrowLeft className="size-4" strokeWidth={2} />
            Voltar
          </Button>
        }
      />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Fluxo de onboarding</CardTitle>
          <CardDescription>
            O cadastro de novos contratos chega na fase 3, substituindo o
            formulário atual do Google Forms.
          </CardDescription>
          <CardAction>
            <StatusBadge color="grey" outline>
              Fase 3
            </StatusBadge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ol className="space-y-4">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <step.icon className="size-4" strokeWidth={2} />
                </span>
                <div>
                  <p className="text-sm font-medium">
                    {index + 1}. {step.title}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
        <CardFooter>
          <span title="Disponível na fase 3">
            <Button disabled>Criar contrato</Button>
          </span>
        </CardFooter>
      </Card>
    </div>
  );
}
