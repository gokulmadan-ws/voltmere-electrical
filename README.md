# 180 Electrical: enquiry-to-install platform (pre-sales prototype)

A working prototype of an enquiry funnel and a phone-first owner dashboard for 180 Electrical, a Northern Ireland home EV charger installer (owner: Daniel, WhatsApp 07885 496800). Customers use his own six-question funnel, and Daniel runs the whole sales process (enquiry, survey, quote, accepted, install, paid) from his phone; the enquiry, the quote and the acceptance really travel between two phones through WhatsApp links with no server, and everything else a platform would provide is simulated and labelled as such.

Everything is static: Preact and htm as ES modules, no build step, no install step, no backend, sample data only. Daniel's real phone, email, credentials, brands and photos are used; every customer, price and message in the demo diary is invented.

## Live links

| What | Link |
|---|---|
| Customer site (landing, funnel, confirmation) | https://gokulmadan-ws.github.io/voltmere-electrical/ |
| Owner dashboard | https://gokulmadan-ws.github.io/voltmere-electrical/dashboard.html |
| A customer quote, same browser (opens a sample quote from the demo diary) | https://gokulmadan-ws.github.io/voltmere-electrical/quote.html#q=Q-EL-1019 |
| A customer quote, link mode (the quote travels inside the link, so it opens on any phone) | `https://gokulmadan-ws.github.io/voltmere-electrical/quote.html#d=<payload>`, built by the dashboard when Daniel sends a quote |
| What Daniel's phone opens from the customer's WhatsApp message | `https://gokulmadan-ws.github.io/voltmere-electrical/dashboard.html#import=<payload>` |

All pages are `noindex, nofollow`. Nothing is sent to a server. The only outside requests are Daniel's own photos, hot-linked from `perspective.imgix.net` and `images.unsplash.com` (images only).

**Before you demo, read this.** The "Send my enquiry to Daniel on WhatsApp" button opens a WhatsApp chat to Daniel's real number, 07885 496800. If you press send there, the real Daniel gets a real message. For any demo where he is not expecting it, first set a demo mobile on each phone (dashboard, More, Demo tools, "Open WhatsApp links with this mobile number"). See `docs/DEMO-SCRIPT.md`.

## Show: With ideas | Only my content

The public pages (landing, funnel, confirmation, quote page) carry a strip with a switch, **Show: With ideas | Only my content**.

- **Only my content** shows what Daniel's current site already says: his hero, three steps, six FAQs, his six funnel questions and options, his thank-you page, his two credentials, his phone and email, word for word from `docs/reference/180-site-report.md`.
- **With ideas** (the default) adds what we are proposing: a running-costs calculator, an example quote, a suggested visit slot, the "send it to Daniel on WhatsApp" card and the demo panels. Every idea is tagged **Idea from us, not on your site today**.

Use it to answer "is this my site?" (yes: flip to Only my content) and "what did you add?" (flip back). The choice is remembered per device, and `?clean=1` or `?clean=0` in the address sets it. `tests/qa/audit.mjs` checks the split.

## The 5-minute demo (two phones)

The full script, with the exact taps and what to say, is in `docs/DEMO-SCRIPT.md`. The shape of it:

1. **Phone A (the customer)** opens the site, flips Only my content and back to With ideas, taps **Get my installation quote** and answers the six steps.
2. The confirmation says "Thanks, your enquiry has been received." Phone A taps **Send my enquiry to Daniel on WhatsApp** and presses send.
3. **Phone B (Daniel)** taps the link in that WhatsApp message. The **Import** screen shows exactly what the customer typed; **Add to my dashboard** creates the enquiry, with a 24 hour reply clock.
4. Daniel confirms the survey visit, then opens **More, Quotes, New quote**, picks the enquiry, taps **Send** and **WhatsApp**.
5. Phone A taps the link in the quote message. The quote opens on a phone that has never seen it. The customer taps **Accept quote**, answers "Which days suit you?" and opens WhatsApp with the reply written for them.
6. Phone B taps the link in the reply, then **Mark quote accepted and plan the install**. The job appears in the Pipeline under Accepted, ready for Daniel to confirm an install day.
7. Finish on **What's real** and say what a live build replaces: his funnel webhook, a database, a login and automatic delivery.

One phone only? Use **More, Demo tools** (A customer opens, accepts or declines a quote; Add a sample website enquiry; Reset diary and messages).

## Make it his: Settings and config

In the dashboard open **More, Edit** (or **Settings, Business and brand**). Changes save as you go and show on the customer site straight away.

| To change | Where |
|---|---|
| Business name, short name, first name, phone, email, tagline, area, address | Settings, Business and brand |
| Credentials (the trust bar) and the charger brands | Settings, Business and brand (comma separated) |
| His photos: logo, hero, about, four recent installs | Settings, Website photos (Change photo, or a web address under Advanced) |
| Which services show on the website, and starting prices | Settings, Services and prices (the website offers only the free survey and quote) |
| The quote price list, quote terms, how long a quote stays valid, the reply promise (24 h) | Settings, Quotes and replies. Every price is labelled SAMPLE. |
| Working days and windows, days off, notice, how far ahead | Settings, Availability |
| Open WhatsApp links with your own mobile, reset the diary, the demo script | More, Demo tools |

In code, the defaults live in `js/core/config.js` (`makeDefaultBusiness`, `PROMISES`, `DEFAULT_IMAGES`, `ENQUIRY_STEPS`, `makeDefaultQuoteItems`), his words in `js/landing/content.js` and `js/booking/funnel.js`, and the colours in `css/tokens.css` and `css/public-tokens.css` (brand red `#E11414`, near-black `#0B0B0C`, near-white `#F5F5F4`). The public pages open in light and use Archivo; the dashboard opens in dark and uses Inter and Manrope. Do not invent prices, guarantees, years in business or reviews for him: his site makes none, and the audit fails if they appear outside a tagged idea.

## Real or simulated

| Thing | Real in this prototype | Simulated or sample |
|---|---|---|
| Customer funnel: his six steps and thank-you page | Real UI with validation, saved in the customer's browser | Nothing is submitted to Perspective |
| An enquiry reaching Daniel's phone | Real: a `wa.me` link opens the customer's own WhatsApp with the details and a link; Daniel taps it, sees it and adds it | The customer must tap send. A live build uses his funnel webhook with no tapping |
| A quote reaching the customer, and the accept or decline coming back | Real: the quote travels inside its link; the reply is a WhatsApp message with a link that Daniel taps | No server records it; Daniel is not told the quote was opened |
| Pipeline, reply clock, quote builder, lead sources, insights | Real logic on the data in that browser | Sample enquiries, customers (Ofcom drama numbers, made-up BT streets), quotes and ad spend |
| Availability engine, diary, double-booking protection | Real logic | Per browser: two phones do not share a diary |
| Messages to customers and to Daniel, reminders | The exact text is real; `wa.me`, `tel:`, `mailto:` and map links open real apps | Nothing is sent by itself; the outbox says "Sent (simulated)" |
| Connections: domain, webhook, ad tracking, WhatsApp Business, Google Calendar, Gmail | Each wizard works and saves on the device | Labelled "Simulated in this prototype"; fictional `sites.example` and `192.0.2.10` records, demo code 482913 |
| Payments | A Paid flag and method | No card, no deposit, no receipt |
| Photos from customers | Resized and kept in the browser (three per enquiry) | A live build uploads and stores them |
| Calendar file, QR codes, tracked links | Real `.ics` download, real QR codes, real UTM links | |
| Database, login, sync between devices, scheduled sends | Not present | A real build needs them |
| Reviews, prices, guarantees, years in business | Not shown, because his site shows none | Quote prices are samples, labelled so |

The dashboard's **What's real** page says the same, in the app.

## What a real build needs

1. **A webhook from his Perspective funnel** (or his funnel moved onto our own page) into a backend that checks the signature, stores the enquiry and alerts him. This replaces the "customer taps send" step.
2. **WhatsApp Business Platform** (Cloud API): Meta business verification, a dedicated number, pre-approved message templates and a webhook for replies.
3. **A database** (suggested: Postgres on Supabase) so every phone sees the same diary, quotes and enquiries, with server-side slot locking.
4. **Owner login** (passkey or magic link), backups and an audit trail.
5. **Google sign-in (OAuth)** for Calendar, plus Gmail or an email service on his own domain with SPF, DKIM and DMARC.
6. **His domain** (DNS, certificate, redirects).
7. **Payments** if he wants deposits or payment links (Stripe), and certificates and paperwork only if he wants them generated.
8. **Data protection**: privacy policy, consent records, UK GDPR and PECR review of WhatsApp and marketing opt-in.

A rough phase plan for the commercial team (one full-stack engineer plus part-time design and project management). The detail, architecture, risks and open questions for Daniel are in `docs/PRODUCTION-PLAN.md`.

| Phase | What | Weeks |
|---|---|---|
| 0. Discovery and access | Perspective webhook, WhatsApp number, domain, Google and Meta access; start Meta verification | 1 |
| 1. Foundations | Repo, CI, database, owner login, a data adapter replacing `localStorage` | 2 |
| 2. Intake | Webhook endpoint, enquiry inbox, 24 hour reply clock, WhatsApp and email alerts | 2 |
| 3. Quotes | Persistent quote builder, private quote links, recorded accept and decline, PDF copy | 3 |
| 4. Diary and calendar | Server-side availability and slot locking, Google Calendar sync | 3 |
| 5. Pipeline and ads | Pipeline, insights, lead sources, Meta and Google tags, cost per enquiry | 2 |
| 6. Launch | Hardening, monitoring, privacy documents, training, cut-over | 2 |
| Optional: payments and paperwork | Payment links, deposit, invoices, certificates | 3 to 5 |

That is about 15 weeks end to end for one engineer, or 10 to 12 with a second person. These are estimates, not a quote.

## Run it locally

ES modules do not load from `file://`, so use any static server (Python 3 is enough):

```
python3 -m http.server 4100
```

- Customer site: http://127.0.0.1:4100/index.html
- Owner dashboard: http://127.0.0.1:4100/dashboard.html

`npm run serve` does the same. There is no install step and no build.

The clock can be pinned for screenshots and tests: `?now=2026-10-23T20:30&freeze=1` (a Friday evening, which the demo diary is built around).

## Tests

```
# unit tests: data layer, handoff payloads, messages, migrations (also run under TZ=UTC and TZ=America/New_York)
TZ=Europe/London node --test "tests/unit/*.test.mjs"      # npm test
```

Browser tests need Playwright and Chromium, which are not installed in the repo:

```
npm i --prefix /tmp/qa playwright-core@1.56.1 axe-core@4.10.2
QA_DEPS_DIR=/tmp/qa node tests/e2e/landing.mjs            # landing, funnel, confirmation, manage
QA_DEPS_DIR=/tmp/qa node tests/e2e/dashboard.mjs          # owner dashboard, every screen
QA_DEPS_DIR=/tmp/qa node tests/e2e/handoff-journey.mjs    # the two-phone loop, in separate browsers
```

The other e2e files cover the quote page (`quote-q2`), the owner's quote builder (`quotes-q1`), the pipeline and insights (`pipeline-p1`), the import screen (`handoff-f4`) and the connection wizards (`connections-k1`, `connections-k2`). The gates in `tests/qa/`:

- `audit.mjs`: content, honesty and docs. No old-brand strings; no "pencilled" or "provisional" where a customer reads; no invented claims outside a tagged idea; his words present exactly (diffed against `docs/reference/180-site-report.md`); everything simulated is labelled; his phone, WhatsApp and email links are right; page heads and manifest; British English; one money and one date format; and these docs. `QA_DEPS_DIR=/tmp/qa npm run audit` (add `STATIC_ONLY=1` to run only the source scans, which need no browser).
- `matrix.mjs`: every page and route in dark and light at 320 to 1440 px (overflow, 44 px tap targets, axe, contrast, focus, layout shift, reduced motion).
- `robust.mjs`: tries to break it (storage blocked or full, corrupted saves, two tabs, double taps, hostile text and links, clock edge cases, 100 bookings). `npm run robust`.
- `perf.mjs`: the performance gate. Loads the landing page, the quote page and the dashboard (`#/today`) cold on a throttled mid-range phone (Chromium at 4x CPU, 1.6 Mbps and 150 ms, a 412 px phone at 2.625 DPR, gzip over HTTP/2, his two photo hosts answered with real JPEG stand-ins of realistic sizes) and fails when a budget breaks: requests, bytes, JS and CSS size, first and largest contentful paint, long tasks, layout shift (on load, while scrolling the whole landing page, and while the fonts arrive late), idle re-renders and storage writes on the dashboard, passive scroll listeners. The returning-visitor (warm) loads are checked too. `npm run perf`; `RUNS=5` and `PERF_JSON=file` are the knobs (the file header lists them).

## Performance

The pages are unbundled ES modules, so the first load is kept short on purpose (the numbers are in the PERF gate above).
- `scripts/modulepreload.mjs` writes the `<link rel="modulepreload">` block of each page from its static import graph (a module graph five levels deep costs five round trips on a phone). Run `node scripts/modulepreload.mjs` after you add or remove an import; `tests/unit/modulepreload.test.mjs` fails when a block is stale.
- The first-load graphs import from the specific `js/ui/*.js` file, never from the `js/ui/index.js` barrel (the barrel pulls in the whole UI kit). Views that load later may use it.
- Landing page: the header and the hero paint first, everything below the fold (`js/landing/below.js`) mounts after the first paint, the booking sheet and `css/booking.css` (`js/landing/booking-host.js`) are fetched on the first touch or when a quote button is reached, photos below the first screen start once the page has loaded, and only the logo and the hero photo are fetched early (preloaded in the head with the srcset the page itself uses).
- Fonts are preloaded with `font-display: swap` and size-matched fallbacks (`css/fonts.css`), so a late font moves nothing. `scripts/subset-fonts.py` records how the two font files were trimmed.
- The dashboard's default view (`#/today`) is preloaded by an inline script in `dashboard.html`, and only when the page is opened on that route.

## Deploy

- **GitHub Pages:** Settings, Pages, Deploy from branch `main`, folder `/ (root)`. All paths are relative, so it works under any sub-path, and `.nojekyll` is included. Pages caches for about 10 minutes, so hard-refresh after a redeploy.
- **Vercel:** import the repo, or run `vercel --prod` in this folder. `vercel.json` sets no build, serves the folder as it is, and adds `nosniff`, a referrer policy and revalidation headers.
- Deployed pages are `noindex`. Remove the robots meta in the three HTML files only when the prototype becomes the real site.

## Repo map

```
index.html, quote.html, dashboard.html   the three entry pages (head, #app, one module each)
manifest.webmanifest, vercel.json         icons and theme; static hosting headers
css/                                      tokens.css (every colour), base, components, one file per area
js/core/                                  data layer, no DOM: store, config, availability, pipeline,
                                          quotes, messages, handoff (WhatsApp payloads), seed, selectors
js/ui/                                    UI kit: buttons, sheets, forms, wizard, simulation banners, ideas switch
js/landing/                               the public landing page (his words live in content.js)
js/booking/                               the six-step funnel, confirmation, manage, the owner's phone-job sheet
js/quote/                                 the customer quote page (same browser and link mode)
js/dashboard/                             owner dashboard: shell, router, views/ (one file per screen)
js/vendor/                                Preact, htm and a QR code generator (do not edit)
img/, fonts/, scripts/                    brand marks and icons; Archivo, Inter and Manrope (local); scripts for icons, module preloads and fonts
tests/unit, tests/e2e, tests/qa           unit tests, browser journeys, the quality gates above
docs/DEMO-SCRIPT.md                       the 5-minute two-phone demo with exact taps
docs/PRODUCTION-PLAN.md                   scope, architecture, phases, risks, effort, questions for Daniel
docs/V3-SPEC.md, docs/V4-HANDOFF.md       the product spec, and the WhatsApp link loop
docs/V3-API.md, V4-API.md, V3-UI.md       core API and UI kit reference
docs/reference/                           his current site, read as data (the brief for his words)
docs/BUILD-CONTRACT.md                    the historical v1 spec, superseded by the V3 and V4 docs
```

Credits: fonts Archivo, Inter and Manrope (SIL OFL 1.1, see `fonts/LICENSE-OFL.txt` and `fonts/LICENSE-archivo-OFL.txt`); icons from lucide-static (ISC); Preact and htm (MIT); qrcode-generator (MIT). His photos are loaded from his current site and are his.
