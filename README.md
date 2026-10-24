# Voltmere Electrical: booking platform prototype

A working prototype of a booking site and owner dashboard for a one-van UK electrician. A customer lands on the site, sees real availability and prices, and books in about a minute. The electrician sees the job in a phone-first dashboard, confirms it, and the (simulated) WhatsApp messages go out.

All names, numbers, reviews and addresses are fictional sample data. Everything that WhatsApp, SMS, email or payments would really do is simulated and labelled as such.

**Live link:** https://gokulmadan-ws.github.io/voltmere-electrical/ (GitHub Pages, branch `main`, root folder)

## Run it locally

ES modules do not load from `file://`, so use any static server:

```
python3 -m http.server 4100
```

- Customer site: http://127.0.0.1:4100/index.html
- Owner dashboard: http://127.0.0.1:4100/dashboard.html

No build step. No install step. No backend.

## The two pages share one browser

Both pages read and write the same `localStorage` store, and update live across tabs. So a booking made on the customer page appears on the dashboard in the other tab within a second.

This is the honest limit of the prototype: data lives in one browser. A booking made on a customer's phone does **not** reach the owner's phone. For the demo, use two tabs on one device. Do not demo from an installed home-screen app (iOS gives installed apps separate storage).

## 3-minute demo

Full script: `docs/BUILD-CONTRACT.md`, section 1.2. Short version:

1. Open the customer site. Point at the live "next free visit" chips, the prices, the sticky Call / WhatsApp / Book bar.
2. Book a job (tap a tile, pick a time, tap "Demo: fill sample details", confirm). Show the confirmation and the WhatsApp bubble the owner "received".
3. Tap "Owner login (demo)" in the footer. The booking is there as a job card, with a badge and a toast.
4. Open Messages. Tap a button inside the bubble. The customer reply is logged.
5. Open Calendar, block a free window. Back on the customer site, that time is gone.
6. Flip dark mode. Open "What's real in this prototype".

Fallback: dashboard `#/demo` has "Add a sample website booking" and "Reset diary and messages".

## Make it his in 20 seconds

Dashboard, More, Settings: change business name, owner first name, phone, tagline, prices. The customer site updates live. To change colours, edit `css/tokens.css`.

## What is real and what is simulated

| Real in the prototype | Simulated | A real build needs |
|---|---|---|
| Availability engine, bookings, diary, statuses, undo | WhatsApp, SMS and email sending | WhatsApp Business API connection |
| Prices and services from settings | Customer and owner notifications and reminders | A shared database so phones sync |
| `wa.me` links that open your own WhatsApp | Payments (paid is a tick box) | A login for the owner |
| Calendar (.ics) download | Reviews and sample customers | Reminders, payments, calendar sync |

## Tests

```
# unit tests (data layer)
TZ=Europe/London node --test "tests/unit/*.test.mjs"
```

End-to-end scripts are in `tests/e2e/`. They need Playwright and Chromium (not installed in the repo):

```
npm i --prefix /tmp/qa playwright-core@1.56.1 axe-core@4.10.2
QA_DEPS_DIR=/tmp/qa node tests/e2e/dashboard.mjs
QA_DEPS_DIR=/tmp/qa node tests/e2e/landing.mjs
```

The clock can be pinned for screenshots and tests with `?now=2026-10-23T20:30&freeze=1`.

## Deploy

- **GitHub Pages:** Settings, Pages, Deploy from branch `main`, folder `/ (root)`. All paths are relative, so it also works under any sub-path. Pages caches files for about 10 minutes, so hard-refresh after a redeploy.
- **Vercel:** import the repo, or run `vercel --prod` in this folder. `vercel.json` is included.

## Where things are

- `docs/BUILD-CONTRACT.md`: the full spec (names, data model, copy, test ids).
- `js/core/`: data layer (store, availability, messages, seed). Unit tested.
- `js/ui/`, `css/`: design tokens and UI kit.
- `js/landing/`, `js/booking/`: customer site and booking flow.
- `js/dashboard/`: owner dashboard.

Credits: fonts Bricolage Grotesque and Figtree (SIL OFL 1.1, see `fonts/LICENSE-OFL.txt`); icons from lucide-static (ISC); Preact and htm (MIT).
