// js/dashboard/views/about.js: "What's real in this prototype" (works for real, simulated, and a per-connection table of what a real build needs).
// Owner: E3 (v1 by WP7, 180 Electrical wording by E2)
import { html } from '../../vendor/preact-htm.js';
import {
  Button, Card, Chip, Icon, PageHeader, PrototypeNotice, cx, pageHref, pageTarget, useBrand, useMediaQuery
} from '../../ui/index.js';

export const title = "What's real";
export const css = ['css/insights.css'];

// Content for the 180 Electrical pre-sales prototype. `owner` is the live owner first name so an edit in Settings never leaves a stale name.
const realItems = () => [
  'Your own quote funnel, word for word: the postcode, parking, vehicle, timing, permission and contact questions and their answer options come from your current website',
  'Your public phone, email and credentials, and your own photos (linked from your current website); edit them in Settings',
  'Every enquiry becoming a job card with their answers, where they came from (the tracked link, or phone or word of mouth) and a countdown against your reply promise',
  'A free survey visit pencilled into the diary automatically, with the customer told it is provisional until you confirm',
  'The quote builder: lines from your price list, totals, terms and a valid-until date, then the customer quote page where they accept and pick an install day from your real diary',
  'The pipeline from enquiry to survey, quote, accepted, install and paid, with money and response-time numbers worked out from the bookings',
  'Photos a customer attaches to an enquiry, stored as small copies in this browser, and the lightbox you review them in',
  'The availability engine and diary, shared with the website: arrival windows, notice, days off, blocked times and "full today"',
  'Booking creation with double-booking protection, then confirm, reschedule, cancel and Undo',
  'Live sync between the website, the quote page and this dashboard across tabs of one browser',
  'The loop between two phones, with no server: the customer\'s WhatsApp message is a real wa.me link that carries their enquiry, so opening it on your phone shows exactly what they entered and one tap adds it. A quote you send, and the customer\'s accept or decline, come back the same way inside the link. You always see what will be added before you tap',
  'Campaign links with utm tags and QR codes that really encode your link, a printable QR card, and tap-to-call and WhatsApp links with the exact message filled in (they open your own WhatsApp, or the demo number when one is set)',
  'Real Google Maps search links, email links and a downloadable calendar file (.ics)',
  'Light and dark themes (dark is the default, like your site)'
];

const simulatedItems = (owner) => [
  'Every WhatsApp message and email. The outbox shows the exact text a real system would send, marked "Sent (simulated)" or "Scheduled (simulated)"',
  `The automatic arrival of those messages on ${owner}'s phone, and on your customer's. The outbox only shows them: nothing arrives by itself`,
  'Every connection: your domain, the website webhook, ad tracking, WhatsApp, Google Calendar and Gmail. Each wizard works, saves on this device and says "Simulated in this prototype"',
  'The Google Calendar busy times, which are made-up sample blocks labelled "Google Calendar"',
  'Delivery between phones. An enquiry reaches your phone only when the customer taps send on the WhatsApp message built for them, and a quote reply only when they do the same. A quote link opens on any phone, but what a customer taps (accept or decline) is saved on the phone they tapped it on, until a real server exists, and you are not told it was viewed. A live build does all of this by itself, through your website webhook and a database',
  'Reminders firing at a set time (they are worked out from the scheduled time, with no timers)',
  'Payments: only a Paid flag is kept (no card, no deposit)',
  'All customers, enquiries, quotes and payments you see: invented names, made-up BT streets, Ofcom drama phone numbers, and sample prices that are not yours',
  'The coverage check: any BT postcode counts as in area, and another UK postcode is flagged "Outside Northern Ireland". There is no address lookup',
  `The owner's ETA, which ${owner} chooses and is not live tracking`
];

// Feature, in this prototype (simulated), in a real build, effort.
const CONNECTION_ROWS = [
  ['Your own website address', 'A guided set-up with fictional records (sites.example and 192.0.2.10). The check fails once, then succeeds, and says the certificate is ready (simulated)',
    "Your domain's DNS pointed at the host, a security certificate issued automatically, www and non-www redirects. Hosting and the domain are paid for separately (check current prices)", 'S'],
  ['Website funnel webhook (Perspective)', 'A fictional webhook address and signing secret. "Send test event" makes a sample enquiry through the same path as the funnel',
    'Perspective posts each submission to a URL on your backend (it supports webhooks on submit), the backend checks the signature, stores the enquiry, pencils in the survey and sends the alerts. Or the funnel moves onto your own page and skips the webhook', 'S-M'],
  ['Ad tracking (Meta Pixel, Google tag)', 'The ids are saved on this device. Nothing is loaded and nothing is sent to Meta or Google',
    'The Meta Pixel and Conversions API, and the Google tag, loaded behind a cookie consent banner, with the enquiry sent back as a conversion. UK GDPR and PECR review', 'S-M'],
  ['WhatsApp Business', 'A demo code (482913) stands in for the real one, and templates become "approved" after a few seconds. Messages are logged in the outbox; wa.me links are real',
    "A dedicated number on the WhatsApp Business Platform (Cloud API), Meta business verification, pre-approved message templates with quick-reply buttons, and a webhook for replies and button taps. Meta bills per delivered template message (check Meta's current pricing)", 'M-L'],
  ['Google Calendar', 'A pretend Google consent screen, then a few made-up busy blocks labelled "Google Calendar" in your diary',
    'Google sign-in (OAuth) with the Calendar scopes, which Google reviews before the public can use them, two-way sync with push notifications, token refresh and a retry queue', 'M'],
  ['Gmail', 'A pretend consent screen and a sender address. Emails are logged in the outbox, none are sent',
    "Sending through the Gmail API (a restricted scope Google verifies) or, more simply, an email service on your own domain with SPF, DKIM and DMARC set up so quotes reach inboxes", 'M']
].map(([feature, prototype, real, effort]) => ({ feature, prototype, real, effort }));

const BUILD_ROWS = [
  ['Delivery between phones (WhatsApp link and payload)', 'Real wa.me links and real data: the enquiry, the quote and the customer\'s accept or decline travel inside the link (the part after the #, which no server ever sees). A checksum catches a cut-off link and you tap to add. Each phone keeps its own copy, and anyone who knows the format could make a link',
    'The funnel webhook posts each enquiry to your backend, which stores it and alerts you, with no tapping. Quotes live in a database behind a private link, and acceptances are recorded on the server with a time, signed so they cannot be forged', 'M'],
  ['Database and multi-device sync', '`localStorage`, one browser, tabs of that browser stay in step. A second phone has its own separate copy',
    'Hosted database and API with server-side slot locking, so two customers on two phones cannot take the same survey or install day, and your phone and the customer\'s always agree without a link carrying the data', 'M'],
  ['The customer quote page', 'Opens on any phone, because the quote travels inside its link. On your own phone, accepting books a pencilled install through the real slot engine; on a customer\'s phone it opens a WhatsApp reply to you',
    'The same page served from your hosting, reading the quote from the database, with a private link for each quote, a PDF copy and the customer\'s acceptance recorded with a time', 'M'],
  ['Owner login and security', 'None', 'Passkey or magic-link login, access control, backups, audit trail', 'M'],
  ['Photos from customers', 'Small copies kept in this browser (up to three per enquiry)', 'Photo upload on the funnel, file storage, size and type checks, attached to the job card', 'M'],
  ['Reminders and scheduling', 'Timestamps, manual "Send now"', 'A scheduler or queue (cron, serverless timers) that fires reminders, retries failures', 'S-M'],
  ['Payments and deposits', 'None: a Paid flag is kept', 'Card payments or payment links (Stripe or Square), an optional deposit on acceptance, receipts', 'M-L'],
  ['Lead sources and ad spend', 'Counted from the tracked link on the enquiry; sample monthly ad spend', 'The Meta and Google ad accounts connected, or spend typed in monthly, to show the cost of each enquiry and install', 'S-M'],
  ['Installation paperwork', 'None', 'Installation certificate forms, PDF generation, e-signature, invoice and accounting export', 'L'],
  ['Reviews', 'None shown, because your website shows none', 'Your Google Business Profile review link and a review request after each install', 'S'],
  ['Consent and data protection', 'The marketing opt-in is stored with the enquiry', 'Consent records, privacy policy, retention, UK GDPR and PECR review of WhatsApp and marketing opt-in', 'S-M'],
  ['Postcode and travel', 'A BT prefix check', 'Postcode lookup API, drive-time and travel checks', 'S-M']
].map(([feature, prototype, real, effort]) => ({ feature, prototype, real, effort }));

const NEED_FROM_YOU = [
  'Access to your Perspective funnel settings, to send each submission to the dashboard',
  'A WhatsApp number to use (a new number, or move yours) and Meta business verification',
  'Your domain, and a Google account for the calendar and for sending email',
  'Your Meta Pixel id and Google tag id, for tracking which ads bring work',
  'Your real prices for the quote price list, your terms, and how many survey visits you can take a day',
  'Your photos, logo and any registration or insurance details you want shown'
];

/** Plain text with `code` spans from the contract table (the backticks mark file names and URLs). */
function Rich({ text }) {
  return String(text).split('`').map((part, i) => (i % 2 ? html`<code key=${i}>${part}</code>` : part));
}

function jumpTo(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
}

function Checklist({ items, icon, tone }) {
  return html`<ul class=${cx('ab-list', `ab-list--${tone}`)}>
    ${items.map((text, i) => html`<li class="ab-list__item" key=${i}>
      <${Icon} name=${icon} size=${20} class="ab-list__icon" />
      <span>${text}</span>
    </li>`)}
  </ul>`;
}

function EffortTag({ effort }) {
  return html`<span class="ab-effort" title="Rough size of the work: S small, M medium, L large">
    <span class="ab-effort__label">Effort</span> <strong>${effort}</strong>
  </span>`;
}

function BuildCards({ rows }) {
  return html`<ul class="ab-cards">
    ${rows.map((row, i) => html`<li key=${row.feature}>
      <details class="ab-card" open=${i === 0}>
        <summary class="ab-card__sum">
          <span class="ab-card__head">
            <span class="ab-card__title">${row.feature}</span>
            <${EffortTag} effort=${row.effort} />
          </span>
          <${Icon} name="chevron-down" size=${20} class="ab-card__chev" />
        </summary>
        <div class="ab-card__body">
          <p class="ab-card__label">In this prototype (simulated)</p>
          <p><${Rich} text=${row.prototype} /></p>
          <p class="ab-card__label">In a real build</p>
          <p><${Rich} text=${row.real} /></p>
        </div>
      </details>
    </li>`)}
  </ul>`;
}

// CONTRACT-GAP: 13.11 says "rows expandable (<details>)" on the table too, but a <details> cannot sit inside a <tr>,
// and from 768px there is room to show every column, so the table shows everything and only the mobile cards expand.
function BuildTable({ rows, caption }) {
  return html`<div class="ab-tablewrap">
    <table class="ab-tbl">
      <caption class="u-sr-only">${caption}</caption>
      <thead>
        <tr>
          <th scope="col">Feature</th>
          <th scope="col">In this prototype (simulated)</th>
          <th scope="col">In a real build</th>
          <th scope="col">Effort</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => html`<tr key=${row.feature}>
          <th scope="row">${row.feature}</th>
          <td><${Rich} text=${row.prototype} /></td>
          <td><${Rich} text=${row.real} /></td>
          <td class="ab-tbl__effort"><${EffortTag} effort=${row.effort} /></td>
        </tr>`)}
      </tbody>
    </table>
  </div>`;
}

export default function AboutView() {
  const brand = useBrand();
  const wide = useMediaQuery('(min-width: 768px)');

  return html`<div class="db-page ab-page">
    <${PageHeader} eyebrow="What's real" title="This is a prototype. Here is what is real." />

    <div class="db-stack">
      <${Card} tone="accent" class="ab-quote">
        <p class="ab-quote__text">Everything you tap is real UI and real logic running in this browser, using your own funnel questions, photos and contact details. What is not real is what a platform provides: the six connections below (your domain, the funnel webhook, ad tracking, WhatsApp, Google Calendar and Gmail), a shared database and a login.</p>
      <//>

      <div class="ab-chips" role="group" aria-label="Jump to a part of this page">
        <${Chip} tone="ok" icon="check" onClick=${() => jumpTo('ab-real')}>Works for real in the browser<//>
        <${Chip} tone="accent" icon="clock" onClick=${() => jumpTo('ab-simulated')}>Sample or simulated here<//>
        <${Chip} icon="building-2" onClick=${() => jumpTo('ab-build')}>Needed for a real build<//>
      </div>

      <section class="db-section ab-section" id="ab-real" aria-labelledby="ab-real-title">
        <h2 class="db-section__title" id="ab-real-title">Works for real in the browser</h2>
        <${Card}><${Checklist} items=${realItems()} icon="circle-check" tone="ok" /><//>
      </section>

      <section class="db-section ab-section" id="ab-simulated" aria-labelledby="ab-simulated-title">
        <h2 class="db-section__title" id="ab-simulated-title">Sample or simulated here, and always labelled</h2>
        <${Card}><${Checklist} items=${simulatedItems(brand.ownerFirst)} icon="clock" tone="sim" /><//>
      </section>

      <section class="db-section ab-section" id="ab-build" aria-labelledby="ab-build-title">
        <h2 class="db-section__title" id="ab-build-title">Your connections: simulated here, what a real build needs</h2>
        <p class="ab-intro">Every connection wizard works and says "Simulated in this prototype". Effort is a rough size: S small, M medium, L large.</p>
        <div data-testid="about-table">
          ${wide ? html`<${BuildTable} rows=${CONNECTION_ROWS} caption="The six connections: what is simulated and what a real build needs" />` : html`<${BuildCards} rows=${CONNECTION_ROWS} />`}
        </div>
      </section>

      <section class="db-section ab-section" id="ab-rest" aria-labelledby="ab-rest-title">
        <h2 class="db-section__title" id="ab-rest-title">The rest of a real build</h2>
        <div data-testid="about-table-rest">
          ${wide ? html`<${BuildTable} rows=${BUILD_ROWS} caption="Everything else a real build needs, feature by feature" />` : html`<${BuildCards} rows=${BUILD_ROWS} />`}
        </div>
      </section>

      <section class="db-section ab-section" aria-labelledby="ab-need-title">
        <h2 class="db-section__title" id="ab-need-title">What we would need from you</h2>
        <${Card}>
          <ul class="ab-need" data-testid="about-need">
            ${NEED_FROM_YOU.map((text) => html`<li key=${text}><${Icon} name="chevron-right" size=${18} /><span>${text}</span></li>`)}
          </ul>
        <//>
      </section>

      <p class="ab-privacy" data-testid="about-privacy"><${Icon} name="lock" size=${20} /><span>This prototype has no server, and nothing you type is sent to one. The only time details leave a phone is when a person taps send on a WhatsApp message built for them: it carries the data inside its link. The only outside requests the pages make are your own photos, loaded from your current website.</span></p>

      <div class="ab-links">
        <${Button} variant="primary" icon="external-link" href=${pageHref('index.html')} target=${pageTarget('index.html')} data-testid="about-site-link">Back to the customer site<//>
        <${Button} icon="gauge" href="#/demo" data-testid="about-demo-link">Demo tools<//>
      </div>

      <${PrototypeNotice} variant="footer" page="dashboard" />
    </div>
  </div>`;
}
