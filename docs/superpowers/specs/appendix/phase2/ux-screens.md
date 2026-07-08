Exploration complete (plan file, exploration output, ux-screens.md, plus direct reads of providers/layout/sidebar/mobile-nav/login/labels/status-badge/freshness-dot and chart color usage). Design follows.

---

# Phase 2 UX/Screens Design (Vammo DS Product track, pt-BR)

## 0. Cross-cutting rules (inherited from Phase 1, now with writes)
- Every mutating control is followed by a visible **`por {user} em {data}`** byline → new shared component `components/vammo/audit-byline.tsx` (takes `actorEmail`, `at`; renders muted 12px, tooltip with full timestamp).
- Every write goes through a confirm affordance (dialog or explicit button), returns a Sonner toast, and triggers TanStack Query invalidation.
- **Nothing AI/auto-matched ever renders as "Pago"** — auto results always show an intermediate badge + a named-human Confirmar action (operator role).
- Role gating: read = any session; write actions rendered disabled with tooltip "Requer papel operador/admin" when the session role is insufficient (role comes from the minted-JWT session; server re-checks in RPC).
- Uploads: shared `components/vammo/upload-dropzone.tsx` (multi/single-file modes, per-file progress, magic-byte + size validation client-side pre-flight, server is authoritative per security-ops.md).

## 1. Dark mode (first deliverable)

**Wiring (3 files):**
1. `components/providers.tsx` — wrap with `<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>` (next-themes ^0.4.6 already installed; Providers is already `"use client"`).
2. `app/layout.tsx:35` — add `suppressHydrationWarning` to `<html lang="pt-BR">`.
3. New `components/vammo/theme-toggle.tsx` — single ghost icon button cycling **system → light → dark** (Lucide `Monitor`/`Sun`/`Moon`, `strokeWidth={2}`), `aria-label="Alternar tema"`, tooltip shows current ("Tema: sistema"). Mounted-guard (render disabled placeholder until `useEffect` mount) to avoid hydration flash. Placement: (a) `components/vammo/sidebar.tsx` NavUser row (lines 82–113), as a second `size-8` ghost icon next to LogOut; (b) `components/vammo/mobile-nav.tsx` header right edge (after the logo lockup, `ml-auto`).

**Dark-specific fix list (audited against the actual code):**

| Surface | Finding | Fix |
|---|---|---|
| `components/ui/dialog.tsx:34`, `components/ui/sheet.tsx:31` | Scrim `bg-black/10` is invisible over dark bg | `bg-black/10 dark:bg-black/60` (keep backdrop-blur) |
| Recharts tooltips (`estacao/energy-tab.tsx:332`, `estacao/overview-tab.tsx:205`) | Recharts default tooltip is hardcoded white bg / #666 text | `contentStyle={{ backgroundColor: "var(--popover)", borderColor: "var(--border)", color: "var(--popover-foreground)" }}` + `cursor={{ fill: "var(--muted)" }}` on bar charts; axis `tick={{ fill: "var(--muted-foreground)" }}`, grid `stroke="var(--border)"` if currently defaulted |
| Recharts series colors | Already `var(--chart-*)` (verified :344/:351/:214/:220) — `.dark` block defines chart-1..5 | No change; visual verify only |
| `StatusBadge` `--badge-*` palette | Shared across themes (no `.dark` overrides). Most chips are self-contained (own bg) and OK, but **`white`** (used by "N/A" labels) and `grey`-outline will vanish on dark cards | Add `.dark` overrides in `globals.css` for `--badge-white-*` and `--badge-grey-*` only; contrast-check yellow/orange text tokens on dark card behind them |
| `FreshnessDot` (`freshness-dot.tsx:30`) | Yellow dot uses `--badge-yellow-bg` (shared) | Covered by the badge-token override above; `bg-success`/`bg-error` already themed |
| Login page | Already `bg-background` + `dark:invert` on logo — OK | Visual verify only |
| Vammo logo (sidebar :39, mobile-nav :40/:80, login :25) | All already carry `dark:invert` | None |
| PDF placeholder cards (documents-tab) / static map thumbnail (identity-card) | Light-image-on-dark-card | Add `border border-border` + `dark:brightness-90` on image containers; note-only if acceptable |
| Sonner (`components/ui/sonner.tsx`) | Must follow theme | Pass `theme={resolvedTheme}` from `useTheme()` (shadcn default pattern) |

**Verification checklist (run per screen × {light, dark, system-dark}):** `/login`, `/estacoes`, `/estacoes/[id]` (all 7 tabs incl. both charts), `/energia` (both tabs + expanded fatura row), `/alugueis` + detail, `/pagamentos`, `/comprovantes` (+ new detail), `/leituras` (+ nova on 375px), `/revisao` (hub + 4 queues + resolution Sheet), `/alertas`, `/admin`. Check: body/muted text contrast, table hover + sticky header, every badge color on card bg, chart tooltip + cursor, skeletons, dialog/sheet scrim, focus rings, nav badge pills, toasts.

## 2. `/comprovantes` — real inbox (replaces stub)

**Sections (top→bottom):**
- **A. Upload card** — `upload-dropzone` multi-PDF (≤25 MB each). Per-file row: name, size, state machine `Enviando (progress %) → Processando → Concluído | Duplicado | Erro`. Flow: client posts to `POST /api/comprovantes/upload` → server sha256 → **dedupe check against `charging.documents.content_hash` BEFORE Drive upload**; duplicate returns existing id → row shows grey badge **"Já enviado"** linking `/comprovantes/[id]` of the original. New file → Drive folder `13nbLPM…` (n8n keeps watching in parallel) → `documents` row → processing kicked. Encrypted PDF: accepted, flagged "Protegido por senha" (orange), lands in inbox with processing status Erro + explanation.
- **B. KPI strip** (`StatCard` ×4): Enviados este mês · Recibos extraídos · Conciliados (confirmados) · Aguardando revisão (links `/revisao/comprovantes`).
- **C. Inbox `DataTable`** — one row per document. Columns: Documento (filename, mono-ish) · Enviado por / em · Páginas · Recibos · Conciliação (three inline counts: green Conciliados / orange Ambíguos / red Sem corresp.) · Processamento (badge Na fila / Processando / Concluído / **Erro + "Reprocessar"** action, operator) · Origem (Upload / Drive). Row click → detail. Filters: período, enviado por, estado de conciliação (com pendências / completo / sem correspondência), status de processamento.

**States:** empty = dropzone as hero + "Nenhum comprovante enviado ainda"; rows in Processando poll via TanStack Query `refetchInterval: 5s` while any pending; error rows keep parsed partials visible.

## 3. `/comprovantes/[id]` — deep-dive (NEW route)

**Layout:** desktop two-column — left 45% sticky **PDF viewer**, right content stack; mobile stacks (viewer collapsible).

**PDF viewing approach:** new app route `GET /api/drive/file/[documentId]` — session check → look up `documents.drive_file_id` → stream Drive `files.get(alt=media)` (read SA), `Content-Type: application/pdf`, `Content-Disposition: inline`, `Cache-Control: private, max-age=300`. Viewer = **`<iframe>` on the proxy URL with `#page=N` anchor** (native browser PDF rendering, zero bundle, page-jump works in Chromium/Firefox). react-pdf deferred — only needed if per-region highlighting is ever required. Receipt cards jump the viewer by swapping the iframe hash. Same proxy route serves meter photos (§4) and bill PDFs.

**Right column sections:**
1. **Header** — filename, `audit-byline` (enviado por/em), sha256 tooltip, actions: Baixar, Abrir no Drive (admin).
2. **Resumo** — páginas, recibos, soma dos valores, contadores conciliação.
3. **Estações relacionadas** — chips (id + nome) = distinct stations of currently bound charges, linking `/estacoes/[id]`; empty = "Nenhum vínculo ainda".
4. **Recibos (per-page cards)** — one card per `receipts` row: page thumbnail/button (jumps viewer), `receipt_type` badge (PIX / TED / Débito automático / Barcode / Outro), parsed-field grid (valor, data, chave PIX/CNPJ, identificação, autenticação, código de barras — only non-null shown, excess-of-info via "ver texto bruto" collapsible), match badge:
   - **Conciliado** (green) — has payment(s) all confirmed;
   - **Conciliado (aguardando confirmação)** (orange) — auto-matched, `confirmed_by` null → **Confirmar** button (operator) → confirm RPC → badge flips green with byline;
   - **Ambíguo** (orange outline) — link to `/revisao/comprovantes`;
   - **Sem correspondência** (red) — inline "Conciliar…" opens the charge picker.
5. **Vínculos (payments table)** — rows = `payments` of this document. Columns: Cobrança (link — estação + tipo + competência), Valor alocado (tabular), Estado (Confirmado + byline / Aguardando confirmação (auto)), Ações: **Confirmar** (auto rows) · **Remover** (`unmatch_receipt` RPC via confirm dialog "Remover vínculo? A cobrança volta a ficar em aberto.", audited). Footer: total alocado vs valor dos recibos + restante.
6. **ADD binding dialog** (`components/comprovantes/charge-picker.tsx`, shadcn `Command`) — search by estação/competência; filters: estação select, competência month, "Somente em aberto" (default on); candidates show valor em aberto + vencimento + match-reason chips when the matcher had ranked them; **valor field defaults to `min(restante do recibo, em aberto da cobrança)`**; submit = `match_receipt_to_charge` RPC (manual match = born confirmed, actor is the confirmer).

**States:** document still processing → cards replaced by skeleton + "Processando… " with poll; processing Erro → destructive Alert + Reprocessar (operator).

## 4. `/leituras` + `/leituras/nova` — real

**`/leituras/nova`** (keeps existing `NovaLeituraFlow` shell — station combobox, mandatory photo, kWh keypad, delta warning):
- Submit becomes real: (1) `POST /api/leituras/upload` — image ≤10 MB, jpeg/png/heic, magic-byte sniff, `sharp` re-encode, EXIF extract-then-strip → Drive folder `1t7WoW…` named `Leitura-{stationId}-{YYYY-MM-DD}-{shortHash}.jpg` → `documents` row; (2) `create_meter_reading` RPC `{stationId, readingKwh, readingDate (default hoje, editable), photoDocumentId, notes}`. **Nome** shown prefilled `"{swap_station_id} - {address}"` (editable); **Responsável** = logged-in user, rendered read-only with avatar (audit-consistent, per resolved decision 4).
- Success: full-screen green check + resumo (estação, kWh, delta vs anterior) + **"Registrar outra"** (resets keeping nothing) + "Ver leituras".
- Failure: upload error keeps photo in memory + Tentar novamente; RPC error after successful upload reuses the uploaded `photoDocumentId` (no re-upload).
- **Offline queue: OUT of scope** — rationale to record in plan: real submit is an authenticated multipart upload + RPC; a durable IndexedDB queue must handle session expiry, retry ordering and duplicate protection — disproportionate complexity for v1; the ux-screens §7 "cheap version" assumed no auth'd upload. Defer unless Gabriel asks.

**`/leituras` list:** KPI strip (Lidas este mês / Pendentes este mês / Estações com leitura); main table one row per station-with-readings: Estação · Última leitura (kWh, tabular) · Data · **Dias desde** (red >35) · Consumo no mês (delta) · Registrado por; **monthly completeness matrix** (ux-screens §7): station × last 6 months grid, green check / red dash; matrix cell + table row open a **reading detail `Popover`**: photo thumbnail (Drive proxy, lazy `loading="lazy"`), kWh, responsável, data, nome, notas, link "Ver foto" (full). "Candidatas" section (Phase-1 table) remains below for ACTIVE stations without any reading, each with "Nova leitura" deep link.

## 5. Manual bill entry

**Placement:** (a) `/energia` Faturas tab — `PageHeader`-area button **"Adicionar fatura manual"**; (b) station 360 Energia tab — action on each installation card (conta pre-selected).

**Dialog** (single-step `Dialog` + shadcn `Form` + zod — few fields, no wizard):
- Conta (combobox grouped Enel/EDP, shows estação; preselected from context) · Competência (MM/AAAA) · Valor (R$ masked, >0) · Vencimento (date) · NF/Nº documento · **PDF da fatura (obrigatório**, single-file drop ≤25 MB) · Notas.
- **Validation:** inline duplicate warning if a fatura exists for (conta, competência) or (conta, vencimento) — shows link to it; hard block on exact `dedupe_key` conflict (`enel:{id}:{due}` / `edp:{uc}:{due}`); Drive name collision `Fatura-{Enel|EDP}-{id}-{YYYY-MM}.pdf` (YYYY-MM from **vencimento**, scraper convention) treated as "PDF já existe no Drive — será reaproveitado" info note.
- **Submit sequence:** PDF → Drive bills folder `1AB8ok…` (SA needs Content Manager — setup step) → `create_charge_manual` RPC (`source='manual'`) → **append row to Faturas_ENEL/EDP** (`values.append`, incl. `=HYPERLINK` link_fatura; SA needs Editor on the scraper spreadsheet — setup step).
- **Success:** toast + row appears in the faturas table with **"Manual"** source badge (grey outline) + byline in the expanded row. **Sheet-append failure is non-fatal:** charge exists; row gets an orange chip "Planilha pendente" with a retry action (operator) — the sheet ecosystem must stay complete but must not block the app write.

## 6. `/pagamentos` — "Gerar mês" + lifecycle

**Gerar mês** (button at `pagamentos-view.tsx:303-308`, enabled for operator): opens a wide `Dialog`:
1. Month picker (default current) → **"Gerar prévia"** → server computes A5 logic **without writing**.
2. **Preview table** (this is the before-write gate): Estação · Contrato (Tipo badge) · **Valor calculado** (tabular) · **Fórmula** (reuse `contract-utils` renderer: "Por box c/ mínimo: MAX(3; 2) × R$ 400 = R$ 1.200"; pro-rata appended: "× (30−12+1)/30") · Flags badges: `Boxes ≠ contrato` orange · `Pro-rata` blue · `Sem Metabase` red · `Já existe` grey (skip, dedupe (cadastro_id, mês, ano)). Collapsible "N puladas" section (DESATIVADA, não-Pix/Transferência) — excess-of-info, nothing silent.
3. Footer: "Criar N cobranças · total R$ X" → confirm → RPC → toast "N criadas, M já existiam" → table refetch; created rows carry the same flag badges + source "Gerado".

**Row lifecycle:** per-row actions menu — `Pendente → Boleto recebido` (mark) and `→ Pago` via **confirm dialog** (data do pagamento; optional "Vincular comprovante" opening the same charge-picker in reverse: pick a receipt of this counterparty; skippable) → `mark_paid`/`update_charge_status` RPC; `Atrasado` derived, never manual; `Cancelada` admin-only. Byline everywhere. Auto-matched-but-unconfirmed rows show **"Conciliado (aguardando confirmação)"** and are NOT Pago until confirmed (gate shared with §3).

## 7. `/alertas` — lifecycle actions

Per-row + bulk (checkbox selection): **Reconhecer** (`acknowledge_alert`), **Resolver** (`resolve_alert`, optional note), **Silenciar** (`mute_alert`, required duration 7d/30d/até data + reason). Lifecycle badge Ativo (red/orange per category) / Reconhecido (blue) / Resolvido (green) / Silenciado (grey, tooltip até-quando + reason) + byline of last transition. New filter chip row by lifecycle (default **Ativo**); sidebar badge counts only Ativo. Auto-resolve (rule stops matching) shows byline "por sistema em {data}".

## 8. `/admin`

- **IngestHealthCard** — unchanged.
- **Usuários card** (rendered only for admins, role checked server-side): `user_roles` table (email, role badge admin/operator, byline), inline role select → `set_user_role` RPC with confirm; "Adicionar usuário" (email input, zod `@vammo.com`).
- **Jobs card**: `job_runs` table — Job · Disparo (cron / manual:{email}) · Início · Duração · Status badge (running blue-pulse / success green / error red / skipped_locked grey) · stats jsonb in a `Popover` · error collapsible; **"Executar agora"** per job (admin-only, server action → same handler, identity recorded); poll 30s while any running.
- Mapeamentos/Auditoria cards stay as disabled placeholders (Fase 3).

**Relabel (semantics fix):** add canonical entry to `lib/labels.ts` — `export const FISCAL_EXPORT_UI = { header: "Enviado ao fiscal", tooltip: "Exportado à planilha fiscal — não significa pago", ariaChecked: "Enviado ao fiscal" }` — consumed by `components/energia/faturas-table.tsx:213,218,357` and `components/estacao/energy-tab.tsx:514,519,523`. The batch button (:357) **stays disabled in Phase 2** with tooltip "Marcado automaticamente pelo export fiscal (Apps Script) — importação na fase 3", since A1/A2 remain sheet-side.

## 9. Charge-status re-derivation — surface impact

`normalize.ts:1260` stops deriving `pago` from `financeiroCheck`; new mapping from `utility_account_state.billStatus`: `paga→pago`, `vencida→atrasado`, `a_vencer|pendente→pendente`, `em_compensacao→em_compensacao`, `fatura_negociada→negociada`, `sem_contas|na→nao_aplicavel`. Per-surface:

| Surface | Change | New status source |
|---|---|---|
| `/pagamentos` energy rows | Rows previously "Pago" via fin_check may flip to Pendente/Atrasado — **expected**; add separate "Enviado ao fiscal" chip (Lucide `FileCheck`) so the fiscal info isn't lost | billStatus mapping + fiscal chip |
| Station 360 Pagamentos tab | Same flip + fiscal chip | billStatus mapping |
| Visão geral "itens em aberto" + KPI "Pagamentos pendentes no mês" | Counts will **increase** (fin_check no longer hides open bills) — flag to Gabriel as expected behavior at rollout | open = status ∉ {pago, cancelada, nao_aplicavel} |
| `/estacoes` "Status fatura energia" column | Unchanged (already billStatus worst-of) | — |
| `/energia` Faturas tab | Status column unchanged; "Financeiro" column relabeled per §8 | — |

## New routes

| Route | Kind |
|---|---|
| `/comprovantes/[id]` | Page (new) |
| `POST /api/comprovantes/upload` | Upload (dedupe-before-Drive) |
| `POST /api/leituras/upload` | Upload (image pipeline) |
| `POST /api/faturas/upload` | Upload (bill PDF, scraper naming) — thin routes sharing one `lib/uploads` validator |
| `GET /api/drive/file/[documentId]` | Session-checked Drive stream proxy (PDF viewer, photos, bills) |

(`/leituras`, `/leituras/nova`, `/comprovantes`, `/pagamentos`, `/alertas`, `/admin` are existing routes gaining function; no new admin subroutes — cards live on `/admin`.)

## Component reuse map

| Reused (existing) | Where in Phase 2 |
|---|---|
| `vammo/page-header`, `stat-card`, `status-badge`, `data-table`, `freshness-dot` | every new screen |
| `alugueis/facet-filter` | comprovantes inbox, alertas lifecycle filters |
| `alugueis/contract-utils` (formula renderer) | Gerar mês preview "Fórmula" column |
| `energia/station-cell` | charge picker candidates, payments table links |
| `leituras/nova-leitura-flow`, `leituras-table` | extended, not replaced |
| `estacao/empty-state`, `ui/*` (Dialog, Sheet, Command, Form+zod, Popover, Skeleton, Sonner) | all dialogs/pickers |
| `revisao/phase2-button` | **deleted** (obsolete) |

**New components:** `vammo/theme-toggle`, `vammo/audit-byline`, `vammo/upload-dropzone`, `vammo/pdf-viewer` (iframe + page anchor), `comprovantes/inbox-table`, `comprovantes/receipt-card`, `comprovantes/charge-picker`, `comprovantes/bindings-table`, `energia/manual-bill-dialog`, `pagamentos/gerar-mes-dialog`, `pagamentos/status-actions`, `leituras/completeness-matrix`, `leituras/reading-popover`, `alertas/lifecycle-actions`, `admin/user-roles-card`, `admin/job-runs-card`.

### Critical Files for Implementation
- C:/Users/gabri/OneDrive/Desktop/Vammo/eletron/components/providers.tsx (ThemeProvider wiring)
- C:/Users/gabri/OneDrive/Desktop/Vammo/eletron/app/layout.tsx (suppressHydrationWarning)
- C:/Users/gabri/OneDrive/Desktop/Vammo/eletron/lib/labels.ts (canonical "Enviado ao fiscal" entry + status mappings)
- C:/Users/gabri/OneDrive/Desktop/Vammo/eletron/components/pagamentos/pagamentos-view.tsx (Gerar mês + lifecycle actions)
- C:/Users/gabri/OneDrive/Desktop/Vammo/eletron/components/energia/faturas-table.tsx (relabel :213/:218/:357, manual-bill badge, source column)