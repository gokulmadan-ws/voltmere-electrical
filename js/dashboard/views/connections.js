// js/dashboard/views/connections.js: Connections hub (#/connections): "tried out" ring, six practice-mode connection cards, plus helpers shared by the K1 screens.
// Owner: K1 (connections hub, domain, webhook, tracking); round 2 (T13): honest wording (practice mode, "tried out"), the webhook first, buttons on one baseline
import { html, useMemo } from '../../vendor/preact-htm.js';
import {
  Banner, Button, ConnectionBadge, Icon, PageHeader, ProgressRing, RealBuildNote, SimBanner, cx, toast, useNow, useStore
} from '../../ui/index.js';
import { selectConnectionsSummary } from '../../core/selectors.js';
import { getStorageStatus, undo } from '../../core/store.js';
import { routeHref } from '../router.js';

export const title = 'Connections';
export const css = ['css/connections.css'];

// ---------- shared with connections-domain.js, connections-webhook.js and connections-tracking.js ----------

/**
 * The one "Practice mode" look for something that is done in this demo but is not real: a neutral dashed outline with a tick, never a green
 * "Connected". Used on the hub cards, and on the end states of the wizards.
 */
export function PracticeBadge({ label = 'Tried out', tag, class: cls, ...rest }) {
  return html`<span class=${cx('k1-practice', cls)} ...${rest}><${Icon} name="check" size=${14} /><span>${label}${tag ? html`<span class="k1-practice__tag">${tag}</span>` : null}</span></span>`;
}

/** Card copy per connection: icon, the one-line value proposition, the route, and the button wording per state. `title` replaces the plain name where a card needs plainer words. */
export const CARD_META = {
  domain: {
    icon: 'globe', route: 'connections-domain',
    value: 'Put your site on your own web address',
    cta: { off: 'Set up my address', pending: 'Check my DNS', connected: 'Manage address' }
  },
  whatsapp: {
    icon: 'message-circle', route: 'connections-whatsapp', title: 'WhatsApp alert to my phone',
    value: 'Get a WhatsApp message on your own phone the second an enquiry lands',
    cta: { off: 'Connect WhatsApp', pending: 'Finish setup', connected: 'Manage WhatsApp' }
  },
  calendar: {
    icon: 'calendar-days', route: 'connections-calendar',
    value: 'See your busy times in the diary and add every job to your Google Calendar',
    cta: { off: 'Connect calendar', pending: 'Finish setup', connected: 'Manage calendar' }
  },
  email: {
    icon: 'mail', route: 'connections-email',
    value: 'Send confirmations and quotes from your own email address',
    cta: { off: 'Connect Gmail', pending: 'Finish setup', connected: 'Manage Gmail' }
  },
  webhook: {
    icon: 'webhook', route: 'connections-webhook', title: 'Keep your Facebook funnel',
    value: 'Keep the funnel your agency runs now, and let every enquiry land here too',
    cta: { off: 'Turn it back on', pending: 'Set it up', connected: 'Manage it' }
  },
  tracking: {
    icon: 'megaphone', route: 'connections-tracking',
    value: 'Find out which ads bring in enquiries, not just clicks',
    cta: { off: 'Add my tracking IDs', pending: 'Finish setup', connected: 'Manage tracking' }
  }
};

/** Card order on the hub: the one that fits how he works today first (keep the agency's funnel, bring its leads in), then what saves him most time. */
export const HUB_ORDER = ['webhook', 'whatsapp', 'domain', 'calendar', 'email', 'tracking'];

// Which unfinished connection to suggest first: the same order.
const NEXT_PRIORITY = ['webhook', 'whatsapp', 'domain', 'calendar', 'email', 'tracking'];

/** A toast with an Undo button that reverses one store change (falls back to a plain toast without a token). */
export function undoToast({ message, detail, icon, token }) {
  toast({
    message, detail, icon,
    actionLabel: token ? 'Undo' : undefined,
    onAction: token ? () => {
      const res = undo(token);
      if (!res || !res.ok) toast({ message: 'Too late to undo.' });
    } : undefined
  });
}

/** Shown only when the browser refuses to keep anything (private window, blocked site data). */
export function StorageNote() {
  const status = getStorageStatus();
  if (status.ok) return null;
  return html`<${Banner} tone="warn" data-testid="k1-storage-note">
    This browser is not letting the page save anything. What you set up here will be lost when you close this tab.
  <//>`;
}

// ---------- hub ----------

const selectState = (state) => state;

function ConnectionCard({ item, index, isNext }) {
  const meta = CARD_META[item.key];
  const ctaText = meta.cta[item.status] || 'Open';
  return html`<li class=${`k1-card k1-card--${item.status}${isNext ? ' is-next' : ''}`} style=${{ '--i': index }} data-testid=${`k1-card-${item.key}`} data-status=${item.status}>
    <div class="k1-card__top">
      <span class="k1-card__icon" aria-hidden="true"><${Icon} name=${meta.icon} size=${24} /></span>
      <div class="k1-card__head">
        <h3 class="k1-card__title">${meta.title || item.title}</h3>
        <div class="k1-card__badges">
          ${item.status === 'connected'
            ? html`<${PracticeBadge} data-testid=${`k1-badge-${item.key}`} />`
            : html`<${ConnectionBadge} status=${item.status} label=${item.label} data-testid=${`k1-badge-${item.key}`} />`}
          ${isNext ? html`<span class="k1-tag">Up next</span>` : null}
        </div>
      </div>
    </div>
    <p class="k1-card__value">${meta.value}</p>
    ${item.status !== 'off' ? html`<p class="k1-card__detail" data-testid=${`k1-detail-${item.key}`}>${item.detail}</p>` : null}
    <${Button} class="k1-card__cta" variant="secondary" iconRight="arrow-right" href=${routeHref(meta.route)} data-testid=${`k1-cta-${item.key}`}>${ctaText}<//>
  </li>`;
}

export default function ConnectionsView() {
  const state = useStore(selectState);
  const now = useNow(5000); // a simulated delay can finish while the page is open
  const summary = useMemo(() => selectConnectionsSummary(state), [state, now]);
  const byKey = {};
  summary.forEach((row) => { byKey[row.key] = row; });
  const items = HUB_ORDER.map((key) => byKey[key]).filter(Boolean);
  const total = items.length;
  const done = items.filter((r) => r.status === 'connected').length;
  const pending = items.find((r) => r.status === 'pending');
  const next = pending || NEXT_PRIORITY.map((key) => byKey[key]).find((r) => r && r.status !== 'connected') || null;
  const nextMeta = next ? CARD_META[next.key] : null;
  const complete = done === total;

  return html`<div class="db-page k1-page" data-testid="k1-hub">
    <${PageHeader}
      eyebrow="Business"
      title="Connect your business"
      subtitle="Link up the tools you already use so enquiries, quotes and diary dates stay in one place."
    />
    <${SimBanner} />
    <${StorageNote} />

    <section class=${`k1-hero${complete ? ' k1-hero--done' : ''}`} aria-label="Set-up progress" data-testid="k1-hero">
      <${ProgressRing} class="k1-hero__ring" size=${92} stroke=${8} value=${done} max=${total} tone="accent"
        label="Connections tried out" valueText=${`${done} of ${total} tried out`} data-testid="k1-progress">
        <span class="k1-hero__ring-num">${done}</span><span class="k1-hero__ring-of">of ${total}</span>
      <//>
      <div class="k1-hero__text">
        <p class="k1-hero__title" data-testid="k1-progress-text">${done} of ${total} tried out</p>
        ${complete
          ? html`<p class="k1-hero__sub">All ${total} set up in this demo. Nothing is really connected yet.</p>`
          : html`<p class="k1-hero__sub" data-testid="k1-next-text"><strong>Up next: ${nextMeta.title || next.title}.</strong> ${nextMeta.value}.</p>`}
      </div>
      ${complete ? null : html`<${Button} class="k1-hero__cta" variant="primary" size="lg" iconRight="arrow-right" href=${routeHref(nextMeta.route)} data-testid="k1-hero-cta">${nextMeta.cta[next.status] || 'Open'}<//>`}
    </section>

    <section class="k1-section" aria-labelledby="k1-cards-title">
      <h2 class="k1-section__title" id="k1-cards-title">Your connections</h2>
      <ul class="k1-grid" data-testid="k1-cards">
        ${items.map((item, i) => html`<${ConnectionCard} key=${item.key} item=${item} index=${i} isNext=${!!next && next.key === item.key} />`)}
      </ul>
    </section>

    <${RealBuildNote} items=${[
      'A domain you own, and a host that answers on it with a security certificate',
      'A WhatsApp Business account verified with Meta, and message templates Meta has approved',
      'Google sign-in (OAuth) for your calendar and Gmail, set up by a developer',
      'A small server that receives your funnel\'s enquiries, checks the secret and stores them',
      'Your Meta Pixel and Google tag added to the pages, with a consent notice in front of them'
    ]} />
  </div>`;
}
