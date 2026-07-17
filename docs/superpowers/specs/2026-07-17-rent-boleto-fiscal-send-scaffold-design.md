# Envio de boleto/aluguel ao fiscal — scaffold DORMANTE (2026-07-17)

## Pedido

Gabriel: "quando um boleto é aprovado para pagamento, mande também para a planilha fiscal.
Uma entrada por estação, repetindo o documento quando necessário.
Por ora, NÃO envie para a planilha — deixe o scaffold pronto."

Isto ESTENDE o fluxo fiscal, que hoje é só-energia (#40/#42, linha de 12 colunas, DA-aware, disparado de /energia).

## Decisões (AskUserQuestion 2026-07-17)

1. Rateio (energia+aluguel): **aluguel = valor_mensal do contrato**, **energia = total − aluguel**; as % vêm daí.
2. Escopo: **tudo** — aluguel, aluguel+energia E energia pura passam por este envio ao aprovar (a reconciliar com o #42 para não enviar a mesma fatura duas vezes quando for habilitado).
3. Planilha: **a mesma** (`FISCAL_SPREADSHEET_ID`), aba por mês do vencimento (`MM-YYYY`), igual ao #42.

## Layout da linha (11 colunas)

Ordem exata do Gabriel, em `lib/fiscal/rent-fiscal-row.ts` (`buildRentFiscalRow`, puro, unit-testado):

| Col | Conteúdo |
|---|---|
| A | date_sent — `DD/MM/YYYY` |
| B | `Boletos outros bancos` (fixo — boleto nunca é DA) |
| C | Parceiro (razão social do counterparty) |
| D | Valor — `1.020,00` (`.` milhar, `,` centavos) |
| E | Nota Fiscal |
| F | `Aluguel - Mensalidade Box Vammo - {competência MM/YYYY} - {endereço}` |
| G | due date — `DD/MM/YYYY` |
| H | categoria (varia por tipo) |
| I | COGS (varia por tipo) |
| J | `=HYPERLINK("{link}";"Documento")` |
| K | `Enviada via Eletron - Aguardando validaçao Fiscal` |

Variação de H/I por tipo:

- **aluguel**: H `402: Charging Infra/Energy: Cabinets Real Estate` · I `COGS - 402: …`.
- **energia**: H `401: Charging Infra/Energy: Electricity` · I `COGS - 401: …`.
- **aluguel_energia**: H = I = o Rateio, ex.: `Rateio CC401 Energia R$ 3.985,20 (80%) CC402 Aluguel R$ 1.020,00 (20%)` — energia = total − valor_mensal, aluguel = valor_mensal, % arredondadas.

Uma linha POR ESTAÇÃO; um ND multi-estação repete o link do documento (o caller emite um input por cobrança).

## Orquestrador DORMANTE

`lib/fiscal/send-rent-fiscal.ts` — `RENT_FISCAL_SEND_ENABLED = false`.
`sendRentFiscalRows(sheets, spreadsheetId, inputs)` monta as linhas, agrupa por aba de mês do vencimento e — SÓ quando habilitado — dá `values.append` (com guarda de locale pt-BR, igual #42).
Enquanto desligado, devolve as linhas montadas (`rowsByTab`) SEM tocar na planilha.

## Pendências para habilitar (documentadas no módulo)

1. Flipar `RENT_FISCAL_SEND_ENABLED`.
2. Data-prep por cobrança → `RentFiscalRowInput` (parceiro, valor, NF, competência, endereço da estação, vencimento, link do documento, valor_mensal do contrato p/ o rateio).
3. Gatilho: chamar no caminho de aprovação (`ApproveCobrancaDialog` → reclassify), best-effort, após aprovar.
4. Guardas antes de gravar (espelhar #42): trava de ano (só 2026, ≥2027 bloqueia), pular vencidas, ler a planilha p/ evitar duplicatas; reconciliar energia pura com o #42.
5. Confirmar: o formato da competência (F = `MM/YYYY`) e se a descrição F deve mudar para energia pura (hoje usa o texto de aluguel para todos os tipos, conforme o spec literal).

## Fora de escopo (agora)

Qualquer WRITE na planilha (dormante), o gatilho ao vivo, e a data-prep a partir do banco — tudo deixado pronto/documentado para o enable.
