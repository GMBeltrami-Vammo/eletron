# Vincular comprovante — matcher cobrança→comprovante (2026-07-17)

## Problema

Hoje o único fluxo de vínculo manual é comprovante→cobrança (a fila /revisão › Comprovantes).
Quando o time olha uma cobrança específica com o Comprovante em branco, não há um jeito direto de dizer "vincule um dos comprovantes soltos deste valor a esta cobrança".
Gabriel: partindo da coluna Comprovante em branco, um botão "Vincular" abre uma janela com os comprovantes daquele valor para resolver cada caso individualmente.

## Decisões do Gabriel (AskUserQuestion 2026-07-17)

1. Candidatos = **só comprovantes ainda sem vínculo** (não os já vinculados a outras faturas).
2. Escopo = **toda coluna de comprovante em branco** ganha a opção (não só a aba Pagamentos da estação).
3. Casamento por valor = **±R$0,50** (mesma janela do matcher #58 e do filtro por valor #60).

## Arquitetura — um componente reusável, em todo lugar

`ComprovanteCell` (client, `components/vammo/comprovante-cell.tsx`) substitui o trecho `summary ? <ComprovanteChip/> : "—"` em cada coluna de comprovante:

- comprovante vinculado (`summary`) → o `<ComprovanteChip>` de sempre (inalterado);
- em branco, com `dedupeKey` + `amount` → botão **"Vincular"** que abre o `BindComprovanteDialog`;
- em branco sem chave/valor (modo sheets, sem uuid resolvível) → `"—"` (degrada).

A chave universal é o **`dedupe_key`** (o `Charge.id` do domínio, sintético — confirmado em `supabase-repository.ts`), presente em toda linha (`charge.dedupeKey` / `FaturaRow.chargeId` / `RentChargeRow.id` / `PagamentoRow.chargeId`).
O loader resolve `dedupe_key` → uuid do banco server-side; a UI nunca precisa do uuid.

### Colunas atingidas (5 sites)

- Estação › Pagamentos (`components/estacao/payments-tab.tsx`) — o caso citado.
- Estação › Energia faturas (`components/energia/faturas-table.tsx`).
- `/alugueis/[cadastroId]` (`components/alugueis/rent-charges-table.tsx`).
- `/pagamentos` ledger (`components/pagamentos/pagamentos-view.tsx`) — abas Enel/EDP + Locação.
- `/pagamentos` drawer (`components/pagamentos/pagamento-drawer.tsx`).

O drawer de histórico read-only (`instalacao-history.tsx`) continua só-chip.

## O dialog (`BindComprovanteDialog`)

Props: `{ dedupeKey, chargeAmount, onClose }`.
Ao abrir, chama a server action `loadBindCandidates(dedupeKey)`.

- **Cabeçalho** = a cobrança: valor · método · chave PIX (se pix) / banco + agência/conta (se transferência) · sempre o CNPJ (issuer_cnpj, com fallback ao counterparty) · competência/vencimento/estação.
- **Lista** = comprovantes ainda sem vínculo com valor a ±R$0,50 do valor da cobrança, um por linha: nome do arquivo + valor + data + tipo + recebedor (chave/CNPJ) + banco/ag/conta + link "ver".
- Vazio → "Nenhum comprovante solto com esse valor (±R$0,50)".

**Vincular** = `recordPayment({ chargeId: <uuid do cabeçalho>, receiptId, amount: <valor da cobrança>, paidAt: <data do comprovante>, method })` — o chokepoint manual que já existe (RPC `record_payment`): a cobrança vira `pago` (#29) e o vínculo é gravado no `manual_match_log` (#60).
Zero RPC novo.

## A server action `loadBindCandidates` (`app/actions/bind-comprovante.ts`)

Leitura session-gated (`getSessionEmail`) via `supabaseAdmin` (as policies de `receipts`/`payments` não cobrem leitura RLS — mesmo padrão dos deep-dives).
Degrada a `{ available:false }` sem env Supabase.

1. Resolve a cobrança por `dedupe_key` (único, #6) → uuid + campos do cabeçalho (+ nome da estação + CNPJ do counterparty quando `issuer_cnpj` nulo).
2. Candidatos: `receipts` com `amount` em `[valor-0,50, valor+0,50]` e **sem `payment` vinculado** (nenhuma linha em `payments` com aquele `receipt_id`).
   "Sem vínculo" (Gabriel) = sem pagamento; um recibo `rejected` (descartado em lote, #43) continua não-vinculado e pode ter virado o match certo pós-#44, então NÃO é escondido.
   Junta `documents.original_filename` + `web_view_link`.
   Ordena por `paid_at` desc, cap de 200 (flag `truncated` surfada — sem cap silencioso).

## Comportamentos aceitos

- Faturas de energia em débito automático também mostram "Vincular", mas a lista virá vazia (não há comprovante solto do valor delas) → auto-limita.
  Um bind manual aqui é decisão humana registrada, acima da trava DA×manual do #58 (que é só do auto-matcher).
- Fluxo cobrança→comprovante, complementar (não substitui) a fila comprovante→cobrança de /revisão.
- Escrita (o bind) segue pelo `recordPayment`/`withOperator` (gate de operador); a leitura dos candidatos é aberta a qualquer @vammo.com (P1).

## Fora de escopo

- Vincular por valor divergente (juros/multa) — o dialog é escopado por valor; casos de valor diferente seguem na fila /revisão.
- Desvincular — já existe (`unmatch_payment`, o chip/deep-dive).
- Pareamento N↔N automático — segue humano-confirmado (#43/#44).
