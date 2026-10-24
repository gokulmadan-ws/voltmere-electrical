# BUILD CONTRACT: Voltmere Electrical booking platform (prototype)

> Status: FROZEN. Version 1.1 (integration-risk critic pass applied; the change log is the last section), written 2026-10-23 (a Friday) by the lead architect.
> Audience: about 8 coding agents (LLMs) working IN PARALLEL on disjoint files who cannot talk to each other. This file is the single source of truth.
> Location: `/home/user/LG-Proto1/electrician/docs/BUILD-CONTRACT.md`. Owned by WP0. **No agent may edit this file.**

## 0. How to read and obey this contract

1. Read the whole file once, then read your own work package (section 6.3) and every section it points at. Everything an agent needs is here. Nothing is "TBD". If a detail is missing, choose the simplest option that keeps every name in this contract intact, put a one-line `// CONTRACT-GAP:` comment where you chose, and move on. Never ask, never wait.
2. **Names are law.** Every function, export, CSS class, CSS custom property, `data-testid`, route, storage key, template kind and message placeholder is defined ONCE in this file. Use the exact spelling. Do not rename, alias, add a second spelling, or "improve" a name. If you need a new name inside your own files, give it your package prefix (section 12.1) so it cannot collide.
3. **Only touch files you own** (ownership table, section 6.2). Never edit another package's file, even to fix a typo. If you find a bug in another package's file, leave a `// CROSS-PKG:` comment in YOUR file describing it and carry on. WP0 reconciles drift after merge.
4. **Never touch anything outside `/home/user/LG-Proto1/electrician/`.** The repo root holds an unrelated project (Kontor, council finance, Springboard design system). Do not read its CSS, do not reuse its components, do not restyle it. The Springboard / Kontor design system is NOT used here.
5. **No build step, no bundler, no npm runtime dependencies.** Plain HTML + CSS + ES modules in the browser. Preact + htm is vendored at `js/vendor/preact-htm.js` (never modify it).
6. **All URLs are relative.** The site is served from the sub-path `/LG-Proto1/electrician/` on GitHub Pages and from a domain root on Vercel. Never write a root-absolute URL (`/css/...`). Never hard-code a host name. In CSS, `url()` is relative to the CSS FILE (`url('../img/hero-wiring.svg')` from `css/`), in HTML to the page, and in JS `import` / `import()` to the importing module.
7. **No runtime network dependencies.** No CDN, no web fonts from Google, no remote images, no analytics, no `fetch()` of anything off the site. Allowed external LINKS (anchors the user taps, never fetched) are only: `tel:`, `sms:`, `mailto:`, `https://wa.me/<digits>?text=...`, `https://www.google.com/maps/search/?api=1&query=...`.
8. **No `dangerouslySetInnerHTML`, no `innerHTML`, no `document.write`, no `eval`** anywhere. Icons are rendered from data arrays through `h()` (section 4.8). User-entered text is rendered through htm (which escapes). Always `encodeURIComponent` inside wa.me, maps and mailto links.
9. **Everything simulated says so.** Anything that WhatsApp/SMS/email/payment/reminders would really do is simulated and labelled "simulated" in the UI (section 3.7).
10. **Never use `new Date()` with no args, `Date.now()`, or `performance.timeOrigin` outside `js/core/clock.js`.** Use `now()` from the clock module. Never step days with `+ 86400000`; use `addDays()` (the UK clocks go back on Sunday 25 October 2026, two days after this contract was written). Section 7.6.
11. Every example date in this file ("Sat 24 Oct", "Mon 26 Oct", "VM-1043") is an EXAMPLE for a clock of Fri 23 Oct 2026. Never paste a literal date or weekday into UI copy or code. Compute it.
12. Write small, readable ES modules. 2-space indent, single quotes, semicolons, `const` by default. Comment the WHY, not the what. Every file starts with a 2-line header comment: `// <path>: <one-line purpose>` and `// Owner: WPn`.
13. Prototype tone: polish beats breadth. If something is in the WON'T list (section 2), do not build it, however tempting.
14. Read **6.1.1 (Preact + htm gotchas, each one verified in Chromium against the vendored file) before writing a single template.** Two of them (`spellcheck="false"` and calling `render()` twice on one container) silently break the page.
15. **Every store mutation can fail** (reasons in 8.3). Never assume `ok: true`; use the generic failure rule in 8.3 for any reason your screen does not handle specially.

### 0.1 Glossary

| Term | Meaning |
|---|---|
| Window | One of four fixed two-hour arrival windows in a day (section 9.1). The customer is told "arrive between 8 and 10am". There are no 30-minute slots. |
| Half-day job | A service with `blocks: 2` (EICR, new fuse box, EV charger). It occupies two consecutive windows: morning (windows 0+1) or afternoon (windows 2+3). |
| Day key | `'YYYY-MM-DD'` local date string. |
| Stamp | `'YYYY-MM-DDTHH:mm'` local, timezone-free date-time string. Compares correctly as a plain string. |
| Owner / Dan | The electrician using the dashboard. First name comes from settings (`business.ownerFirstName`). |
| Customer | The homeowner or landlord using the landing page. |
| Outbox | The log of simulated WhatsApp messages (state.messages) shown on the Messages screen. |
| Sample | Fictional content that is labelled as such (reviews, registration, insurance, customers). |
| Immersive route | A dashboard route that hides the mobile tab bar (booking detail, new booking, customer detail). |

---

## 1. Product summary and the 3-minute demo script

### 1.1 Product summary

**Voltmere Electrical** is a white-label booking platform for a one-van UK electrician (fictional owner "Dan Mercer"). Two static pages share one browser store:

- `index.html`: the **customer landing page**. A homeowner or landlord sees Dan's real next free arrival window on the first screen, sees prices before any form field, and books in under 60 seconds with four fields (name, mobile, postcode, house number and street). No account, no payment. Normal bookings confirm instantly.
- `dashboard.html`: the **owner dashboard**. Today (what needs me, what is next), Calendar (the diary IS the availability customers see), Bookings (inbox, search, detail with one state-driven action button), Insights (owed and collected), Messages (the simulated WhatsApp outbox), and a Settings area that rebrands the whole site live.

Why this beats the WhatsApp ping the friend already pays an agency for: the ping is only the front door. The same shared diary stops double-bookings, shows customers truthful availability, sends the confirmation, reminder, on-my-way and review messages Dan would otherwise type by hand, turns every booking into a one-tap job card, tracks who owes him money, and keeps a customer list he owns.

**Honesty limit, said out loud in the demo:** all data lives in one browser's `localStorage`. A booking made on the customer's phone does NOT reach Dan's phone. The demo works across two tabs of one browser. Every WhatsApp/SMS/email/payment/reminder is simulated and labelled. The three things that are not real are exactly what a platform is paid for: a shared database, the WhatsApp Business connection, and a login (section 17).

### 1.2 The 3-minute demo script (SE on one phone, light mode, two browser tabs)

Tab B = the customer landing page (`index.html`). Tab A = the owner dashboard (`dashboard.html`). Cross-page links use named tabs (`vm-site`, `vm-dashboard`, 16.1) so tapping a link switches to the other tab instead of opening a third.

**Prep (before, not counted; 60 seconds).**

| # | Do | Why |
|---|---|---|
| P1 | On the phone, in a normal browser tab (NOT an installed home-screen app: iOS gives installed apps separate storage, which breaks the shared store) open `index.html`. Scroll to the footer and tap `Owner login (demo)`. | Opens the dashboard as tab A; both tabs now share one `localStorage`. |
| P2 | In tab A open `#/demo`. Under "Try on your phone" type your own mobile number and tap Save. | Makes every "Open in WhatsApp" link open YOUR WhatsApp (the sample numbers are fictional and cannot receive messages). |
| P3 | Optional but powerful: open `#/settings` and change Business name, Short name, Owner first name and Phone to the friend's real details. | The whole site becomes "that is my business" in 20 seconds. |
| P4 | Back in `#/demo` tap "Reset diary and messages" and confirm. | Fresh, deterministic diary relative to today. |
| P5 | Switch to the landing tab (B). | Start position. |

**The script.**

| Time | Tab | Tap / do | What the friend sees | Say |
|---|---|---|---|---|
| 0:00 | B | Look at the first screen. Point at the pulsing green dot and "Next free repair visits" with its three chips (the first reads "Tomorrow, 8-10am"), at the four tiles with "From" prices, and at the sticky Call / WhatsApp / Book bar. | His business name, real prices, live availability. | "This is your website. Not a contact form: it reads your real diary. Name, prices, phone are yours." |
| 0:20 | B | Tap the tile "Landlord safety report". | Booking sheet opens on "When suits you?" with EICR property size (House, 2-3 bed preselected) and a "Soonest" card for the half-day job. | "A landlord wants an EICR. It only offers the mornings and afternoons you can really do." |
| 0:30 | B | Tap "Pick this", then "Continue". Tap the small dashed "Demo: fill sample details". Tap "Confirm booking". | Details step (four fields), then the confirmation: six breaker switches, the third flips ON; "You're booked in, Priya."; ref `VM-1043`; the "what happens next" timeline; a dashed DEMO panel with the exact WhatsApp bubble Dan "received". | "Four fields, no account, no card. Under a minute. That bubble is the ping you pay the agency for." |
| 1:00 | B to A | Tap "Open Dan's dashboard" in the DEMO panel. | Dashboard tab opens on the booking detail: "Repeat customer, 2nd booking", Call / WhatsApp / Maps, one big action button "On my way". A toast says "New booking: Priya" and the Messages icon in the header shows a badge. | "It lands as a job card, not a message you scroll past. Priya has booked before, so it knows." |
| 1:15 | A | Tap the header Messages icon. Show the Compare card, then the new owner alert. Scroll to the older emergency alert "No power in kitchen" and tap its button "Accept (45 min)". | A new green customer bubble appears at the top: "I'm on my way ... about 45 minutes away". Tap "Open in WhatsApp" under it: the SE's own WhatsApp opens with the text ready. | "Your ping lets you read. This one lets you act: one tap inside the message and the customer is told. That is the part you type by hand today." |
| 1:50 | A | Tap the Calendar tab. Select the first open day (the one the website calls "Tomorrow"). Tap its free "8-10am" row, then "Block this time", pick "Dentist", tap Block. | The row turns hatched "Blocked: Dentist". | "Now watch the website." |
| 2:05 | A to B | Tap the header "View customer site" icon. | The first chip has moved on to the next free window; open the booking sheet and tomorrow's 8-10am window reads "Booked". | "The diary you edit IS the availability customers see. No double-booking, no 'sorry, I forgot'." |
| 2:20 | B | Tap the Dark option in the footer (or the moon icon in the dashboard header). | The page flips to dark mode with the same layout and contrast. | "That is the van at 9pm. Flip back for bright sun." |
| 2:35 | B to A | Tap "What's real in this prototype" in the footer. | The honest table: works for real / simulated / what a real build needs. | "Everything you tapped is real UI and logic running on this phone. Not real: a shared database, the WhatsApp connection, a login. That is the quote." |
| 3:00 | | End. | | |

**Extended demo (+2 minutes, if asked "what about on the day?").** Today tab: the "Next up" card shows Navigate / Call / WhatsApp tiles and ONE big button. Tap "On my way", choose 30 min: the customer message is logged. Tap "Mark done", choose Cash, tap "Complete job". Insights: "Collected this month" went up. Tap "Take next week off" on Today: Calendar shows the week closed and the landing page skips it.

**Fallbacks.** If switching tabs is awkward: `#/demo` has "Add a sample website booking" (Standard / Needs your OK / Emergency): it runs the same code path as the website form, and the toast, badge and outbox update the same way. If the diary looks wrong: Reset diary and messages. Two physical devices will NOT sync (no server): say so.

---

## 2. Scope: MUST / SHOULD / WON'T

Priority key: **MUST** = prototype fails without it, build first. **SHOULD** = build if MUST is done and polished. **WON'T** = explicitly out. An agent that builds a WON'T item wastes time and creates merge risk.

### 2.1 MUST

| ID | Item | Pkg |
|---|---|---|
| M1 | One store persisted to localStorage (try/catch everything, memory fallback), shared by both pages, live across tabs via the `storage` event plus `visibilitychange`/`pageshow`/`focus` re-read | WP1 |
| M2 | Availability engine: four fixed two-hour windows, half-day jobs, lead time, horizon, days off, blocks, "Full today", cancelled frees slot, race-safe `createBooking` | WP1 |
| M3 | Seeded diary relative to today (15 bookings in four of the five statuses (`on_the_way` is reached by using the app), 1 emergency, repeat landlord, owed job) and `resetDemo()`, `simulateIncomingBooking()` | WP1 |
| M4 | Simulated WhatsApp outbox: every template in section 10, `waLink()` with demo-phone override, scheduled reminders derived from `sendAt` | WP1 + WP8 |
| M5 | Tokens (light and dark), base CSS, UI kit (section 12), icons, theme toggle with persistence, PrototypeNotice | WP2 |
| M6 | Dashboard shell: sticky header, bottom tab bar (below 1100), sidebar (1100+), hash router with lazy view loading, FAB, unseen-booking toast/badge/title | WP2 |
| M7 | Landing page: all 12 sections + sticky mobile action bar (section 13.1), live availability, prices from store, rebrand from settings | WP3 |
| M8 | Booking flow: service pick, When (EICR size, Soonest, 14-day picker, windows), Details (4 fields), confirmation (breaker animation, ticket, timeline, .ics, DEMO panel), emergency path, slot-taken recovery, Manage (live status, cancel) | WP3 |
| M9 | Today: Needs you (emergency + approval), Next up with state-driven primary button, "Taking bookings today" switch, take days off, timeline, tomorrow, share link | WP4 |
| M10 | Booking detail with sticky state-driven action bar, shared job sheets (ETA, complete, paid, cancel, reschedule) with Undo toast; Bookings inbox with search and filters | WP5 |
| M11 | Calendar: week strip, window rows, block / unblock / take day off, add booking from a free window | WP6 |
| M12 | New booking (owner) reusing the booking flow in owner mode | WP6 |
| M13 | Messages outbox screen (banner, Compare card, filters, live bubble buttons, Open in WhatsApp, Copy, Send now) | WP8 |
| M14 | Settings (business, services and prices, hours, rules, theme), Demo tools (demo phone, simulate, reset), More hub | WP8 |
| M15 | Insights (collected, owed, nudge, mark paid), Customers (derived list and detail), About "What's real" | WP7 |
| M16 | Mobile quality gates (section 15): 320-1440 no overflow, 44px targets, axe zero serious/critical in light and dark, contrast AA, zero console errors, zero external requests | all |
| M17 | Unit tests for the data layer (section 8.9) and the e2e flows (section 14.3) | WP1, WP0 |

### 2.2 SHOULD

| ID | Item | Pkg |
|---|---|---|
| S1 | Six-breaker confirmation animation (static final state under reduced motion) | WP3 |
| S2 | Hero "wiring grid" background and pale bolt (local SVG) | WP3 |
| S3 | Insights: six-week "Collected per week" bars and "By service" list | WP7 |
| S4 | Customers: Landlord and Repeat tags, Rebook shortcut | WP7 |
| S5 | Dashboard master-detail at 1100px (Bookings list + detail) and week grid at 768px+ in Calendar | WP5, WP6 |
| S6 | Quick messages on booking detail (Running late, Need access, Quote ready) | WP5 |
| S7 | Template preview sheet on Messages (read-only) | WP8 |
| S8 | Static pre-rendered header/H1/call button inside `#app` of `index.html` for first paint | WP3 |
| S9 | Compare card on Messages ("A typical ping" vs this alert) | WP8 |
| S10 | Customers list and detail side by side at 1100px (below 1100 the detail is its own immersive screen, which is MUST) | WP7 |

### 2.3 WON'T (explicit; do not build, do not stub)

| Item | Reason |
|---|---|
| Real WhatsApp Business API, SMS, email sending; inbound replies; two-way inbox | Needs a backend and Meta verification. The labelled outbox plus real `wa.me` deep links is the honest stand-in. |
| Online payments, deposits, card on file, payment links | "Pay after the job" is a conversion feature. |
| Quotes, invoices, certificate generation (EICR, EIC), PDFs, VAT, accounting export, CSV export (a disabled "Export CSV (full version)" line on Insights is allowed text only) | Out of scope. |
| Photo upload of the fault or consumer unit | Needs storage and a backend. |
| Customer accounts, logins, owner authentication, multi-user, staff, roles | A login is on the "real build" list. |
| Service worker, offline mode, push notifications, install-as-app (a manifest with `display: "browser"` exists only for metadata; see 16.4) | iOS gives installed apps separate storage and would break landing-to-dashboard sync. |
| Sound, vibration, chimes | iOS has no `navigator.vibrate`; audio needs a gesture. The banner, badge, highlight and tab title carry the moment. |
| Accent-colour theming and brand-colour pickers | Contrast risk across swatches. Re-skin by editing `css/tokens.css`. Name, owner, phone, tagline and prices ARE live-editable. |
| Pinned or "demo" clock. The real clock is used. A `?now=` URL override exists for tests and screenshots only. | Countdowns must not lie. |
| 30-minute start-time grids, travel buffers, proportional-height calendar cards, drag-and-drop, swipe or long-press gestures | Arrival windows are how UK trades work; gestures fail with gloves. |
| Funnel analytics ("Booking page this week"), any `track()` plumbing, scarcity lines ("only 2 left"), review sub-rating bars, "DBS checked" and "Member since" chips, animated van tracker | Fake precision and scope. |
| Editable message templates (read-only preview only), accent swatches, "Add a service" form, large-text mode, Glove mode, date-range time-off form (quick buttons and single-date add only), Decline reason chips, Duplicate job, service-area chip editing | Scope. |
| Real postcode lookup, address autocomplete, embedded maps, route optimisation, live GPS | Needs APIs and keys. |
| Recurring jobs, landlord portfolios, EICR renewal reminders, multi-language, blog, SEO pages, cookie banner (no cookies, no tracking) | Roadmap pitch, not prototype. |
| Time arithmetic by milliseconds, `Intl.DateTimeFormat` for the "Sat 24 Oct" format (hand-written arrays are used) | Determinism across Node and browsers. |
| Native `<dialog>` for sheets | Top-layer breaks toasts. Sheets are `div role="dialog"`. |
| Customer self-service reschedule on the Manage page (`manage-change`, `manage-save-time`). The store function `rescheduleBooking(..., 'customer')` and its unit tests stay; there is no UI | WP3 is the critical path and the demo never needs it. The Manage page offers status, cancel, and call/WhatsApp. |
| Left icon rail at 768 to 1099 (testid `rail`, `--rail-w`) | One navigation layout fewer to build and test. Tablets use the bottom tab bar up to 1099, the sidebar from 1100. |
| Sticky day headings in the Bookings list | Nested sticky offsets break on short phones. Plain headings. |

---

## 3. Brand and sample-data rules

### 3.1 Identity (ONE choice, no alternatives)

| Field | Value |
|---|---|
| Business name | `Voltmere Electrical` |
| Short name (wordmark) | `Voltmere` |
| Descriptor (tiny tracked caps under wordmark) | `Electrical` |
| Owner | `Dan Mercer`; first name `Dan`. One-man firm with an apprentice, "Sam". |
| Tagline | `Local electrician. Booked in 60 seconds.` |
| Phone (display) | `07700 900412` ; tel href `tel:+447700900412` ; wa.me digits `447700900412` |
| Email | `dan@voltmere.example` (reserved `.example` TLD) |
| Home town | `Marlbury` (fictional) |
| Area text | `Marlbury and 15 miles around` |
| Towns (fictional) | Marlbury, Thornley Green, Hollin Cross, Wexby, Ashgrove |
| Covered outward codes | `MB1` to `MB10` (the postcode area "MB" does not exist) |
| Edge outward codes | `MB11`, `MB12`, `MB13` |
| Hours text | derived by `describeHours()` (section 9.9); default renders `Mon to Fri 8am to 5pm, Sat 8am to 12pm` |
| Emergency hours | `7am to 10pm, 7 days` (static text in `PROMISES.emergencyHoursText`) |
| Scheme line | `Competent person scheme, reg. no. 000000 (sample)` |
| Insurance line | `£2m public liability cover (sample)` |
| Rating | `4.9 out of 5 from 212 reviews (sample)` |
| Do NOT use | NICEIC, NAPIT, Checkatrade, TrustMark, any real scheme logo or name, any real firm, any real street+postcode pair |

All brandable strings live in `js/core/config.js` (defaults) and `state.settings.business` (live). The SE can re-skin in the dashboard (Settings > Business and brand) or in one file edit.

### 3.2 Fictional contact data rules

- Every phone number is in Ofcom's drama range `07700 900000` to `07700 900999`. Seed customers use `07700 900200` to `07700 900399`; the simulator pool uses `07700 900500` to `07700 900599`; the business is `07700 900412`.
- Display format is always `07700 900231` (5 digits, space, 6 digits).
- Emails use the `.example` TLD or are left blank.
- Street names are invented (list in 3.4). Outward codes `MB1` to `MB13` with made-up inward codes. No real address.
- Because fictional numbers cannot receive WhatsApp and fictional streets do not exist on Google Maps, the demo phone override (section 10.5) and a note in Demo tools explain this.

### 3.3 Promise values (all in `config.js`, never inline in copy)

```js
export const PROMISES = {
  arrivalWindowHours: 2,        // "a two-hour arrival window"
  awayMinutes: 30,              // "a message when I am 30 minutes away"
  freeChangeHours: 24,          // "free to change or cancel up to 24 hours before"
  reminderHour: 18,             // reminder at 18:00 the evening before
  reviewDelayMinutes: 60,       // review request goes 60 minutes after "done"
  emergencyReplyMinutes: 10,    // "aims to reply within 10 minutes"
  emergencyCallAfterMinutes: 15,// "if you have not heard in 15 minutes, call"
  emergencyArrivalHours: 2,     // "aims to be with you within 2 hours"
  emergencyHoursText: '7am to 10pm, 7 days',
  extraHourRate: 55,            // GBP per hour after the first hour (fault, sockets)
  emergencyFrom: 95,            // GBP, includes the first hour
  powerCutNumber: '105'         // real UK power cut line, used in the emergencies-off copy
};
```

Copy that mentions a promise MUST interpolate these values. Exception: `emergencyFrom` and `extraHourRate` only seed the DEFAULT `price` and `priceNote` of the `emergency`, `fault` and `sockets` services in `makeDefaultSettings()`; screens always read the live service price (so a price edited in Settings shows everywhere).

### 3.4 Seed data concept (about 15 bookings)

Generated relative to the real clock by `buildSeed(now, settings)` (section 8.7) on first load, on `resetDemo()`, and whenever `state.seededFor !== todayKey()`. Fixed refs `VM-1028` to `VM-1042`; the next booking made is `VM-1043`.

**Day references.** `T` = today. `P(k)` = the k-th previous OPEN day before today (open = Mon to Sat). `O(k)` = the k-th next open day after today. Sundays are skipped, so weekdays stay aligned and the diary never has a Sunday booking (except `T` itself if today is a Sunday).

**Customers (all fictional).**

| Key | Name | Phone | Address | Notes |
|---|---|---|---|---|
| priya | Priya Nair | 07700 900231 | 14 Alder Row, MB3 4QP | The autofill "sample customer" for the demo. One past job so her demo booking is "2nd booking". |
| marcus | Marcus Tate | 07700 900262 | 8 Quarry Lane, MB5 2LN and 31 Hollin Road, MB6 7DZ | Landlord, two EICRs at two addresses. |
| alison | Alison Reeve | 07700 900275 | 22 Fennel Road, MB8 1HT | |
| tom | Tom Hargreaves | 07700 900288 | 3 Weavers Yard, MB2 9AQ | |
| eileen | Eileen Doyle | 07700 900301 | 17 Kiln Lane, MB4 3RF | |
| ngozi | Ngozi Okafor | 07700 900344 | 9 Orchard Close, MB2 6JN | Emergency. |
| hannah | Hannah Whitfield | 07700 900356 | 2 Linnet Close, MB1 8PY | |
| kwame | Kwame Mensah | 07700 900371 | 12 Cobb Street, MB9 3UE | |
| ruth | Ruth Calder | 07700 900388 | 6 Harrow Mews, MB10 4XJ | |
| sam | Sam Wray | 07700 900219 | Mill Cottage, Ashgrove Lane, MB12 6AB | In the EDGE zone, so needs Dan's OK. |
| lena | Lena Kowalski | 07700 900399 | 27 Alder Row, MB3 5TT | Cancelled booking. |

**The 15 seeded bookings** (`S01` to `S15`; `seed: true`). Window preference is a preference: placement falls back per 8.7.2.

| ID | Ref | Day ref | Window | Service (variant) | Customer | Status | Quoted | Final | Paid | Source |
|---|---|---|---|---|---|---|---|---|---|---|
| S01 | VM-1028 | P17 | 0 | fault | priya | done | 75 | 75 | card | website |
| S02 | VM-1029 | P14 | 2-3 | eicr (flat) | marcus @ 8 Quarry Lane | done | 150 | 150 | bank | phone |
| S03 | VM-1030 | P11 | 0-1 | consumer | alison | done | 540 | 540 | card | website |
| S04 | VM-1031 | P6 | 1 | sockets | ruth | done | 85 | 170 | NOT paid (owed) | whatsapp |
| S05 | VM-1032 | T | 0 | sockets | tom | done if the window has ended else confirmed; paid cash 85 when done | 85 | 85 | cash | website |
| S06 | VM-1033 | T | 1 | fault | eileen | done if the window has ended else confirmed; NOT paid when done | 75 | 75 | none | phone |
| S07 | VM-1034 | T | none | emergency (urgent, "No power in kitchen") | ngozi | new, `urgent`, created 12 minutes before seeding, `seenByOwner: false` | 95 | | | website |
| S08 | VM-1035 | O1 | 1 | fault | hannah | confirmed | 75 | | | website |
| S09 | VM-1036 | O2 | 2-3 | eicr (house) | marcus @ 31 Hollin Road | confirmed | 195 | | | phone |
| S10 | VM-1037 | O3 | 0 | fault | alison | confirmed | 75 | | | website |
| S11 | VM-1038 | O3 | 1 | sockets | sam | new (edge zone), `seenByOwner: false` | 85 | | | website |
| S12 | VM-1039 | O3 | 2 | fault | ruth | confirmed | 75 | | | whatsapp |
| S13 | VM-1040 | O3 | 3 | sockets | tom | confirmed | 85 | | | website |
| S14 | VM-1041 | O5 | 0 | sockets | kwame | confirmed | 85 | | | referral |
| S15 | VM-1042 | O6 | 1 | fault | lena | cancelled by customer ("Customer asked") | 75 | | | website |

Plus **blocks**: all four windows of `O4` labelled `Van MOT` (`seed: true`, one `groupId`).

**Diary shape this creates** (the story the demo relies on), verified for Fri 23 Oct 2026 (`O1` Sat 24, `O2` Mon 26, `O3` Tue 27, `O4` Wed 28, `O5` Thu 29, `O6` Fri 30):

| Day | State | Dot |
|---|---|---|
| Sat 24 Oct | window 0 free, window 1 booked (Hannah) | amber (1 free) |
| Sun 25 Oct | closed | grey, "Closed" |
| Mon 26 Oct | EICR booked in the afternoon (windows 2+3); windows 0 and 1 free | green |
| Tue 27 Oct | all four windows booked | grey, "Full" |
| Wed 28 Oct | blocked "Van MOT" | grey |
| Thu 29 Oct | window 0 booked (Kwame), 1-3 free | green |
| Fri 30 Oct | the cancelled booking at window 1 does NOT occupy it; all free | green |

Consequences: `nextFreeSlot(state,'fault')` = Sat 24 Oct window 0 ("Tomorrow, 8-10am"); `nextFreeSlot(state,'eicr')` = Mon 26 Oct morning (Sat morning needs windows 0+1 and window 1 is booked).

**Messages seeded** for every seeded booking that is not in the past (`start` date >= today) and not cancelled: the owner alert at `createdAt`; the customer confirmation one minute later when status is confirmed; the scheduled reminder when `remindersOn` and the booking is `confirmed` and `reminderSendAt` is not null. Today's `done` jobs also get a `customer_completed` message. Seeded messages carry `seed: true`.

**Seed message ids and order (so tests and e2e can name them).** Ids are `msg_seed_<NN>_<role>` where `NN` is the booking number `01` to `15` and `role` is `alert` (the owner alert), `conf` (the customer confirmation or received message), `rem` (the scheduled reminder) or `done` (`customer_completed`). The emergency alert is therefore `msg_seed_07_alert`. Seed messages get `seq` numbers in ascending `at` order and are never counted as unread (8.6).

**createdAt for seeded bookings:** bookings whose start day is today or earlier: start day minus 2 days at 09:00; bookings on later days: `min(now - 5 min, start day minus 3 days at 09:00)`; S07: `now - 12 minutes`; S11: `now - 40 minutes`. Every seeded booking has `seenByOwner: true` except S07 and S11; `reviewRequested` is true for S01 to S04 and false for every other booking.

**Fixture totals at clock `?now=2026-10-23T20:30&freeze=1`** (used by tests; everything must match):

| Metric | Value |
|---|---|
| `bookings.length` | 15 |
| Needs you (`status === 'new'`) | 2 (S07 emergency first, then S11) |
| Owed (done, unpaid) | 2 jobs: S04 £170 + S06 £75 = £245 |
| Collected this month (paid, `paidAt` in October 2026) | £850 (75 + 150 + 540 + 85) |
| Booked next 14 days (non-urgent, status new/confirmed/on_the_way, date from today to today+13) | £675 across 7 bookings |
| Average finished job, last 30 days | £183 (sum 1095 over 6 jobs, rounded) |
| Customers (derived) | 11 |
| `getDayLoad` for Sat 24 / Sun 25 / Mon 26 / Tue 27 / Wed 28 | few / closed / good / full / full (blocked windows are not free) |

### 3.5 Sample reviews (labelled as sample, copy exact; WP3 `js/landing/content.js`)

Three stacked cards under the heading "What customers say" and a visible chip `SAMPLE REVIEWS, not real customers`. Summary line: `4.9 out of 5 from 212 reviews (sample)`. Each card carries the tag `Sample review · <town>` (no date: rule 11 forbids pasted dates) and a job type. No "Verified" wording anywhere.

1. "Fuse box kept tripping every evening. Dan found a faulty immersion heater in 40 minutes and quoted before he touched anything." (Priya N., Thornley Green, Fault finding)
2. "Needed an EICR for two flats with a tenant moving in Friday. Booked at 9pm, done Wednesday, certificate in my inbox that afternoon." (Marcus T., landlord, Hollin Cross, EICR safety report)
3. "Rang three firms and only Dan gave me a price and a time. Shoe covers on, hoovered up after. New consumer unit in one morning." (Alison R., Wexby, New fuse box)

Avatars are coloured initials circles (`Avatar`, section 12). The review block lives on the landing page only.

### 3.6 Trust claims must read as sample

Every credential claim on the landing page is followed by a tiny `SAMPLE` tag (class `ui-tag-sample`, 12px uppercase outlined): rating, "Part P registered", "£2m public liability", the scheme line, qualification chips ("City & Guilds 2365", "18th Edition", "Inspection and Testing 2391", "Part P registered"). Footer states it again (3.7).

### 3.7 The "Prototype / sample data" notice: exact wording and placement

Component `PrototypeNotice` (section 12). Variants and exact text:

| Where | Variant | Exact text |
|---|---|---|
| Top of `index.html`, above the header; NOT sticky; 28px tall; not dismissible | `strip` | Badge `PROTOTYPE` then `Sample data, nothing is really sent.` then link `What's real?` → `dashboard.html#/about` (via `pageHref`) |
| Top of `dashboard.html`, above the header; same | `strip` | Same text; link `What's real?` → `#/about` |
| Landing footer (`footer-disclosure`) | `footer` | `This is a prototype. The reviews, ratings, registration number, prices and addresses are samples, not claims about a real firm. Bookings are saved only in this browser. No WhatsApp, SMS, email or payment is ever sent.` |
| Dashboard `#/more` and `#/about` footers | `footer` | Same paragraph, then `Everything you see here is stored in this browser only.` |
| Messages banner (`messages-banner`) | `inline` | `SIMULATED. Nothing is sent from this prototype. These are the messages the live system would send through the WhatsApp Business Platform. Tap "Open in WhatsApp" to try one on your own phone.` |
| Booking confirmation, inside the ticket card | inline line | `Dan gets a WhatsApp alert (simulated in this prototype).` |
| Every simulated message entry | label | `Sent (simulated)` or `Scheduled for Fri 18:00 (simulated)` |

**Strip styling and hit area (`strip` variant).** Background `--cta-soft`, text `--text` at `--fs-12`, 1px `--line` bottom border; the `PROTOTYPE` badge is `--panel` with `--panel-text`; content centred on one line with ellipsis. The strip is 28px (`--h-strip`) but its link must still measure at least 44x44 (gate Q2): the link is `display: inline-flex; align-items: center; min-height: 44px; padding-inline: 8px; margin-block: -8px;` so its box overflows the strip by 8px above and below without changing the strip's height. The strip is `position: static` (scrolls away) and sits ABOVE the sticky header in the DOM, so the header paints over the lower 8px of the link overflow; this is accepted.

The notice is never hidden by a rebrand.

---

## 4. Visual identity and design tokens

Concept: warm trades paper, ink navy, one loud "spark" amber, and the circuit-breaker switch as the signature motif (logo-adjacent mark, confirmation animation, toggles drawn as breaker levers, the confirmed-status glyph). It must look like a sign-written van, not a SaaS template, and must feel different from the Kontor council prototype in the repo root. Colour is NEVER the only signal: every status has an icon and a word.

### 4.1 Voice (UI copy)

Plain, warm, trade-direct, a bit dry. UK spelling. Second person to customers ("you"), first person from Dan inside messages ("I'll message when I'm 30 minutes away"), third person in UI chrome ("Dan has your booking"). No jargon without a translation (consumer unit = fuse box; EICR = safety report). Concrete numbers over adjectives. No exclamation marks, no emoji, no "solutions", no hype words. Safety copy is calm and procedural. The owner app speaks like a good foreman: short imperatives (`On my way`, `Mark done`, `Block this time`). Every simulated thing says "simulated" in plain words. Windows are written `8–10am`, `10am–12`, `1–3pm`, `3–5pm` (en dash U+2013, compact 12-hour). Precise clock times (ETA, scheduled sends, "created") are 24-hour `HH:mm`. Money is `£85`, no pence unless needed. Dates are `Sat 24 Oct`.

### 4.2 Fonts (local only, vendored)

| File | Source | Size | Use |
|---|---|---|---|
| `fonts/bricolage-grotesque-latin-wght-normal.woff2` | npm `@fontsource-variable/bricolage-grotesque@5.3.0`, file `files/bricolage-grotesque-latin-wght-normal.woff2` | about 41 KB | Display: wordmark, H1, H2, big prices and numerals, ticket headings. Weights 600 to 800. |
| `fonts/figtree-latin-wght-normal.woff2` | npm `@fontsource-variable/figtree@5.3.0`, file `files/figtree-latin-wght-normal.woff2` | about 20 KB | Body and UI. Weights 400 to 800. |
| `fonts/LICENSE-OFL.txt` | The SIL OFL 1.1 text from either package's `LICENSE`, plus one line per font | small | Licence notice. |

WP2 obtains them with a throwaway `npm i` in the scratchpad (never in the repo) and copies the two `.woff2` files. Total font weight about 61 KB. `css/fonts.css` declares exactly:

```css
@font-face { font-family: 'Bricolage Grotesque'; font-style: normal; font-weight: 200 800; font-display: swap;
  src: url('../fonts/bricolage-grotesque-latin-wght-normal.woff2') format('woff2');
  unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
@font-face { font-family: 'Figtree'; font-style: normal; font-weight: 300 900; font-display: swap;
  src: url('../fonts/figtree-latin-wght-normal.woff2') format('woff2');
  unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
```

Every page preloads both files in `<head>` (section 16.1). The system stack in `--font-body` means a missing font never breaks layout; layouts must not depend on font metrics (no fixed widths measured against Figtree).

### 4.3 Tokens: `css/tokens.css` (owner WP2). EXACT names and values.

Rules: (a) light values on `:root`; (b) the dark block appears TWICE, byte-identical: once under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ... } }` and once under `:root[data-theme="dark"] { ... }`; (c) `body` gets `background: var(--bg); color: var(--text)` explicitly; (d) nobody hard-codes a hex colour outside this file except the two brand SVGs (section 4.8).

**Colour: light (`:root`)**

```css
:root {
  color-scheme: light;
  /* surfaces */
  --bg: #FBF8F2;            /* page, "paper" */
  --surface: #FFFFFF;       /* cards, sheets, inputs */
  --surface-2: #F3EEE4;     /* sunken areas, "sand" */
  --line: #E3DCCD;          /* hairlines, dividers */
  --field-border: #7D7766;  /* input and control borders (4.4:1 on white, 4.2:1 on --bg; UI needs 3:1) */
  --scrim: rgba(11, 16, 32, 0.55);
  /* text */
  --text: #14213D;          /* 15:1 on --bg */
  --text-2: #465065;        /* 7.6:1 */
  --text-3: #5A647C;        /* 5.6:1 on --bg, 5.1:1 on --surface-2 */
  --link: #1E4FD8;
  --focus: #1E4FD8;         /* 3px ring, 2px offset */
  --focus-on-panel: #FFD15C; /* the same ring on navy panels (hero, final CTA, footer): 10:1 on --panel; --focus is only 2.4:1 there */
  /* brand: spark amber (primary action) */
  --cta: #FFB400;
  --cta-ink: #14213D;       /* text on --cta, 9:1 */
  --cta-press: #F2A200;
  --cta-soft: #FFF1C7;      /* tinted backgrounds */
  --cta-text: #8A5A00;      /* amber used as TEXT on --bg */
  /* navy panels (hero, final CTA, footer) */
  --panel: #14213D;
  --panel-2: #1D2E57;
  --panel-text: #FFF8E8;
  --panel-muted: #C3CDE3;   /* 10:1 on --panel */
  /* semantic */
  --danger: #C8281E;        /* solid emergency / destructive */
  --danger-ink: #FFFFFF;    /* text on --danger, 5.6:1 */
  --danger-tint: #FDE6E3;
  --danger-text: #A3180D;   /* 6.5:1 on --danger-tint */
  --ok: #1B7F45;            /* icons, dots (4.4:1 on sand) */
  --ok-text: #146C3A;
  --ok-tint: #D9F5E3;
  /* booking status: one pair per status (bg / fg) */
  --status-new-bg: #E3ECFF;        --status-new-fg: #1E4FD8;
  --status-confirmed-bg: #D9F5E3;  --status-confirmed-fg: #146C3A;
  --status-on-the-way-bg: #FFEBC2; --status-on-the-way-fg: #8A4B00;
  --status-done-bg: #E6EAF0;       --status-done-fg: #3B4658;
  --status-cancelled-bg: #FDE3E8;  --status-cancelled-fg: #9B1C3A;
  --status-urgent-bg: #C8281E;     --status-urgent-fg: #FFFFFF;
  /* availability dots (customer and owner calendars) */
  --dot-free: #1B7F45;
  --dot-few: #B87400;
  --dot-full: #857F6E;
  /* simulated WhatsApp-style chat */
  --chat-bg: #EFE8D8;
  --bubble-out-bg: #DDF6D2;  --bubble-out-fg: #14213D;   /* to customers */
  --bubble-in-bg: #FFFFFF;   --bubble-in-fg: #14213D;    /* owner alerts */
  /* elevation */
  --shadow-1: 0 1px 2px rgba(20, 33, 61, 0.08), 0 2px 8px rgba(20, 33, 61, 0.06);
  --shadow-2: 0 8px 28px -8px rgba(20, 33, 61, 0.28);
  --shadow-bar: 0 -2px 12px rgba(20, 33, 61, 0.08);
}
```

**Colour: dark ("van at night": no pure black, no pure white). Paste identically into both dark selectors.**

```css
  color-scheme: dark;
  --bg: #0B1020;
  --surface: #141B2F;
  --surface-2: #1B2440;
  --line: #2A3453;
  --field-border: #6B7597;
  --scrim: rgba(0, 0, 0, 0.65);
  --text: #F3F1EA;
  --text-2: #AEB6C8;
  --text-3: #8D97B0;
  --link: #8FB0FF;
  --focus: #FFD15C;
  --focus-on-panel: #FFD15C;
  --cta: #FFC233;
  --cta-ink: #14213D;
  --cta-press: #FFD15C;
  --cta-soft: #3A2D07;
  --cta-text: #FFC233;
  --panel: #16213E;
  --panel-2: #1D2B52;
  --panel-text: #FFF8E8;
  --panel-muted: #B9C4DC;
  --danger: #FF6B5E;
  --danger-ink: #2A0A07;
  --danger-tint: #3A1512;
  --danger-text: #FF9D91;
  --ok: #4ADE80;
  --ok-text: #6EE7A0;
  --ok-tint: #0F3220;
  --status-new-bg: #1B2A55;        --status-new-fg: #9DB8FF;
  --status-confirmed-bg: #0F3220;  --status-confirmed-fg: #6EE7A0;
  --status-on-the-way-bg: #3D2C06; --status-on-the-way-fg: #FFD166;
  --status-done-bg: #232C3D;       --status-done-fg: #C3CCDA;
  --status-cancelled-bg: #3E1521;  --status-cancelled-fg: #FFA3B5;
  --status-urgent-bg: #FF6B5E;     --status-urgent-fg: #2A0A07;
  --dot-free: #4ADE80;
  --dot-few: #FFC233;
  --dot-full: #7A84A6;
  --chat-bg: #0B141A;
  --bubble-out-bg: #12453B;  --bubble-out-fg: #E8F5EE;
  --bubble-in-bg: #1B2440;   --bubble-in-fg: #F3F1EA;
  --shadow-1: none;
  --shadow-2: 0 0 0 1px var(--line);
  --shadow-bar: 0 -1px 0 var(--line);
```

All pairs above were computed by the critic pass (text 4.5:1, UI 3:1, light and dark): every pair passes. The one failure found (`--focus` on `--panel` in light mode, 2.4:1) is fixed by `--focus-on-panel`: every interactive element inside a `--panel` surface (`.lp-hero`, `.lp-final`, `.lp-footer`) uses `outline-color: var(--focus-on-panel)`. Note the focus ring is drawn 2px OUTSIDE the element, so it is measured against the surrounding surface, not against the element's own fill. Do not change a value without re-running the contrast check (QA script `tests/qa/contrast.mjs`, section 15).

**Non-colour tokens (once, in `:root`, same in both themes)**

```css
:root {
  /* type */
  --font-display: 'Bricolage Grotesque', ui-rounded, 'Segoe UI', system-ui, sans-serif;
  --font-body: 'Figtree', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --fs-12: 0.75rem;   /* captions, chips, tab labels. NEVER smaller. */
  --fs-14: 0.875rem;  /* meta, helper text */
  --fs-15: 0.9375rem; /* dashboard dense rows */
  --fs-16: 1rem;      /* body, ALL inputs (16px stops iOS zoom) */
  --fs-17: 1.0625rem; /* card titles, button labels */
  --fs-20: 1.25rem;
  --fs-26: 1.625rem;
  --fs-h1: clamp(2rem, 8.8vw, 3.5rem);     /* about 33px at 375, 56px from 640 */
  --fs-h2: clamp(1.625rem, 5vw, 2.25rem);  /* 26px at 375, 36px from 720 */
  --lh-tight: 1.05;  --lh-snug: 1.25;  --lh-body: 1.5;
  --fw-regular: 400; --fw-medium: 500; --fw-semibold: 600; --fw-bold: 700; --fw-heavy: 800;
  --tracking-tight: -0.02em;  --tracking-caps: 0.06em;
  /* spacing, 4px grid */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 48px; --space-8: 64px;
  /* radii */
  --r-sm: 8px;  --r-md: 12px;  /* inputs, buttons */  --r-lg: 16px;  /* cards */
  --r-xl: 24px; /* sheet top */ --r-2xl: 28px; /* hero bottom */ --r-pill: 999px;
  /* sizes */
  --tap: 44px;  --h-input: 52px;  --h-btn: 48px;  --h-btn-lg: 56px;
  --h-strip: 28px;  --h-header: 56px;  --h-tabbar: 64px;  --h-stickybar: 64px;  --h-fab: 56px;
  --container: 1120px;  --gutter: 16px;  /* base.css raises --gutter to 24px at 768 and 32px at 1100 */
  --sidebar-w: 240px;   /* there is no rail token: the rail was cut (2.3) */
  /* safe areas (viewport-fit=cover is set on both pages) */
  --safe-top: env(safe-area-inset-top, 0px);    --safe-right: env(safe-area-inset-right, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px); --safe-left: env(safe-area-inset-left, 0px);
  /* z-index layers (use only these) */
  --z-base: 0;  --z-raised: 10;  --z-sticky: 20;  --z-tabbar: 30;  --z-fab: 35;
  --z-scrim: 100;  --z-sheet: 110;  --z-toast: 200;
  /* motion */
  --dur-fast: 120ms;  --dur-base: 200ms;  --dur-sheet: 280ms;  --dur-flip: 450ms;  --dur-highlight: 1200ms;
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

Reduced motion: `base.css` contains `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; } }` and the breaker animation, live-dot pulse and highlight fade all have a reduced-motion static state.

### 4.4 Type scale (mobile first, base 375px)

| Role | Token | Weight | Family | Line-height | Notes |
|---|---|---|---|---|---|
| H1 (hero) | `--fs-h1` (33px at 375, up to 56px) | 800 | display | `--lh-tight` | tracking `--tracking-tight`; '60 seconds' in `--cta` with an SVG underline |
| H2 (section) | `--fs-h2` | 800 | display | `--lh-snug` | |
| Page title (dashboard H1) | `--fs-26` | 800 | display | `--lh-snug` | |
| Card title | `--fs-17` | 700 | body | 1.3 | |
| Body | `--fs-16` | 400 | body | `--lh-body` | max measure 62ch |
| Dashboard dense rows | `--fs-15` | 400/600 | body | 1.4 | still 44px targets |
| Meta, helper | `--fs-14` | 400 | body | 1.4 | `--text-2` or `--text-3` |
| Caption, chips, tab labels | `--fs-12` | 600 | body | 1.3 | uppercase eyebrow adds `--tracking-caps` |
| Prices, times, refs, counts | any | tabular | | | `font-variant-numeric: tabular-nums` |
| Booking reference | `--fs-14`/`--fs-17` | 600 | `--font-mono` | | `VM-1043` |

### 4.5 Status colour, icon and label (one per status)

| Status value | Label (UI) | Icon | bg token | fg token | Extra |
|---|---|---|---|---|---|
| `new` | `New request` | `bell` | `--status-new-bg` | `--status-new-fg` | |
| `confirmed` | `Confirmed` | `calendar-check` | `--status-confirmed-bg` | `--status-confirmed-fg` | |
| `on_the_way` | `On the way` | `navigation` | `--status-on-the-way-bg` | `--status-on-the-way-fg` | |
| `done` | `Done` | `badge-check` | `--status-done-bg` | `--status-done-fg` | if `!paid` the pill label is `To collect` with the same colours plus `pound-sterling` icon |
| `cancelled` | `Cancelled` | `ban` | `--status-cancelled-bg` | `--status-cancelled-fg` | title gets `text-decoration: line-through` |
| flag `urgent` | `URGENT` | `siren` | `--status-urgent-bg` | `--status-urgent-fg` | separate pill shown beside the status pill |

Availability dot levels (`getDayLoad().level`): `good` = `--dot-free`, `few` = `--dot-few`, `full` = `--dot-full` with strikethrough day number, `closed` = `--dot-full` with hatch and the word "Closed". The dot is always accompanied by text or an accessible label ("2 windows free", "1 left", "Full", "Closed").

### 4.6 Component shape rules

Cards radius `--r-lg`, buttons and inputs `--r-md`, chips and slot buttons `--r-md` or `--r-pill`, sheet top `--r-xl`, hero bottom `--r-2xl`. Borders 1.5px `--line` (cards) and 1.5px `--field-border` (controls). Shadows only in light mode (`--shadow-1/2/bar`); dark uses borders. Primary button: 56px (`--h-btn-lg`) inside conversion flows, 48px elsewhere, a 3px darker bottom edge in `--cta-press` that compresses 2px on `:active` (visible pressed state, no hover-only affordances). Focus ring: `outline: 3px solid var(--focus); outline-offset: 2px` on every interactive element, never removed. Toggles are drawn as breaker levers (section 12.6, `Switch`).

### 4.7 Hero panel

`--panel` navy, bottom corners `--r-2xl`, text `--panel-text`, muted `--panel-muted`, primary button `--cta` with `--cta-ink`. In dark mode the panel stays navy (`#16213E`).

### 4.8 Imagery plan (all local, all SVG, nothing remote, no photos, no emoji)

| Asset | Path | Owner | Notes |
|---|---|---|---|
| Logo mark: amber rounded square with a navy lightning bolt | `img/logo-mark.svg` (hex colours allowed in this file and `favicon.svg` only) | WP2 | Also rendered inline by `BrandMark`. |
| Favicon | `img/favicon.svg` | WP2 | Same mark. |
| PNG icons | `img/icon-192.png`, `img/icon-512.png`, `img/apple-touch-icon.png` (180x180) | WP2 | Rendered from `logo-mark.svg` with Playwright by `scripts/gen-png.mjs`. The script loads `playwright-core` itself with `createRequire(process.env.QA_DEPS_DIR + '/')` (it cannot import WP0's `lib.mjs`, which does not exist yet in Phase 1); `scripts/gen-icons.mjs` likewise reads `lucide-static` from a throwaway `npm i --prefix <scratchpad>` directory given as `LUCIDE_DIR`. Neither script touches `electrician/` except to write its output. |
| Hero wiring grid and pale bolt | `img/hero-wiring.svg` | WP3 | Dotted grid at 6% opacity plus one oversized bolt bleeding off the right edge; used as a CSS background on the hero panel. |
| Dan avatar | `img/dan-avatar.svg` | WP3 | "DM" monogram on an amber disc. No photo. |
| Six-breaker consumer unit (confirmation art) | inline component `BreakerArt` in `js/landing/art.js` | WP3 | Third switch flips ON in 450ms (`--dur-flip`, `--ease-spring`). Static final state under reduced motion. |
| Empty-state line drawings (plug, calendar, tick) | inline in `EmptyState` via `Icon` large | WP2 | Use `plug`, `calendar-days`, `circle-check` at 48px with `--text-3`. |
| Review avatars, customer avatars | `Avatar` (initials on one of 6 tints chosen by `hashHue(name)`, an integer 0 to 5) | WP2 | No new colours. Tint 0 `--status-new-bg/fg`, 1 `--status-confirmed-bg/fg`, 2 `--status-on-the-way-bg/fg`, 3 `--status-done-bg/fg`, 4 `--surface-2` with `--text-2`, 5 `--cta-soft` with `--cta-text`. The cancelled and urgent pairs are never used for avatars because they carry meaning. |
| Chat wallpaper | `--chat-bg` flat colour | WP2 | No WhatsApp artwork, no WhatsApp logo. Use `message-circle` plus the word "WhatsApp". |

Decorative SVGs carry `aria-hidden="true"`.

### 4.9 Icon set (lucide-static, ISC licence)

Source: `lucide-static@1.61.0` (npm). WP2 runs `scripts/gen-icons.mjs` once (using a throwaway `npm i lucide-static` in the scratchpad) to write `js/ui/icons.js`. Stroke 1.75 at 24px (`stroke-linecap/linejoin: round`, `fill: none`, `stroke: currentColor`). The data format is element arrays rendered with `h()`, never strings (rule 8). The generator must handle the six element types that occur in the icons below (checked): `path`, `rect`, `circle`, `line`, `polyline`, `polygon`:

```js
// js/ui/icons.js
export const ICONS = { zap: [['path', { d: 'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z' }]], /* ... */ };
```

**The exact list of icon names that MUST exist** (all verified present in lucide-static 1.61.0):

```
zap phone message-circle calendar calendar-days calendar-check calendar-x clock
shield-check badge-check file-check file-text clipboard-check star map-pin house building-2
plug plug-zap lightbulb wrench toggle-right siren triangle-alert bell bell-ring
check check-check circle-check circle-x circle-alert info
chevron-left chevron-right chevron-down chevron-up arrow-left arrow-right x plus search ellipsis
settings user users inbox receipt pound-sterling navigation truck ban rotate-ccw undo-2
download external-link copy send share-2 smartphone moon sun sun-moon history list-checks lock refresh-cw gauge
```

Icon use map (so every package picks the same glyph): services `fault=wrench`, `eicr=clipboard-check`, `consumer=toggle-right`, `sockets=lightbulb`, `ev=plug-zap`, `rewire=file-text`, `emergency=siren`. Tabs `today=zap`, `calendar=calendar-days`, `bookings=inbox`, `insights=pound-sterling`, `more=ellipsis`. Actions: call `phone`, WhatsApp `message-circle`, maps/navigate `navigation`, location `map-pin`, copy `copy`, calendar download `download`, external `external-link`, theme auto/light/dark `sun-moon`/`sun`/`moon`, back `arrow-left` (dashboard) or `chevron-left` (sheets), undo `undo-2`.

---

## 5. Responsive and mobile rules

### 5.1 Principles (both pages)

1. **Design at 375x812 first.** Then 320x568 must not overflow, then enhance at 480, 768, 1100.
2. Breakpoints (literal in CSS, `min-width`): `480px`, `768px`, `1100px`. No others, with ONE documented exception: `375px` may be used ONLY by the booking date grid and the landing sticky bar (5.2, 5.4), because seven 44px cells need 332px. Names: base (<480), `sm` 480, `md` 768, `lg` 1100.
3. **Zero horizontal page scroll from 320px up.** Every flex/grid child gets `min-width: 0`; user text gets `overflow-wrap: anywhere`; images and SVGs `max-width: 100%`. Inner scroll-snap strips (next-free chips never scroll; the dashboard week strip may) are contained in a wrapper with `overflow-x: auto; overscroll-behavior-x: contain`. Never put `overflow-x: hidden` on `html`, `body` or `#app` to hide overflow: it breaks `position: sticky` and masks real bugs (Q1 measures real overflow). The only `overflow` on `html` is `.is-scroll-locked`.
4. **Touch targets are at least 44x44 CSS px** for every interactive element: buttons, icon buttons, chips, tabs, switches, radio/checkbox rows (the whole row is the target), links in lists and footers, `summary` rows (56px). Exemption: a link inside a sentence of body text with class `ui-link--inline`. Keep at least 8px between adjacent targets; 16px between a primary and a destructive button.
5. **Thumb zone:** primary actions live in the bottom third: sticky bottom bars, bottom sheets, the FAB, full-width buttons on mobile.
6. **Safe areas:** `<meta viewport ... viewport-fit=cover>`. Header, sheets, sticky bar, tab bar, toasts and the FAB add `env(safe-area-inset-*)` via the `--safe-*` tokens. Use `100dvh` (with a `100vh` fallback declared first). Never `100vh` alone. Page containers (`lp-container`, `db-page`) use `padding-inline: max(var(--gutter), var(--safe-left))` and `max(var(--gutter), var(--safe-right))` so a landscape notch never clips content.
7. **Inputs are 16px minimum** (no iOS zoom), 52px tall, labels above and always visible, `font: inherit`.
8. **Keyboard and autofill attributes** (exact):

| Field | Attributes |
|---|---|
| Name | `type="text" autocomplete="name" autocapitalize="words" enterkeyhint="next"` |
| Mobile | `type="tel" inputmode="tel" autocomplete="tel" enterkeyhint="next"` |
| Email (settings only) | `type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false"` |
| Postcode | `type="text" inputmode="text" autocomplete="postal-code" autocapitalize="characters" spellcheck="false" enterkeyhint="next"` |
| House number and street | `type="text" autocomplete="address-line1" enterkeyhint="next"` |
| Note | `<textarea rows="3" enterkeyhint="done">` |
| Price (GBP) | `type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done"` |
| Date (settings) | `type="date"` |
| Search | `type="search" inputmode="search" enterkeyhint="search" autocomplete="off"` |
| Max lengths (`maxlength`) | name 60, mobile 20, postcode 8, house number and street 80, note 300, business fields in Settings 80 |

In htm templates a boolean-valued attribute must be written `spellcheck=${false}`, never `spellcheck="false"` (the string makes the property true; 6.1.1 trap 1). The other attributes in this table are safe as plain strings.


9. **Sticky bars** (landing action bar, sheet footers, dashboard action bar) add the safe-area bottom inset to their padding and reserve matching `padding-bottom` on the scroll content so nothing is hidden underneath.
10. **Sheets** (section 12.4): below 768px a bottom sheet (or full-screen `size="full"`), `max-height: calc(100dvh - var(--safe-top) - 16px)`, rounded top `--r-xl`, grab handle (decorative), sticky footer for actions; from 768px a centred dialog 560px wide (480px for `size="auto"`), `max-height: 90dvh`, with a scrim. Focus is trapped, `Esc` closes, the page behind is `inert`, body scroll is locked, focus returns to the opener. No swipe-to-dismiss (WON'T). On-screen keyboard behaviour is item 15.
11. **Dark mode:** `prefers-color-scheme` honoured by default; the user can force Auto/Light/Dark. Stored in `localStorage['vm_theme']` (`'auto'|'light'|'dark'`; missing = auto). A short inline `<script>` in each page's `<head>` reads it BEFORE first paint and sets `data-theme` on `<html>` (exact script in 16.1). The `ThemeToggle` writes it and updates the two `theme-color` meta tags. `:root[data-theme="light"]` and `[data-theme="dark"]` override the media query.
12. **Reduced motion** (4.3) and `forced-colors`: keep borders on cards, chips and buttons (`border: 1.5px solid`) so they remain visible.
13. **Print:** not required.
14. **Touch behaviour (base.css).** `html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }`; `a, button, [role=button], [role=switch], [role=radio], input, select, textarea, summary { touch-action: manipulation; }` (removes the double-tap zoom delay); `-webkit-tap-highlight-color: transparent` with the visible `:active` state from 4.6 instead; `overscroll-behavior: contain` on every scrolling panel (sheet body, strips).
15. **On-screen keyboard.** iOS Safari and Chrome do NOT shrink `100dvh` when the keyboard opens, so a bottom-fixed footer ends up behind the keyboard and the submit button is unreachable. `bootApp` starts `trackViewport()` (private to `js/ui/boot.js`): on `visualViewport` `resize` and `scroll` it sets the CSS variable `--kb-inset` on `<html>` to `max(0, innerHeight - visualViewport.height - visualViewport.offsetTop)` in px (0 when `visualViewport` is missing, and 0 while `visualViewport.scale` is not 1, i.e. while the user has pinch-zoomed) and toggles the class `is-keyboard-open` while the inset is above 120px. Consumers: a `Sheet` panel is positioned with `bottom: var(--kb-inset, 0px)` and its `max-height` / full height subtracts `var(--kb-inset, 0px)`, so its sticky footer rides above the keyboard; when a field inside a sheet or page receives focus it is scrolled into view with `scrollIntoView({ block: 'center' })` after 250ms; `html.is-keyboard-open` hides the landing sticky bar, the dashboard tab bar, the FAB and any `db-sticky-actions` that is NOT inside a sheet (they would float over the keyboard). The viewport meta also carries `interactive-widget=resizes-content` (16.1), which makes Chrome on Android resize the layout instead (the computed inset is then 0, so nothing double-counts).
16. **The dashboard header is sticky** (`top: 0`, `z-index: var(--z-sticky)`) below the non-sticky prototype strip; strip, header and content are SIBLINGS under one page-tall container (a wrapper around strip + header would unstick the header); the tab bar is `position: fixed`; the landing header is sticky (13.1 L2).
17. **Live regions** (`ToastHost`, `coverage-result`, the booking selection announcer, `demo-sim-result`, `setting-saved`) are rendered from first paint and only their TEXT changes; most screen readers do not announce a region that is inserted together with its message.

### 5.2 Landing page layout per breakpoint

| Element | Base (375) | `md` 768 | `lg` 1100 |
|---|---|---|---|
| Container | gutter 16px, full width | gutter 24px | max `--container` 1120px, gutter 32px |
| Prototype strip | 28px, one line, ellipsis | same | same |
| Header | sticky, `--h-header` 56px + safe-top; brand left, ONE 44px round call button right; no hamburger | brand left; the phone number as a text link and the amber "Book a visit" button. The five anchor links are NOT shown below 1100 (they do not fit beside brand, phone and button at 768) | adds the text links Services, How it works, Reviews, Area, FAQ between brand and phone |
| Hero | single column: live block, H1, sub, trust line, tile grid 2x2 (tile min-height 88px), quiet links | two columns: copy left, tile card right | same, H1 up to 56px |
| Trust bar | 2x2 | 4 across | 4 across |
| Emergency strip | collapsed `<details>`, 56px summary | same | same |
| Services | 1 column rows (min 72px) | 2 columns | 3 columns |
| How it works | vertical stack with connecting line | 3 columns | 3 columns |
| Reviews | stacked cards (NO carousel) | 3 columns | 3 columns |
| Meet Dan + coverage | stacked | 2 columns | 2 columns |
| FAQ | single column `<details>` | single column, max 720px | same |
| Final CTA | full-width amber button + two secondary | inline buttons | same |
| Sticky action bar | fixed bottom 64px + safe-bottom: `Call` (84px), `WhatsApp` (84px), `Book a visit` (flex 1, 56px); below 375px see the paragraph under this table | HIDDEN from 768px | hidden |
| Booking sheet | full screen (`100dvh`), slides up 280ms | centred 560px dialog with scrim | same |
| Page bottom padding | `calc(var(--h-stickybar) + var(--safe-bottom) + 16px)` | none | none |

Below 375px (320 to 374) the sticky bar shows `Call` and `WhatsApp` as icon over 12px label in 64px wide buttons with 12px side padding and 8px gaps, so `Book a visit` keeps at least 136px and shows its full label (this is the one use of the 375px exception in 5.1.2). In-page anchors (`#services`, `#how`, `#reviews`, `#area`, `#faq`) need `scroll-margin-top: calc(var(--h-header) + var(--safe-top) + 8px)` on each anchored section so the sticky header never covers the heading. Landmarks: the sticky header is the `<header>`; the strip is a `<div role="note" aria-label="Prototype notice">` placed just before it as a SIBLING (never wrap strip and header in one element: `position: sticky` only works inside a parent as tall as the page, so a wrapper would unstick the header after 84px of scrolling); L3 to L11 are inside `<main>`, L12 is the `<footer>`; each section is a `<section aria-labelledby>`.

### 5.3 Dashboard layout per breakpoint

| Element | Base (<768) | `md` 768 to 1099 | `lg` 1100+ |
|---|---|---|---|
| Strip + header | strip 28px; header 56px + safe-top: brand mark + short name, right: Messages icon (badge), ThemeToggle, customer-site link | same | same |
| Navigation | fixed bottom tab bar, 64px + safe-bottom, 5 tabs (icon 24px over 12px label): Today, Calendar, Bookings, Insights, More; active tab = filled `--cta` pill | the same bottom tab bar (its five items sit in a centred row, max 560px); there is NO rail (cut, section 2.3) | left sidebar `--sidebar-w` 240px: brand, 5 items, Messages, Customers, "New booking" button, Demo tools and What's real links at the bottom |
| Content | single column, gutter 16px, bottom padding clears tab bar + FAB | centred column max 720px | content max 1080px |
| FAB "New booking" | 56px amber round button, bottom right above the tab bar, on Today / Calendar / Bookings (list) | same, aligned to the right edge of the centred column | hidden (the sidebar has the button) |
| Immersive routes (booking detail, new booking, customer detail) | tab bar and FAB hidden; page header with back arrow; sticky bottom action bar | same as base (detail replaces the list) | Bookings (S5) and Customers (S10) become master-detail, list 420px left and detail right (both SHOULD; without them the detail simply replaces the list, as below 1100); the sidebar stays |
| Today | one column | one column, cards two across where noted | two columns: Needs you + Next up left, timeline + tomorrow + share right |
| Calendar | week strip + selected-day rows | 7-column week grid (rows = windows) | week grid; clicking a booking opens it in the right-hand panel of Bookings via `#/bookings/<id>` |
| Sheets | bottom sheets | centred dialogs | centred dialogs |

### 5.4 The 320px rules (explicit)

- Header brand: wordmark truncates with ellipsis, never wraps; icons keep 44px.
- Hero tiles stay two columns; tile text may wrap to 2 lines (title 16px, price 14px); tile min-height 88px.
- The date picker (customer: up to `maxDaysAhead` days; owner mode and the reschedule sheet: 28 days) shows 5 columns below 375px and 7 columns from 375px (cell min 44x56, 4px gaps: seven cells need 332px, a 375px screen gives 343px, a 360px screen would give only 328px). It is a wrapping grid, not a scroller.
- Window buttons are full width, 56px.
- Tab bar labels are 12px and may not wrap (`white-space: nowrap`), 5 items fit in 320px (64px each).
- No fixed pixel widths above 288px anywhere.
- The dashboard Calendar week strip (13.7) may scroll inside its own wrapper below 360px; the selected day is scrolled into view.

---

## 6. Tech stack, file layout, work packages

### 6.1 Stack (decided)

| Concern | Decision |
|---|---|
| Language | Plain HTML + CSS + ES modules. No build, no bundler, no TypeScript (JSDoc types only). |
| UI | Preact + htm, vendored at `js/vendor/preact-htm.js` (never edit). It exports exactly: `h, html, render, Component, createContext, useState, useReducer, useEffect, useLayoutEffect, useRef, useImperativeHandle, useMemo, useCallback, useContext, useDebugValue, useErrorBoundary`. There is NO `preact/compat`, NO `useSyncExternalStore`, NO `useId`. Use `class=` (not `className`). Event props are `onClick`, `onInput`, `onChange`, `onKeyDown`. |
| Import path to the vendor file | `'../vendor/preact-htm.js'` from `js/ui/`, `js/core/`, `js/landing/`, `js/booking/`, `js/dashboard/`; `'../../vendor/preact-htm.js'` from `js/dashboard/views/` and `js/dashboard/shared/`. Always include the `.js` extension on every import. Same depth rule for the rest: from `js/dashboard/views/` and `js/dashboard/shared/` the UI barrel is `'../../ui/index.js'` and core modules are `'../../core/<name>.js'`; from `js/dashboard/`, `js/landing/` and `js/booking/` they are `'../ui/index.js'` and `'../core/<name>.js'`; from `js/ui/` core is `'../core/<name>.js'`. |
| State | One client-side store, `js/core/store.js`, persisted to `localStorage`, shared by both pages, live across tabs. Preact binding: `useStore(selector)` in `js/ui/hooks.js`. |
| Routing | Dashboard: hash routes (`#/today`). Landing: hash drives the booking sheet (`#book/...`) and in-page anchors. No real-path routing, no 404 handling needed. |
| CSS | Hand-written, tokens in `css/tokens.css`, BEM-ish class names with per-package prefixes (12.1). Each page loads only the CSS it needs (16.1). |
| Fonts / icons / images | Local files (4.2, 4.8, 4.9). |
| Tests | Node 22: `node --test` for unit tests (WP1). **Node 22 treats a bare directory argument as a module path and fails (verified), so always pass a QUOTED glob.** Playwright (`playwright-core` 1.56.1, Chromium at `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`, launch args `['--no-sandbox']`, never `playwright install`) for e2e and QA (WP0). **Neither Playwright nor axe-core is installed in this repo** (there is no `node_modules`; the root `package.json` belongs to the unrelated Kontor project, so never run `npm install` at the repo root and never commit `node_modules`). Each agent that needs them (every package for its own checks, WP0 for the suite) installs them once into ITS OWN scratchpad with `npm i --prefix <scratchpad>/qa-deps playwright-core@1.56.1 axe-core@4.10.2`, and WP0's test scripts get them from `loadDeps()` in `tests/e2e/lib.mjs`, which uses `createRequire(process.env.QA_DEPS_DIR + '/')` (ES modules ignore `NODE_PATH`). Every browser context is created with `{ timezoneId: 'Europe/London', locale: 'en-GB' }` (7.6). |
| Module type | The nearest `package.json` is the repo root one (`"type": "module"`), so `.js` files under `electrician/` are ES modules in Node too. Do NOT add `electrician/package.json`. |
| Local dev server | `python3 -m http.server <port> --directory /home/user/LG-Proto1/electrician`. ES modules do not load from `file://`. Ports per package: WP0 4100, WP2 4102, WP3 4103, WP4 4104, WP5 4105, WP6 4106, WP7 4107, WP8 4108 (so parallel agents never collide). |
| Unit test command (from repo root) | `TZ=Europe/London node --test "electrician/tests/unit/*.test.mjs"` (quoted glob; a bare directory fails on Node 22, and running `node --test` with no argument would also discover the Kontor tests) |

### 6.1.1 Preact + htm gotchas (every row verified in Chromium against `js/vendor/preact-htm.js`)

| # | Trap | Do this instead |
|---|---|---|
| 1 | `spellcheck="false"` written as a string makes `input.spellcheck` TRUE (the string `'false'` is truthy). | Always `spellcheck=${false}`. `inputmode`, `enterkeyhint`, `autocapitalize`, `autocomplete`, `pattern`, `maxlength`, `tabindex` are all safe as plain strings. |
| 2 | `render()` called twice on the SAME container replaces the first tree. | One container per `render()` call. Each `Sheet` instance and the `ToastHost` get their own container (12.4). |
| 3 | `render()` into a container that already has children APPENDS and leaves the old children in the DOM. | Empty the container first. `bootApp` empties `#app`; a pre-rendered header (S8) is therefore replaced, not hydrated. |
| 4 | htm trims whitespace around newlines: `<b>a</b>` + newline + `<i>b</i>` renders with NO space between them. | Keep inline siblings on one line, or write `${' '}` between them. |
| 5 | Text inputs: `value=${v}` with `onInput`. `<select>`: `value=${v}` with `onChange` (works). | Do not use `onChange` on text inputs. |
| 6 | `aria-pressed=${false}` renders `"false"` (good). `disabled=${false}` omits the attribute (good). `inert=${true}` sets the attribute. `class`, not `className`; `for`, not `htmlFor`. | |
| 7 | `style` takes a string or an object; custom properties work in the object form: `style=${{ '--x': '4px' }}`. | |
| 8 | Sheet content is a SEPARATE Preact root (no portals). Values from `createContext` providers in the page are not visible inside it. | Do not use context for anything a sheet child needs; read the store with `useStore`, which works in any root. |

### 6.2 File tree and OWNERSHIP TABLE (one owner per file; no file has two owners)

`WP0` = integration and QA, run AFTER the feature packages merge (not one of the eight build packages). Feature agents never create or edit WP0 files.

```text
electrician/
├── css/
│   ├── base.css  [WP2] Reset, typography, utilities (u-*), focus ring, safe areas, reduced motion
│   ├── booking.css  [WP3] Booking sheet, steps, confirmation, manage (bk-*)
│   ├── bookings.css  [WP5] Bookings list, detail, job-action sheets (bl-*, bd-*, ja-*)
│   ├── calendar.css  [WP6] Calendar and New booking page (cal-*)
│   ├── components.css  [WP2] UI kit styles (ui-*)
│   ├── dashboard.css  [WP2] Dashboard shell and page helpers (db-*)
│   ├── fonts.css  [WP2] @font-face for the two local fonts
│   ├── insights.css  [WP7] Customers, Insights, About (cu-*, in-*, ab-*)
│   ├── landing.css  [WP3] Landing sections (lp-*)
│   ├── settings.css  [WP8] More, Settings, Messages, Demo tools (st-*, ms-*, dm-*)
│   ├── today.css  [WP4] Today screen (td-*)
│   └── tokens.css  [WP2] All design tokens, light + dark
├── docs/
│   └── BUILD-CONTRACT.md  [WP0] This contract (read-only for everyone else)
├── fonts/
│   ├── LICENSE-OFL.txt  [WP2] SIL OFL 1.1 notice for both fonts
│   ├── bricolage-grotesque-latin-wght-normal.woff2  [WP2] Display font (variable, latin)
│   └── figtree-latin-wght-normal.woff2  [WP2] Body font (variable, latin)
├── img/
│   ├── apple-touch-icon.png  [WP2] Apple touch icon 180
│   ├── dan-avatar.svg  [WP3] Owner monogram avatar
│   ├── favicon.svg  [WP2] Favicon (same mark)
│   ├── hero-wiring.svg  [WP3] Hero dotted wiring grid + pale bolt
│   ├── icon-192.png  [WP2] Manifest icon 192
│   ├── icon-512.png  [WP2] Manifest icon 512
│   └── logo-mark.svg  [WP2] Brand mark: amber square, navy bolt
├── js/
│   ├── booking/
│   │   ├── booking-sheet.js  [WP3] BookingSheet (customer + owner modes)
│   │   ├── confirmation.js  [WP3] Confirmation + DEMO panel
│   │   ├── day-picker.js  [WP3] DayPicker
│   │   ├── details-step.js  [WP3] Step 2
│   │   ├── draft.js  [WP3] sessionStorage draft
│   │   ├── emergency-step.js  [WP3] Emergency path
│   │   ├── manage.js  [WP3] Manage page
│   │   ├── nav.js  [WP3] parseBookHash, bookHref, openBooking, closeBooking
│   │   ├── service-step.js  [WP3] Step 0
│   │   └── when-step.js  [WP3] Step 1 (Soonest, EICR size, windows)
│   ├── core/
│   │   ├── availability.js  [WP1] Window/slot engine
│   │   ├── clock.js  [WP1] now(), ?now= override
│   │   ├── config.js  [WP1] Constants, defaults, promises, template kinds
│   │   ├── dates.js  [WP1] Local date/stamp helpers and formatters
│   │   ├── format.js  [WP1] Money, phone, postcode, validators, ids
│   │   ├── ics.js  [WP1] Calendar file builder and download
│   │   ├── messages.js  [WP1] Templates, rendering, wa.me/tel/maps links, bubble actions
│   │   ├── seed.js  [WP1] Relative seed data, simulator pool, sample customer
│   │   ├── selectors.js  [WP1] Pure derived data (needs-you, next-up, customers, insights)
│   │   └── store.js  [WP1] Persisted store, mutations, sync, undo
│   ├── dashboard/
│   │   ├── shared/
│   │   │   └── job-actions.js  [WP5] JobActionBar, NeedsYouActions, PaidButton, sheets, undo toast
│   │   ├── views/
│   │   │   ├── stub.js  [WP2] StubView placeholder for unbuilt views (no leading underscore: some static hosts and Jekyll skip such files)
│   │   │   ├── about.js  [WP7] What's real view
│   │   │   ├── booking-detail.js  [WP5] BookingDetail named component
│   │   │   ├── bookings.js  [WP5] Bookings list, search, filters, master-detail
│   │   │   ├── calendar.js  [WP6] Calendar view
│   │   │   ├── customers.js  [WP7] Customers list and detail
│   │   │   ├── demo.js  [WP8] Demo tools view
│   │   │   ├── insights.js  [WP7] Insights view
│   │   │   ├── messages.js  [WP8] Messages outbox view
│   │   │   ├── more.js  [WP8] More hub
│   │   │   ├── new.js  [WP6] New booking route wrapping BookingSheet (owner mode)
│   │   │   ├── settings.js  [WP8] Settings view
│   │   │   └── today.js  [WP4] Today view
│   │   ├── app.js  [WP2] Dashboard boot
│   │   ├── router.js  [WP2] parseHash, routeHref, navigate, useRoute, isImmersive
│   │   ├── routes.js  [WP2] ROUTES table
│   │   ├── shell.js  [WP2] Header, tab bar, sidebar, FAB, view loader
│   │   └── watcher.js  [WP2] New-booking announcements, title prefix
│   ├── landing/
│   │   ├── app.js  [WP3] Landing boot and page composition
│   │   ├── art.js  [WP3] BreakerArt and hero SVG components
│   │   ├── content.js  [WP3] Landing copy, reviews, FAQ, tile map
│   │   ├── footer.js  [WP3] Footer
│   │   ├── header.js  [WP3] Prototype strip + header
│   │   ├── hero.js  [WP3] Hero, live availability
│   │   ├── sections.js  [WP3] Trust, emergency, services, how, reviews, Dan + coverage, FAQ, final CTA
│   │   └── sticky-bar.js  [WP3] Mobile sticky action bar
│   ├── ui/
│   │   ├── boot.js  [WP2] bootApp: guarded store init, fatal screen, render
│   │   ├── button.js  [WP2] Button, IconButton
│   │   ├── display.js  [WP2] Icon, BrandMark, Chip, StatusPill, SampleTag, Card, Avatar, EmptyState, Stat, Banner, Skeleton, PageHeader, TextLink
│   │   ├── form.js  [WP2] Field, Input, Select, Textarea, Switch, Segmented, Stepper
│   │   ├── hooks.js  [WP2] useStore, useNow, useMediaQuery, useBrand
│   │   ├── icons.js  [WP2] Icon path data (generated)
│   │   ├── index.js  [WP2] Barrel re-exporting the whole UI kit
│   │   ├── load-css.js  [WP2] loadCss(href)
│   │   ├── notice.js  [WP2] PrototypeNotice
│   │   ├── sheet.js  [WP2] Sheet, ConfirmDialog
│   │   ├── theme.js  [WP2] ThemeToggle, getTheme, setThemeChoice, applyTheme, initTheme
│   │   ├── toast.js  [WP2] toast, dismissToast, showUndoToast, ToastHost
│   │   ├── util.js  [WP2] cx, uid, copyText, pageHref, pageTarget, focusTitle
│   │   └── whatsapp.js  [WP2] WhatsAppBubble, PhoneMock
│   └── vendor/
│       └── preact-htm.js  [WP2] Vendored Preact + htm (pre-existing, never edit)
├── scripts/
│   ├── gen-icons.mjs  [WP2] One-off: writes js/ui/icons.js from lucide-static
│   └── gen-png.mjs  [WP2] One-off: renders PNG icons from logo-mark.svg with Playwright
├── tests/
│   ├── e2e/
│   │   ├── flows.mjs  [WP0] Flows F1 to F20
│   │   ├── lib.mjs  [WP0] E2E helpers: loadDeps(), launch(), static server (with --prefix), page helpers
│   │   └── run.mjs  [WP0] E2E runner (static server, browser, flows)
│   ├── qa/
│   │   ├── axe.mjs  [WP0] Q3
│   │   ├── basics.mjs  [WP0] Q8, Q9
│   │   ├── contrast.mjs  [WP0] Q4
│   │   ├── grep.mjs  [WP0] Q10
│   │   ├── keyboard.mjs  [WP0] Q7
│   │   ├── network.mjs  [WP0] Q5, Q6
│   │   ├── overflow.mjs  [WP0] Q1
│   │   ├── run.mjs  [WP0] Runs all QA gates
│   │   ├── screens.mjs  [WP0] Screenshots (15.4)
│   │   └── targets.mjs  [WP0] Q2
│   └── unit/
│       ├── availability.test.mjs  [WP1] Unit tests for availability
│       ├── clock.test.mjs  [WP1] Unit tests for clock
│       ├── dates.test.mjs  [WP1] Unit tests for dates
│       ├── format.test.mjs  [WP1] Unit tests for format
│       ├── ics.test.mjs  [WP1] Unit tests for ics
│       ├── messages.test.mjs  [WP1] Unit tests for messages
│       ├── seed.test.mjs  [WP1] Unit tests for seed
│       ├── selectors.test.mjs  [WP1] Unit tests for selectors
│       └── store.test.mjs  [WP1] Unit tests for store
├── .nojekyll  [WP0] Disable Jekyll on GitHub Pages
├── README.md  [WP0] Run, demo, rebrand, deploy and test instructions
├── dashboard.html  [WP2] Owner dashboard entry: head boilerplate, #app, boot module
├── index.html  [WP3] Customer landing page entry: head boilerplate, #app, boot module
├── manifest.webmanifest  [WP2] Web manifest, metadata only (display: browser)
└── vercel.json  [WP0] Static deploy config for deploying this folder alone
```

**Ownership by package** (every file above appears in exactly one row; counts in brackets):

| WP | Owns |
|---|---|
| WP0 Integration and QA [17] | `README.md`, `vercel.json`, `.nojekyll`, `docs/BUILD-CONTRACT.md`, `tests/e2e/run.mjs`, `tests/e2e/lib.mjs`, `tests/e2e/flows.mjs`, `tests/qa/run.mjs`, `tests/qa/overflow.mjs`, `tests/qa/targets.mjs`, `tests/qa/axe.mjs`, `tests/qa/contrast.mjs`, `tests/qa/network.mjs`, `tests/qa/keyboard.mjs`, `tests/qa/basics.mjs`, `tests/qa/grep.mjs`, `tests/qa/screens.mjs` |
| WP1 Core data layer [19] | `js/core/clock.js`, `js/core/dates.js`, `js/core/config.js`, `js/core/format.js`, `js/core/availability.js`, `js/core/messages.js`, `js/core/ics.js`, `js/core/seed.js`, `js/core/store.js`, `js/core/selectors.js`, `tests/unit/clock.test.mjs`, `tests/unit/dates.test.mjs`, `tests/unit/format.test.mjs`, `tests/unit/availability.test.mjs`, `tests/unit/messages.test.mjs`, `tests/unit/ics.test.mjs`, `tests/unit/seed.test.mjs`, `tests/unit/store.test.mjs`, `tests/unit/selectors.test.mjs` |
| WP2 UI foundation [38] | `dashboard.html`, `manifest.webmanifest`, `css/fonts.css`, `css/tokens.css`, `css/base.css`, `css/components.css`, `css/dashboard.css`, `fonts/bricolage-grotesque-latin-wght-normal.woff2`, `fonts/figtree-latin-wght-normal.woff2`, `fonts/LICENSE-OFL.txt`, `img/logo-mark.svg`, `img/favicon.svg`, `img/icon-192.png`, `img/icon-512.png`, `img/apple-touch-icon.png`, `scripts/gen-icons.mjs`, `scripts/gen-png.mjs`, `js/vendor/preact-htm.js`, `js/ui/index.js`, `js/ui/icons.js`, `js/ui/util.js`, `js/ui/hooks.js`, `js/ui/display.js`, `js/ui/button.js`, `js/ui/form.js`, `js/ui/sheet.js`, `js/ui/toast.js`, `js/ui/whatsapp.js`, `js/ui/notice.js`, `js/ui/theme.js`, `js/ui/boot.js`, `js/ui/load-css.js`, `js/dashboard/app.js`, `js/dashboard/shell.js`, `js/dashboard/router.js`, `js/dashboard/routes.js`, `js/dashboard/watcher.js`, `js/dashboard/views/stub.js` |
| WP3 Landing and booking flow [23] | `index.html`, `css/landing.css`, `css/booking.css`, `img/hero-wiring.svg`, `img/dan-avatar.svg`, `js/landing/app.js`, `js/landing/content.js`, `js/landing/header.js`, `js/landing/hero.js`, `js/landing/sections.js`, `js/landing/footer.js`, `js/landing/sticky-bar.js`, `js/landing/art.js`, `js/booking/booking-sheet.js`, `js/booking/nav.js`, `js/booking/service-step.js`, `js/booking/when-step.js`, `js/booking/day-picker.js`, `js/booking/details-step.js`, `js/booking/emergency-step.js`, `js/booking/confirmation.js`, `js/booking/manage.js`, `js/booking/draft.js` |
| WP4 Today [2] | `css/today.css`, `js/dashboard/views/today.js` |
| WP5 Bookings, detail, job actions [4] | `css/bookings.css`, `js/dashboard/views/bookings.js`, `js/dashboard/views/booking-detail.js`, `js/dashboard/shared/job-actions.js` |
| WP6 Calendar and New booking [3] | `css/calendar.css`, `js/dashboard/views/calendar.js`, `js/dashboard/views/new.js` |
| WP7 Customers, Insights, About [4] | `css/insights.css`, `js/dashboard/views/customers.js`, `js/dashboard/views/insights.js`, `js/dashboard/views/about.js` |
| WP8 Settings, Messages, Demo tools [5] | `css/settings.css`, `js/dashboard/views/more.js`, `js/dashboard/views/settings.js`, `js/dashboard/views/messages.js`, `js/dashboard/views/demo.js` |

Folders that do not appear above stay empty or absent. An agent must not create files outside the table. If a package genuinely needs an extra file, name it with its own prefix inside a folder it already owns files in and say so in the file header; WP0 will adopt it.

### 6.3 Work packages

| WP | Name | One-line scope | Depends on |
|---|---|---|---|
| WP1 | Core data layer | `js/core/*` (clock, dates, config, format, availability, messages, ics, seed, store, selectors) and the unit tests. Pure and Node-testable. | none |
| WP2 | UI foundation | All shared CSS (fonts, tokens, base, components, dashboard shell), UI kit and icons, theme, dashboard shell + router + lazy view loader + new-booking watcher, `dashboard.html`, brand assets, manifest, PNG icons. | none (starts the same time as WP1; codes against the store API in section 8) |
| WP3 | Landing and booking flow | `index.html`, all landing sections, the booking sheet (customer and owner modes), emergency path, confirmation, Manage page, `.ics` download. | WP1, WP2 |
| WP4 | Today | `js/dashboard/views/today.js` and `css/today.css`. | WP1, WP2, WP5 (job actions) |
| WP5 | Bookings, detail, job actions | Bookings inbox + search + filters, booking detail, shared job-action sheets (`js/dashboard/shared/job-actions.js`). | WP1, WP2 |
| WP6 | Calendar and New booking | Calendar view (week strip, window rows, block / unblock / day off), New booking route wrapping the booking flow in owner mode. | WP1, WP2, WP3 (`BookingSheet`) |
| WP7 | Customers, Insights, About | Derived customer list/detail, Insights (collected, owed, nudge, mark paid, weekly bars), About "What's real". | WP1, WP2, WP5 (`PaidButton`) |
| WP8 | Settings, Messages, Demo tools, More | More hub, Settings (business, services, hours, rules, theme), Messages outbox, Demo tools. | WP1, WP2 |
| WP0 | Integration and QA | README, deploy files, e2e flows, QA scripts, contract-conformance check, drift fixes. | WP1-WP8 merged |

**Dependency order.**

1. **Phase 1 (parallel): WP1 and WP2.** Both code against this contract only. WP2 imports the store API by name (section 8) and must tolerate WP1 files not existing yet until WP1 lands; it MAY develop against a throwaway in-scratchpad stub of `js/core/*` but must never commit a stub into `electrician/`.
2. **Phase 2 (parallel): WP3, WP4, WP5, WP6, WP7, WP8.** Start when Phase 1 is merged, so they import REAL core and ui modules. Cross-package imports among them are listed below and are coded against the exact signatures in section 11.5 and 12; if the owner file is not yet present, the importer tests with a scratchpad stand-in and never commits it.
3. **Phase 3: WP0** merges, runs unit + e2e + QA, fixes drift, writes README, deploys.

**Cross-package imports (the complete list; nothing else crosses a package boundary except `core/*` and `ui/*`)**

| Importer | Imports | From | Owner |
|---|---|---|---|
| WP4 `today.js` | `JobActionBar`, `NeedsYouActions` | `../shared/job-actions.js` | WP5 |
| WP7 `insights.js` | `PaidButton` | `../shared/job-actions.js` | WP5 |
| WP6 `new.js` | `BookingSheet` | `../../booking/booking-sheet.js` | WP3 |
| WP5 `booking-detail.js`, WP6 `calendar.js` | none from other feature packages | | |
| Everyone | `js/core/*.js` named exports (section 8-10), `js/ui/index.js` barrel (section 12) | | WP1, WP2 |

**WP3 build order and triage (WP3 is the longest pole: 23 files).** Build in this order and stop adding polish when time runs out: (1) `nav.js`, `booking-sheet.js`, `service-step.js`, `when-step.js`, `day-picker.js`, `details-step.js`, `confirmation.js`, `draft.js`; (2) `index.html`, `app.js`, `header.js`, `hero.js`, `sticky-bar.js`; (3) the remaining landing sections (`sections.js`, `footer.js`, `content.js`); (4) `emergency-step.js`; (5) `manage.js`; (6) SHOULDs: `BreakerArt` animation (a static final state is acceptable first), `hero-wiring.svg`, static pre-render S8. Items 1 to 3 plus the confirmation already deliver the whole demo script in 1.2.

**Definition of done (every package).** (1) Every export in this contract for your files exists with the exact name and signature. (2) Every `data-testid` for your elements in section 14 exists. (3) Verified in Chromium at 320x568, 375x812, 768x1024, 1100x800 and 1440x900, light and dark: no horizontal overflow, every tap target >= 44px, no console errors, no network requests off-site. (4) You ran axe-core on your screens in light and dark with zero serious/critical violations (Playwright and axe-core are not in the repo: install `playwright-core@1.56.1` and `axe-core@4.10.2` into your own scratchpad with `npm i --prefix <scratchpad>/qa-deps` and set `QA_DEPS_DIR` to it, 6.1). (5) No hard-coded dates, no `Date.now()`, no `innerHTML`. (6) Header comment in every file. (7) Your final message lists files written and any `CONTRACT-GAP` / `CROSS-PKG` notes.

**What each package ships, in detail**

| WP | Detail |
|---|---|
| WP1 | All of sections 7 (data), 8 (store API), 9 (availability), 10 (messages and ics), seed (3.4, 8.7). Unit tests per 8.9. |
| WP2 | Sections 4, 5 (CSS and tokens), 12 (UI kit), 11 (router, shell, loader, watcher), 16.1 head boilerplate for `dashboard.html`, `manifest.webmanifest`, brand SVGs, PNGs, icon generation, `PrototypeNotice`, `ThemeToggle`, `bootApp`. `css/dashboard.css` styles the shell AND defines the page-level layout helpers used by views (`db-page`, `db-grid`, `db-section`, 12.2). |
| WP3 | Section 13.1 (landing), 13.2 (booking flow), 13.3 (confirmation, Manage), `index.html` head per 16.1, `.ics` button wiring (uses `downloadIcs` from core). |
| WP4 | Section 13.4 (Today). |
| WP5 | Section 13.5 (Bookings, detail), 13.6 (job actions). |
| WP6 | Section 13.7 (Calendar), 13.8 (New booking). |
| WP7 | Section 13.9 (Customers), 13.10 (Insights), 13.11 (About). |
| WP8 | Section 13.12 (More), 13.13 (Settings), 13.14 (Messages), 13.15 (Demo tools). |

---

## 7. DATA MODEL

JSDoc-style shapes. Every object is plain JSON (no Dates, no Maps) so it round-trips through `localStorage`.

### 7.1 Primitive types

```js
/** @typedef {string} DayKey   'YYYY-MM-DD' local calendar date */
/** @typedef {string} Stamp    'YYYY-MM-DDTHH:mm' local date-time, no timezone, no seconds */
/** @typedef {0|1|2|3} WindowId */
/** @typedef {'new'|'confirmed'|'on_the_way'|'done'|'cancelled'} BookingStatus */
/** @typedef {'website'|'phone'|'whatsapp'|'referral'} BookingSource */
/** @typedef {'cash'|'card'|'bank'} PaidMethod */
/** @typedef {'fault'|'eicr'|'consumer'|'sockets'|'ev'|'rewire'|'emergency'} ServiceId */
/** @typedef {'flat'|'house'|'large'} VariantId */
/** @typedef {'auto'|'light'|'dark'} ThemeChoice */
```

### 7.2 Windows (constant, `config.js`)

```js
export const WINDOWS = [
  { id: 0, start: '08:00', end: '10:00', startMin: 480, endMin: 600,  label: '8–10am',   arrive: 'between 8 and 10am',  short: '8–10' },
  { id: 1, start: '10:00', end: '12:00', startMin: 600, endMin: 720,  label: '10am–12',  arrive: 'between 10am and 12', short: '10–12' },
  { id: 2, start: '13:00', end: '15:00', startMin: 780, endMin: 900,  label: '1–3pm',    arrive: 'between 1 and 3pm',   short: '1–3' },
  { id: 3, start: '15:00', end: '17:00', startMin: 900, endMin: 1020, label: '3–5pm',    arrive: 'between 3 and 5pm',   short: '3–5' }
];
export const LUNCH = { start: '12:00', end: '13:00' };  // never bookable
export const HALF_DAY_STARTS = [0, 2];                    // morning = windows 0+1, afternoon = windows 2+3
```

Labels use the en dash `–` (U+2013).

### 7.3 Settings

```js
/**
 * @typedef {Object} Business
 * @property {string} name            'Voltmere Electrical'
 * @property {string} shortName       'Voltmere'
 * @property {string} descriptor      'Electrical'
 * @property {string} ownerFirstName  'Dan'
 * @property {string} ownerFullName   'Dan Mercer'
 * @property {string} tagline         'Local electrician. Booked in 60 seconds.'
 * @property {string} phone           '07700 900412' (display; digits are derived with toWaDigits)
 * @property {string} email           'dan@voltmere.example'
 * @property {string} areaName        'Marlbury'
 * @property {string} areaText        'Marlbury and 15 miles around'
 * @property {string[]} towns         ['Marlbury','Thornley Green','Hollin Cross','Wexby','Ashgrove']
 * @property {string[]} coveredOutward  ['MB1',...,'MB10']
 * @property {string[]} edgeOutward     ['MB11','MB12','MB13']
 * @property {string} schemeLine      'Competent person scheme, reg. no. 000000 (sample)'
 * @property {string} insuranceLine   '£2m public liability cover (sample)'
 *
 * @typedef {Object} Service
 * @property {ServiceId} id
 * @property {string} name            e.g. 'EICR safety report'
 * @property {string} description     one-line description shown on the landing page
 * @property {string} icon            icon name from 4.9
 * @property {'from'|'fixed'|'by_size'|'free'} priceType   'by_size' = variants; 'free' = price 0
 * @property {number} price           headline GBP number ('From £75'; for by_size the lowest variant)
 * @property {string} priceNote       e.g. 'First hour included, then £55 an hour'
 * @property {{id:VariantId,label:string,price:number}[]} variants   [] unless by_size
 * @property {VariantId|null} defaultVariantId
 * @property {0|1|2} blocks           windows occupied: 1 single, 2 half-day, 0 = emergency (never slot-booked)
 * @property {number} durationMin     blocks*120 (emergency: 0)
 * @property {string} durationLabel   'About 1–2 hrs'
 * @property {string} tag             'Most booked' | 'Landlords' | 'Certificate included' | ''
 * @property {boolean} active         false hides it from the landing page and pickers
 * @property {boolean} [urgent]       true only for 'emergency'
 *
 * @typedef {Object} DayOff   @property {string} id  @property {DayKey} date  @property {string} label
 *
 * @typedef {Object} Settings
 * @property {Business} business
 * @property {number[][]} hours          index = JS weekday (0 Sunday ... 6 Saturday); value = open WindowIds
 *                                       default [[], [0,1,2,3], [0,1,2,3], [0,1,2,3], [0,1,2,3], [0,1,2,3], [0,1]]
 * @property {number} leadMinutes        90   minimum notice: a window starting sooner than now + this is 'too_soon'
 * @property {number} maxDaysAhead       14   horizon: bookable days are today .. today + maxDaysAhead - 1
 * @property {DayOff[]} daysOff          whole-day closures ('Take tomorrow off', holidays)
 * @property {DayKey[]} fullDays         days marked "Full": no NEW customer bookings, existing jobs stay
 * @property {boolean} autoConfirm       true  normal bookings in the covered zone confirm instantly
 * @property {boolean} takingEmergencies true  false hides the emergency request path on the landing page
 * @property {boolean} remindersOn       true  schedule the day-before reminder
 * @property {Service[]} services
 * @property {Partial<Record<TemplateKind,string>>} templates   overrides; {} by default (editing UI is WON'T)
 * @property {ThemeChoice} theme         mirrors localStorage 'vm_theme'
 * @property {string} demoPhoneDigits    '' or digits such as '447700900231'; replaces every wa.me recipient (10.5)
 */
```

There is deliberately NO slot-length, buffer or travel-time setting: the slot length is the fixed 120-minute arrival window (`WINDOWS`), and arrival windows already absorb travel (section 9.1).

**Default services (`makeDefaultSettings().services`, order is display order on the landing page)**

| id | name | description (landing) | icon | priceType | price | priceNote | variants | blocks | durationLabel | tag |
|---|---|---|---|---|---|---|---|---|---|---|
| `fault` | Fault finding and repairs | Fuse box keeps tripping? Dead sockets? Flickering lights? Found and fixed, usually on the first visit. | wrench | from | 75 | First hour included, then £55 an hour | none | 1 | About 1–2 hrs | Most booked |
| `eicr` | EICR safety report | The certificate landlords need every 5 years and buyers ask for. Digital report the same day. | clipboard-check | by_size | 150 | Fixed price by property size | `flat` Flat 150; `house` House, 2–3 bed 195; `large` House, 4+ bed 260 (default `house`) | 2 | About 3–4 hrs | Landlords |
| `consumer` | New fuse box (consumer unit) | 18th Edition unit fully fitted and tested, certificate included. | toggle-right | from | 540 | Certificate included | none | 2 | About half a day | Certificate included |
| `sockets` | Sockets, switches and lights | Extra sockets, downlights, outdoor lights, USB points. Neat, with making good. | lightbulb | from | 85 | First hour included, then £55 an hour | none | 1 | About 1–2 hrs | |
| `ev` | EV charger fitting | 7kW home charger supplied and fitted with commissioning certificate. | plug-zap | from | 895 | Charger supplied and fitted | none | 2 | About half a day | |
| `rewire` | Rewire survey | Free survey visit and a written quote within 48 hours. | file-text | free | 0 | Free visit, written quote | none | 1 | About 45 mins | |
| `emergency` | Emergency visit | Power out or something unsafe? Dan aims to be with you within 2 hours. | siren | from | 95 | Includes the first hour | none | 0 | As soon as possible | |

(Emergency description interpolates `PROMISES.emergencyArrivalHours` and `business.ownerFirstName`. It is stored once at creation and is NOT rendered anywhere in the UI (the landing emergency copy is L5, built from live values), so a later rebrand can never leave a stale name on screen. A service with `priceType: 'free'` (`rewire`) has no price input in Settings and `servicePriceLabel` returns `Free`.)

### 7.4 Booking, Block, Message, derived Customer, State

```js
/**
 * @typedef {Object} HistoryEntry
 * @property {Stamp} at
 * @property {'created'|'confirmed'|'declined'|'on_the_way'|'done'|'paid'|'unpaid'|'cancelled'|'rescheduled'|'note'|'message'} event
 * @property {'customer'|'owner'|'system'} by
 * @property {string} [note]
 *
 * @typedef {Object} Booking
 * @property {string} id                 'bk_' + base36 (makeId('bk'))
 * @property {string} ref                'VM-1043' ('VM-' + 4 digits, unique, from state.refSeq)
 * @property {Stamp} createdAt
 * @property {ServiceId} serviceId
 * @property {string} serviceName        snapshot at creation ('EICR safety report')
 * @property {VariantId|null} variantId
 * @property {string} variantLabel       '' or 'House, 2–3 bed'
 * @property {Stamp} start               first window's start (e.g. '2026-10-24T08:00'). URGENT: the request time.
 * @property {number} durationMin        120 | 240 | 0 (urgent jobs hold no window)
 * @property {BookingStatus} status
 * @property {boolean} urgent            emergency request; never auto-confirmed; never occupies a window
 * @property {string[]} emergencyReasons ids from EMERGENCY_REASONS ([] unless urgent)
 * @property {number|null} etaMinutes    set by acceptEmergency / markOnTheWay
 * @property {Stamp|null} etaAt          now + etaMinutes at that moment
 * @property {{name:string, phone:string, email:string}} customer   phone stored in display form '07700 900231'
 * @property {{line1:string, postcode:string}} address              postcode stored normalised 'MB3 4QP'
 * @property {string} notes              customer's note, verbatim
 * @property {string} internalNotes      owner's private note
 * @property {BookingSource} source
 * @property {number} quotedPrice        GBP integer at booking time
 * @property {number|null} finalPrice    set on completion
 * @property {boolean} paid
 * @property {PaidMethod|null} paidMethod
 * @property {Stamp|null} paidAt
 * @property {boolean} seenByOwner       false for website bookings until the owner opens them or taps "Mark all seen"
 * @property {boolean} reviewRequested   true once a review request message was logged
 * @property {'customer'|'owner'|null} cancelledBy
 * @property {string} cancelReason       '' | 'declined' | 'Customer asked' | "Can't make it" | 'Duplicate' | 'Other' | free text
 * @property {boolean} seed              true for generated demo data
 * @property {HistoryEntry[]} history
 *
 * @typedef {Object} Block   a single blocked window
 * @property {string} id  @property {DayKey} date  @property {WindowId} windowId
 * @property {string} label  e.g. 'Dentist', 'Van MOT'
 * @property {string|null} groupId   shared by blocks created together (whole day / until date)
 * @property {boolean} seed
 *
 * @typedef {Object} Message   one simulated WhatsApp message
 * @property {string} id                   'msg_' + base36
 * @property {Stamp} at                    when it was logged
 * @property {Stamp|null} sendAt           scheduled send time; null = sent immediately at `at`
 * @property {string|null} bookingId
 * @property {'owner'|'customer'} to
 * @property {string} toName
 * @property {string} toPhone              display form
 * @property {'whatsapp'} channel
 * @property {TemplateKind} kind
 * @property {string} body                 final text, placeholders already filled, may contain *bold*
 * @property {number} seq                 monotonic per store: `meta.msgSeq` + 1 at insertion. Stamps only have minute precision (and the clock may be frozen), so `seq` is the tie-break when `at` is equal and the basis of 'unread' (8.6)
 * @property {true} simulated
 * @property {boolean} seed
 *
 * @typedef {Object} Customer              DERIVED by selectCustomers(); never stored
 * @property {string} key                  phone digits '447700900231' (the identity)
 * @property {string} name                 name on the most recent booking
 * @property {string} phone                display form
 * @property {string} email
 * @property {string[]} bookingIds         newest first
 * @property {number} jobs                 count of non-cancelled bookings
 * @property {number} cancelled
 * @property {number} totalValue           sum of finalPrice for done bookings
 * @property {number} owed                 sum of finalPrice for done & !paid
 * @property {Stamp|null} lastJobAt        start of the latest done booking
 * @property {Stamp|null} nextJobAt        start of the earliest upcoming new/confirmed booking
 * @property {{line1:string,postcode:string}[]} addresses   distinct, newest first
 * @property {string[]} tags               subset of ['Landlord','Repeat']
 *   'Repeat' = jobs >= 2.  'Landlord' = 2+ distinct addresses among non-cancelled eicr bookings, or any booking source 'phone' whose note contains 'landlord' (case-insensitive).
 *
 * @typedef {Object} State
 * @property {1} v                         SCHEMA_VERSION
 * @property {DayKey} seededFor            local day the seed was generated for
 * @property {number} refSeq               next booking ref number (starts 1043 after seeding)
 * @property {Settings} settings
 * @property {Booking[]} bookings
 * @property {Block[]} blocks
 * @property {Message[]} messages
 * @property {{ rev: number, msgSeq: number, messagesSeenSeq: number, simCursor: number }} meta   msgSeq = highest `seq` handed out; messagesSeenSeq = value of msgSeq when the owner last opened Messages; simCursor = simulator pool position
 */
```

**Reference to `TemplateKind`** is defined in 10.1. `HistoryEntry` events `message` are written (note = the `KIND_LABELS` label) for quick messages, payment reminders and review requests only, not for automated messages.

### 7.5 Status vocabulary and ALLOWED TRANSITIONS

UI labels: `new` "New request", `confirmed` "Confirmed", `on_the_way` "On the way", `done` "Done" (shown "To collect" while `!paid`), `cancelled` "Cancelled". "Declined" is not a status: declining is `new -> cancelled` with `cancelledBy: 'owner'`, `cancelReason: 'declined'`.

| Store function | From | To | Allowed by | Messages written | Other effect |
|---|---|---|---|---|---|
| `createBooking` (non-urgent, auto-confirm applies) | none | `confirmed` | customer, owner | owner alert (customer-made only) + `customer_confirmed` + scheduled `customer_reminder` | |
| `createBooking` (non-urgent, needs approval) | none | `new` | customer | owner alert + `customer_received` | approval reasons: auto-confirm off, or zone is `edge`/`outside` |
| `createBooking` (urgent) | none | `new` | customer | `owner_emergency` + `customer_emergency_received` | `durationMin: 0`, never a window |
| `createBooking` (`asOwner: true`) | none | `confirmed` | owner | `customer_confirmed` + reminder, only when `notifyCustomer` | `seenByOwner: true` |
| `confirmBooking` | `new` | `confirmed` | owner | `customer_confirmed` + scheduled reminder | non-urgent only |
| `acceptEmergency` | `new` (urgent) | `confirmed` | owner | `customer_emergency_accepted` | sets `etaMinutes`, `etaAt` |
| `declineBooking` | `new` | `cancelled` | owner | `customer_declined` | frees the window of a non-urgent booking |
| `markOnTheWay` | `confirmed` | `on_the_way` | owner | `customer_on_my_way` | sets `etaMinutes`, `etaAt` |
| `completeBooking` | `confirmed`, `on_the_way` | `done` | owner | `customer_completed`; when `sendReview`, a scheduled `customer_review_request` and `reviewRequested: true` | sets `finalPrice`; optionally `paid`, `paidMethod`, `paidAt` |
| `cancelBooking` by owner | `new`, `confirmed`, `on_the_way` | `cancelled` | owner | `customer_cancelled` when `notify` | frees windows |
| `cancelBooking` by customer | `new`, `confirmed` (and not within `PROMISES.freeChangeHours` of start) | `cancelled` | customer | `owner_customer_cancelled` | frees windows |
| `rescheduleBooking` by owner | `new`, `confirmed` (non-urgent) | same | owner | `customer_rescheduled` when `notify` | re-validated with owner mode |
| `rescheduleBooking` by customer | `new`, `confirmed` (not within 24h of start) | same | customer | `owner_customer_rescheduled` | re-validated with customer mode |
| `markPaid` | `done` | `done` (`paid: true`) | owner | none | sets `paidMethod`, `paidAt` |
| `markUnpaid` | `done` | `done` (`paid: false`) | owner | none | used by Undo |

`done` and `cancelled` are terminal for `status`. Any other call returns `{ ok: false, reason: 'bad_transition' }`. `undo(token)` reverses a mutation (8.3).

**The change cutoff.** `isWithinChangeCutoff(booking, nowStamp)` is true when the start is less than `PROMISES.freeChangeHours` away, INCLUDING a start that is already in the past (so an urgent request, whose `start` is its request time, is always 'close' and the customer is told to call). A customer-made `cancelBooking` or `rescheduleBooking` returns `{ ok: false, reason: 'not_allowed' }` inside the cutoff, for urgent bookings, and for any status other than `new` / `confirmed`. Owner-made calls ignore the cutoff.

### 7.6 Time handling (exact)

1. **Local naive strings only.** Never store UTC, epoch ms or ISO with `Z`. `DayKey` and `Stamp` as defined. Stamps compare correctly with `<` and `>` as strings.
2. **Day keys to Date:** `parseDayKey(key)` returns a Date at **12:00 local** on that day (noon avoids DST edge cases). `addDays(key, n)` does `d.setDate(d.getDate() + n)` on that noon Date and re-formats. Never add milliseconds. This matters: clocks go back on Sun 25 Oct 2026.
3. **Week starts Monday.** `weekStart(key)` returns the Monday on or before `key`. `weekDates(key)` returns 7 keys Monday to Sunday.
4. **Weekday numbers** are JS `getDay()` (0 = Sunday). `settings.hours[weekday]`.
5. **Now:** `now()` from `clock.js` returns a Date. `nowStamp()` returns the Stamp. `todayKey()` the DayKey. Override for tests/screenshots: URL query `?now=YYYY-MM-DDTHH:mm` (optionally `&freeze=1`). Without `freeze` the override keeps ticking from that instant; with `freeze=1` it never moves. When overridden the Demo tools screen shows `Clock override active: <stamp>`.
6. **Minute arithmetic** uses `minutesBetween(a, b)` on Stamps via local Date objects, so a 90-minute lead time is 90 real minutes even across a clock change.
7. **Formatting uses hand-written arrays** (`DAY_SHORT`, `MONTH_SHORT`), never `Intl`: `fmtDayShort('2026-10-24')` is `Sat 24 Oct`.
8. **`diffDays(a, b)`** counts whole days from `Date.UTC(y, m - 1, d)` of each key divided by a private `MS_PER_DAY = 24 * 60 * 60 * 1000` declared in `dates.js` (UTC has no clock changes, so the 25-hour day on 25 October 2026 still counts as 1). This is the only place a milliseconds-per-day constant may exist; the literal `86400000` stays forbidden (Q10).
9. **Time zone.** Unit tests run under `TZ=Europe/London`; every Playwright context uses `timezoneId: 'Europe/London'` and `locale: 'en-GB'` (14.3). The app uses the browser's local zone; no zone name is ever stored.

### 7.7 Storage keys and schema version

| Key | Storage | Content |
|---|---|---|
| `vm_state_v1` | `localStorage` | The whole `State` as JSON. |
| `vm_theme` | `localStorage` | `'auto'`, `'light'` or `'dark'` (absent = auto). Read by the inline head script. |
| `vm_draft_v1` | `sessionStorage` | The in-progress customer booking draft (13.2). Cleared on success. |
| `vm_boot_fail` | `sessionStorage` | `'1'` after a failed boot; a second failed boot in the same tab calls `resetDemo({ keepSettings: false })`. |

Every storage access is wrapped in `try/catch`. If `localStorage` throws or is missing, the store runs in memory for the page lifetime, `getStorageStatus()` returns `{ ok: false, mode: 'memory' }`, and the Demo tools screen shows `Saving is blocked in this browser mode, so bookings made on the website will not appear on the dashboard.` Cross-page sync then degrades silently.

**Theme has one source of truth.** `vm_theme` is authoritative (the inline head script reads it before first paint). `settings.theme` is only a mirror written by `setTheme` so that the OTHER page notices the change: `initTheme()` subscribes to the store and re-applies `getTheme()` (which reads `vm_theme`) whenever the state changes, so flipping the theme on one page flips the other page live.

**Schema version and migration rule.** `SCHEMA_VERSION = 1`. On load: parse JSON; if parsing fails, or `v` is missing, or `v > SCHEMA_VERSION`, discard and reseed. If `v < SCHEMA_VERSION`, run `MIGRATIONS[v]` functions in order (none exist yet; an empty map). If a migration is missing, discard and reseed (it is demo data). A future `v2` writes to `vm_state_v2` and leaves `vm_state_v1` untouched.

### 7.8 Other constants (`config.js`, exact)

```js
export const SCHEMA_VERSION = 1;
export const STORAGE_KEYS = { state: 'vm_state_v1', theme: 'vm_theme', draft: 'vm_draft_v1', bootFail: 'vm_boot_fail' };
export const SITE_BASE_URL = new URL('../../', import.meta.url).href;   // the folder holding index.html, with trailing slash
export const STATUSES = ['new', 'confirmed', 'on_the_way', 'done', 'cancelled'];
export const STATUS_LABELS = { new: 'New request', confirmed: 'Confirmed', on_the_way: 'On the way', done: 'Done', cancelled: 'Cancelled' };
export const TRANSITIONS = { new: ['confirmed', 'cancelled'], confirmed: ['on_the_way', 'done', 'cancelled'], on_the_way: ['done', 'cancelled'], done: [], cancelled: [] };
export const SOURCES = ['website', 'phone', 'whatsapp', 'referral'];
export const SOURCE_LABELS = { website: 'Website', phone: 'Phone', whatsapp: 'WhatsApp', referral: 'Word of mouth' };
export const PAID_METHODS = ['cash', 'card', 'bank'];
export const PAID_METHOD_LABELS = { cash: 'Cash', card: 'Card', bank: 'Bank' };
export const EMERGENCY_REASONS = [
  { id: 'no_power', label: 'No power at all' },
  { id: 'burning', label: 'Burning smell or sparks' },
  { id: 'tripping', label: "Keeps tripping and won't reset" },
  { id: 'water', label: 'Water has got in' },
  { id: 'other', label: 'Something else' }
];
export const CANCEL_REASONS = [
  { id: 'customer', label: 'Customer asked' },
  { id: 'cannot', label: "Can't make it" },
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'other', label: 'Other' }
];
// TEMPLATE_KINDS: the 19 ids in 10.1, same order. makeDefaultSettings(): returns a fresh deep object per 7.3 and 3.1 on every call.
```

---

## 8. STORE API (`js/core/*`, owner WP1)

Everything in `js/core/` is **pure ES modules with no Preact and no DOM imports** so Node can unit-test it. `window`, `localStorage`, `location` are touched only inside functions, behind `typeof` guards and `try/catch`.

### 8.1 Module map

| Module | Exports |
|---|---|
| `clock.js` | `now`, `nowStamp`, `todayKey`, `isClockOverridden`, `clockOverrideStamp`, `clockQuery`, `setClock` |
| `dates.js` | `DAY_SHORT`, `DAY_LONG`, `MONTH_SHORT`, `MONTH_LONG`, `dateKey`, `parseDayKey`, `addDays`, `diffDays`, `weekdayOf`, `weekStart`, `weekDates`, `monthKeyOf`, `toStamp`, `parseStamp`, `stampDay`, `stampTime`, `makeStamp`, `addMinutes`, `minutesBetween`, `fmtDayShort`, `fmtDayLong`, `fmtRelativeDay`, `fmtClock`, `fmtTimeAgo`, `fmtWindow` |
| `config.js` | `SCHEMA_VERSION`, `STORAGE_KEYS`, `SITE_BASE_URL`, `WINDOWS`, `LUNCH`, `HALF_DAY_STARTS`, `STATUSES`, `STATUS_LABELS`, `TRANSITIONS`, `PROMISES`, `SOURCES`, `SOURCE_LABELS`, `PAID_METHODS`, `PAID_METHOD_LABELS`, `EMERGENCY_REASONS`, `CANCEL_REASONS`, `TEMPLATE_KINDS`, `makeDefaultSettings` |
| `format.js` | `gbp`, `normalisePhone`, `isUkMobile`, `toWaDigits`, `normaliseDemoPhone`, `normalisePostcode`, `isValidPostcode`, `outwardCode`, `postcodeZone`, `validateName`, `validatePhone`, `validatePostcode`, `validateLine1`, `initials`, `firstName`, `hashHue`, `makeId`, `plural` |
| `availability.js` | `getDaySlots`, `getDayStatus`, `getDayLoad`, `getBookableDays`, `nextFreeSlot`, `nextFreeSlots`, `isSlotFree`, `occupiedBy`, `bookingWindowIds`, `bookingEndStamp`, `bookingWindowLabel`, `bookingWhen`, `windowIdFromStart`, `slotHuman`, `describeHours` |
| `messages.js` | `DEFAULT_TEMPLATES`, `PLACEHOLDERS`, `KIND_LABELS`, `renderTemplate`, `buildContext`, `buildMessage`, `reminderSendAt`, `messageIsScheduled`, `bubbleActions`, `waLink`, `waShareLink`, `telLink`, `smsLink`, `mailtoLink`, `mapsLink` |
| `ics.js` | `buildIcs`, `icsFilename`, `downloadIcs` |
| `seed.js` | `buildSeed`, `SEED_CUSTOMERS`, `SAMPLE_CUSTOMER`, `SIM_POOL` |
| `store.js` | `initStore`, `getState`, `subscribe`, `syncFromStorage`, `getStorageStatus`, `createBooking`, `confirmBooking`, `acceptEmergency`, `declineBooking`, `markOnTheWay`, `completeBooking`, `markPaid`, `markUnpaid`, `cancelBooking`, `rescheduleBooking`, `updateBooking`, `markSeen`, `markAllSeen`, `sendQuickMessage`, `sendPaymentNudge`, `sendReviewRequest`, `sendMessageNow`, `markMessagesSeen`, `addBlock`, `blockRange`, `removeBlock`, `removeBlockGroup`, `addDaysOff`, `removeDayOff`, `setDayFull`, `updateSettings`, `updateService`, `setTheme`, `setDemoPhone`, `resetDemo`, `simulateIncomingBooking`, `undo` (signatures in 8.3) |
| `selectors.js` | `selectBrand`, `selectServices`, `selectService`, `quotedPriceFor`, `servicePriceLabel`, `selectBookingById`, `selectBookingByRef`, `selectBookingsOn`, `selectNeedsYou`, `selectNextUp`, `selectUpcoming`, `selectOwed`, `selectOwedTotal`, `selectUnseenBookings`, `selectNextOpenDay`, `selectCustomers`, `selectCustomerByKey`, `customerKeyOf`, `selectRepeatInfo`, `selectMessages`, `selectUnreadMessageCount`, `selectInsights`, `isWithinChangeCutoff` (signatures in 8.6) |

### 8.1.1 Exact signatures for the modules that 8.1 lists by name only

Every package codes against these. Types are in 7.1 and 7.4. Defaults that read "now" come from `clock.js`.

**`dates.js`** (pure)

| Export | Signature and result |
|---|---|
| `DAY_SHORT`, `DAY_LONG`, `MONTH_SHORT`, `MONTH_LONG` | arrays indexed by JS weekday (0 = Sunday) or month (0 = January): `'Sat'`, `'Saturday'`, `'Oct'`, `'October'` |
| `dateKey(date)` | `Date` -> the `DayKey` of its LOCAL date |
| `parseDayKey(key)` | `DayKey` -> `Date` at 12:00 local (7.6) |
| `addDays(key, n)` | `DayKey` -> `DayKey`; `n` may be negative |
| `diffDays(a, b)` | whole days from `a` to `b`: `diffDays('2026-10-23', '2026-10-26') === 3`, negative when `b` is earlier (7.6 item 8) |
| `weekdayOf(key)` | 0 to 6 (JS numbering) |
| `weekStart(key)` / `weekDates(key)` | the Monday on or before `key` / the 7 keys Monday to Sunday |
| `monthKeyOf(keyOrStamp)` | `'2026-10'` |
| `toStamp(date)` / `parseStamp(stamp)` | `Date` -> `Stamp` (local, minute precision) / `Stamp` -> `Date` (local) |
| `stampDay(stamp)` / `stampTime(stamp)` | `DayKey` / `'HH:mm'` |
| `makeStamp(dayKey, 'HH:mm')` | `Stamp` |
| `addMinutes(stamp, n)` | `Stamp`, computed through a local `Date` (correct across a clock change) |
| `minutesBetween(a, b)` | integer real minutes from stamp `a` to stamp `b` (negative when `b` is earlier) |
| `fmtDayShort(key)` / `fmtDayLong(key)` | `'Sat 24 Oct'` / `'Saturday 24 October'` |
| `fmtRelativeDay(key, todayKeyStr = todayKey())` | `'Today'`, `'Tomorrow'`, `'Yesterday'`, otherwise `fmtDayShort(key)` |
| `fmtClock(stampOrDate)` | `'HH:mm'`, 24-hour |
| `fmtTimeAgo(stamp, nowStampStr = nowStamp())` | `'just now'` (under a minute, or in the future), `'12 min ago'`, `'3 h ago'` (under 24 hours), `'Yesterday'`, otherwise `fmtDayShort` of its day |
| `fmtWindow(windowId)` | `WINDOWS[windowId].label`, e.g. `'8–10am'` |

**`format.js`** (pure)

| Export | Signature and result |
|---|---|
| `gbp(n)` | `'£195'`; `'£12.50'` when not a whole number; negative `'-£5'` |
| `normalisePhone(input)` | any accepted UK mobile variant -> display form `'07700 900231'`; anything else -> `null` |
| `isUkMobile(input)` | boolean, `normalisePhone(input) !== null` |
| `toWaDigits(input)` | digits for wa.me per 10.5; `''` when the input has no digits; accepts any international number |
| `normaliseDemoPhone(input)` | `''` -> `''`; a UK mobile or a `+` / `00` international number of 8 to 15 digits -> digits; else `null` |
| `normalisePostcode(input)` | trim, upper-case, one space before the last 3 characters: `'mb34qp'` -> `'MB3 4QP'`; input shorter than 5 characters is returned trimmed and upper-cased |
| `isValidPostcode(input)` | boolean: after `normalisePostcode` it matches `/^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$/` (deliberately lenient: `AB1 2CD` is valid and falls in the `outside` zone) |
| `outwardCode(input)` | `'MB3'`; `''` when invalid |
| `postcodeZone(input, business)` | `'invalid'`, `'covered'`, `'edge'` or `'outside'`; `business` is any object with `coveredOutward` and `edgeOutward` arrays (the `Business` object or the `selectBrand` result) |
| `validateName(v)`, `validatePhone(v)`, `validatePostcode(v)`, `validateLine1(v)` | `''` when valid, otherwise the exact message from 13.2.3 (empty and invalid cases differ for phone and postcode) |
| `initials(name)` | `'Priya Nair'` -> `'PN'`; one word -> its first two letters upper-case; blank -> `'?'` |
| `firstName(name)` | the first whitespace-separated word, original case |
| `hashHue(name)` | integer 0 to 5, stable (sum of char codes mod 6): the avatar tint index |
| `makeId(prefix)` | `prefix + '_' + 8 random base36 characters` from `Math.random()`. NEVER time-based, so a frozen test clock cannot make two ids collide. Prefixes: `bk`, `msg`, `blk`, `off`, `grp` |
| `plural(n, one, many = one + 's')` | `plural(1, 'job')` -> `'1 job'`, `plural(2, 'job')` -> `'2 jobs'` |

**`config.js`**: `makeDefaultSettings()` returns a fresh deep `Settings` object per 7.3 and 3.1 on every call; `TEMPLATE_KINDS` is the array of the 19 ids in 10.1; `PLACEHOLDERS` is `{ [name]: 'description' }` for the table in 10.2; `KIND_LABELS` and `DEFAULT_TEMPLATES` are `Record<TemplateKind, string>`.

**`messages.js`**

| Export | Signature and result |
|---|---|
| `renderTemplate(text, ctx)` | string, per the rendering rules in 10.2 |
| `buildContext(booking, state, extra = {})` | the `ctx` object holding every placeholder in 10.2 (all values are strings) |
| `buildMessage(kind, booking, state, extra = {})` | PURE (no write). Returns a `Message` WITHOUT `id` and `seq`: `{ at, sendAt, bookingId, to, toName, toPhone, channel: 'whatsapp', kind, body, simulated: true, seed: false }`. `to` is `'owner'` for kinds starting `owner_` (`toName` = `business.ownerFullName`, `toPhone` = `business.phone`), else `'customer'` (the booking customer's name and phone). `extra` = `{ at = nowStamp(), sendAt = null, oldWhen, newWhen, reason, etaMinutes, nextFree }`; when a template needs `nextFree` and `extra.nextFree` is absent it is computed from `nextFreeSlot(state, booking.serviceId)`. UI previews (ETA, cancel, reschedule sheets) call this to show the exact text before the action. |
| `reminderSendAt(booking, createdStamp)` | per 10.4. Pure: it does NOT look at `remindersOn` (the store checks that) |
| `messageIsScheduled(msg, nowStampStr)` | per 10.4 |
| `bubbleActions(message, booking, nowStampStr)` | per 10.6; `booking` may be `null` (deleted by a reset) -> `[]` |

**`ics.js`**: `buildIcs(booking, settings)`, `icsFilename(booking, settings)` (needs `business.shortName`), `downloadIcs(booking, settings)`.

**`seed.js`**

| Export | Shape |
|---|---|
| `buildSeed(now, settings, existing = { bookings: [], blocks: [] })` | 8.7.1 |
| `SEED_CUSTOMERS` | object keyed by the Key column of 3.4: `{ priya: { name, phone, email: '', addresses: [{ line1, postcode }, ...] }, ... }` (Marcus has two addresses) |
| `SAMPLE_CUSTOMER` | flat, used by `demo-fill`: `{ name: 'Priya Nair', phone: '07700 900231', email: '', line1: '14 Alder Row', postcode: 'MB3 4QP' }` |
| `SIM_POOL` | array of 8 `{ name, phone, line1, postcode, notes }` for `simulateIncomingBooking`: invented names and streets, phones `07700 900500` to `07700 900507`, postcodes spread over `MB1` to `MB10` (covered), `notes` a short realistic line (may be `''`) |

### 8.2 `clock.js`

```js
now()                    // Date: real time, or ?now= override (ticking unless &freeze=1)
nowStamp()               // Stamp of now()
todayKey()               // DayKey of now()
isClockOverridden()      // boolean
clockOverrideStamp()     // Stamp the override started at, or null
clockQuery()             // '' or '?now=2026-10-23T20:30&freeze=1' (to carry across pages, used by pageHref)
setClock(dateOrNull, { frozen = true } = {})   // for tests; null clears the override
```

The override is read once from `globalThis.location?.search` at first use. `?now=` accepts `YYYY-MM-DDTHH:mm` or `YYYY-MM-DDTHH:mm:ss`; anything else is ignored.

### 8.3 `store.js` public API (exact)

All mutating functions return a result object. Success: `{ ok: true, ...data }`. Failure: `{ ok: false, reason, errors?, alternatives? }`. Reasons: `'not_found'`, `'bad_transition'`, `'invalid'`, `'slot_taken'`, `'emergencies_off'`, `'service_unavailable'`, `'not_allowed'`, `'booked'` (cannot block a booked window), `'stale'` (undo). Functions never throw for expected failures.

| Function | Parameters | Returns | Side effects |
|---|---|---|---|
| `initStore(opts?)` | `opts = { storage?: StorageLike, force?: boolean }`; `storage` is injectable for tests (`getItem/setItem/removeItem`) | `State` | Idempotent unless `force`. Loads or seeds, applies the day-rollover rule (8.7.3), installs the cross-tab listeners (8.5). |
| `getState()` | none | `State` (immutable snapshot; never mutate) | Calls `initStore()` lazily. |
| `subscribe(fn)` | `fn(state, prevState)` | `unsubscribe()` | `fn` runs after every local mutation AND after an external change is detected. |
| `syncFromStorage()` | none | `boolean` (true if state changed) | Re-reads storage; if the raw JSON string differs from the last string this page read or wrote, it replaces the state and notifies (comparing the raw string, not only `meta.rev`, also catches two tabs that both advanced to the same `rev`). Called by the listeners and at the start of every mutation. |
| `getStorageStatus()` | none | `{ ok: boolean, mode: 'local'\|'memory' }` | |
| `createBooking(draft)` | `draft`: `BookingDraft`, see 8.4 | `{ ok: true, booking, messages: Message[] }` or failure | Assigns `ref`, re-validates the slot inside the read-modify-write, writes history, writes messages (8.4). |
| `confirmBooking(id, by = 'owner')` | | `{ ok, booking, undoToken }` | per 7.5 |
| `acceptEmergency(id, etaMinutes)` | `etaMinutes` one of 45, 60, 120 (any positive int accepted) | `{ ok, booking, undoToken }` | |
| `declineBooking(id)` | | `{ ok, booking, undoToken }` | |
| `markOnTheWay(id, etaMinutes)` | `etaMinutes` positive int | `{ ok, booking, undoToken }` | |
| `completeBooking(id, { finalPrice, paid = false, paidMethod = null, sendReview = true })` | `finalPrice` integer >= 0 | `{ ok, booking, undoToken }` | when `paid` true and `paidMethod` falsy -> `invalid` |
| `markPaid(id, method)` | `method` in `PAID_METHODS` | `{ ok, booking, undoToken }` | |
| `markUnpaid(id)` | | `{ ok, booking }` | |
| `cancelBooking(id, by, { reason = '', notify = true } = {})` | `by` `'owner'\|'customer'` | `{ ok, booking, undoToken }` | Also deletes the booking's unsent scheduled messages. |
| `rescheduleBooking(id, { date, windowId }, by = 'owner', { notify = true } = {})` | | `{ ok, booking, undoToken }` or `slot_taken` + `alternatives` | Replaces the scheduled reminder. Validates the target with `isSlotFree(..., { ignoreBookingId: id, ownerMode: by === 'owner' })` so a job can move within its own windows; a half-day job's `windowId` must be 0 or 2; `by === 'customer'` follows the cutoff rule in 7.5. |
| `updateBooking(id, patch)` | `patch` keys limited to `internalNotes`, `quotedPrice`, `finalPrice` | `{ ok, booking }` | |
| `markSeen(id)` / `markAllSeen()` | | `{ ok }` | sets `seenByOwner: true` |
| `sendQuickMessage(bookingId, kind)` | `kind` in `customer_running_late`, `customer_need_access`, `customer_quote_ready` | `{ ok, message }` | logs one message |
| `sendPaymentNudge(bookingId)` | only `done && !paid` | `{ ok, message }` | logs `customer_payment_nudge` |
| `sendReviewRequest(bookingId)` | only `done`; not already requested | `{ ok, message }` | logs `customer_review_request` immediately (`sendAt: null`), sets `reviewRequested` |
| `sendMessageNow(messageId)` | | `{ ok, message }` | sets `sendAt: null`, `at: nowStamp()` |
| `markMessagesSeen()` | | `{ ok }` | `meta.messagesSeenSeq = meta.msgSeq` |
| `addBlock({ date, windowId, label })` | | `{ ok, block, undoToken }` or `booked` | |
| `blockRange({ fromDate, toDate = fromDate, windowIds = [0,1,2,3], label })` | | `{ ok, added: Block[], skipped: {date,windowId,reason}[], undoToken }` | windows already booked are skipped; all added blocks share one `groupId` |
| `removeBlock(id)` / `removeBlockGroup(groupId)` | | `{ ok, undoToken }` | |
| `addDaysOff(dates, label = 'Day off')` | `dates: DayKey[]` | `{ ok, added: DayOff[], undoToken, bookedCount }` | `bookedCount` = existing live bookings on those days (they stay) |
| `removeDayOff(id)` | | `{ ok, undoToken }` | |
| `setDayFull(date, full)` | `full: boolean` | `{ ok, undoToken }` | adds/removes `date` in `settings.fullDays` |
| `updateSettings(patch)` | partial `Settings`; `business` merges shallowly; `hours` replaces | `{ ok, settings }` or `{ ok: false, reason: 'invalid', errors: { [field]: message } }` | trims strings; `business.phone` normalised via `normalisePhone`. `errors` keys are the field names inside `business` (`name`, `shortName`, `ownerFirstName`, `phone`) or the top-level setting name (`leadMinutes`, `maxDaysAhead`). Messages: `This can't be empty.` for the three required strings, `Enter a UK mobile like 07700 900412` for `phone`. `leadMinutes` must be one of 60, 90, 120, 180, 240 and `maxDaysAhead` one of 7, 14, 21, 28. A failed patch changes nothing. |
| `updateService(id, patch)` | keys `name`, `description`, `price`, `active`, `variants: [{id, price}]` | `{ ok, service }` | `price`/variant prices must be integers 0 to 99999, else `{ ok: false, reason: 'invalid', errors: { price: 'Enter a whole number of pounds.' } }`. When `variants` is given, `service.price` is recomputed as the lowest variant price (so the headline `From £150` follows). `price` is ignored for `priceType: 'free'`. |
| `setTheme(choice)` | `'auto'\|'light'\|'dark'` | `{ ok }` | writes `vm_theme` and `settings.theme`; setting `<html data-theme>` is the UI layer's job (`applyTheme`), not core's |
| `setDemoPhone(input)` | `''` clears; else a UK mobile or international number | `{ ok, digits }` or `invalid` | stores digits only in `settings.demoPhoneDigits` |
| `resetDemo({ keepSettings = true } = {})` | | `{ ok }` | Reseeds bookings, blocks, messages, `refSeq`, `seededFor` and `meta` (`rev` keeps counting up; `msgSeq` and `messagesSeenSeq` become the highest seed `seq`; `simCursor` becomes 0). `keepSettings: true` keeps `business`, `services`, `hours`, rules, `theme`, `demoPhoneDigits`, but clears `daysOff` and `fullDays`. `false` restores all defaults except `theme` and `demoPhoneDigits`. |
| `simulateIncomingBooking({ kind = 'standard' } = {})` | `kind`: `'standard'` (follows settings), `'approval'` (forces an edge-zone postcode so status is `new`), `'emergency'` | `{ ok, booking }` | Exactly the `createBooking` code path with `source: 'website'`. Uses `SIM_POOL[meta.simCursor % length]`, increments `simCursor`, picks the earliest free window for the chosen service (`nextFreeSlot`); if none is free it returns `{ ok: false, reason: 'slot_taken' }`. `standard` and `approval` book the `fault` service; `emergency` books `emergency` with `emergencyReasons: ['no_power']` and the note `Power went off suddenly`; `approval` overrides the pool postcode with `MB11 5HD` (an edge outward code). |
| `undo(token)` | token from a mutation | `{ ok }` or `{ ok: false, reason: 'stale' }` | restores the records that mutation touched (booking, messages it added, blocks / daysOff / fullDays) if they have not changed since; tokens live in memory only (max 20). "Not changed since" means each touched record deep-equals the state that mutation produced. Undoing a cancel, decline or reschedule also re-checks that the windows it would re-occupy are still free (`isSlotFree` with `ownerMode: true` and `ignoreBookingId`); if another booking has taken them the result is `stale`, never a double booking. |

**Generic failure rule (UI).** A mutation that returns a `reason` the screen does not handle specially shows `toast({ message: 'That did not work: the diary changed. Please check and try again.', tone: 'danger' })`; `not_found` shows `That booking no longer exists.` (a reset in another tab removed it); `undo` returning `stale` shows `Too late to undo.`. Submit buttons guard against double taps: while a submit is in flight the button is `loading` and a second tap is ignored (a second `createBooking` would otherwise return `slot_taken` against the first and flash a banner over the confirmation).

### 8.4 `createBooking` in detail

```js
/** @typedef {Object} BookingDraft
 * @property {ServiceId} serviceId
 * @property {VariantId} [variantId]          eicr defaults to its defaultVariantId
 * @property {DayKey} date                     urgent: today
 * @property {WindowId|null} windowId          null only for urgent
 * @property {boolean} [urgent]
 * @property {string[]} [emergencyReasons]     ids from EMERGENCY_REASONS, required (>=1) when urgent
 * @property {{name:string, phone:string, email?:string}} customer
 * @property {{line1:string, postcode:string}} address       line1 optional when urgent
 * @property {string} [notes]                  max 300 chars, trimmed
 * @property {BookingSource} [source]          default 'website'
 * @property {boolean} [asOwner]               owner entering a phone booking
 * @property {boolean} [notifyCustomer]        owner mode only, default true
 * @property {number} [quotedPrice]            owner mode only override
 */
```

Algorithm (all inside one read-modify-write, after `syncFromStorage()`):

1. Validate. Errors map keys: `name`, `phone`, `postcode`, `line1`, `serviceId`, `date`, `windowId`, `emergencyReasons`, with the exact messages from `format.js` validators (13.2.3). Also: `date` must be a valid `DayKey`; `windowId` must be 0 to 3 and, for a half-day service, 0 or 2 (`errors.windowId`); `name` is cut to 60 characters and `notes` to 300 after trimming. Return `{ ok: false, reason: 'invalid', errors }`.
2. Service must exist and be `active` (else `service_unavailable`). `urgent` requires `settings.takingEmergencies` (else `emergencies_off`).
3. Non-urgent: `isSlotFree(state, { date, windowId, blocks, ownerMode: !!asOwner })`; if not free return `{ ok: false, reason: 'slot_taken', alternatives: nextFreeSlots(state, serviceId, 3, { ownerMode }) }`. Urgent bookings skip this.
4. Build the booking: `ref = 'VM-' + refSeq++`; `start = makeStamp(date, WINDOWS[windowId].start)` (urgent: `nowStamp()`); `durationMin = blocks * 120` (urgent 0); `quotedPrice` per `quotedPriceFor`; `phone` normalised display; `postcode` normalised; `seenByOwner = !!asOwner`; history `created`.
5. Status: urgent -> `new`; `asOwner` -> `confirmed`; else `autoConfirm && postcodeZone(postcode, settings.business) === 'covered'` -> `confirmed`; else `new`. If `confirmed` also push history `confirmed` (`by: asOwner ? 'owner' : 'system'`).
6. Messages (via `buildMessage`): `asOwner`: none to owner; `customer_confirmed` + reminder only if `notifyCustomer !== false`. Customer-made: `owner_new_booking` (or `owner_emergency`) always; customer: `customer_confirmed` (+ scheduled `customer_reminder` per `reminderSendAt`) when confirmed, `customer_received` when `new`, `customer_emergency_received` when urgent. `at` = `nowStamp()`. Messages are inserted in this order so the OWNER ALERT gets the highest `seq` of the group and therefore sorts first on the (newest-first) Messages screen when `at` ties: scheduled reminder, then the customer message, then the owner alert. `createBooking` returns `messages` in that insertion order.
7. Persist, notify, return.

### 8.5 Cross-tab sync, persistence, performance

- State is stored whole under `vm_state_v1` after every mutation (`meta.rev` increments by 1). Data is tiny.
- Listeners installed by `initStore` (guarded by `typeof window !== 'undefined'`): `window 'storage'` (key `vm_state_v1` or `null`), `document 'visibilitychange'` (when visible), `window 'pageshow'`, `window 'focus'`. Each calls `syncFromStorage()`. Phones freeze background tabs, so the foreground re-read is what makes the "booking appears on the dashboard" moment reliable.
- Every mutation starts with `syncFromStorage()` so two tabs cannot clobber each other.
- `getState()` returns the same object reference until a change, so selectors may use reference equality. Every mutation works on a deep copy (`structuredClone(state)`, falling back to `JSON.parse(JSON.stringify(state))` where `structuredClone` is missing, i.e. iOS before 15.4; the state is plain JSON), bumps `meta.rev`, writes the JSON, then swaps the module state and notifies. Unchanged records may therefore get new object identities after ANY mutation: views and selectors must not rely on record identity across mutations (one re-render per mutation is fine at this data size).

### 8.6 Selectors (`js/core/selectors.js`, all pure: `(state, ...) => value`)

```js
selectBrand(state)              // { name, shortName, descriptor, ownerFirst, ownerFull, tagline, phone, phoneDigits, telHref, email, areaName, areaText, towns, schemeLine, insuranceLine, hoursText, demoPhoneDigits, coveredOutward, edgeOutward }   // pass the whole brand to postcodeZone(pc, brand); pass brand.demoPhoneDigits as the 3rd argument of every waLink()
selectServices(state, { activeOnly = true } = {})   // Service[] in settings order
selectService(state, id)        // Service | null
quotedPriceFor(service, variantId)   // number (variant price, else service.price)
servicePriceLabel(service)      // 'From £75' | 'From £150' (by_size: 'From £150') | 'Free' | 'From £95' | fixed: '£120'
selectBookingById(state, id)
selectBookingByRef(state, ref)  // case-insensitive
selectBookingsOn(state, dayKey, { includeCancelled = false } = {})   // sorted by start, then createdAt; includes urgent bookings whose start date is dayKey
selectNeedsYou(state)           // status 'new': urgent first, then oldest createdAt first
selectNextUp(state, nowStamp)   // 1) on_the_way (earliest start) 2) confirmed urgent (oldest) 3) confirmed whose bookingEndStamp > nowStamp, earliest start; else null
selectUpcoming(state, nowStamp) // new|confirmed|on_the_way, urgent or bookingEndStamp >= nowStamp, sorted by start
selectOwed(state)               // done && !paid, oldest start first
selectOwedTotal(state)          // sum of finalPrice
selectUnseenBookings(state)     // seenByOwner === false, newest first
selectNextOpenDay(state, fromDayKey)   // first day after fromDayKey that has any open window per settings.hours and is not a day off
selectCustomers(state)          // Customer[] sorted by the later of nextJobAt and lastJobAt descending (null counts as ''), then name ascending
selectCustomerByKey(state, key)
customerKeyOf(phone)            // toWaDigits(phone)
selectRepeatInfo(state, booking)   // { isRepeat: boolean, nth: number }   // isRepeat = nth >= 2  nth = 1-based position among that customer's non-cancelled bookings ordered by createdAt
selectMessages(state, { to, bookingId, scheduledOnly, nowStamp } = {})   // newest first: `at` descending, then `seq` descending (`scheduledOnly` needs `nowStamp`)
selectUnreadMessageCount(state) // count of messages with `to === 'owner' && !seed && seq > meta.messagesSeenSeq` (seed alerts are 'already seen'; comparing `seq`, not minute-precision stamps, means a message that arrives in the same minute as the owner opened Messages still counts)
selectInsights(state, nowStamp) // { collectedMonth, collectedMonthCount, owedTotal, owedCount, bookedNext14, bookedNext14Count, avgJob, weeks, byService }
isWithinChangeCutoff(booking, nowStamp)   // true when start is less than PROMISES.freeChangeHours ahead, INCLUDING a start in the past (7.5)
```

`selectInsights` definitions: `collectedMonth` = sum of `finalPrice` for `done && paid` with `paidAt` in the same calendar month as `nowStamp`; `owed*` as `selectOwed`; `bookedNext14` = sum of `quotedPrice` over non-urgent bookings with status `new|confirmed|on_the_way` and start day in `[today, today + 13]`; `avgJob` = rounded mean `finalPrice` of `done` bookings whose start day is within the last 30 days (0 if none); `weeks` = last 6 Monday-start weeks oldest to newest `{ weekStart: DayKey, label: 'Mon 19 Oct', total }` summing `finalPrice` of paid jobs by `paidAt` week; `byService` = `{ serviceId, name, jobs, total }` for done bookings, sorted by total desc.

### 8.7 Seed (`seed.js`) and rollover

**8.7.1 `buildSeed(now, settings, existing = { bookings: [], blocks: [] })` returns** `{ bookings, blocks, messages, refSeq }` following the table in 3.4 exactly. `existing` holds the NON-seed records already in the store; placement (8.7.2) treats their windows as taken, so a day rollover can never double-book a window that the owner or a customer already holds. `buildSeed` builds its messages with `buildMessage(kind, booking, { settings, bookings, blocks }, extra)` using the partial state it has built so far (no seeded message needs `nextFree`). It uses the SAME `buildMessage` function as the store and the SAME `reminderSendAt`. Seed bookings use fixed refs `VM-1028` to `VM-1042` and `refSeq: 1043`. Ids are `bk_seed_01` ... `bk_seed_15` (stable so tests and deep links are deterministic). Message ids follow 3.4 (`msg_seed_<NN>_<role>`); `buildSeed` numbers their `seq` from 1 in ascending `at` order and the STORE adds the current `meta.msgSeq` to each when it merges a re-seed (day rollover), so `seq` keeps increasing. Seed `history` has a `created` entry at `createdAt` plus the transitions implied by the status (`confirmed`, `done`, `paid`, `cancelled`).

**8.7.2 Placement algorithm.** Resolve `dayRef` to a date: `T` = today; `P(k)` / `O(k)` = k-th previous / next day whose weekday has at least one window in the DEFAULT hours (Mon to Sat). Then place `blocks` (1 or 2) windows: candidate start windows are the preferred window first, then the remaining valid starts in ascending order (half-day valid starts are 0 and 2 only); a candidate is usable when every covered window is in the default hours for that weekday and not already taken by a non-cancelled seed booking, a seed block, or any non-cancelled booking or block in `existing`. If no candidate fits, move to the next open day in the same direction (max 5 days) and retry. `T` ignores default hours (so a Sunday "today" still shows its jobs). Status for `T` entries: `done` when the window's end stamp <= now, else `confirmed`; `done` + paid cash when specified; `paidAt` = window end stamp; `finalPrice` = quoted unless specified. The urgent S07 uses `start = nowStamp`, `durationMin: 0`, `emergencyReasons: ['no_power']`, `notes: 'No power in kitchen'`. S15's `cancelledBy: 'customer'`, `cancelReason: 'Customer asked'`.

**8.7.3 Day rollover.** On `initStore`: if no stored state, or invalid -> full seed (`seededFor = todayKey()`). Else if `seededFor !== todayKey()` -> remove every record with `seed: true` (bookings, blocks, messages), run `buildSeed(now, settings, { bookings: <the non-seed bookings>, blocks: <the non-seed blocks> })`, keep all non-seed records, `settings` (except that `daysOff` and `fullDays` entries before today are dropped), and keep `refSeq = max(stored refSeq, seed refSeq)`. This keeps weekdays aligned and Today populated every morning. It does NOT run on tab focus.

### 8.8 Hook layer (WP2, `js/ui/hooks.js`) for reference

```js
useStore(selector, isEqual = shallowEqual)   // subscribes; re-renders when selector(state) changes
useNow(intervalMs = 30000)                   // Date from clock.now(); re-renders each interval
useMediaQuery(query)                         // boolean, matchMedia with listener
useBrand()                                   // useStore(selectBrand)
```
Selectors passed to `useStore` must be stable functions (define them outside the component or with `useCallback`) and may return arrays/objects; the default `shallowEqual` compares keys/elements by reference.

### 8.9 What the unit tests (WP1, `tests/unit/*.test.mjs`) must prove

Run with `TZ=Europe/London node --test "electrician/tests/unit/*.test.mjs"` (quoted glob: a bare directory fails on Node 22). Each file uses `node:test` and `node:assert/strict`, injects an in-memory storage into `initStore({ storage, force: true })` and uses `setClock(...)`.

| File | Must prove |
|---|---|
| `clock.test.mjs` | `?now=` parsing (with and without seconds, bad input ignored); `freeze`; `setClock(null)` restores real time; `clockQuery()` round-trips. |
| `dates.test.mjs` | `addDays('2026-10-24', 1) === '2026-10-25'` and `addDays('2026-10-25', 1) === '2026-10-26'` under `TZ=Europe/London`; `minutesBetween('2026-10-25T00:00','2026-10-26T00:00') === 1500`; `weekStart('2026-10-25') === '2026-10-19'` (Sunday belongs to the Monday-start week); `weekDates` length 7 Monday first; `fmtDayShort('2026-10-24') === 'Sat 24 Oct'`; `fmtRelativeDay`; `fmtTimeAgo`; `monthKeyOf`; `diffDays('2026-10-24', '2026-10-27') === 3` across the clock change. |
| `format.test.mjs` | phone variants all normalise to `07700 900231` / `447700900231`: `07700900231`, `07700 900 231`, `+44 7700 900231`, `447700900231`, `00447700900231`; rejects `01234 567890`, `0770090023`, letters; postcode `mb3 4qp`, `MB34QP` -> `MB3 4QP`; `outwardCode`; `postcodeZone` for `MB3 4QP` covered, `MB12 6AB` edge, `AB1 2CD` outside, `xx` invalid; `toWaDigits('+44 (0)7700 900231') === '447700900231'` (the `(0)` is dropped); `isValidPostcode('AB1 2CD')` is true; `makeId('bk')` called 1000 times under a FROZEN clock gives 1000 distinct ids; `gbp(195) === '£195'`, `gbp(12.5) === '£12.50'`; validators return the exact messages in 13.2.3. |
| `availability.test.mjs` | The four worked examples in 9.8 verbatim; state precedence (9.2); half-day pairing; `too_soon` boundary (a window starting exactly at now + lead is `free`); horizon last day `today + 13` free and `today + 14` closed; cancelled booking frees the window; urgent bookings never occupy; owner mode ignores lead/full/horizon but never overrides `booked`/`blocked`/day off; `describeHours` outputs. |
| `messages.test.mjs` | Every kind in `TEMPLATE_KINDS` renders for a sample booking with no leftover `{` or `}`, no empty lines, no emoji (`/\p{Extended_Pictographic}/u`), no `!`; placeholder substitution; `waLink` digit rules and demo override; `reminderSendAt` rules (10.4); `bubbleActions` per status; `messageIsScheduled`. |
| `ics.test.mjs` | CRLF line endings; floating `DTSTART:20261024T080000` with no `Z`; `DTSTAMP` is the ONE UTC value and matches `/^DTSTAMP:\d{8}T\d{6}Z$/` (createdAt `2026-10-23T20:30` under `TZ=Europe/London` gives `DTSTAMP:20261023T193000Z`); `DTEND` = start + `durationMin`; escaping of `,` `;` `\` and newlines; folding at 75 octets; `UID`; filename `voltmere-VM-1043.ics`. |
| `seed.test.mjs` | At clock `2026-10-23T20:30` frozen: the fixture totals in 3.4 (15 bookings, needs-you 2, owed £245, collected £850, next-14 £675/7, avg £183, 11 customers); no overlapping non-cancelled bookings; `buildSeed(now, settings, { bookings: [<a booking holding Sat window 0>], blocks: [] })` never places a seed booking in a window that `existing` holds; the emergency alert id is `msg_seed_07_alert`; day loads Sat few, Sun closed, Mon good, Tue full, Wed full; `nextFreeSlot('fault')` = Sat 2026-10-24 window 0, `nextFreeSlot('eicr')` = Mon 2026-10-26 window 0 blocks 2; invariants hold at 7 other clocks (every weekday at 09:00 and Sun 12:00): at least 14 bookings, statuses `new`, `confirmed`, `done` and `cancelled` present (`on_the_way` is not seeded), one urgent `new`, at least one owed job, Marcus has 2 EICRs at 2 addresses, first open day's window 0 is free. |
| `store.test.mjs` | Round-trip through injected storage; schema rejection reseeds; `createBooking` happy path (ref `VM-1043`, status `confirmed`, 3 messages: owner alert, confirmation, scheduled reminder); validation errors and exact messages; second booking of the same window returns `slot_taken` with 3 alternatives; edge postcode -> `new` + `customer_received`; `autoConfirm: false` -> `new`; urgent never blocks a window and is never auto-confirmed; `emergencies_off`; every row of the transition table (one allowed, one disallowed); cancel frees the window; reschedule moves it and replaces the reminder; customer cancel refused within 24h; `completeBooking` with `paid: true` sets `paidAt`; `markPaid` then Insights `collectedMonth` rises; `undo` restores booking and removes messages, and returns `stale` after a later change; `resetDemo` keepSettings semantics; `simulateIncomingBooking` kinds and `simCursor` cycling; day rollover keeps non-seed bookings and settings; `syncFromStorage` picks up an externally written newer `rev` and notifies subscribers; `subscribe`/unsubscribe; storage throwing -> memory mode with `getStorageStatus().ok === false`; message `seq` strictly increases, and the owner alert of a new booking has the highest `seq` of its group; `undo` of a cancel returns `stale` when another booking has since taken the freed window. |
| `selectors.test.mjs` | `selectNeedsYou` order; `selectNextUp` priority; `selectOwed`; `selectInsights` fixture values; `selectCustomers` derivation, `Landlord` and `Repeat` tags, `selectRepeatInfo.nth` for Priya's second booking is 2; `selectUnreadMessageCount` (counts only non-seed owner messages with `seq` above `messagesSeenSeq`; a message created in the same minute, with an equal `at`, after `markMessagesSeen()` still counts as unread); `isWithinChangeCutoff` (true for a start in the past). |

---

## 9. AVAILABILITY / SLOT ENGINE (`js/core/availability.js`)

Pure functions of `(state, ...)`. No clock reads except through `opts.now` (default `now()` from `clock.js`). Never mutates state.

### 9.1 Rules in plain words

1. A day has four fixed two-hour arrival windows (`WINDOWS`). 12:00 to 13:00 is lunch and never bookable. There is no buffer and no 30-minute grid: an arrival window already absorbs travel, and the customer is only promised "arrive between 8 and 10am".
2. `settings.hours[weekday]` lists which windows are open that weekday. Default: Mon to Fri all four, Saturday windows 0 and 1, Sunday none.
3. A single-window service (`blocks: 1`) occupies one window. A half-day service (`blocks: 2`) occupies two consecutive windows and may only START at window 0 (morning) or window 2 (afternoon). Both covered windows must be open.
4. A window is occupied by any booking whose `status !== 'cancelled'` and `!urgent` whose covered windows include it. So a `new` (awaiting approval) booking holds its window; a cancelled booking does not. Urgent (emergency) bookings never occupy windows.
5. A window can be individually **blocked** (`state.blocks`), a whole **day off** (`settings.daysOff`), or the whole day marked **full** (`settings.fullDays`; customers cannot book it, existing jobs stay, the owner still can).
6. **Lead time:** a window whose start is earlier than `now + leadMinutes` is `too_soon` (this includes the window currently in progress). A window whose END is at or before `now` is `past`.
7. **Horizon:** customers can book from today to `today + maxDaysAhead - 1` (default 14 days: today plus 13). Later days are `closed` for customers.
8. **Owner mode** (`opts.ownerMode: true`, used by the Calendar, Add booking and Reschedule): ignores lead time, `fullDays` and the horizon; still respects `past`, `booked`, `blocked`, day off and open hours.
9. Cancelling or declining a booking, removing a block, removing a day off, or unmarking a full day frees the window immediately on every screen (everything reads the same state).

### 9.2 Per-window state and precedence

For each window the engine computes ONE state, first match wins in this order:

| # | State | Condition |
|---|---|---|
| 1 | `past` | window end stamp <= now |
| 2 | `booked` | occupied by a non-cancelled non-urgent booking (other than `ignoreBookingId`) |
| 3 | `closed` | date beyond horizon (customer mode), OR date in `daysOff`, OR window not in `hours[weekday]` |
| 4 | `blocked` | a block exists for (date, window) |
| 5 | `full` | date in `fullDays` and not owner mode |
| 6 | `too_soon` | not owner mode and window start < now + `leadMinutes` |
| 7 | `free` | otherwise |

For a half-day slot the two windows are combined by taking the state that comes FIRST in the table above across the pair (so any `booked` window makes the half-day slot `booked`; a Saturday afternoon half-day is `closed`).

### 9.3 Types and exact signatures

```js
/** @typedef {'free'|'booked'|'blocked'|'closed'|'full'|'too_soon'|'past'} SlotState
 *  @typedef {{ now?: Date, ownerMode?: boolean, ignoreBookingId?: string }} AvailOpts
 *  @typedef {Object} SlotInfo
 *  @property {DayKey} date  @property {WindowId} windowId @property {1|2} blocks
 *  @property {Stamp} startsAt   // start of the first covered window
 *  @property {Stamp} endsAt     // end of the last covered window
 *  @property {string} label     // blocks 1: '8–10am'. blocks 2: 'Morning · arrive 8–10am' | 'Afternoon · arrive 1–3pm'
 *  @property {string} arriveLabel  // label of the START window, e.g. '8–10am'
 *  @property {SlotState} state
 *  @property {string|null} bookingId   // occupying booking (state 'booked')
 *  @property {string|null} blockLabel  // state 'blocked'
 */

getDaySlots(state, date, serviceOrBlocks, opts?)        // SlotInfo[]; blocks 1 -> 4 entries (windows 0..3); blocks 2 -> 2 entries (starts 0 and 2). Always returns all entries, including closed ones; UIs filter.
getDayStatus(state, date, opts?)                        // { kind: 'past'|'beyond'|'dayoff'|'closed'|'full'|'open', label: string }  label = day-off label | 'Closed' | 'Full' | ''
getDayLoad(state, date, opts?)                          // { free: number, total: number, level: 'good'|'few'|'full'|'closed' }
getBookableDays(state, { count, serviceOrBlocks = 1, now, ownerMode } = {})   // [{ date, status: DayStatus, load: DayLoad, freeSlots: number }] starting today, count default settings.maxDaysAhead
nextFreeSlot(state, serviceOrBlocks, opts?)             // { date, windowId, blocks, startsAt, endsAt, label, arriveLabel, human } | null, searching today .. today + maxDaysAhead - 1
nextFreeSlots(state, serviceOrBlocks, count = 3, opts?) // up to `count` such objects in time order (distinct slots, may share a day)
isSlotFree(state, { date, windowId, blocks = 1, ignoreBookingId, ownerMode, now })   // boolean: the slot's combined state is 'free'
occupiedBy(state, date, windowId, { ignoreBookingId } = {})   // bookingId | null
bookingWindowIds(booking)                               // [] for urgent; else window ids covered, derived from start + durationMin
bookingEndStamp(booking)                                // start + durationMin; urgent: start
bookingWindowLabel(booking)                             // '8–10am' | 'Morning · arrive 8–10am' | 'Afternoon · arrive 1–3pm' | 'ASAP' (urgent)
bookingWhen(booking)                                    // 'Sat 24 Oct, 8–10am' | 'Mon 26 Oct, morning, 8–10am' | 'ASAP'  (this is the {when} placeholder)
windowIdFromStart(stamp)                                // 0..3 or null when the time is not a window start
slotHuman(date, windowId, blocks, todayKeyStr)          // 'Today, 3–5pm' | 'Tomorrow, 8–10am' | 'Mon 26 Oct, 8–10am' | blocks 2: 'Mon 26 Oct, morning, arrive 8–10am' | 'Today, afternoon, arrive 1–3pm'
describeHours(hours)                                    // 'Mon to Fri 8am to 5pm, Sat 8am to 12pm'
```

`serviceOrBlocks` is a `ServiceId` (looked up in `settings.services` for `blocks`) or the number `1` / `2`. `getDayLoad` counts SINGLE windows: `total` = number of windows open that weekday (0 when day off, a date before today, beyond the horizon in customer mode, or when EVERY open window of today is already `past`, so late in the evening today reads `closed`, not `full`); `free` = those whose per-window state is `free`; `level`: `total === 0` -> `closed`; `free === 0` -> `full`; `free === 1` -> `few`; else `good`. `describeHours` groups consecutive weekdays with identical open-window sets (Monday-first order), formats each group's span from the first open window's start to the last open window's end (`8am`, `12pm`, `5pm`; end 12:00 is `12pm`), and omits closed days; a fully closed week returns `'Closed'`. `getDayStatus` kinds: `past` = a date before today; `beyond` = after the horizon (customer mode only); `dayoff` (label = the day-off label); `closed` = no open window that weekday, or today with every open window past (label `Closed`); `full` = in `fullDays` (customer mode only; label `Full`); otherwise `open`. UIs that need a per-SERVICE answer (the booking DayPicker, 13.2.2) must read `getBookableDays(...).freeSlots`, not `load.level`: `load` counts single windows, so a half-day service can show a 'good' load and still have zero bookable slots.

### 9.4 Emergency bookings

Never call the slot functions. `createBooking({ urgent: true })` writes `start = nowStamp()`, `durationMin: 0`, `status: 'new'`. They appear in Needs you with Accept and an ETA. Accepting sets `status: 'confirmed'`, `etaMinutes`, `etaAt` but still occupies no window.

### 9.5 Worked examples (clock values are ?now=; defaults for everything else; `leadMinutes` 90, `maxDaysAhead` 14, default hours; reference model verified)

**Example 1: Friday 09:30, empty diary.** `getDaySlots(state, '2026-10-23', 1, { now })` states by window: 0 `too_soon` (08:00 < 11:00, and 10:00 end is after 09:30 so not past), 1 `too_soon` (10:00 < 11:00), 2 `free`, 3 `free`. `nextFreeSlot(state, 'fault')` = `{ date: '2026-10-23', windowId: 2, blocks: 1, human: 'Today, 1–3pm' }`. `nextFreeSlot(state, 'eicr')` = `{ date: '2026-10-23', windowId: 2, blocks: 2, human: 'Today, afternoon, arrive 1–3pm' }`. `getDayLoad(state, '2026-10-23')` = `{ free: 2, total: 4, level: 'good' }`.

**Example 2: Friday 15:30, one booking Saturday window 1 (Hannah).** Today's windows: 0 `past`, 1 `past`, 2 `past` (ends 15:00), 3 `too_soon` (15:00 < 17:00). `nextFreeSlot(state, 'fault')` = Sat 2026-10-24 window 0, `human: 'Tomorrow, 8–10am'`. `nextFreeSlot(state, 'eicr')`: Saturday morning needs windows 0+1 and window 1 is booked (`booked`), Saturday afternoon is `closed` (Saturday hours are 0 and 1), Sunday is `closed`, so the answer is Monday: `{ date: '2026-10-26', windowId: 0, blocks: 2, human: 'Mon 26 Oct, morning, arrive 8–10am' }`. `getDayLoad(state, '2026-10-24')` = `{ free: 1, total: 2, level: 'few' }`. Sunday `getDaySlots` -> all `closed`.

**Example 3: Friday 09:30, today marked Full and Saturday window 0 blocked "Dentist".** Customer mode, today: windows 0-3 all `full`. Owner mode, today: 0 `free`, 1 `free`, 2 `free`, 3 `free` (owner mode ignores lead time and full). `getDayLoad(state, today)` = `{ free: 0, total: 4, level: 'full' }`. `nextFreeSlot(state, 'fault')` = Sat window 1, `human: 'Tomorrow, 10am–12'`. Saturday states: 0 `blocked` (blockLabel `Dentist`), 1 `free`, 2 `closed`, 3 `closed`.

**Example 4: Friday 20:30, Tuesday has window 1 booked (fault) and an EICR in the afternoon (windows 2+3); then the EICR is cancelled.** Single-window view of Tue 2026-10-27: 0 `free`, 1 `booked`, 2 `booked`, 3 `booked`; `getDayLoad` = `{ free: 1, total: 4, level: 'few' }`. Half-day view: start 0 -> `booked` (window 1 is booked), start 2 -> `booked`. After `cancelBooking(eicrId, 'owner')`: single view 0 `free`, 1 `booked`, 2 `free`, 3 `free`, `getDayLoad` = `{ free: 3, total: 4, level: 'good' }`. Horizon: with `maxDaysAhead` 14 the last customer-bookable day is Thu 2026-11-05 (`today + 13`); Fri 2026-11-06 is `closed` for customers, but owner mode treats it as bookable.

---

## 10. MESSAGE TEMPLATES, LINKS AND CALENDAR FILES (`js/core/messages.js`, `js/core/ics.js`)

### 10.1 Template kinds (exact ids; this list IS `TEMPLATE_KINDS`)

```
owner_new_booking          owner_emergency            owner_customer_cancelled   owner_customer_rescheduled
customer_received          customer_confirmed         customer_declined          customer_rescheduled
customer_on_my_way         customer_emergency_received customer_emergency_accepted customer_completed
customer_review_request    customer_reminder          customer_cancelled         customer_payment_nudge
customer_running_late      customer_need_access       customer_quote_ready
```

`KIND_LABELS` (shown on the Messages screen): New booking alert, Emergency alert, Cancelled by customer, Moved by customer, Request received, Confirmation, Declined, Rescheduled, On my way, Emergency received, Emergency accepted, Job done, Review request, Reminder, Cancelled, Payment reminder, Running late, Need access, Quote ready (same order as above).

### 10.2 Placeholders (the complete list; `PLACEHOLDERS` documents these)

| Placeholder | Meaning | Example |
|---|---|---|
| `{ref}` | booking ref | `VM-1043` |
| `{customerName}` / `{customerFirst}` | | `Priya Nair` / `Priya` |
| `{customerPhone}` | display | `07700 900231` |
| `{ownerFirst}` / `{business}` / `{businessShort}` / `{ownerPhone}` | from `settings.business` | `Dan` / `Voltmere Electrical` / `Voltmere` / `07700 900412` |
| `{service}` | `serviceName` | `EICR safety report` |
| `{serviceFull}` | service plus variant | `EICR safety report (House, 2–3 bed)` |
| `{price}` | `quotedPrice` as `gbp` | `£195` |
| `{finalPrice}` | `finalPrice` (falls back to quoted) | `£195` |
| `{priceLine}` | by price type: fixed/by_size `Fixed price {price}, pay after the job.`; from `From {price}, pay after the job. I'll confirm before any extra work.`; free `No charge for the visit.` | |
| `{when}` | `Sat 24 Oct, 8–10am` (half-day: `Mon 26 Oct, morning, 8–10am`; urgent: `as soon as possible`) | |
| `{whenLong}` | `Sat 24 Oct, arriving between 8 and 10am` (half-day: `Mon 26 Oct, morning, arriving between 8 and 10am`; urgent: `as soon as possible`) | |
| `{serviceWhen}` | `{service} on {when}`; for an urgent booking `your emergency visit` (so declined and cancelled messages never read "can't make as soon as possible") | `EICR safety report on Sat 24 Oct, 8–10am` |
| `{dateShort}` | `Sat 24 Oct` | |
| `{arrive}` | `between 8 and 10am` | |
| `{line1}` / `{postcode}` / `{address}` | `14 Alder Row` / `MB3 4QP` / `14 Alder Row, MB3 4QP` (urgent with no line1: postcode only). `{line1}` itself falls back to the postcode when empty (an urgent request without a street), so no template ever renders a dangling gap | |
| `{noteLine}` | `Note: "<customer note>"` or empty | |
| `{statusLine}` | owner alert only: `Confirmed automatically.` or `Needs your OK: <reason>.` where reason is `outside your usual area (MB12)` or `auto-confirm is off` | |
| `{emergencyList}` | labels of `emergencyReasons` joined `, ` | `No power at all, Burning smell or sparks` |
| `{etaMinutes}` | number | `45` |
| `{etaText}` | `45 minutes`, `1 hour`, `2 hours`, else `<n> minutes` | |
| `{etaClock}` | `HH:mm` of `etaAt` | `20:15` |
| `{oldWhen}` / `{newWhen}` | `when` before / after a reschedule | |
| `{reasonLine}` | `Reason: <cancelReason>.` or empty (omitted for `declined`) | |
| `{receivedReason}` | `I just need to check travel to {postcode}.` for edge/outside zones, else empty | |
| `{nextFree}` / `{nextFreeLine}` | `Tomorrow, 8–10am` / `My next free visit is <nextFree>.` or `Please call me and I'll find a time.`; for an urgent booking `{nextFreeLine}` is `If anyone is in danger call 999, or {powerCutNumber} for a power cut.` | |
| `{finalLine}` | paid: `Paid with thanks, {finalPrice}.` else `The total is {finalPrice}, payable by card, bank transfer or cash.` | |
| `{certLine}` | for services `eicr`, `consumer`, `ev`: `Your certificate follows today.`; else empty (`rewire` is a survey visit and has no certificate) | |
| `{jobLink}` | `<SITE_BASE_URL>dashboard.html#/bookings/<id>` | |
| `{manageLink}` | `<SITE_BASE_URL>index.html#manage/<ref>` | |
| `{reviewLink}` | `<domain of business.email, else prototype.invalid>/review (sample link)`, e.g. `voltmere.example/review (sample link)` | |
| `{awayMinutes}`, `{emergencyReplyMinutes}`, `{emergencyCallAfterMinutes}`, `{powerCutNumber}` | from `PROMISES` | `30`, `10`, `15`, `105` |

**Rendering rules (`renderTemplate(text, ctx)`):** replace every `{name}` found in `ctx`; an unknown placeholder is a bug: `renderTemplate` throws, `buildMessage` catches it, blanks that placeholder and calls `console.warn` (a template typo must never block a booking), and the unit test fails because it asserts that nothing threw or warned; after substitution trim each line, collapse runs of spaces, **drop lines that are empty**, and join with `\n`. Bodies may contain `*bold*` (WhatsApp markup); `WhatsAppBubble` renders it. No emoji. No exclamation marks. `buildContext(booking, state, extra)` builds `ctx` (8.1.1); `extra` carries `{ oldWhen, newWhen, nextFree, reason, etaMinutes }`.

### 10.3 Default template text (exact; `DEFAULT_TEMPLATES`)

```text
owner_new_booking
*New booking {ref}*
{customerName} · {customerPhone}
{serviceFull} · {price}
{whenLong}
{address}
{noteLine}
{statusLine}
Open: {jobLink}

owner_emergency
*URGENT: emergency request {ref}*
{customerName} · {customerPhone}
{emergencyList}
{address}
{noteLine}
Reply within {emergencyReplyMinutes} minutes. Open: {jobLink}

owner_customer_cancelled
*Cancelled by customer {ref}*
{customerName} cancelled {serviceWhen}.
{reasonLine}
That window is free again.

owner_customer_rescheduled
*Moved by customer {ref}*
{customerName} moved {service} from {oldWhen} to {newWhen}.
Open: {jobLink}

customer_received
Hi {customerFirst}, it's {ownerFirst} from {business}. I've got your request for {serviceFull}, {when}. {receivedReason} I'll confirm shortly. Ref {ref}. Need me sooner? Call {ownerPhone}.

customer_confirmed
Hi {customerFirst}, it's {ownerFirst} from {business}. You're booked in: {serviceFull}, {whenLong}, at {line1}. {priceLine} I'll message when I'm {awayMinutes} minutes away. Need to change it? Reply here or call {ownerPhone}. Ref {ref}

customer_declined
Hi {customerFirst}, it's {ownerFirst} from {business}. Sorry, I can't do {serviceWhen}. {nextFreeLine} Call {ownerPhone} if you'd like to talk it through. Ref {ref}

customer_rescheduled
Hi {customerFirst}, it's {ownerFirst} from {business}. I've moved your {service} from {oldWhen} to {newWhen} at {line1}. Does that still work? Reply here or call {ownerPhone}. Ref {ref}

customer_on_my_way
Hi {customerFirst}, it's {ownerFirst}. I'm on my way to {line1}, {etaText} away (around {etaClock}). See you shortly. Ref {ref}

customer_emergency_received
Hi {customerFirst}, it's {ownerFirst} from {business}. I've got your emergency request. If anyone is in danger, call 999 first. I aim to reply within {emergencyReplyMinutes} minutes. If you haven't heard in {emergencyCallAfterMinutes} minutes, call me on {ownerPhone}. Ref {ref}

customer_emergency_accepted
Hi {customerFirst}, it's {ownerFirst}. I'm on my way to {address}, about {etaText} away (around {etaClock}). If it's safe, switch off at the fuse box and don't touch anything wet or scorched. Ref {ref}

customer_completed
Hi {customerFirst}, it's {ownerFirst} from {business}. All done at {line1}, thanks. {finalLine} {certLine} Ref {ref}

customer_review_request
Hi {customerFirst}, it's {ownerFirst}. Thanks for choosing {business}. If you were happy with the work, a quick review helps a small firm a lot: {reviewLink}. Ref {ref}

customer_reminder
Hi {customerFirst}, it's {ownerFirst} from {business}. A reminder: I'm booked to arrive {whenLong} at {line1} for {serviceFull}. I'll message when I'm {awayMinutes} minutes away. Need to change it? Call {ownerPhone}. Ref {ref}

customer_cancelled
Hi {customerFirst}, it's {ownerFirst} from {business}. I'm sorry, I have to cancel {serviceWhen}. {reasonLine} {nextFreeLine} Ref {ref}

customer_payment_nudge
Hi {customerFirst}, it's {ownerFirst} from {business}. A quick reminder that {finalPrice} is due for {service} on {dateShort}. You can pay by card, bank transfer or cash. Thank you. Ref {ref}

customer_running_late
Hi {customerFirst}, it's {ownerFirst}. I'm running about 15 minutes late for {line1}. Sorry about that, I'm on my way. Ref {ref}

customer_need_access
Hi {customerFirst}, it's {ownerFirst}. I'm outside {line1}. Could you let me in and show me the fuse box? Ref {ref}

customer_quote_ready
Hi {customerFirst}, it's {ownerFirst} from {business}. Your written quote for {service} is ready. Reply here or call {ownerPhone} and I'll talk you through it. Ref {ref}
```

Example rendered `customer_confirmed` (Priya, EICR house, Mon 26 Oct): `Hi Priya, it's Dan from Voltmere Electrical. You're booked in: EICR safety report (House, 2–3 bed), Mon 26 Oct, morning, arriving between 8 and 10am, at 14 Alder Row. Fixed price £195, pay after the job. I'll message when I'm 30 minutes away. Need to change it? Reply here or call 07700 900412. Ref VM-1043`

### 10.4 Scheduled messages

- `reminderSendAt(booking, createdStamp)` returns the Stamp for `customer_reminder`: `<day before the booking date>T18:00` (`PROMISES.reminderHour`); if that is `<= createdStamp`, use `<booking date>T07:00` when that is `> createdStamp`; else `null` (no reminder). The function is pure; the STORE calls it only for `confirmed`, non-urgent bookings and only when `settings.remindersOn`.
- `customer_review_request` after `completeBooking(sendReview)`: `sendAt = completion stamp + PROMISES.reviewDelayMinutes`.
- `messageIsScheduled(msg, nowStamp)` = `msg.sendAt !== null && msg.sendAt > nowStamp`. There are no timers: Sent versus Scheduled is derived at render time. `sendMessageNow` flips it manually.
- Reschedule and cancel delete the booking's unsent scheduled messages; reschedule adds a fresh reminder.

### 10.5 Links (all built ONLY through these helpers; no other file builds a `wa.me`, `tel:`, `mailto:` or maps URL)

```js
waShareLink(text)                            // 'https://wa.me/?text=' + encodeURIComponent(text)   (no recipient: opens WhatsApp's contact picker; never rerouted)
waLink(phone, text, demoPhoneDigits = '')   // 'https://wa.me/' + (demoPhoneDigits || toWaDigits(phone)) + '?text=' + encodeURIComponent(text)
telLink(phone)                               // 'tel:+' + toWaDigits(phone)             e.g. 'tel:+447700900412'
smsLink(phone)                               // 'sms:+' + toWaDigits(phone)
mailtoLink(email, subject = '', body = '')   // 'mailto:' + email + '?subject=' + encodeURIComponent(subject) + '&body=' + ...
mapsLink(line1, postcode)                    // 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(line1 + ', ' + postcode)
```

`toWaDigits(input)`: strip everything except digits; `00` prefix is dropped; a leading `0` becomes `44`; a leading `44` is kept; a leading `440` becomes `44` (the `(0)` in `+44 (0)7700 900231`). `07700 900231`, `+44 7700 900231`, `447700900231` and `00447700900231` all give `447700900231`.

**Demo phone override.** `settings.demoPhoneDigits`, when non-empty, replaces the recipient of EVERY `waLink` (callers pass `state.settings.demoPhoneDigits` as the third argument). Fictional `07700 900xxx` numbers cannot receive WhatsApp, so without this the "Open in WhatsApp" moment is a dead link. `normaliseDemoPhone(input)` accepts a UK mobile (converted with `toWaDigits`) or an international number of 8 to 15 digits with `+`, and returns digits or `null`. Demo tools explains this in plain words.

### 10.6 Bubble actions (`bubbleActions(message, booking, nowStamp)`)

Returns the quick-reply buttons shown under a simulated bubble, derived from the message kind and the LIVE booking status (so a button disappears once it has been used):

| Message kind | Booking status | Buttons (`{ id, label }`) |
|---|---|---|
| `owner_new_booking` | `new` | `confirm` "Confirm", `call` "Call {customerFirst}", `open_job` "Open job" |
| `owner_new_booking` | `confirmed`, `on_the_way` | `open_job` "Open job", `call` "Call {customerFirst}" |
| `owner_emergency` | `new` | `accept_45` "Accept (45 min)", `call` "Call {customerFirst}", `open_job` "Open job" |
| `owner_emergency` | other | `open_job` "Open job", `call` "Call {customerFirst}" |
| `owner_customer_cancelled`, `owner_customer_rescheduled` | any | `open_job` "Open job" |
| every `customer_*` kind | any | none |

The Messages screen performs: `confirm` -> `confirmBooking(id)`; `accept_45` -> `acceptEmergency(id, 45)`; `call` -> `telLink` anchor; `open_job` -> hash link `#/bookings/<id>`.

### 10.7 Calendar file (`ics.js`)

`buildIcs(booking, settings)` returns the text; `icsFilename(booking, settings)` returns `voltmere-VM-1043.ics` (`business.shortName` lower-cased, non-alphanumerics to `-`, then `-` + ref); `downloadIcs(booking, settings)` creates a Blob (`text/calendar;charset=utf-8`), clicks a temporary `<a download>`, and revokes the URL (browser only; safe to import in Node).

Rules: lines end with CRLF; fold any line longer than 75 octets (CRLF + one space); escape `\`, `;`, `,` and newlines (`\n`) in text values; **`DTSTART` and `DTEND` are floating local times with no `Z` and no TZID; `DTSTAMP` alone is UTC** (RFC 5545 requires it): `parseStamp(createdAt).toISOString()` reshaped to `YYYYMMDDTHHmmssZ`.

```text
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Voltmere Electrical//Prototype//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:bk_k3j2h9x1@voltmere.example          (booking.id @ the domain of business.email, else 'prototype.invalid')
DTSTAMP:20261023T193000Z                   (createdAt in UTC; here 20:30 BST = 19:30Z)
DTSTART:20261026T080000                    (booking.start)
DTEND:20261026T120000                      (start + durationMin)
SUMMARY:Voltmere Electrical: EICR safety report
LOCATION:14 Alder Row\, MB3 4QP
DESCRIPTION:Arriving between 8 and 10am.\nRef VM-1043.\nTo change or cancel call 07700 900412.
STATUS:CONFIRMED                           (TENTATIVE when status is 'new')
END:VEVENT
END:VCALENDAR
```

---

## 11. ROUTING AND VIEW CONTRACT

### 11.1 Landing page hash routes (`index.html`)

Section anchors: `#services`, `#how`, `#reviews`, `#area`, `#faq` (plain in-page anchors; never collide with the booking hashes).

| Hash | Opens | Notes |
|---|---|---|
| `#book` | Booking sheet, Step 0 "What do you need?" | |
| `#book/<serviceId>` | Booking sheet, "When" step for that service | `serviceId` in `fault`, `eicr`, `consumer`, `sockets`, `ev`, `rewire`. Unknown id falls back to `#book`. |
| `#book/<serviceId>/<YYYY-MM-DD>/<windowId>` | Booking sheet, "Details" step with that window preselected | used by the next-free chips; invalid or no-longer-free window falls back to the "When" step with the slot-taken banner. |
| `#book/emergency` | Emergency path | |
| `#booked/<ref>` | Confirmation screen | reads the booking from the store, so it survives refresh; unknown ref -> friendly not-found |
| `#manage/<ref>` | Manage page | |

**Navigation model (exact; it fixes the trap where Back or X leaves the sheet half open).** Opening the sheet pushes exactly ONE history entry and every step change inside it uses `history.replaceState`, so the system Back gesture and the close button both close the sheet in one step, however many steps the user visited. `replaceState` fires no `hashchange`, so `js/booking/nav.js` owns a tiny route emitter and ALL navigation goes through it:

- `openBooking(opts)` pushes the hash for `opts` (`history.pushState`) and notifies subscribers. Used by every entry point outside the sheet that wants the sheet (tiles, sticky bar, header button, final CTA).
- `goBooking(opts)` replaces the current entry (`replaceState`) and notifies. EVERY in-sheet navigation uses it (service pick, Continue, the back chevron, `Edit`, the slot-taken alternatives, `#booked`, `#manage`); never an `<a href="#book/...">` click inside the sheet (that would push).
- `closeBooking()` calls `history.back()` when the sheet was opened by a push (`openedByApp`), otherwise `history.replaceState(null, '', location.pathname + location.search)` followed by a notify. `openedByApp` is true when the route went from none to a sheet route through a push; it is false when the page loaded on a deep link such as `index.html#book/fault`.
- `useBookRoute()` is the hook the landing app uses: `parseBookHash(location.hash)`, re-evaluated on the emitter, `hashchange` and `popstate` (so a plain hash link from outside the sheet, such as a hero chip, and the browser Back both work; the same listener sets `openedByApp` when a plain link opened the sheet).

`Esc`, the close button and the scrim call `closeBooking()`. The page behind keeps its scroll position and is `inert` while the sheet is open.

### 11.2 Dashboard route table (`js/dashboard/routes.js`, exact)

```js
export const ROUTES = [
  { name: 'today',     pattern: '/today',             module: './views/today.js',     title: 'Today',       tab: 'today' },
  { name: 'calendar',  pattern: '/calendar/:date?',   module: './views/calendar.js',  title: 'Calendar',    tab: 'calendar' },
  { name: 'bookings',  pattern: '/bookings/:id?',     module: './views/bookings.js',  title: 'Bookings',    tab: 'bookings' },
  { name: 'customers', pattern: '/customers/:key?',   module: './views/customers.js', title: 'Customers',   tab: 'bookings' },
  { name: 'insights',  pattern: '/insights',          module: './views/insights.js',  title: 'Insights',    tab: 'insights' },
  { name: 'messages',  pattern: '/messages',          module: './views/messages.js',  title: 'Messages',    tab: 'more' },
  { name: 'new',       pattern: '/new',               module: './views/new.js',       title: 'New booking', tab: null },
  { name: 'more',      pattern: '/more',              module: './views/more.js',      title: 'More',        tab: 'more' },
  { name: 'settings',  pattern: '/settings',          module: './views/settings.js',  title: 'Settings',    tab: 'more' },
  { name: 'demo',      pattern: '/demo',              module: './views/demo.js',      title: 'Demo tools',  tab: 'more' },
  { name: 'about',     pattern: '/about',             module: './views/about.js',     title: "What's real", tab: 'more' }
];
export const DEFAULT_ROUTE = '#/today';
```

| Route | Params / query | Nav label | Tab bar slot | Sidebar |
|---|---|---|---|---|
| `#/today` | | Today | 1 | yes |
| `#/calendar`, `#/calendar/<YYYY-MM-DD>` | `date` | Calendar | 2 | yes |
| `#/bookings`, `#/bookings/<id>` | `id` (booking id, not ref); query `f` = `new\|upcoming\|owed\|done\|cancelled\|all`, `q` = search text | Bookings | 3 | yes |
| `#/customers`, `#/customers/<key>` | `key` = customer phone digits | (highlights Bookings tab) | 3 | sidebar: Customers |
| `#/insights` | | Insights | 4 | yes |
| `#/more` | | More | 5 | yes |
| `#/messages` | query `b` = booking id to filter | (opened from the header icon; highlights More) | 5 | sidebar: Messages; header icon on every size |
| `#/new` | query `date`, `window`, `service`, `customer` (key), `source` | (FAB and sidebar button; no tab) | none | button |
| `#/settings`, `#/demo`, `#/about` | | (rows on More) | 5 | sidebar bottom links |

Unknown hash or empty hash redirects (`replace`) to `#/today`. A route whose `:id` or `:key` does not resolve shows the view's own friendly not-found, never a blank page.

**Booking detail is a ROUTE, not a sheet:** `#/bookings/<id>`. On mobile it is a full-screen immersive page (tab bar and FAB hidden, back arrow, sticky bottom action bar). From 1100px the same route renders list on the left and detail on the right. Every deep link (outbox "Open job", landing "Open Dan's dashboard", the `{jobLink}` placeholder) is `dashboard.html#/bookings/<id>`.

**Immersive routes** (`isImmersive(route)` true): `bookings` with `params.id`, `customers` with `params.key`, `new`.

### 11.3 Router API (`js/dashboard/router.js`, exact)

```js
parseHash(hash)                   // '#/bookings/bk_1?f=owed' -> { name: 'bookings', params: { id: 'bk_1' }, query: { f: 'owed' }, path: '/bookings/bk_1' }; unknown -> the 'today' route
routeHref(name, params = {}, query = {})   // routeHref('bookings', { id }, { f: 'owed' }) -> '#/bookings/bk_1?f=owed'; omits empty params/query
navigate(hash, { replace = false } = {})   // sets location.hash (or replaceState); never reloads
useRoute()                        // hook: current { name, params, query, path }; re-renders on 'hashchange'
goBack(fallbackHash = '#/today')  // history.back() when the router has seen at least one in-app hash change since page load, otherwise navigate(fallbackHash, { replace: true }) (a deep link has no history to go back to)
isImmersive(route)                // boolean
```

All in-app links use `routeHref(...)` or literal `#/...` hashes. Cross-page links use `pageHref('index.html', '#book')` / `pageHref('dashboard.html', '#/bookings/<id>')` (from `js/ui/util.js`; appends the `?now=` override when present).

### 11.4 View module contract and how the shell renders it

```js
// js/dashboard/views/<name>.js
export const title = 'Today';            // optional string; used for document.title: `${title} · ${businessShort} dashboard`
export const css = ['css/today.css'];    // optional array of stylesheet hrefs RELATIVE TO dashboard.html, loaded (and awaited) before first render
export default function TodayView({ route }) { /* Preact component; route = { name, params, query, path }; no other required props */ }
```

- A view renders its own `PageHeader` (which contains the one `<h1 data-testid="view-title" tabindex="-1">`). The shell provides header, tab bar/sidebar, FAB and strip (the toast host is mounted by `bootApp`, 11.6). The view renders ONLY the content area.
- The shell (`js/dashboard/shell.js`) does `const mod = await import(route.module)` inside try/catch; on failure (file not built yet, syntax error) it renders `views/stub.js` `StubView({ route, error })` with `data-testid="view-stub"` and the text `This screen is not built yet.` (so a half-merged repo still boots without console errors beyond the failed import). It awaits `loadCss` for `mod.css`, shows `Skeleton` while loading, wraps the view in `useErrorBoundary` (friendly `Something went wrong on this screen. Reload.` card), scrolls to top when `route.name` changes, moves focus to `[data-testid="view-title"]` after each route change, and sets `document.title`.
- A view subscribes to data with `useStore(selector)` and never reads `localStorage` itself.
- Only `js/dashboard/app.js` (WP2) imports `bootApp`. Views never call `render`.

### 11.5 Shared module signatures used across packages (exact)

```js
// js/dashboard/shared/job-actions.js  (WP5). Imported by WP4 and WP7.
export function JobActionBar({ booking, variant = 'card' })   // variant 'card' | 'bar'. Primary + secondary actions per 13.6.1; owns its sheets (ETA, complete, paid, cancel, reschedule) and Undo toasts.
export function NeedsYouActions({ booking })                  // Needs-you buttons per 13.4: Confirm | Accept + ETA, Decline, Call, WhatsApp.
export function PaidButton({ booking, size = 'md' })          // "Mark paid" button that opens the payment-method sheet; used by Insights owed rows.
export function primaryActionFor(booking)                     // pure. { id: 'confirm'|'accept'|'on_my_way'|'mark_done'|'mark_paid'|'review'|'rebook', label, icon } | null

// NOTE: showUndoToast is NOT here. It lives in js/ui/toast.js (WP2, 12.3) so every package can use it without a cross-package import.
// js/booking/booking-sheet.js  (WP3). Imported by WP6.
export function BookingSheet({ mode = 'customer', presentation = 'sheet', intent = {}, onClose, onBooked })
// js/booking/nav.js (WP3)
export function parseBookHash(hash)   // null | { kind: 'book', serviceId?, date?, windowId?, emergency? } | { kind: 'booked', ref } | { kind: 'manage', ref }
export function bookHref(opts)        // opts like { serviceId, date, windowId } | { emergency: true } | { bookedRef } | { manageRef } -> '#book/fault/2026-10-24/0'
export function openBooking(opts)     // history.pushState to bookHref(opts), notifies: opens the sheet (11.1)
export function goBooking(opts)       // history.replaceState to bookHref(opts), notifies: every in-sheet step (11.1)
export function closeBooking()        // 11.1
export function useBookRoute()        // hook: parseBookHash(location.hash), live (11.1)
```

With `presentation="sheet"` the booking frame is a `Sheet size="full"` using its `header` prop (12.3) for the back / step label / close row. `BookingSheet` props: `mode` `'customer'` (landing; steps navigate through the hash) or `'owner'` (dashboard `#/new`; steps are internal state because the dashboard owns the hash); `presentation` `'sheet'` (overlay `Sheet size="full"`, 560px dialog from 768) or `'page'` (inline panel inside the view); `intent` `{ serviceId, variantId, date, windowId, emergency, ref, customerKey, source }`; `onClose()` when the user dismisses; `onBooked(booking)` after a successful owner-mode save.

### 11.6 Dashboard boot (`js/dashboard/app.js`, WP2)

`js/dashboard/app.js` sets `window.name = 'vm-dashboard'` then calls `bootApp(App)` where `App` = `<Shell/>` + `<Watcher/>` (new-booking announcements, 11.7). **`bootApp(vnode, { container = '#app' })` does, in this order:** (1) `initStore()` inside try/catch: on the first failure it sets `sessionStorage['vm_boot_fail'] = '1'` and renders `Couldn't load saved data. Reload to reset.` with a Reload button; on a second failure in the same tab it removes `localStorage['vm_state_v1']` (try/catch) and reloads once (it cannot call `resetDemo`, which needs a working store); a successful boot removes `vm_boot_fail`; (2) `initTheme()`; (3) `trackViewport()` (5.1 item 15); (4) creates `#overlay-root` (last child of `<body>`) with its first child `<div id="toast-root">` and renders `ToastHost` into `#toast-root`; (5) EMPTIES `#app` and calls `render(vnode, #app)`. Apps never call `initTheme`, `ToastHost` or `render` themselves.

**Landing boot** (`js/landing/app.js`, WP3): sets `window.name = 'vm-site'`, then `bootApp(<LandingApp/>)`. `LandingApp` is wrapped in `useErrorBoundary`: on a render error it shows `Something went wrong on this page. Reload, or call {phone}.` (phone from the store if readable, else the default from `makeDefaultSettings()`). It composes L1 to L13, renders `<BookingSheet mode="customer" presentation="sheet" ...>` whenever `useBookRoute()` is non-null, and has an effect that keeps `document.title` and the meta description in step with `selectBrand` (13.1).

### 11.7 New-booking announcements (`js/dashboard/watcher.js`, WP2)

- Keeps an in-memory `Set` of booking ids already announced in this page session.
- On mount: if `selectUnseenBookings` has `n >= 1`, show one toast: `1 new booking since you last looked` / `<n> new bookings since you last looked`, action `View` -> `#/bookings/<id>` (n = 1) or `#/bookings?f=new` (n > 1). Mark those ids announced.
- On later store changes: each newly arrived unseen booking not yet announced shows a toast `New booking: <first name>, <when>` with action `View` -> `#/bookings/<id>`. Emergency (urgent) arrivals use tone `danger` and text `URGENT request: <first name>`.
- `document.title` is prefixed `(n) ` while `n` unseen bookings exist.
- Tab badges: Today = count of `selectNeedsYou`; Bookings = a dot when any unseen booking exists. `markSeen(id)` is called by booking detail on mount (WP5).
- Bookings made by the Demo tools simulator (source `website`, unseen) are announced like any other arrival, so the Demo tools screen shows no toast of its own (13.15). The Bookings list has a ghost button `Mark all seen` (`bookings-mark-all-seen`, 13.5) that calls `markAllSeen()`; without it the two unseen seed bookings would keep the Bookings tab dot lit until each is opened (that is expected at first launch: the dot means "something here is new").
- No sound, no vibration (WON'T).

---

## 12. UI KIT API (`js/ui/*`, `css/components.css`, owner WP2)

Import everything from the barrel: `import { Button, Sheet, toast, useStore, pageHref } from '../ui/index.js'` (path depth varies). The barrel re-exports every name below.

### 12.1 CSS conventions

- kebab-case BEM: `block`, `block__element`, `block--modifier`. State classes (global, defined in `components.css`): `is-active`, `is-selected`, `is-disabled`, `is-open`, `is-loading`, `is-new` (1.2s highlight), `is-unseen` (persistent unseen marker). Two more state classes live on `<html>` and are defined in `base.css`: `is-scroll-locked` (a sheet is open: `overflow: hidden`) and `is-keyboard-open` (5.1 item 15).
- Every package uses its OWN prefix and its OWN CSS file. Never style another package's prefix.

| Prefix | File | Owner | Used for |
|---|---|---|---|
| `ui-` | `css/components.css` | WP2 | the kit below |
| `u-` | `css/base.css` | WP2 | utilities: `u-sr-only`, `u-nowrap`, `u-muted`, `u-tabular`, `u-mono`, `u-stack` (vertical gap `--space-4`), `u-row` (flex, gap `--space-3`, wrap), `u-grow` |
| `db-` | `css/dashboard.css` | WP2 | dashboard shell and page helpers (12.2) |
| `lp-` | `css/landing.css` | WP3 | landing sections |
| `bk-` | `css/booking.css` | WP3 | booking sheet, steps, confirmation, manage |
| `td-` | `css/today.css` | WP4 | Today |
| `bl-` `bd-` `ja-` | `css/bookings.css` | WP5 | bookings list (`bl-`), booking detail (`bd-`), job-action sheets (`ja-`) |
| `cal-` | `css/calendar.css` | WP6 | Calendar and New booking page |
| `cu-` `in-` `ab-` | `css/insights.css` | WP7 | customers (`cu-`), insights (`in-`), about (`ab-`) |
| `st-` `ms-` `dm-` | `css/settings.css` | WP8 | more and settings (`st-`), messages (`ms-`), demo tools (`dm-`) |

### 12.2 Dashboard page helpers (`css/dashboard.css`, WP2; every view uses these instead of inventing layout)

| Class | Meaning |
|---|---|
| `db-page` | view container: gutter padding, bottom padding that clears tab bar + FAB + safe area, max width per 5.3 |
| `db-section` / `db-section__title` | spaced block with an optional 17px/700 title row |
| `db-stack` | vertical flex, gap `--space-4` |
| `db-row` | horizontal flex, gap `--space-3`, `align-items: center`, wraps |
| `db-grid` | 1 column, 2 columns from 768 (`db-grid--3` = 3 columns from 1100) |
| `db-list` / `db-list__item` | bordered card containing rows with dividers; item min-height 56px, full-row tap target |
| `db-sticky-actions` | sticky bottom action bar: surface bg, top border, `--shadow-bar`, padding incl. safe-area-bottom, `z-index: var(--z-sticky)` |
| `db-master-detail` | at 1100px+: grid `420px 1fr`; below 1100 only one pane shows (modifier `db-master-detail--has-detail` flips which) |
| `db-two-col` | at 1100px+: two columns (Today) |

### 12.3 Components (name, file, props, behaviour, classes)

All components accept `class` (extra classes) and spread remaining props onto the root element, so `data-testid="..."` and `aria-*` work. Props marked `*` are required.

| Component | File | Props | Behaviour and classes |
|---|---|---|---|
| `Icon` | `display.js` | `name*`, `size = 24`, `title` | Renders `<svg class="ui-icon">` from `ICONS[name]` via `h()`; `aria-hidden="true"` unless `title`. Unknown name renders a blank box and `console.warn` in dev only. |
| `Button` | `button.js` | `variant = 'secondary'` (`primary`,`secondary`,`ghost`,`danger`,`emergency`), `size = 'md'` (`sm` 44px, `md` 48px, `lg` 56px), `block`, `icon`, `iconRight`, `loading`, `disabled`, `href`, `target`, `rel`, `type = 'button'`, `onClick` | `<a>` when `href` (external https links get `target="_blank" rel="noopener noreferrer"` automatically; `tel:` and `sms:` do not) else `<button>`. Disabled uses `disabled` / `aria-disabled`. `.ui-btn`, `.ui-btn--primary\|secondary\|ghost\|danger\|emergency`, `.ui-btn--sm\|lg`, `.ui-btn--block`, `.ui-btn__icon`, `.ui-btn__label`. Primary has the 3px bottom edge. |
| `IconButton` | `button.js` | `icon*`, `label*` (aria-label), `href`, `onClick`, `badge`, `size = 'md'` (`md` 44px, `lg` 48px) | `.ui-icon-btn`, `.ui-badge` (count dot, red `--danger`, hidden when `badge` is 0/falsy, text e.g. `3`). |
| `Chip` | `display.js` | `selected`, `tone = 'neutral'` (`neutral`,`accent`,`danger`,`ok`), `icon`, `onClick`, `href` | `<button>` / `<a>` (min 44px high) when interactive, else `<span>`. `aria-pressed` when `onClick` and `selected` defined. `.ui-chip`, `.ui-chip--accent\|danger\|ok`, `.is-selected`. |
| `StatusPill` | `display.js` | `status*`, `paid`, `urgent`, `compact` | Label, icon and colours per 4.5. `status='done'` with `paid === false` shows `To collect`. `urgent` renders a second pill `URGENT`. `.ui-pill`, `.ui-pill--new\|confirmed\|on-the-way\|done\|cancelled\|owed\|urgent`. |
| `SampleTag` | `display.js` | none | `<span class="ui-tag-sample">SAMPLE</span>`. |
| `Card` | `display.js` | `as = 'div'`, `padded = true`, `tone = 'default'` (`default`,`accent`,`danger`,`sunk`) | `.ui-card`, `.ui-card--accent\|danger\|sunk`, `.ui-card--flush`. |
| `Avatar` | `display.js` | `name*`, `size = 40` | Initials from `initials(name)`, tint `ui-avatar--0..5` from `hashHue(name)`. `aria-hidden`. |
| `EmptyState` | `display.js` | `icon = 'plug'`, `title*`, `body`, `action` (a node) | `.ui-empty` centred, 48px icon in `--text-3`. |
| `Stat` | `display.js` | `label*`, `value*`, `hint`, `href`, `tone` | Tile; link when `href`. `.ui-stat`, `.ui-stat__label`, `.ui-stat__value` (display font, tabular), `.ui-stat__hint`. |
| `Banner` | `display.js` | `tone = 'info'` (`info`,`warn`,`danger`,`ok`), `icon`, `actions`, `children` | `.ui-banner`, `.ui-banner--warn\|danger\|ok`; `role="status"` (`alert` for danger). |
| `Skeleton` | `display.js` | `lines = 3`, `height` | Shimmering bars; static under reduced motion. `.ui-skeleton`. |
| `PageHeader` | `display.js` | `title*`, `subtitle`, `back` (`{ href, label }`), `actions` (node), `eyebrow` | Renders `<h1 data-testid="view-title" tabindex="-1">`. `back` renders a 44px `arrow-left` IconButton (`data-testid="page-back"`). `.ui-page-header`. |
| `BrandMark` | `display.js` | `size = 32` | Inline SVG of the logo mark (same artwork as `img/logo-mark.svg`). |
| `TextLink` | `display.js` | `href*`, `inline`, `external`, `children` | `.ui-link`, `.ui-link--inline` (exempt from the 44px rule). External https links open in a new tab with `rel="noopener noreferrer"`. |
| `Field` | `form.js` | `label*`, `id*`, `hint`, `error`, `errorTestid`, `required`, `children` | `<label for>` above the control; hint `.ui-field__hint`; error `.ui-field__error` with `role="alert"` and `data-testid={errorTestid}`. `.ui-field`. |
| `Input` | `form.js` | `id*`, `value`, `onInput`, `type = 'text'`, `error`, plus any native attr (`inputmode`, `autocomplete`, `autocapitalize`, `enterkeyhint`, `maxlength`, `placeholder`) | 52px, 16px font, `aria-invalid` when `error`. `.ui-input`, `.is-invalid`. |
| `Select` | `form.js` | `id*`, `value`, `onChange`, `options*` (`[{ value, label }]`) | Native `<select>`, 52px. `.ui-select`. |
| `Textarea` | `form.js` | `id*`, `value`, `onInput`, `rows = 3` | `.ui-textarea`. |
| `Switch` | `form.js` | `checked*`, `onChange(checked)*`, `label*`, `description`, `disabled`, `id` | `<button role="switch" aria-checked>` in a 56px row; the whole row is the target. Drawn as a breaker lever: a 52x32 rounded body with a small rectangular lever that flicks up/down and a green LED dot when on (state also shown by the word `On` / `Off` for non-colour signalling). `.ui-switch`, `.ui-switch__lever`, `.ui-switch__led`, `.is-on`. |
| `Segmented` | `form.js` | `options*` (`[{ value, label, icon, testid }]`), `value*`, `onChange(value)*`, `ariaLabel*`, `size = 'md'` | `role="radiogroup"`; options are `<button role="radio" aria-checked>` >= 44px; arrow keys move selection (roving tabindex: the selected option is `tabindex="0"`, the others `-1`); a Segmented wider than its container scrolls inside its own wrapper and scrolls the selected option into view on mount; each option gets `data-testid={option.testid}`. `.ui-seg`, `.ui-seg__opt`, `.is-selected`. |
| `Stepper` | `form.js` | `value*`, `onChange*`, `step = 5`, `min = 0`, `max = 99999`, `format = gbp`, `label*` | Minus and plus 48px buttons around a numeric input (`inputmode="numeric"`). `.ui-stepper`. testids come from the caller via `testids = { input, minus, plus }`. |
| `Sheet` | `sheet.js` | `open*`, `onClose*`, `title*`, `description`, `size = 'auto'` (`auto`,`full`), `header` (node; replaces the default sticky header, `title` is then rendered visually hidden but still names the dialog), `footer` (node), `dismissible = true`, `initialFocus` (ref), `testid`, `children` | See 12.4. |
| `ConfirmDialog` | `sheet.js` | `open*`, `title*`, `body` (string or node, e.g. a `Select`), `confirmLabel = 'Confirm'`, `cancelLabel = 'Cancel'`, `tone = 'default'` (`danger` makes the confirm button red), `onConfirm*`, `onCancel*` | Built on `Sheet size="auto"`. testids `confirm-dialog`, `confirm-ok`, `confirm-cancel`. |
| `toast` / `dismissToast` / `showUndoToast` / `ToastHost` | `toast.js` | `toast({ message*, actionLabel, onAction, duration = 6000, tone = 'default' })` returns an id | `ToastHost` is mounted ONCE per page by `bootApp` into `#toast-root`, outside `#app` (never by a view or the shell); `role="status" aria-live="polite"` (a `tone: 'danger'` toast uses `role="alert"`); max 2 visible; positioned with `bottom: calc(var(--toast-bottom, 16px) + var(--safe-bottom))`. Defaults: `components.css` sets `--toast-bottom: 16px`; `dashboard.css` sets `calc(var(--h-tabbar) + var(--h-fab) + 28px)` below 1100px (it clears the tab bar AND the FAB) and `24px` from 1100px; `landing.css` sets `calc(var(--h-stickybar) + 12px)` below 768px. Toasts are `pointer-events: none` except their action button. testids `toast`, `toast-action`. Actions are real buttons >= 44px. Auto-dismiss pauses on hover/focus. **`showUndoToast(message, undoToken, { duration = 6000 } = {})` lives here, not in job-actions:** a toast with an `Undo` action that calls `store.undo(undoToken)` and shows `Too late to undo.` when the result is `stale`. |
| `WhatsAppBubble` | `whatsapp.js` | `body*`, `direction = 'out'` (`out` = to customers, `in` = owner alerts), `stateLabel` (`Sent (simulated)` or `Scheduled for Fri 18:00 (simulated)`), `scheduled`, `time`, `actions` (`[{ id, label, href }]`), `onAction(id)`, `toLabel` | Parses `*bold*` into `<strong>` safely (no HTML injection), keeps newlines (`white-space: pre-wrap`), shows `check-check` for sent and `clock` for scheduled. Action buttons are full-width white pills >= 44px under the bubble. `.ui-bubble`, `.ui-bubble--out\|in`, `.ui-bubble__actions`, `.ui-bubble__meta`. |
| `PhoneMock` | `whatsapp.js` | `title`, `subtitle`, `children` | Rounded phone frame with a `--chat-bg` wallpaper header strip; hosts bubbles. `.ui-phone`, `.ui-chat`. Used by the landing confirmation DEMO panel. |
| `PrototypeNotice` | `notice.js` | `variant = 'strip'` (`strip`,`footer`,`inline`), `page = 'landing'` (`landing`,`dashboard`), `children` (inline only), plus rest props | Exact wording, styling and hit area in 3.7. `strip`: `data-testid="prototype-strip"`, link `data-testid="prototype-strip-link"`. `footer`: `data-testid="footer-disclosure"`. |
| `ThemeToggle` | `theme.js` | `variant = 'icon'` (`icon`,`segmented`) | `icon`: one IconButton that cycles Auto -> Light -> Dark, `aria-label="Theme: Auto"` (current), icon `sun-moon`/`sun`/`moon`, `data-testid="theme-toggle"`. `segmented`: `Segmented` with testids `theme-auto`, `theme-light`, `theme-dark`. |
| `getTheme` `setThemeChoice` `applyTheme` `initTheme` | `theme.js` | | `setThemeChoice(choice)` calls `store.setTheme`, writes `vm_theme`, calls `applyTheme` (sets/removes `data-theme` on `<html>`, updates both `theme-color` metas: light `#FBF8F2`, dark `#0B1020`). `initTheme()` reconciles at boot. |
| `useStore` `useNow` `useMediaQuery` `useBrand` | `hooks.js` | 8.8 | |
| `cx` `uid` `copyText` `pageHref` `pageTarget` `focusTitle` `bootApp` `loadCss` | `util.js` / `boot.js` / `load-css.js` | `cx(...)` joins truthy class names; `uid(prefix)` counter id; `copyText(text)` returns `Promise<boolean>` (Clipboard API, textarea fallback); `pageHref(file, hash = '')` returns `file + clockQuery() + hash`; `pageTarget(file)` returns `'vm-dashboard'` for `dashboard.html` and `'vm-site'` for `index.html` (cross-page links set `target` to it and NO `rel="noopener"`); `focusTitle()` focuses `[data-testid="view-title"]`; `bootApp(vnode, { container = '#app' })` (steps in 11.6); `loadCss(href)` returns a Promise and is idempotent | |

### 12.4 `Sheet` behaviour (exact)

- Rendered into its OWN container: each `Sheet` instance appends a fresh `<div class="ui-sheet-root">` to `<div id="overlay-root">` (created as the last child of `<body>` if absent) and calls `render()` into THAT div only, never into `#overlay-root` itself (a second `render()` on a shared container replaces the first tree, 6.1.1 trap 2), because the vendored Preact has no portal. Prop updates re-render the same container; closing or unmounting calls `render(null, container)` and removes the div. `#overlay-root` also holds `<div id="toast-root">` as its FIRST child, created by `bootApp`.
- **Header.** Default: a sticky header with the `<h2>` title and a 44px close button (`sheet-close`). With the `header` prop that node replaces it and the `<h2>` becomes visually hidden (`u-sr-only`) so `aria-labelledby` still works; the booking flow uses this for its back / step / close row.
- **Keyboard.** The panel's `bottom` is `var(--kb-inset, 0px)` and its heights subtract the same variable (5.1 item 15), so the sticky footer stays above the on-screen keyboard.
- `role="dialog" aria-modal="true" aria-labelledby=<title id>`; `aria-describedby` when `description`. The title is an `<h2>` (the page keeps exactly one `<h1>`).
- On open: remember `document.activeElement`; set `inert` on `#app` (and `aria-hidden="true"`); add `is-scroll-locked` to `<html>` (`overflow: hidden`); move focus to `initialFocus` or the first focusable in the body or the close button.
- Focus trap: `Tab` / `Shift+Tab` cycle inside the panel. `Esc` calls `onClose` when `dismissible`. Scrim click calls `onClose` when `dismissible`.
- On close: remove `inert`, unlock scroll, restore focus to the remembered opener (if still in the document).
- Layout: below 768px the panel is anchored to the bottom, full width, `--r-xl` top corners, grab handle, sticky header with title and a 44px close button, scrollable body (`overscroll-behavior: contain`), sticky footer (padding includes `--safe-bottom`); `size="full"` makes it `100dvh`. From 768px a centred dialog 480px (`auto`) or 560px (`full`), `max-height: 90dvh`. Slide-up `--dur-sheet` `--ease-out`; under reduced motion it simply appears.
- Nested sheets: a sheet opened from inside a sheet stacks (z-index `--z-sheet` + 1) and the lower panel gets `inert` while the upper one is open; closing the top one removes that and restores focus to its opener.

### 12.5 Icons module (`js/ui/icons.js`)

`export const ICONS = { name: [[tag, attrs], ...], ... }` for every name in 4.9, plus `export const ICON_NAMES = Object.keys(ICONS)`. No other module contains SVG path data except `BrandMark` and `BreakerArt`.

---

## 13. SCREEN SPECS

Conventions for every screen spec:

- `{ownerFirst}`, `{name}`, `{shortName}`, `{phone}`, `{areaName}`, `{areaText}`, `{hoursText}`, `{schemeLine}` come live from `useBrand()`. `{awayMinutes}`, `{freeChangeHours}`, `{arrivalWindowHours}` etc. come from `PROMISES`. Prices come from `selectServices` / `servicePriceLabel`. Never hard-code any of these in copy.
- `data-testid` values for every element are listed in section 14 (defined once there, authoritative). Where this section names a testid in parentheses it is only a pointer: build every element listed for your screen in 14 with exactly that testid.
- "Copy" in backticks is exact (apart from interpolated `{...}`). Dates and windows are computed (3.4).
- Every `waLink(phone, text, demoPhoneDigits)` call passes `brand.demoPhoneDigits` (8.6) so the demo phone override works everywhere; `waShareLink` never does. A mutation failure that a screen does not handle specially follows the generic rule in 8.3.
- "Empty state" and "loading" are specified where they exist. There is no network, so there are no loading spinners; the only skeleton is the view loader (11.4).
- Dark mode and 320px must work for every element. Status is never colour-only.

### 13.1 Landing page (`index.html`, WP3)

Document `<title>`: `{name}: {tagline}`; meta description: `Book {name} online in 60 seconds. Real availability, clear prices, a certificate with every job. Prototype with sample data.` Both stay in step with the LIVE brand: an effect in `LandingApp` re-sets `document.title` and the meta description whenever `selectBrand` changes, so a rebrand made in another tab shows within 2 seconds without a reload (F6). Section order and ids:

| # | Section | Anchor |
|---|---|---|
| L1 | Prototype strip | |
| L2 | Header (sticky) | |
| L3 | Hero | |
| L4 | Trust bar | |
| L5 | Emergency strip | |
| L6 | Services and prices | `#services` |
| L7 | How it works | `#how` |
| L8 | Reviews (sample) | `#reviews` |
| L9 | Meet Dan and coverage | `#area` |
| L10 | FAQ | `#faq` |
| L11 | Final call to action | |
| L12 | Footer | |
| L13 | Sticky action bar (below 768px) | |

**L1 Prototype strip.** `PrototypeNotice variant="strip" page="landing"` (3.7).

**L2 Header.** Sticky, `--h-header` + safe-top, paper background at 92% opacity with `backdrop-filter: blur(8px)` (solid `--bg` fallback). Left: `BrandMark` 32px, wordmark `{shortName}` (display, 800, 20px, one line, ellipsis) over `{descriptor}` in 12px tracked caps. Right on mobile: ONE 44px round call `IconButton` (`phone`, `tel:`, `aria-label="Call {ownerFirst}"`). From 768px also: the phone number as a text link and a small primary `Book a visit` button (opens `#book`); from 1100px also the text links `Services`, `How it works`, `Reviews`, `Area`, `FAQ` (anchors) between brand and phone (5.2: they do not fit at 768). No hamburger.

**L3 Hero.** Navy `--panel`, bottom corners `--r-2xl`, faint wiring-grid background (`img/hero-wiring.svg`, 6% opacity). Top to bottom at 375:

1. **Live availability** (`live-availability`): a pulsing 8px `--dot-free` dot (static under reduced motion) and the label `Next free repair visits`, then up to THREE chips from `nextFreeSlots(state, 'fault', 3)`, each showing its `human` text (`Today, 3–5pm`, `Tomorrow, 8–10am`, `Mon 26 Oct, 8–10am`). The first chip is the soonest, styled accent. Each chip (44px) opens `#book/fault/<date>/<windowId>` (the Details step with that window preselected). Recomputed on every store change and every minute (`useNow(60000)`). Variants: if today is in `fullDays`, prepend the line `{ownerFirst} is fully booked today.`; if no slot exists in the horizon, replace chips with `Diary full for the next {maxDaysAhead} days. Call {ownerFirst}` and a call button. The label says "repair visits" because it is computed for the `fault` service; other services compute their own Soonest card in the booking sheet.
2. **H1** (`--fs-h1`, display 800): `A proper electrician, booked in 60 seconds.` The words `60 seconds` are wrapped in `<span class="lp-hero__accent">` coloured `--cta` with a hand-drawn SVG underline.
3. **Sub** (17px, max 2 lines at 375): `Pick a time from {ownerFirst}'s real diary. Clear prices, a certificate with every job, and you pay after.`
4. **Trust line** (`hero-trust`, `--fs-14` (there is no 13px token), wraps to at most 2 lines): `4.9 rating (sample) · Certificate with every job · Insured (sample)`.
5. Eyebrow `What do you need?` then a 2x2 tile grid (min tile height 88px, gap 12px). Tiles (testid `hero-tile-<serviceId>`), each a button opening `#book/<serviceId>`:

| Service | Title | Sub | Price (live) |
|---|---|---|---|
| `fault` | `Something's gone wrong` | `Tripping, dead sockets, burning smell` | `servicePriceLabel` e.g. `From £75` |
| `eicr` | `Landlord safety report` | `EICR certificate` | `From £150` |
| `sockets` | `Sockets, lights and small jobs` | | `From £85` |
| `consumer` | `New fuse box` | `Consumer unit upgrade` | `From £540` |

   A tile whose service is inactive is not rendered. Each tile: 44px service icon in a `--surface-2` rounded square, title 16px/700, sub 14px, price 14px/700 tabular.
6. Three quiet 44px text-link rows: `EV charger, rewire and more: see all prices` (`#services`), `Do you cover me? Check your postcode` (`#area`, focuses `coverage-input`), `Not sure what you need? Message {ownerFirst} on WhatsApp` (`waLink(phone, "Hi {ownerFirst}, I'd like to book an electrician. Not sure what I need yet.")`).

At 768px+ the hero is two columns (copy left, tile card right); H1 grows to 56px. First screen at 375x812 MUST show: live availability with at least the first chip, the H1, the trust line, and at least the first row of tiles, plus the sticky bar. At 320x568 the live availability block, the H1 and the sticky bar MUST be visible without scrolling (the tiles may start below the fold there).

**L4 Trust bar** (`trust-bar`, visually-hidden heading `Why customers choose us`). Four items, 2x2 on mobile and 4 across from 768, each a 24px icon and text:
1. `star` `Rated 4.9 out of 5` / `212 reviews` + `SampleTag`
2. `shield-check` `Part P registered` / `Certificate with every job` + `SampleTag`
3. `badge-check` `£2m insured` / `Public liability cover` + `SampleTag`
4. `receipt` `Prices agreed first` / `Fixed for standard jobs, written quote for bigger ones`

Below: 12px muted `{schemeLine}`.

**L5 Emergency strip** (`emergency-strip`). Native `<details>`, collapsed by default. Summary row (`emergency-toggle`, 56px, danger-tint background, 4px `--danger` left border): `siren` icon, title `Emergency? Fire or shock: call 999.`, small text `Tap for what to do next`, chevron. Open content:

```text
1. Fire, or someone has had a shock: call 999.
2. If it is safe, switch off at the fuse box (consumer unit).
3. Do not touch anything wet, scorched or sparking.
```

Then two 52px buttons (stacked on mobile): solid red `Call {ownerFirst} now · {phone}` (`emergency-call`, `tel:`) and outline `Request an emergency visit` (`emergency-request`, opens `#book/emergency`). Footnote 12px: `Emergency visits {emergencyHoursText}. From {gbp(price of the live emergency service)} including the first hour. {ownerFirst} aims to be with you within {emergencyArrivalHours} hours.` When `takingEmergencies` is false: the request button is not rendered and the footnote becomes `Not taking emergency visits right now. Call 999 for fire or shock, or {powerCutNumber} for a power cut.`

**L6 Services and prices** (`#services`). H2 `Clear prices, agreed before we start`. Sub `"From" prices are for standard jobs. If something bigger turns up, {ownerFirst} quotes in writing before any extra work.` Cards in a `services-list`: every ACTIVE service except `emergency`, in settings order. Each card is ONE button (whole card, min-height 72px) opening `#book/<id>`: icon tile; name; description (max 2 lines); right-aligned display-font price from `servicePriceLabel`; under it the `priceNote`; meta chips `durationLabel` and the `tag` chip when present. `eicr` also shows three mini price chips from its variants (`Flat £150`, `2–3 bed house £195`, `4+ bed £260`). `rewire` shows `Free`. 1 column mobile, 2 at 768, 3 at 1100. Footnote 12px: `Prices include standard materials and certification. No call-out fee on booked visits. Sample prices.` If no service is active, the list is replaced by `No services are on offer right now. Call {ownerFirst}.` with a Call button (the same text replaces Step 0 of the booking sheet).

**L7 How it works** (`#how`). H2 `Booked in a minute, sorted in a visit`. Three numbered steps (big numerals, connecting line):
1. `Pick a time` `You see {ownerFirst}'s real diary, not a we'll-call-you-back form.`
2. `Get it in writing` `Instant confirmation by WhatsApp or text, plus a reminder the evening before.`
3. `{ownerFirst} turns up, tidy and on time` `A message when {ownerFirst} is {awayMinutes} minutes away. Certificate and receipt when the job is done. You pay after.`

Closing line: `Free to change or cancel up to {freeChangeHours} hours before.`

**L8 Reviews (sample)** (`#reviews`). H2 `What customers say`; chip `SAMPLE REVIEWS, not real customers` (`reviews-sample-chip`); five star icons and `4.9 out of 5 from 212 reviews (sample)`; the three stacked cards from 3.5 (no carousel; 3 columns from 768): stars, quote, `Avatar`, name and job type, tag `Sample review · <town>`.

**L9 Meet {ownerFirst} and coverage** (`#area`). Dan card (`dan-card`): avatar `img/dan-avatar.svg` (alt empty, decorative), `Hi, I'm {ownerFirst}.`, paragraph `Fourteen years an electrician, mostly in and around {areaName}. It's just me and my apprentice Sam, so when you book, I'm the one who turns up. Part P registered, 18th Edition qualified, fully insured (all sample).`, then a labelled row `Qualifications` + `SampleTag` and four chips: `City & Guilds 2365`, `18th Edition`, `Inspection and Testing 2391`, `Part P registered`. Coverage card: heading `Do I cover your postcode?`; `Input` (`coverage-input`, postcode attributes from 5.1, placeholder `e.g. MB3 4QP`) and a 52px `Check` button (`coverage-check`; Enter also submits). Result region (`coverage-result`, `aria-live="polite"`; the zone comes from `postcodeZone(value, brand)`):

| `postcodeZone` | Result copy | Buttons |
|---|---|---|
| `invalid` | `Enter a UK postcode, like MB3 4QP.` | none |
| `covered` | `Yes, you're in my patch. Usually about 20 minutes away.` (green) | `Book a visit` (`coverage-book`) |
| `edge` | `At the edge of my area. You can still book; {ownerFirst} will confirm any travel charge by message.` (amber) | `Book a visit` (`coverage-book`) |
| `outside` | `Sorry, that's a bit far for me. Call or message me and I can usually recommend someone.` (neutral) | `Call {ownerFirst}`, `WhatsApp` |

Under it: town chips `{towns}` with caption `(fictional)`, and `{hoursText}. Emergencies {emergencyHoursText}.`

**L10 FAQ** (`#faq`, `faq`). H2 `Quick answers`. Six native `<details>` (summary min 56px), testids `faq-item-0` to `faq-item-5`:
0. `How much will it cost?` -> `The price on each service is what you pay for standard jobs. If {ownerFirst} finds something bigger, you get the price in writing before any extra work. You pay after the job by card, bank transfer or cash.`
1. `Do I need to be home?` -> `Someone over 18 needs to let {ownerFirst} in and show where the fuse box is. Landlords can book with a tenant's number and arrange access by message.`
2. `Will I get a certificate?` -> `Yes. Notifiable work is registered through {ownerFirst}'s competent person scheme and you get the certificate by email or WhatsApp.`
3. `What is an EICR and do I need one?` -> `An Electrical Installation Condition Report is a safety inspection. Landlords in England must have rented homes inspected at least every 5 years, and buyers and lenders often ask for one. Findings are coded C1, C2, C3 or FI and {ownerFirst} explains each in plain English.`
4. `What does arrival window mean?` -> `{ownerFirst} arrives at some point in a {arrivalWindowHours}-hour window, for example 10am to 12, and messages you when {ownerFirst} is {awayMinutes} minutes away.`
5. `How do I change or cancel?` -> `Use the Manage booking link on your confirmation, reply to your confirmation message, or call {ownerFirst}. It's free up to {freeChangeHours} hours before.`

**L11 Final call to action** (`final-cta`). Navy panel. Line `Your next free repair visit is {human}.` (live from `nextFreeSlot(state,'fault')`; fallback `Diary full for now. Call {ownerFirst}.`). Full-width 56px primary `Book a visit` (`final-book`, `#book`). Two secondary buttons: `Call {ownerFirst}` (tel) and `WhatsApp` (`waLink`, prefilled `Hi {ownerFirst}, I'd like to book an electrician.`).

**L12 Footer** (`footer`). Brand block (`BrandMark`, `{name}`), `{phone}` (tel link), `{email}` (mailto link), `{areaText}`, `{hoursText}`; `{schemeLine}`; `PrototypeNotice variant="footer"` (`footer-disclosure`); links (each 44px high): `Owner login (demo) →` (`footer-owner-link`, `pageHref('dashboard.html', '#/today')`) and `What's real in this prototype` (`footer-about-link`, `pageHref('dashboard.html', '#/about')`); `Appearance` with `ThemeToggle variant="segmented"`; plain text (not links) `Privacy and Terms: not in this prototype`. No cookie banner. Bottom padding clears the sticky bar.

**L13 Sticky action bar** (`sticky-bar`, below 768px). Fixed bottom, `--h-stickybar` + safe-bottom, surface background, top border, `--shadow-bar`. Left to right: `Call` (`sticky-call`, `phone` icon over a 12px label, 84px wide, `tel:`), `WhatsApp` (`sticky-whatsapp`, `message-circle` over label, 84px, `waLink` prefilled `Hi {ownerFirst}, I'd like to book an electrician.`), primary `Book a visit` (`sticky-book`, flex 1, 56px, opens `#book`). Hidden while the booking sheet is open (`html.is-scroll-locked`) and while the on-screen keyboard is open (`html.is-keyboard-open`, 5.1 item 15). Below 375px the two small buttons are 64px wide (5.2) so the `Book a visit` label always fits.

### 13.2 Booking flow (customer mode; `js/booking/*`, WP3)

**13.2.1 Frame.** `Sheet size="full"` with `testid="booking-sheet"`. Header, passed as the `Sheet` `header` prop (48px targets): back chevron (`booking-back`, hidden on the first step), step label (`Step 1 of 2`, `Step 2 of 2`; none on step 0 or confirmation), close X (`booking-close`). Under the header a two-segment progress bar (`booking-progress`). A slim dashed `Prototype` ribbon sits at the top of the body; on the Details and Emergency steps it also holds the small dashed button `Demo: fill sample details` (`demo-fill`), which fills Priya Nair's details (`SAMPLE_CUSTOMER`) and moves focus to the submit button. The LAST ITEM OF THE SCROLLING BODY on every step (deliberately not part of the sticky footer, which would eat a quarter of a 320x568 screen) is the line `Rather talk to someone? Call {ownerFirst} or WhatsApp` with two 44px links (`booking-call`, `booking-whatsapp`). Drafts autosave to `sessionStorage['vm_draft_v1']` (service, variant, date, window, name, phone, postcode, line1, note, emergency reasons) and restore on refresh; cleared on success. On restore the URL wins for service, date and window; name, mobile, postcode, house number and street, note and emergency reasons are always restored; the variant is restored only when the draft's service equals the URL's service.

**13.2.2 Steps.**

*Step 0, "What do you need?" (`#book`, only when no service is chosen).* A red-tint row at the top (`booking-emergency-link`): `Emergency right now? Request an urgent visit` (hidden when emergencies are off). Then one tappable card (a `<button>`, not a radio) per active non-emergency service (`service-option-<id>`, min 64px): icon, name, price label, `durationLabel`. One tap commits and advances with `goBooking({ serviceId })` (11.1). Helper: `Not sure? Choose Fault finding. {ownerFirst} will work it out on the day.` No other input.

*Step 1, "When suits you?" (`#book/<serviceId>`).*
1. Service chip row (`booking-service-chip`): `{name} · {price label} · Change` (Change goes to `#book`).
2. EICR only: `Segmented` `Property size` with options `Flat £150` (`eicr-size-flat`), `House, 2–3 bed £195` (`eicr-size-house`, default), `House, 4+ bed £260` (`eicr-size-large`); prices from the service variants. The size is asked HERE, before the slot, so the price never changes later.
3. `Soonest` card (`soonest-card`, amber outline): `Soonest: {slotHuman}` for THIS service (so an EICR shows its own half-day answer) and a `Pick this` button (`soonest-pick`) that selects it.
4. `Or choose another day` and the **DayPicker** (`js/booking/day-picker.js`): the days from `getBookableDays(state, { serviceOrBlocks, ownerMode })` (today to horizon; owner mode 28 days), each a cell (`day-chip-<date>`, a `<button aria-pressed>`, min 44x56) with weekday short, date number, today ring, and a status dot with an `aria-label` such as `Sat 24 Oct, 1 left`. The cell level comes from the SERVICE-specific `freeSlots`, NOT from `load.level` (9.3): `status.kind` of `past`, `beyond`, `dayoff` or `closed` -> `Closed`; kind `full` or `freeSlots === 0` -> `Full`; `freeSlots === 1` -> `1 left`; otherwise `2 or more windows free`. Layout: wrapping grid, 7 columns from 375px and 5 columns below 375px (5.4). Disabled days (`Closed`, `Full`) are not selectable. A selected day is `is-selected`. On entry the selected day is the date of the Soonest slot (so its windows are listed at once); no window is preselected.
5. Windows for the selected day: full-width 56px buttons (`window-<windowId>`, `aria-pressed` when chosen). Single-window services list the four windows `8–10am`, `10am–12`, `1–3pm`, `3–5pm`, each with helper `Arrive between 8 and 10`. Half-day services list two: `Morning · arrive 8–10am` (`window-0`) and `Afternoon · arrive 1–3pm` (`window-2`) with the note `Takes about half a day.` Windows in state `booked` or `blocked` are disabled and labelled `Booked`; `past`, `too_soon`, `closed` windows are not rendered. If the chosen day has nothing free: `Nothing free that day. Try another day.` (`no-slots-day`).
6. If nothing is free anywhere in the horizon (`no-slots`): `No free times for this job in the next {maxDaysAhead} days. Call or WhatsApp {ownerFirst} and I'll fit you in if I can.` with `Call` and `WhatsApp` buttons.
7. Sticky footer: `booking-summary` (`{dateShort} · arrive {arriveLabel}` or `Choose a time to continue`) and the primary `Continue` (`booking-continue`; `aria-disabled` until a window is chosen, helper `Choose a time to continue`). Reassurance under it: `No payment now. Free to change up to {freeChangeHours} hours before.` Selection is announced through an `aria-live="polite"` region. Continue calls `goBooking({ serviceId, date, windowId })` (11.1), i.e. `#book/<serviceId>/<date>/<windowId>`.

*Step 2, "Your details" (`#book/<serviceId>/<date>/<windowId>`).* No account, four fields.
1. Ticket (`booking-ticket`): service and variant, `{dateShort} · arrive {arriveLabel}`, price (`Fixed £195` for `fixed`/`by_size`, `From £75` for `from`, `Free` for `free`), and an `Edit` link back to Step 1.
2. Fields, labels above, 16px, 52px (attributes in 5.1): `Your name` (`field-name`); `Mobile number` (`field-phone`, helper `For your confirmation and the {awayMinutes}-minutes-away message. No marketing.`); `Postcode` (`field-postcode`) with a live hint (`postcode-hint`) from `postcodeZone` that never blocks: covered `In {ownerFirst}'s area` (green), edge `On the edge of the area: {ownerFirst} will confirm any travel charge`, outside `A bit outside the area: you can still send it`, none while empty or invalid; `House number and street` (`field-line1`). Optional disclosure `+ Add a note for {ownerFirst}` (`note-toggle`) revealing a textarea (`field-note`, placeholder `e.g. flat 3, buzzer broken, dog is friendly`, max 300).
3. Validation inline on blur and on submit; messages exactly as 13.2.3, rendered through `Field error`; on submit focus moves to the first invalid field; the button stays tappable.
4. Sticky primary button (`booking-submit`): `Confirm booking · £195` (`from` priced: `Confirm booking · from £75`; free: `Confirm booking`). Under it: `No payment now. You pay {ownerFirst} after the job.` and the consent line `By booking you agree {ownerFirst} may message you on this number about this visit.`
5. Submit calls `createBooking`. `slot_taken`: show the banner (`slot-taken-banner`) `That window was just taken. Your details are saved. Here are the next free times:` with up to three chips (`slot-alt-0` to `slot-alt-2`) from `alternatives`; choosing one updates date and window and keeps every typed field; the user taps Confirm again. `invalid`: inline errors. `service_unavailable`: banner `That service isn't available right now. Please call {ownerFirst}.` Success: clear the draft and `goBooking({ bookedRef: ref })`. The submit handler ignores re-entry while a submit is in flight (8.3).

*Emergency path (`#book/emergency`).* Skips the date. At the top a danger `Banner` `If there is a fire, or someone has had a shock, call 999.` Title `What is happening?`. If no reason is chosen on submit the error `Choose what is happening` shows under the chips (`error-reasons`). Multi-select chips (`emergency-reason-<id>`, 48px), ids and labels from `EMERGENCY_REASONS`: `no_power` `No power at all`, `burning` `Burning smell or sparks`, `tripping` `Keeps tripping and won't reset`, `water` `Water has got in`, `other` `Something else`. Fields: name, mobile, postcode (required), house number and street (optional), note (optional). Button `Send emergency request` (`emergency-submit`, emergency variant) and a link `Rather call? {phone}` (`emergency-phone-link`). Creates an urgent booking (`createBooking({ urgent: true, date: today, windowId: null, serviceId: 'emergency', ... })`). If `takingEmergencies` is false the path shows only the `Banner` (`emergency-off-banner`) `Not taking emergency visits right now. Call 999 for fire or shock, or {powerCutNumber} for a power cut.` and a Call button.

**13.2.3 Validation messages (exact; these are the return values of the core validators).**

| Field | Empty | Invalid |
|---|---|---|
| name | `Enter your name` | (fewer than 2 characters) `Enter your name` |
| phone | `Enter your mobile number` | `That doesn't look like a UK mobile. It should start 07 or +44 7` |
| postcode | `Enter your postcode` | `Enter a UK postcode, like MB3 4QP` |
| line1 | `Enter your house number and street` | n/a |
| emergency reasons | `Choose what is happening` | n/a |

**13.2.4 Owner mode differences** are specified with the New booking screen (13.8). In owner mode the same components render with `ownerMode: true` slot logic, `Source` control, editable price, `Send confirmation message` switch, and no consent line.

### 13.3 Confirmation and Manage (customer mode, WP3)

**Confirmation (`#booked/<ref>`, `confirmation`).** Header strip tinted `--ok-tint`; no back button; close X (closes the sheet to the landing page).

1. `BreakerArt` (`breaker-art`): six breaker switches; the third flips ON over `--dur-flip` with `--ease-spring` and a small scale pulse; static final state under reduced motion.
2. Title (`confirmation-title`): confirmed `You're booked in, {first}.`; status `new` or urgent `Request sent, {first}.`
3. Status chip (`confirmation-status`), live from the store: `Confirmed`, or `Waiting for {ownerFirst} to confirm`. It flips to `Confirmed` when the dashboard confirms in another tab. Full mapping from the live status: `new` -> `Waiting for {ownerFirst} to confirm`; `confirmed` -> `Confirmed`; `on_the_way` -> `{ownerFirst} is on the way`; `done` -> `Done`; `cancelled` -> `Cancelled`.
4. Ticket (`confirmation-ticket`): reference in monospace (`confirmation-ref`), service and variant, `{dateShort} · arrives {arrive}`, address, price (`Fixed £195 · pay after the job` or `From £75 · pay after the job`), and the line `{ownerFirst} gets a WhatsApp alert (simulated in this prototype).`
5. `What happens next` timeline (`confirmation-timeline`):
   - `Just now` `{ownerFirst} has your booking on WhatsApp (simulated)` (ticked)
   - `{Fri evening}` `Reminder text with your arrival window` (label from `reminderSendAt`: `<weekday> evening` when 18:00 the day before, `Morning of the visit` when 07:00; omitted when there is no reminder)
   - `On the day` `A message when {ownerFirst} is {awayMinutes} minutes away`
   - `After the job` `Certificate and receipt, then a quick review request`
   Urgent variant: `Now` `{ownerFirst} has been alerted (simulated)`; `Within {emergencyReplyMinutes} minutes` `A reply with an arrival time`; `If you haven't heard in {emergencyCallAfterMinutes} minutes` `Call {phone}`. The urgent screen also repeats the three safety lines from L5.
6. Buttons (52px): `Add to calendar` (`add-to-calendar`, `downloadIcs`; not shown for urgent), `Message {ownerFirst} on WhatsApp` (`confirmation-whatsapp`, prefilled `Hi {ownerFirst}, it's {first}, booking {ref} for {dateShort} {arriveLabel}.`), `Call {ownerFirst}` (`confirmation-call`), text links `Change or cancel` (`confirmation-manage` -> `#manage/<ref>`) and `Done` (`confirmation-done`).
7. **DEMO panel** (`demo-panel`, dashed border, label `DEMO · SIMULATED`): heading `This is the message {ownerFirst}'s phone just received`; a `PhoneMock` containing the owner bubble for this booking, read from the store by `bookingId` (the `owner_new_booking` or `owner_emergency` message, and the booking's first customer message `customer_confirmed` / `customer_received` / `customer_emergency_received`), so the panel also works after a refresh (`demo-owner-bubble`, `WhatsAppBubble direction="in"`, buttons shown but inert) and a second bubble `What you received` (the customer message); button `Open {ownerFirst}'s dashboard →` (`demo-open-dashboard`, `pageHref('dashboard.html', '#/bookings/<id>')`).
8. Unknown or missing ref: friendly not-found with Book and Call buttons.

**Manage (`#manage/<ref>`, `manage-page`).**
- Unknown ref (`manage-not-found`): `We couldn't find that booking. Check the reference, or call {ownerFirst}.` with `Book a visit` and Call.
- Ticket (`manage-ticket`) and a live status timeline (`manage-status-timeline`): `Requested`, `Confirmed`, `On the way`, `Done`. `on_the_way` reads `{ownerFirst} is on the way. Expected about {etaClock} ({ownerFirst}'s own estimate, not live tracking).` `cancelled` reads `This booking was cancelled.` with a `Book again` button.
- Status `new` or `confirmed` and NOT within `freeChangeHours` of the start: `Cancel visit` (`manage-cancel`) opens `ConfirmDialog` `Cancel this visit?` with an optional reason `Select` (`manage-cancel-reason`: `Changed my mind`, `Found someone else`, `No longer needed`, `Other`) and confirm (`manage-cancel-confirm`) which calls `cancelBooking(id, 'customer', { reason })`. The window is free again instantly on the landing page and the dashboard. There is no self-service time change (WON'T, 2.3): beneath the button sits the line `To change the time, call or WhatsApp {ownerFirst}.` with Call and WhatsApp buttons.
- Within `freeChangeHours` of the visit (and still active): no actions; text (`manage-close-note`) `This is close, so please call {ownerFirst}.` with Call and WhatsApp buttons.
- `on_the_way` and `done`: status only.

### 13.4 Dashboard: Today (`js/dashboard/views/today.js`, `css/today.css`, WP4)

`title`: `Today`. `css`: `['css/today.css', 'css/bookings.css']` (the latter for shared job-action sheets). PageHeader: title `{Morning|Afternoon|Evening}, {ownerFirst}` (before 12:00 Morning, before 18:00 Afternoon, else Evening, from the real clock), subtitle `{Fri 23 Oct} · {n} jobs today · {m} need you`. Sections (the numbers below are LABELS, not the order). **Render order on mobile: 2 (Needs you), 3 (Next up), 1 (Availability), 4, 5, 6, 7**, because Needs you is what the owner must act on first. At 1100px two columns per 12.2 `db-two-col`: left = Needs you, Next up, Availability; right = Stats, Today's diary, Tomorrow, Share:

1. **Availability card** (`today-availability`). A `Switch` `Taking bookings today` (`today-taking-bookings`), checked when today is not in `fullDays`. On: description `Customers can book your free windows today.` Off: an amber note `Full today. New customers cannot book today. Your {n} jobs stay in your diary.` Toggling calls `setDayFull(today, !checked)` with an Undo toast; the landing page updates live. If today is closed (day off or a closed weekday) the switch is disabled with `Today is closed.` Below, two secondary buttons: `Take tomorrow off` (`today-take-tomorrow-off`) and `Take next week off` (`today-take-week-off`). One tap each, no confirm; they call `addDaysOff` for tomorrow / the 7 days of next Monday to Sunday with label `Day off` / `Holiday`, then a toast `Tomorrow marked as a day off. Customers cannot book it.` (or `Next week marked as days off.`, plus `{n} booked jobs stay in your diary.` when `bookedCount > 0`) with Undo. If tomorrow is already off or closed (a day off, or a weekday with no open windows such as Sunday) the button is disabled and reads `Tomorrow is off`.
2. **Needs you** (`needs-you`, only when `selectNeedsYou` is non-empty). Section title `Needs you` and a count. One card per booking (`needs-you-card-<id>`, 4px left border: `--danger` for urgent, `--status-new-fg` otherwise; `is-unseen` while unseen): urgent pill or `New request` pill, `{first name} · {outward code} · {fmtTimeAgo}`, a summary (urgent: `emergencyList` and the note; otherwise `{serviceName}, {when}` plus the line `Outside your usual area: confirm travel.` for edge/outside, or `Auto-confirm is off.`). Buttons come from `NeedsYouActions` (13.6.2). Ordered urgent first, then oldest first.
3. **Next up** (`next-up`). From `selectNextUp(state, nowStamp)`. Eyebrow `Next up` and a countdown (`useNow(30000)`): on the way `On the way since {HH:mm}`; accepted emergency `Emergency · ETA {etaClock}`; today before the window `In {n} min` / `In {h} h {m} min`; during the window `Arriving now`; another day `{Tomorrow|Sat 24 Oct}`. Big window label (display, 28px, tabular): `bookingWindowLabel(booking)`. Then: service (and variant), customer name with the `Repeat customer` tag when `selectRepeatInfo` says so, address (maps link), a one-line note snippet, price. A row of four 56px tiles: `Navigate` (`next-up-navigate`, `mapsLink`), `Call` (`next-up-call`), `WhatsApp` (`next-up-whatsapp`, prefilled `Hi {first}, it's {ownerFirst} from {business} about your booking {ref}.`), `Details` (`next-up-details`, `#/bookings/<id>`). Below it `JobActionBar variant="card"` (ONE full-width 56px primary whose label follows the job state, 13.6.1). Empty state (`today-empty`, `EmptyState` `calendar-days`): `Nothing booked. Go put the kettle on.` with the share card below.
4. **Stats** (three `Stat` tiles): `Jobs today` (`stat-jobs-today`, count of bookings starting today whose status is `confirmed`, `on_the_way` or `done`: an unaccepted emergency is in Needs you, not yet a job; an accepted one counts; the same `n` feeds the page subtitle), `Owed to you` (`stat-owed`, `£245`, hint `2 jobs`, links to `#/insights`), `Next free slot` (`stat-next-free`, `nextFreeSlot(state, 'fault')` human text, hint `for repairs`).
5. **Today's diary** (`today-jobs`). The day's open windows in order with a thin `Lunch` divider between windows 1 and 2. A booking row (`today-job-<id>`, min 72px): window label, service, customer first name and outward code, price, `StatusPill`; a half-day job spans two windows as one row; accepted emergencies appear first with `ASAP`. A free window that is not past shows a dashed row `Free · add a job` (`today-free-<windowId>`) linking to `#/new?date=<today>&window=<id>`. Blocked windows show `Blocked: {label}`. Closed and past-and-empty windows are not shown.
6. **Tomorrow** (`tomorrow-list`). Heading `Tomorrow` (or `{weekday date}` when the next open day is not tomorrow): up to four rows (window label, service, customer, status), a tag `Free windows: {n}` and a link `Open calendar` -> `#/calendar/<date>`.
7. **Share card** (`share-card`): `Your booking page` / `Send this link to customers. It shows your real diary.` Buttons `Send on WhatsApp` (`share-whatsapp`, `waShareLink` with `Book {name} online: <SITE_BASE_URL>index.html`) and `Copy link` (`share-copy`, `copyText`, then toast `Link copied`).

The FAB is rendered by the shell (not by Today).

### 13.5 Dashboard: Bookings and booking detail (`bookings.js`, `booking-detail.js`, WP5)

**Bookings list** (`js/dashboard/views/bookings.js`; `title`: `Bookings`; `css`: `['css/bookings.css']`). PageHeader `Bookings`. Under it a `Segmented` `Bookings | Customers` (`bookings-view-toggle`; options testids `bookings-view-bookings`, `bookings-view-customers`; choosing Customers navigates to `#/customers`). Sticky controls: search `Input type="search"` (`bookings-search`, placeholder `Name, phone, postcode or ref`, live filtering, also writes `?q=`), and a horizontally scrollable `Segmented` filter (`f` in the hash query; default `upcoming`):

| Filter value | Label (with live count) | Rule |
|---|---|---|
| `new` | `Needs you` | `status === 'new'` |
| `upcoming` | `Upcoming` | `selectUpcoming` |
| `owed` | `To collect` | `done && !paid` |
| `done` | `Done` | `status === 'done'` |
| `cancelled` | `Cancelled` | `status === 'cancelled'` |
| `all` | `All` | everything |

**Search and filter behaviour.** Only the search + filter block is sticky (just below the sticky dashboard header); the page title and the Bookings | Customers toggle scroll away, and when the viewport is under 600px high nothing is sticky. Search and filter changes call `navigate(..., { replace: true })` (no history spam). A non-empty search runs over ALL bookings whatever filter is selected and shows the line `Searching all bookings`. The selected filter option is scrolled into view on mount. A ghost button `Mark all seen` (`bookings-mark-all-seen`) sits in the PageHeader actions while any booking is unseen and calls `markAllSeen()`. Search matches case-insensitively across customer name, phone digits (spaces ignored), postcode (spaces ignored), ref, service name and address line. Sort: `new`/`upcoming` soonest first, others most recent first; urgent bookings first under a group `ASAP`. Group by day with plain, NON-sticky headings (`Today`, `Tomorrow`, `Mon 27 Oct`). Row (`booking-row-<id>`, min 72px, whole row is a link to `#/bookings/<id>`): left time block (window label), name (bold), service, outward code, price, `StatusPill` (and the `URGENT` pill); `is-unseen` rows show a blue dot and the left bar. Empty states: `new` `Nothing needs you. Nice.`; `upcoming` `No upcoming bookings. Share your booking link.` (link to Today share card); `owed` `Nothing to collect. Nice.`; `done` `No finished jobs yet.`; `cancelled` `No cancelled bookings. Nice.`; `all` or any search with no hits `No bookings match "{q}".` (`bookings-empty`). Below 1100px the list and detail are separate screens; from 1100px they sit side by side (`db-master-detail`), selecting a row never changes the list scroll position.

**Booking detail** (`js/dashboard/views/booking-detail.js` exports the NAMED component `BookingDetail({ id })`, used by `bookings.js`; it is not a route module). Testid `booking-detail`. Mobile: immersive page, PageHeader with back arrow to `#/bookings`, eyebrow `Booking`, title `{ref}` (monospace). On mount it calls `markSeen(id)`. Content in order:

1. Status row: `StatusPill` (`detail-status`), `URGENT` pill when urgent (`detail-urgent`), source tag `Website|Phone|WhatsApp|Word of mouth` (`detail-source`), created `{fmtTimeAgo}`.
2. **Customer card**: name; phone; tag `Repeat customer · 2nd booking` (`detail-repeat-tag`, shown when `selectRepeatInfo.nth >= 2`, ordinal `2nd/3rd/4th...`); buttons `Call` (`detail-call`), `WhatsApp` (`detail-whatsapp`, prefilled `Hi {first}, it's {ownerFirst} from {business} about booking {ref}.`), `Text` (`detail-sms`), and an email link when an email exists; address with `Open in Maps` (`detail-maps`).
3. **Job card**: service (and variant), `{Sat 24 Oct}` and window label, duration label, price (quoted; final when done; `To collect` when owed), the customer's note verbatim (`detail-notes`, label `Note from customer`), and a private textarea `Only you can see this` (`detail-internal-notes`, autosaves on blur with a `Saved` tick, `updateBooking`).
4. **Timeline** (`detail-timeline`): the `history` entries, newest last, each `<Sat 24 Oct 09:12> · <text>` (`Booked via website`, `Confirmed`, `Declined`, `On the way, about 11:20`, `Done`, `Paid by cash`, `Moved to Mon 26 Oct, 8–10am`, `Cancelled by customer: Customer asked`, `Message logged (simulated): Running late`).
5. **Messages for this booking**: up to three latest (kind label, time, `Sent (simulated)` or `Scheduled for ...`) and a link `See all` -> `#/messages?b=<id>`.
6. **Quick messages** (SHOULD): three 48px buttons `Running late` (`detail-quick-late`), `Need access` (`detail-quick-access`), `Quote ready` (`detail-quick-quote`). Tap logs the message (`sendQuickMessage`) and shows a toast `Message logged (simulated). Open it in your WhatsApp to send it for real.` with action `Open WhatsApp` (opens `waLink(...)` in a new tab).
7. Sticky bottom bar (`db-sticky-actions`) holding `JobActionBar variant="bar"`: the primary button plus the overflow `IconButton` (`detail-overflow`, `ellipsis`). `JobActionBar` renders the overflow button itself; it opens a Sheet (`detail-overflow-sheet`) listing the SECONDARY actions of 13.6.1 as 56px rows that reuse the testids `job-secondary-decline` (status new), `job-secondary-reschedule`, `job-secondary-cancel`, `job-secondary-nudge` (owed), `job-secondary-review` (done and not yet requested) and `job-secondary-unpaid` (paid; label `Mark unpaid`).
8. Unknown id (`detail-not-found`): `We couldn't find that booking.` and a `Back to bookings` button.

### 13.6 Shared job actions (`js/dashboard/shared/job-actions.js`, WP5)

**13.6.1 The state-driven primary action (same position, 56px, full width on mobile).**

| Booking state | Primary (id, label) | Secondary buttons (testid) |
|---|---|---|
| `new`, urgent | `accept` `Accept` (with ETA `Segmented` 45 min / 1 hr / 2 hrs, default 45; options `job-eta-45`, `job-eta-60`, `job-eta-120`) | `Decline` (`job-secondary-decline`) |
| `new` | `confirm` `Confirm` | `Decline` (`job-secondary-decline`) |
| `confirmed`, not urgent | `on_my_way` `On my way` (opens the ETA sheet) | `Reschedule` (`job-secondary-reschedule`), `Cancel booking` (`job-secondary-cancel`) |
| `confirmed`, urgent (accepted) | `mark_done` `Mark done` | `Cancel booking` |
| `on_the_way` | `mark_done` `Mark done` (opens the complete sheet) | `Cancel booking` |
| `done`, unpaid | `mark_paid` `Mark paid` (opens the paid sheet) | `Payment reminder` (`job-secondary-nudge`), `Ask for a review` (`job-secondary-review`, only if not yet requested) |
| `done`, paid, review not requested | `review` `Ask for a review` | `Mark unpaid` (`job-secondary-unpaid`) |
| `done`, paid, review requested | none: disabled text `All done` | `Mark unpaid` (`job-secondary-unpaid`) |
| `cancelled` | `rebook` `Rebook` -> `#/new?customer=<key>&service=<serviceId>` | none |

**Variants.** `variant="card"` (Today's Next up): the primary full width at 56px with the secondary actions as a row of 44px text buttons below it. `variant="bar"` (booking detail): ONLY the primary (56px, flex 1) plus the `detail-overflow` IconButton; the secondaries live in the overflow sheet (13.5 item 7). For an urgent `new` booking both variants show the ETA `Segmented` (`job-eta-*`) directly above the primary. The primary button has `data-testid="job-primary"`; the container `job-action-bar`. Accept/Decline are at least 16px apart. Every status change shows an Undo toast (6s) via `showUndoToast` from `js/ui/toast.js` (12.3):

| Action | Toast copy |
|---|---|
| confirm | `Confirmed. {first} has been told (simulated).` |
| accept | `Accepted. {first} has been told you're on your way (simulated).` |
| decline | `Declined. {first} has been told (simulated).` |
| on my way | `On your way. {first} has been told (simulated).` |
| complete | `Job done. £{x} to collect.` or `Job done. Marked paid.` |
| mark paid | `Marked paid.` |
| cancel | `Cancelled. The window is free again.` |
| reschedule | `Moved to {when}.` |
| mark unpaid | `Marked unpaid.` (a plain toast: `markUnpaid` returns no undo token) |

**13.6.2 `NeedsYouActions`** renders, for an urgent booking: ETA `Segmented` (`needs-you-eta-45`, `needs-you-eta-60`, `needs-you-eta-120`; labels `45 min`, `1 hr`, `2 hrs`), primary `Accept` (`needs-you-accept-<id>`), `Call`, `WhatsApp`, then (16px gap) ghost `Decline` (`needs-you-decline-<id>`). For a non-urgent `new` booking: primary `Confirm` (`needs-you-confirm-<id>`), `Call`, `WhatsApp`, `Decline`. Decline is ONE tap with Undo (no reason sheet). `Call` and `WhatsApp` open `telLink` and `waLink` (with the demo phone override).

**13.6.3 Sheets (all `Sheet size="auto"`).**
- **ETA sheet** (`eta-sheet`): title `How long will you be?`; chips `eta-option-15`, `eta-option-30` (default), `eta-option-45`, `eta-option-60` (`15 min`, `30 min`, `45 min`, `1 hr`); a live preview bubble (`eta-preview`) of the `customer_on_my_way` text labelled `Message to {first} (simulated)`; primary `Tell {first} I'm on my way` (`eta-send`) -> `markOnTheWay`.
- **Complete sheet** (`complete-sheet`): title `Finish the job`; final price `Stepper` (`complete-price`, `complete-price-minus`, `complete-price-plus`; step £5; defaults to the quoted price); `Segmented` `Paid?` options `Not yet` (`paid-method-none`, default), `Cash` (`paid-method-cash`), `Card` (`paid-method-card`), `Bank` (`paid-method-bank`); `Switch` `Send review request` (`complete-review-toggle`, default on, helper `Goes out {reviewDelayMinutes} minutes after you finish.`); primary `Complete job` (`complete-submit`) -> `completeBooking`. Choosing a method goes straight to paid.
- **Paid sheet** (`paid-sheet`): title `How did they pay?`; the three method options (`paid-method-cash`, `paid-method-card`, `paid-method-bank`), none preselected; primary `Mark paid` (`paid-submit`, disabled until chosen) -> `markPaid`.
- **Cancel sheet** (`cancel-sheet`): reason chips `Customer asked` (`cancel-reason-customer`, default), `Can't make it` (`cancel-reason-cannot`), `Duplicate` (`cancel-reason-duplicate`), `Other` (`cancel-reason-other`); `Switch` `Tell the customer` (`cancel-notify-toggle`, default on) with a preview bubble of `customer_cancelled`; danger button `Cancel booking` (`cancel-submit`) and ghost `Keep booking`.
- **Reschedule sheet** (`reschedule-sheet`): a wrapping grid of days (`reschedule-day-<date>`, next 28 days, owner mode, built with this package's own `ja-` classes because WP3's DayPicker is not importable; same 5 / 7 column rule as 5.4) and the selected day's windows (`reschedule-window-<id>`, from `getDaySlots(..., { ownerMode: true, ignoreBookingId })`; half-day jobs show their two options); `Switch` `Tell the customer` (`reschedule-notify-toggle`, default on); preview bubble of `customer_rescheduled` (`reschedule-preview`); primary `Move booking` (`reschedule-submit`) -> `rescheduleBooking`.

`PaidButton` renders a `Button` `Mark paid` (`owed-mark-paid-<id>`) that opens the Paid sheet.

### 13.7 Dashboard: Calendar (`js/dashboard/views/calendar.js`, `css/calendar.css`, WP6)

`title`: `Calendar`. `css`: `['css/calendar.css']`. The diary IS the availability: whatever is blocked or booked here is what customers see.

1. Week header: label `{Mon 26 Oct} to {Sun 1 Nov}`; `calendar-prev` and `calendar-next` (48px), `Today` (`calendar-today`). The route is `#/calendar/<date>`; the week is the Monday-start week containing it (default today).
2. Week strip (mobile): seven chips (`calendar-day-<date>`), min 44px wide x 64px high, 2px gaps (seven fit from 360px; below that the strip scrolls inside its wrapper with scroll-snap and the selected day is scrolled into view): weekday short, date number, `{n} jobs` (non-cancelled bookings that day), a dot from `getDayLoad(state, date)` (the CUSTOMER view of availability), today ring, selected state. Sunday and days off show `Closed` / `Off`.
3. Selected day panel (`calendar-day-panel`): banners when the day is a day off (`Day off: {label}` and button `Remove day off` `calendar-remove-dayoff`) or marked full (`Marked full. Customers cannot book this day.` and button `Reopen day` `calendar-reopen-day`). Then one row per open window in order with a thin `Lunch` divider between windows 1 and 2 (`calendar-window-<date>-<windowId>`):
   - **booked**: the booking card (`calendar-booking-<id>`): window label, service, customer first name, `StatusPill`; links to `#/bookings/<id>`. A half-day job is ONE card spanning its two rows.
   - **free**: dashed full-width button `Free · tap to add or block` -> opens the free-window Sheet (`calendar-free-sheet`) with `Add booking (phone call)` (`calendar-add-booking` -> `#/new?date=<date>&window=<id>`), `Block this time` (`calendar-block-open`), `Take the whole day off` (`calendar-dayoff-open`, adds a day off).
   - **blocked**: hatched row `Blocked: {label}` as a button (`calendar-unblock-<blockId>`) -> `ConfirmDialog` `Unblock this time?`; confirming removes the block with an Undo toast. When the block's `groupId` is shared by more than one block, the dialog body also shows a `Switch` `Unblock all {n} windows` (`calendar-unblock-group`, default on) and confirming then calls `removeBlockGroup`.
   - **closed** (not in the weekday's hours): muted `Closed`; **past** and empty: muted.
4. **Block sheet** (`block-sheet`): label chips `Dentist` (`block-label-dentist`), `Van MOT` (`block-label-mot`), `Supplier run` (`block-label-supplier`), `Other` (`block-label-other`) filling a text `Input` (`block-label`, default `Blocked`); `Segmented` scope `This window` (`block-scope-window`, default), `Whole day` (`block-scope-day`), `Until a date` (`block-scope-until`, reveals a date input `block-until` (`type="date"`, `min` = the selected day; an earlier value is ignored)); primary `Block` (`block-confirm`). Calls `addBlock` or `blockRange`; booked windows are skipped and reported in the toast (`Blocked 3 windows. 1 was already booked.`) with Undo. The landing page updates within a second.
5. From 768px the strip and panel become a 7-column week grid (`calendar-grid`): columns Monday to Sunday, rows the four windows with the lunch gap, the same cell states and handlers, compact. Selecting a day column heading selects it.
6. Legend (`calendar-legend`): green `Plenty free`, amber `1 left`, grey `Full or closed`, hatched `Blocked`, and the note `Customers book from this diary. Free here means bookable on your website.` with the link `Preview customer view` (`calendar-preview-site`, `pageHref('index.html', '#book')`).

### 13.8 Dashboard: New booking (`js/dashboard/views/new.js`, WP6)

`title`: `New booking`. `css`: `['css/booking.css']`. Immersive route; the inline panel root has `data-testid="new-booking-page"`. Renders `PageHeader` (back arrow via `goBack('#/today')`, 11.3) and `<BookingSheet mode="owner" presentation="page" intent=${{ serviceId, date, windowId, customerKey, source }} onClose=${back} onBooked=${(b) => navigate(routeHref('bookings', { id: b.id }), { replace: true })} />` with the intent parsed from the query (`service`, `date`, `window`, `customer`, `source`). In `presentation="page"` the booking step titles are `<h2>` (the one `<h1>` on the screen is the PageHeader's) and the Sheet-only chrome (close X, `Prototype` ribbon) is omitted. Owner-mode behaviour (implemented in WP3's components; WP6 only wraps it):
- Step 0 service list (no emergency). Step 1 When uses `ownerMode: true` and 28 days (windows `too_soon` are bookable, `booked`/`blocked`/`closed`/`past` are not).
- Step 2 fields: name, mobile, postcode, house number and street, note; typing a mobile that matches an existing customer shows the chip `Existing customer` (`existing-customer-chip`) and fills missing name and address; `Source` `Segmented` `Phone` (`source-phone`, default), `WhatsApp` (`source-whatsapp`), `Word of mouth` (`source-referral`); `Price` input (`field-price`, prefilled with the quoted price, editable, numeric); `Switch` `Send confirmation message` (`notify-toggle`, default on).
- Submit `Add to diary` (`booking-submit`) -> `createBooking({ ..., asOwner: true, notifyCustomer, quotedPrice, source })`: status `confirmed`, confirmation message logged when enabled, then `onBooked`.
- A taken window returns the same slot-taken banner with alternatives.

### 13.9 Dashboard: Customers (`js/dashboard/views/customers.js`, `css/insights.css`, WP7)

`title`: `Customers`. Derived from bookings by phone number (never stored). PageHeader `Customers`, the same `Bookings | Customers` `Segmented` as 13.5 (Customers selected; `bookings-view-bookings` navigates back). Search (`customers-search`). List (`customers-list`): rows (`customer-row-<key>`, min 72px): `Avatar`, name, outward code of the latest address, `{jobs} jobs`, total value, last job date, tag chips `Landlord` / `Repeat`, and a chip `Owed £75` when `owed > 0`. Detail `#/customers/<key>` (`customer-detail`; immersive on mobile, right pane from 1100px): name, `Call` and `WhatsApp` buttons, each address with `Open in Maps`, tiles `Total value` and `Owed`, the bookings list (rows link to `#/bookings/<id>`), and `Rebook` (`customer-rebook`) -> `#/new?customer=<key>&service=<last serviceId>`. Unknown key: friendly not-found. Empty list: `No customers yet. They appear when someone books.`

### 13.10 Dashboard: Insights (`js/dashboard/views/insights.js`, `css/insights.css`, WP7)

`title`: `Insights`. `css`: `['css/insights.css', 'css/bookings.css']`. Plain numbers an electrician checks; not accounting. Everything from `selectInsights(state, nowStamp)`.
1. Four `Stat` tiles: `Collected this month` (`insights-collected`, `£850`, hint `{n} jobs`), `Owed to you` (`insights-owed`, `£245`, hint `2 jobs`), `Booked next 14 days` (`insights-booked-next`, `£675`, hint `7 bookings`), `Average job` (`insights-avg`, `£183`, hint `last 30 days`).
2. **Owed to you** list (`owed-list`): one row per owed job (`owed-row-<id>`): customer, service, `{n} days ago` (days since start; `today` when 0), amount; buttons `Nudge` (`owed-nudge-<id>`: calls `sendPaymentNudge`, then opens `waLink` for the `customer_payment_nudge` text in a new tab, toast `Payment reminder logged (simulated).`) and `PaidButton` (`owed-mark-paid-<id>`). Empty: `Nothing to collect. Nice.`
3. **Collected per week** (SHOULD, `insights-weeks`): the last 6 weeks as horizontal bars (`insights-weekbar-0` oldest to `-5` current) drawn with plain `<div>` widths (no chart library), each with a text label `Mon 19 Oct` and value `£85`; a screen-reader table equivalent.
4. **By service** (SHOULD): a list `{service name} · {jobs} jobs · £{total}`.
5. Note `Figures come from the sample bookings in this browser.`

### 13.11 Dashboard: About, "What's real in this prototype" (`js/dashboard/views/about.js`, WP7)

`title`: `What's real`. `css`: `['css/insights.css']`. Headline `This is a prototype. Here is what is real.` Three summary `Chip`s: `Works for real in the browser`, `Simulated here`, `Needed for a real build`. Then the table in section 17 rendered as cards on mobile and a table (`about-table`) from 768px, rows expandable (`<details>`). A closing block `What we would need from you`: `A WhatsApp number to use (a new number, or move yours)`, `Meta business verification`, `Your domain`, `Your real prices and hours`, `Your registration and insurance details`. Privacy line: `Nothing leaves this phone. This prototype has no server.` Links: `Back to the customer site` (`pageHref('index.html')`) and `Demo tools` (`#/demo`). `PrototypeNotice variant="footer" page="dashboard"`.

### 13.12 Dashboard: More (`js/dashboard/views/more.js`, `css/settings.css`, WP8)

`title`: `More`. A `db-list` (`more-list`) of 56px rows with icon, label, chevron: `Messages` (`more-messages`, with the unread count), `Customers` (`more-customers`), `Settings` (`more-settings`), `Demo tools` (`more-demo`), `What's real in this prototype` (`more-about`), `View customer site` (`more-site`, `pageHref('index.html')`). Under it `Appearance` with `ThemeToggle variant="segmented"`. Footer: `PrototypeNotice variant="footer" page="dashboard"`.

### 13.13 Dashboard: Settings (`js/dashboard/views/settings.js`, `css/settings.css`, WP8)

`title`: `Settings`. One scrolling page, four `db-section`s. Every control saves on change/blur (no Save button), and ONE shared `Saved` tick (`setting-saved`, `role="status"`, pinned at the top right of the page content) appears for 2 seconds after any successful save (a tick per control would repeat the testid), and the landing page in another tab reflects it live.

**A. Business and brand.** `Input`s: `Business name` (`setting-business-name`), `Short name` (`setting-short-name`, helper `Shown next to the logo`), `Your first name` (`setting-owner-first`), `Tagline` (`setting-tagline`), `Phone` (`setting-phone`, error `Enter a UK mobile like 07700 900412`), `Email` (`setting-email`), `Area` (`setting-area`). A live mini preview (`setting-preview`): `BrandMark`, name, tagline, a primary button. Note: `Reviews, ratings and the registration line stay sample content after you rebrand.` Empty required fields show `This can't be empty.` and are not saved.

**B. Services and prices.** One row per service: `Switch` `Show on website` (`service-active-<id>`) and a price `Input` (`service-price-<id>`, prefix `£`, numeric). `eicr` shows three price inputs (`service-variant-price-flat`, `service-variant-price-house`, `service-variant-price-large`). Invalid price: `Enter a whole number of pounds.` The `emergency` row has no `Show on website` switch (emergency visibility is the `setting-emergencies` rule in D) and `rewire` has no price input (it shows `Free`).

**C. Availability.** Seven weekday rows Monday to Sunday; each has four toggle chips for the windows (`hours-<weekday>-<windowId>`, weekday is the JS number 0 to 6, so Monday is `hours-1-0`; label `8–10am` etc.; `aria-pressed`). `Select` `Minimum notice` (`setting-lead`: 60, 90, 120, 180, 240 minutes shown as `1 hour`, `90 minutes`, `2 hours`, `3 hours`, `4 hours`) and `Book up to` (`setting-ahead`: 7, 14, 21, 28 days). Days off: list (`dayoff-list`, items `dayoff-item-<id>` with remove `dayoff-remove-<id>`), date input (`dayoff-date`), label input (`dayoff-label`, default `Day off`), `Add day off` (`dayoff-add`), quick buttons `Take tomorrow off` (`dayoff-tomorrow`) and `Take next week off` (`dayoff-next-week`). Changing a window or notice changes the customer calendar immediately.

**D. Rules and look.** `Switch`es: `Confirm normal bookings instantly` (`setting-auto-confirm`; `Emergency requests and bookings outside your usual area always wait for you.`), `I'm taking emergency visits` (`setting-emergencies`; `Off hides the emergency request on your website.`), `Day-before reminders` (`setting-reminders`). `Appearance`: `ThemeToggle variant="segmented"` (`theme-auto`, `theme-light`, `theme-dark`).

### 13.14 Dashboard: Messages, "WhatsApp outbox (simulated)" (`js/dashboard/views/messages.js`, `css/settings.css`, WP8)

`title`: `Messages`. The headline of the pitch. On mount call `markMessagesSeen()`.
1. Banner (`messages-banner`, `PrototypeNotice variant="inline"`, text from 3.7).
2. If `?b=<bookingId>`: a chip row (`messages-booking-filter`) `Showing messages for {ref}` with `Clear`.
3. **Compare card** (`messages-compare`, `<details open>`; SHOULD): title `Is this better than a ping?`; two columns: `A typical ping` (small caption `illustrative, not your agency's exact message`) with a plain bubble `New booking received. {name} {phone}. {DD/MM} {HH:mm}.` filled from the SAME booking as the right-hand alert bubble (never a pasted date; when the store has no `owner_new_booking`, use the sample customer and the next free `fault` slot) and `With this` with a real owner-alert bubble (the latest `owner_new_booking` in the store, else a static sample); caption `One tells you. The other lets you act.`
4. Filter `Segmented`: `All` (`msg-filter-all`), `To me` (`msg-filter-owner`), `To customers` (`msg-filter-customer`), `Scheduled` (`msg-filter-scheduled`).
5. List (`messages-list`) grouped by day (`Today`, `Yesterday`, `Mon 26 Oct`), newest first. Each card (`message-<id>`): header `To: {toName} (you)` or `To: {toName}`, the phone, the `KIND_LABELS` label and the time (`sendAt` when set, else `at`); the `WhatsAppBubble` (owner alerts `in`, customer messages `out`) with `stateLabel` `Sent (simulated)` or `Scheduled for {Fri 18:00} (simulated)`; quick-reply buttons from `bubbleActions` (`bubble-action-<messageId>-<actionId>`) that run the real store actions (10.6) and show the same Undo toast as 13.6.1 through `showUndoToast` (12.3); after a button is used the bubble list updates and a NEW customer bubble appears at the top; footer buttons `Open in WhatsApp` (`message-open-wa-<id>`, `waLink(toPhone, body, demoPhoneDigits)`, new tab), `Copy text` (`message-copy-<id>`, toast `Copied`), `Open booking` (`message-open-booking-<id>`), and for scheduled messages `Send now (simulated)` (`message-send-now-<id>`).
6. Hint (`messages-demo-hint`): `Open in WhatsApp goes to the number on the message. These numbers are fictional, so it will not reach a real person. Add your own mobile in Demo tools and every link opens your WhatsApp instead.` with a link to `#/demo`.
7. Button `See message templates` (`messages-templates-open`) opens a read-only Sheet (`templates-sheet`) listing all 19 kinds with their `{placeholders}` highlighted (`<mark>`).
8. Empty: `No messages yet. Make a booking on the website and watch this fill up.`

### 13.15 Dashboard: Demo tools (`js/dashboard/views/demo.js`, `css/settings.css`, WP8)

`title`: `Demo tools`. Sections:
1. **Try on your phone**: explanation `These sample customers use fictional numbers, which WhatsApp cannot open. Enter your own mobile and every Open in WhatsApp link opens a chat with you instead. Stored on this device only.` `Input` `Open WhatsApp links with this mobile number` (`demo-phone-input`), `Save` (`demo-phone-save`), `Clear` (`demo-phone-clear`), status line (`demo-phone-status`): `Links open WhatsApp for +{digits}` (for example `+447700900231`) or `Not set: links go to the fictional numbers and will not open a chat.` Invalid: `Enter a UK mobile or an international number.`
2. **Add a sample website booking**: `Standard booking` (`demo-sim-standard`), `Needs your OK (edge postcode)` (`demo-sim-approval`), `Emergency request` (`demo-sim-emergency`) -> `simulateIncomingBooking`; no toast of its own (the Watcher already announces the arrival, 11.7); instead an inline `aria-live` line (`demo-sim-result`) `Added {ref} for {first}.` with a `View` link, or on `slot_taken` `No free window to book. Free one up in Calendar.`
3. **Customer site**: `Open the customer site` (`demo-open-site`), `Open the booking sheet` (`demo-open-booking`, `pageHref('index.html', '#book')`).
4. **Reset**: `Reset diary and messages` (`demo-reset`; `ConfirmDialog` `Reset the diary?` / `This reseeds the sample bookings relative to today and clears messages. Your business details stay.`) and danger `Reset everything` (`demo-reset-all`; `Reset everything?` / `This also restores the default business details, prices and hours.`).
5. **Status**: `demo-storage-status` (`Saving in this browser: working` or `Saving is blocked in this browser mode, so bookings made on the website will not appear on the dashboard.`) and, when overridden, `demo-clock-status` (`Clock override active: {stamp}`).
6. **Demo script** (`demo-script`, `<details>`): the 3-minute script from 1.2 as a short ordered list.

### 13.16 About the dashboard shell (`dashboard.html`, `shell.js`, WP2)

Header (`db-header`): `BrandMark` and `{shortName}` on the left (link to `#/today`); right: `IconButton` Messages (`db-messages-button`, `message-circle`, badge `db-messages-badge` = `selectUnreadMessageCount`, links to `#/messages`), `ThemeToggle variant="icon"`, and `IconButton` `external-link` (`db-site-link`, label `View customer site`, `pageHref('index.html')`, `target="vm-site"`). Tab bar (`tabbar`) items `tab-today`, `tab-calendar`, `tab-bookings`, `tab-insights`, `tab-more` (sidebar items use `nav-<name>` for `today`, `calendar`, `bookings`, `customers`, `insights`, `messages`, `more`, plus sidebar `nav-demo`, `nav-about`). Tab badges: `tab-badge-today` (needs-you count) and `tab-badge-bookings` (dot when unseen exist). FAB `fab-new-booking` (`plus`, label `New booking`) on Today, Calendar and the Bookings list below 1100px; the sidebar shows a `New booking` button (`nav-new-booking`). The shell renders `PrototypeNotice variant="strip" page="dashboard"` above the header (the `ToastHost` is mounted by `bootApp`, 11.6). The header is sticky (5.1 item 16).

---

## 14. TEST HOOKS

### 14.1 Rules

- Attribute: `data-testid="<name>"`. Spelling below is exact. `<x>` is a dynamic suffix (booking `<id>`, message `<id>`, `<serviceId>`, `<date>` as `YYYY-MM-DD`, `<windowId>` 0 to 3, `<key>` customer phone digits, `<weekday>` 0 to 6).
- The testid sits on the interactive element itself (button, input, link, switch) except for list/section containers, which are named as containers.
- A testid is unique within one rendered screen. Containers may repeat across screens.
- Controls owned by `Segmented`/`Chip` get their testid from the option's `testid`. `Field` errors get `errorTestid`.
- Text assertions in e2e use the exact copy in section 13. Dates and windows are asserted against the fixture clock (3.4).

### 14.2 Inventory (the complete list; build every one that belongs to your screens)

**Global (both pages, WP2)**

| testid | Element |
|---|---|
| `prototype-strip`, `prototype-strip-link` | strip and its "What's real?" link |
| `footer-disclosure` | footer disclosure paragraph (landing footer, More, About) |
| `theme-toggle` | cycling theme icon button |
| `theme-auto`, `theme-light`, `theme-dark` | segmented theme options |
| `toast`, `toast-action` | toast and its action button |
| `sheet`, `sheet-close` | default Sheet panel and its close button (a Sheet with a `testid` prop uses that instead of `sheet`) |
| `confirm-dialog`, `confirm-ok`, `confirm-cancel` | ConfirmDialog |
| `view-title` | the `<h1>` rendered by `PageHeader` (every dashboard view) |
| `page-back` | PageHeader back button |

**Landing (WP3)**

| testid | Element |
|---|---|
| `lp-header`, `lp-call-button`, `lp-header-book` | header, round call button, header Book button (768+) |
| `live-availability` | the live availability block |
| `next-free-chip-0`, `next-free-chip-1`, `next-free-chip-2` | next-free chips, `0` = soonest |
| `hero-tile-fault`, `hero-tile-eicr`, `hero-tile-sockets`, `hero-tile-consumer` | hero tiles |
| `hero-trust`, `hero-see-prices`, `hero-check-postcode`, `hero-whatsapp` | trust line and quiet links |
| `trust-bar` | trust bar |
| `emergency-strip`, `emergency-toggle`, `emergency-call`, `emergency-request` | emergency `<details>`, summary, call button, request button |
| `services-list`, `service-card-<serviceId>` | services list and cards |
| `how-it-works`, `reviews`, `reviews-sample-chip`, `dan-card` | sections |
| `coverage-input`, `coverage-check`, `coverage-result`, `coverage-book` | postcode checker |
| `faq`, `faq-item-0` ... `faq-item-5` | FAQ and items |
| `final-cta`, `final-book` | final CTA and its button |
| `footer`, `footer-owner-link`, `footer-about-link` | footer, the "Owner login (demo)" link and the "What's real in this prototype" link |
| `sticky-bar`, `sticky-call`, `sticky-whatsapp`, `sticky-book` | mobile action bar |

**Booking sheet and flow (WP3; same names in owner mode)**

| testid | Element |
|---|---|
| `booking-sheet` | the Sheet panel (customer mode) |
| `new-booking-page` | the inline panel (owner mode, `presentation="page"`) |
| `booking-back`, `booking-close`, `booking-progress` | frame |
| `booking-call`, `booking-whatsapp` | footer help links |
| `demo-fill` | "Demo: fill sample details" |
| `booking-emergency-link` | Step 0 emergency row |
| `service-option-<serviceId>` | Step 0 service cards |
| `booking-service-chip` | service chip row on When |
| `eicr-size-flat`, `eicr-size-house`, `eicr-size-large` | EICR size options |
| `soonest-card`, `soonest-pick` | Soonest card and Pick this |
| `day-chip-<date>` | day cells |
| `window-<windowId>` | window buttons (half-day: `window-0`, `window-2`) |
| `no-slots`, `no-slots-day` | empty states (no time in horizon / none that day) |
| `booking-summary`, `booking-continue` | footer summary and Continue |
| `booking-ticket` | Details ticket |
| `field-name`, `field-phone`, `field-postcode`, `field-line1`, `field-note`, `note-toggle` | Details fields |
| `postcode-hint` | zone hint |
| `error-name`, `error-phone`, `error-postcode`, `error-line1`, `error-reasons` | field errors |
| `booking-submit` | Confirm booking / Add to diary |
| `slot-taken-banner`, `slot-alt-0`, `slot-alt-1`, `slot-alt-2` | race recovery |
| `emergency-reason-no_power`, `emergency-reason-burning`, `emergency-reason-tripping`, `emergency-reason-water`, `emergency-reason-other` | emergency chips |
| `emergency-submit`, `emergency-phone-link`, `emergency-off-banner` | emergency actions |
| `existing-customer-chip`, `source-phone`, `source-whatsapp`, `source-referral`, `field-price`, `notify-toggle` | owner mode only |

**Confirmation and Manage (WP3)**

| testid | Element |
|---|---|
| `confirmation`, `breaker-art`, `confirmation-title`, `confirmation-status`, `confirmation-ticket`, `confirmation-ref`, `confirmation-timeline` | confirmation screen |
| `add-to-calendar`, `confirmation-whatsapp`, `confirmation-call`, `confirmation-manage`, `confirmation-done` | its buttons |
| `demo-panel`, `demo-owner-bubble`, `demo-open-dashboard` | DEMO panel |
| `manage-page`, `manage-not-found`, `manage-ticket`, `manage-status-timeline` | Manage |
| `manage-cancel`, `manage-cancel-reason`, `manage-cancel-confirm`, `manage-close-note` | Manage actions (there is no `manage-change`: customer reschedule is cut, 2.3) |

**Dashboard shell (WP2)**

| testid | Element |
|---|---|
| `db-header`, `db-messages-button`, `db-messages-badge`, `db-site-link` | header |
| `tabbar`, `tab-today`, `tab-calendar`, `tab-bookings`, `tab-insights`, `tab-more`, `tab-badge-today`, `tab-badge-bookings` | tab bar |
| `sidebar` | sidebar container (1100px and up; there is no rail, 2.3) |
| `nav-today`, `nav-calendar`, `nav-bookings`, `nav-customers`, `nav-insights`, `nav-messages`, `nav-more`, `nav-demo`, `nav-about`, `nav-new-booking` | sidebar items |
| `fab-new-booking` | floating button |
| `view-stub` | placeholder screen |

**Today (WP4)**

| testid | Element |
|---|---|
| `today-availability`, `today-taking-bookings`, `today-take-tomorrow-off`, `today-take-week-off` | availability card |
| `needs-you`, `needs-you-card-<id>`, `needs-you-accept-<id>`, `needs-you-confirm-<id>`, `needs-you-decline-<id>` | needs-you list and card buttons |
| `needs-you-eta-45`, `needs-you-eta-60`, `needs-you-eta-120` | ETA options on an urgent card |
| `next-up`, `next-up-navigate`, `next-up-call`, `next-up-whatsapp`, `next-up-details` | next up |
| `stat-jobs-today`, `stat-owed`, `stat-next-free` | stats |
| `today-jobs`, `today-job-<id>`, `today-free-<windowId>`, `tomorrow-list`, `today-empty` | diary |
| `share-card`, `share-whatsapp`, `share-copy` | share |

**Bookings and job actions (WP5)**

| testid | Element |
|---|---|
| `bookings-view-toggle`, `bookings-view-bookings`, `bookings-view-customers` | Bookings/Customers toggle |
| `bookings-search`, `filter-new`, `filter-upcoming`, `filter-owed`, `filter-done`, `filter-cancelled`, `filter-all`, `bookings-mark-all-seen` | controls |
| `bookings-list`, `booking-row-<id>`, `bookings-empty` | list |
| `booking-detail`, `detail-status`, `detail-urgent`, `detail-source`, `detail-repeat-tag` | detail header |
| `detail-call`, `detail-whatsapp`, `detail-sms`, `detail-maps` | detail contact buttons |
| `detail-notes`, `detail-internal-notes`, `detail-timeline` | detail content |
| `detail-quick-late`, `detail-quick-access`, `detail-quick-quote`, `detail-overflow`, `detail-overflow-sheet`, `detail-not-found` | detail extras |
| `job-action-bar`, `job-primary` | action bar and the primary button |
| `job-eta-45`, `job-eta-60`, `job-eta-120` | ETA options on an urgent `new` booking inside `JobActionBar` |
| `job-secondary-reschedule`, `job-secondary-cancel`, `job-secondary-decline`, `job-secondary-nudge`, `job-secondary-review`, `job-secondary-unpaid` | secondary buttons |
| `eta-sheet`, `eta-option-15`, `eta-option-30`, `eta-option-45`, `eta-option-60`, `eta-preview`, `eta-send` | ETA sheet |
| `complete-sheet`, `complete-price`, `complete-price-minus`, `complete-price-plus`, `complete-review-toggle`, `complete-submit` | complete sheet |
| `paid-sheet`, `paid-method-none`, `paid-method-cash`, `paid-method-card`, `paid-method-bank`, `paid-submit` | paid controls (`paid-method-none` only on the complete sheet) |
| `cancel-sheet`, `cancel-reason-customer`, `cancel-reason-cannot`, `cancel-reason-duplicate`, `cancel-reason-other`, `cancel-notify-toggle`, `cancel-submit` | cancel sheet |
| `reschedule-sheet`, `reschedule-day-<date>`, `reschedule-window-<windowId>`, `reschedule-notify-toggle`, `reschedule-preview`, `reschedule-submit` | reschedule sheet |

**Calendar (WP6)**

| testid | Element |
|---|---|
| `calendar-prev`, `calendar-next`, `calendar-today` | week navigation |
| `calendar-day-<date>`, `calendar-day-panel` | strip chips and panel |
| `calendar-remove-dayoff`, `calendar-reopen-day` | banners' buttons |
| `calendar-window-<date>-<windowId>`, `calendar-booking-<id>`, `calendar-unblock-<blockId>`, `calendar-unblock-group` (the Switch in the unblock dialog) | rows |
| `calendar-free-sheet`, `calendar-add-booking`, `calendar-block-open`, `calendar-dayoff-open` | free-window sheet |
| `block-sheet`, `block-label-dentist`, `block-label-mot`, `block-label-supplier`, `block-label-other`, `block-label`, `block-scope-window`, `block-scope-day`, `block-scope-until`, `block-until`, `block-confirm` | block sheet |
| `calendar-grid`, `calendar-legend`, `calendar-preview-site` | grid, legend, preview link |

**Customers, Insights, About (WP7)**

| testid | Element |
|---|---|
| `customers-search`, `customers-list`, `customer-row-<key>`, `customer-detail`, `customer-rebook` | customers |
| `insights-collected`, `insights-owed`, `insights-booked-next`, `insights-avg` | stat tiles |
| `owed-list`, `owed-row-<id>`, `owed-nudge-<id>`, `owed-mark-paid-<id>` | owed list |
| `insights-weeks`, `insights-weekbar-0` ... `insights-weekbar-5` | weekly bars |
| `about-table` | the real-vs-simulated table |

**More, Settings, Messages, Demo (WP8)**

| testid | Element |
|---|---|
| `more-list`, `more-messages`, `more-customers`, `more-settings`, `more-demo`, `more-about`, `more-site` | More |
| `setting-business-name`, `setting-short-name`, `setting-owner-first`, `setting-tagline`, `setting-phone`, `setting-email`, `setting-area`, `setting-preview`, `setting-saved` | business |
| `service-active-<serviceId>`, `service-price-<serviceId>`, `service-variant-price-flat`, `service-variant-price-house`, `service-variant-price-large` | services |
| `hours-<weekday>-<windowId>`, `setting-lead`, `setting-ahead` | availability |
| `dayoff-list`, `dayoff-item-<id>`, `dayoff-remove-<id>`, `dayoff-date`, `dayoff-label`, `dayoff-add`, `dayoff-tomorrow`, `dayoff-next-week` | days off |
| `setting-auto-confirm`, `setting-emergencies`, `setting-reminders` | rules |
| `messages-banner`, `messages-booking-filter`, `messages-compare`, `msg-filter-all`, `msg-filter-owner`, `msg-filter-customer`, `msg-filter-scheduled`, `messages-list`, `messages-demo-hint`, `messages-templates-open`, `templates-sheet` | messages screen |
| `message-<id>`, `bubble-action-<messageId>-<actionId>`, `message-open-wa-<id>`, `message-copy-<id>`, `message-open-booking-<id>`, `message-send-now-<id>` | message cards |
| `demo-phone-input`, `demo-phone-save`, `demo-phone-clear`, `demo-phone-status` | demo phone |
| `demo-sim-standard`, `demo-sim-approval`, `demo-sim-emergency`, `demo-sim-result` | simulate and its inline result line |
| `demo-open-site`, `demo-open-booking`, `demo-reset`, `demo-reset-all`, `demo-storage-status`, `demo-clock-status`, `demo-script` | demo tools |

### 14.3 End-to-end flows that MUST pass (WP0 writes them in `tests/e2e/flows.mjs`; feature packages make them possible)

Setup for every flow: a NEW Playwright browser context created with `{ timezoneId: 'Europe/London', locale: 'en-GB' }` (so `localStorage` is empty and the 25 October clock change is real; Playwright and axe-core come from `loadDeps()`, 6.1), viewport 375x812 unless stated, both pages opened in that context as two tabs with the same query `?now=2026-10-23T20:30&freeze=1` (the fixture clock, 3.4). Pages are served from the static server on port 4100. "Within 2s" means polling for up to 2000ms.

| # | Flow | Steps and assertions |
|---|---|---|
| F1 | **Customer books on the landing page, owner sees it** | Landing: `next-free-chip-0` reads `Tomorrow, 8–10am`. Tap `hero-tile-eicr`; `soonest-card` contains `Mon 26 Oct, morning, arrive 8–10am`; `eicr-size-house` is selected; `soonest-pick`, `booking-continue`; `demo-fill`; `booking-submit`. Assert `confirmation-title` = `You're booked in, Priya.`, `confirmation-ref` = `VM-1043`, `confirmation-status` = `Confirmed`, `demo-owner-bubble` contains `New booking VM-1043`. In the dashboard tab (within 2s): a toast containing `New booking: Priya`, and `db-messages-badge` reads `1` (the Bookings tab dot is already lit at first launch by the two unseen seed bookings, so asserting it would prove nothing); `#/bookings` shows a row containing `VM-1043` with `Confirmed`; `#/messages` lists, for VM-1043, the owner alert (first), `customer_confirmed` and a scheduled `customer_reminder`. Open the detail: `detail-repeat-tag` reads `Repeat customer · 2nd booking`. |
| F2 | **Approval booking: owner confirms, customer message appears** | Dashboard `#/demo`: `demo-sim-approval`. `#/today`: `needs-you` shows a card; tap `needs-you-confirm-<id>`; toast appears; `#/messages` newest message is `customer_confirmed` to that customer; the booking is `Confirmed`. Tap the toast Undo within 6s: booking back to `New request` and the confirmation message is gone. |
| F3 | **Emergency path** | Landing: open `emergency-toggle`, tap `emergency-request`, pick `emergency-reason-no_power`, fill name/mobile/postcode (`MB2 6JN`), `emergency-submit`. Confirmation title `Request sent, <first>.`; no `add-to-calendar`. Dashboard Today: three cards in `needs-you` in this order: seeded Ngozi (urgent), the new emergency (urgent), seeded Sam (non-urgent). In `#/messages` tap `bubble-action-msg_seed_07_alert-accept_45`; a new customer message `customer_emergency_accepted` appears at the top containing `45 minutes`; the card leaves Needs you. The new emergency never changed any window's state (check Mon 26 Oct load unchanged). |
| F4 | **Job life: on my way, done, paid, insights** | Today `next-up` is Hannah (Sat 24 Oct). `job-primary` = `On my way`; tap, `eta-option-30`, `eta-send`; status `On the way`; message `customer_on_my_way` logged. `job-primary` = `Mark done`; `complete-sheet`; `paid-method-cash`; `complete-submit`. `#/insights`: `insights-collected` goes from `£850` to `£925`; `insights-owed` stays `£245`. |
| F5 | **Done unpaid, then mark paid** | Complete a job with `paid-method-none`: `insights-owed` rises to `£320` (3 jobs); `owed-mark-paid-<id>` -> `paid-sheet` -> `paid-method-card` -> `paid-submit`: owed returns to `£245`, collected rises by the price. |
| F6 | **Rebrand shows on the landing page** | Dashboard `#/settings`: set `setting-business-name` to `Ashby Sparks`, `setting-short-name` to `Ashby`, `setting-owner-first` to `Lee`, `setting-phone` to `07700 900555` (not `Sam`: that is already Dan's apprentice and a seed customer, and messages would read "Hi Sam, it's Sam"). Landing tab (within 2s, no reload): header wordmark `Ashby`, `document.title` starts `Ashby Sparks`, `lp-call-button` href `tel:+447700900555`, footer shows the new phone, hero sub says `Lee's real diary`. The prototype strip and sample labels are still visible. |
| F7 | **Calendar block updates the landing page; race recovery** | Landing tab on `#book/fault`, Saturday selected, `window-0` free. Dashboard `#/calendar/<Sat 24 Oct>`: tap `calendar-window-2026-10-24-0`, `calendar-block-open`, `block-label-dentist`, `block-confirm`. Landing (within 2s): `window-0` for that day is disabled and labelled `Booked`; `next-free-chip-0` now reads `Mon 26 Oct, 8–10am` (Saturday window 1 is already booked by Hannah). Race: on a second landing tab reach Details for Monday window 1 (`#book/fault/2026-10-26/1`) and fill the form; in the dashboard create an owner booking in that same window (`#/new?date=2026-10-26&window=1`); submit the landing form: `slot-taken-banner` shows, `field-name` still holds the typed name, `slot-alt-0` exists. |
| F8 | **Customer cancels via Manage; slot reopens** | After F1: `confirmation-manage` -> `manage-cancel` -> `manage-cancel-confirm`. Status becomes cancelled. Dashboard `#/calendar/<Mon 26 Oct>`: window 0 is free again; `#/messages` has an `owner_customer_cancelled` entry. Landing Soonest for EICR is Mon 26 Oct morning again. |
| F9 | **"Taking bookings today" (clock 09:30)** | Use `?now=2026-10-23T09:30&freeze=1`. Landing `next-free-chip-0` reads `Today, 1–3pm`. Dashboard Today: toggle `today-taking-bookings` off. Landing (within 2s): block shows `is fully booked today` and chip 0 no longer starts with `Today`. Toggle on: restored. |
| F10 | **Take tomorrow off** | Dashboard `today-take-tomorrow-off`. Landing sheet day picker: `day-chip-2026-10-24` is disabled; `next-free-chip-0` moves to Monday. Undo restores. |
| F11 | **Reset demo** | Make a booking (F1 steps), then `#/demo` `demo-reset` + `confirm-ok`: the booking is gone, `bookings` count is 15, the next booking made gets ref `VM-1043` again; the business name edit from F6 is kept (keepSettings). `demo-reset-all` restores `Voltmere Electrical`. |
| F12 | **Owner adds a phone booking** | `fab-new-booking`; service `service-option-fault`; day/window; details; `source-phone`; `booking-submit` (`Add to diary`). Lands on the detail: status `Confirmed`, source `Phone`. The landing page shows that window as `Booked`. `notify-toggle` on -> a `customer_confirmed` message exists; off -> none. |
| F13 | **Theme** | `theme-toggle` cycles; `html[data-theme="dark"]` set; after reload still dark (`vm_theme`); axe runs in both (15). |
| F14 | **Demo phone override** | `#/demo`: type `07700 900555`, `demo-phone-save`; `#/messages`: every `message-open-wa-<id>` href starts `https://wa.me/447700900555?text=`; `demo-phone-clear` restores per-message numbers. |
| F15 | **Reschedule** | Detail of a confirmed booking: `detail-overflow` -> `job-secondary-reschedule` -> `reschedule-day-<date>`, `reschedule-window-<id>` -> `reschedule-submit`. The old window is free, the new one booked, a `customer_rescheduled` message is logged, the reminder is replaced. |
| F16 | **Search and filters** | `bookings-search` `Okafor` finds one row; `900262` finds Marcus Tate's two bookings (a non-empty search ignores the selected filter, 13.5); `filter-owed` shows 2 rows; `filter-cancelled` shows 1. |
| F17 | **Seed fixture** | At the fixture clock: Today `stat-owed` `£245`; Insights values per 3.4; `#/customers` lists 11; calendar day loads per 3.4; the hero chips read `Tomorrow, 8–10am`, `Mon 26 Oct, 8–10am`, `Mon 26 Oct, 10am–12` (Saturday window 1 is booked, Monday afternoon holds the EICR). |
| F18 | **Storage blocked** | Init script makes `localStorage.setItem` throw. Both pages still render; a booking can be made on the landing page; the dashboard Demo tools shows the blocked message; no console errors. |
| F19 | **Deep links** | `dashboard.html#/bookings/bk_seed_08` opens the detail for VM-1035; `#/bookings/nope` shows `detail-not-found`; `index.html#booked/VM-1035` shows the confirmation; `#manage/NOPE-0` shows `manage-not-found`; `index.html#book/fault/2020-01-01/0` falls back to the When step. |
| F20 | **Cross-tab live sync both ways** | Landing and dashboard open: a booking on the landing page appears in the dashboard (F1); then Confirm on the dashboard flips the landing confirmation status chip from `Waiting for Dan to confirm` to `Confirmed` within 2s (use the approval booking from F2 created via the landing page with postcode `MB12 6AB`). |

---

## 15. QUALITY BAR / ACCEPTANCE CRITERIA

All of these are measured by WP0 scripts in `tests/qa/` run against the merged site (static server on port 4100), at the fixture clock, with the seeded diary. Playwright and axe-core come from `loadDeps()` in `tests/e2e/lib.mjs` (6.1); every context uses `timezoneId: 'Europe/London'` and `locale: 'en-GB'`. A package is not done until its screens pass its share.

### 15.1 Matrix

Viewports (width x height): **320x568, 375x812, 390x844, 430x932, 768x1024, 1024x768, 1440x900**. Both colour schemes (`colorScheme: 'light'` and `'dark'` Playwright option, plus the forced `data-theme`). Pages and states:

- Landing: top of page; page scrolled to the footer; emergency strip open; booking sheet at each of Step 0, When (fault and eicr), Details, Emergency, Confirmation; Manage page.
- Dashboard: every route in 11.2 (`#/today`, `#/calendar`, `#/bookings`, `#/bookings/bk_seed_08`, `#/customers`, `#/customers/447700900262`, `#/insights`, `#/messages`, `#/new`, `#/more`, `#/settings`, `#/demo`, `#/about`) plus: a job sheet open, the block sheet open, the Compare card open.

### 15.2 Gates (all must pass)

| # | Criterion | Measure | Script |
|---|---|---|---|
| Q1 | **No horizontal overflow** | `document.documentElement.scrollWidth <= window.innerWidth` and `document.body.scrollWidth <= window.innerWidth` for every matrix cell, from 320px up | `tests/qa/overflow.mjs` |
| Q2 | **Tap targets >= 44x44 CSS px** | Every visible element matching `a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=switch], [role=radio], [role=tab]` has `getBoundingClientRect()` width and height >= 44 (checkbox/radio natives hidden inside a >=44 label count via the label). Exemptions: `.ui-link--inline`, `.u-sr-only`, elements not visible. (The prototype-strip link passes through the oversized hit-box rule in 3.7: its own box is 44px tall.) | `tests/qa/targets.mjs` |
| Q3 | **axe-core: zero serious or critical violations** | `axe-core` (loaded by `loadDeps()`, 6.1), tags `wcag2a`, `wcag2aa`, `wcag21aa`, `best-practice`, in light AND dark, every matrix page/state at 375, 768 and 1440 | `tests/qa/axe.mjs` |
| Q4 | **Contrast AA** | every token pair in 4.3 computed from the live `getComputedStyle` values: text pairs >= 4.5:1, UI/large pairs >= 3:1, in light and dark | `tests/qa/contrast.mjs` |
| Q5 | **Zero console errors/warnings** | no `console.error`, no `pageerror`, no failed requests, no `404`, across all flows and routes | built into every QA script |
| Q6 | **Zero external network requests** | every request URL is same-origin (`http://127.0.0.1:4100`) or `data:`/`blob:`; no request to any other host | `tests/qa/network.mjs` |
| Q7 | **Keyboard operable** | Tab reaches every control in a logical order; `Enter`/`Space` activate; every Sheet traps focus, closes on `Esc`, returns focus; visible focus ring (3px `--focus`) on every control | `tests/qa/keyboard.mjs` |
| Q8 | **Page basics** | `<html lang="en-GB">`; one non-empty `<title>`; `meta viewport` with `viewport-fit=cover`; `meta color-scheme`; two `theme-color` metas; `rel=manifest`; `rel=icon`; exactly one `<h1>` per landing page and per dashboard view; images/SVG decorative have `aria-hidden`; no duplicate ids | `tests/qa/basics.mjs` |
| Q9 | **Reduced motion** | with `prefers-reduced-motion: reduce` the breaker art is in its final state, the live dot does not pulse, sheets appear without sliding | `tests/qa/basics.mjs` |
| Q10 | **Forbidden APIs** | a grep over `electrician/js` (EXCLUDING `js/vendor/`, which legitimately contains `innerHTML` handling), `electrician/css`, `index.html` and `dashboard.html` finds no `innerHTML`, `dangerouslySetInnerHTML`, `document.write`, `eval(`, `Date.now(`, `performance.timeOrigin` or bare `new Date()` outside `js/core/clock.js`, no `86400000`, no root-absolute URL (`href="/`, `src="/`, `url(/`), and no `https://` string other than the allowed link patterns of 10.5. `tests/`, `scripts/` and `docs/` are not scanned. | `tests/qa/grep.mjs` |
| Q11 | **Both base paths work** | the site passes Q5/Q6 and flows F1, F6 when served at `/` (port 4100) AND at `/LG-Proto1/electrician/` (a static server mapping that prefix to the folder) | `tests/e2e/run.mjs --prefix` |
| Q12 | **Unit tests green** | `TZ=Europe/London node --test "electrician/tests/unit/*.test.mjs"` (quoted glob; a bare directory fails on Node 22) | |
| Q13 | **E2E flows F1 to F20 green** | at 375x812; F1, F3, F6, F7 also at 1440x900 | `tests/e2e/run.mjs` |
| Q14 | **Live deploy** | After the deploy in 16.2, `https://gokulmadan-ws.github.io/LG-Proto1/electrician/index.html`, `dashboard.html`, `js/landing/app.js`, `js/dashboard/app.js`, `js/dashboard/views/stub.js`, `fonts/figtree-latin-wght-normal.woff2` and `img/favicon.svg` all return 200 with the right content type, and Q5, Q6 and flows F1 and F6 pass against that URL | `tests/e2e/run.mjs --base <url>` |

### 15.3 Weight and speed targets (SHOULD; measured, reported, not blocking unless 2x over)

| Target | Value |
|---|---|
| Landing initial JS (own code, excluding vendor), uncompressed | <= 130 KB |
| Vendor `preact-htm.js` | 13 KB (fixed) |
| Landing CSS total (fonts, tokens, base, components, landing, booking), uncompressed | <= 70 KB |
| Fonts | <= 65 KB (two files) |
| Images on the landing page | <= 30 KB total (all SVG) |
| Landing transfer, gzip | <= 250 KB |
| Dashboard shell transfer, gzip (before views) | <= 200 KB; each view <= 25 KB gzip |
| First render of hero H1 on a local server, Chromium default | <= 1 s |
| `localStorage` state size with seed | <= 100 KB |

### 15.4 Visual QA (WP0, screenshots reviewed by a human)

Screenshots at 375x812 and 1440x900, light and dark, of: landing top, landing services, confirmation, Today, Needs-you card, booking detail, Calendar day, Messages with bubbles, Settings, Insights. Reviewed against 4.1, 4.5 and the "friendly trades identity" brief (amber and navy, no council-finance look).

---

## 16. DEPLOYMENT NOTES

### 16.1 Head boilerplate (both pages; WP3 for `index.html`, WP2 for `dashboard.html`)

```html
<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
  <title>Voltmere Electrical: Local electrician. Booked in 60 seconds.</title>   <!-- dashboard.html: "Today · Voltmere dashboard" -->
  <meta name="description" content="Book Voltmere Electrical online in 60 seconds. Real availability, clear prices, a certificate with every job. Prototype with sample data.">   <!-- dashboard.html: "Owner dashboard for Voltmere Electrical bookings. Prototype with sample data." -->
  <meta name="robots" content="noindex, nofollow">   <!-- a prototype with sample data must never be indexed -->
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#FBF8F2" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0B1020" media="(prefers-color-scheme: dark)">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="icon" href="img/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="img/apple-touch-icon.png">
  <link rel="preload" href="fonts/figtree-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="fonts/bricolage-grotesque-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="modulepreload" href="js/vendor/preact-htm.js">   <!-- the app is ~45 small unbundled modules: preloading the roots shortens the import waterfall -->
  <link rel="modulepreload" href="js/ui/index.js">
  <link rel="modulepreload" href="js/core/store.js">
  <!-- landing:   <link rel="modulepreload" href="js/landing/app.js"> -->
  <!-- dashboard: <link rel="modulepreload" href="js/dashboard/app.js"> -->
  <link rel="stylesheet" href="css/fonts.css">
  <link rel="stylesheet" href="css/tokens.css">
  <link rel="stylesheet" href="css/base.css">
  <link rel="stylesheet" href="css/components.css">
  <!-- landing:   <link rel="stylesheet" href="css/landing.css"> <link rel="stylesheet" href="css/booking.css"> -->
  <!-- dashboard: <link rel="stylesheet" href="css/dashboard.css">   (view CSS is loaded by the router) -->
  <script>
    (function () {
      try {
        var t = localStorage.getItem('vm_theme');
        if (t === 'light' || t === 'dark') {
          document.documentElement.setAttribute('data-theme', t);
          var c = t === 'dark' ? '#0B1020' : '#FBF8F2';
          var m = document.querySelectorAll('meta[name="theme-color"]');
          for (var i = 0; i < m.length; i++) m[i].setAttribute('content', c);
        }
      } catch (e) {}
    })();
  </script>
</head>
<body>
  <div id="app"></div>
  <noscript>This prototype needs JavaScript to run. Please enable it, or call 07700 900412.</noscript>
  <script type="module" src="js/landing/app.js"></script>   <!-- dashboard.html: js/dashboard/app.js -->
</body>
</html>
```

`#app` is emptied by `bootApp` before the first `render()`. `index.html` MAY pre-render a static header, H1 and call button inside `#app` for first paint (SHOULD S8); `bootApp` replaces it. Every `href`/`src` is relative. The inline script is the ONLY inline script. `js/landing/app.js` sets `window.name = 'vm-site'`; `js/dashboard/app.js` sets `window.name = 'vm-dashboard'`. Cross-page links add `target="vm-dashboard"` / `target="vm-site"` (via `pageTarget(file)` in `js/ui/util.js`, NO `rel="noopener"`, same origin) so the demo re-uses two tabs instead of opening new ones every tap.

### 16.2 Paths and hosting

- **Relative paths only.** Works under `https://gokulmadan-ws.github.io/LG-Proto1/electrician/` (GitHub Pages sub-path) and at a domain root (Vercel). Never `/css/...`, never `location.origin + '/...'`. JS-built URLs use `new URL('../x', import.meta.url)` or relative strings. `SITE_BASE_URL` (config.js) is derived from `import.meta.url`.
- **Needs an HTTP server.** ES modules do not load from `file://`. Local: `python3 -m http.server 4100 --directory /home/user/LG-Proto1/electrician`, then open `http://127.0.0.1:4100/index.html` and `.../dashboard.html`. The README says this in the first lines.
- **GitHub Pages (read this before promising a live link).** The repo already publishes through GitHub's `pages-build-deployment` workflow, from the repository's DEFAULT branch root. At the time of writing the default branch is `claude/ecstatic-meitner-j31xes`, NOT the feature branch this work is built on, and a root-level `.nojekyll` already exists (so folders and files starting with `_` are served; this contract avoids them anyway). Therefore `electrician/` only appears at `https://gokulmadan-ws.github.io/LG-Proto1/electrician/` once its commits are on the Pages source branch. WP0 must: (1) confirm the source branch (repo Settings > Pages, or `gh api repos/gokulmadan-ws/LG-Proto1/pages` when the proxy allows it); (2) land the `electrician/` folder on that branch through a pull request and merge it (the PR must touch NOTHING outside `electrician/`); (3) wait for the `pages-build-deployment` run to finish; (4) run gate Q14 against the live URL. A `.nojekyll` inside `electrician/` is harmless but does nothing. No server-side routing is used (hash routes only), so there is nothing to 404.
- **Cache:** none of the files are fingerprinted; Vercel headers below set `must-revalidate` so a redeploy is visible immediately. GitHub Pages instead serves `Cache-Control: max-age=600` and the ES modules are separate files, so for up to 10 minutes after a redeploy a returning browser can mix old and new modules and show a broken page. Tell the SE to hard-refresh (or use a fresh private tab) after any redeploy, and never redeploy in the minutes before a demo.

### 16.3 `vercel.json` (WP0; deploy the folder alone with `vercel deploy electrician --prod` or `cd electrician && vercel --prod`)

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null,
  "installCommand": null,
  "buildCommand": null,
  "outputDirectory": ".",
  "cleanUrls": false,
  "trailingSlash": false,
  "headers": [
    { "source": "/(.*)", "headers": [
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
    ] },
    { "source": "/(.*)\\.(html|js|css|webmanifest)", "headers": [
      { "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }
    ] },
    { "source": "/fonts/(.*)", "headers": [
      { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
    ] }
  ]
}
```

The repo root has its own `vercel.json` (`cleanUrls: true`) for the Kontor project. Deploy the `electrician/` FOLDER on its own to get the file above; deploying the repo root would still serve the app under `/electrician/` (relative URLs and hash routes survive) but with the other project's headers and clean-URL redirects.

### 16.4 `manifest.webmanifest` (WP2) and the install decision

```json
{
  "name": "Voltmere Electrical",
  "short_name": "Voltmere",
  "description": "Prototype booking site and owner dashboard for a local electrician. Sample data.",
  "start_url": "./index.html",
  "scope": "./",
  "display": "browser",
  "background_color": "#FBF8F2",
  "theme_color": "#FBF8F2",
  "icons": [
    { "src": "img/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "img/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "img/logo-mark.svg", "sizes": "any", "type": "image/svg+xml" }
  ]
}
```

`display: "browser"` is deliberate: it gives the pages a manifest, name and icons (tab, bookmarks, Lighthouse) WITHOUT making them installable as standalone apps. On iOS an installed web app gets storage separate from Safari, which would silently break landing-to-dashboard sync and wreck the demo. There is no service worker. The README tells the SE to demo in a normal browser tab, not from the home screen.

### 16.5 README outline (`electrician/README.md`, WP0)

1. What this is (two sentences) and the live link placeholder.
2. Run it locally (the `python3 -m http.server` line; why not `file://`).
3. The two pages and how they share data (one browser, two tabs, `localStorage`).
4. The 3-minute demo script (from 1.2) and the extended demo.
5. Rebrand it for the friend in 20 seconds (Settings > Business) or in one file (`js/core/config.js`, `css/tokens.css`).
6. Clock override `?now=YYYY-MM-DDTHH:mm&freeze=1`.
7. What is real and what is simulated (the table from 17, short).
8. Tests: unit, e2e, QA commands.
9. Deploy: GitHub Pages sub-path with the source-branch and 10-minute-cache warnings from 16.2; Vercel (`vercel.json`); note that no build step exists.
10. File map (pointer to `docs/BUILD-CONTRACT.md`) and credits (fonts OFL, icons ISC).

### 16.6 Third-party notices

Fonts: SIL Open Font License 1.1 (Bricolage Grotesque, Figtree), notice in `fonts/LICENSE-OFL.txt`. Icons: lucide-static, ISC licence, notice in the header comment of `js/ui/icons.js`. Preact and htm: MIT (vendored file header).

---

## 17. What is simulated versus what a real build needs (for the commercial team; this IS the content of the About screen, `about-table`)

Honest framing, said out loud and printed on the About screen: **"Everything you tapped is real UI and real logic running on this phone. The three things that are not real are exactly what you pay a platform for: a shared database, the WhatsApp connection, and a login."**

### 17.1 Works for real in the browser (no server)

The availability engine and diary (windows, half-day jobs, notice, horizon, days off, blocks, "full today"); booking creation with double-booking protection and slot-taken recovery; status changes, reschedule, cancel, undo; live sync between the landing page and the dashboard across tabs of one browser; the owner's edits to hours, rules, prices and business name changing the customer page; `tel:` links; real `https://wa.me/...` deep links with the exact message pre-filled (they open the viewer's own WhatsApp, rerouted to the demo number when set); real Google Maps search links; `mailto:` links; a genuine downloadable `.ics` calendar file; light, dark and system themes.

### 17.2 Simulated and always labelled

Every WhatsApp, SMS and email message (the outbox shows the exact text the real system would send, as `Sent (simulated)` or `Scheduled ... (simulated)`); the arrival of those messages on Dan's phone; reminders firing at a time (derived from `sendAt`, no timers); payments (none: "pay after the job", a Paid flag only); reviews, star ratings and the 212 count; scheme registration and insurance claims; the postcode coverage list; the seeded customers and bookings; the persona "Dan Mercer" and the business itself; emergency response promises; the owner's "ETA" (chosen by Dan, not live tracking).

### 17.3 Real-build requirements table

| Feature | In this prototype | In a real build | Effort |
|---|---|---|---|
| WhatsApp alerts to the owner and customers | Simulated outbox plus real `wa.me` links | WhatsApp Business Platform (Cloud API): a dedicated business number, Meta business verification, pre-approved message templates (booking alert, confirmation, reminder, on my way, review) with quick-reply buttons, a webhook for button taps and replies. Meta bills per delivered template message (check Meta's current pricing; utility templates are free inside a customer-opened 24-hour window). | M-L |
| Bookings database and multi-device sync | `localStorage`, one browser, two tabs | Hosted database and API with server-side slot locking, so two customers on two phones cannot take the same window | M |
| Owner login and security | None | Passkey or magic-link login, access control, backups, audit trail | M |
| Reminders and scheduling | Timestamps, manual "Send now" | A scheduler or queue (cron, serverless timers) that fires reminders, retries failures | S-M |
| Payments and deposits | None ("pay after the job"), a Paid flag | Card payments and payment links (Stripe or Square), optional deposits for large jobs, receipts | M |
| Calendar sync | `.ics` download | Two-way Google, Apple or Outlook calendar sync | M |
| Owner notifications | In-app toast, badge, tab title | The WhatsApp alert is the notification; optionally web push for the dashboard | S |
| Consent and data protection | A consent sentence | Consent records, privacy policy, retention, UK GDPR and PECR review of WhatsApp opt-in | S-M |
| Reviews | Sample reviews | The owner's Google Business Profile review link and optional review monitoring | S |
| Certificates and invoices | None | Digital forms (EICR, EIC), PDF generation, e-signature, accounting export | L |
| Domain, hosting, SEO, analytics | GitHub Pages or Vercel sub-path, no analytics | The owner's domain, SSL, per-service and per-town pages, privacy-respecting analytics | S-M |
| Real credentials | Sample labels everywhere | The owner's scheme number, insurance details and genuine reviews | S |
| Postcode and travel | A local list of outward codes | Postcode lookup API, drive-time and travel charges | S-M |
| Photos of the fault | None | Upload storage and moderation | M |

---

## 18. Appendix: decisions log (so no agent re-litigates)

| Question | Decision | Why |
|---|---|---|
| Which proposal is the base | Voltmere (customer conversion) for the landing page, data contracts and the 4-window engine; Copper & Spark for owner ergonomics (state-driven primary button, "Taking bookings today", Owed, Undo toasts); Fernley & Watt for honesty (What's real, Compare card, actionable bubbles, live rebrand, Demo tools, data-derived unseen state) | Judges ranked conversion, owner use and demo/honesty differently; this takes each one's strength and cuts its scope. |
| Auto-confirm | ON by default for covered-zone bookings; emergency, edge and outside zones always wait for the owner | "Booked in 60 seconds" must be true; owner approval only where a decision is needed. The actionable-bubble moment still exists (approval bookings, emergencies). |
| Slot model | Four fixed two-hour windows, half-day jobs span two; no 30-minute grid, no travel buffer | How UK trades work; simplest to build and test. |
| Clock | Real clock; `?now=` for tests only; no pinned demo clock | Countdowns must not lie; Today stays populated because the seed is regenerated daily and future bookings always exist. |
| PWA | Manifest with `display: browser`, no service worker | iOS installed apps have separate storage. |
| Chime/vibrate | WON'T | Unreliable on iOS; banner, badge, highlight and title carry the moment. |
| Accent swatches | WON'T | Contrast risk. |
| Tabs | Today, Calendar, Bookings, Insights, More; Messages behind a header icon; Customers inside Bookings | Five tabs, thumb-sized; Messages stays prominent through the header icon and More. |
| Money | Owed, Collected, Nudge, Mark paid, six-week bars (SHOULD); no invoices/VAT | Owners check who owes them; accounting is out of scope. |
| Emergency copy | Safety first, then Call, then request; 105 for power cuts; never auto-confirmed; never blocks a window | Honest and safe. |
| Promise values | All in `PROMISES` | The SE can match the real friend's habits in one edit. |
| Scarcity and fake precision | None (no "only 2 left", no sub-ratings) | Reads as manufactured pressure. |
| Sample labelling | `SampleTag` on every credential, strip on both pages, "simulated" on every message | Honesty is a feature. |
| Cross-page links | `target` names `vm-site` and `vm-dashboard` reuse two tabs | Makes the two-tab demo natural on a phone. |
| Navigation at 768 to 1099 | The bottom tab bar (no rail) | One navigation layout fewer; the demo is on a phone. |
| History inside the booking sheet | ONE push to open, `replaceState` for every step | Back and X close the sheet in one step however many steps were visited. |
| Unread messages | Counted with a monotonic `seq`, not minute-precision stamps | A message arriving in the same minute as the owner opened Messages must still count. |
| Customer reschedule on Manage | Cut (store function and tests stay) | WP3 is the critical path; the demo never needs it. |
| Home of `showUndoToast` | `js/ui/toast.js` (WP2) | Today, Calendar, Messages and job actions all need it; no cross-package imports. |
| Test dependencies | Installed in the scratchpad, resolved by `loadDeps()` | The repo has no `node_modules`, and its root `package.json` belongs to another project. |
| Unit test command | Quoted glob | `node --test <directory>` fails on Node 22. |
| Order of Today | Needs you, Next up, then Availability | What the owner must act on comes first. |

### 18.1 Known traps (read before coding)

1. `localStorage` events do not fire in the tab that wrote; the store notifies local subscribers directly. Other tabs get the `storage` event; frozen background tabs get the foreground re-read.
2. Fictional phone numbers and addresses do not work in WhatsApp or Google Maps. That is what the demo phone override and the Demo tools text are for.
3. `Sheet` and `ToastHost` render into their OWN containers inside `#overlay-root`, which is outside `#app`, so setting `inert` on `#app` never inerts toasts (and each container has exactly one `render()` call, 6.1.1).
4. Preact's `render()` into a non-empty container tries to reuse the DOM; always empty `#app` first.
5. Keys in `settings.hours` are weekday NUMBERS by array index (0 = Sunday). Monday is index 1.
6. Never compare Stamps with `Date` objects; compare strings, or convert with `parseStamp`.
7. A `new` (awaiting approval) booking still occupies its window. Only `cancelled` (and urgent) bookings do not.
8. The seed contains bookings in the past and the future; "Today" at 21:00 may have all jobs `done`. That is expected; Next up then shows the next confirmed job on a future day.
9. `useStore` selectors that build new arrays every call are fine (shallow compare), but do not return freshly created objects containing new nested objects.
10. Do not add `package.json`, `node_modules`, or build output under `electrician/`.
11. Preact + htm has eight verified traps (6.1.1). The two that bite hardest: `spellcheck="false"` (a string) turns spell-check ON, and two `render()` calls on one container replace each other.
12. `node --test <directory>` fails on Node 22; use a quoted glob. Playwright and axe-core are not installed in the repo; use `loadDeps()`.
13. GitHub Pages publishes the repository's default branch, not the feature branch (16.2). A commit on the feature branch alone is not live.
14. Stamps have minute precision and the test clock may be frozen: never use `at` alone to order or to count anything; messages have `seq`.
15. iOS Safari and Chrome do not shrink `100dvh` for the on-screen keyboard; use `--kb-inset` (5.1 item 15) or the submit button disappears behind the keyboard.
16. A day rollover reseeds the demo bookings. `buildSeed` must be given the non-seed records (`existing`) or it can double-book a window the owner or a customer already holds.

---

## 19. Change log (critic pass), version 1.0 to 1.1

The integration-risk critic read the whole contract, then verified the claims that could silently break an 8-agent parallel build: every token pair's contrast (computed, light and dark), npm package versions, font file sizes and all 67 icon names, the vendored Preact's attribute and `render()` behaviour in Chromium, `node --test` on Node 22, and the repo's Pages and test-dependency facts. Numbering and structure are unchanged; only the new sub-sections `6.1.1` and `8.1.1` and this section were added.

**Defects found by running things, now fixed**
- `node --test electrician/tests/unit/` FAILS on Node 22 (a directory is treated as a module). Now a quoted glob everywhere (6.1, 8.9, Q12).
- Playwright and axe-core are not installed and the repo has no `node_modules`; the contract pointed at `/home/user/LG-Proto1/node_modules/axe-core`. Now installed per agent into a scratchpad and resolved by `loadDeps()` (6.1, DoD, Q3, 4.8).
- Preact turns `spellcheck="false"` into TRUE; a second `render()` on one container replaces the first; `render()` into a non-empty container appends; htm eats whitespace around newlines. New 6.1.1, and 12.4 / 11.6 give Sheet and ToastHost separate containers (the old text had both render into `#overlay-root`).
- Light-mode `--focus` is 2.4:1 on the navy panels: new token `--focus-on-panel`. All other pairs verified; `--field-border` comment corrected.
- GitHub Pages publishes the repo DEFAULT branch (`claude/ecstatic-meitner-j31xes`), not the feature branch: 16.2 now says how to get a live link, gate Q14 checks it, plus the 10-minute Pages cache trap.
- The 7-column day picker needed 332px but was specified from 360px (328px available): moved to 375px (documented as the one extra breakpoint); sticky bar widths fixed below 375px; the week strip chips are 44px.
- Landing header at 768 could not fit five links plus phone plus button: links only from 1100.
- The Bookings tab dot is already lit at first launch by the two unseen seed bookings, so F1 and the demo script no longer rely on it (Messages badge instead).
- Seed said "all statuses" but has no `on_the_way`; seeds could double-book windows after a day rollover (`buildSeed` now takes `existing`); F16 said "three" Marcus bookings (two) and search ignored whether filters apply (now searches all).
- Minute-precision stamps made unread counts and message order unreliable: `Message.seq`, `meta.msgSeq`, `meta.messagesSeenSeq` replace `messagesSeenAt`; deterministic ordering and message insertion order in 8.4.
- Booking-sheet history: Back or X would leave the sheet half open after several steps. New exact model in 11.1 (one push, `replaceState` per step, `goBooking`, `useBookRoute`).
- Unspecified or contradictory: `postcodeZone` needed the business zones; `icsFilename` needed settings; `DTSTAMP` must be UTC; `{line1}` empty for urgent requests, "can't make as soon as possible" wording (new `{serviceWhen}`), `{certLine}` for the survey visit, a stale `{reviewLink}` domain, hard-coded dates ("Sep 2026", "26/10 08:00"), gendered "him" copy; `ToastHost` was mounted in three different places; `showUndoToast` lived in WP5 but WP4 to WP8 all need it (moved to `js/ui/toast.js`); `_stub.js` renamed `stub.js`.

**Gaps filled**
- 8.1.1: exact signatures for every export of `dates.js`, `format.js`, `messages.js`, `ics.js`, `seed.js` that 8.1 listed by name only; `selectBrand` now carries `demoPhoneDigits` and the zones; `makeId` is random (frozen test clocks cannot collide); the generic mutation-failure and double-tap rules (8.3); undo re-validates freed windows; `getDayLoad` treats an all-past today as `closed`, and the DayPicker reads per-service `freeSlots`.
- Mobile: on-screen keyboard handling (`--kb-inset`, `is-keyboard-open`, `interactive-widget`), touch-action and text-size-adjust, safe-area inline padding, sticky-header sibling rule, no `overflow-x: hidden` on page roots, 44px hit box for the 28px prototype-strip link, `Sheet` `header` prop and nested-sheet `inert`, toast offsets that clear the tab bar and FAB, WP3 triage order.
- Accessibility: roving tabindex on `Segmented`, `aria-pressed` on day and window buttons, persistent live regions, `role="alert"` for danger toasts, landing error boundary, `--fs-14` instead of a 13px size.
- Deploy: `robots noindex`, `modulepreload`, relative-`url()` rule, root `vercel.json` note, Playwright context `timezoneId: 'Europe/London'`.

**Scope cut (also in 2.3)**
- Customer self-service reschedule on Manage (store function and tests stay); the 768 to 1099 icon rail (bottom tab bar up to 1099); sticky day headings in Bookings. Customers master-detail demoted to SHOULD (S10).

**Decisions made**
- Today renders Needs you, Next up, then Availability; Settings shows one shared `Saved` tick; unblocking a grouped block offers "all windows"; owner New booking replaces history after saving; Demo tools shows an inline result line instead of a second toast; F6 rebrands to `Ashby Sparks` / `Lee` (not `Sam`, which is already the apprentice and a seed customer); new testids: `footer-about-link`, `bookings-mark-all-seen`, `detail-overflow-sheet`, `job-secondary-unpaid`, `calendar-unblock-group`, `demo-sim-result`; removed `rail`, `manage-change`, `manage-save-time`.
