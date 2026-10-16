# Prompt: Implement role-based dashboards in TransitTechOS (light theme only)

You are working in the `transit-orchestrator` repo (FastAPI backend in `backend/`, React 18 + TypeScript + Tailwind v4 + Vite frontend in `frontend/`). Before you write any code, read these files end to end so you understand how the UI is wired:

- `frontend/src/App.tsx` (routes), `frontend/src/components/Layout.tsx` (collapsible module rail, role-filtered nav, pending-approval badge)
- `frontend/src/pages/Measures.tsx` (the current Dashboard: `GovernanceDashboard` for admin and viewer, `OperationsDashboard` for dispatcher, `MaintenanceDashboard` for shop_manager)
- `frontend/src/pages/Attention.tsx`, `WorkOrders.tsx`, `Workflows.tsx`, `WorkflowDetail.tsx`, `Shadow.tsx`, `Audit.tsx`, `Policies.tsx`
- The pages that exist but are no longer routed, which you should reuse logic from: `Performance.tsx`, `Overview.tsx`, `Fleet.tsx`, `Safety.tsx`, `Schedule.tsx`, `Evals.tsx`, `Events.tsx`
- `frontend/src/components/ui.tsx` (PageHeader, Section, Tag, SeverityTag, Loading, ErrorNote, Empty), `frontend/src/lib/live.tsx` (`useData`, live SSE refresh), `frontend/src/lib/api.ts`, `frontend/src/lib/format.ts` (`roleName`, `ago`, `clockET`, `easternNow`), `frontend/src/lib/types.ts`
- `frontend/src/index.css` (the design tokens)
- `backend/app/api/routes/metrics.py` (`/api/metrics/summary`, `/api/metrics/pilot`), `backend/app/api/deps.py` (`require_roles`), `backend/app/policy/defaults.py` (personas and permissions)

## Goal

Replace the current Dashboard (`/measures`) with four role dashboards: **Dispatcher**, **Shop manager**, **Operations admin** and **Analyst** (the `viewer` role, read-only). Every dashboard follows the same calm pattern so the screen never feels crowded. Details open only when the user asks, but the user can always see what is available.

## Hard rules

1. **Light theme only.** Do not add a dark theme, `dark:` variants, `prefers-color-scheme` queries, a theme toggle or any dark tokens. Use only the existing tokens in `index.css` (`paper`, `panel`, `rule`, `rule-soft`, `ink`, `ink-soft`, `ink-faint`, `route`, `route-dark`, `route-tint`, `reason`, `reason-line`, `signal`, `signal-ink`, `signal-tint`, `stop`, `stop-tint`, `go`, `go-tint`, `shop`, `shop-tint`, `rail`, `rail-hover`, `rail-line`). Cards are white with a `rule` border and `rounded-[14px]`, matching the existing `.card` look. Font stays IBM Plex Sans and Plex Mono for codes (vehicle IDs, run IDs, fault codes). Use `tnum` on every number.
2. **No invented numbers.** Every figure comes from an API. If data is missing, show a designed empty state ("No open work orders right now") and never a placeholder value.
3. **Do not weaken security.** Hiding things in the UI is only a clarity filter. Every write stays checked server-side by role, as it is today.
4. **Keep the collapsible rail** in `Layout.tsx` working as it does now (icon-only by default, expands with names, remembered in localStorage, slide-in menu on phones). Any new side panel must also be closable.
5. Don't delete the unrouted pages. Reuse their data logic and components where useful.
6. Keep the copy plain and specific, and write from the user's side ("3 decisions are waiting on you", not "pending approvals: 3").
7. It must work at 400px wide with no horizontal page scroll. Tables scroll inside their own container.

## Each role's menu (already in `Layout.tsx`, keep it exactly)

| Role | Menu (rail) items |
|---|---|
| Dispatcher | Dashboard, Needs your attention, Orchestrations, Maintenance · Shadow mode, Audit log · Simulate |
| Shop manager | Dashboard, Needs your attention, Orchestrations, Maintenance · Audit log · Simulate |
| Operations admin | Dashboard, Needs your attention, Orchestrations, Maintenance · Autonomy policy, Shadow mode, Audit log · Simulate |
| Analyst (`viewer`) | Dashboard, Orchestrations · Audit log |

The dashboard is a short summary that leads into these pages. **A dashboard must never link to a page that isn't in that role's menu.** For example, the shop manager never gets a link to Shadow mode or Autonomy policy, and the analyst never gets one to Maintenance or Needs your attention. Panels may still *show* read-only data from those areas when it's useful (for example, defects for the analyst), but the "Open … →" footer link only appears when the role has that page. Build this as a helper (`hasModule(role, path)`) driven by the same `groups` array in `Layout.tsx`. Move that array to `lib/modules.ts` so both files use it.

## Fix these bugs seen in the current app (screenshots of `/measures`)

1. **Broken weekly mini-charts.** In the governance cards, the 8-week bars show one large block on the last week and flat lines elsewhere, because only the last week has data and the bar height is scaled to the max. Replace them with the `Sparkline` (line + area) and show it only when at least 3 weeks have values. Otherwise show "Trend after 3 weeks of data".
2. **Unformatted minutes.** "Fault detection to open work order" shows `1095.5 min median`. Use `fmtMin` for the big value as well (→ "18 h 16 min"), and round to whole minutes under an hour.
3. **The shop manager sees the governance dashboard.** Check how `Measures.tsx`/the new switch picks the dashboard (the role string is `shop_manager`) and make sure each role gets its own dashboard.
4. **The badge covers the label.** With the rail expanded, the "Needs your attention" count sits on top of the text ("33Needs your attention"). Expanded: the badge is a pill at the right end of the row (`ml-auto`, static). Collapsed: keep it as a dot-badge on the icon.
5. **Badge count doesn't match the queue.** The shop manager's badge said 33 while the queue shows 12. The badge must count exactly what `/attention` lists for that user: pending, vehicle-health, and items they can decide. If the queue shows items for other roles, it's fine to count those too, but then the badge and the queue header must use the same filter. Also check "Fault detection to open work order = 0 min across 17 work orders" in `metrics.py` `_pilot_values`. A 0-minute median across 17 work orders suggests agent-opened work orders are being timed from the wrong event. Time it from the detect event to the work-order-created event.

## Shared layout (build once in `frontend/src/components/dashboard/`, then use for all four roles)

Top to bottom, every role dashboard has exactly these parts:

1. **Header**: an eyebrow (role · agency or context · "Thursday 15 Oct · 14:06 ET" using `easternNow`/`clockET`) and a title (greeting with the user's first name for dispatcher and shop manager, "Pilot governance" for admin, "Service performance" for analyst). The analyst gets a small "Read-only" pill next to the title. Admin and analyst get the period switch (7 days / 28 days / Pilot to date) that already exists in `GovernanceDashboard`.
2. **`Briefing`**: one sentence of what needs this person now, with a coloured dot (stop, signal, go or route by urgency) and one primary button. Build the sentence deterministically from the data (rules are below for each role). No LLM call.
3. **`StatTile` row**: exactly four tiles (2 columns under 980px). Each tile has a label, a big value, a one-line sub-text, an optional tone (good/warn/bad → `go`/`signal-ink`/`stop`) and an optional sparkline (small SVG area plus line plus emphasised last point, drawn to scale). A tile that has detail is a `<button>` that opens its side panel.
4. **Focus area**: a two-column grid (`1.25fr / 1fr`, one column under 1080px) with the role's main work, described below.
5. **`MoreViews` launcher**: a heading "More views", the hint "Everything you can open. Each one opens in a side panel.", then a grid of launcher cards (`repeat(auto-fill, minmax(210px, 1fr))`). Each card has a lucide icon in a `route-tint` square, a title, a one-line live hint (for example "7 open · 2 critical") and a count on the right. When the role has a menu page that holds the full view, the card also gets a small tag with that page's icon and name (for example "Maintenance") so people learn where things live. Clicking a card opens that panel.
6. **`SidePanel`**: a slide-over from the right (`min(560px, 100%)` wide) over an `ink/45` scrim. It has a title, a one-sentence description, the content (usually a table with sticky header), and a footer link to the full page when one exists ("Open Maintenance →"). Close with the X, Esc or a scrim click, then return focus to the button that opened it. Use `role="dialog"` and `aria-modal`, and keep focus inside the panel while it's open. Put the open panel in the URL as `?panel=<key>` so it can be linked and the back button closes it. Panel content loads only when opened (`useData` with a `null` path while closed).

Make the panels a registry (`panels.tsx`: key → `{ title, description, icon, hint(data), count(data), Content, fullPageLink?, roles }`) so the role dashboards just list keys.

## Routing changes

- Make the **Dashboard the landing page for every role**. Move "Needs your attention" from `/` to `/attention` (the Focus Queue). Update the `home` full-bleed check in `Layout.tsx` to `/attention`, the rail item, the badge links, the phone top-bar badge, `Login.tsx` redirects and every `to="/"` / `nav("/")` that meant the queue. Keep `/measures` redirecting to `/`. Today the analyst signs in to a queue they can't act on, and this change fixes that.
- Rail order stays as is, with "Dashboard" first.

## Role 1: Dispatcher

**Briefing rule:** if any escalation is pending, say "**N decisions are waiting on you, including 1 that needs manual action.**". Otherwise, if any approval is pending, use the top item in the queue order from `Attention.tsx` (escalation, then severity, then oldest): "**N decisions are waiting on you.** {vehicle} {fault title}; {runs at risk} runs at risk." Otherwise: "Nothing is waiting on you. {active} orchestrations are running on their own." Button: "Open the queue" → `/attention`.

**Tiles:** Decisions waiting (from `/api/approvals?status=pending`, filtered to vehicle-health workflows the same way `Layout.tsx` does; sub-text: escalations count; panel `escalations`) · Orchestrations in motion (`/api/metrics/summary` → `workflows.by_status` running + awaiting_approval + awaiting_event; sub-text: how many are in the shop; panel `in-motion`) · Vehicles in service (`operations.vehicles`; panel `out-of-service`) · On-time pickups, 30 days (`operations.on_time.last_30d` vs `prior_30d`; sparkline from the weekly OTP series that `Performance.tsx` uses).

**Focus, left: "Next decision" card.** This is the first item of the queue, using the same ordering, `DecisionCard` pieces (`StepBody`, `initialOverride`) and `/api/approvals/{id}/decision` call as `Attention.tsx`. Show a severity pill, "1 of N", the vehicle and step title, the fault code in mono, the 7-step progress bar, the "Why the agent proposes this" reason box (`reason`/`reason-line` tokens), and the Approve / Change / Reject buttons, respecting `can_decide`. After a decision, show a toast and move to the next item. Add a link to "Open in the queue →". Empty state: "You're all caught up."

**Focus, right: "{vehicle}'s runs today".** A horizontal timeline (SVG, 12:00–20:00 or the span of the runs) of the runs affected by the vehicle in the next decision. One row per run with the run ID in mono, a bar from start to end coloured by cover state (covered = `route`, awaiting approval = `signal`, needs cover = `stop`), the assigned spare in the bar label, a dashed "now" line and a legend. Data comes from `/api/workflows/{id}` (assessment / runs at risk) joined with `/products/trip-mgmt/runs`. If the workflow detail does not expose run start/end times, add them to the workflow detail serializer in the backend (read-only, no schema change if possible). If there's no decision, show today's runs that are running late instead.

**More views:** Today's runs and trips (`/api/schedule` or `/products/trip-mgmt/runs`; columns: run, vehicle, driver, status pill, minutes late) · No-show recovery (`summary.no_show` totals plus recent no-show workflows) · Spares and drivers available (`/api/fleet` spares plus `/products/safety/drivers`; non-compliant drivers shown with a stop pill and the reason) · Rider messages, 24h (`/products/rider-comms/notifications`) · Orchestrations in motion · Shadow comparisons (`/api/shadow/summary` plus `/api/shadow`) · Audit log (`/api/audit`, latest 20).

## Role 2: Shop manager

**Briefing rule:** first, any pending "Open work order" approvals the shop manager can decide (`/api/approvals?status=pending`, `step === "open_work_order"`, `can_decide`): "**N work orders are waiting for your approval.**", with the button "Review approvals" → `/attention` filtered to those items. Otherwise, critical open work orders without a shop start: "**N critical work orders are waiting for the shop.**", with the button "Open Maintenance". Append "{Day}'s bays are full (X of Y), so new critical work goes to {next free day}." or "{Day} is nearly full: X of Y bays booked." when a day in the next 4 is at 80% or more (`/products/asset-mgmt/shop-capacity?days=4`). If nothing applies: "The bench is clear. {open} work orders open, none critical."

**Tiles:** Work orders to approve (sub-text: how long the oldest has waited; panel `shop-approvals`) · Open work orders (sub-text: "1 critical · 2 high" from `work_orders_open.by_priority`; panel `work-orders`) · Open safety defects (`defects_open`; sub-text: how many keep a vehicle out of service; panel `defects`) · Vehicles in service (sub-text: how many are in the shop; panel `out-of-service`). PM due goes in More views. If there is no endpoint for PM overdue, add a small read-only one in `asset_mgmt/router.py` and tell me.

**Focus, left: "Shop board".** Three lanes, "Waiting for the shop", "In progress" and "Closed today", reusing the lane logic and the start/close actions from `WorkOrders.tsx` (including its Databricks-lag `done` overlay). Show at most 4 cards per lane with "+N more" linking to `/work-orders`. Each card shows the vehicle in mono, the fault and work order ID, a priority pill and one action button (Start work / Close work order) for shop_manager and admin only.

**Focus, right: "Shop bays, next 4 days".** One row per day with a horizontal bar of booked/total (`signal` at 80% or more, otherwise `route`) and "X of Y booked". The footer says: "Closing an agent-opened work order returns the vehicle to the schedule by itself."

**More views:** Preventive maintenance due · Safety defects (`/products/safety/defects`) · Driver compliance (`/products/safety/drivers`) · Shop bays by depot · Vehicles out of service (`/api/fleet`) · Orchestrations in motion · Audit log. (Open work orders and approvals are already tiles.) No Shadow mode or Autonomy policy links.

## Role 3: Operations admin

**Briefing rule:** run mode first ("**Running live.**" or "**Running in shadow mode.** Nothing is executed."). Then name the first step in `/api/metrics/pilot` `steps` with `ready === true` and `level !== "autonomous"`: "{Step} has held {x}% acceptance and is ready to move to “Agent acts”." Then the pending escalations count, if any. Button: "Review policy" → `/policies`.

**Tiles** (respecting the period switch, from `/api/metrics/pilot`): Fault to open work order (median minutes, target under 5, sparkline from `weeks`) · Runs covered before pull-out (vs baseline) · Complete audit records · Manual re-entry per incident (target 0). Reuse the status logic in `cards()` from `Measures.tsx` for tone. All four open the `pilot-measures` panel, except audit, which opens `audit`.

**Focus, left: "Autonomy readiness by step".** One row per step: name, an acceptance bar (`route` at 90% or more, otherwise `signal`), the latest %, and a tag ("Agent acts already" / "Ready for Agent acts" / "Keep approving"), the same as today's table but compact. Footer: "Steps above 90% for 4 weeks are candidates to run without approval." plus an "Open autonomy policy" button.

**Focus, right: "System health".** Rows with a status pill each: Run mode (from the policy), Event backbone (`/api/events`: count 24h, duplicates, late, stale), Product connections (adapter status: use `/api/system/info` if it has it, otherwise add a read-only `GET /api/metrics/system` that reports per-adapter calls/errors/retries from `adapters/resilience.py` and the registry), Audit shipping (`/api/audit/mirror/status`, with a "Retry" button calling `/api/audit/mirror/retry`), and Model (`/api/system/info` provider plus the latest `/api/evals` run). Prefer composing existing endpoints. Add the new endpoint only for what doesn't exist, and require `admin` on it.

**More views:** All six pilot measures (the full current `GovernanceDashboard` cards, moved into the panel) · Manual actions needed (pending escalations) · Shadow mode summary · Product connections · Model evaluation (`/api/evals`) · Who may do what (the persona permission matrix, read from `/api/policies`, read-only here, linking to `/policies`) · Audit log.

## Role 4: Analyst (`viewer`, read-only)

No action buttons anywhere on this dashboard: no approve, start, close, retry or train. Give buttons that only open panels the `btn-quiet` look.

**Briefing rule:** "**On-time pickups are {x}%.**" plus, from `/api/performance/plan?target=95`, either "The model says 95% is reachable with N changes, led by {first lever}." or "The model says 95% isn't reachable with the current levers; the best is {y}%." Button (quiet style): "See the path" → opens the `otp-path` panel.

**Tiles:** On-time pickups, 30 days (sparkline) · Late pickups (count of total, 30 days) · No-show rate (sub-text: seats recovered by the agent) · Road calls, 30 days (vs prior). Use `/api/performance/summary` and `/api/metrics/summary`.

**Focus, left: "On-time pickups, weekly".** A 12-week line/area chart drawn to scale with a light grid, the y-axis in %, a dashed `go` target line labelled "Target 95%", and the last point emphasised and labelled. Reuse the series from `Performance.tsx`.

**Focus, right: "Path to 95%".** The ranked levers from `/api/performance/plan` (number, lever name, "reaches X%", "+N pts" in `go`), with a progress bar from today to the plan's result underneath and the model version in the header sub-text.

**More views:** Late pickups by route · Operators to coach first · No-show recovery trend · Pilot measures (read-only) · Orchestration outcomes (`summary.workflows.by_status` by workflow type) · Ask a question (the `/api/performance/ask` chat, reusing `PerformanceChat.tsx`, with the suggested questions from the summary as chips) · Audit log.

## Implementation notes

- Put each role's dashboard in its own file: `pages/dashboard/DispatcherDashboard.tsx`, `ShopDashboard.tsx`, `AdminDashboard.tsx`, `AnalystDashboard.tsx`, with `pages/dashboard/index.tsx` switching on `user.role`. Remove the old dashboard functions from `Measures.tsx` (or reduce it to the switch).
- Use `useData` so tiles refresh live from the existing SSE stream. Show one `Loading` per section, not one for the whole page.
- Build charts as plain SVG components in `components/dashboard/charts.tsx` (Sparkline, LineChart, Timeline, HBar). Don't add a chart library. Colour all chart text from tokens (`ink-faint`).
- Accessibility: tiles and launcher cards are real buttons with descriptive `aria-label`s, charts have `role="img"` and an `aria-label` that states the values, the visible focus ring uses the existing `:focus-visible` style, and animations respect `prefers-reduced-motion`.
- Keep the existing keyboard shortcuts in the Focus Queue working. On the dispatcher's Next decision card, support A / C / R only while the card has focus.

## Verify before you finish

1. `cd frontend && npm run typecheck && npm run build`, both clean.
2. `cd backend && pytest`, everything passes. Add tests for any new endpoint, including a 403 for non-admins on admin-only routes.
3. Run the app and sign in with each demo account (password `demo1234`): `dispatcher@mvt.demo`, `shopmanager@mvt.demo`, `admin@mvt.demo`, `viewer@mvt.demo`, and the same four `@lsp.demo`. For each one, confirm the landing page is that role's dashboard, every tile and launcher card opens the right panel, Esc closes it, the rail collapses and expands, and nothing scrolls sideways at 400px wide. For the viewer, also confirm no action buttons appear.
4. Run demo steps 2–7 from the README (send a P0217 fault on V-107, approve the steps, close the work order as the shop manager) and confirm the dispatcher and shop manager dashboards update live.
5. Search the diff for `dark:` and `prefers-color-scheme` and confirm there are none.

When you're done, give me a short summary: the files changed, any backend endpoints you added and why, and anything in this spec you couldn't build from existing data.
