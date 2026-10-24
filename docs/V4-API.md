<!-- docs/V4-API.md: exact core API for the WhatsApp link handoff (docs/V4-HANDOFF.md is the brief). Owner: A4 core. -->
<!-- Everything here is implemented in js/core/*. Names are law for the UI roles (F4 funnel and dashboard import, Q4 quote page). -->

# V4 core API (A4): the cross-device loop with no server

Read with `docs/V4-HANDOFF.md` (the brief) and `docs/V3-API.md` (the store conventions, which are unchanged: a mutation returns `{ ok: true, ... }` or `{ ok: false, reason, errors?, message? }`, never throws for an expected failure, snapshots are frozen). Nothing from v3 was renamed. The schema version stays `3` and the storage key `vm_state_v1`: this wave adds no required state, only optional fields on records (`booking.importId`, `quote.acceptedVia`, `quote.declinedVia`).

What is REAL in this wave: the `wa.me` deep link (the customer or owner taps "send" in their own WhatsApp) and the data carried in the URL fragment. What a real build replaces: the webhook and a database (no tapping, no link, no copy of the data on two phones), and a signature on the payload (the checksum below catches a cut-off or damaged link, it does not stop a person forging one; that is why the import screen always shows what will be added and needs a tap).

## 0. Decisions that differ from, or add to, a literal reading of the brief

1. **`importId` is not the bare ref.** Every browser numbers its enquiries from `EL-1043`, so two customers on two phones both send `EL-1043`; keying on the ref alone would silently drop the second. `importId` = `<ref>|<created stamp>|<mobile digits>` (see `importIdOf`). Tapping the same link twice is still a no-op; two different customers with the same ref are both imported. The imported booking KEEPS the customer's ref (so the confirmation, the WhatsApp text and the dashboard agree) when it is unused in the owner's store and plausible (`EL-1000` to the next free number plus 100); otherwise it takes the owner's next ref. Quote ids come from the owner's booking ref, so the quote link always carries the owner's own id.
2. **`quoteShareUrl(quote, extra)` now returns the V4 link** (the same value as `quoteLink`). Every place that sends, copies or chases a quote (the store's `sendQuote`, the `{quoteLink}` message placeholder, the owner's "Copy link" buttons that already call `quoteShareUrl`) therefore carries `quote.html#d=<payload>` with no view edit. The v3 link `quote.html#q=<id>&d=<legacy payload>` still exists in the wild and still parses: `parseQuotePayload` and `importLinkedQuote` are kept unchanged, and `legacyQuoteShareUrl(quote, extra)` builds the old form (tests only). `quoteUrl(id)` (`quote.html#q=<id>`, same browser only) is unchanged and is also the fallback when a quote is too big to carry (see `quoteLinkInfo`). The quote page should try `parseQuoteLink(hash)` first and fall back to `parseQuotePayload` for a v3 link (`#q=<id>&d=<legacy>`): the new parser answers `damaged` for a v3 payload (it has no checksum).
3. **Quote line order in the payload is `[label, qty, unitPrice, detail?]`** as in the brief (the v3 link was `[label, unitPrice, qty]`). The optional 4th element keeps a line's detail text (the brief's lines had none). Notes are cut to 400 characters with an ellipsis in the link (`notesTruncated` says so).
4. **`dec` gains an optional `m`** (the customer's own words, max 140) and `acc` / `dec` carry the customer's FIRST name in `n`.
5. **The accepted install is unscheduled** (`start` = now, `durationMin: 0`, `status 'new'`, NOT `tentative`), exactly how an enquiry the diary had no room for is already represented. `bookingWhen` gives "To be arranged". Its notes hold the preferences. The two simulated messages use different wording for this case (the install is not "pencilled in"): see section 6.
6. **A customer's acceptance re-checks the total.** The payload's `t2` is compared with the local quote's total. If the owner edited a sent quote in between, the import is refused with `reason: 'total_changed'` (nothing changes) unless the caller passes `{ force: true }` after the owner confirmed.
7. **Clock clamping.** A created stamp later than now is set to now; one older than `IMPORT_MAX_AGE_DAYS` (30) is set to 30 days ago. The 24 hour reply clock therefore starts when the CUSTOMER sent the enquiry, never in the future and never absurdly old.

## 1. Constants (`js/core/config.js`, additions)

```js
HANDOFF_VERSION = 1
HANDOFF_KINDS = ['enq', 'quo', 'acc', 'dec']
HANDOFF_BUDGETS = { enq: 900, quo: 1800, acc: 700, dec: 500 }     // max ENCODED chars for a typical payload (a unit test enforces them)
IMPORT_MAX_AGE_DAYS = 30
INSTALL_DAYS  = [{ id: 'mon', label: 'Mon', long: 'Monday' }, ... 'sat']   // Mon to Sat, in this order (the "Which days suit you?" chips)
INSTALL_PARTS = [{ id: 'am', label: 'Morning' }, { id: 'pm', label: 'Afternoon' }, { id: 'any', label: 'Any time' }]
QUOTE_DECLINE_REASONS = [{ id: 'price', label: 'Too expensive' }, { id: 'other_installer', label: 'I found another installer' },
                         { id: 'time', label: 'I need more time' }, { id: 'plans', label: 'My plans have changed' }, { id: 'other', label: 'Something else' }]
HANDOFF_STORAGE_KEY = 'vm_handoff_v1'       // what this browser opened in WhatsApp (see rememberHandoff); localStorage with a memory fallback. (STORAGE_KEYS is unchanged.)
DEFAULT_UNSCHEDULED_TEMPLATES = { customer_quote_accepted, owner_quote_accepted }   // section 6
```

## 2. The payload (`js/core/handoff.js`)

Wire format: base64url (no padding) of compact UTF-8 JSON. `{ v: 1, t: kind, ..., k: <6 char checksum of everything else> }`.

```js
encodePayload(obj) -> string            // sets/overwrites `k`; '' when obj is not a plain object (never throws)
decodePayload(str) -> object | null     // the compact payload exactly as built, or null. NEVER throws. null for: not a string, empty, over 8000 chars, characters
                                        //   outside A-Z a-z 0-9 - _, bad base64, non-canonical base64, invalid UTF-8, invalid JSON, not an object, wrong v, unknown t, bad or missing k
payloadChecksum(obj) -> string          // the 6 base64url characters `k` should hold (over the canonical, key-sorted JSON of obj without k)
```

| kind | fields |
|---|---|
| `enq` | `i` ref (`EL-1043`), `c` created stamp (`YYYY-MM-DDTHH:mm`), `n` full name, `p` mobile (`07700 900231`), `e` email (omitted when none), `z` postcode (`BT9 6QP`), `a` `{ parking, vehicle, timing, permission }` (the STORED values of `ENQUIRY_STEPS`, only those given), `o` marketing opt-in `0`/`1`, `m` notes (omitted when none, max 400), `u` lead source id (omitted when none; one of `LEAD_SOURCES`) |
| `quo` | `i` quote id (`Q-EL-1043`), `r` enquiry ref, `n` customer FIRST name, `z` postcode (omitted when none), `b` brand (omitted when none), `l` lines `[[label, qty, unitPrice, detail?, 1?], ...]` (1 to 14; a 5th element `1` marks a possible extra, see section 9), `m` notes (omitted when none, max 400, cut with an ellipsis), `x` valid-until day key, `s` sent stamp, `f` flags (bit 1 = sample prices; always 1 in this prototype) |
| `acc` | `i` quote id, `n` first name, `d` days `['mon'..'sat']` (subset, in week order), `w` one of `am`, `pm`, `any`, `m` note (omitted when none, max 200), `t2` total in whole pounds (display, re-checked on import) |
| `dec` | `i` quote id, `n` first name, `y` reason id (one of `QUOTE_DECLINE_REASONS`, may be absent), `m` note (omitted when none, max 140) |

Size budgets (`HANDOFF_BUDGETS`, enforced by `tests/unit/handoff.test.mjs`): an enquiry with a 60 character name, a 60 character email and the full 300 character note is 878 encoded characters (a typical one is about 470; the absolute maximum, with the funnel's 100 character email, is about 930); a 10 line quote with typical labels and the default terms is under 1,800 (968 measured); `acc` under 700 (435 at its maximum); `dec` under 500 (303 at its maximum). A whole `wa.me` address for an enquiry is about 900 to 2,400 characters. Anything over 8,000 encoded characters is refused as `too_long`.

### Builders (pure; they return the compact object WITH `k`, or `null` when the input cannot be carried; never throw)

```js
buildEnquiryPayload(booking)                         // booking = a stored ev_quote booking (ref, createdAt, customer, address, answers, notes, utm)
buildQuotePayload(quote, booking?, extra?)           // quote = a stored Quote; booking = its enquiry (for ref and postcode); extra = { postcode?, ref?, sample? = true }
buildAcceptancePayload({ quote, days, part, note })  // quote = a stored Quote OR the `data` of parseQuoteLink (link mode); days default [], part default 'any'
buildDeclinePayload({ quote, reason, note })         // reason = a QUOTE_DECLINE_REASONS id or ''
```
`days` is cleaned (unknown ids dropped, duplicates removed, week order); `part` outside `am|pm|any` becomes `'any'`; a quote needs an `id` and at least one priced line.

### Links

```js
dashboardImportLink(payloadOrEncoded) -> string      // `${SITE_BASE_URL}dashboard.html#import=<encoded>`; '' when it cannot be encoded
quoteLink(quote, extra?) -> string                   // `${SITE_BASE_URL}quote.html#d=<encoded>`; the id-only `quoteUrl(id)` when the quote is too big (see quoteLinkInfo)
quoteLinkInfo(quote, extra?) -> { url, portable, chars, reason, notesTruncated }
    // portable false = the quote could not be carried: reason 'too_many_lines' (over 14) | 'too_long' (over 3,200 encoded chars) | 'no_lines' | 'bad_line'
    // chars = length of the encoded payload (0 when none). `extra` = { booking?, ref?, postcode?, sample? }; with `booking` (the quote's enquiry) the ref and postcode come from it.
quoteShareUrl(quote, extra?)                         // (quotes.js) the same as quoteLink; quoteUrl(id) is unchanged
```
`sendQuote(...).link` is `quoteLink(...)` and the `{quoteLink}` placeholder fills with it. `sendQuote` now also returns `linkPortable` (boolean): when it is `false` the link opens only in the browser that made the quote; show the owner a short warning.

### WhatsApp texts (plain friendly UK English, no emoji or exclamation marks, the link on its own LAST line)

```js
enquiryWhatsAppText(booking, { link?, business? }) -> string
acceptanceWhatsAppText({ quote, days, part, note }, { link?, business? }) -> string
declineWhatsAppText({ quote, reason, note }, { link?, business? }) -> string
describePreferences(days, part, { style: 'long' | 'compact' } = {}) -> string   // 'Thu or Fri mornings' (long) | 'Thu/Fri mornings' (compact); 'any day' / 'any weekday' / 'any morning'
declineReasonText(reasonId, note) -> string                                      // 'Too expensive: it was more than I expected' (max 200), what declineQuote stores
```
`link` defaults to the import link built from the matching builder; `business` defaults to the default business (`{ ownerFirstName }` is used). Example (accept): `Hi Daniel, it's Aoife. I'd like to go ahead with quote Q-EL-1043 (£1,394).` / `Best: Thu or Fri mornings.` / `Note: ...` / blank line / `Tap to mark it accepted on your dashboard:` / `<link>`.

### Reading a link (never throws)

```js
parseImport(input, { now? }) -> { ok: true, kind, data, payload, chars } | { ok: false, reason, message, errors? }
parseQuoteLink(input, { now? })   // the same, but only kind 'quo' is ok (any other kind: reason 'wrong_kind')
```
`input` may be: an object `parseImport` made (its result, its `data` or its `payload`; everything is re-validated, a compact payload object must carry a correct `k`); the bare encoded payload; `#import=<p>`; `import=<p>`; `#/import?d=<p>`; `/import?d=<p>`; `#d=<p>` or `d=<p>` (a quote link); a full URL of any of those; or pasted text containing one of them (a whole WhatsApp message works). Whitespace inside a bare payload is ignored. `payload` is the verified compact object. `now` is the clamping clock stamp (default the app clock).

Failure `reason`: `'empty'`, `'no_payload'` (text but nothing that looks like a payload), `'too_long'`, `'damaged'` (bad encoding, cut off, edited, wrong checksum), `'unsupported'` (version or kind), `'invalid'` (decodes but a field is unusable; `errors` is `{ field: sentence }`), `'wrong_kind'`. `message` is a calm sentence ready to show ("This link looks cut off or damaged. Ask them to send it again.").

`data` is the SANITISED, display-ready object (control and bidi characters removed, HTML tags removed, whitespace collapsed, lengths limited, types checked; unknown fields ignored). Every `data` has `kind`.

```js
// kind 'enq'
{ kind: 'enq', ref, createdAt /* clamped to now, never older than 30 days */, sentAt /* the stamp as sent */, name, firstName, phone /* '07700 900231' */, phoneDigits /* wa.me digits '447700900231' */,
  email, postcode, outside /* true for a valid non-BT postcode */, outsideLabel /* 'Outside Northern Ireland' or '' */,
  answers: { parking?, vehicle?, timing?, permission? }, answerRows: [{ key, heading, value, label }] /* postcode first, then the answers given, in HIS wording */,
  marketingOptIn: boolean, notes, utmSource /* a LEAD_SOURCES id or '' */, importId }
// kind 'quo'
{ kind: 'quo', id, quoteId /* = id */, ref, customerFirst, customerName /* = customerFirst */, postcode, brand,
  lines: [{ id: 'ln_1', label, detail, qty, unitPrice }], total, notes, validUntil, sentAt, sample }
// kind 'acc'
{ kind: 'acc', quoteId, customerFirst, days: ['thu','fri'], part: 'am', note, total, prefers /* 'Thu/Fri mornings' */, prefersLong /* 'Thu or Fri mornings' */, summary /* 'Aoife accepted quote Q-EL-1043 (£1,394), prefers Thu/Fri mornings' */ }
// kind 'dec'
{ kind: 'dec', quoteId, customerFirst, reasonId, reasonLabel, note, reasonText, summary /* 'Aoife declined quote Q-EL-1043 (Too expensive)' */ }
```
Other helpers: `clampStamp(stamp, nowStampStr, { maxAgeDays = 30 })` (invalid input gives `nowStampStr`), `importIdOf(data)`, `sanitiseText(value, max, { multiline })` (the cleaner every field passes through: invisible and bidi characters and HTML tags removed, whitespace collapsed, cut to `max`; non-strings give `''`).

`quotes.js` also exports `quoteDetailFromLink(data, nowStampStr?)` (the `selectQuoteDetail` shape from the `data` of `parseQuoteLink`, plus `fromLink`: the customer's quote page can render it with its existing components), `assessQuoteDecision(quotes, data, nowStampStr?)` (the one place the accept and decline rules live: `{ state: 'ready'|'done'|'blocked', reason, message, quote, localTotal, bookingId, expected?, accepted? }`) and `legacyQuoteShareUrl` (the v3 link).

### Remembering what this browser opened in WhatsApp (never throws; localStorage `vm_handoff_v1` with a memory fallback; at most 30 entries)

```js
rememberHandoff(kind, id, info = {}, { storage? }) -> boolean   // kind 'enq' | 'acc' | 'dec'; id = the ref or the quote id; `at` (a stamp) is added when info has none
recallHandoff(kind, id, { storage? }) -> object | null
forgetHandoff(kind, id, { storage? })
```
A page can use these to show "Opened in WhatsApp on Fri 23 Oct" after a reload. The page cannot know whether the person pressed send in WhatsApp, so word it as "opened", not "delivered".

## 3. `js/core/messages.js` (additions): the ready-to-open wa.me links

These live in `messages.js` because it is the one place `wa.me` URLs are built. `state` is the browser's own store state (the number is `settings.business.phone`, or `settings.demoPhoneDigits` when the demo phone is set, like every other link).

```js
enquiryHandoff(booking, state)                          -> { ok: true, kind: 'enq', payload, encoded, link, text, url, chars } | { ok: false, reason: 'cannot_carry' }
acceptanceHandoff({ quote, days, part, note }, state)   -> { ok: true, kind: 'acc', ... }
declineHandoff({ quote, reason, note }, state)          -> { ok: true, kind: 'dec', ... }
ownerWhatsAppUrl(state, text) -> string                 // https://wa.me/<digits>?text=<encoded>
```
`url` is the `https://wa.me/447885496800?text=...` address to put on the button (`<a href=${h.url} target="_blank" rel="noopener noreferrer">`); `link` is the dashboard import link inside the text; `text` is the plain message; `chars` the encoded payload length.

## 4. Store (`js/core/store.js`, additions)

```js
importEnquiry(input) -> { ok: true, booking, messages, bookingId, existed: false }
                      | { ok: true, existed: true, bookingId, booking }                   // already imported: nothing changes (idempotent)
                      | { ok: false, reason, message, errors? }
importQuoteDecision(input, { force? } = {}) -> { ok: true, existed: false, kind: 'acc', quote, booking /* the unscheduled install */, bookingId, messages }
                      | { ok: true, existed: false, kind: 'dec', quote, message }
                      | { ok: true, existed: true, kind, quote, bookingId? }               // already accepted / declined: nothing changes
                      | { ok: false, reason, message, errors? }
importHandoff(input, opts?) -> the above, dispatched on the kind ('enq' -> importEnquiry; 'acc' / 'dec' -> importQuoteDecision; 'quo' -> { ok: false, reason: 'wrong_kind' })
```
`input` is any of: the object `parseImport` returned, its `data`, the compact `payload`, or the encoded string / a link (everything is re-validated; a caller cannot smuggle in unchecked data).

**`importEnquiry`** goes through `createBookingIn`, the same code as the website funnel: service `ev_quote`, source `'website'`, status `new`, the next free survey window PENCILLED IN from the owner's diary (`tentative: true`; kept unscheduled when the diary is full), `customer_received` and `owner_new_booking` simulated messages, `seenByOwner: false`. Differences: `createdAt` (and the first history entry's `at`) is the payload's created stamp clamped (decision 7), so the 24 hour reply clock (`selectSla`) starts when the customer sent it; `utm` is `{ source: <u>, medium: '', campaign: '' }` when the payload has a source; the ref is reused when free (decision 1); `booking.importId` is set; the history gets `{ event: 'note', by: 'system', note: 'Added from a WhatsApp link' }` after `created`. Notes up to 400 characters are kept (the funnel itself allows 300). No undo token (it makes a booking, like `sendTestEvent`).

**`importQuoteDecision`** finds the quote by id in THIS store.
- `acc`: allowed when the stored status is `sent` or `viewed` and the quote has not expired. Sets `status: 'accepted'`, `acceptedAt` (now), `acceptedVia: 'whatsapp'`, `installBookingId`; creates the unscheduled `ev` install booking (`status 'new'`, `quoteId`, `quotedPrice` = the quote total, customer, address and answers copied from the enquiry, `seenByOwner: false`, `notes` = `Install preferences: Thu or Fri mornings. Customer note: ...`); history `message` by `customer` "Quote accepted" on the enquiry; logs `customer_quote_accepted` then `owner_quote_accepted` on the install booking (messages array `[customer, owner]`). It then appears in the pipeline under Accepted ("Install day to arrange") and Needs you, and Confirm the install day = `rescheduleBooking` to place it, then `confirmBooking`.
- `dec`: allowed for `sent` or `viewed` (also when past its valid-until). Sets `status: 'declined'`, `declinedAt`, `declineReason` = `declineReasonText(...)`, `declinedVia: 'whatsapp'`; logs `owner_quote_declined` on the enquiry; history `message` by `customer` "Quote declined".
- Idempotent: the same acceptance again returns `{ ok: true, existed: true, bookingId }`; the same decline again `{ ok: true, existed: true }`.

Failure reasons (all with a friendly `message`): the parse reasons of section 2, plus `quote_not_found` (this store has no such quote: "You don't have quote Q-EL-1043 on this device. Open this link on the phone you sent the quote from."), `quote_mismatch` (the id exists here but for a different customer's first name), `total_changed` (+ `expected` the local total, `accepted` the payload total), `quote_not_open` (a draft), `quote_declined` (accepting a declined quote), `already_accepted` (declining an accepted quote; + `bookingId`), `expired`, `service_unavailable`, `storage_full`, `wrong_kind`.

Both decision imports also return an `undoToken` for a fresh application (`undo(token)` takes the acceptance or decline back; the install booking it made goes with it). `importLinkedQuote` (v3) is kept for links already in the wild; new code does not need it.

## 5. Selectors (`js/core/selectors.js`, additions)

```js
previewImport(state, parsed, nowStampStr?) -> {
  kind, ok: true,
  state: 'ready' | 'done' | 'blocked',      // done = already imported / decided (the action would do nothing); blocked = cannot be applied on this device
  reason: '' | <failure reason of section 4>, message: '' | <a sentence to show>,
  title,                                    // 'Aoife Magee sent an enquiry' | 'Aoife accepted a quote' | 'Aoife declined a quote'
  summary,                                  // enq: 'Aoife Magee, BT9 6QP'; acc / dec: the data.summary, with the local total when the payload has none
  actionLabel,                              // 'Add to my dashboard' | 'Mark quote accepted and plan the install' | 'Mark quote declined'
  bookingId,                                // the existing enquiry (enq, state 'done') or install booking (acc, state 'done'), else null
  quote,                                    // the local Quote for acc / dec, else null
  localTotal,                               // its total, else null
  href                                      // the dashboard hash to open next: '#/bookings/<id>' | '#/quotes/<id>' | '#/pipeline'
} | { ok: false, reason, message }          // when `parsed` is not an ok parseImport result
selectQuoteLinkInfo(state, quoteId) -> { url, portable, chars, reason, notesTruncated } | null   // the owner's "Copy link": works from any state, nothing to build in the view
```

## 6. Messages (`messages.js`)

- The `{quoteLink}` placeholder fills with `quoteLink(quote, { booking: <the quote's enquiry> })`. The default `customer_quote_sent` text is unchanged.
- `bubbleActions` gives `owner_new_booking` and `owner_quote_accepted` bubbles of a booking with NO day yet the buttons Open job and Call (no Confirm: `confirmBooking` refuses an unscheduled booking with `unscheduled`). A booking that has a day is unchanged.
- An install booking that is still unscheduled (the WhatsApp acceptance) uses two extra defaults, `DEFAULT_UNSCHEDULED_TEMPLATES` in config.js (`customer_quote_accepted`: "Hi Aoife, thanks for accepting your quote (£1,394). I will be in touch shortly to agree your installation day. Quote Q-EL-1043"; `owner_quote_accepted`: heading, who accepted what, "Install day to be agreed.", the preference line, address and job link). A template the owner customised in Settings still wins, filled with `installWhen` = "a day to be agreed".

## 7. Import map for the UI roles

```js
import { SITE_BASE_URL, INSTALL_DAYS, INSTALL_PARTS, QUOTE_DECLINE_REASONS, ENQUIRY_STEPS, answerLabel } from '../core/config.js';
import { parseImport, parseQuoteLink, decodePayload, describePreferences, declineReasonText, dashboardImportLink, quoteLink, quoteLinkInfo,
         buildEnquiryPayload, buildAcceptancePayload, buildDeclinePayload, enquiryWhatsAppText, acceptanceWhatsAppText, declineWhatsAppText,
         rememberHandoff, recallHandoff, forgetHandoff } from '../core/handoff.js';
import { enquiryHandoff, acceptanceHandoff, declineHandoff, ownerWhatsAppUrl } from '../core/messages.js';
import { importEnquiry, importQuoteDecision, importHandoff } from '../core/store.js';
import { previewImport, selectQuoteLinkInfo } from '../core/selectors.js';
import { quoteDetailFromLink } from '../core/quotes.js';
```

- **Funnel confirmation (F4):** `const h = enquiryHandoff(booking, state)` then the primary button `href=${h.url}`; after the tap `rememberHandoff('enq', booking.ref, { })`. If `!h.ok`, hide the card.
- **Dashboard import (F4):** `const parsed = parseImport(location.hash)`; `if (!parsed.ok) show parsed.message`; otherwise `const p = previewImport(getState(), parsed)`; render `parsed.data` (for `enq` use `data.answerRows`, `data.outsideLabel`, `data.phoneDigits` for call and WhatsApp links); the button calls `importHandoff(parsed)`; on `ok` link to `p.href` (use `result.bookingId`).
- **Quote page link mode (Q4):** `const parsed = parseQuoteLink(location.hash)`; the id is `parsed.data.quoteId`; if `getState().quotes[id]` exists the page behaves as today. Otherwise `quoteDetailFromLink(parsed.data)` gives the same shape as `selectQuoteDetail` (plus `fromLink`), so the existing quote components render it. Accept: `acceptanceHandoff({ quote: parsed.data, days, part, note }, state).url`; decline: `declineHandoff({ quote: parsed.data, reason: reasonId, note }, state).url`. Neither writes to the customer's store (the customer has no copy of the owner's diary); use `rememberHandoff('acc', quoteId, { days, part, note })` (or `'dec'`) so a reload can say "Opened in WhatsApp".
- **Owner quote views:** keep calling `quoteShareUrl(...)` (now the V4 link) or call `selectQuoteLinkInfo(state, quote.id)` and show a warning when `portable` is false.

## 8. Not done / for the orchestrator

- `js/core/pipeline.js` is not in this role's file list, so its Accepted-stage summary is untouched: for an unscheduled install it reads "Accepted £1,394. Install pencilled in To be arranged". The one-line fix is in `summaryFor`, case `'accepted'`: use `i && i.status === 'new' && !isUnscheduled(i)` for the "pencilled in" wording, so an install with no day reads "Install day to arrange". (`isUnscheduled` is already imported there.)
- The v3 quote page (`js/quote/route.js`, `linked.js`) still reads only `#q=<id>[&d=<legacy>]`. Until Q4 switches it to `parseQuoteLink` it shows "We could not open this quote" for a `quote.html#d=...` link on a browser that has no copy of the quote.
- A link carries no signature: anybody who knows the format can make one. That is why the import screen shows what it will add and needs a tap, and why a real build signs payloads server-side.
- `viewed` cannot travel back: opening the quote on the customer's phone does not tell the owner's phone. The owner only learns of an accept or a decline.

## 9. Possible extras: optional quote lines (polish round, role CP)

His site states no prices and no terms, so a quote must never carry a conditional line inside a fixed total (the old catalogue had "Consumer unit upgrade (if required) £420" counted in). A line can now be a **possible extra**: listed on the quote, shown apart as "Possible extras", and NEVER added into the total. Nothing about the schema changes (still `3`, key `vm_state_v1`): the new field is an optional boolean on records, and a record without it behaves as before.

**Data.** `optional: boolean` on a quote line (`{ id, label, detail, qty, unitPrice, optional }`) and on a catalogue item in `settings.quoteItems`. `makeDefaultQuoteItems()` flags `consumer_unit` (label unchanged) and nothing else; `makeChargerItem` gives `optional: false`. `normaliseQuoteLines` and `normaliseQuoteItems` keep `optional` only when it is the boolean `true` (anything else becomes `false`), and always write the boolean. `createQuote`, `updateQuote` and `buildQuoteDraft` carry it through (a line added from the catalogue copies the item's flag). A saved state made before this change is brought up to date when it is loaded (`refreshQuoteContent` in the store): catalogue items with no flag get `optional` (true for `consumer_unit`, false for the rest; a flag he already set is left alone) and `quoteDefaults.notes` is swapped for `DEFAULT_QUOTE_NOTES` only when it still holds the old default text (`LEGACY_QUOTE_NOTES`).

**Helpers (`js/core/quotes.js`, all re-exported from `selectors.js`).**

```js
isOptionalLine(line) -> boolean            // only the boolean true
quoteFixedLines(quote) -> line[]           // the lines the total adds up, in order
quoteExtraLines(quote) -> line[]           // the possible extras, in order
quoteExtrasTotal(quote) -> number          // what the extras would come to if all were needed. NEVER part of quoteTotal
quoteTotal(quote)                          // = the sum of quoteLineTotal over quoteFixedLines (optional lines are left out)
quoteLineTotal(line)                       // unchanged: qty * unitPrice of that one line (an extra still has a value to show)
splitLines(quote) -> { lines, extras, allLines }   // each line gets `lineTotal` and a boolean `optional`
```

**What every view must do.** Total: always `quoteTotal(quote)` (the store, the pipeline, the insights, the messages' `{quoteTotal}`, the acceptance payload `t2` and the install's `quotedPrice` all use it, so they agree). Lines: render the fixed lines as the quote, and the extras in their own "Possible extras" block (label, the amount as "+£420 if needed", and never a tick or a share of the total). A quote with no fixed line has no total and cannot be sent (`sendQuote` answers `invalid`, "Add at least one line with a price.").

**`selectQuoteDetail(state, id)` and `quoteDetailFromLink(data)`** now return, besides the old keys:

```js
total      // fixed lines only
lines      // the FIXED lines, each { ...line, optional: false, lineTotal }   <- same key as before, so a page that only renders `lines` stays consistent with `total`
extras     // the possible extras, each { ...line, optional: true, lineTotal }  ([] when none)
allLines   // every line in the order he wrote them, each with `lineTotal` and `optional`
```

**The quote link (`quote.html#d=`).** A possible extra travels as a 5th element: `[label, qty, unitPrice, detail, 1]` (`''` as its detail when it has none); a fixed line is unchanged (`[label, qty, unitPrice, detail?]`). `parseImport`/`parseQuoteLink` give `data.lines[i].optional` (boolean) and `data.total` = the fixed lines only; a link whose lines are all extras is refused (`invalid`, "the lines have no price"). `buildAcceptancePayload` and the WhatsApp texts total the fixed lines only, so the customer is asked to accept the same figure the page showed. The v3 link (`#q=<id>&d=<legacy>`) cannot carry the flag: `legacyQuoteShareUrl` leaves extras out.

**Defaults.** `DEFAULT_QUOTE_NOTES` = "Sample terms: Daniel sets his own." (short, neutral, labelled sample: no guarantee, payment or product wording; it does not match the quote page's `PLACEHOLDER_SENTENCE` filter on purpose, so the customer page shows it, tagged "Sample terms"). The catalogue items have no `detail` text. Default customer messages no longer say "pencilled in", "provisional", "free survey", "pay after the job", "payable after the install" or name payment methods: `customer_received` reads "Earliest visit Daniel could offer: Mon 26 Oct, 8–10am. Daniel will confirm within 24 hours." (or "Daniel will be in touch within 24 hours to discuss your installation." when the diary had no room), `customer_quote_accepted` reads "The install day you chose is ...". Owner-facing alerts (`owner_new_booking`, `owner_quote_accepted`) keep the diary words he uses himself.

**Seed.** Two seeded quotes carry the consumer unit upgrade as a possible extra: Majella Quigg's sent quote (bk_seed_20, fixed total 1,514) and Eimear Toner's accepted-and-done quote (bk_seed_30). Padraig Quinn's booked install (bk_seed_09, was 1,934) lost the line and is now 1,514. Golden numbers moved by 420 per affected quote: owed 3,609 -> 3,189, Done revenue 9,191 -> 8,771, next-14-days booked 8,123 -> 7,703, average job 826 -> 784, average accepted quote 1,556 -> 1,480, waiting on customer 5,009 -> 4,589.
