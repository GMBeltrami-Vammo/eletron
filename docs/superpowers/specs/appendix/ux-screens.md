# Eletron — Product/UX Design (Information Architecture + Screens)

**Track:** Vammo DS **Product track** (per `eletron/.agents/skills/vammo-design/SKILL.md` §02): Inter, sentence case, 8 px radius on buttons/inputs and 12 px on cards, grayscale base `#F2F2F2` page / `#FFFFFF` cards / primary `#18181b`, accent Neon Blue `#2EC2FF`, **exception alert palette** for all status semantics (success `#66BA50`, error `#DB4841`, warning `#EFE133`, info `#0BA1F6` — DS README §07, correct choice for a finance/BackOffice surface), Lucide icons 24×24 `strokeWidth={2}` (§09), `tabular-nums` on every numeric column (§08), pt-BR copy, informal "você", no emoji (§13). Currency `R$ 6.502,34`, dates `24/04/2026` in tables (receipt style), 24h times.

**Component sourcing rule:** import from `@leopardaelectric/vammo-ui` (v4.38.0, GitHub `leopardaelectric/vammo-ui`, reference impl `leopardaelectric/coupons-dashboard`) everything it already ships — `Sidebar` (NavLogo + NavMain + NavUser lockup), `PageHeader` (title + right-aligned actions), `TableControls` (search / column visibility / configs / refresh), the paginated table shell, `StatCard`, and its **10-color badge palette** (per the backoffice ui_kit README: blue/yellow/green/orange/grey/red/dark-green…). Use bare shadcn/ui only for primitives vammo-ui doesn't cover: `Dialog`, `Sheet`, `Tabs`, `Command` (⌘K palette), `Form` + zod, `Tooltip`, `Popover`, `Calendar`, `Skeleton`, `Toast/Sonner`, `HoverCard`. This is the first Desktop/Vammo project to actually consume vammo-ui (SKILL.md flags that VammoGrid/goBuy don't — Eletron should be the one that does). Tables: TanStack Table v8 + TanStack Query (VammoGrid convention). Charts: Recharts.

---

## 1. Navigation structure and page map (App Router)

Persistent left sidebar (vammo-ui `Sidebar`), collapsible to icons; NavUser at bottom with Google avatar + sign-out. Badge counts (small red `#DB4841` pills) live on **Revisão** and **Alertas** nav items, fed by one `alert_counts` query polled by TanStack Query (`refetchInterval: 60s`). Global ⌘K `Command` palette searches stations by id, name, address, enel_id/UC, partner name, CNPJ from any page. Mobile (<768px): sidebar becomes a bottom sheet; **Leituras** is the mobile-first surface.

```
/login                              — Google OAuth (@vammo.com), Vammo_Logo_Black.svg, minimal card
/                                   — redirect → /estacoes

/estacoes                           — Stations dashboard (list + KPIs)          [nav: Estações]
/estacoes/[id]                      — Station 360° detail (tabbed)

/energia                            — Energy: all installations + invoices      [nav: Energia]
/energia/instalacoes/[key]          — Installation detail (enel_id or UC) — usually reached via station tab

/alugueis                           — Rent contracts list                       [nav: Aluguéis]
/alugueis/[cadastroId]              — Contract detail
/alugueis/novo                      — Contract onboarding (upload → AI → form)

/pagamentos                         — Monthly payables ledger (2_Pagamentos successor) [nav: Pagamentos]
/comprovantes                       — Comprovante inbox: upload + auto-match results   [nav: Comprovantes]

/leituras                           — Manual meter readings (list + matrix)     [nav: Leituras]
/leituras/nova                      — Mobile capture flow (photo mandatory)

/revisao                            — Review queues hub (4 queues, tabbed)      [nav: Revisão · badge]
  /revisao/comprovantes             —   unmatched receipts
  /revisao/cobrancas                —   UNIDENTIFIED charges from email ingestion
  /revisao/irregularidades          —   station without contract / contract without station
  /revisao/instalacoes              —   unmatched utility installations (Unidentified)

/alertas                            — Alerts panel, 6 categories                [nav: Alertas · badge]

/admin                              — Settings hub                              [nav: Configurações]
  /admin/mapeamentos                —   DIA store↔station map, Hubees address map, SPE CNPJ map
  /admin/ingestao                   —   ingestion sources health (Gmail, Drive, scraper sheet sync)
  /admin/auditoria                  —   audit-events log (goBuy finance.request_events pattern)
```

**Every n8n workflow has a home:** VencidasEnelWarning → `/alertas` (Vencidas category) + overdue badges on `/estacoes`; SStation Warnings → `/alertas` (all 6 categories); PDF_Comprovante_Processor → `/comprovantes` + `/revisao/comprovantes`; boleto_aluguel → `/pagamentos` (ingested rows) + `/revisao/cobrancas`; Fill_Cadastro_Form → `/alugueis/novo`; SStation_without_contract → `/revisao/irregularidades`; Arqia SIM → out of scope (stays in n8n, per plan).

---

## 2. `/estacoes` — Stations dashboard

Dense, Metabase-refugee-friendly. One row per **station** (aggregating its 1–N billing accounts), everything visible without clicking.

**Section A — KPI strip** (vammo-ui `StatCard` × 7, single row, horizontally scrollable under 1280px). Each card: big tabular number, small delta/sublabel, click = applies the corresponding filter to the table below:
1. Estações ativas (`ACTIVE` count / total)
2. Faturas vencidas (count + `R$` sum, red accent) — the VencidasEnelWarning number
3. A vencer 7 dias sem débito automático (orange)
4. Sem débito automático (count of installations `Não cadastrado`, normalized)
5. Pagamentos pendentes no mês (rent ledger rows not Pago + `R$` sum)
6. Scraper: última coleta (relative time of max `scraping_time`; turns yellow >26h, red >48h — ENEL runs daily ~02:00 BRT; EDP shows its own, possibly weeks-stale, timestamp in a sub-line)
7. Em revisão (sum of the 4 review queues, links to `/revisao`)

**Section B — Table** (vammo-ui `TableControls` + table shell; TanStack Table with `columnVisibility`, `sorting`, `columnFilters`, fuzzy `globalFilter`, sticky header, pagination 50/100/all, CSV export button in TableControls). Server-side via Supabase RPC once row counts grow; client-side is fine at 300 rows.

Columns (default visible → the rest behind the column-visibility menu, "excess of information" satisfied via toggles, not truncation):
| Column | Notes |
|---|---|
| `swap_station_id` | monospace-ish tabular, link to detail |
| Nome / Endereço | two-line cell, station name bold + address muted 12px |
| Status locação | badge: ACTIVE green / INACTIVE grey / DECOMMISSIONED dark / PRE_INSTALLATION blue (vammo-ui badge palette) |
| Fontes | compact icon chips: ⚡Enel ×n, ⚡EDP ×n, 🏠Aluguel, 🤝Terceiro (Hubees/DIA/KC/Condo), 📷Leitura manual — Lucide `zap/home/handshake/camera` |
| Status fatura energia | worst-of badges across the station's installations: Vencida red / Pendente yellow / A Vencer blue / Paga green / Em Compensação grey / Fatura negociada orange / Sem contas grey-outline / N/A muted. Tooltip lists per-installation status |
| Vencimento próximo | earliest open due_date, red if past, `dd/mm` |
| Última fatura (R$) | sum of latest bill values, tabular-nums right-aligned |
| Débito automático | Cadastrado green check / Não cadastrado red / Parcial (mixed installations) orange |
| Aluguel (mês) | rent status for current month: Pago / Pendente / Atrasado / Boleto recebido / Antecipado / N/A (5_Listas Status_Pgto enum, color-coded) |
| Contrato | Tipo_Contrato badge (Por box / Fixo / Por box c/ mínimo / Gratuito / Casa Vammo) + valor mensal; red "Sem contrato" badge when station is live in Metabase with no cadastro |
| Última coleta | relative time per station (min of its installations' `scraping_time`); dot indicator green/yellow/red |
| Desligamento programado | ⚡ orange badge with date if `shutdown_date` within 7 days |
| Hidden by default | lat/long, boxes ativos, parceiro, CNPJ, e-mail da conta, auto_debit_registration, kWh último mês, F vs R divergência %, created_at, cadastro_id, installation ids |

**Section C — Filter bar** above table: multiselect facets (Status locação, Provedor, Status fatura, Débito automático, Tipo contrato, Status pagamento mês) + saved quick-filter chips replicating the 6 n8n warning categories ("Novas <3d", "Scraper parado", "Vence em 7d sem DA", "Sem DA", "Negociadas", "Desligamento programado") — these are the SStation Warnings filters made permanent.

**States:** loading = `Skeleton` rows keeping column widths; empty = "Nenhuma estação encontrada" + clear-filters action; error = inline `Alert` (destructive) with retry; stale = if scraper sync >48h old, a persistent yellow banner across the top ("Dados da Enel coletados pela última vez em …").

---

## 3. `/estacoes/[id]` — Station 360°

**Header** (vammo-ui `PageHeader`): `#1268 — Lorenzo Park Estacionamento` + status badge + source chips; right actions: "Nova leitura" (deep-links `/leituras/nova?station=1268`), "Registrar pagamento", "Editar". Below the title a **freshness ribbon**: `Enel: coletado há 6h · EDP: há 12 dias · Metabase: hoje 02:00` with green/yellow/red dots — the scraper-stale signal, always visible.

**Layout:** left rail (fixed identity card) + right content with shadcn `Tabs`: **Visão geral · Energia · Aluguel · Pagamentos · Leituras · Documentos · Histórico**.

**Left rail — identity card:** static map thumbnail (Google Static Maps, lat/long from Vammo_data) opening Google Maps; address; swap_station_id, station_name, created_at, boxes ativos (Metabase), status; matching-quality note if the station↔utility match distance >100 m (from MatchingQualityCheck — "Correspondência por endereço: 619 m" warning).

**Tab: Visão geral** — a dense two-column summary: (a) "Contas de cobrança" cards, one per billing account (see Energia/Aluguel below, compact form); (b) mini Recharts `BarChart` of last 12 months total cost (energy + rent stacked, blue tonal scale + grey); (c) open items list (unpaid charges, missing comprovantes); (d) recent alerts for this station.

**Tab: Energia** — one **installation card** per enel_id/UC (station 553 shows three):
- Card header: provider logo chip (Enel/EDP), installation number, portal status badge, `auto_debit` badge + `auto_debit_registration`, account email, "Sem contas" shown with an explicit "status pode estar defasado — carregado da última coleta" tooltip (the carry-forward gotcha).
- Key figures row: última fatura R$, vencimento, NF, negotiated_invoices chips, shutdown banner (orange, date + window) when scheduled.
- **History matrix**: TanStack Table, months as columns (newest left, mirroring F_/R_ pairs): rows = `kWh faturado (F)`, `kWh registrado (R)`, `Valor fatura (R$)`, `Status`; cell background tint red when F vs R diverge >15% (surfaces the live audit problem — only ~29% match today).
- **Invoice list** (Faturas_ENEL/EDP): due_date, value, NF, TUSD/TE kWh & R$, CIP, Total, leituras anterior/atual, tariff class (C1–C6 / classificacao), `Financeiro Check` (checkbox → RPC write + audit event), Comprovante link, and **"Ver fatura PDF"** button (signed URL to the mirrored PDF; falls back to the Drive `Fatura-{Enel|EDP}-{id}-{YYYY-MM}.pdf` link). Row expands (TanStack `getExpandedRowModel`) to show full tariff breakdown.
- Recharts `ComposedChart` per installation: bars = kWh/month, line = R$/month, 13 months.

**Tab: Aluguel** — contract panel from 1_Cadastro: partner/locador, contato (nome, telefone, e-mail), CNPJ/CPF, modality (Tipo_Contrato) with its formula rendered ("Por box c/ mínimo: MAX(3; 2) × R$ 400 = R$ 1.200"), vencimento dia, Tipo de Pagamento, bank data (Banco/Agência/Conta/Chave Pix — masked with reveal-on-click, revealed events audited), início/fim contrato with "vence em X meses" warning chip, reajuste section (índice IGPM/IPCA/INPC, Status_Reajuste badge, history from 3_Reajustes), observações, link to contract PDF. "Sem contrato" empty state links to `/alugueis/novo?station=…`.

**Tab: Pagamentos** — the station's monthly ledger (rent AND energy rows, Tipo_Cobranca badge Aluguel/Energia/Aluguel+Energia): Mês/Ano, valor (with the Documento/Planilha/Energia split rendered as structured sub-values, not the polluted text blob), Status_Pgto badge, comprovante thumbnail/link (opens PDF viewer `Sheet` at the matched page), No Fiscal, quem registrou + quando (audit). Inline action "Anexar comprovante" (upload → runs matcher → confirm).

**Tab: Leituras** — this station's manual readings: photo thumbnail grid + table (data, leitura kWh, consumo vs mês anterior delta, quem registrou); Recharts `LineChart` of readings; "Nova leitura" CTA.

**Tab: Documentos** — every file linked to the station: contract PDFs, faturas, comprovantes, NDs, NFS-e; filterable by type/month; each row shows source (scraper / e-mail parceiros@ / upload manual / Drive).

**Tab: Histórico** — merged timeline: alert occurrences, status transitions (from Backup Enel-style snapshots going forward), audit events (who checked Financeiro, who edited contract), scrape events. Vertical timeline list, filter chips by event type.

**States:** every tab has its own Suspense boundary + skeleton; installation card with no invoices = "Nenhuma fatura coletada ainda"; unmatched station (`Unidentified`) never reaches this page — it lives in `/revisao/instalacoes`.

---

## 4. `/energia`, `/alugueis`, `/pagamentos`, `/comprovantes` — cross-station ledgers

- **/energia:** two sub-tabs. "Instalações" = one row per enel_id/UC (mirror of enel_data/edp_data with all columns available via column toggle, including swap_station_id link, F/R divergence %). "Faturas" = the full invoice ledger (Faturas_ENEL + Faturas_EDP unified), filter by month/provider/status/Financeiro Check/missing comprovante; bulk "Financeiro Check" action with confirmation dialog (audited). This is where Finance lives on payment days.
- **/alugueis:** contracts table (1_Cadastro), Tipo_Contrato/Status facets, contract-end-date warning column, reajuste due column; row → `/alugueis/[cadastroId]`. PageHeader action: "Novo contrato" → onboarding flow.
- **/pagamentos:** the 2_Pagamentos successor. Month picker (defaults current), grouped by station, Status_Pgto lifecycle per row (`Pendente → Boleto recebido → Pago/Atrasado/Antecipado` — advance via RPC actions, each audited), source badge ("e-mail parceiros@" for AI-ingested rows with a confidence chip, "manual", "recorrente"). Summary footer: total previsto vs pago no mês. A "Gerar mês" action materializes expected rows from active contracts (replacing the manual sheet copy).
- **/comprovantes:** upload dropzone (multi-PDF) + inbox table of processed receipts: parsed type (PIX/TED/débito automático/barcode), parsed value/date/key, match result (Conciliado green → link to the charge; Ambíguo orange → review; Sem correspondência red → review), dedupe-by-hash notice for re-uploads. Replaces PDF_Comprovante_Processor's Drive-watch UX with visible, idempotent results.

---

## 5. `/revisao` — Review queues

Hub page with 4 cards (count + oldest-item age) and tabs; every queue is a TanStack Table + a **resolution side `Sheet`** (shadcn) so the reviewer never loses list context. Every resolution is an RPC with an audit event.

1. **Comprovantes não conciliados** — left: PDF page preview (the specific page); right: parsed fields (valor, chave/CNPJ, data) + candidate charges ranked by the matcher (value ±R$ 0,01, key match, date window) with match-reason chips; actions: "Conciliar" (pick candidate), "Marcar como não é comprovante", "Ignorar duplicata". Keyboard: J/K navigate, Enter confirm.
2. **Cobranças UNIDENTIFIED** — AI-ingested email charges that didn't match a contract: shows the source PDF, extracted fields, sender email, AI's candidate list + reasoning; reviewer picks station/contract or creates a new contract from it. Value-mismatch helper shows Documento vs Planilha diff (handles the Kitchen Central R$ 1,00 trap with an explicit tolerance note).
3. **Irregularidades** — two sub-lists (the SStation_without_contract outer joins, permanently rendered): "Estações sem contrato" (live in Metabase, no cadastro → inline action "Criar contrato" pre-filling station) and "Contratos sem estação" (cadastro whose station vanished → actions "Marcar DESATIVADA", "Corrigir swap_station_id" with station picker).
4. **Instalações não vinculadas** — replaces the Slack yes/no matching loop: each `Unidentified` enel_id/UC shows utility address, geocoded pin vs nearest stations on a small map, distance candidates (from the compareDBs logic); actions "Vincular à estação X" / "Não é estação Vammo". Writes back to the app DB (scraper sheet remains untouched — read-only).

**States:** queue empty = celebratory-neutral "Tudo em dia" with grey illustration-free card; item claimed by someone else (simple `reviewed_by` lock) shows "Em revisão por fulano".

---

## 6. `/alugueis/novo` — Contract onboarding flow

Three-step wizard (single route, client stepper; shadcn `Form` + zod):

1. **Upload** — dropzone for the contract PDF (accepts multi-page; the port fixes n8n's `maxPages: 1` bug — whole document goes to extraction). Shows upload progress, then "Extraindo dados do contrato…" skeleton form (fields appear greyed with shimmer while the AI job runs; extraction is async — user can leave and return via a draft state).
2. **Revisar** — the ~25-field form pre-filled by the AI (same schema as Fill_Cadastro_Form): station picker (async combobox querying the app's stations table by address/id — replaces the Metabase-tool lookup; shows the AI's suggested station with a confidence note), status, número da conexão (ENEL), endereço, parceiro/locador, contato, telefone, e-mail, CNPJ/CPF (masked input + validator), Tipo_Contrato select that conditionally reveals modality fields (qtd boxes / valor por box / mínimo / valor fixo — collapsing the Google Form's 3 duplicate columns into one conditional block), dia vencimento (1–31), Tipo de Pagamento conditionally revealing Chave Pix vs Banco/Agência/Conta, início/fim contrato date pickers, observações. Every AI-filled field gets a subtle blue left border + "extraído" tooltip; edited fields clear it — the diff (AI value vs saved value) is stored for extraction-quality tracking. PDF rendered side-by-side (right panel, `react-pdf`) so the reviewer verifies against source without leaving.
3. **Confirmar** — read-only summary card + "Criar contrato" (RPC; stores PDF in private Supabase Storage; audit event). Success toast → contract detail page.

**States:** AI extraction failed / password-protected PDF → form opens blank with an error banner ("Não foi possível extrair — preencha manualmente ou reenvie o PDF sem senha"), never blocks manual entry.

---

## 7. `/leituras` + `/leituras/nova` — Manual meter readings (mobile-first)

**/leituras (desktop):** table of stations flagged `leitura_manual` (a per-station toggle set in admin/station edit): last reading date, last value, days since reading (red >35d), monthly completeness matrix (station × month grid, green check / red missing — the "who hasn't been read this month" view), photo thumbnails. KPI strip: lidas este mês / pendentes.

**/leituras/nova (the phone flow)** — single-column, thumb-reachable, min 44 px targets, works as an installed PWA:
1. **Estação** — big search combobox (recent + nearby-first using browser geolocation against station lat/long); selected station shows address + last reading ("Última: 4.755 kWh em 12/06") for sanity.
2. **Foto (obrigatória)** — full-width camera button (`<input type="file" accept="image/*" capture="environment">`); preview with retake; the submit button stays disabled until a photo exists — the mandate is structural, not a validation message.
3. **Leitura** — numeric keypad input (`inputmode="numeric"`, decimal allowed), unit label kWh; live delta vs last reading ("+1.908 kWh em 25 dias") with a soft warning if negative or >3× the usual monthly consumption (confirm dialog, still submittable — excess of info, not a hard block).
4. Optional observação; **Enviar**.

**Offline tolerance (cheap version):** the form is a client component; on submit failure or `navigator.onLine === false`, the reading (photo as blob) is queued in IndexedDB and a persistent "1 leitura aguardando envio" chip appears; a retry runs on `online` event and app focus. No service-worker sync complexity in v1.

**States:** camera permission denied → inline instruction card; upload in progress → non-dismissable progress; success → full-screen check + "Registrar outra" (field person does several in a row).

---

## 8. `/alertas` — Alerts panel (replaces Slack warnings)

Permanent, queryable replacement for SStation Warnings + VencidasEnelWarning. Layout: 7 category cards in a grid, each with count, severity color, and "since last visit" delta; clicking a card filters the alert table below.

Categories (each an evaluated rule over app tables, recomputed after each sheet sync):
1. **Faturas vencidas** (red) — status Vencida / invoice_history contains Vencida, minus already-receipted (the VencidasEnelWarning logic, done with real joins)
2. **Vence em 7 dias sem débito automático** (orange)
3. **Sem débito automático** (yellow) — normalized `Não cadastrado`/`Nao Cadastrado`
4. **Scraper parado / estação removida** (yellow) — scraping_time 3–30 d
5. **Novas instalações** (blue/info) — first_seen < 3 d
6. **Faturas negociadas** (orange) — current/previous month
7. **Desligamentos programados Enel** (orange, ChargingOps-relevant) — next 7 d, with station address and time window

Alert table: category badge, station link, installation, detail line, first-detected, status (**Ativo / Reconhecido / Resolvido** — acknowledge action with user + timestamp, audited; auto-resolves when the rule stops matching). Filters by category/status/station. A settings block (admin) configures the thin Slack push that remains: daily digest of Vencidas to the finance channel and shutdown alerts to ChargingOps — the app is the record, Slack is only the push.

Sidebar badge = count of unacknowledged Ativo alerts.

---

## 9. Cross-cutting UI states & conventions

- **Loading:** skeletons matching final layout (never spinners inside tables); TanStack Query `placeholderData: keepPreviousData` on filter changes so tables don't flash.
- **Empty:** neutral grey card, sentence-case message + primary action; no illustrations (Vamminho deprecated, DS §10).
- **Error:** shadcn destructive `Alert` inline with "Tentar novamente"; global error boundary per route segment.
- **Freshness:** every scraper-derived surface carries a "coletado em …" timestamp; this is a first-class UI element, not metadata.
- **Audit visibility:** every mutating control shows "por {user} em {data}" after the fact (goBuy request_events pattern surfaced in UI).
- **PDF viewing:** in-app `Sheet`/`Dialog` viewer with page anchor support (comprovante matches point at a specific page), signed URLs, download button.
- **Numbers:** always `tabular-nums`, right-aligned, pt-BR formatting via `Intl.NumberFormat('pt-BR')`.

---

### Critical Files for Implementation
- C:/Users/gabri/OneDrive/Desktop/Vammo/eletron/.agents/skills/vammo-design/SKILL.md (track choice, tokens, vammo-ui mandate)
- C:/Users/gabri/OneDrive/Desktop/Vammo/eletron/.agents/skills/vammo-design/ui_kits/backoffice/README.md (+ Sidebar.jsx/PageHeader.jsx/Campaigns.jsx/Home.jsx — the exact component lockups every screen reuses)
- C:/Users/gabri/OneDrive/Desktop/Vammo/eletron/.agents/skills/vammo-design/README.md (§06–§08 colors/alert palettes/typography, §14 foundations)
- C:/Users/gabri/OneDrive/Desktop/Vammo/Vammo-Enel/enel_helpers.py and edp_helpers.py (canonical sheet schemas the Energia screens must render)
- C:/Users/gabri/.claude/plans/ok-i-have-added-breezy-sonnet.md (confirmed decisions, enums from 5_Listas, n8n→app home mapping this IA implements)