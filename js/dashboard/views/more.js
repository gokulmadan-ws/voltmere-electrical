// js/dashboard/views/more.js: More hub, the list of secondary screens plus the Appearance (theme) control.
// Owner: WP8
import { html } from '../../vendor/preact-htm.js';
import { Icon, PageHeader, PrototypeNotice, ThemeToggle, pageHref, pageTarget, useStore } from '../../ui/index.js';
import { selectUnreadMessageCount } from '../../core/selectors.js';
import { routeHref } from '../router.js';

export const title = 'More';
export const css = ['css/settings.css'];

const selectUnread = (state) => selectUnreadMessageCount(state);

/** One 56px row: icon, label (with an optional one-line hint), optional unread count, chevron. */
function Row({ icon, label, hint, href, testid, count = 0, external = false }) {
  const attrs = external ? { target: pageTarget('index.html') } : {};
  return html`<a class="db-list__item st-row" href=${href} data-testid=${testid} ...${attrs}>
    <span class="st-row__icon"><${Icon} name=${icon} size=${22} /></span>
    <span class="st-row__text">
      <span class="st-row__label">${label}</span>
      ${hint ? html`<span class="st-row__hint">${hint}</span>` : null}
    </span>
    ${count > 0 ? html`<span class="st-row__count" aria-hidden="true">${count}</span><span class="u-sr-only">${`${count} new`}</span>` : null}
    <${Icon} name=${external ? 'external-link' : 'chevron-right'} size=${20} class="st-row__chev" />
  </a>`;
}

export default function MoreView() {
  const unread = useStore(selectUnread);
  return html`<div class="db-page">
    <${PageHeader} title="More" />
    <nav class="db-list" aria-label="More screens" data-testid="more-list">
      <${Row} icon="message-circle" label="Messages" hint="WhatsApp outbox (simulated)" href=${routeHref('messages')} testid="more-messages" count=${unread} />
      <${Row} icon="users" label="Customers" hint="Everyone you have worked for" href=${routeHref('customers')} testid="more-customers" />
      <${Row} icon="settings" label="Settings" hint="Business, prices, hours and rules" href=${routeHref('settings')} testid="more-settings" />
      <${Row} icon="gauge" label="Demo tools" hint="Your phone number, sample bookings, reset" href=${routeHref('demo')} testid="more-demo" />
      <${Row} icon="shield-check" label="What's real in this prototype" hint="What works, what is simulated" href=${routeHref('about')} testid="more-about" />
      <${Row} icon="external-link" label="View customer site" hint="Opens in the other tab" href=${pageHref('index.html')} testid="more-site" external />
    </nav>

    <section class="db-section st-appearance" aria-labelledby="more-appearance">
      <h2 class="db-section__title" id="more-appearance">Appearance</h2>
      <${ThemeToggle} variant="segmented" />
    </section>

    <section class="db-section">
      <${PrototypeNotice} variant="footer" page="dashboard" />
    </section>
  </div>`;
}
