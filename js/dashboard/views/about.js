// js/dashboard/views/about.js: "What's real in this prototype" (works for real, simulated, needed for a real build).
// Owner: WP7
import { html } from '../../vendor/preact-htm.js';
import {
  Button, Card, Chip, Icon, PageHeader, PrototypeNotice, cx, pageHref, pageTarget, useBrand, useMediaQuery
} from '../../ui/index.js';

export const title = "What's real";
export const css = ['css/insights.css'];

// Content of contract section 17. `owner` is the live owner first name so a rebrand never leaves "Dan" behind.
const realItems = () => [
  'The availability engine and diary: arrival windows, half-day jobs, notice, how far ahead people can book, days off, blocked times and "full today"',
  'Booking creation with double-booking protection, and a friendly recovery when someone else takes the slot first',
  'Status changes, reschedule, cancel and Undo',
  'Live sync between the customer site and this dashboard across two tabs of one browser',
  'The owner\'s edits to hours, rules, prices and business name changing the customer site',
  'Tap-to-call links',
  'Real WhatsApp links with the exact message pre-filled (they open your own WhatsApp, and go to the demo number when one is set)',
  'Real Google Maps search links, and email links',
  'A genuine downloadable calendar file (.ics)',
  'Light, dark and system themes'
];

const simulatedItems = (owner) => [
  'Every WhatsApp, SMS and email message. The outbox shows the exact text a real system would send, marked "Sent (simulated)" or "Scheduled (simulated)"',
  `The arrival of those messages on ${owner}'s phone`,
  'Reminders firing at a set time (they are worked out from the scheduled time, with no timers)',
  'Payments: there are none ("pay after the job"), only a Paid flag',
  'Reviews, star ratings and the 212 count',
  'Scheme registration and insurance claims',
  'The postcode coverage list',
  'The seeded customers and bookings',
  'The owner persona and the business itself',
  'Emergency response promises',
  `The owner's ETA, which ${owner} chooses and is not live tracking`
];

// Section 17.3: feature, in this prototype, in a real build, effort.
const BUILD_ROWS = [
  ['WhatsApp alerts to the owner and customers', 'Simulated outbox plus real `wa.me` links',
    "WhatsApp Business Platform (Cloud API): a dedicated business number, Meta business verification, pre-approved message templates (booking alert, confirmation, reminder, on my way, review) with quick-reply buttons, a webhook for button taps and replies. Meta bills per delivered template message (check Meta's current pricing; utility templates are free inside a customer-opened 24-hour window).", 'M-L'],
  ['Bookings database and multi-device sync', '`localStorage`, one browser, two tabs',
    'Hosted database and API with server-side slot locking, so two customers on two phones cannot take the same window', 'M'],
  ['Owner login and security', 'None', 'Passkey or magic-link login, access control, backups, audit trail', 'M'],
  ['Reminders and scheduling', 'Timestamps, manual "Send now"', 'A scheduler or queue (cron, serverless timers) that fires reminders, retries failures', 'S-M'],
  ['Payments and deposits', 'None ("pay after the job"), a Paid flag', 'Card payments and payment links (Stripe or Square), optional deposits for large jobs, receipts', 'M'],
  ['Calendar sync', '`.ics` download', 'Two-way Google, Apple or Outlook calendar sync', 'M'],
  ['Owner notifications', 'In-app toast, badge, tab title', 'The WhatsApp alert is the notification; optionally web push for the dashboard', 'S'],
  ['Consent and data protection', 'A consent sentence', 'Consent records, privacy policy, retention, UK GDPR and PECR review of WhatsApp opt-in', 'S-M'],
  ['Reviews', 'Sample reviews', "The owner's Google Business Profile review link and optional review monitoring", 'S'],
  ['Certificates and invoices', 'None', 'Digital forms (EICR, EIC), PDF generation, e-signature, accounting export', 'L'],
  ['Domain, hosting, SEO, analytics', 'GitHub Pages or Vercel sub-path, no analytics', "The owner's domain, SSL, per-service and per-town pages, privacy-respecting analytics", 'S-M'],
  ['Real credentials', 'Sample labels everywhere', "The owner's scheme number, insurance details and genuine reviews", 'S'],
  ['Postcode and travel', 'A local list of outward codes', 'Postcode lookup API, drive-time and travel charges', 'S-M'],
  ['Photos of the fault', 'None', 'Upload storage and moderation', 'M']
].map(([feature, prototype, real, effort]) => ({ feature, prototype, real, effort }));

const NEED_FROM_YOU = [
  'A WhatsApp number to use (a new number, or move yours)',
  'Meta business verification',
  'Your domain',
  'Your real prices and hours',
  'Your registration and insurance details'
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
        <p class="ab-quote__text">Everything you tapped is real UI and real logic running on this phone. The three things that are not real are exactly what you pay a platform for: a shared database, the WhatsApp connection, and a login.</p>
      <//>

      <div class="ab-chips" role="group" aria-label="Jump to a part of this page">
        <${Chip} tone="ok" icon="check" onClick=${() => jumpTo('ab-real')}>Works for real in the browser<//>
        <${Chip} tone="accent" icon="clock" onClick=${() => jumpTo('ab-simulated')}>Simulated here<//>
        <${Chip} icon="building-2" onClick=${() => jumpTo('ab-build')}>Needed for a real build<//>
      </div>

      <section class="db-section ab-section" id="ab-real" aria-labelledby="ab-real-title">
        <h2 class="db-section__title" id="ab-real-title">Works for real in the browser</h2>
        <${Card}><${Checklist} items=${realItems()} icon="circle-check" tone="ok" /><//>
      </section>

      <section class="db-section ab-section" id="ab-simulated" aria-labelledby="ab-simulated-title">
        <h2 class="db-section__title" id="ab-simulated-title">Simulated here, and always labelled</h2>
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
