<!-- docs/V3-UI.md: the V3 UI kit, tokens, routes and shell contract (what other roles code against).
     Owner: B3 (shell and UI kit). Written before the code; every name here is final. -->

# V3 UI: components, tokens, routes, shell

Audience: coding agents. All names here are pinned. Existing names (BUILD-CONTRACT 12, 14) are unchanged. Everything is exported from the barrel `js/ui/index.js`:

```js
// from js/dashboard/views/*.js
import { html } from '../../vendor/preact-htm.js';
import { Wizard, CopyField, CodeBlock, ConnectionBadge, StatusDot, Tabs, TabPanel, Timeline, Meter, ProgressRing,
         QrCode, MoneyInput, ConsentSheet, SimBanner, RealBuildNote, Disclosure, ListRow, DataTable, KeyValueList,
         saveFile, failureMessage, makeQr, qrSvgMarkup } from '../../ui/index.js';
import { routeHref, navigate, goBack } from '../router.js';
```

Rules that apply to every component: it accepts `class` and spreads other props (`data-testid`, `aria-*`) onto its root; no `innerHTML`; no hex colours (use tokens); every control is >= 44px; status is never colour only (icon + word); all motion honours `prefers-reduced-motion` (the global rule in base.css). Sheet content is a separate Preact root, so inside `ConsentSheet`/`Sheet` children read the store with `useStore`, never context.

CSS prefixes: new kit styles are `ui-*` in `css/components.css`; shell styles are `db-*` in `css/dashboard.css`. Never restyle another role's prefix; use the classes below.

## 1. Routes (js/dashboard/routes.js)

Route NAME = view file basename. Use `routeHref(name, params, query)` for every in-app link.

| name | hash | module | tab (highlighted) | immersive* |
|---|---|---|---|---|
| `pipeline` | `#/pipeline` | `./views/pipeline.js` | Bookings | no |
| `quotes` | `#/quotes` (query `f` = status filter) | `./views/quotes.js` | More | no |
| `quote-detail` | `#/quotes/:id` (`new` + `?booking=<id>`) | `./views/quote-detail.js` | More | yes |
| `connections` | `#/connections` | `./views/connections.js` | More | no |
| `connections-domain` | `#/connections/domain` | `./views/connections-domain.js` | More | yes |
| `connections-webhook` | `#/connections/webhook` | `./views/connections-webhook.js` | More | no |
| `connections-tracking` | `#/connections/tracking` | `./views/connections-tracking.js` | More | no |
| `connections-whatsapp` | `#/connections/whatsapp` | `./views/connections-whatsapp.js` | More | yes |
| `connections-calendar` | `#/connections/calendar` | `./views/connections-calendar.js` | More | yes |
| `connections-email` | `#/connections/email` | `./views/connections-email.js` | More | yes |
| `share` | `#/share` | `./views/share.js` | More | no |

`*` Immersive = the bottom tab bar and the FAB are hidden, the shell gives the page a small bottom padding, and a sticky action bar (`db-sticky-actions`, or the `Wizard` footer) sits at the very bottom of the screen. The wizard routes and the quote builder are immersive; the hub, webhook, tracking, quotes list, pipeline and share are normal tab pages. Every immersive page renders `PageHeader` with a `back` link (`{ href: routeHref('connections') , label: 'Connections' }`). Existing immersive routes are unchanged (`bookings/:id`, `customers/:key`, `new`).

The existing routes keep their names. Until a view file exists the shell shows `views/stub.js` (`data-testid="view-stub"`, "This screen is not built yet."): a failed import never breaks the shell. The shell also sets `document.documentElement.dataset.dbNav` to `tabs`, `fab` or `immersive` (CSS hook for toast and sticky offsets).

`isImmersive(route)` (router.js) now reads the `immersive` flag of the route table. `routeMeta(name)` is exported from routes.js.

More hub rows (E3, `more.js`) should use these links: Pipeline `routeHref('pipeline')` icon `list-checks`, Quotes `routeHref('quotes')` icon `file-text`, Connections `routeHref('connections')` icon `plug-zap`, Share and promote `routeHref('share')` icon `share-2`. The sidebar (1100px and up) already lists them (`nav-pipeline`, `nav-quotes`, `nav-connections`, `nav-share`).

### Shell test ids (new)
`tabbar-indicator` (the sliding active pill), `nav-pipeline`, `nav-quotes`, `nav-connections`, `nav-share`, `view-loading` (skeleton, unchanged), `view-stub` (unchanged), `toast` / `toast-action` (unchanged). The enquiry toast message still reads `New enquiry: <first name>, <postcode>` in ONE element.

## 2. Components

### Wizard (js/ui/wizard.js)

Stepper with a progress bar, a heading per step, Back and Next in a sticky footer, validation and focus management. The wizard holds the current step; steps hold only content.

```js
<${Wizard}
  title="Connect WhatsApp"                 // small heading above the stepper (not the page h1)
  steps=${[
    { id: 'number', title: 'Your number', hint: 'We send a code to check it is yours.',
      nextLabel: 'Send code',
      validate: () => (valid ? true : 'Enter a mobile number like 07885 496800.'),   // true | string | { ok:false, message } | Promise of those
      content: html`<${Field} ...>...<//>` },                                       // vnode, or (ctx) => vnode
    { id: 'code', title: 'Verify', optional: false, canNext: code.length === 6, content: (ctx) => html`...` }
  ]}
  step=${stepId}                           // optional: controlled by id; omit to let the wizard own it
  onStepChange=${(id, index) => {}}
  onFinish=${async () => store.connectWhatsApp(...)}   // runs after the last step validates. Return true | { ok:true } to complete;
                                                          // a string or { ok:false, message|reason } shows an error and stays
  finishLabel="Connect"
  onCancel=${() => navigate(routeHref('connections'))} // optional: first-step Back button becomes "Cancel"
  busy=${false}                            // parent-controlled spinner and disabled buttons
  testid="wa-wizard" />
```

`ctx` (for function content): `{ id, index, count, next(), back(), goTo(id), setError(message), busy }`. `validate` may be async: the Next button shows a spinner while it runs. `canNext: false` disables Next (use for "tick the box to continue"). Keys: Enter inside an `<input>` triggers Next.

Behaviour: on every step change focus moves to the step heading (`tabindex="-1"`), the wizard scrolls into view, and a polite live region announces "Step 2 of 4: Verify". A failed validation shows the message in `role="alert"` above the footer and focuses the first `[aria-invalid="true"]` field inside the step (else the alert). Progress bar is `role="progressbar"` (`aria-valuetext="Step 2 of 4"`). Below 480px only "Step 2 of 4" and the bar show; from 480px the numbered step list with titles shows too.

Test ids: `<testid>` (root), `<testid>-count` ("Step 2 of 4"), `<testid>-progress`, `<testid>-heading`, `<testid>-error`, `<testid>-back`, `<testid>-next`, `<testid>-step-<id>` (the step panel). Default testid `wizard`.
Classes: `ui-wizard`, `ui-wizard__head`, `ui-wizard__bar`, `ui-wizard__steps`, `ui-wizard__panel`, `ui-wizard__error`, `ui-wizard__footer`.
Render the Wizard as the LAST block of its page (put the `SimBanner`, notes and `RealBuildNote` above it): a page that contains a Wizard fills the screen so the Back/Next bar rests at the bottom (the thumb zone) when the step is short and sticks there when it is long. The footer is `position: sticky; bottom: var(--db-stick-bottom, 0px)`; `--db-stick-bottom` is set by dashboard.css (0 on immersive routes and from 1100px, the tab bar height on tab pages).

### CopyField (js/ui/copy.js)

Read-only value with a copy button and "Copied" feedback; `secret` masks it until "Show".

```js
<${CopyField} label="Webhook URL" value=${settings.connections.webhook.url} testid="webhook-url" hint="Paste this into the form tool." />
<${CopyField} label="Signing secret" value=${secret} secret testid="webhook-secret" onCopy=${(ok) => {}} />
```
Props: `label*`, `value*`, `secret`, `mono = true`, `hint`, `id`, `onCopy(ok)`, `testid`, `multiline` (textarea, for long values). Copy always copies the real value even while masked. If the clipboard is blocked the text is selected and the button says "Select and copy". The announcement ("Copied") is a polite live region.
Test ids: `<testid>` (root), `<testid>-value` (the input, read its `.value`), `<testid>-copy`, `<testid>-reveal`.

### CodeBlock (js/ui/copy.js)

```js
<${CodeBlock} label="Embed code" language="html" code=${snippet} testid="embed-code" wrap=${false} />
```
Props: `code*`, `label*` (names the scroll region), `language` (small tag), `copy = true`, `wrap`, `testid`. The scroll region is keyboard focusable and contained (never widens the page). Test ids `<testid>`, `<testid>-copy`.

### StatusDot and ConnectionBadge (js/ui/status.js)

```js
<${StatusDot} status="connected" label="Connected" />                 // dot only, label is screen-reader text; showLabel to print it
<${ConnectionBadge} status=${conn.status} label="Live" testid="domain-badge" />
connectionState('verifying')   // -> 'pending'  (normaliser, also exported)
```
`status` accepts the four canonical states `connected | pending | error | off` and every store spelling: `live`, `ok`, `approved`, `connected` -> connected; `verifying`, `pending`, `in_review` -> pending; `error`, `failed`, `rejected` -> error; `none`, `disconnected`, `off`, `undefined` -> off. Default labels: Connected, Pending, Needs attention, Not set up; pass `label` to say "Live", "Verifying", "Awaiting approval". `ConnectionBadge` shows dot + icon + word (never colour only); `compact` drops the icon. Pending dots pulse (static under reduced motion).
Classes `ui-dot`, `ui-dot--connected|pending|error|off`, `ui-conn`, `ui-conn--<state>`.

### Tabs and TabPanel (js/ui/tabs.js)

In-page tabs (not the dashboard tab bar). WAI-ARIA tabs with automatic activation, arrow/Home/End keys, a sliding indicator, scrolls inside itself when too wide.

```js
const [tab, setTab] = useState('all');
<${Tabs} idPrefix="quotes" ariaLabel="Quote status" value=${tab} onChange=${setTab}
  tabs=${[{ id: 'all', label: 'All', count: 12, testid: 'quotes-tab-all' }, { id: 'sent', label: 'Sent', icon: 'send' }]} variant="underline" />
<${TabPanel} idPrefix="quotes" id="all" value=${tab}>...<//>
```
`variant`: `underline` (default) or `pill`. Test id per tab = `tab.testid`. When the tabs only filter ONE shared list (no `TabPanel`s), pass `panels=${false}` so no dangling `aria-controls` is written. Panels you do render must exist for every tab you list (axe flags a missing target).

### Timeline (js/ui/status.js)

```js
<${Timeline} ariaLabel="Quote history" items=${[
  { id: 'created', title: 'Quote created', time: 'Mon 12:04', tone: 'done' },
  { id: 'sent', title: 'Sent by WhatsApp (simulated)', detail: 'To Sean Doherty', time: 'Mon 12:10', tone: 'done' },
  { id: 'viewed', title: 'Waiting for the customer to open it', tone: 'current' },
  { id: 'accepted', title: 'Accepted', tone: 'upcoming' }]} />
```
Item: `{ id, title*, detail, time, tone = 'done', icon, children, testid }`; tones `done | current | upcoming | error | warn | info`. Props `compact`, `ariaLabel`. Renders an `<ol>`; the current item has a pulsing ring.

### Meter and ProgressRing (js/ui/status.js)

```js
<${Meter} label="Replied within 24 hours" value=${86} max=${100} valueText="86%" tone="ok" showValue />
<${ProgressRing} label="Quotes accepted" value=${4} max=${9} size=${72} tone="accent">44%<//>
```
Both are `role="meter"` with `aria-valuenow/min/max/valuetext` and a required `label`. `tone`: `accent` (brand red, default), `ok`, `warn`, `danger`, `neutral`. `Meter` sizes `sm | md | lg`; `showValue` prints the value text at the end of the label row. `ProgressRing` children render in the centre. The fill animates on mount (static under reduced motion).

### QrCode (js/ui/qr.js, vendor js/vendor/qrcode.js)

```js
<${QrCode} value=${url} size=${200} label=${`QR code for ${url}`} level="M" />
const svg = await qrSvgMarkup(url, { level: 'M', margin: 4 });   // string, for saveFile('qr.svg', svg, 'image/svg+xml')
const qr = await makeQr(url, { level: 'M' });                    // { size, isDark(row, col) }
```
SVG, always black modules on a white square (scanners need it, in either theme), crisp at any size. The generator (MIT `qrcode-generator` 1.4.4) is loaded lazily on first use, so pages that never show a QR do not download it. Too-long data renders a short "Too long for a QR code" notice instead of throwing. `level` is `L | M | Q | H`. Test id `qr-code` unless overridden. Classes `ui-qr`.

### MoneyInput (js/ui/form.js)

Whole-pound money field with a pound sign, numeric keyboard and thousands separators on blur.

```js
<${Field} label="Unit price" id="p1"><${MoneyInput} id="p1" value=${line.unitPrice} onChange=${(n) => setPrice(n)} max=${99999} /><//>
```
Props: `id*`, `value` (number or null), `onChange(number | null)`, `min = 0`, `max = 99999`, `decimals = 0` (use 2 for pence), `allowEmpty` (clearing gives `null`, else `min`), `placeholder`, `suffix` (for example `per metre`), `error`, `disabled`, plus any native attribute. Fires while typing once the digits form a valid in-range number, clamps and reformats on blur. Works inside `Field` (aria wired automatically). Classes `ui-money`, `ui-money__input`.

### ConsentSheet (js/ui/consent.js)

A fake OAuth consent screen in a `Sheet`, clearly labelled "Simulated". No real provider artwork: a neutral tile with a Lucide icon and the provider name.

```js
<${ConsentSheet} open=${open}
  provider=${{ name: 'Google', service: 'Calendar', icon: 'calendar-days' }}
  account="daniel@180electrical.co.uk"
  scopes=${[{ id: 'read', label: 'See your busy times', detail: 'So customers are never offered a day you are out.' },
            { id: 'write', label: 'Add 180 Electrical jobs to your calendar' }]}
  busy=${false} onAllow=${() => {}} onCancel=${() => setOpen(false)} allowLabel="Allow" />
```
Shows two linked marks (the 180 mark and the provider tile), "180 Electrical wants to access your Google Calendar", the account chip, the scope list, a "Simulated" ribbon and the line "Nothing is shared with Google. This screen only imitates the real one.". Buttons: Cancel and Allow (`consent-cancel`, `consent-allow`); Allow is the initial focus. Test id `consent-sheet`.

### SimBanner and RealBuildNote (js/ui/sim.js)

```js
<${SimBanner} />                       // "Simulated in this prototype. Nothing is really connected. Saved on this device only."
<${SimBanner} compact />               // one line: "Simulated in this prototype"
<${SimBanner}>Codes shown here are demo codes.<//>   // children become a second sentence
<${RealBuildNote} items=${['A WhatsApp Business account verified with Meta', 'Message templates approved by Meta']} />
<${RealBuildNote} title="What a real build needs">free text<//>
```
`SimBanner` is `role="note"`, dashed edge, "SIMULATED" tag; test id `sim-banner`. `RealBuildNote` is a disclosure (closed by default) titled "What a real build needs"; test id `real-build-note`.

### Disclosure (js/ui/sim.js)

`<${Disclosure} title="Advanced" summary="Optional" defaultOpen testid="adv">...<//>`: native `<details>`, 56px summary, animated chevron.

### ListRow and DataTable (js/ui/rows.js)

`ListRow` is one 56px+ row for a `db-list` (it carries `db-list__item`). Whole row is the tap target when `href` or `onClick` is given.

```js
<div class="db-list" data-testid="quotes-list">
  <${ListRow} href=${routeHref('quote-detail', { id: q.id })} testid=${`quote-row-${q.id}`}
    leading=${html`<${Avatar} name=${q.customerName} />`}
    title=${q.customerName} subtitle=${`${q.id} · Zappi 7kW`} meta=${html`<${StatusPill} .../>`}
    value="£1,250" valueHint="Valid to Fri 20 Nov" />
</div>
```
Props: `title*`, `subtitle`, `meta` (node under the subtitle), `leading` (node), `trailing` (node after the value), `value`, `valueHint`, `href`, `onClick`, `chevron` (default true when interactive), `selected`, `tone` (`default | danger | warn`), `as` (`div` default, or `li` when the parent is a `<ul class="db-list">`), `testid`.

`DataTable` is a table on wide screens and a stack of cards on phones (div based with explicit ARIA table roles, so it stays a table for screen readers):

```js
<${DataTable} caption="Quotes" testid="quotes-table" rows=${rows} rowKey=${(r) => r.id}
  rowHref=${(r) => routeHref('quote-detail', { id: r.id })}
  columns=${[
    { key: 'customer', header: 'Customer', primary: true, render: (r) => r.customerName },
    { key: 'status', header: 'Status', render: (r) => html`<${StatusPill} .../>` },
    { key: 'total', header: 'Total', align: 'end', width: '110px', render: (r) => gbp(r.total) },
    { key: 'valid', header: 'Valid until', hideBelow: 'md', render: (r) => r.validLabel }
  ]}
  empty=${html`<${EmptyState} title="No quotes yet" />`} />
```
Column: `{ key*, header*, render(row), primary, align: 'start'|'end', width (CSS track, default 1fr), hideBelow: 'md' (hidden on phones), label: false (no label on the phone card) }`. On phones each row is a card: the `primary` cell as the title, the rest as "Header: value" pairs. Props `rowHref(row)`, `onRowClick(row)`, `rowTestid(row)` (default `row-<key>`), `empty`, `caption*`, `testid`.

### KeyValueList (js/ui/rows.js)

`<${KeyValueList} items=${[{ label: 'CNAME target', value: 'sites.example', mono: true }, { label: 'Status', value: html`<${ConnectionBadge} .../>` }]} />` renders a `<dl class="ui-kv">` with stacked label/value on phones and side by side from 480px.

### Other changes to existing components

- `toast({ message, detail, icon, actionLabel, onAction, duration = 6000, tone = 'default', testid })`: `detail` (second muted line) and `icon` (Lucide name) are new and optional. A thin timer bar shows the time left; it pauses with the Undo/View button on hover or focus (the remaining time is kept, not restarted). Toasts never intercept taps except on their action. With a sheet open they park at the top of the screen so they never cover a sheet's buttons; with a sticky action bar (immersive page) they sit above it; on tab pages they sit above the tab bar (and above the FAB where there is one).
- `Skeleton({ lines, height, variant })`: `variant="card"` draws an avatar + two lines; shimmer is a GPU sweep, static under reduced motion. `ViewSkeleton` is private to the shell.
- `Switch`, `Segmented`, `Button`, `Chip`, `Card`, `Banner`: unchanged API; refreshed look.
- `failureMessage(result, fallback?)` (util.js): plain-language text for a failed store call `{ ok: false, reason, errors? }` (the first field error, else a sentence for `reason` such as `storage_full`, `bad_code`, `slot_taken`, else the fallback); `''` when the call did not fail. `Wizard` uses it for `{ ok: false }` results, so `onFinish: () => connectWhatsApp(...)` can return the store result as it is.
- `saveFile(filename, content, mime)` (util.js): offers a file to save (Blob + `<a download>`); returns `true` when the click was issued. `copyText` unchanged. `pageTarget('quote.html')` returns `'vm-quote'` (the name `js/quote/app.js` should set on `window.name`).

### New icons (js/ui/icons.js)

Added to the existing set (same Lucide source and format, `Icon name="..."`): `eye eye-off globe mail link link-2 qr-code key-round megaphone webhook circle circle-dot circle-dashed loader-circle unplug file-plus pencil trash-2 printer camera image trending-up trending-down columns-3 hourglass timer bell-off power tag percent user-check filter layout-list message-square at-sign shield server badge-pound-sterling receipt-text files share save minus arrow-up arrow-down arrow-up-right chevrons-up-down sparkles scan-line cloud-off wallet calendar-clock calendar-plus phone-call mail-check`. Suggested use: domain `globe`, Gmail `mail`, WhatsApp `message-circle`, Calendar `calendar-days`, webhook `webhook`, tracking `megaphone`, QR `qr-code`, link `link`, secret reveal `eye` / `eye-off`, simulated `unplug`.

## 3. Tokens (css/tokens.css)

All existing token names are unchanged. New ones (both themes unless noted):

| Token | Meaning |
|---|---|
| `--dur-page: 260ms`, `--dur-slow: 420ms` | page transition, ring/meter fill |
| `--ease-in-out`, `--ease-emphasis` | `cubic-bezier(.65,0,.35,1)`, `cubic-bezier(.16,1,.3,1)` |
| `--shadow-3` | popovers and toasts (stronger than `--shadow-2`) |
| `--elev-hi` | 1px top highlight line used on dark cards |
| `--focus-width: 3px`, `--focus-offset: 2px` | the focus ring |
| `--selection-bg`, `--selection-fg` | `::selection` (brand red tint) |
| `--conn-connected`, `--conn-pending`, `--conn-error`, `--conn-off` | StatusDot colours (map to `--ok`, `--dot-few`, `--danger`, `--dot-full`) |
| `--r-xs: 6px` | small radius |

Elevation: dark cards now carry a hairline top highlight plus a soft drop (`--shadow-1`); sheets and toasts use `--shadow-2` and `--shadow-3`. Layers (`--z-*`) are unchanged.

## 4. Head boilerplate for quote.html (copy exactly; Q2 owns the file)

```html
<!doctype html>
<!-- quote.html: customer quote page entry (head boilerplate, #app, boot module). Owner: Q2 -->
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
  <title>Your quote · 180 Electrical</title>
  <meta name="description" content="Your home EV charger installation quote from 180 Electrical, Northern Ireland. Prototype with sample data.">
  <meta name="robots" content="noindex, nofollow">
  <meta name="color-scheme" content="dark light">
  <meta name="theme-color" content="#0B0B0C">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="icon" href="img/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="img/apple-touch-icon.png">
  <link rel="preload" href="fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="fonts/manrope-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="modulepreload" href="js/vendor/preact-htm.js">
  <link rel="modulepreload" href="js/ui/index.js">
  <link rel="modulepreload" href="js/core/store.js">
  <link rel="modulepreload" href="js/quote/app.js">
  <link rel="stylesheet" href="css/fonts.css">
  <link rel="stylesheet" href="css/tokens.css">
  <link rel="stylesheet" href="css/base.css">
  <link rel="stylesheet" href="css/components.css">
  <link rel="stylesheet" href="css/quote.css">
  <script>
    (function () {
      var t = 'dark';
      try { var s = localStorage.getItem('vm_theme'); if (s === 'light' || s === 'dark' || s === 'auto') t = s; } catch (e) {}
      var c = '#0B0B0C';
      if (t === 'auto') {
        var dark = true;
        try { dark = window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) {}
        c = dark ? '#0B0B0C' : '#F6F5F3';
      } else {
        document.documentElement.setAttribute('data-theme', t);
        if (t === 'light') c = '#F6F5F3';
      }
      var m = document.querySelectorAll('meta[name="theme-color"]');
      for (var i = 0; i < m.length; i++) m[i].setAttribute('content', c);
    })();
  </script>
</head>
<body>
  <div id="app"></div>
  <noscript>This quote needs JavaScript to show. Please enable it, or call 180 Electrical on 07885 496800.</noscript>
  <script type="module" src="js/quote/app.js"></script>
</body>
</html>
```
`js/quote/app.js` should set `window.name = 'vm-quote'` then `bootApp(...)` (the same boot as the other pages: store, theme, toasts). The light-theme `theme-color` is `#F6F5F3`, dark `#0B0B0C`.

## 5. Page layout helpers (unchanged names, refined look)

`db-page`, `db-section`, `db-section__title`, `db-stack`, `db-row`, `db-grid`, `db-list`, `db-list__item`, `db-sticky-actions`, `db-master-detail`, `db-two-col` are unchanged. New: `db-stick-bottom` is the CSS variable `--db-stick-bottom` (see Wizard) that any sticky footer should use as its `bottom`; `db-view` is the shell's transition wrapper (never style it). `db-list > * + *` draws the dividers, so rows may be `li` or `div` or `a`.
