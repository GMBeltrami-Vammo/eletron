# Eletron — Q11: Enel/EDP Bill Lifecycle ("Ciclo") — Design

Date: 2026-07-09.
Status: approved by Gabriel, ready for an implementation plan.
Resolves decisions.md **Q11** (Enel/EDP monthly bill lifecycle, DA-aware).

## Goal

Show, per Enel/EDP installation, **two statuses side by side**: the concessionária's portal status (what the scraper sees) and *our* internal 4-stage processing status ("Ciclo").
The team needs to see where each bill is in our pipeline — detected on the portal, PDF analysed, exported to the fiscal sheet, paid — independently of what the portal itself reports.

## Non-goals (explicitly dropped or deferred)

The "Situação" DA-aware severity matrix (aguardando débito / atenção / crítico / conferir) is **dropped** as a view element — Gabriel does not want a worry column cluttering the view.
The broader app-wide navigation reorganization discussed alongside Q11 (separate Contratos / Aluguel / Energia views) is **parked** — this spec covers only the Enel/EDP lifecycle.
Populating stage 1 in real time is **out of scope** — it depends on a future live scraper→Supabase feed (see "Frozen-data reality").

## The Ciclo state model

The two axes are independent and both are shown:

- **Status (portal)** — the scraper's `billStatus` (Vencida / Paga / A vencer / …).
  This already exists on `/energia › Instalações` as the "Status fatura" column; it is kept and relabelled "Status portal".
- **Ciclo (nosso)** — our 4-stage processing status, derived:

| Stage | Meaning | Signal in eletron |
|---|---|---|
| **1 · Detectada** | Portal lists the bill (valor, vencimento, status) but the PDF cannot be downloaded yet and the DA registration nº is not captured | account has a current bill signal but **no parsed charge** for it (and no `auto_debit_registration` for DA accounts) |
| **2 · Analisada** | PDF downloaded + parsed | a **parsed energy charge** exists for the competência (`amount` present) and is not yet fiscal/paga |
| **3 · Enviada ao fiscal** | Exported to the FISCAL sheet | `charge.fiscal_exported = true`, not yet paga |
| **4 · Paga** | Comprovante vinculado | a `payment` with a bound `receipt` exists (DA debit *or* manual) — decision #29 |

Stage is the **furthest point reached**: Paga wins over fiscal, fiscal over analisada, analisada over detectada.
A bill paid before being exported to fiscal still shows "Paga".

## Frozen-data reality

Stage 1 ("Detectada") is essentially **empty on the current frozen clone**.
Every energy charge in the clone already has a parsed amount (0 unparsed across 538 charges), and every energy account state carries a bill status — i.e. everything was already downloaded + analysed by the R2 cutover (decision #25).
Stage 1 only starts populating once a live scraper→Supabase feed reports "detected on the portal, PDF not yet available".
The view models stage 1 honestly; it simply reads 0 until that feed exists.
Stages 2–4 are fully populated now.

## The view — enhance `/energia › Instalações`

The lifecycle lives on the existing per-installation table, not a new screen (Gabriel's choice — reuse before build).
Changes to `components/energia/instalacoes-table.tsx` + its row builder in `app/(app)/energia/page.tsx`:

- Relabel the existing "Status fatura" column → **"Status portal"** (no logic change; it is the scraper status).
- Add a **"Ciclo"** column: a stage badge (Detectada · Analisada · Enviada ao fiscal · Paga) colour-coded by stage, driven by the derivation above.
- Both columns are filterable via the existing spreadsheet header funnels (`filterableColumnIds`).
- The existing hide-list + freshness filters, sorting, CSV, and column-visibility menu are untouched.

### History drawer

Clicking an installation opens a drawer/dialog listing that account's **last ~12 competências**, most recent first.
Each row: mês (competência) · valor · vencimento · Ciclo (derived per charge) · comprovante (chip when bound).
Data source: `snapshot.charges` filtered to the account's `billing_account_id`, sorted by competência.
Portal status is a current, account-level signal (not stored per historical fatura), so history shows the per-charge Ciclo rather than a historical portal status.
The drawer is a self-contained component so it does not depend on the shared `DataTable` supporting expandable rows.

## Alert refinement (in scope)

Amends decision #29's "WITHOUT DA → worry 7 days before due".
For **sem-DA energy accounts**, the worry now fires **as soon as the bill is Ciclo 2 (analisada)** — i.e. once a parsed, unpaid charge exists for the competência — instead of waiting for the 7-days-before-due window.
Rationale: a sem-DA bill has no auto-debit to settle it, so the moment we have analysed it, it is actionable.
A detected-only (Ciclo 1) bill never alarms.
DA accounts keep their existing behaviour (worry only after the due date; suppressed once a settled energy charge exists for the month — decision #29).
This is a rule change in `lib/ingest/derive.ts` (`evaluateAlerts`), not a new view column.

## Data & wiring (no schema/RPC change)

Everything derives from data already in the snapshot:

- The `InstalacaoRow` builder (`app/(app)/energia/page.tsx`) must additionally resolve, per account, its **latest energy charge** and that charge's `fiscal_exported` + payment-link, so the row can carry the derived Ciclo stage.
- A pure `energyCicloStage(charge, fiscalExported, paymentLink, accountBillSignal)` helper (new, in `lib/ingest/derive.ts` or a small `lib/energia/ciclo.ts`) returns the stage — unit-testable in isolation.
- No migration, no RPC, no new Supabase objects.

## Testing

- Unit-test `energyCicloStage` across the four stages + the "paid before fiscal" edge (Paga wins).
- Unit-test the amended sem-DA alert: a sem-DA analisada unpaid charge alarms immediately; a DA analisada charge does not (until due); a Ciclo-1 detected bill never alarms.
- Browser: `/energia › Instalações` shows both Status portal + Ciclo columns, the funnels filter both, and the history drawer opens with the account's competências.

## Open items / future

- Stage 1 population depends on a future live scraper→Supabase feed (scraper-side project, per decision #25) — flagged, not built here.
- The parked navigation reorganization (Contratos / Aluguel / Energia split) can reuse this Ciclo derivation when/if it happens.
