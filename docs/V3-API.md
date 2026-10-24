<!-- docs/V3-API.md: exact core API for wave v3 (quotes, pipeline, SLA, lead sources, connections, utm, photos, images) -->
<!-- Owner: A3 core. Everything here is implemented in js/core/*; names are law for every other role. -->

# V3 core API (A3)

Read with `docs/V3-SPEC.md` section 2 and `docs/BUILD-CONTRACT.md` sections 7 and 8. Everything below is ADDED to the v2 core; no existing export, key or shape was renamed. Conventions are the store's: a mutation returns `{ ok: true, ...data }` or `{ ok: false, reason, errors?, alternatives? }`, never throws for an expected failure, state snapshots are deep-frozen, `subscribe` fires after every change (local or from another tab), and a mutation that can be reversed returns `undoToken` (pass it to `undo(token)`).

## 0. Read this first (decisions that differ from a literal reading of the spec)

1. **Status words.** The spec says "pending" and "completed". The core keeps its existing statuses and adds none: spec "pending" = `'new'`, spec "completed" = `'done'`. The pencilled install booking made by `acceptQuote` has `status: 'new'` and `tentative: true`.
2. **Schema.** `SCHEMA_VERSION` is `3`. The storage key stays `vm_state_v1`. A saved v1 or v2 state migrates (see section 13). Old demo (seed) records are dropped and re-seeded around anything the owner or a customer made.
3. **Time.** The `Stamp` format is unchanged (`YYYY-MM-DDTHH:mm`). Only simulated connection delays use a seconds stamp `YYYY-MM-DDTHH:mm:ss` (`nowStampSec()` from `clock.js`), never epoch ms.
4. **Dates in selectors.** Every new selector takes an optional trailing `nowStampStr` (default `nowStamp()` from the clock), so views can pass the clock they already hold and tests stay deterministic.
5. **New modules** (all in `js/core/`, pure ES modules, no DOM): `utm.js`, `quotes.js`, `pipeline.js`, `connections.js`, `photos.js`. `selectors.js` re-exports the selectors from `pipeline.js` and `quotes.js`, so a view can import everything from `selectors.js`, `store.js` and `config.js`.
6. **Seed size.** The v3 seed has 42 bookings, not "about 26": the spec's 26 counted the 24 enquiries in the pipeline, but an accepted quote makes a second booking (the install), and the original 15 demo bookings (ids `bk_seed_01` to `bk_seed_15`, their windows and refs) are kept so existing screens and tests keep their anchors. See section 13 for the stage-by-stage id table.
7. **Booking order.** `state.bookings` is in the order the store pushed them: seed bookings in id order (`bk_seed_01` to `bk_seed_42`), then everything created later. Sort in the view if you need another order.
8. **Preferences that are stored but not enforced.** `whatsapp.ownerAlerts`, `whatsapp.customerUpdates`, `whatsapp.quietHours`, `email.confirmations`, `email.quotes`, `calendar.addJobs` are saved so the wizards can show them; the store does NOT suppress or delay simulated messages because of them (a real build would). Say so in the UI ("saved on this device only").

## 1. Constants (`js/core/config.js`)

```js
SCHEMA_VERSION = 3
STORAGE_KEYS = { state: 'vm_state_v1', theme: 'vm_theme', draft: 'vm_draft_v1', bootFail: 'vm_boot_fail', utm: 'vm_utm' }   // utm is sessionStorage

// Pipeline (section 6). Order is display order. 'lost' is last and is NOT part of selectPipeline().stages.
PIPELINE_STAGES = [
  { id: 'enquiry',  label: 'Enquiry',  hint: 'Waiting for your reply' },
  { id: 'survey',   label: 'Survey',   hint: 'Free survey booked' },
  { id: 'quote',    label: 'Quote',    hint: 'Survey done, quote to write or out with the customer' },
  { id: 'accepted', label: 'Accepted', hint: 'Quote accepted, install day to confirm' },
  { id: 'install',  label: 'Install',  hint: 'Install day booked' },
  { id: 'done',     label: 'Done',     hint: 'Installed' },
  { id: 'lost',     label: 'Lost',     hint: 'Declined, cancelled or expired' }
]
SLA_DUE_SOON_MINUTES = 240      // "due soon" = reply due inside 4 hours

// Lead sources (section 7)
LEAD_SOURCES = ['facebook', 'instagram', 'google', 'referral', 'phone', 'other']
LEAD_SOURCE_LABELS = { facebook: 'Facebook', instagram: 'Instagram', google: 'Google', referral: 'Word of mouth', phone: 'Phone', other: 'Direct or other' }
AD_CHANNELS = ['facebook', 'instagram', 'google', 'other']
AD_CHANNEL_LABELS = { facebook: 'Facebook', instagram: 'Instagram', google: 'Google', other: 'Other' }

// Quotes (section 5)
QUOTE_STATUSES = ['draft', 'sent', 'viewed', 'accepted', 'declined', 'expired']
QUOTE_STATUS_LABELS = { draft: 'Draft', sent: 'Sent', viewed: 'Viewed', accepted: 'Accepted', declined: 'Declined', expired: 'Expired' }
QUOTE_VIA = ['whatsapp', 'email', 'link']
QUOTE_VIA_LABELS = { whatsapp: 'WhatsApp', email: 'Email', link: 'A link I send myself' }

// Connections (section 8)
CONNECTION_KEYS = ['domain', 'webhook', 'tracking', 'whatsapp', 'calendar', 'email']       // hub order
CONNECTION_LABELS = { domain: 'Your website address', webhook: 'Website funnel webhook', tracking: 'Ad tracking', whatsapp: 'WhatsApp Business', calendar: 'Google Calendar', email: 'Gmail' }
DOMAIN_TARGETS = { cname: 'sites.example', a: '192.0.2.10' }   // fictional (documentation ranges and the .example TLD)
WHATSAPP_DEMO_CODE = '482913'                                  // shown on screen as "Prototype code: 482913"
DOMAIN_VERIFY_SECONDS = 20                                     // a domain left "verifying" goes live by itself after this long (clock time)
TEMPLATE_APPROVAL_SECONDS = 6                                  // submitted WhatsApp templates become approved after this long (clock time) or ~3 s real time
WHATSAPP_TEMPLATE_KINDS = TEMPLATE_KINDS without 'owner_test_event'

// Message kinds: TEMPLATE_KINDS is now 25 long (the 19 v2 kinds, then these 6, in this order)
//   'customer_quote_sent', 'customer_quote_accepted', 'owner_quote_accepted', 'owner_quote_declined', 'customer_photos_request', 'owner_test_event'
KIND_LABELS additions: customer_quote_sent 'Quote sent', customer_quote_accepted 'Quote accepted (to customer)', owner_quote_accepted 'Quote accepted',
                       owner_quote_declined 'Quote declined', customer_photos_request 'Photos request', owner_test_event 'Test message'
DEFAULT_TEMPLATES additions: one default text per new kind (see section 10)

// Images (section 11)
IMAGE_KEYS = ['logo', 'hero', 'about', 'work1', 'work2', 'work3', 'work4']
DEFAULT_IMAGES = { logo: '<url>', hero: '<url>', about: '<url>', work1..work4: '<url>' }          // the exact URLs of docs/reference/180-images.md
IMAGE_META = { logo: { label, alt, width: 1119, height: 743 }, hero: { ..., width: 1080, height: 720 }, about: { 3600x2697 }, work1: { 1170x1532 }, work2: { 739x1600 }, work3: { 1200x1600 }, work4: { 3600x2684 } }
imageUrl(key, { width?, images? } = {}) -> string
```

`makeDefaultBusiness()` gains `address: ''` and `images: { ...DEFAULT_IMAGES }`. `makeDefaultSettings()` gains the blocks in section 2. Also exported: `makeDefaultQuoteItems(brands)`, `makeDefaultConnections()`.

## 2. Settings additions (`state.settings`)

```js
settings.business.address  = ''                       // his site gives none. Render only when non-empty; footer keeps "Serving Northern Ireland"
settings.business.images   = { logo, hero, about, work1, work2, work3, work4 }   // URLs; '' is never stored (reset = default)
settings.sla               = { replyHours: 24 }
settings.marketing         = { adSpend: [{ id, month: 'YYYY-MM', channel: 'facebook'|'instagram'|'google'|'other', amount: <whole pounds>, seed?: true }] }   // [] in makeDefaultSettings; the seed adds 3 months
settings.quoteDefaults     = { validDays: 30, notes: '<short sample terms text>' }
settings.quoteItems        = [ QuoteItem ]            // the editable catalogue, all SAMPLE prices (label them "sample" in the UI)
settings.connections       = { domain, whatsapp, calendar, email, webhook, tracking }   // all SIMULATED, saved on this device only
```

```js
QuoteItem = {
  id: 'charger_zappi' | 'install_standard' | 'cable_extra' | 'circuit' | 'consumer_unit' | 'enclosure' | 'groundwork' | 'testing' | <custom id>,
  kind: 'charger' | 'install' | 'extra',
  brand: 'ZAPPI' | ... | '',              // set only for kind 'charger'
  label: 'Supply of ZAPPI home charger',
  detail: '',                              // optional second line shown under the label
  unit: 'each' | 'metre',
  unitPrice: <whole pounds>,
  defaultQty: <positive integer>,          // what the quote builder starts with
  suggested: <boolean>,                    // true = included in a new quote's starting lines
  optional: <boolean>                      // true = a POSSIBLE EXTRA: its quote line is listed apart and never counted in the total (consumer_unit is the default one); docs/V4-API.md section 9
}
```
Default catalogue (sample prices): one charger line per brand in `business.brands` (ZAPPI 799, OHME 679, SYNC 649), `install_standard` "Standard installation (up to 10 m of cable)" 450, `cable_extra` "Extra cable (per metre)" 12 (unit metre, suggested false), `circuit` "Dedicated circuit and protective device" 180, `consumer_unit` "Consumer unit upgrade (if required)" 420 (suggested false), `enclosure` "Surface-mounted enclosure" 95 (suggested false), `groundwork` "Groundwork (per metre)" 65 (unit metre, suggested false), `testing` "Testing and certification" 85. `suggested: true` = first charger line, `install_standard`, `circuit`, `testing`.

When `updateSettings({ business: { brands } })` changes the brands, the store keeps the catalogue in step: a charger line is added (unit price 700, sample) for a new brand and the charger line of a removed brand is removed (other lines untouched).

```js
settings.connections.domain    = { status: 'none'|'pending'|'verifying'|'live', domain: '', checks: 0, verifiedAt: null, firstCheckAt: null }
settings.connections.whatsapp  = { status: 'disconnected'|'verifying'|'connected', number: '+447885496800', displayName: '180 Electrical',
                                   templates: { <WHATSAPP_TEMPLATE_KINDS kind>: 'none'|'pending'|'approved' }, templatesSubmittedAt: null,
                                   ownerAlerts: true, customerUpdates: true, quietHours: { on: true, from: '21:00', to: '08:00' }, connectedAt: null }
settings.connections.calendar  = { status: 'disconnected'|'connected', account: '', calendarName: '180 Electrical jobs', twoWay: true, addJobs: true, connectedAt: null }
settings.connections.email     = { status: 'disconnected'|'connected', account: '', sendFrom: 'daniel@180electrical.co.uk', confirmations: true, quotes: true, connectedAt: null }
settings.connections.webhook   = { url: 'https://hooks.example/180/enq_8f3a21c9', secret: 'whsec_...', lastEventAt: null, enabled: true }
settings.connections.tracking  = { metaPixelId: '', googleTagId: '', consentNote: true }
```
Default for the demo: webhook enabled, everything else disconnected. `connectedAt`, `verifiedAt`, `lastEventAt` are minute `Stamp`s. `firstCheckAt` and `templatesSubmittedAt` are seconds stamps.

## 3. Other state additions

```js
state.v = 3
state.quotes = { [quoteId]: Quote }                         // an object keyed by id (never an array)
booking.utm = { source, medium, campaign }                  // optional; source is one of LEAD_SOURCES; medium and campaign are '' or short text
booking.quoteId = '<quote id>'                              // optional; set on an install booking made by acceptQuote (and on seeded installs)
booking.photos = [{ id, name, dataUrl }]                    // optional; max 3; dataUrl is 'data:image/jpeg;base64,...' <= 70000 characters
message.channel = 'whatsapp' | 'email'                      // default 'whatsapp'
message.toEmail = '<address>'                               // ONLY on channel 'email' messages (a WhatsApp message keeps the exact v2 shape)
block.source = 'google_calendar'                            // optional; set on the simulated busy blocks (label 'Google Calendar', groupId 'grp_gcal_sim')
```
A booking that the website funnel made but a webhook test event made (`sendTestEvent('webhook')`) has `utm = { source: 'other', medium: 'webhook', campaign: 'test_event' }` and the note "Sample enquiry from the webhook test (simulated)."

New booking history notes: quote messages reuse the existing `message` event with the `KIND_LABELS` label as the note (for example `Quote sent`), by `owner` or `customer`.

## 4. Store functions (`js/core/store.js`), all new

Failure reasons added to the existing list: `'storage_full'`, `'expired'`, `'already_accepted'`, `'no_email'`, `'bad_code'`, `'not_connected'`, `'disabled'`, `'too_many'`. `invalid` carries `errors: { field: message }`. Any mutation returns `{ ok: false, reason: 'storage_full' }` (state unchanged) when localStorage refuses the write because of its quota; fully blocked storage still degrades to memory mode as before.

### Quotes
| Function | Notes |
|---|---|
| `createQuote({ bookingId, brand?, lines?, notes?, validUntil?, customerName? })` | `{ ok, quote, undoToken }`. Booking must exist (`not_found`), be a home charger enquiry (`ev_quote`, else `invalid` with `errors.bookingId`) and not be cancelled (`bad_transition`). `brand` defaults to the first of `business.brands` (or '' when none). `lines` omitted = `defaultQuoteLines(settings, { brand })`; pass `lines: []` for an empty draft. `notes` omitted = `settings.quoteDefaults.notes`. `validUntil` omitted = today + `quoteDefaults.validDays`. Id = `Q-` + the booking ref (`Q-EL-1043`); a second quote for the same booking gets `Q-EL-1043-2`, then `-3`. Starts as `draft`. |
| `updateQuote(id, patch)` | `{ ok, quote }`. Stored status must be `draft` or `sent` (else `bad_transition`; a `viewed` quote is frozen, write a new one). Patch keys: `brand`, `lines`, `notes`, `validUntil` (a day key), `customerName`. Validation (`invalid` + `errors`): `lines` each `{ id?, label (1 to 120 chars), detail? (<= 200), qty (integer 1 to 999), unitPrice (integer -99999 to 99999, negative = discount) }`, `errors.lines`; total must not be negative; `validUntil` a real day key; `notes` <= 1500. Missing line ids are generated. |
| `deleteQuote(id)` | `{ ok, undoToken }`. Draft only (`bad_transition`). |
| `sendQuote(id, { via })` | `{ ok, quote, message, link, undoToken }`. `via` in `QUOTE_VIA` (else `invalid`). Stored status `draft` or `sent` or `viewed` (a resend); else `bad_transition`. The enquiry must not be cancelled (`bad_transition`). Needs at least one line and a total above 0 (`invalid`, `errors.lines`). `via: 'email'` needs `booking.customer.email` (else `no_email`). A stale `validUntil` (before today) is reset to today + `validDays`. Sets `sentAt`, `sentVia`, status `sent` (a `viewed` quote stays `viewed`). Logs one `customer_quote_sent` message (channel `email` for email, else `whatsapp`) on the enquiry booking whose body contains `link` = `SITE_BASE_URL + 'quote.html#q=' + id`. History `message` by owner "Quote sent". |
| `recordQuoteViewed(id)` | `{ ok, quote, changed }`. Idempotent: `sent` becomes `viewed` with `viewedAt`; every other status is left alone (`changed: false`). Logs nothing. `not_found` for an unknown id. |
| `acceptQuote(id, { date, windowId })` | `{ ok, quote, booking, messages, undoToken }` where `booking` is the pencilled install. Race-safe: everything is re-checked inside the read-modify-write. Failures: `not_found`; `already_accepted` (+ `installBookingId`); `bad_transition` (draft or declined); `expired` (derived from `validUntil`: the last good day is `validUntil` itself); `invalid` (`errors.date` / `errors.windowId`, a half-day install takes window 0 or 2); `slot_taken` (+ `alternatives`: three free half-day slots for service `ev`); `service_unavailable` (service `ev` inactive). The slot is checked in CUSTOMER mode (opening hours, lead time, horizon, full days) because the customer chooses it. Creates an `ev` booking: `status 'new'`, `tentative: true`, `quotedPrice` = total, `quoteId`, `seenByOwner: false`, customer, address and `answers` copied from the enquiry, `source` copied, 2 windows; sets quote `status: 'accepted'`, `acceptedAt`, `installBookingId`; history `message` by customer "Quote accepted" on the enquiry. Logs two messages on the INSTALL booking, inserted `customer_quote_accepted` then `owner_quote_accepted` (so the owner alert has the higher `seq` and sorts first, as in `createBooking`); `messages` is returned in that insertion order `[customer, owner]`. |
| `declineQuote(id, { reason?, by? })` | `{ ok, quote, message, undoToken }`. `by` is `'customer'` (default) or `'owner'`. Stored status `sent` or `viewed` only (`bad_transition`). Sets `declinedAt`, `declineReason` (trimmed, <= 200). Logs `owner_quote_declined` on the enquiry and adds history `message` by `by` "Quote declined". |

### Pipeline and customer helpers
`sendQuickMessage(bookingId, kind)` now also accepts `'customer_photos_request'` (the photos request: "could you send a photo of your consumer unit and where you'd like the charger?"). `addBookingPhotos(id, photos)` and `removeBookingPhoto(id, photoId)` are in section 9.

### Marketing
| Function | Notes |
|---|---|
| `setAdSpend(month, channel, amount)` | `{ ok, entry, undoToken }`. `month` 'YYYY-MM' (a real month), `channel` in `AD_CHANNELS`, `amount` a whole number of pounds 0 to 999999 (`invalid` + `errors.month` / `errors.channel` / `errors.amount`). One entry per month and channel: an existing one is updated, otherwise added (`id: 'ad_<random>'`). Amount 0 removes the entry. |
| `removeAdSpend(id)` | `{ ok, undoToken }`; `not_found`. |

### Connections (all SIMULATED; nothing leaves the device)
| Function | Notes |
|---|---|
| `setConnection(key, patch)` | `{ ok, connection, undoToken }`. `key` in `CONNECTION_KEYS` (else `invalid`). Only the fields listed below can be patched; unknown or protected fields are ignored. `domain`: nothing (use `startDomainSetup` / `checkDomain` / `disconnect`). `whatsapp`: `displayName` (1 to 40), `ownerAlerts`, `customerUpdates` (booleans), `quietHours` `{ on, from, to }` ('HH:mm'), `number` (a UK mobile or international number, stored as `+<digits>`, `errors.number`), `status` only `'verifying'` (from `disconnected`, needs a valid number) or `'disconnected'` (cancel the verification). `calendar`: `calendarName` (1 to 60), `twoWay`, `addJobs`. Turning `twoWay` on while connected imports the simulated busy blocks; turning it off removes them. `email`: `sendFrom` (a valid email, `errors.sendFrom`), `confirmations`, `quotes`. `webhook`: `enabled`. `tracking`: `metaPixelId` ('' or 8 to 20 digits), `googleTagId` ('' or `G-`, `GT-`, `AW-` or `GTM-` followed by 4 to 12 letters/digits, upper-cased), `consentNote`. |
| `connectWhatsApp({ number, code })` | `{ ok, connection, undoToken }`. Needs a valid `number` (`invalid`, `errors.number`) and `code === WHATSAPP_DEMO_CODE` (else `{ ok: false, reason: 'bad_code' }`, state unchanged). Sets `status: 'connected'`, `number`, `connectedAt`. |
| `submitWhatsAppTemplates()` | `{ ok, connection, undoToken }`. Needs `status: 'connected'` (else `not_connected`). Every template `none` becomes `pending` and `templatesSubmittedAt` is set. A pending template becomes `approved` after `TEMPLATE_APPROVAL_SECONDS` of clock time, or after about 3 s of real time (the store arms a timer, so a subscribed view updates itself), or when `settleConnections()` runs after that. |
| `connectGoogle(service, { account })` | `service` is `'calendar'` or `'email'` (else `invalid`). `account` must look like an email address (`errors.account`). Sets `status: 'connected'`, `account`, `connectedAt`. For `calendar` with `twoWay` on it imports the simulated busy blocks. Returns `{ ok, connection, undoToken }`. |
| `disconnect(key)` | `{ ok, connection, undoToken }`. `domain` resets to none, `whatsapp` to disconnected with every template `none`, `calendar` to disconnected with the simulated busy blocks removed, `email` to disconnected, `webhook` sets `enabled: false` (the URL stays), `tracking` clears both ids. |
| `startDomainSetup(domain)` | `{ ok, connection, records, undoToken }`. Hostname validation: trimmed, lower-cased, a leading `http(s)://` and anything after the host removed, at least two labels, labels 1 to 63 of `a-z 0-9 -` not starting or ending with `-`, last label letters only (2 to 24), 253 total; else `invalid` with `errors.domain` ("Enter a website address like www.180electrical.co.uk"). Sets `status: 'pending'`, `domain`, `checks: 0`, `verifiedAt: null`, `firstCheckAt: null`. `records` = `domainRecords(domain)`. |
| `checkDomain()` | `{ ok, found, status, connection, message, sslIssued }` (`undoToken` is not returned). `status 'none'` gives `{ ok: false, reason: 'bad_transition' }`. First check: `checks 1`, status `verifying`, `found: false`, message "We cannot see your records yet. DNS changes can take a while, so try again in a minute." Second check, or any check once 20 s of clock time have passed since the first: status `live`, `verifiedAt` set, `found: true`, `sslIssued: true`, message "Your website address is connected and the security certificate is ready (simulated)." Already `live`: `{ ok: true, found: true, status: 'live', unchanged: true }`. |
| `rotateWebhookSecret()` | `{ ok, secret, connection, undoToken }`. New `whsec_` plus 24 random lower-case letters and digits. |
| `sendTestEvent(key)` | `key` in `'webhook'`, `'whatsapp'`, `'email'` (else `invalid`). `webhook`: needs `enabled` (else `disabled`); creates a sample enquiry through the same code path as the website funnel (the next person from `SIM_POOL`, so it logs `customer_received` and the owner alert, pencils in a survey, `seenByOwner: false`), with `utm { source: 'other', medium: 'webhook', campaign: 'test_event' }` and the note "Sample enquiry from the webhook test (simulated).", sets `lastEventAt`; returns `{ ok, booking, messages, connection }` (no undo token: it makes a booking). `whatsapp` / `email`: needs `status: 'connected'` (else `not_connected`); logs an `owner_test_event` message (channel `whatsapp` / `email`, `bookingId: null`); returns `{ ok, message }`. All are labelled simulated (`message.simulated: true`). |
| `settleConnections()` | `{ ok, changed }`. Applies any time-based simulation that is due (templates `pending` to `approved`, a `verifying` domain to `live` after 20 s). Cheap and idempotent: a view may call it on mount and from a 5 s interval while a wizard is open. Selectors (`selectConnectionsSummary`) already show the settled status without calling it. |

### Settings
`updateSettings(patch)` additionally accepts (validated, atomic, `errors` keyed as shown):
- `business.address` (text, <= 200), `business.images` (object of `IMAGE_KEYS` to a string; `''` resets that key to the default; `https://` URLs or a relative path only, <= 600 chars; error key `images.<key>`),
- `sla: { replyHours }` (integer 1 to 168, `errors.replyHours`),
- `quoteDefaults: { validDays, notes }` (`validDays` integer 1 to 365, `errors.validDays`; `notes` <= 1500),
- `quoteItems` (the whole catalogue replaced; each item `label` 1 to 80, `detail` <= 120, `unit` in `each|metre`, `unitPrice` integer 0 to 99999, `defaultQty` integer 1 to 999, `kind` in `charger|install|extra`; ids generated when missing; `errors.quoteItems`).
`business.brands` keeps the catalogue in step (section 2). `connections` and `marketing` are NOT patchable through `updateSettings` (use the functions above).

`createBooking(draft)` additionally accepts `draft.utm` (`{ source, medium, campaign }`, normalised; junk is dropped, never an error) and `draft.photos` (section 9).

## 5. Quote shape and quote helpers

```js
Quote = {
  id: 'Q-EL-1043', bookingId, customerName, createdAt: Stamp,
  status: 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired',   // STORED status; 'expired' is normally derived (see quoteStatus)
  brand, lines: [{ id, label, detail, qty, unitPrice }], notes, validUntil: DayKey,
  sentAt: Stamp|null, sentVia: 'whatsapp'|'email'|'link'|null, viewedAt: Stamp|null, acceptedAt: Stamp|null,
  declinedAt: Stamp|null, declineReason: '', installBookingId: string|null, seed: boolean
}
```
`seed` is true for demo quotes; the first change a person makes to a seed quote sets it to false (so a day rollover keeps what they did).

Pure helpers (`js/core/quotes.js`, also re-exported from `selectors.js`):
| Export | Result |
|---|---|
| `quoteLineTotal(line)` | `qty * unitPrice` |
| `quoteTotal(quote)` | sum of the FIXED line totals, whole pounds (the spec's pinned helper; also exported from `selectors.js`). A line flagged `optional: true` is a possible extra and is left out: see `docs/V4-API.md` section 9 |
| `quoteStatus(quote, nowStampStr?)` | the EFFECTIVE status: a stored `sent` or `viewed` quote whose `validUntil` is before today is `'expired'`; everything else is its stored status |
| `quoteExpiresInDays(quote, nowStampStr?)` | whole days from today to `validUntil` (0 = last day, negative = past) |
| `defaultQuoteLines(settings, { brand? })` | the starting lines from the catalogue (`suggested` items; the charger line of `brand`), each `{ id, label, detail, qty, unitPrice }` |
| `buildQuoteDraft(state, bookingId, { brand? })` | the ready-to-edit input for `createQuote` without saving anything: `{ bookingId, customerName, brand, lines, notes, validUntil }` or `null` when the booking is missing. Use this to prefill the builder for `#/quotes/new?booking=<id>` |
| `quoteUrl(quoteId)` | `SITE_BASE_URL + 'quote.html#q=' + id` (also exported from `messages.js`) |

## 6. Pipeline (pure selectors; `js/core/pipeline.js`, re-exported by `selectors.js`)

Every selector here returns a NEW object on each call. In a view, compute it once per state with `useMemo(() => selectPipeline(state), [state])` (the state object changes only when something changed; pass the clock stamp you already hold, for example from `useNow`, as the second argument) instead of selecting inside a `useStore` selector that is compared by reference.

One journey per `ev_quote` booking (the enquiry): enquiry booking, then its quote (the ACCEPTED quote if there is one, else the newest by `createdAt`; `Q-EL-1043-2` beats `Q-EL-1043` in the same minute), then the install booking (`quote.installBookingId`, or a non-cancelled `ev` booking with `quoteId === quote.id`). An `ev` booking with no quote link (the owner entered it directly) is a STANDALONE install: it appears in the pipeline too (`standalone: true`, no enquiry).

Stage rules, first match wins (spec words mapped as in section 0):
1. `lost`: the enquiry is `cancelled` (declined or cancelled), or the latest quote is `declined` or effectively `expired`, and no accepted quote exists.
2. quote `accepted` with an install booking `done` -> `done`; install `confirmed` or `on_the_way` -> `install`; otherwise (no install booking, or it is still `new` = pencilled, or it was cancelled) -> `accepted`.
3. the enquiry is `done` (survey done), or the latest quote is `sent` / `viewed` (effective) -> `quote`. (So a quote can go out from an enquiry that has not had its survey.)
4. enquiry `confirmed` or `on_the_way` -> `survey`.
5. enquiry `new` -> `enquiry`.
A standalone `ev`: `new`, `confirmed` or `on_the_way` -> `install`; `done` -> `done`; `cancelled` -> `lost`.

```js
selectPipeline(state, nowStampStr?) -> {
  stages: [ { id, label, hint, items: PipelineItem[], count, value } ]   // 6 stages, order of PIPELINE_STAGES without 'lost'
  lost: PipelineItem[],                                                    // newest first (by stageSince)
  lostCount, lostValue, totalCount, openValue                              // openValue = value of enquiry..install stages
}
PipelineItem = {
  bookingId,                 // the ENQUIRY booking id (or the standalone install booking id)
  installBookingId,          // string|null
  quoteId,                   // string|null
  ref,                       // the enquiry ref, e.g. 'EL-1043'
  stage,                     // stage id
  customerName, postcode, customerKey,
  value,                     // whole pounds: 0 until a quote exists; then the quote total; done = the install final price
  ageMinutes,                // minutes since `stageSince` (never negative)
  stageSince,                // Stamp: when the item entered its current stage (best effort from history and quote times)
  sla,                       // 'ok' | 'due_soon' | 'overdue' for an enquiry still waiting for your reply, else null
  summary,                   // one plain line, e.g. 'Survey Sat 24 Oct, 10am–12', 'Quote £1489 viewed by the customer', 'Accepted £1364. Install pencilled in Sat 31 Oct, morning, 8–10am'
  leadSource,                // a LEAD_SOURCES id
  quoteStatus,               // effective status or null
  standalone,                // boolean
  paid                       // boolean|null (null before the install is done)
}
```
`stages[i].value` = sum of item values; for `done` it is the money earned. Item order inside a stage is what needs attention first: `enquiry` oldest first (the overdue one on top), `survey` and `install` by the booked day, `quote` and `accepted` longest-waiting first, `done` and `lost` newest first.

```js
selectJourney(state, bookingId, nowStampStr?) -> { stage, enquiry, quote, install, standalone } | null
```
`bookingId` may be the enquiry, the install booking or a quote's booking; each of `enquiry`, `quote`, `install` can be null. Use it on a booking-detail screen to show the quote card and the install link.

```js
selectQuotes(state) -> Quote[]                         // newest first (createdAt, then id)
selectQuote(state, id) -> Quote|null
selectQuotesForBooking(state, bookingId) -> Quote[]    // newest first
selectQuoteForBooking(state, bookingId) -> Quote|null  // the latest
selectQuoteList(state, { status?, nowStamp? }) -> QuoteRow[]   // status: an EFFECTIVE status or 'waiting' (sent+viewed, not expired) or 'all'/undefined
QuoteRow = { quote, status (effective), total, bookingId, ref, customerName, ageMinutes (since sentAt or createdAt), expiresInDays, installBookingId }
selectQuoteDetail(state, id, nowStampStr?) -> null | {
  quote, status (effective), total, lines: [{ ...line, lineTotal }], customerFirst, ref, address (the enquiry address line), validUntil,
  validUntilLabel ('Sat 21 Nov'), expiresInDays, canAccept (status sent or viewed), canDecline (same), isExpired, installBooking (booking|null),
  installWhen ('' or e.g. 'Mon 2 Nov, morning, 8-10am')
}   // the one call the customer quote page needs, plus selectBrand(state)
```
`selectQuoteDetail` is what `quote.html` renders; the install-day picker uses the normal availability engine with service id `'ev'` (half-day slots): `getBookableDays(state, { serviceOrBlocks: 'ev' })` and `getDaySlots(state, date, 'ev')`.

### SLA (response time)
```js
selectSla(state, nowStampStr?) -> {
  replyHours,                                    // settings.sla.replyHours
  overdue:  [{ bookingId, ref, customerName, createdAt, dueAt, minutesOverdue }],   // enquiries still waiting, past dueAt, oldest first
  dueSoon:  [{ bookingId, ref, customerName, createdAt, dueAt, minutesLeft }],      // waiting, due inside SLA_DUE_SOON_MINUTES, soonest first
  overdueCount, dueSoonCount, waitingCount,      // waitingCount = every enquiry waiting for a reply
  avgReplyMinutes,                               // integer, mean over enquiries that were replied to; null when none
  withinTargetPct,                               // integer 0 to 100: replies inside replyHours, counting enquiries now overdue as misses; null when nothing to count
  repliedCount
}
```
An enquiry is "waiting for a reply" when it is a `ev_quote` booking with `status 'new'` and no owner action in its history yet. `dueAt = createdAt + replyHours`. The reply time is the first history entry made by the owner that is not `created`, `note`, `paid` or `unpaid` (a confirm, decline, reschedule, cancel or any message he sent, including the quote and the photos request): reply minutes = that entry's `at` minus `createdAt`. `by: 'system'` and `by: 'customer'` entries never count. `PipelineItem.sla` uses the same test (`ok` = more than 4 h left).

## 7. Lead sources, cost per lead, quote stats

```js
resolveRange(range, nowStampStr?) -> { from: DayKey|null, to: DayKey|null, preset: string|null }
// range: undefined | 'all' | '7d' | '30d' | '90d' | 'month' | 'last_month' | '3m' | { from?, to? } (day keys, inclusive)
RANGE_PRESETS = [{ id: 'all', label: 'All time' }, { id: '7d', label: 'Last 7 days' }, { id: '30d', ... }, { id: '90d', ... }, { id: 'month', label: 'This month' }, { id: 'last_month', label: 'Last month' }, { id: '3m', label: 'Last 3 months' }]

leadSourceOf(booking) -> LEAD_SOURCES id     // booking.utm.source, else by booking.source: 'phone' -> 'phone', 'referral' -> 'referral', anything else 'other'

selectLeadSources(state, range?, nowStampStr?) -> {
  range: { from, to, preset },
  total: { enquiries, quotes, accepted, installs, revenue },
  sources: [{ id, label, enquiries, quotes, accepted, installs, revenue, sharePct, winPct }]   // all 6 sources in LEAD_SOURCES order sorted by enquiries desc then order; filter enquiries > 0 for display
}
```
Counted by the enquiry's `createdAt` day: `enquiries` = `ev_quote` bookings; `quotes` = those whose latest quote was sent (has `sentAt`); `accepted` = latest quote accepted; `installs` = install booking `done`; `revenue` = sum of those install final prices (earned, paid or not); `sharePct` = share of `total.enquiries` (integer, 0 when none); `winPct` = accepted / quotes (integer, null when no quotes). Standalone installs are not enquiries and are not counted here.

```js
selectCostPerLead(state, range?, nowStampStr?) -> {
  range: { from, to, preset },            // the range actually used: widened to WHOLE MONTHS (ad spend is monthly), 'to' stays <= today
  months: ['2026-08', ...],
  spend,                                   // whole pounds in those months (all channels)
  hasSpend,                                // spend > 0
  adEnquiries, adAccepted, adInstalls,     // enquiries (and their accepted quotes and installs) from the channels that had spend in the range
  costPerEnquiry, costPerAccepted, costPerInstall,   // spend / count rounded to whole pounds; NULL (an honest blank) when spend is 0 or the count is 0
  byChannel: [{ channel, label, spend, enquiries, accepted, installs, costPerEnquiry, costPerInstall }]   // AD_CHANNELS order
}
```
Ad spend only buys leads from the channels it was spent on, so every other source (organic Google, word of mouth, phone, direct) is left out of the cost per lead: it is not flattered. Google leads count as ad leads only once Google spend is entered.

```js
selectQuoteStats(state, range?, nowStampStr?) -> {
  range, sent, accepted, declined, expired,        // counted by sentAt day (a quote that was sent), effective status
  decided,                                          // accepted + declined + expired
  winRatePct,                                       // accepted / decided, integer, null when none decided
  avgAcceptedValue,                                 // whole pounds, 0 when none
  waitingCount, waitingValue,                       // sent or viewed and not expired, ALL TIME (not range-limited)
  draftCount, draftValue
}
```

## 8. Connections summary and helpers

```js
selectConnectionsSummary(state, nowStampSecStr?) -> [{ key, title, status, label, detail, raw, href }]
```
In `CONNECTION_KEYS` order. `status` is one of `'connected' | 'pending' | 'off'` (use it for `StatusDot` / `ConnectionBadge`; `'error'` is reserved and not produced yet). `label` is a short human status ("Connected", "Waiting for DNS", "Not set up"), `detail` one plain line (for example "www.180electrical.co.uk, security certificate ready", "Pixel 1234567890, Google tag not set", "daniel@gmail.example, two-way sync on"), `raw` the stored status string, `href` the dashboard route (`#/connections/domain`, ...). It reports the SETTLED state (a due simulation is shown as done even if `settleConnections()` has not run). The `detail` of every simulated connection never says anything is really connected.

`js/core/connections.js` (pure): `validateHostname(input)` -> `{ ok, host, message }`; `domainRecords(domain)` -> `[{ type: 'CNAME', host: 'www', value: 'sites.example', ttl: 3600 }]` for a subdomain such as `www.x.co.uk`, or `[{ type: 'A', host: '@', value: '192.0.2.10', ttl: 3600 }]` for an apex such as `180electrical.co.uk`; `isValidEmail(input)`; `webhookSamplePayload(state)` -> the JSON object a real funnel would POST (`{ event: 'enquiry.created', id, createdAt, source, customer: {...}, answers: {...}, utm: {...} }`, sample values) for the Webhook screen; `settleConnectionsIn(connections, nowSecStr, { force })` (what `settleConnections` applies).

## 9. Photos (`js/core/photos.js` and the store)

```js
PHOTO_LIMITS = { maxPhotos: 3, maxDataUrlChars: 70000 }
validatePhoto(photo) -> '' | message             // { id?, name, dataUrl }: dataUrl must match /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/ and be <= 70000 chars; name 1 to 60 chars
normalisePhotos(list, { existing = 0 }) -> { photos, dropped }    // keeps valid ones in order up to the remaining room, sanitises name, gives ids; dropped = how many were refused
addBookingPhotos(id, photos) -> { ok, booking, added, dropped } | { ok: false, reason }   // store
removeBookingPhoto(id, photoId) -> { ok, booking, undoToken }
```
`addBookingPhotos`: `not_found`; `invalid` (+ `errors.photos`) when the input is not a list or EVERY photo is invalid; `too_many` when the booking already holds 3; otherwise it adds the valid ones that fit and reports `added` and `dropped`. `createBooking` is lenient: invalid or surplus photos are dropped and counted in `result.photosDropped` (an enquiry is never refused because of a photo); if the write fails with `storage_full` and the draft had photos, it retries once without them and returns `ok: true` with `photosDropped`. A fresh JPEG data URL from a canvas (`toDataURL('image/jpeg', q)`) satisfies the format.

## 10. Messages

`buildMessage(kind, booking, state, extra)` additionally understands `extra.quote`, `extra.installBooking`, `extra.channel` (`'whatsapp'|'email'`) and `extra.reason`. Message shape is unchanged plus `channel` and `toEmail`. New placeholders (documented in `PLACEHOLDERS`, always present in `buildContext`, empty string when there is no quote): `quoteId`, `quoteLink`, `quoteTotal` (e.g. `£1514`), `quoteValidUntil` (e.g. `Sat 21 Nov`), `installWhen` (e.g. `Mon 2 Nov, morning, arriving between 8 and 10am`). `contactHours` now follows `settings.sla.replyHours`.

Default texts (plain, no exclamation marks, no emoji):
- `customer_quote_sent`: "Hi {customerFirst}, it's {ownerFirst} from {business}. Your written quote for the home charger installation is ready: {quoteTotal}, valid until {quoteValidUntil}. You can read it and choose an install day here: {quoteLink} Questions? Reply here or call {ownerPhone}. Ref {ref}"
- `customer_quote_accepted`: "Hi {customerFirst}, thanks for accepting your quote ({quoteTotal}). The install day you chose is {installWhen}. I will be in touch to confirm it. Quote {quoteId}" (reworded in the polish round: a customer never reads "pencilled" or "provisional")
- `owner_quote_accepted`: "*Quote accepted {quoteId}*\n{customerName} accepted your quote ({quoteTotal}).\nInstall pencilled in: {installWhen} (provisional)\n{address}\nOpen: {jobLink}" (to owner, on the INSTALL booking, so its `bubbleActions` are Confirm, Call, Open job)
- `owner_quote_declined`: "*Quote declined {quoteId}*\n{customerName} declined your quote ({quoteTotal}).\n{reasonLine}\nOpen: {jobLink}" (on the enquiry booking)
- `customer_photos_request`: "Hi {customerFirst}, it's {ownerFirst} from {business}. To prepare your quote, could you send a photo of your consumer unit and where you'd like the charger? Just reply here with the photos. Ref {ref}"
- `owner_test_event` (no booking; `bookingId: null`): "*Test message from {business}*\nThis is a test from your dashboard. A live build would send it to {ownerPhone}. Simulated: nothing was really sent."

`messages.js` also exports `quoteUrl(quoteId)`. `bubbleActions` gives `owner_quote_accepted` the same buttons as `owner_new_booking` (Confirm while the install is `new`) and `owner_quote_declined` an Open job button.

## 11. Images

```js
imageUrl(key, { width, images } = {})
```
`images` is the configured map (pass `state.settings.business.images`, or `selectBrand(state).images`); omitted = the defaults. Result: for `https://perspective.imgix.net/...` the query is replaced by `?w=<width>&q=70` (no `auto=compress,format`: measured bigger than plain `?w=N`); for `https://images.unsplash.com/...` the `w` parameter is set to `<width>` and every other parameter is kept; any other host, or a relative path, is returned unchanged. `width` is rounded and clamped to 16 to 4000. With no `width`: the `logo` returns the original URL; every other key uses a default width (hero 1080, about 900, work1 to work4 640). An unknown key returns `''`. `selectImageUrl(state, key, { width })` does the same from a state (in `selectors.js`), `selectBrand(state)` now also carries `address` and `images`.

## 12. UTM (`js/core/utm.js`)

```js
captureUtm(search?, { storage? } = {}) -> { source, medium, campaign } | null
getUtm({ storage? } = {}) -> { source, medium, campaign } | null
clearUtm({ storage? } = {})
normaliseLeadSource(value) -> LEAD_SOURCES id
normaliseUtm(input) -> { source, medium, campaign } | null      // what createBooking applies to draft.utm
```
`captureUtm` reads `utm_source`, `utm_medium`, `utm_campaign` (and `?src=` as an alias for the source) from a query string (default `location.search`). The source is normalised: `facebook`, `fb`, `meta`, `facebook.com`, `m.facebook.com`, `l.facebook.com` -> `facebook`; `instagram`, `ig`, `instagram.com` -> `instagram`; `google`, `googleads`, `google-ads`, `adwords` -> `google`; `referral`, `ref`, `friend` -> `referral`; `phone` -> `phone`; anything else `other`. `medium` and `campaign` are trimmed, limited to letters, digits and `_ - . + / space`, 60 chars. It stores under `STORAGE_KEYS.utm` in `sessionStorage` (try/catch, memory fallback) and never overwrites an existing capture in the session (it returns the existing one). Nothing in the query: returns the existing capture or `null`. The funnel passes `getUtm()` as `utm` to `createBooking`.

## 13. Migration, rollover and the seed

- **Migration (v1 or v2 saved state).** `parseState` runs `MIGRATIONS[1]` (v1 to v2, unchanged) then `MIGRATIONS[2]` (v2 to v3): adds `quotes: {}`, `settings.sla`, `marketing` (empty), `quoteDefaults`, `quoteItems` (from the saved brands), `connections` (defaults), `business.address` and `business.images` (defaults, any value the saved business already has is kept), `message.channel`/`toEmail`, and clears the v2 demo records (`seed: true` bookings, blocks and messages) and `seededFor` so the next load runs the rollover, which seeds v3 around the records a person made. Booking, customer and settings edits survive. A saved state with `v` above 3 is discarded (a fresh seed), as before.
- **Day rollover** (`initStore`, when `seededFor` is not today) replaces every seed record (bookings, blocks, messages, quotes, ad spend entries) with a fresh seed relative to today, keeps everything else, and re-imports the simulated Google Calendar busy blocks when that connection is on.
- **`resetDemo({ keepSettings })`** also resets quotes and ad spend to the seed (keepSettings true keeps connections, branding and the catalogue and any ad spend a person added).
- **Seed v3** (`buildSeed(now, settings, existing)` returns `{ bookings, blocks, messages, refSeq, quotes, adSpend }`). 42 bookings: 24 enquiries (`ev_quote`), 11 installs (`ev`, each made by an accepted quote) and 7 phone jobs. The original 15 (`bk_seed_01` to `bk_seed_15`) keep their windows, refs (`EL-1028` to `EL-1042`), createdAt rules and answers; the 27 further ones take `EL-1001` to `EL-1027` in creation order; `refSeq` stays 1043. Every seed booking is `seed: true`. At any clock the pipeline is enquiry 2, survey 3, quote 5, accepted 2, install 3, done 6 (4 paid, 2 owed), lost 3. Lead sources of the 24 enquiries: Facebook 13, Instagram 4, Google 3, word of mouth 2, phone 2. 17 quotes (`Q-<enquiry ref>`): 1 draft, 2 sent, 1 viewed, 11 accepted, 1 declined, 1 expired (stored `sent` with a `validUntil` in the past, so `quoteStatus` says `expired`). Ad spend: Facebook and Instagram for this month (to date, at least 40) and the two before (`ad_seed_<month>_<channel>`). Customers are Northern Ireland names with BT addresses (one outside the area: Conor, DG9), Ofcom drama numbers (07700 900xxx) and a sample `@example.com` email. Messages: alerts and confirmations for what is coming up, plus the quote traffic of the last 10 days (`customer_quote_sent` in both channels, `owner_quote_accepted` and `customer_quote_accepted`, one `customer_photos_request` on `bk_seed_08`). The newest enquiry (`bk_seed_07`) and the install accepted 6 hours ago (`bk_seed_35`) and `bk_seed_11` are unseen.
- **The seed ids at a glance** (stable at every clock; the quote id is `Q-` + the enquiry's `ref`):

| Stage | Enquiry booking (the pipeline item) | Install booking | Notes |
|---|---|---|---|
| enquiry | `bk_seed_07` Sinead (12 minutes old), `bk_seed_11` Conor (30 hours old: overdue, outside the area) | none | both `new`, survey pencilled in |
| survey | `bk_seed_08` Eoin, `bk_seed_12` Roisin, `bk_seed_14` Ciaran | none | `confirmed` surveys on the next open days |
| quote | `bk_seed_16` Leona (no quote yet), `bk_seed_17` Oisin (draft), `bk_seed_18` Cathy (sent 3 days ago), `bk_seed_19` Tiernan (viewed, sent by email), `bk_seed_20` Majella (sent 4 hours ago) | none | surveys done at 0 pounds |
| accepted | `bk_seed_21` Sorcha, `bk_seed_22` Fergal | `bk_seed_34`, `bk_seed_35` (`new`, tentative) | the pencilled installs are in Needs you |
| install | `bk_seed_25` Padraig, `bk_seed_23` Ailbhe, `bk_seed_24` Darragh | `bk_seed_09`, `bk_seed_36`, `bk_seed_37` (`confirmed`) | |
| done | `bk_seed_26` Niamh, `bk_seed_27` Ronan, `bk_seed_28` Grainne, `bk_seed_29` Malachy, `bk_seed_30` Eimear, `bk_seed_31` Cormac | `bk_seed_03`, `38`, `39`, `40` paid; `41`, `42` owed | |
| lost | `bk_seed_15` Bronagh (cancelled by the customer), `bk_seed_32` Dermot (quote declined), `bk_seed_33` Una (quote expired) | none | |
| phone jobs | `bk_seed_01`, `02`, `04` (done; 04 owed), `05`, `06` (today), `10`, `13` (confirmed) | | not in the pipeline |

## 14. Selector fixes and additions in `selectors.js`

- `isFreeVisit(booking)`: `ev_quote`, `status 'done'`, `finalPrice === 0`.
- `selectInsights`: `avgJob` and `collectedMonthCount` exclude free survey visits (a free visit has no money to collect and no value to average). `collectedMonth` is unaffected (adds 0). `selectOwed` / `selectOwedTotal` also skip free visits (a free survey is not "owed"). `byService` is unchanged (it still counts survey visits, with total 0).
- `selectBrand` adds `address`, `images`.
- Re-exports: `quoteTotal`, `quoteLineTotal`, `quoteStatus`, `quoteExpiresInDays`, `selectPipeline`, `selectJourney`, `selectSla`, `selectLeadSources`, `selectCostPerLead`, `selectQuoteStats`, `selectQuotes`, `selectQuote`, `selectQuotesForBooking`, `selectQuoteForBooking`, `selectQuoteList`, `selectQuoteDetail`, `selectConnectionsSummary`, `resolveRange`, `RANGE_PRESETS`, `leadSourceOf`, `selectImageUrl`.

## 15. Quick import map for other roles

```js
import { PIPELINE_STAGES, LEAD_SOURCES, LEAD_SOURCE_LABELS, QUOTE_STATUSES, QUOTE_STATUS_LABELS, QUOTE_VIA_LABELS, CONNECTION_KEYS, CONNECTION_LABELS,
         DOMAIN_TARGETS, WHATSAPP_DEMO_CODE, IMAGE_KEYS, IMAGE_META, DEFAULT_IMAGES, imageUrl, AD_CHANNELS, AD_CHANNEL_LABELS } from '../core/config.js';
import { captureUtm, getUtm } from '../core/utm.js';
import { createQuote, updateQuote, deleteQuote, sendQuote, recordQuoteViewed, acceptQuote, declineQuote, setConnection, connectWhatsApp,
         submitWhatsAppTemplates, connectGoogle, disconnect, startDomainSetup, checkDomain, rotateWebhookSecret, sendTestEvent, settleConnections,
         setAdSpend, removeAdSpend, addBookingPhotos, removeBookingPhoto } from '../core/store.js';
import { selectPipeline, selectJourney, selectSla, selectLeadSources, selectCostPerLead, selectQuoteStats, selectQuotes, selectQuote, selectQuoteList,
         selectQuoteDetail, selectQuoteForBooking, selectQuotesForBooking, selectConnectionsSummary, quoteTotal, quoteStatus, resolveRange, RANGE_PRESETS } from '../core/selectors.js';
import { buildQuoteDraft, defaultQuoteLines, quoteUrl } from '../core/quotes.js';
import { domainRecords, validateHostname, webhookSamplePayload } from '../core/connections.js';
```
