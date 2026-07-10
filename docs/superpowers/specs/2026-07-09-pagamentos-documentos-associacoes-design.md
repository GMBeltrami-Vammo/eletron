# Feature D — Documento & Associações — Design Spec

Date: 2026-07-09
Status: approved + shipped (decision #35), in two slices — Part 1 + 2a (commit slice 1), Part 2b + the #29 unmatch fix (commit slice 2)

---

## 1. Goal

Give the finance team full manual control over the two document↔charge associations, plus a link to see the source bill behind every charge.
The data model already supports everything; this feature is mostly UI wiring over existing RPCs, plus one new writer RPC and one invariant fix.

Part 1 adds a "Documento de origem" link column to the /pagamentos ledger on both tabs (Enel/EDP and Locação) so a user can open the SOURCE bill (boleto/fatura) behind each charge.
Energy rows resolve to the raw Drive link already parsed into `charge_energy_details.faturaDriveUrl`; rent/boleto rows resolve to `charge.source_document_id`, served through the existing session-checked proxy `/api/files/[documentId]`.
The column renders a link only when a document is actually bound, and a plain `—` otherwise.

Part 2a lets a user manage the SET of charges a single comprovante (receipt) settles, on /comprovantes/[id].
One comprovante can settle MANY charges mixed across EDP, ENEL, aluguel and boleto, which the data model already supports (`payments` has one row per charge, all sharing the same `receipt_id`).
This capability already exists in the viewer (add via the per-receipt `ChargePicker`, remove via `BindingsTable`), but it ships DISABLED for every user because of a role-gating bug; the real work here is fixing that gate so the controls become usable.

Part 2b exposes two per-row write affordances on /pagamentos, both for completing/correcting what the webhook or scraper landed.
(i) Reclassificar — reattributes a charge's estação/conta and its tipo (aluguel / aluguel_energia / energia) via the EXISTING `reclassify_charge` RPC, scoped to the Locação (rent/third-party) tab only.
(ii) Vincular/Desvincular documento — binds or clears the source bill on a charge via a NEW SECURITY DEFINER RPC `set_charge_document(charge_id, document_id|null)`, so a document that arrives incomplete or unlinked (webhook gap) can be completed by hand.

A companion invariant fix hardens `unmatch_payment` so the app's `pago` state can never survive the loss of its last bound comprovante (decision #29).

---

## 2. Current state / verified facts

These facts were verified against the live clone and the committed code by parallel readers; the design depends on them.

- `charging.charges.source_document_id` already EXISTS in the schema (migration 2, `20260708100002_charging_tables.sql` line 319) as `uuid references charging.documents(id)`.
  No `ALTER TABLE` is needed.
  It is currently NULL for all 904 charges in the clone (the clone never linked documents), and it is written today only by `create_manual_bill` and the cobrança webhook (`lib/ingest/cobrancas.ts`).
- It is NOT read into the domain snapshot and NOT present on the `Charge` domain type, so no screen can see it yet.
  The repository already fetches it over the wire because `selectAll` uses `.select('*')`; the only read-path gap is the TypeScript row type + mapper.
- Multi-station billers already arrive as MULTIPLE per-station charges: Hubees = 15 charges across 13 stations, Dia = 5 charges / 5 stations, Kitchen Central = 4 charges / 3 stations.
  Therefore NO "split" is ever needed — each station already has its own charge row to link independently.
- `payments(charge_id, receipt_id)` has `UNIQUE(charge_id, receipt_id)` plus plain FKs to `charges` and `receipts`.
  `record_payment` has NO guard preventing a receipt already bound to other charges from being bound again — so one comprovante → many charges is already representable and requires NO schema or table change.
- The document graph is `documents(1) → receipts(N pages) → payments(N, one per charge) → charges`, and separately `charges.source_document_id → documents` (1 document → N charges).
  "Comprovante" (proof of payment, via payment→receipt→document) and "Documento de origem" (the charge's own source bill) are distinct facts and must not be conflated.
- Two parallel notions of "paid" coexist by design (Gabriel, 2026-07-09).
  The scraper/portal status may read paid and is shown as-is (the existing "Status portal" surface, decision #33); the app's own `charge.status = 'pago'` (baixa) holds ONLY while a comprovante is bound (decision #29).
  This feature must preserve both: never suppress the portal status, and never let the app's `pago` exist without a bound receipt.
- Roles are suspended (decision #26): the server gate `isOperatorEmail` returns `email.endsWith('@vammo.com')` for any Vammo user, so RPC guards reduce to `is_vammo_user()`.
- `getViewerContext()` (`components/comprovantes/queries.ts:111`) still reads the dormant `charging.user_roles` table and returns `isOperator:false` when no role row exists — i.e. for EVERY @vammo.com user in the current environment — while the rest of the app uses `getViewer()` (`components/admin/viewer.ts:35`), which correctly grants any @vammo.com user when Supabase is configured.
  The decision-#26 de-roling missed `getViewerContext`; this is the bug that disables Part 2a's controls today.

---

## 3. Design

### Part 1 — "Documento de origem" column on /pagamentos (zero migration)

Files touched:

- `lib/domain/types.ts` — add `sourceDocumentId?: string | null;` to the `Charge` interface (near line 289, after `notes`, before `raw`).
  Optional-with-null matches the `fiscalExported`/`statusSource` convention: undefined on the sheets backend, set from the column on the Supabase backend.
  It MUST stay optional so the other `Charge` constructors (normalize, scraper-feed, gerar_mes) keep compiling.
- `lib/data/supabase-repository.ts` — add `source_document_id: string | null;` to the `ChargeRow` interface (near `source`, line ~305) and map it in the charges mapper (`sourceDocumentId: r.source_document_id,` near line 595).
  No `selectAll` change — `.select('*')` already returns the column.
- `lib/ingest/normalize.ts` — set `sourceDocumentId: null` in both sheet-built charge constructors (energy charge ~line 1354, rent charge ~line 1574).
- `app/(app)/pagamentos/page.tsx` — in `buildRows()` build the energy-details lookup and thread the resolved href per row (details below).
- `components/pagamentos/types.ts` — add `documentHref: string | null;` to `PagamentoRow`.
- `lib/data/document-href.ts` (NEW, pure) — `resolveDocumentHref(sourceDocumentId: string | null, faturaDriveUrl: string | null): string | null` so the resolution is unit-testable in isolation (the completeness critic flagged that computing it inline in `buildRows` is not testable).
- `components/pagamentos/pagamentos-view.tsx` — add the read-only "Documento de origem" column to the module-level `baseColumns` array.

`resolveDocumentHref` (pure helper, unit-tested):

- Prefer the internal proxy when a `source_document_id` exists: `sourceDocumentId ? '/api/files/' + sourceDocumentId : faturaDriveUrl` (Drive fallback for energy).
- Returns `null` when neither exists → cell renders `—`.

In `buildRows`:

- Build the map once, next to the other lookup maps: `const detailsByCharge = new Map(snapshot.chargeEnergyDetails.map((d) => [d.chargeId, d]));` (the exact pattern already used in `energia/page.tsx` lines 127-128).
- Per row: `documentHref: resolveDocumentHref(charge.sourceDocumentId ?? null, detailsByCharge.get(charge.id)?.faturaDriveUrl ?? null)`.

Column placement and behavior:

- Insert the ColumnDef into `baseColumns` immediately AFTER the existing `comprovante` column (between index [10] `comprovante` and [11] `fiscal`) so the two attachment columns sit side by side.
- The column is READ-ONLY (a link, not a write affordance), so it correctly lives in the module-level `baseColumns` — it needs no `canWrite`, `uuid`, or `router`.
- Model the cell on the `faturas-table.tsx` "fatura" column (lines 291-311): `<a href={documentHref} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Ver documento <ExternalLink/></a>`, else `—`.
- `filterableColumnIds="all"` (pagamentos-view line 401) auto-adds a header filter to every column; set `enableColumnFilter: false` on this column and give it an `accessorFn` returning a stable filterable string (`documentHref ? 'Vinculado' : ''`) so it does not produce a noisy empty filter.
- Attach `meta.csvValue` via `csvMeta()` so CSV export emits the flag, not the rendered node.
- Both tabs render the same `columns` array (a column added once appears in both), so no per-tab logic is needed.
- On the Locação tab the column reads `—` for every row on the current frozen clone (all `source_document_id` are null; the cobrança webhook that populates it has not run against this clone).
  This is EXPECTED, not a bug — the column self-populates once webhook boletos arrive.

### Part 2a — enable the comprovante ↔ faturas manager on /comprovantes/[id] (zero migration)

The capability already exists; the only reason it is not usable is the gating bug.

Required fix (the real work of 2a):

- `components/comprovantes/queries.ts` `getViewerContext()` (line ~111) — make it mirror `getViewer()`: any authenticated @vammo.com session with Supabase configured returns `isOperator:true`/`isAdmin:true`, dropping the `user_roles` read (kept as a dormant restoration point per decision #26, exactly as `getViewer` does).
  Without this, `BindingsTable`, `ChargePicker` and `ReceiptCard`'s "Conciliar…" all render behind a disabled `Gate` for every user.

Add a charge to the comprovante (already built — no new control):

- `ReceiptCard`'s existing "Conciliar…" opens `ChargePicker` already bound to that receipt; it searches OPEN charges via `fetchOpenCharges`, defaults `valor = min(receipt.remaining, charge.openAmount)`, and calls `recordPayment({ chargeId, receiptId, amount, paidAt, method })`.
- `record_payment` inserts a new `payments` row sharing that receipt_id and (decision #29) flips the charge to `pago` when coverage is met and a bound receipt exists — i.e. "settle another fatura with this comprovante".
- We deliberately do NOT add a document-level "Adicionar fatura" button: it would force a new receipt-selector branch to disambiguate multi-page docs, duplicating the per-receipt `ReceiptCard` path that already exists (simplicity critic finding).

Remove a charge (already built):

- `BindingsTable` → `unmatchPayment({ paymentId, reason })` behind a reason dialog.
  Removing deletes the payment; if it was the receipt's last payment the receipt resets to `unmatched`; the charge walks back off `pago` per the hardened `unmatch_payment` (§4b).

Presentation:

- Relabel the "Vínculos" section to "Faturas quitadas por este comprovante" (`comprovante-detail.tsx` ~line 288).
- `BindingsTable`'s footer already reconciles allocated vs receipt total; keep the existing WARN-don't-block behavior when the sum of linked charges != the receipt total.
- No new server read — `getDeepDiveData` already returns `data.payments`, per-receipt `remaining`, `data.stations`, `data.totals`.

### Part 2b — Reclassificar + Vincular documento on /pagamentos rows

Both affordances go into the per-row `StatusActions` dropdown (`components/pagamentos/status-actions.tsx`), which already resolves `uuid = row.chargeUuid` and gates on `canWrite`/`uuid !== null` (disabling with "Requer papel operador/admin" / "Indisponível — requer o backend Supabase").
`chargeUuid` is null under the sheets/dev backend (`readChargeRefs` returns an empty map), so both items stay disabled there via the existing guard — no parallel guard.

Reclassificar (existing RPC, Locação tab only):

- Add a `<DropdownMenuItem>` "Reclassificar…" immediately AFTER "Ajustar valor/vencimento…" (lines 247-251) and BEFORE the `availableTargets` separator (line 252).
- Show it ONLY for non-energy rows (`row.accountType` not in `energy_enel`/`energy_edp`).
  `reclassify_charge` treats `energia`/`aluguel_energia` as a third-party account (finds/creates a `third_party` billing account); running it on an Enel/EDP scraper charge would wrongly move it off its concessionária account.
  Enel/EDP station matching stays in /revisão › Instalações (account↔station), not here.
- Extend the `DialogMode` union (lines 59-64) with `{ kind: 'reclassify' }` and add a dialog alongside the existing ones.
- The confirm handler calls the existing `reclassifyCharge` server action (`app/actions/cobrancas.ts`), which wraps the `reclassify_charge` RPC (authoritative migration 11) and already revalidates `/revisao/cobrancas`, `/pagamentos`, `/energia` (no accents in the real route path).
- `kind` is required in `ReclassifyInput`; the dialog defaults the tipo select to `row.kind` and lets the user pick Aluguel / Aluguel + energia / Energia, plus the estação/conta reattribution fields the RPC accepts (cadastroId, stationId, counterparty*).
- `reclassify_charge` refuses if the charge is `pago` or has any payments (raises pt-BR); the dialog surfaces that via the standard toast on the returned `ActionResult`.
  This limitation is intentional (it protects paid/settled charges) and is stated in the UI empty/disabled copy.
- Guard `if (!uuid) return;` like the sibling handlers; on success toast + `close()` + `router.refresh()`.

Vincular / Desvincular documento (NEW RPC + a real document picker):

- Add "Vincular documento…" and, when a document is already bound, "Desvincular documento" items to the same dropdown.
- "Vincular documento…" opens a searchable `DocumentPicker` (NEW, modeled on `ChargePicker`): a shadcn `Command` dialog listing `charging.documents` filtered to SOURCE-BILL kinds only (`fatura_enel`, `fatura_edp`, `boleto_aluguel`, `boleto_condominio`, `nota_debito`, `nfse`, `outro`), searchable by `original_filename`/kind/date, most-recent first, limit 500.
  Backed by a new `searchSourceDocumentsData()` server query + a `fetchSourceDocuments` "use server" wrapper (mirrors `searchOpenChargesData`/`fetchOpenCharges`).
- Selecting a document calls the new `setChargeDocument({ chargeId: uuid, documentId })` action; "Desvincular documento" calls `setChargeDocument({ chargeId: uuid, documentId: null })`.
- This directly serves Gabriel's "um documento chega incompleto ou sem vínculos, eu posso completar na mão": a per-station charge whose source bill the webhook did not attach can have it attached (or corrected) here.
  For a multi-station document, repeat per charge (they are already separate per-station charges).

---

## 4. Migrations

Two NEW migration files (existing migrations are already applied to the shared "Vammo Automations" project and must not be edited in place).
Latest existing is `20260709100018_station_hidden.sql` (sequence 18).

### 4a. `20260709100019_set_charge_document.sql`

`source_document_id` is not writable by any app-exposed RPC today (`reclassify_charge` never touches it; only `create_manual_bill`/the webhook set it at creation), so a dedicated writer is required.

Signature:

```sql
create or replace function charging.set_charge_document(
  p_charge_id uuid,
  p_document_id uuid
) returns void
language plpgsql
security definer
set search_path to 'charging'
```

Body, in order (mirroring the `set_station_hidden` template — the newest precedent, migration 18):

- `v_email text := charging.jwt_email();` and a `v_charge charging.charges%rowtype;` (plus `v_kind charging.document_kind;`) declared at the top.
- `if not charging.is_vammo_user() then raise exception 'not authorized'; end if;` — single guard, matching migration 18 (the collapsed-role convention; `withOperator`/`isOperatorEmail` remain the app-side restoration call sites).
- `select * into v_charge from charging.charges where id = p_charge_id for update; if not found then raise exception 'cobranca nao encontrada'; end if;`
- Document existence + KIND guard, only when binding: `if p_document_id is not null then select kind into v_kind from charging.documents where id = p_document_id; if not found then raise exception 'documento nao encontrado'; end if; if v_kind in ('comprovante','foto_medidor','contrato') then raise exception 'documento nao e uma fatura/boleto de origem'; end if; end if;`
  The kind guard prevents binding a payment proof / meter photo / contract as a source bill (completeness critic finding); it keeps "Documento de origem" and "Comprovante" from being conflated.
- Idempotency: `if v_charge.source_document_id is not distinct from p_document_id then return; end if;` (no-op, no audit row).
- Mutation: `update charging.charges set source_document_id = p_document_id, updated_at = now() where id = p_charge_id;`
- Audit (exactly one row, column order fixed as verified — `entity_table, entity_id, event_type, actor_email, detail`):

```sql
insert into charging.audit_events (entity_table, entity_id, event_type, actor_email, detail)
values (
  'charges', p_charge_id::text,
  case when p_document_id is null then 'document_unlinked' else 'document_linked' end,
  v_email,
  jsonb_build_object('previous_document_id', v_charge.source_document_id, 'document_id', p_document_id)
);
```

- Grant/revoke — BOTH statements, matching migrations 16 and 18 (defense-in-depth over migration 1's `alter default privileges`):

```sql
revoke execute on function charging.set_charge_document(uuid, uuid) from public, anon;
grant  execute on function charging.set_charge_document(uuid, uuid) to authenticated;
```

Decision — do NOT refuse when the charge is `pago`.
`source_document_id` is the charge's SOURCE bill, independent of the payment→receipt→document chain that decision #29 governs; correcting/attaching the original bill on a paid charge is a legitimate metadata fix and touches neither `status` nor `payments`.
`reclassify_charge` refuses `pago` because it rewrites attribution/amount/lines; this RPC changes exactly one nullable FK, so that refusal does not apply.
Binding is an overwrite (completing an incomplete webhook doc replaces whatever, if anything, was bound); the audit `previous_document_id` records the prior value.

Server action `setChargeDocument` (new, `app/actions/charges.ts`, via `withOperator`): calls the RPC, then `revalidatePath('/pagamentos')` + `revalidatePath('/energia')` + `revalidateSnapshot()` (following the `reclassifyCharge` precedent).

### 4b. `20260709100020_unmatch_requires_comprovante.sql`

Invariant fix for decision #29.
Today `unmatch_payment` (migration 12) walks a charge off `pago` ONLY when coverage is lost (`paid_total < amount - tol`).
A receiptless payment (e.g. a "Registrar pagamento" without a bound comprovante, which per migration 14 does not itself grant baixa) can still cover the amount after the LAST receipted payment is removed, leaving the charge `pago` with no comprovante — violating "paid iff comprovante bound".
This is reachable via Part 2a's remove flow.

Fix: re-issue `unmatch_payment` so, after deleting the payment, it walks the charge back to `atrasado`/`pendente` when EITHER coverage is lost OR no remaining payment on the charge has a non-null `receipt_id` (mirror `record_payment`'s "exists a bound receipt" condition on the reverse path).
Everything else in the RPC (receipt reset, the `::charging.charge_status` cast from migration 12, audit) is preserved verbatim.
This keeps the app's `pago` strictly comprovante-backed while leaving the scraper/portal "paid" status (a separate, displayed fact) untouched.

---

## 5. UX copy (pt-BR)

All copy is sentence case, informal "você", no emoji.

Part 1 — column: header `Documento de origem`; link `Ver documento` (external-link icon); empty `—`.

Part 2a — comprovante panel: section title `Faturas quitadas por este comprovante`; reuses existing `ChargePicker` copy ("Conciliar", "Somente em aberto" / "Todas as cobranças") and `BindingsTable` copy ("Remover", reason dialog).

Part 2b — /pagamentos row actions:

- `Reclassificar…`; dialog title `Reclassificar cobrança`; tipo select `Tipo` with `Aluguel` / `Aluguel + energia` / `Energia`; confirm `Reclassificar`; success toast `Cobrança reclassificada.`
- `Vincular documento…` / `Desvincular documento`; dialog title `Vincular documento à cobrança`; picker placeholder `Buscar por nome do arquivo…`; confirm `Vincular`; success toasts `Documento vinculado.` / `Documento desvinculado.`
- Existing disabled reasons reused: `Requer papel operador/admin`, `Indisponível — requer o backend Supabase`.

---

## 6. Edge cases

- Removing the LAST receipted payment from a comprovante: the hardened `unmatch_payment` (§4b) walks the charge back to `atrasado` (due_date past) else `pendente` because no bound-receipt payment remains, even if a receiptless payment still covers — upholding decision #29.
  The panel never writes status directly.
- Receipt total != sum of linked charges: WARN, do not block (existing `BindingsTable` footer reconciliation).
- Energy rows have no `source_document_id`: their "Documento de origem" link uses `faturaDriveUrl` (raw Drive link), a different mechanism from the `/api/files/{id}` proxy; `resolveDocumentHref` falls back correctly and never conflates the two.
- Binding a non-source-bill document (comprovante/foto_medidor/contrato): rejected by the RPC kind guard with `documento nao e uma fatura/boleto de origem`; the `DocumentPicker` also does not list those kinds.
- Clearing a binding: `set_charge_document(uuid, null)` sets `source_document_id = NULL`, writes a `document_unlinked` audit row, and does NOT touch status/payments (a paid charge stays paid — source bill is metadata).
- No-op binding (same document already bound): the `is not distinct from` short-circuit returns early, no UPDATE, no audit row.
- Reclassify on an Enel/EDP row: not offered (item hidden for energy account types); on a `pago`/paid rent row: `reclassify_charge` raises and the toast surfaces it.
- Sheets/dev backend: `chargeUuid` is null → both /pagamentos write items disabled by the existing guard; the read-only column still renders `documentHref` (null → `—`).
- Parallel paid statuses: the scraper/portal "Status portal" is unaffected by any of these writes; only `charge.status`/baixa reflects the comprovante binding.

---

## 7. Verification plan

Unit tests (pure functions):

- `resolveDocumentHref` — energy (Drive), rent-with-doc (`/api/files/{id}`), neither (null), proxy-wins-when-both.
- The Documento column `accessorFn` returns the stable filter string (`'Vinculado'`/`''`) and `csvMeta` emits it.

DB-level tests (a Supabase BRANCH, never main — `create_branch` → apply 019 + 020 → `execute_sql`):

- `set_charge_document`: bind a valid boleto → column set + one `document_linked` audit row with correct column order; bind a `comprovante`-kind doc → raises the kind guard; bind a bogus id → `documento nao encontrado`; clear (null) → `document_unlinked`; no-op → zero audit rows; bind on a `pago` charge → succeeds (metadata) with status untouched.
- `unmatch_payment` (020): construct a charge with a receiptless payment + a receipted payment that made it `pago`; remove the receipted one; assert the charge walks back to `pendente`/`atrasado` (not left `pago`); the pre-existing coverage-loss path still behaves.

Gate (must all pass): `tsc --noEmit`, `eslint`, `vitest`, `next build`.
Confirm the `Charge`/`ChargeRow`/`PagamentoRow` additions typecheck across all charge constructors (normalize, scraper-feed, gerar_mes) — `sourceDocumentId` stays optional.

Live-data checks: after applying 019/020 to a branch, and separately confirm no existing charge is `pago` without a bound receipt (a data audit of the invariant 020 enforces going forward).

Browser E2E (be picky, both light/dark, and a 375px mobile pass per the workspace UI rule):

- /pagamentos Enel/EDP tab: an energy row with `faturaDriveUrl` shows "Ver documento" opening the Drive link in a new tab; a row without shows `—`; the new column appears in the "Colunas" visibility menu and does not overflow at 375px.
- /pagamentos Locação tab: "Reclassificar…" appears (rent only, not on energy rows), opens, and completes; "Vincular documento…" opens the `DocumentPicker`, binds a boleto, the "Documento de origem" link then opens it via the proxy; "Desvincular documento" clears it.
- /comprovantes/[id]: with the `getViewerContext` fix, "Conciliar…"/"Remover" are ENABLED for a @vammo.com user; adding a second fatura to one comprovante flips it to `pago`; removing the last receipted payment walks it back off `pago`.

Adversarial review: run `code-reviewer` / `security-review` over both migrations (guard order, kind guard, audit column order, grant+revoke, the 020 walk-back logic) and the read-path + `getViewerContext` change, then fix findings before commit.

---

## 8. Sequencing

1. Part 1 + Part 2a — ZERO migration.
   Part 1: the read-path exposure (`sourceDocumentId` + `resolveDocumentHref` through domain/repo/normalize/buildRows) plus the read-only column.
   Part 2a: the `getViewerContext` gating fix + the section rename (the add/remove controls already exist).
2. Part 2b + the invariant fix — TWO migrations (`019 set_charge_document`, `020 unmatch_requires_comprovante`) plus `setChargeDocument`, the `DocumentPicker` + `searchSourceDocumentsData`, and the two dropdown items; Reclassificar reuses the existing `reclassify_charge` action.

This ships visible value with no DB change first, then the writer RPC + invariant hardening together.

---

## 9. Out of scope

- No "split" of any charge — multi-station billers already arrive as separate per-station charges.
- No schema or table change — `payments(charge_id, receipt_id)` already models N:M; `charges.source_document_id` already exists.
- No new document UPLOAD flow — this feature binds EXISTING documents only.
- No change to `reclassify_charge`, `record_payment`, or `confirm_charge` (reused as-is); `unmatch_payment` changes only to enforce decision #29.
- No document-centric bulk linking screen (attach one document to many charges from a document view) — repeat the per-charge bind for now; revisit if the volume warrants it.
- No change to the /api/files proxy or the Drive link mechanism, and no change to the scraper/portal "paid" status surface.
