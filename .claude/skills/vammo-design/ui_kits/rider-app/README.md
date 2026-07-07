# Vammo Rider App UI Kit

Pixel-recreation of the Vammo consumer app based on the **provided Figma frames** (Reservation confirmation, Profile, Faturas, Charge detail, Map, In-app banner, Push notification).

## Visual style
- **Light theme** (white surfaces on `#F2F2F2`), not dark.
- **Black "hero" cards** on Profile and any black-bg moments — white text inside, semi-transparent inner panels for stats.
- **Inter** font (placeholder for Vammo's real product font; substitute if known).
- **Rounded buttons** — primary is solid black with white text (12 px radius); destructive is white + 1.5 px red border + red text.
- **Two-tab bottom nav** — Home (house) + Perfil (user). No 5-tab structure.
- **Pastel status cards** for invoices: paid → mint, open → sky blue, overdue → soft pink, closed → soft yellow.
- **Map markers** use yellow neon battery pills (count visible) — grey for empty stations.

## Screens
- `MapScreen.jsx` — cream-toned street map with battery pills, in-app maintenance banner, `Trocar bateria` CTA.
- `ProfileScreen.jsx` — Two variants via `state` prop: `'withBike'` (RFT-5768, Reserva tag, Ver documento) and `'withoutBike'` (Moto não cadastrada).
- `ReservationScreen.jsx` — Confirmation screen with green check; bottom-sheets for Reagendar / Cancelar / Feedback follow the Figma exactly (radios, copy, destructive CTA).
- `InvoicesScreen.jsx` — Faturas list. Pass `status` of `'paid'`, `'open'`, `'overdue'`, or `'closed'` to swap the pastel header card and line items.
- `ChargeDetailScreen.jsx` — Maintenance OS breakdown (Valor total expand, Pagamento/Vencimento rows, Parcelar / Acessar laudo).

## Components
- `Primitives.jsx` — `Icon` (Lucide), `NavBar` (back arrow + centered title), `TabBar` (2 tabs), `BottomSheet` (modal with icon + close + body).

## Notes & caveats
- All copy is in **Brazilian Portuguese** and follows the voice rules in the project README.
- The map is a stylized cream-toned placeholder. Production uses Google Maps via `@vis.gl/react-google-maps` (per the vammo-ui peerDependency).
- Lucide icons via CDN. The `bike` icon stands in for the Figma's filled motorcycle outline — drop in a custom SVG when ready.
- The "M" station marker visible in the Figma map (the rounded square with Vammo zigzag) was not extracted as a separate asset — currently using yellow battery count pills, which match the alternate Map frame.
