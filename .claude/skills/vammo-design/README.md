# Vammo Design System

**Vammo** is a São Paulo–based electric‑motorcycle subscription with battery‑swap stations. Brazilian, urban, community‑driven. The product surface is split across three audiences:

1. **Cliente (rider app)** — iOS/Android consumer app for subscribers: plan management, swap‑station map, battery health, billing, support.
2. **BackOffice / internal dashboards** — operations consoles (campaigns, coupons, fleet, stations, riders, finance) built with the in‑house React library `@leopardaelectric/vammo-ui`.
3. **Marketing & investor surfaces** — decks, posters, web pages, OOH built on the brandbook.

> **2026 update** — this DS was first generated from logo + color exports only. The three official Brandbook PDFs (Brand Strategy, Visual Identity, Brand Manifestation) are now in `uploads/` and this version reconciles the system to them. Look for the **🅑 brandbook** markers in this document — those rules come directly from the brandbook and override any earlier inferred guidance.
>
> **2026 mini-rebranding** — after the brandbook was reconciled, an internal
> rebranding promoted **Neon Blue `#2EC2FF` to primary** alongside Black and
> White. Yellow / Pink / Orange remain in the system but are now restricted to
> alerts and brand-led poster moments. Hex values are unchanged. The change
> is recorded in `BRANDING_UPDATE_2026.md`; §06 below has been rewritten to
> match. When the brandbook and this update disagree on hierarchy, **this
> update wins** — the brandbook still owns everything else (Strategy, Logo,
> Zimmzag, Typography, Photography, Voice).

---

## 01 · Brand Strategy 🅑

The strategic core that everything else expresses. Quoted from the Brand Strategy document.

| | |
|---|---|
| **Category Truth** | E‑mobility is transformative but the conversation is stuck on rational specs and look‑alike visual codes. Vammo's opportunity: define a fresh, bold way to lead the conversation with new codes across the customer journey. |
| **Human Truth** | Changing behavior takes effort; people only move when gains > effort. Vammo earns the change with an affordable, intuitive, engaging experience — both inside and outside the stations — through rewarding rituals, conviviality and hospitality. |
| **Purpose** | **We empower bikers** to control the way they move towards a deserved present and a desired future. |
| **Value Offer** | A one‑of‑a‑kind, community‑centered experience powered by technology. |
| **Brand Direction** | **Regenerating the future.** Beyond sustainability and mitigating harm — actually restoring and nurturing. Creating conditions in which ecosystems, economies and people can flourish. |
| **Anthem line** | *The hustle never stops* — PT‑BR: *O corre não para.* |

### Territories
Conceptual spaces Vammo occupies on people's minds:

- **Community** — a union of people with shared interests where everyone is truly valued. Bonding, accountability, belonging, pride, visibility. *Not:* isolation, judgement, cult.
- **Pure velocity** — committed to constant growth and improving reality. Stimulus, action, positive attitude, unconventional, nonconformist. *Not:* self‑centered, dreamy, distant.
- **(R)Evolution** — doing things differently for good. Empowering, recharging, challenging the status quo, vanguardist. *Not:* aggression, chaos, disrespect.

### Personality
Three archetypes that color every brand expression:

- **Visionary** — starts the future in the present. Anticipates solutions, assertive, continuous beta, risk‑taker.
- **Connector** — bonds people. Empathy, social flexibility, friendly, inclusive, genuine interest.
- **Explorer** — never stops believing in dreams. Pushes boundaries, the journey *is* the path.

When in doubt about copy or imagery: ask *would a Visionary‑Connector‑Explorer say/show this?*

---

## 02 · Two‑track visual system

There are **two visual tracks** at Vammo. Pick the right one for the surface BEFORE you start designing:

| | **Brand** track | **Product** track |
|---|---|---|
| **Use for** | Marketing, decks, posters, OOH, rider‑app heroes & covers | Rider‑app UI chrome, BackOffice, internal tools, ops |
| **Source of truth** | Brandbook PDFs + `colors_and_type.css` (`.b-*` classes) | `@leopardaelectric/vammo-ui` (`.vammo-ui` block) |
| **Display + body type** | **Supria Sans** for everything (titles AND body) — brandbook p.64 🅑 | **Inter** for everything (pragmatic substitution for legibility under 18 px) |
| **Casing** | Lowercase on hero/marketing • Mixed on body | Sentence case on UI |
| **Color** | Black/white/blue primary + 3 restricted neons + tonal scales + Zimmzag | Zinc/neutral base + 10‑color semantic badge palette |
| **Radius** | **0° corners** — rectilinear, geometric, blocked 🅑 | 8 px buttons/inputs, 12 px cards, 16 px sheet tops |
| **Shadow** | Flat; soft drop‑shadow allowed on white cards 🅑 | Layered: `shadow-sm` → `shadow-md` → `shadow-lg` |
| **Cards** | Square 90° corners, optional 1 px border 🅑 | Rounded 12 px, 1 px border or `shadow-md` |
| **Iconography** | Bold (8 pt stroke) / Light (4 pt stroke) on 48×48 grid, bevel corners — brandbook p.74–76 🅑 ⚠ **substituted** below | Same set on product UI; Lucide fallback |
| **Components** | Hand‑crafted per surface | Mobile component kit + shadcn primitives |

**Don't mix tracks** for the display voice on the same surface.

---

## 03 · Logo 🅑

The Vammo wordmark is lowercase, geometric, and built on a double‑M that becomes the brand's main graphic asset (the **Zimmzag**, see §05). Treat it like architecture, not decoration.

### Files
`assets/logo/Vammo_Logo_{Black,White,Blue}.{svg,png}`.

- **Black** wordmark → use on white, on the Blue accent, on photographs (default).
- **White** wordmark → use **only** on a black background.
- **Blue** wordmark → official lockup since the 2026 rebranding. Use on
  black or white surfaces where the accent should carry into the wordmark
  itself (covers, sub-brand lockups, special moments). Reserved — pick
  Black or White first; Blue lockup is the deliberate accent move.

### Protection area
Margin = width of the **X** (the side stem of the M in the wordmark). Maintain on all four sides.

### Minimum size
Print: **15 mm** wide · Digital: **80 px** wide.

### Don'ts
Don't outline, distort, rotate beyond 45°, change letters, change colors, overlap with other elements, put inside a box, apply drop shadow, or apply a gradient.

### Symbol
The **mm** symbol is the simplified, croppable form of the wordmark. Use only when space is restricted — app icon, social avatar, favicon, watermark. Preserve the same X margin and the minimum visible area of the M.

---

## 04 · Logo as a graphic 🅑

The logo itself doubles as a brand asset in three modes (brandbook p.33–37):

1. **Movement** — repeat the wordmark along a diagonal (≤ 45°) or horizontally to convey propulsion and rhythm. Keep the minimum M area visible. No random angles. No aligned/grid repetitions.
2. **Supergraphic** — set the logo at huge scale, bleeding off the layout (one or two lines). Used as the dominant element on a poster or cover.
3. **Signature** — small scale, in a corner or center, with protection area. Reinforces presence inside a layout that already has other elements.

Mode is a choice, not a stack — never combine two modes in the same composition.

---

## 05 · Zimmzag — the brand graphic 🅑

**Zimmzag** (official name, brandbook p.53 — *not* "zigzag") is the continuous "mmm" pattern that extends the double M of the logo. It is the most expressive element of the system — used at huge scale, bleeding off the layout, as movement, supergraphic, photo mask, or background.

Files in `assets/patterns/`: `zigzag-{blue,black,white}-wide.png` (kept on disk under the legacy file name; refer to it as Zimmzag everywhere else).

### Three usage guidelines

- **Minimum area** — preserve the visible M shape; never crop into the stem.
- **Expanded** — scale up large; the M must still read.
- **Continuous** — repeat the graphic so it bleeds off every edge it touches; never end inside the layout.

### Five canonical uses
1. Bleeding across a full block of color
2. Next to the wordmark as part of a signature
3. Pure horizontal repetition behind text
4. Combined with logo + text in a poster composition
5. Across the layout *behind* a photograph (the graphic must not obscure the focal point)
6. **Photo‑as‑mask** — use the Zimmzag silhouette as a clipping mask for sustainability/mobility/energy imagery

### Don'ts
- ❌ Leave margins around it (must bleed)
- ❌ End the graphic inside the layout
- ❌ Overexpand or deconstruct
- ❌ Affect the minimum M area
- ❌ Overlap two Zimmzag layers

---

## 06 · Colors 🅑

> **2026 mini-rebranding** — see `BRANDING_UPDATE_2026.md`. Blue (`#2EC2FF`) is
> promoted from secondary to primary. Yellow / Pink / Orange remain in the
> system but become restricted-use (alerts + brand poster/OOH moments only).
> The brandbook hexes do not change; the *hierarchy* does.

### Primary (trio)
**Black** `#000000` · **White** `#FFFFFF` · **Neon Blue** `#2EC2FF`. These
three carry the brand. Backgrounds, primary surfaces, body text, logo
lockups, CTAs, eyebrows, links, active icons, hero accents — primary contrast
and the default accent all live here.

- `#000000` Black — surfaces, primary contrast, body text, default logo color.
- `#FFFFFF` White — surfaces, inverse contrast, white logo on black.
- `#2EC2FF` Blue (Pantone 298 C) — **default accent.** Eyebrows, links,
  hero accents, CTAs, active icons, focus rings, neon callouts. The one
  neon you reach for unless there is a semantic reason to pick another.

### Secondary (3 neons, restricted use)
| Name | HEX (digital) | HEX (print) | Pantone | Allowed use |
|---|---|---|---|---|
| **Neon Yellow** | `#DFFF00` | `#DBFF00` | 396 C | Alert "passed", swap-available chips, Zimmzag yellow colorway. |
| **Neon Pink** | `#FF6ED8` | `#FF6ED8` | 231 C | Alert "failed", promo & social posters. |
| **Neon Orange** | `#FF8032` | `#FF8032` | 2018 C | Alert "notify/warning", charging/in-progress state. |

**Use them when the color carries meaning** (alert state, status chip) **or
when a brand poster intentionally cranks the saturation**. Don't use them as
default accents, eyebrow colors, decorative dividers, or category tints on
product UI. If you find yourself reaching for yellow/pink/orange because
"the slide needs more color", reach for Blue, the tonal Blue scale, or
black/white contrast instead.

**Differentiating categories** (3 suppliers, 3 sectors, 3 plans) — do **not**
use 3 neons. Lead with Blue for the primary item and use grayscale, structure
(borders, fills, icons) or typographic weight to separate the rest.

### Tonal scale (each neon × 4 tones, brandbook p.42–45) 🅑
Every neon ships with four tones — Light, Mid‑Light, Mid‑Dark, Dark — all AAA‑accessible on white per brandbook source. **Use the Blue scale freely** for hover, fills, illustration backgrounds, chips, and text-on-tint. The Yellow/Pink/Orange scales inherit the restricted-use rule of their base.

| | Light | Mid‑Light | Base | Mid‑Dark | Dark |
|---|---|---|---|---|---|
| Blue   | `#93DFFF` | `#60D1FF` | `#2EC2FF` | `#0AB8FF` | `#0099EF` |
| Yellow | `#F3FF84` | `#E5FF32` | `#DFFF00` | `#B4CE00` | `#A1B700` |
| Pink   | `#FFA4E3` | `#FF7EDC` | `#FF6ED8` | `#F259C9` | `#EF3ABF` |
| Orange | `#FFA984` | `#FF8F4A` | `#FF8032` | `#F0782E` | `#D76611` |

Exposed in CSS as `--vammo-<color>-{light,mid-light,base,mid-dark,dark}`.

### Digital complementary grayscale (brandbook p.47) 🅑
For loading, hover, disabled fills, feedback backgrounds.

`#E6E6E6` · `#CBCBCB` · `#BCB9B9` · `#8D8D8D` · `#595959`

### Tokens
- `--brand-primary` → Black (`#000000`) — surface/contrast role.
- `--brand-accent` → Blue (`#2EC2FF`) — **default accent token; reach for this first.**
- `--brand-neon-{blue,yellow,pink,orange}` → the four neons. Yellow/Pink/Orange aliases now carry a "restricted use" docstring in `colors_and_type.css`.
- `--vammo-blue-{light,mid-light,base,mid-dark,dark}` → the Blue tonal scale, used freely.

### Where each palette goes
- **Primary trio (B/W/Blue)** — every surface. Default accent.
- **Yellow / Pink / Orange** — alerts, semantic chips, brand-led poster moments only.
- **Tonal Blue scale** — hover, fills, illustration backgrounds, chips, text-on-tint.
- **Tonal Yellow/Pink/Orange** — same scope as their base (alert states only).

---

## 07 · Alert palettes 🅑

The brandbook ships **two** alert palettes (p.48). Pick one per surface and stick with it.

### Main palette — brand neons as alerts
Reserved for brand surfaces and brand‑led UI where audiences can learn the mapping.

| State | Color | Token |
|---|---|---|
| Passed | `#DFFF00` Yellow | `--alert-passed` |
| Failed | `#FF6ED8` Pink | `--alert-failed` |
| Notify / Warning | `#FF8032` Orange | `--alert-notify` |
| Information | `#0AB8FF` Blue (mid‑dark) | `--alert-info` |

### Exception palette — conventional UX
Use in any general product UI / BackOffice / transactional flow where users expect *green = good, red = bad*.

| State | Color | Token |
|---|---|---|
| Success | `#66BA50` | `--success` |
| Error | `#DB4841` | `--error` |
| Warning | `#EFE133` | `--warning` |
| Information | `#0BA1F6` | `--info` |

Earlier kit shipped slightly off hexes (`#DE4841`, `#E5CF00`, `#0BA4F9`) — now corrected to the brandbook values.

---

## 08 · Typography 🅑

### Brandbook ground truth
**Supria Sans is the only typeface.** Used for titles AND body. Geometric with slightly diagonal endings — digital approach with a human touch. Family ships in **Light · Regular · Medium · Bold** (300 / 400 / 500 / 700).

### Visual hierarchy (brandbook p.65)

| Level | Weight | Class (brand track) |
|---|---|---|
| Display 1 | Bold (700) | `.b-display-1` |
| Display 2 | Medium (500) | `.b-display-2` |
| Headline 1 | Bold (700) | `.b-headline-1` |
| Headline 2 | Medium (500) | `.b-headline-2` |
| Headline 3 | Regular (400) | `.b-headline-3` |
| Subhead 1 | Medium (500) | `.b-subhead-1` |
| Subhead 2 | Regular (400) | `.b-subhead-2` |
| Body 1 | Regular (400) | `.b-body-1` |
| Body 2 | Light (300) | `.b-body-2` |

### Pragmatic product‑UI substitution
Supria Sans is licensed under the **Monotype EULA** — keep it bundled only for design‑system previews. For shipped product‑UI surfaces (rider app, BackOffice, web) we substitute **Inter** (variable, SIL‑OFL). Inter sits well at 12–16 px where Supria's proportions drift. Brand surfaces (decks, posters, marketing, hero blocks) keep Supria for everything.

For **public web deployments** that need a Google Fonts equivalent of Supria, the closest matches are **Archivo** or **Manrope** at the corresponding weights.

### Casing
- **Hero / marketing** → lowercase Supria (`o corre não para`, `keep going`, `the future is electric`).
- **UI titles inside app screens** → sentence case (`Próxima troca`).
- **Eyebrows / micro‑labels** → ALL CAPS with `tracking-eyebrow` (`STATUS DA BATERIA`).
- **Buttons** → sentence case verb phrases (`Trocar agora`, `Ver estações`, `Saiba mais`, `Assinar já!`).

### Numbers, currency, dates, time
- Currency: `R$ 189,90` — space after R$, comma decimal. Round prices on marketing may drop decimals (`R$ 299/semana`).
- Numbers + units: `60 km`, `1500W`, `50cc`, `R$ 299/semana`.
- Dates (rider‑facing): `qui, 24 abr` · `24 de abril`. Receipts: `24/04/2026`.
- Time: 24‑hour. `14h32`, `08h00`.
- Tabular‑nums (`.v-tabular`) for any column of figures.

---

## 09 · Iconography 🅑 ⚠ substituted

### Brandbook ground truth (p.73–77)
Vammo ships **two icon families**:

- **Bold** — primary, **8 pt stroke**, on 48×48 grid, bevel corners (derived from the M's diagonal/vertical junction).
- **Light** — for small sizes where the Bold version loses legibility. **4 pt stroke**, same grid.

Each icon has:
- A subtraction area of a 2×2 squares grid to express a continuous stroke movement
- Bevel corners (not rounded)
- Three layout formats: **Rounded**, **Horizontal**, **Vertical**

Correct uses: single icon shape · over neon with black stroke · over black with neon and white stroke · with a black outline shape.

Incorrect uses: more than one color · filled shapes · neon strokes when not over black · drop shadows.

### What's in this repo ⚠
`assets/icons/*.svg` ship a Lucide‑derived set (24×24, 2 pt stroke, rounded joins). **This is a substitution** — pragmatically optimized for production UI where 8 pt strokes won't render at 16 px. The official Vammo icon set with bevel corners and 8 pt/4 pt families isn't in our hands; **point us at the Figma library and we'll swap.**

Until then:
- **Sizing:** 16 / 20 / **24** (default) / 32 / 40. 44 × 44 hit area minimum.
- **Color:** inherits `currentColor`. Tinted only for state: `--vammo-orange` swap‑in‑progress, `--vammo-yellow` available, `--vammo-blue` selected, `--error` error.
- **Fill vs stroke:** stroked default. Filled variants only for active tab and small alert chips.

---

## 10 · Illustration — *Vamminho* ("Little Guy") 🅑 ⛔ DEPRECATED (2026)

**Vamminho** (internally; "Little Guy" in the 2023 brandbook p.79–82) is the brand's illustration character — duotone retro cartoon, handmade line, exaggerated proportions. It was **core to the 2023 brandbook** and is now **deprecated as of the 2026 rebranding**.

> **Do not use in new material.** Vamminho is archived for institutional memory — to recognize the character in legacy pieces, not to reapply it. Source files: `assets/illustration/vamminho-*.png` (avatar / greeting / using-the-app / battery-swap). Reference card: `preview/illustration-style.html`.

**Use instead** on surfaces that would have called for illustration:
- **Zimmzag** — signature graphic for brand surfaces.
- **Photography** — the four brandbook contexts (§11).
- **Logo-as-graphic** — logo crops for map marks / highlights.
- **Icons** — didactic / step-by-step content moves to the icon set, not the character.

Historical spec (reference only): duotone (white + one neon), handmade tracing lines, round-parameter construction, exaggerated body expression, retro cartoon.

---

## 11 · Photography 🅑

Vammo photography is **urban, warm, natural, human**. *Not* night‑neon stock — that was an early inference, the brandbook calls for natural lighting and warmer color treatment.

### Four contexts (brandbook p.67–71)
1. **Urban Elements** — São Paulo daily life. Crosswalks, traffic lights, pedestrians, motion blur, riders waiting at lights, riding among cars, swapping batteries. Brings the brand into its native arena.
2. **Community** — bonding, diverse casting, real people, positive/spontaneous/cool expressions, both outdoors and indoors. Vammo apparel visible.
3. **The Rider** — each rider's own style. Natural expression mid‑action: delivering a package, on the phone, opening the trunk, looking around. Helmet, cap, delivery bag visible.
4. **Hero Product** — the bike as protagonist. Tight crops on the battery, seat, rear lights, swap mechanism. Vammo logo on the bike visible.

### Treatment
- Natural lighting; warm color treatment.
- Diverse casting.
- Mid‑action, mid‑scene — never posed against seamless paper.
- Zimmzag may pass behind the subject; never obscures the focal point.

---

## 12 · Composition — backgrounds 🅑

Three canonical background modes:

1. **Solid black** — primary hero, ride/swap moments, BackOffice dark theme.
2. **Solid white / off‑white** — content, settings, dashboards, default app.
3. **Zimmzag full‑bleed** — assets/patterns/zigzag‑{blue, black, white}‑wide.png. Three colorways: **blue on black (default)**, **black on white**, **white on black**. Never tiled, never recolored. Treat as a logo lockup.

No photographic gradients. No glassmorphism. No skeuomorphic textures.

---

## 13 · Voice & tone 🅑

São Paulo rider voice: **short, declarative, direct, a little playful**. Mostly Portuguese (BR); English for international/investor material.

### Brandbook anthem lines
> *O corre não para.* — the hustle never stops
> *The future is electric.*
> *No pump. Charge up.*
> *Keep going. / Keep moving forward, faster & smarter.*
> *Faster & Smarter.*
> *Porque o corre não para.*

Build new copy off of these, not against them.

### Rules
- **Direct and active.** "Troque sua bateria" — not "Você pode trocar sua bateria caso queira."
- **Lowercase voice on hero/marketing.** "o corre não para", "keep going", "no pump. charge up." UI labels follow normal sentence case.
- **2nd person, informal "você".** Never "tu", never "o cliente". BackOffice can be slightly more formal but still "você".
- **No corporate hedging.** No "pode ser que", "possivelmente", "estamos avaliando". State what is.
- **Urban + tech, not techy‑cute.** No memes, no rockets, no magic. Speak about energy, speed, the city, swap, range.
- **No emoji** in product UI. Marketing/MGM may use Unicode arrows (`→`, `↓`).

### Sample copy
| Surface | Good | Avoid |
|---|---|---|
| Hero | `bateria zerada? troca em 60s.` | `Tenha a melhor experiência de troca!` |
| Push | `Sua próxima troca está a 3 quadras.` | `Olá! Notamos que você está próximo…` |
| Error | `Sem sinal aqui. Tente em alguns segundos.` | `Ocorreu uma falha inesperada.` |
| Empty | `Nenhuma troca por aqui ainda.` | `Você ainda não realizou nenhuma troca.` |
| Confirm | `Pronto. Plano ativo até 12/jun.` | `Solicitação processada com sucesso!` |
| Plan name | `Tira Onda`, `Desenrola`, `Economiza` | generic `Premium`, `Pro` |

---

## 14 · Visual foundations (product track)

### Spacing
4‑pt grid. Tokens `--s-1` (4) → `--s-32` (128). Layout breathes on `--s-6` (24) / `--s-8` (32). Hero surfaces use `--s-16` / `--s-24`.

### Corners
Rectilinear is the brand. **Default radius is 0.** Product UI cards use 12 px (`--r-3`), buttons/inputs 8 px (`--r-2`). Pills (`--r-pill`) reserved for status chips and avatars only — never for buttons.

### Borders
1 px hairlines (`--border`) on light, `--border-strong` on dark. Heavy 2 px borders in neon or solid black for emphasis.

### Shadows / elevation
The brand is flat. Real shadows are rare; brand cards may use a soft drop shadow on white (brandbook p.50). Hero pieces favor neon "glow" rings (`--shadow-neon-blue`, etc.) over soft drops.

### Motion
- `--d-1` 120 ms · `--d-2` 200 ms · `--d-3` 320 ms.
- Easing: `--ease-snap` for UI feedback, `--ease-standard` for layout shifts.
- **No bounce.** Signature animation: Zimmzag slides horizontally at low velocity behind hero copy. That's the one indulgence.

### Mobile component anatomy (rider‑app)
- Header — 52 dp; back arrow left, title `v-h5`, optional caption 12/16.
- Tab bar compact — 52 dp; 2 px black underline on active; 8 px error dot with 1.5 px white ring.
- Tab bar labeled — 80 dp incl. safe area; 24 px icon + 10/12 caption; active = bold caption + 4×4 blue dot floating above icon.
- List‑button — 72 dp tall, 24 px gutters; chevron right.
- Sticky CTA — 52 dp pinned 16 dp above home indicator.
- Bottom sheet — 16 px top corners, 0 bottom, `shadow-sheet`. Drag handle 28×4 pill.
- Map pin — 8 px radius pill + 12 px tail. Yellow available · blue selected · black low (≤2) · black square offline.
- Toast — 8 px radius, min‑height 52 px, 14 px body.

### Things we explicitly DO NOT do
- ❌ Bluish‑purple gradients
- ❌ Soft rounded "friendly" cards (≥ 16 px radius) on the brand track
- ❌ Emoji
- ❌ Glassmorphism / frosted gradients
- ❌ Pastel anything
- ❌ Cards with a colored left‑border accent only
- ❌ Drop‑shadow stacks for "depth"
- ❌ Stock‑warm photography without an urban context

---

## 15 · Divergences from brandbook (transparency)

Things in this kit that deviate from the official 2023 brandbook — kept on purpose for pragmatic reasons, but flagged so the brand team can decide:

| | Brandbook says | This kit ships | Reason |
|---|---|---|---|
| Color hierarchy | Primary = Black + White; Blue is one of 4 secondaries | **Primary = Black + White + Blue**; Yellow/Pink/Orange = restricted-use secondaries | **2026 internal rebranding.** Documented in `BRANDING_UPDATE_2026.md` — supersedes the 2023 brandbook hierarchy. Hex values unchanged. |
| Body type | Supria Sans for everything | Inter for product UI; Supria for brand surfaces | Supria's Monotype license is design‑only; Inter at 12–16 px is more legible. |
| Icon stroke | 8 pt (Bold) / 4 pt (Light) on 48×48 | 2 pt Lucide‑style on 24×24 | We don't have the official Vammo icon library. **Please share Figma**, we'll swap. |
| Product card radius | 90° corners | 12 px on product UI; 0° on brand surfaces | Product UI legibility/affordance. Brand surfaces remain rectilinear. |
| Blue logo lockup | Not in 2023 brandbook | Shipped as `Vammo_Logo_Blue.{svg,png}` | **Promoted to official** by the 2026 rebranding alongside Blue moving to primary. |
| Illustration | Little Guy duotone system | **Vamminho — deprecated** | Core to the 2023 brandbook; sunset in the 2026 rebranding. Source files archived at `assets/illustration/`. Replaced by Zimmzag + photography. Kept for institutional memory, not reuse. |
| "Zimmzag" filename | `Zimmzag` | `zigzag-*-wide.png` on disk | Earlier file naming. The brandbook name is **Zimmzag** — use that in copy everywhere. |

---

## 16 · Index — what's in this folder

```
README.md                    ← you are here
SKILL.md                     ← agent skill frontmatter
colors_and_type.css          ← brand tokens + product tokens, both tracks
fonts/                       ← Supria Sans .otf (Light/Regular/Medium/Bold)
assets/
  logo/                      ← wordmark, 3 colors, SVG + PNG
  patterns/                  ← Zimmzag, 3 colorways
  icons/                     ← UI icon set (Lucide‑derived; flagged substitution)
  source/                    ← original PDFs
preview/                     ← Design System review cards (rendered in the DS tab)
ui_kits/
  rider-app/                 ← iOS‑style consumer app kit (5 screens)
  backoffice/                ← Coupons dashboard
slides/                      ← 16:9 brand‑track templates
uploads/                     ← raw brand inputs (Brandbook PDFs, fonts, logos)
```

> **Note (this workspace copy):** only `README.md` and `BRANDING_UPDATE_2026.md` were provided
> here — `colors_and_type.css`, `fonts/`, `assets/`, `preview/`, `ui_kits/`, `slides/`, and
> `uploads/` are not present in `Desktop/Vammo/.claude/skills/vammo-design/`. Treat hex values
> and token names above as authoritative; don't assume any token is actually wired into a real
> CSS file in this workspace until you check the target project's own stylesheet.

---

## 17 · Sources

**Brandbook PDFs** (`uploads/Brandbook - *.pdf`) — Brand Strategy (25 pp · 2023), Visual Identity (70 pp), Brand Manifestation (36 pp). Authoritative source for sections marked 🅑.

**Color sources:**
- `uploads/ColorsBoard_Vammo.pdf` — official HEX/RGB values ✅ parsed
- Brandbook Visual Identity p.39–47 — Pantone + HEX + tonal scales ✅ reconciled

**Font sources:**
- `uploads/SupriaSans-{Light,Regular,Medium,Bold}.otf` ✅ installed (Monotype EULA)

**Logo sources:**
- `uploads/Vammo_Logo_{Black,White,Blue}.{svg,png}` ✅ copied to `assets/logo/`
- `uploads/Group*.png` (Zimmzag colorways) ✅ copied to `assets/patterns/`

**GitHub** (`leopardaelectric/*` — Product track):
- `leopardaelectric/vammo-ui` @ `develop` — `@leopardaelectric/vammo-ui` v4.38.0 React library. Tokens lifted from `src/index.css`.
- `leopardaelectric/coupons-dashboard` @ `main` — Real‑world BackOffice reference.

**Still missing** (would unlock more):
- `Tom de Voz Vammo_20241122.pdf` (voice guidelines beyond p.96+ of Brand Manifestation)
- The original Vammo icon library (Bold + Light families) — Figma source preferred
- High‑resolution photography in the four brandbook contexts
