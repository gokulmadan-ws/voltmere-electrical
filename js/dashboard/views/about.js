// js/dashboard/views/about.js: "What's real in this prototype" (works for real, simulated, needed for a real build).
// Owner: WP7, rewritten for 180 Electrical by E2
import { html } from '../../vendor/preact-htm.js';
import {
  Button, Card, Chip, Icon, PageHeader, PrototypeNotice, cx, pageHref, pageTarget, useBrand, useMediaQuery
} from '../../ui/index.js';

export const title = "What's real";
export const css = ['css/insights.css'];

// Content for the 180 Electrical pre-sales prototype. `owner` is the live owner first name so an edit in Settings never leaves a stale name.
const realItems = () => [
  'Your own quote funnel, word for word: the postcode, parking, vehicle, timing, permission and contact questions and their answer options come from your current website',
  'Your public contact details and your two credentials (Level 3 Electrical Installation, 2391 Inspection and Testing) taken from your own website; edit them in Settings',
  'Every enquiry becoming a job card in this dashboard that shows the answers to the five funnel questions',
  'A free survey visit pencilled into the diary automatically, with the customer told it is provisional until you confirm',
  'The availability engine and diary, shared with the website: arrival windows, notice, how far ahead people can book, days off, blocked times and "full today"',
  'Booking creation with double-booking protection, then confirm, reschedule, cancel and Undo',
  'The quote path: survey done, "Quote ready" message, then booking the install and marking it paid',
  'Live sync between the website and this dashboard across two tabs of one browser',
  'Your edits to hours, rules, services, credentials and charger brands changing the website',
  'Tap-to-call links, and real WhatsApp links with the exact message pre-filled (they open your own WhatsApp, or the demo number when one is set)',
  'Real Google Maps search links, email links and a genuine downloadable calendar file (.ics)',
  'Light and dark themes (dark is the default, like your site)'
];

const simulatedItems = (owner) => [
  'Every WhatsApp, SMS and email message. The outbox shows the exact text a real system would send, marked "Sent (simulated)" or "Scheduled (simulated)"',
  `The arrival of those messages on ${owner}'s phone`,
  'Reminders firing at a set time (they are worked out from the scheduled time, with no timers)',
  'Quotes and payments: the quote is agreed outside the app, and only a Paid flag is kept (no card, no deposit)',
  'All customers, enquiries, bookings and payments you see: invented names, made-up BT streets and Ofcom drama phone numbers',
  `The owner persona: "${owner}" is taken from the email address on your site, so check it in Settings`,
  'The coverage check: any BT postcode counts as in area, and another UK postcode is flagged "Outside Northern Ireland". There is no address lookup',
  'The emergency path, which is switched off because your site only offers EV charger quotes',
  `The owner's ETA, which ${owner} chooses and is not live tracking`
];

// Feature, in this prototype, in a real build, effort.
const BUILD_ROWS = [
  ['Your Perspective funnel into the dashboard', 'The six steps are rebuilt here and an enquiry is saved in this browser as a job card',
    "Store each submission from your Perspective funnel by webhook (Perspective can post the answers to a URL on submit), map the postcode, parking, vehicle, timing, permission and contact fields into the same job card, then pencil in the survey visit and send the alerts. Or move the funnel onto your own page and skip the webhook.", 'S-M'],
  ['WhatsApp alerts to you and to customers', 'Simulated outbox plus real `wa.me` links',
    "WhatsApp Business Platform (Cloud API): a dedicated business number, Meta business verification, pre-approved message templates (new enquiry, survey pencilled in, confirmation, quote ready, reminder) with quick-reply buttons, and a webhook for button taps and replies. Meta bills per delivered template message (check Meta's current pricing; utility templates are free inside a customer-opened 24-hour window).", 'M-L'],
  ['Database and multi-device sync', '`localStorage`, one browser, two tabs',
    'Hosted database and API with server-side slot locking, so two customers on two phones cannot take the same survey window', 'M'],
  ['Owner login and security', 'None', 'Passkey or magic-link login, access control, backups, audit trail', 'M'],
  ['Reminders and scheduling', 'Timestamps, manual "Send now"', 'A scheduler or queue (cron, serverless timers) that fires reminders, retries failures', 'S-M'],
  ['Quotes, deposits and payments', 'None: the quote is agreed outside the app and a Paid flag is kept', 'A written quote builder (charger, cable route, extras) with PDF and acceptance, card payments or payment links (Stripe or Square), an optional deposit, receipts', 'M-L'],
  ['Calendar sync', '`.ics` download', 'Two-way Google, Apple or Outlook calendar sync', 'M'],
  ['Owner notifications', 'In-app toast, badge, tab title', 'The WhatsApp alert is the notification; optionally web push for the dashboard', 'S'],
  ['Consent and data protection', 'The marketing opt-in is stored with the enquiry', 'Consent records, privacy policy, retention, UK GDPR and PECR review of WhatsApp and marketing opt-in', 'S-M'],
  ['Photos of the consumer unit and charger spot', 'None: your funnel asks the customer to have photos ready', 'Photo upload on the funnel, storage and moderation, attached to the job card', 'M'],
  ['Installation paperwork', 'None', 'Installation certificate forms, PDF generation, e-signature, invoice and accounting export', 'L'],
  ['Reviews', 'None shown, because your website shows none', "Your Google Business Profile review link and a review request after each install", 'S'],
  ['Credentials and trust details', 'Two credentials as text, copied from your website', "Only what you want shown: scheme registration, insurance and certificates, in your words", 'S'],
  ['Domain, hosting, SEO, analytics', 'GitHub Pages or Vercel sub-path, no analytics', "Your domain, SSL, per-town pages, privacy-respecting analytics and ad conversion tracking for your paid social traffic", 'S-M'],
  ['Postcode and travel', 'A BT prefix check', 'Postcode lookup API, drive-time and travel checks', 'S-M']
].map(([feature, prototype, real, effort]) => ({ feature, prototype, real, effort }));

const NEED_FROM_YOU = [
  'Access to your Perspective funnel settings, to send each submission to the dashboard',
  'A WhatsApp number to use (a new number, or move yours) and Meta business verification',
  'Your domain',
  'Your real working hours and how many survey visits you can take a day',
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

function BuildCards() {
  return html`<ul class="ab-cards">
    ${BUILD_ROWS.map((row, i) => html`<li key=${row.feature}>
      <details class="ab-card" open=${i === 0}>
        <summary class="ab-card__sum">
          <span class="ab-card__head">
            <span class="ab-card__title">${row.feature}</span>
            <${EffortTag} effort=${row.effort} />
          </span>
          <${Icon} name="chevron-down" size=${20} class="ab-card__chev" />
        </summary>
        <div class="ab-card__body">
          <p class="ab-card__label">In this prototype</p>
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
function BuildTable() {
  return html`<div class="ab-tablewrap">
    <table class="ab-tbl">
      <caption class="u-sr-only">What a real build needs, feature by feature</caption>
      <thead>
        <tr>
          <th scope="col">Feature</th>
          <th scope="col">In this prototype</th>
          <th scope="col">In a real build</th>
          <th scope="col">Effort</th>
        </tr>
      </thead>
      <tbody>
        ${BUILD_ROWS.map((row) => html`<tr key=${row.feature}>
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
        <p class="ab-quote__text">Everything you tap is real UI and real logic running in this browser, using your own funnel questions and contact details. What is not real is what a platform provides: the link to your Perspective funnel, a shared database, the WhatsApp connection and a login.</p>
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
        <h2 class="db-section__title" id="ab-build-title">Needed for a real build</h2>
        <p class="ab-intro">Effort is a rough size: S small, M medium, L large.</p>
        <div data-testid="about-table">
          ${wide ? html`<${BuildTable} />` : html`<${BuildCards} />`}
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

      <p class="ab-privacy" data-testid="about-privacy"><${Icon} name="lock" size=${20} /><span>Nothing leaves this phone. This prototype has no server.</span></p>

      <div class="ab-links">
        <${Button} variant="primary" icon="external-link" href=${pageHref('index.html')} target=${pageTarget('index.html')} data-testid="about-site-link">Back to the customer site<//>
        <${Button} icon="gauge" href="#/demo" data-testid="about-demo-link">Demo tools<//>
      </div>

      <${PrototypeNotice} variant="footer" page="dashboard" />
    </div>
  </div>`;
}
