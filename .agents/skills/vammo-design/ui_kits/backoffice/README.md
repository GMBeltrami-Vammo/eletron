# Vammo BackOffice UI Kit (Coupons Dashboard)

Pixel-recreation of the **coupons-dashboard** Next.js app powered by **@leopardaelectric/vammo-ui** (the production component library, shadcn/ui + Tailwind v4 + Inter).

Sources used to build this kit:
- `leopardaelectric/vammo-ui` @ develop — tokens, components, badge palette
- `leopardaelectric/coupons-dashboard` @ main — `AppLayout`, `PageHeader`, `ControlRoom`, `ManageCodes`, `Home`

## Views
- **Home** — KPI strip + redemptions bar chart + recent activity feed
- **Campaign management** — `PageHeader` + table controls (search/columns/configs/refresh) + paginated table + status badges (mirrors `views/ControlRoom.tsx`)
- **Manage codes** — same table shell, scoped to a campaign (mirrors `views/ManageCodes.tsx`)
- **Campaign builder** / **Detailed usage** — placeholder views (real implementations are large multi-step forms)

## Components
- `Sidebar.jsx` — `NavLogo` + `NavMain` + `NavUser` lockup (vammo-ui `Sidebar` primitive)
- `PageHeader.jsx` — title + right-aligned action buttons (mirrors `coupons-dashboard/PageHeader.tsx`)
- `Campaigns.jsx` — `TableControls`, `CampaignsTable` (10-color badge palette in use: blue=COUPON, yellow=PROMOTION, green=ACTIVE, orange=PAUSED, grey=DRAFT, red=REJECTED, dark-green=EXPIRED)
- `Home.jsx` — `StatCard`, `HomeKpis`, `MiniBarChart`, `RecentActivity`

## Token alignment
- Background `#F2F2F2`, card `#FFFFFF`, primary `#18181b`, ring `#18181b`
- Inter font (400/500/600/700), shadcn type scale (no `font-bold` on body)
- Radius `0.5rem` (8 px), shadow scale `xs → xl`, transitions 150–200 ms
- Badges use the 10-color palette from `vammo-ui` exactly (hex values lifted from `src/index.css`)

## Notes
- Click any sidebar item to switch views — the table card on Campaign management is the same layout the team uses in production for `ControlRoom`.
- For real production code, **import from `@leopardaelectric/vammo-ui`** instead of recreating these components — this kit is a visual reference.
