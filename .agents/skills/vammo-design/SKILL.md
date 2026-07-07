---
name: vammo-design
description: The official Vammo Design System — reconciled to the real 2023 brandbook (Strategy + Visual Identity + Manifestation) plus the 2026 mini-rebranding update. Covers both visual tracks — Brand (marketing, decks, posters, OOH, Supria Sans, 0° corners) and Product (BackOffice, internal dashboards, rider-app UI, Inter, rounded corners) — with colors, typography, logo, the Zimmzag graphic, photography, voice/tone, spacing, motion, and component conventions. Use this for ANY Vammo visual work: building or styling a dashboard/internal tool, making a slide deck or one-pager, choosing a color/font/icon, writing UI copy, or reviewing whether something "looks like Vammo" — even if the user doesn't say "design system," "brand," or "DS." This supersedes any earlier reverse-engineered guess at Vammo's style; treat this as ground truth.
origin: uploaded by Gabriel — docs 2026-07-01, fonts/logo/ui_kits/slides 2026-07-07 — official DS package reconciled to the brandbook PDFs
---

# Vammo Design System

This is the real Vammo DS, not a reconstruction. Two entry points, pick by audience:

- **Not a developer** (Marketing, CX, People, anyone writing copy or making a deck/post)?
  Read **`FOR-MARKETING-CX.md`** first — plain language, no code, no jargon.
- **Building or reviewing product UI**? Read **`README.md`** — the full 17-section spec. It's
  long but organized as a reference; skim the table of contents at §16 and jump to what's
  relevant. Read **`BRANDING_UPDATE_2026.md`** too, for the rationale behind the one change
  that matters most day-to-day: Blue got promoted to a primary color.

## What's actually in this folder vs. what's still missing

**Now provided (2026-07-07, Gabriel sent the real files):**
- `README.md`, `BRANDING_UPDATE_2026.md`, `FOR-MARKETING-CX.md`.
- `colors_and_type.css` — the **real** file (753 lines, both tracks). It replaced an earlier
  reconstructed placeholder of the same name. Everything in it is sourced, not inferred.
- `vammo-tokens.css` — an earlier draft of the same file (nearly identical, minor comment
  wording differences). Nothing in this skill or in the ui_kits references it by name — kept
  for history, treat `colors_and_type.css` as canonical.
- `fonts/` — the real Supria Sans `.otf` files (Light/Regular/Medium/Bold). `colors_and_type.css`
  already `@font-face`s them from `./fonts/`, so brand-track type now renders in the actual
  typeface, not the Archivo/Manrope fallback. (Inter's own `.ttf` files are referenced by the
  same CSS but weren't sent — Inter falls back to its Google Fonts `@import`, already in the
  file, so this doesn't break anything.)
- `assets/logo/` — the real `Vammo_Logo_{Black,White,Blue}.svg`.
- `ui_kits/rider-app/` — the real 5-screen kit (`ChargeDetailScreen`, `InvoicesScreen`,
  `MapScreen`, `ProfileScreen`, `ReservationScreen`) plus `ios-frame.jsx`, `Primitives.jsx`,
  `app.css`, its own `README.md`, and a runnable `index.html` (loads React/Babel/Lucide from
  a CDN, open it in a browser to click through the kit).
- `ui_kits/backoffice/` — the real coupons-dashboard-style kit (`Sidebar`, `PageHeader`, `Home`,
  `Campaigns`), `bo.css`, its own `README.md`, and a runnable `index.html`.
- `slides/` — the real `deck-stage.js` + a runnable `index.html` (16:9 brand-track templates).
- `assets/patterns/` — the real Zimmzag PNGs, all 3 colorways (`zimmzag-black-wide.png`,
  `zimmzag-blue-wide.png`, `zimmzag-white-wide.png`). Sent 2026-07-07 inside
  `Design assets needed urgently.zip`, byte-identical to the earlier batch's `colors_and_type.css`
  and `vammo-tokens.css` (diffed to confirm), so treat this whole zip as the canonical full
  package. This was the one gap blocking `preview/` and any brand-track composition work.
- `assets/logo/` — also gained `.png` renders (`Vammo_Logo_{Black,Blue,White}.png`) alongside the
  SVGs already on hand — use SVG for anything scalable, PNG only where a raster is required.

**Still missing** — nothing brand/color/type-critical outstanding as of 2026-07-07:
- `preview/` — a reconstructed `preview/design-system.html` exists (built from
  `colors_and_type.css`) as a stand-in; it now also shows the real Zimmzag PNGs, but the
  original DS review cards themselves weren't sent.
- **Icons** — `assets/icons/*.svg` is documented as "Lucide-derived," and Lucide is already a
  direct dependency (`lucide-react`) in VammoGrid/goBuy/VammoTestFleet, so use it directly at
  24×24 / `strokeWidth={2}` rather than guessing which curated subset the real folder contains.
- Bonus, if available: `Tom de Voz Vammo_20241122.pdf`, the original icon library (Figma), and
  high-res photography in the four brandbook contexts (README §11).

## Known overlap to resolve

Two other skills — `vammo-deck` and `vammo-brand` — reportedly also exist org-wide and likely
cover some of the same ground (brand-track material especially). This skill folder has no
visibility into their contents from inside `Desktop/Vammo` — if you're the one reconciling
them, get their SKILL.md contents (export/copy them in) so `vammo-design` can absorb whatever's
unique in them and the other two can be deprecated in favor of one canonical source, per this
workspace's own "one canonical definition per concept" rule.

## The one thing to get right first: pick a track

Vammo has **two visual tracks**. Get this wrong and everything else you do will look off-brand
even if every hex code is correct.

| | Brand track | Product track |
|---|---|---|
| Use for | Marketing, decks, posters, OOH, rider-app heroes/covers | BackOffice, internal dashboards, rider-app UI chrome, ops tools |
| Font | Supria Sans, everything, titles and body | Inter (pragmatic substitution — Supria's Monotype license is design-only) |
| Corners | 0° — rectilinear | 8px buttons/inputs, 12px cards |
| Color | Full neon freedom + Zimmzag | Grayscale base + Blue accent, other neons only for semantic status |
| Casing | Lowercase hero copy | Sentence case |

**Everything in `Desktop/Vammo` (VammoGrid, goBuy, VammoTestFleet) is Product track** —
internal BackOffice-style tools. Default to Inter, 8–12px radius, restrained color, unless
explicitly asked to build a deck, poster, or marketing page (then switch to Brand track and
read README §02–05, §12–13 closely).

## Colors — the essential table

Primary trio, all tracks: **Black `#000000`** · **White `#FFFFFF`** · **Neon Blue `#2EC2FF`**
(promoted to primary in the 2026 rebranding — see `BRANDING_UPDATE_2026.md`). Blue is the
default accent everywhere unless there's a semantic reason to reach for something else.

Restricted secondary neons — semantic use only, never decorative: **Yellow `#DFFF00`**
(passed/available), **Pink `#FF6ED8`** (failed), **Orange `#FF8032`** (notify/in-progress).
"One neon per view, and it's Blue" unless the color is carrying real meaning.

Conventional exception palette for product-UI status (this is what `goBuy` and `VammoGrid`
already implement correctly): success `#66BA50`, error `#DB4841`, warning `#EFE133`,
info `#0BA1F6`. Full tonal scales (light/mid-light/base/mid-dark/dark) for all four neons are
in README §06 — use the Blue scale freely, the others only within their restricted contexts.

## Don't skip: `@leopardaelectric/vammo-ui`

README §17 names a real, existing internal component library — `@leopardaelectric/vammo-ui`
(GitHub `leopardaelectric/vammo-ui`, v4.38.0) — plus a reference implementation,
`leopardaelectric/coupons-dashboard`. **None of VammoGrid, goBuy, or VammoTestFleet currently
use it** — they all build UI from bare shadcn/ui primitives instead. Before adding new
components to any Vammo product-track project, check whether `vammo-ui` already has it; this is
the workspace's own "reuse before you build" rule applied to design, not just code. Flag it to
Gabriel if a project should be consuming this library and isn't.

## Things this workspace's own code gets wrong or hasn't adopted yet

Cross-checking `README.md` against `VammoGrid`/`goBuy` source:
- **Font**: `VammoGrid` uses Geist (Next.js default), not Inter. Product track should be Inter.
- **Illustration**: neither project uses "Vamminho" — correctly avoided, it's deprecated (§10).
- **Component library**: neither project consumes `@leopardaelectric/vammo-ui` (see above).
- Everything else checked (accent blue, radius range, grayscale base, tabular-nums, no-bounce
  motion, no emoji) already matches the DS — `goBuy` in particular tracks it closely and even
  cites DS section numbers in its own CSS comments.

## Quick reference — voice & copy

Portuguese (BR), informal "você," short and direct, no corporate hedging, no emoji in product
UI. Currency `R$ 189,90`, dates `qui, 24 abr` (receipts `24/04/202