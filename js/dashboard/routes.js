// js/dashboard/routes.js: the dashboard route table (contract 11.2, extended by docs/V3-SPEC.md section 1 and docs/V3-UI.md).
// Owner: B3 (was WP2)
//
// Route NAME = view file basename. `tab` is the bottom-tab (and More) slot that stays highlighted. `immersive` hides the tab bar and
// the FAB (true) or does so only when the named param is present (a string): a sticky action bar sits at the bottom instead.
// A route whose view file does not exist yet loads views/stub.js (see shell.js), so every route below always opens.
export const ROUTES = [
  { name: 'today',     pattern: '/today',             module: './views/today.js',     title: 'Today',       tab: 'today' },
  { name: 'calendar',  pattern: '/calendar/:date?',   module: './views/calendar.js',  title: 'Calendar',    tab: 'calendar' },
  { name: 'bookings',  pattern: '/bookings/:id?',     module: './views/bookings.js',  title: 'Bookings',    tab: 'bookings', immersive: 'id' },
  { name: 'customers', pattern: '/customers/:key?',   module: './views/customers.js', title: 'Customers',   tab: 'bookings', immersive: 'key' },
  { name: 'insights',  pattern: '/insights',          module: './views/insights.js',  title: 'Insights',    tab: 'insights' },
  { name: 'messages',  pattern: '/messages',          module: './views/messages.js',  title: 'Messages',    tab: 'more' },
  { name: 'new',       pattern: '/new',               module: './views/new.js',       title: 'New booking', tab: null, immersive: true },
  { name: 'more',      pattern: '/more',              module: './views/more.js',      title: 'More',        tab: 'more' },
  { name: 'settings',  pattern: '/settings',          module: './views/settings.js',  title: 'Settings',    tab: 'more' },
  { name: 'demo',      pattern: '/demo',              module: './views/demo.js',      title: 'Demo tools',  tab: 'more' },
  { name: 'about',     pattern: '/about',             module: './views/about.js',     title: "What's real", tab: 'more' },
  // ---- V3 ----
  { name: 'pipeline',             pattern: '/pipeline',             module: './views/pipeline.js',             title: 'Pipeline',          tab: 'bookings' },
  { name: 'quotes',               pattern: '/quotes',               module: './views/quotes.js',               title: 'Quotes',            tab: 'more' },
  { name: 'quote-detail',         pattern: '/quotes/:id',           module: './views/quote-detail.js',         title: 'Quote',             tab: 'more', immersive: true },
  { name: 'connections',          pattern: '/connections',          module: './views/connections.js',          title: 'Connections',       tab: 'more' },
  { name: 'connections-domain',   pattern: '/connections/domain',   module: './views/connections-domain.js',   title: 'Your domain',       tab: 'more', immersive: true },
  { name: 'connections-webhook',  pattern: '/connections/webhook',  module: './views/connections-webhook.js',  title: 'Website webhook',   tab: 'more' },
  { name: 'connections-tracking', pattern: '/connections/tracking', module: './views/connections-tracking.js', title: 'Ad tracking',       tab: 'more' },
  { name: 'connections-whatsapp', pattern: '/connections/whatsapp', module: './views/connections-whatsapp.js', title: 'WhatsApp',          tab: 'more', immersive: true },
  { name: 'connections-calendar', pattern: '/connections/calendar', module: './views/connections-calendar.js', title: 'Google Calendar',   tab: 'more', immersive: true },
  { name: 'connections-email',    pattern: '/connections/email',    module: './views/connections-email.js',    title: 'Gmail',             tab: 'more', immersive: true },
  { name: 'share',                pattern: '/share',                module: './views/share.js',                title: 'Share and promote', tab: 'more' }
];
export const DEFAULT_ROUTE = '#/today';

/** The table entry for a route name (the first entry, today, when the name is unknown). */
export function routeMeta(name) {
  return ROUTES.find((r) => r.name === name) || ROUTES[0];
}
