import type { Metadata } from "next";
import Link from "next/link";
import { FileCheck } from "lucide-react";

import { BackLink } from "@/components/revisao/back-link";
import { Phase2Button } from "@/components/revisao/phase2-button";
import { PageHeader } from "@/components/vammo/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Comprovantes não conciliados" };

/**
 * Phase 2 placeholder: the receipt-reconciliation queue needs the Supabase
 * backbone (upload, parsing, matcher). Until then the n8n Drive flow keeps
 * processing comprovantes.
 */
export default function ComprovantesRevisaoPage() {
  return (
    <div>
      <BackLink />
      <PageHeader
        title="Comprovantes não conciliados"
        description="Fila de conciliação de comprovantes de pagamento"
      />
      <Card className="max-w-xl">
        <CardContent className="flex flex-col items-start gap-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <FileCheck className="size-6" strokeWidth={2} />
            <span className="text-sm font-medium">Disponível na fase 2</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Esta fila chega junto com o banco de dados e o fluxo de upload de
            comprovantes no app: você vai ver a página do PDF, os campos
            extraídos e os candidatos de cobrança para conciliar. Por enquanto,
            os comprovantes continuam sendo processados pelo fluxo atual no
            n8n.
          </p>
          <div className="flex items-center gap-2">
            <Phase2Button>Enviar comprovante</Phase2Button>
            <Button variant="ghost" size="sm" render={<Link href="/revisao" />}>
              Voltar para revisão
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
