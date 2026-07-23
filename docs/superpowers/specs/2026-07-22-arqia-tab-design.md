# ARQIA — monitoramento de SIMs IoT no Eletron

Spec da nova aba ARQIA, que traz o workflow n8n `Alerta - SIM_Data_Arqia` para dentro do app (reverte a decisão #13, "Arqia fica no n8n", por decisão do Gabriel 2026-07-22).

## Objetivo

O app passa a: buscar os SIMs IoT + consumo direto da API Arqia (gestaom2m), calcular o uso contra a quota pró-rata, alertar no Slack quando o uso passa do limite, exibir um gráfico do uso e o log de alertas, e permitir adicionar dados móveis comprados no mês (aumentando o limite daquele mês).

Escala atual: ~992 SIMs ativos, 300 MB/SIM de quota base (~290 GB/mês).

## Decisões (Gabriel, AskUserQuestion 2026-07-22)

1. Fonte de dados: o APP chama a API Arqia direto (substitui o n8n), num cron diário.
2. Slack: o APP também dispara os alertas no Slack (integração nova).
3. Compra de dados: o MB comprado SOMA ao limite do mês; reseta todo mês.

## O que o workflow n8n faz (referência)

Diário às 9h: login na API (`proxy.api.ip101.cloud/gestaom2m/login`) → lista SIMs do customer 101556 (`/contrato/listaSimcard`), filtra `NM_SAITRO_ACCOUNT === 'IOT FULL COMPARTILHADO'` → consumo por ICCID (`/contrato/statusConexaoPlataformatConsumo`, manda todos os iccids num POST) → mantém planilha de SIMs ativos/inativos (pra saber o `created_at` de cada um) → quota pró-rata (300 MB/SIM; SIM que entrou no mês pró-rateia por `(últimoDia - dia + 2)/últimoDia`) → uso % = consumo/quota → se > 70% (o nó rotulado "80%" na verdade compara com 70), manda Slack pra 4 pessoas.

## Modelo de dados (Supabase, schema `charging`, prefixo `arqia_`)

Reusa o `supabaseAdmin()` (db.schema='charging'), RLS + revoke/grant no padrão dos outros RPCs.

- `arqia_sims`: `iccid` (PK, text), `first_seen_on` (date — quando o app viu o SIM pela 1ª vez, base do pró-rata), `status` ('active'|'inactive'), `account_name` (text), `updated_at`. Substitui a planilha SIMArqia (seed inicial a partir do xlsx: 992 ativos, `first_seen_on` = `created_at`).
- `arqia_snapshots`: `snapshot_on` (date, UNIQUE), `sim_count` (int), `base_quota_mb` (numeric — pró-rata), `purchased_mb` (numeric — compras do mês até a data), `effective_quota_mb` (numeric), `consumption_mb` (numeric), `pct` (numeric), `created_at`. Rollup diário → alimenta o gráfico e a checagem de alerta.
- `arqia_data_purchases`: `id` (uuid), `competencia` (date, 'YYYY-MM-01'), `mb_added` (numeric > 0), `note` (text), `actor_email` (text), `created_at`. As compras manuais.
- `arqia_alerts`: `id` (uuid), `snapshot_on` (date), `pct`, `effective_quota_mb`, `consumption_mb`, `threshold` (numeric), `message` (text), `sent_to` (jsonb — destinatários), `slack_ok` (bool), `created_at`. Log dos alertas (painel "Slack alerts").

## Ingestão (cron diário)

- `lib/arqia/client.ts` (server-only): `arqiaLogin()`, `listSims()`, `getConsumption(iccids)` — encapsula o proxy ip101; credenciais via env; parse de unidade (KB/MB/GB → MB, base 1024) numa função pura + testada (`parseDataUnitMb`).
- `lib/arqia/quota.ts` (puro, testado): `proRataQuotaMb(sims, today)` — 300/SIM, pró-rata pro SIM com `first_seen_on` no mês corrente; espelha o `Calculate pro-rata-quota` do n8n.
- `lib/arqia/sync.ts`: `runArqiaSync(admin, now)` — login+lista+consumo → upsert `arqia_sims` (novo → active + `first_seen_on`=hoje; sumido → inactive) → base pró-rata + Σ compras do mês = quota efetiva → grava `arqia_snapshot` (1/dia, upsert em `snapshot_on`) → se `pct > threshold`, grava `arqia_alert` + dispara Slack. Degrada a no-op se as envs Arqia faltarem (retorna `unconfigured`, não quebra o cron).
- Encaixe no `/api/cron/daily` como mais um `step()` isolado (metabase-sync → alerts-eval → comprovantes → fiscal-send → **arqia-sync**), com lease `job_runs('arqia-sync')` (padrão #69). O cron roda 12:00 UTC = 09:00 BRT (bate com o n8n).

## Slack (integração nova no app)

- `lib/slack/send.ts` (server-only): `sendSlackDM(userId, text)` via `chat.postMessage` (`SLACK_BOT_TOKEN`); best-effort (falha não derruba o sync; `slack_ok` registra). Sem token → no-op.
- Destinatários por env `ARQIA_ALERT_SLACK_USERS` (csv de user IDs); default = os 4 do workflow (Edgard `U0A42QX2EJG`, JP `U083SU00P0V`, Francisco `U0AGGA84WAH`, GMB) se a env não vier — mas o TOKEN é obrigatório pra enviar.

## Quota + botão "Adicionar dados móveis no mês"

- Limite efetivo do mês = pró-rata (300 MB/SIM) + Σ `arqia_data_purchases` da competência corrente.
- RPC `create_arqia_data_purchase(p_mb numeric, p_note text)` (SECURITY DEFINER, `is_vammo_user()`, competência = mês corrente, `mb_added > 0`, 1 audit_event). O uso % recalcula contra o limite maior no próximo snapshot (e no card ao vivo).
- Botão na aba abre diálogo (input MB + nota) → chama a RPC → revalida.

## UI — aba /arqia

- Item "ARQIA" na sidebar (`nav-items`).
- KPIs (StatCard): SIMs ativos · Quota do mês (GB) · Consumo (GB) · Uso % · % do mês decorrido.
- Gráfico (Recharts, `dataviz`/Vammo DS): consumo vs limite efetivo (MB/GB) por dia do mês, a partir de `arqia_snapshots`; linha do uso %. Fallback "sem dados ainda".
- Painel de alertas: lista de `arqia_alerts` (data, %, mensagem, destinatários, ok/falha Slack).
- Botão "Adicionar dados móveis no mês" + "Sincronizar agora" (dispara `runArqiaSync` on-demand, gated a operador) + FreshnessDot do último snapshot.
- Cópia pt-BR, Vammo DS Product track.

## Pré-requisitos do Gabriel (secrets — env no Vercel; eu NÃO faço source deles)

- `ARQIA_LOGIN`, `ARQIA_PASSWORD` (⚠️ ROTACIONAR — está em texto puro no workflow), `ARQIA_API_KEY`, `ARQIA_CUSTOMER_ID` (=101556), opcional `ARQIA_ACCOUNT_FILTER` (default 'IOT FULL COMPARTILHADO'), `ARQIA_ALERT_THRESHOLD` (default 70).
- `SLACK_BOT_TOKEN` (bot com `chat:write`), `ARQIA_ALERT_SLACK_USERS` (csv de IDs; default os 4).
- Migration aplicada em prod + seed dos 992 SIMs a partir do xlsx (via MCP no cutover).
- Enquanto as envs faltarem: o cron no-opa (`unconfigured`), a aba mostra "não configurado", nada quebra.

## Segurança

- Nenhuma credencial no código/repo; tudo via `process.env`, documentado no `.env.example`.
- A senha atual do workflow deve ser rotacionada (exposta em texto puro no JSON).
- RPC de escrita gated (`is_vammo_user()`); leitura aberta a @vammo.com (P1). Slack e API Arqia só server-side.

## Fases

1. Migration + seed + tipos/domínio.
2. `lib/arqia/*` (client, quota puro+testes, sync) + `lib/slack/send`.
3. Cron step + lease.
4. RPC compra + action.
5. Aba /arqia (KPIs, gráfico, alertas, botões) + nav.
6. Gates + decisão #73 + `.env.example` + commit/push. Ativa quando o Gabriel setar as envs + rotacionar a senha.

## Alternativas consideradas (rejeitadas)

- n8n mantém o fetch e faz POST pro app (menor risco/segredo) — Gabriel preferiu o app dono.
- Só exibir alerta no app e Slack fica no n8n — Gabriel quis o app mandando Slack.
- Ler a planilha SIMArqia (sheets severed #25; e não tem consumo) — dados vão pro Supabase.
- Compra SUBSTITUI o limite — Gabriel quis SOMAR ao pró-rata.
