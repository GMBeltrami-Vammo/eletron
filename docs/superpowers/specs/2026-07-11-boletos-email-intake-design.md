# Boletos por e-mail — intake, fila "A pagar" e conciliação ND↔banco

Data: 2026-07-11.
Status: design aprovado nas decisões-chave (proposta automática + confirmação humana; sem integração bancária; e-mails de teste virão com corpo; regra única de competência dia 20 — decisão #45); implementação aguarda os boletos de teste do Gabriel.
Referências: decisões #27 (webhook de cobranças), #38 (aprendizado de remetente), #43/#44 (matcher GT-calibrado), #45 (competência dia 20), n8n `boleto_aluguel` (context/boleto_aluguel.json).

## Regra de competência (decisão #45, confirmada)

UMA regra para "a que mês pertence esta data": data em [20/MM, 20/MM+1) → competência MM.
Vale para a data de pagamento (pin do matcher, #44) E para o fallback de classificação por vencimento (IA 2 do n8n, prompt v2).
A competência declarada no documento sempre vence o fallback.
App-side, a função canônica é `pinnedCompetencia` (lib/comprovantes/match.ts) — as Peças 1–2 reusam-na, nunca reimplementam.

## Problema

Locadores e fornecedores enviam cobranças por e-mail para parceiros@vammo.com em formatos variados: boletos, notas de débito (ND), faturas.
Qualquer PDF anexado é provavelmente relevante e provavelmente deve ser pago.
Alguns documentos são impossíveis de vincular na chegada — a DIA envia boletos só com valor, e semanas depois uma ND conciliando os valores às estações.
Hoje o fluxo n8n `boleto_aluguel` extrai (LlamaParse + 2 IAs), casa contra a planilha 1_Cadastro e faz append no 2_Pagamentos — a planilha está severed (#25) e o append morre com ela.

## Fronteira n8n ↔ app (mesma filosofia de #27/#30)

O n8n MANTÉM: Gmail trigger (parceiros@, PDF anexo), extração de contexto do e-mail (remetente + e-mails no corpo + texto limpo), detecção de PDF com senha (aviso Slack ao Fabricio continua), LlamaParse, IA 1 (extração) e IA 2 (reconciliação), upload do PDF ao Drive.
O n8n TROCA apenas o nó final: append no 2_Pagamentos → `POST /api/ingest/cobrancas` (Bearer `N8N_INGEST_SECRET`) — o webhook da decisão #27, que já existe e já aceita: `cobrancas[]` (múltiplas por documento), `drive_file_id` (o app baixa o PDF e cria a linha em `documents`), linha digitável, remetente, dedupe por documento.
Toda cobrança ingerida continua caindo `needs_review` (#27) e a reclassificação continua aprendendo o remetente (#38).

## Peça 1 — Fila "A pagar" (/pagamentos)

Nova visão operacional sobre as cobranças abertas: o que vence hoje/esta semana, ordenado por vencimento.
Cada linha mostra: vencimento, valor, contraparte/remetente, estação (ou "sem estação"), método, e a **linha digitável copiável em um clique** (o pagamento é executado manualmente no banco — sem integração bancária).
Cobranças `unidentified` (sem estação — caso DIA) APARECEM na fila: são pagáveis mesmo sem identidade; um affordance "identificar" abre o fluxo de revisão.
Pagou no banco → o comprovante volta pelo fluxo já existente → matcher dá a baixa (`pago` ⟺ comprovante, #29/#44).

## Peça 2 — O "banco" e a conciliação ND↔boletos

O "banco" = as cobranças `unidentified`/`needs_review` acumuladas (valor, vencimento, linha digitável, remetente, PDF), pagáveis e à espera de identidade.
Quando um documento multi-linha (ND) chega do mesmo remetente/CNPJ, o app NÃO cria cobranças duplicadas às cegas: roda um pareamento **proposto automaticamente e confirmado por humano em 1 clique** (decisão do Gabriel), no padrão visual do "Resolver grupo" (#43):

1. Na ingestão de um documento com N linhas, o app calcula propostas: linhas da ND × cobranças do banco do mesmo remetente/CNPJ com valor igual (tolerância por contraparte).
2. O painel "Conciliações propostas" em /revisão/cobranças lista cada par (linha da ND → boleto do banco) com os dois documentos linkados (PDF da ND + PDF do boleto).
3. Confirmar aplica a identidade da linha da ND ao boleto existente: estação/cadastro/competência via RPC auditado; o boleto (que tem a linha digitável) continua sendo a cobrança pagável; a ND fica registrada como documento de identificação (audit + nota), sem criar cobrança nova para a linha casada.
4. Linhas da ND SEM par no banco viram cobranças normais (needs_review), como hoje.
5. A ordem inversa funciona igual: se a ND chegou primeiro (cobranças identificadas mas sem linha digitável), um boleto novo de mesmo remetente+valor gera a proposta de anexar a linha digitável/documento à cobrança existente.

Regra geral (não específica de DIA): remetente/CNPJ igual + valor igual é o sinal; a confirmação é humana porque valor-only é evidência fraca (um auto errado é pior que um clique).

## Peça 3 — Candidatos do app para a IA (substitui a leitura da 1_Cadastro)

A IA 2 do n8n hoje pré-casa contra a planilha 1_Cadastro (por e-mail no corpo) e usa uma tool de sheet como fallback — a planilha vai driftar após o sever.
Novo endpoint read-only `GET /api/ingest/cadastro-candidates?emails=a,b` (Bearer `N8N_INGEST_SECRET`): devolve contratos ativos + contrapartes (cadastro_id, estação, nome, CNPJ, e-mail, valor mensal, banco/agência/conta/chave) filtrados pelos e-mails do corpo, no mesmo shape que o prompt da IA 2 espera.
O n8n troca os nós de sheet por este endpoint; a IA passa a casar contra a verdade viva do app.
Fase 2 opcional — pode ir depois do resto.

## O que NÃO muda

Sem integração bancária (pagamento manual no banco).
`record_payment`/`pago` continuam exigindo comprovante (#29).
PDF com senha: pipeline já marca "protegido por senha" (needs_review); aviso Slack continua no n8n.
Dedupe: `content_hash` no documento + linha digitável única (#6) + dedupe key por documento (#27) — reenvios não duplicam.

## Implementação (quando os boletos de teste chegarem)

1. Validar o payload real do n8n contra o schema atual do webhook com os e-mails de teste (com corpo); estender campos se faltar algo (ex.: vencimento por cobrança).
2. Peça 1: fila "A pagar" (query + tab em /pagamentos + copy da linha digitável).
3. Peça 2: `buildNdProposals` puro (unit-testado) + painel de propostas + RPC `identify_charge_from_nd` (auditado, guards).
4. Peça 3 (opcional/fase 2): endpoint de candidatos.
5. Gates de sempre + GT harness intactos; testar de ponta a ponta com os boletos reais da DIA (boleto → banco → ND → propostas → 1 clique → fila A pagar → comprovante → baixa).

## Pendências operacionais (fora do repo)

Trocar o nó final do n8n para o webhook (Gabriel).
Q6 continua: a chave LlamaParse está hardcoded também neste workflow — mover para credencial do n8n.
