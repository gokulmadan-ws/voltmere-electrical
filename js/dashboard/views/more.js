// js/dashboard/views/more.js: More hub, rows for the sales tools, set-up screens and about screens, each with a live count or status.
// Owner: E3 (v1 by WP8)
import { html } from '../../vendor/preact-htm.js';
import { BrandMark, Icon, PageHeader, PrototypeNotice, StatusDot, ThemeToggle, pageHref, pageTarget, useStore } from '../../ui/index.js';
import {
  selectBrand, selectConnectionsSummary, selectCustomers, selectPipeline, selectQuoteStats, selectUnreadMessageCount
} from '../../core/selectors.js';
import { gbp, plural } from '../../core/format.js';
import { routeHref } from '../router.js';

export const title = 'More';
export const css = ['css/settings.css'];

const selectAll = (state) => state;

/** One 56px row: icon, label, a one-line live status, an optional count chip, chevron. */
function Row({ icon, label, hint, href, testid, count = 0, countLabel = 'new', quiet = false, external = false, children }) {
  const attrs = external ? { target: pageTarget('index.html') } : {};
  return html`<a class="db-list__item st-row" href=${href} data-testid=${testid} ...${attrs}>
    <span class="st-row__icon"><${Icon} name=${icon} size=${22} /></span>
    <span class="st-row__text">
      <span class="st-row__label">${label}</span>
      ${hint ? html`<span class="st-row__hint">${hint}</span>` : null}
      ${children}
    </span>
    ${count > 0 ? html`<span class=${`st-row__count${quiet ? ' st-row__count--quiet' : ''}`} aria-hidden="true">${count}</span><span class="u-sr-only">${`${count} ${countLabel}`}</span>` : null}
    <${Icon} name=${external ? 'external-link' : 'chevron-right'} size=${20} class="st-row__chev" />
  </a>`;
}

function Group({ title: heading, id, testid, children }) {
  return html`<section class="st-group" aria-labelledby=${`more-${id}`}>
    <h2 class="st-group__title" id=${`more-${id}`}>${heading}</h2>
    <nav class="db-list" aria-label=${heading} data-testid=${testid}>${children}</nav>
  </section>`;
}

export default function MoreView() {
  const state = useStore(selectAll);
  const brand = selectBrand(state);
  const unread = selectUnreadMessageCount(state);
  const pipeline = selectPipeline(state);
  const quotes = selectQuoteStats(state, 'all');
  const connections = selectConnectionsSummary(state);
  const customers = selectCustomers(state);
  const open = pipeline.stages.filter((s) => s.id !== 'done').reduce((t, s) => t + s.count, 0);
  const connected = connections.filter((c) => c.status === 'connected').length;
  const pending = connections.filter((c) => c.status === 'pending').length;
  const items = (state.settings.quoteItems || []).length;
  const replyHours = state.settings.sla ? state.settings.sla.replyHours : 24;
  const demoDigits = state.settings.demoPhoneDigits || '';
  const connHint = pending > 0 ? `${connected} of ${connections.length} set up · ${pending} waiting` : `${connected} of ${connections.length} set up`;

  return html`<div class="db-page st-more">
    <${PageHeader} title="More" />

    <section class="st-biz" aria-label="Your business" data-testid="more-business">
      <${BrandMark} size=${48} />
      <div class="st-biz__text">
        <p class="st-biz__name">${brand.name}</p>
        <p class="st-biz__line">${brand.phone} · ${brand.email}</p>
      </div>
      <a class="st-biz__edit ui-link" href=${routeHref('settings')}>Edit</a>
    </section>

    <div data-testid="more-list">
      <${Group} title="Sales" id="sales" testid="more-sales">
        <${Row} icon="list-checks" label="Pipeline" href=${routeHref('pipeline')} testid="more-pipeline" count=${open} countLabel="open" quiet
          hint=${pipeline.openValue > 0 ? `${plural(open, 'job')} open · ${gbp(pipeline.openValue)} in play` : 'Enquiry to install, stage by stage'} />
        <${Row} icon="file-text" label="Quotes" href=${routeHref('quotes')} testid="more-quotes" count=${quotes.waitingCount} countLabel="waiting on customers" quiet
          hint=${quotes.waitingCount > 0 ? `${quotes.waitingCount} waiting on customers · ${gbp(quotes.waitingValue)}` : quotes.draftCount > 0 ? `${plural(quotes.draftCount, 'draft')} to finish` : 'Build, send and track written quotes'} />
        <${Row} icon="message-circle" label="Messages" hint="WhatsApp and email outbox (simulated)" href=${routeHref('messages')} testid="more-messages" count=${unread} />
        <${Row} icon="users" label="Customers" hint=${customers.length > 0 ? `${plural(customers.length, 'customer')} you have worked for` : 'Everyone you have worked for'} href=${routeHref('customers')} testid="more-customers" />
      <//>

      <${Group} title="Set up" id="setup" testid="more-setup">
        <${Row} icon="plug-zap" label="Connections" href=${routeHref('connections')} testid="more-connections" hint=${`${connHint} (simulated)`}>
          <span class="st-dots" data-testid="more-connections-dots">
            ${connections.map((c) => html`<${StatusDot} key=${c.key} status=${c.status} label=${`${c.title}: ${c.label}`} />`)}
          </span>
        <//>
        <${Row} icon="share-2" label="Share and promote" hint="QR code, tracked links and a printable card" href=${routeHref('share')} testid="more-share" />
        <${Row} icon="settings" label="Settings" hint=${`${plural(items, 'price-list item')} · replies within ${replyHours} h`} href=${routeHref('settings')} testid="more-settings" />
      <//>

      <${Group} title="About this prototype" id="about" testid="more-about-group">
        <${Row} icon="gauge" label="Demo tools" hint=${demoDigits ? `WhatsApp links open +${demoDigits}` : 'Sample enquiries, quotes and a reset'} href=${routeHref('demo')} testid="more-demo" />
        <${Row} icon="shield-check" label="What's real" hint="What works, what is simulated" href=${routeHref('about')} testid="more-about" />
        <${Row} icon="external-link" label="View customer site" hint="Opens in the other tab" href=${pageHref('index.html')} testid="more-site" external />
      <//>
    </div>

    <section class="db-section st-appearance" aria-labelledby="more-appearance">
      <h2 class="db-section__title" id="more-appearance">Appearance</h2>
      <${ThemeToggle} variant="segmented" />
    </section>

    <section class="db-section">
      <${PrototypeNotice} variant="footer" page="dashboard" />
    </section>
  </div>`;
}
