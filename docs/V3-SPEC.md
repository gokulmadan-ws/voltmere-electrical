# V3 SPEC: make it the site and platform 180 Electrical switches to

Status: built. Later rounds changed some details, so where this file disagrees with `V4-HANDOFF.md`, `V3-API.md` or `V4-API.md`, those win (for example: a quote accepted through the WhatsApp link makes an unscheduled install, and customers never read the words pencilled or provisional). The landing page's look (light by default, one typeface, his words verbatim, no gradients over photos) is now specified in `LANDING-V5.md`, which wins over section 5 below. The root `README.md` says how to run and demo the result.

Audience: coding agents (LLMs) working in parallel on disjoint files. Read `docs/reference/180-site-report.md` (his real site) and `docs/BUILD-CONTRACT.md` (names are law: do not rename any existing export, CSS class, token, data-testid, route, storage key or message kind; you may ADD names, prefixed by your role). This spec ADDS to the contract and to the v2 rebrand (180 Electrical, EV chargers, Northern Ireland, quote-led, his 6-step funnel). Where this file and the contract disagree, this file wins for the new features.

## 0. The bar

The owner is an electrician who pays an agency for a funnel that sends him a WhatsApp ping. He must look at this on his phone and think: "this is my business, it looks better than my agency's page, it runs my whole sales process, and I want it live today." That means:
- Landing page: premium, fast, trustworthy, unmistakably HIS (logo, red/black, his photos, his words, his phone). Not a template. Real craft: typographic hierarchy, spacing rhythm, depth, restrained motion (respect prefers-reduced-motion), flawless at 320 to 1440, no layout shift, images lazy and sized, no console errors.
- Dashboard: a real tool for his whole sales process (enquiry, survey, quote, accepted, install, paid), glanceable on a phone in a van, with money and response-time numbers that matter to a business that buys Facebook ads.
- Admin: a Connections area where he sets up his domain, WhatsApp, Google Calendar, Gmail and the webhook from his funnel. NOTHING is really connected in a static prototype: every connection is SIMULATED, saved on this device only, clearly labelled ("Simulated in this prototype") with a "What a real build needs" note. Never claim a message was sent or a calendar synced for real.
- Honesty rules stay: sample data is labelled, no fake reviews (his site has none), no invented prices presented as his (all prices are editable samples, labelled), no invented street address (his site has none: the address field is empty by default and the footer says "Serving Northern Ireland"), his real public phone 07885 496800 and email daniel@180electrical.co.uk are used.

## 1. New pages, routes and files (names are pinned)

Dashboard hash routes (all lazily loaded views under `js/dashboard/views/`, registered in `js/dashboard/routes.js` by role B3):
| Route | View file | Purpose |
|---|---|---|
| `#/pipeline` | `pipeline.js` | Sales pipeline: stages Enquiry, Survey, Quote, Accepted, Install, Done (+ Lost), counts, value, SLA flags. Reached from Bookings via a segmented control "List | Pipeline" (Bookings tab stays highlighted) |
| `#/quotes` | `quotes.js` | Quotes list with status filters, totals, "Waiting on customer" |
| `#/quotes/:id` | `quote-detail.js` | Quote builder and detail (`new` as id with `?booking=<id>` starts a draft) |
| `#/connections` | `connections.js` | Hub of connection cards with status dots |
| `#/connections/domain` | `connections-domain.js` | Custom domain wizard |
| `#/connections/webhook` | `connections-webhook.js` | Website funnel webhook and embed |
| `#/connections/tracking` | `connections-tracking.js` | Meta Pixel / Google tag, lead sources link |
| `#/connections/whatsapp` | `connections-whatsapp.js` | WhatsApp Business wizard |
| `#/connections/calendar` | `connections-calendar.js` | Google Calendar wizard |
| `#/connections/email` | `connections-email.js` | Gmail wizard |
| `#/share` | `share.js` | Share and promote: QR code, UTM link builder, printable QR card |
Existing views keep their routes. The More hub (`more.js`) gets rows for Pipeline, Quotes, Connections, Share and promote.

Customer-facing page: `quote.html` (+ `js/quote/*.js`, `css/quote.css`): `quote.html#q=<quoteId>` shows his quote to the customer on their phone (logo, customer name, charger, line items, total, notes, valid-until, "Accept quote" with an install-day picker from the real availability engine, "Not for me", "Ask a question" via WhatsApp link). Same origin, same localStorage store (so it works in the same browser as the dashboard, like the landing page). Marked "Prototype: sample quote".

## 2. Core model additions (role A3 implements in `js/core/*`; unit tests required)

A3 FIRST writes `docs/V3-API.md` (exact exports, signatures, return shapes) within about 15 minutes and then creates the ready file; everyone else codes against it. Style: follow the existing store API (`{ ok: true, ... }` / `{ ok: false, reason }`, frozen snapshots, `subscribe`, undo where it makes sense). Persisted-state migration: older saved state must not break (bump the schema version; migrate by adding the new fields with defaults).

### 2.1 Business and settings
- `business.address` (string, default '': his site gives none), `business.credentials`, `business.brands` (from v2).
- `settings.sla = { replyHours: 24 }`.
- `settings.marketing = { adSpend: [{ id, month: 'YYYY-MM', channel: 'facebook'|'instagram'|'google'|'other', amount }] }` (seed: last 3 months of Facebook and Instagram spend, plausible sample amounts).
- `settings.quoteItems`: editable catalogue of sample line items used by the quote builder: a charger line per brand in `business.brands` (label "Supply of {brand} home charger", unit price sample), "Standard installation (up to 10 m of cable)", "Extra cable (per metre)", "Dedicated circuit and protective device", "Consumer unit upgrade (if required)", "Surface-mounted enclosure", "Groundwork (per metre)", "Testing and certification". All sample prices, labelled "sample" in the UI.
- `settings.quoteDefaults = { validDays: 30, notes: <short sample terms text> }`.
- `settings.connections` (all SIMULATED):
  - `domain: { status: 'none'|'pending'|'verifying'|'live', domain: '', checks: 0, verifiedAt: null }`. Fictional targets only: CNAME target `sites.example`, A record `192.0.2.10` (documentation ranges and the `.example` TLD).
  - `whatsapp: { status: 'disconnected'|'verifying'|'connected', number: '+447885496800', displayName: '180 Electrical', templates: { <message kind>: 'approved'|'pending'|'none' }, ownerAlerts: true, customerUpdates: true, quietHours: { on: true, from: '21:00', to: '08:00' }, connectedAt: null }`. Demo verification code is shown on screen as a hint ("Prototype code: 482913").
  - `calendar: { status: 'disconnected'|'connected', account: '', calendarName: '180 Electrical jobs', twoWay: true, addJobs: true, connectedAt: null }`; when connected with twoWay on, the store imports a few SIMULATED busy blocks (labelled "Google Calendar") through the existing block mechanism so the Calendar shows them.
  - `email: { status: 'disconnected'|'connected', account: '', sendFrom: 'daniel@180electrical.co.uk', confirmations: true, quotes: true, connectedAt: null }`.
  - `webhook: { url: 'https://hooks.example/180/enq_<id>', secret: 'whsec_...', lastEventAt: null, enabled: true }` (fictional host).
  - `tracking: { metaPixelId: '', googleTagId: '', consentNote: true }`.
  Default for the demo: webhook enabled; everything else disconnected so the wizards can be demoed.
- Message channel: messages get `channel: 'whatsapp'|'email'` (default 'whatsapp').

### 2.2 Quotes
`state.quotes` keyed by id. Quote = `{ id: 'Q-EL-1043' (from the enquiry ref), bookingId, customerName, createdAt, status: 'draft'|'sent'|'viewed'|'accepted'|'declined'|'expired', brand, lines: [{ id, label, detail, qty, unitPrice }], notes, validUntil (day key), sentAt, sentVia, viewedAt, acceptedAt, declinedAt, declineReason, installBookingId }`. Whole-pound prices (as elsewhere). `quoteTotal(quote)` is a pure helper (export from `js/core/selectors.js`). Expiry is derived from `validUntil` vs the clock.
Store functions: `createQuote(input)`, `updateQuote(id, patch)` (draft or sent only), `deleteQuote(id)` (draft only), `sendQuote(id, { via })` (via 'whatsapp'|'email'|'link': logs a simulated `customer_quote_sent` message with the link `quote.html#q=<id>` and sets status 'sent'), `recordQuoteViewed(id)` (idempotent, 'sent' becomes 'viewed', logs nothing), `acceptQuote(id, { date, windowId })` (race-safe: creates a pencilled `ev` install booking (status 'pending', tentative true, quotedPrice = total, quoteId set), status 'accepted', logs `owner_quote_accepted` and `customer_quote_accepted`), `declineQuote(id, { reason })` (logs `owner_quote_declined`). New message kinds: `customer_quote_sent`, `customer_quote_accepted`, `owner_quote_accepted`, `owner_quote_declined`, `customer_photos_request` ("could you send a photo of your consumer unit and where you'd like the charger?"). Existing `customer_quote_ready` stays.

### 2.3 Pipeline, response time, lead sources, money (pure selectors in `js/core/selectors.js`)
- `PIPELINE_STAGES` (config): `enquiry`, `survey`, `quote`, `accepted`, `install`, `done`, plus `lost`. `selectPipeline(state)` returns `{ stages: [{ id, label, items: [{ bookingId, quoteId, customerName, postcode, value, ageMinutes, sla: 'ok'|'due_soon'|'overdue'|null, summary }], count, value }], lost: [...] }`. Rules per enquiry (an `ev_quote` booking): `enquiry` = status pending; `survey` = confirmed or on_the_way; `quote` = completed and (no quote or quote draft/sent/viewed); `accepted` = quote accepted and no install booking yet confirmed or completed; `install` = install booking pending, confirmed or on_the_way; `done` = install completed; `lost` = enquiry declined or cancelled, quote declined or expired.
- `selectSla(state)`: for pending enquiries, `dueAt = createdAt + settings.sla.replyHours`; returns `{ overdue, dueSoon (inside 4 hours), avgReplyMinutes, withinTargetPct }`; reply time = first transition out of pending (confirm, decline, reschedule) from the history.
- `selectLeadSources(state, range)`: enquiries grouped by `booking.utm.source` (`facebook`, `instagram`, `google`, `referral`, `phone`, `other`/direct) with counts, quotes, accepted, installs, revenue. `selectCostPerLead(state, range)`: from `settings.marketing.adSpend`: spend, cost per enquiry, per accepted quote, per install, and an honest blank when spend is zero.
- `selectQuoteStats(state, range)`: sent, accepted, win rate, average accepted value, waiting on customer value.
- `selectConnectionsSummary(state)`: per connection `{ key, status, label, detail }` for the hub.
- `createBooking` accepts `utm: { source, medium, campaign }` (validated, stored on the booking).

### 2.4 Simulation helpers (store)
`setConnection(key, patch)` (validated), `connectWhatsApp({ number, code })` (code must equal the demo code, else `{ ok:false, reason:'bad_code' }`), `submitWhatsAppTemplates()` (templates become `pending`, then `approved` after a simulated delay measured by the clock on the next read or after a short real timeout), `connectGoogle(service, { account })` for calendar and email, `disconnect(key)`, `startDomainSetup(domain)` (hostname validation), `checkDomain()` (1st check: "not found yet", 2nd or after 20 s: verified, SSL issued), `rotateWebhookSecret()`, `sendTestEvent(key)` (logs a simulated outbox entry and for 'webhook' creates a sample enquiry through the same path as the website funnel, with source `webhook`), `setAdSpend(month, channel, amount)`, `removeAdSpend(id)`. All undoable where it makes sense, all labelled simulated in the outbox.

### 2.5 Seed (v3)
About 26 bookings across the past 8 weeks and the next 2: mostly `ev_quote` and `ev` with answers; lead sources about 55% Facebook, 15% Instagram, 12% Google, 10% referral, 8% phone; a full pipeline (2 new enquiries needing a reply, one overdue against the 24 h promise, 3 surveys booked, 2 quotes to write, 3 quotes out (one viewed), 2 accepted waiting for an install day, 3 installs booked, 6 done (4 paid, 2 owed), 3 lost); ad spend for the last 3 months; a handful of quotes in every status; sample message log. Customers are Northern Ireland names with BT addresses (made-up streets); customers use Ofcom drama numbers 07700 900xxx. The business phone and email are his real public ones.

## 3. Shared UI additions (role B3 in `js/ui/*`, `css/components.css`, `css/tokens.css`; documented in `docs/V3-UI.md` first)

Components (export from `js/ui/index.js`): `Wizard` (stepper with progress, Back/Next, validation callbacks, focus management), `CopyField` (read-only value with copy button and "Copied" feedback, reveal for secrets), `CodeBlock`, `StatusDot` and `ConnectionBadge` (connected, pending, error, not set up), `Tabs`, `Timeline`, `Meter` / `ProgressRing`, `QrCode` (vendored tiny generator at `js/vendor/qrcode.js`: use the MIT `qrcode-generator` package from npm, copied in; renders to SVG; no network), `MoneyInput`, `ConsentSheet` (a fake OAuth consent screen: provider mark, scopes list, Allow/Cancel; clearly labelled "Simulated"), `SimBanner` ("Simulated in this prototype. Nothing is really connected. Saved on this device only."), `DataTable`-style responsive list rows. Also: refined elevation, focus rings, motion tokens (durations/easings), skeleton shimmer, subtle page transitions in the dashboard shell (respect reduced motion), and the routes table with stubs for every route in section 1 (so every route loads even before its view exists).

## 4. Work packages and ownership (disjoint files)

| Role | Owns |
|---|---|
| A3 core | `js/core/*`, `tests/unit/*`, `docs/V3-API.md` |
| B3 shell and UI kit | `js/ui/*`, `js/vendor/qrcode.js`, `css/tokens.css`, `base.css`, `components.css`, `dashboard.css`, `fonts/*`, `js/dashboard/shell.js`, `routes.js`, `router.js`, `app.js`, `watcher.js`, `img/*` brand assets, `docs/V3-UI.md` |
| K1 connections hub, domain, webhook, tracking | `views/connections.js`, `connections-domain.js`, `connections-webhook.js`, `connections-tracking.js`, `css/connections.css` |
| K2 WhatsApp, Calendar, Gmail wizards | `views/connections-whatsapp.js`, `connections-calendar.js`, `connections-email.js`, `css/connections-wizards.css` |
| Q1 quotes (owner) | `views/quotes.js`, `views/quote-detail.js`, `css/quotes.css` |
| Q2 customer quote page | `quote.html`, `js/quote/*`, `css/quote.css` |
| P1 pipeline and insights | `views/pipeline.js`, `views/insights.js`, `css/pipeline.css`, `css/insights.css` |
| E3 dashboard core screens | `views/today.js`, `bookings.js`, `booking-detail.js`, `customers.js`, `calendar.js`, `messages.js`, `more.js`, `settings.js`, `share.js`, `about.js`, `demo.js`, `new.js`, `js/dashboard/shared/*`, `css/today.css`, `bookings.css`, `calendar.css`, `settings.css`, `share.css` |
| L3 landing | `js/landing/*`, `css/landing.css`, `index.html` body is #app only (the head is B3's) |
| D3 funnel | `js/booking/*`, `css/booking.css` |
| QA roles | `tests/e2e/*`, `tests/qa/*` only (fix bugs by messaging the owner role's file only when the owner role is finished: see the run instructions) |
(All views live in `js/dashboard/views/`.)

## 5. Landing page requirements (L3, D3)
Everything from v2, plus: (1) a running-costs calculator, "What would home charging cost you?" (annual miles, a few editable assumptions shown openly: pence per kWh at home vs public charging vs petrol price and mpg, EV efficiency; result is an illustrative estimate with the formula visible, never a promise; no claims about grants or tariffs; it is a tagged idea, "Idea from us, not on your site today", hidden by "Only my content"); (2) capture `utm_source`, `utm_medium`, `utm_campaign` from the URL (also `?src=` as an alias) into sessionStorage and pass them to the funnel submit; (3) scroll-reveal polish and a sticky header that condenses; (4) hero with his real charger photo treated with a dark red-tinted gradient; (5) tasteful micro-interactions on the CTA and option cards; (6) image `width`/`height`/`loading`/`decoding` set, fonts preloaded, no layout shift; (7) skip link, visible focus, semantic landmarks; (8) the whole page under 350 KB of HTML+CSS+JS and under 900 KB of images on first view; (9) structured, accessible FAQ accordion; (10) WhatsApp and Call buttons use the real number.

## 6. Quality gates (QA roles)
Viewports 320, 375, 390, 430, 768, 1024, 1440, dark and light. Zero horizontal overflow; every tap target >= 44 px; zero console errors/warnings; zero off-site requests; axe-core zero serious/critical in both themes on: landing, funnel steps, confirmation, quote.html, every dashboard route; contrast AA; keyboard operable with visible focus and focus trapping in sheets; reduced motion honoured; works with localStorage unavailable (memory fallback); two tabs stay in sync; no data loss on reload; old saved state migrates. End-to-end flows: funnel submit to dashboard enquiry with answers and pencilled survey; confirm; survey done; build quote; send via WhatsApp link; open quote.html; accept with install day; install booking appears; complete and paid; Insights and Pipeline numbers move; each connection wizard end to end and disconnect; domain check sequence; webhook test event creates an enquiry; rebranding in Settings updates the landing page; Reset demo; UTM link produces a lead-source row.

Performance (the PERF gate, `tests/qa/perf.mjs`, `npm run perf`): the landing page, the quote page and the dashboard Today view are loaded cold on a throttled mid-range phone (Chromium 4x CPU, 1.6 Mbps and 150 ms, a 412 px phone at 2.625 DPR, gzip over HTTP/2, his two photo hosts answered by JPEG stand-ins of realistic size) and must stay inside the budgets at the top of that file: first-view requests and bytes, JS and CSS gzip size, modules fetched and import depth, first and largest contentful paint (target 2.5 s; the landing page's gap and why are noted there), no long task over 200 ms, layout shift under 0.05 (on load, while scrolling the whole landing page, and while fonts arrive late), every scroll, wheel and touch listener passive, nothing re-rendered or written to storage while a dashboard screen sits idle, and one store change redoing only a handful of components. The first-load graphs import from the specific `js/ui/*.js` file, never from the barrel, and `scripts/modulepreload.mjs` keeps each page's `modulepreload` block equal to its static import graph (`tests/unit/modulepreload.test.mjs`).
