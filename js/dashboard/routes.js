// js/dashboard/routes.js: the dashboard route table (exact, contract 11.2).
// Owner: WP2
export const ROUTES = [
  { name: 'today',     pattern: '/today',             module: './views/today.js',     title: 'Today',       tab: 'today' },
  { name: 'calendar',  pattern: '/calendar/:date?',   module: './views/calendar.js',  title: 'Calendar',    tab: 'calendar' },
  { name: 'bookings',  pattern: '/bookings/:id?',     module: './views/bookings.js',  title: 'Bookings',    tab: 'bookings' },
  { name: 'customers', pattern: '/customers/:key?',   module: './views/customers.js', title: 'Customers',   tab: 'bookings' },
  { name: 'insights',  pattern: '/insights',          module: './views/insights.js',  title: 'Insights',    tab: 'insights' },
  { name: 'messages',  pattern: '/messages',          module: './views/messages.js',  title: 'Messages',    tab: 'more' },
  { name: 'new',       pattern: '/new',               module: './views/new.js',       title: 'New booking', tab: null },
  { name: 'more',      pattern: '/more',              module: './views/more.js',      title: 'More',        tab: 'more' },
  { name: 'settings',  pattern: '/settings',          module: './views/settings.js',  title: 'Settings',    tab: 'more' },
  { name: 'demo',      pattern: '/demo',              module: './views/demo.js',      title: 'Demo tools',  tab: 'more' },
  { name: 'about',     pattern: '/about',             module: './views/about.js',     title: "What's real", tab: 'more' }
];
export const DEFAULT_ROUTE = '#/today';
