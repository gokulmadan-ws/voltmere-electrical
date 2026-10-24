// js/booking/confirmation.js: Confirmation screen (#booked/<ref>): enquiry thanks (his copy, ONE story), the WhatsApp handoff (V4), a suggested visit
// (a tagged IDEA with one status), optional photos, what happens next, DEMO panel; classic ticket for other jobs.
// Owner: WP3, rebuilt for the quote enquiry by D2, delight, photos, calendar and timeline by D3, one story and tagged ideas by FP (polish round 3)
import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { Icon, Button, Chip, Disclosure, PhoneMock, WhatsAppBubble, EmptyState, StorageNote, pageHref, pageTarget, copyText, cx } from '../ui/index.js';
import { downloadIcs } from '../core/ics.js';
import { bubbleActions, enquiryHandoff, reminderSendAt, waLink } from '../core/messages.js';
import { recallHandoff, rememberHandoff } from '../core/handoff.js';
import { selectBookingByRef, selectMessages, selectService, selectQuoteForBooking, quoteStatus } from '../core/selectors.js';
import { bookingWindowIds } from '../core/availability.js';
import { PROMISES, WINDOWS, EMERGENCY_REASONS } from '../core/config.js';
import { DAY_LONG, DAY_SHORT, MONTH_SHORT, fmtDayShort, stampDay, stampTime, weekdayOf } from '../core/dates.js';
import { nowStamp } from '../core/clock.js';
import { firstName } from '../core/format.js';
import { priceText } from './bk-shared.js';
import { FUNNEL_CONFIRM, FUNNEL_SERVICE_ID, replyHours } from './funnel.js';
import { PhotoCard } from './photos.js';
import { downloadVisitIcs, isProvisionalVisit } from './visit-ics.js';
import { ProtoTag, protoProps } from '../landing/idea.js';

const reasonLabel = (id) => (EMERGENCY_REASONS.find((r) => r.id === id) || { label: id }).label;

/** True for a website quote enquiry (service ev_quote). */
export const isEnquiry = (booking) => !!booking && booking.serviceId === FUNNEL_SERVICE_ID;

/** 'Mon 26 Oct, 8–10am' for the suggested or confirmed visit window, or '' when the booking has no window. (VisitCard uses visitWords, which has no dash.) */
export function visitWhen(booking) {
  const ids = bookingWindowIds(booking);
  if (!ids.length || !booking.start) return '';
  return `${fmtDayShort(stampDay(booking.start))}, ${WINDOWS[ids[0]].label}`;
}

/** The animated tick on the confirmation screen: a soft glow, the ring draws, the tick draws, a few sparks fly out. Drawn in its final state under reduced motion. */
export function Tick({ testid = 'confirmation-tick' }) {
  return html`<svg class="bk-tick" viewBox="0 0 96 96" width="96" height="96" aria-hidden="true" focusable="false" data-testid=${testid}>
    <circle class="bk-tick__glow" cx="48" cy="48" r="44" />
    <circle class="bk-tick__disc" cx="48" cy="48" r="34" />
    <circle class="bk-tick__ring" cx="48" cy="48" r="34" />
    <path class="bk-tick__check" d="M33 49.5l10.5 10.5L64 37" />
    <g class="bk-tick__sparks">${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => html`<g key=${a} transform=${`rotate(${a} 48 48)`}><line class="bk-tick__spark" x1="48" y1="5" x2="48" y2="11" /></g>`)}</g>
  </svg>`;
}

/** 'Mon 26 Oct, 8 to 10am': the visit's day and window in words (no dash), or '' when the booking has no window. */
export function visitWords(booking) {
  const ids = bookingWindowIds(booking);
  if (!ids.length || !booking.start) return '';
  return `${fmtDayShort(stampDay(booking.start))}, ${WINDOWS[ids[0]].label.replace(/\s*[\u2013-]\s*/, ' to ')}`;
}

/** A calendar-page tile: 'SAT', '24', 'OCT'. */
function DateTile({ day }) {
  return html`<span class="bk-datetile" aria-hidden="true">
    <span class="bk-datetile__wd">${DAY_SHORT[weekdayOf(day)]}</span>
    <span class="bk-datetile__day">${Number(day.slice(8))}</span>
    <span class="bk-datetile__mon">${MONTH_SHORT[Number(day.slice(5, 7)) - 1]}</span>
  </span>`;
}

/**
 * The visit, ONE card, ONE status. While Daniel has not confirmed it is an IDEA from us (his site offers no visit date): a data-proto card with the
 * "Idea from us" tag, "Earliest visit Daniel could offer", the day and window, and the single status "Daniel will confirm." (hidden under
 * "Only my content"). Once Daniel confirms it, it is his real appointment: no tag, "Your visit", "Confirmed", and Add to calendar.
 * Nothing here for an enquiry with no window (the diary was full) or a cancelled one: the headline already says Daniel will contact you.
 */
export function VisitCard({ booking, brand, settings, calendar = true }) {
  const when = visitWords(booking);
  if (!when || booking.status === 'cancelled') return null;
  const suggested = isProvisionalVisit(booking);
  const ok = booking.status === 'confirmed' || booking.status === 'on_the_way';
  const done = booking.status === 'done';
  const status = suggested ? `${brand.ownerFirst} will confirm.` : ok ? 'Confirmed.' : done ? 'Done.' : '';
  const props = suggested ? protoProps({ 'data-testid': 'confirmation-visit' }) : { 'data-testid': 'confirmation-visit' };
  return html`<section class=${cx('bk-visit', suggested ? 'is-suggested' : 'is-confirmed')} aria-label=${suggested ? 'Suggested visit' : 'Your visit'} ...${props}>
    ${suggested ? html`<${ProtoTag} class="bk-visit__tag" />` : null}
    <div class="bk-visit__head">
      <${DateTile} day=${stampDay(booking.start)} />
      <div class="bk-visit__main">
        <p class="bk-visit__kicker" data-testid="confirmation-visit-kicker">${suggested ? `Earliest visit ${brand.ownerFirst} could offer` : 'Your visit'}</p>
        <p class="bk-visit__when" data-testid="confirmation-visit-when">${when}</p>
        <p class=${cx('bk-visit__status', !suggested && 'is-ok')} data-testid="confirmation-pencilled">${!suggested ? html`<${Icon} name="calendar-check" size=${16} />${' '}` : null}<span>${status}</span></p>
      </div>
    </div>
    ${calendar && ok ? html`<div class="bk-visit__calwrap">
      <${Button} variant="secondary" size="md" icon="calendar-plus" class="bk-visit__cal" onClick=${() => downloadVisitIcs(booking, settings)} data-testid="add-to-calendar">Add to calendar<//>
      <p class="bk-visit__calnote" data-testid="add-to-calendar-note">Saved as confirmed.</p>
    </div>` : null}
  </section>`;
}

/** The reference card for an enquiry: the reference (with Copy), what it is, the postcode. The visit is its own card (VisitCard). */
function EnquiryTicket({ booking, testid, refTestid }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    const ok = await copyText(booking.ref);
    if (!ok) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  };
  return html`<div class="bk-ticket bk-ticket--big bk-ticket--pass bk-ticket--ref" data-testid=${testid}>
    <div class="bk-ticket__top">
      <div class="bk-ticket__id">
        <p class="bk-ticket__label">Your reference</p>
        <p class="bk-ticket__ref u-mono" data-testid=${refTestid}>${booking.ref}</p>
      </div>
      <button type="button" class=${cx('bk-copy', copied && 'is-copied')} onClick=${copy} aria-label=${copied ? 'Reference copied' : `Copy reference ${booking.ref}`} data-testid="confirmation-copy">
        <${Icon} name=${copied ? 'check' : 'copy'} size=${18} /><span class="bk-copy__text" aria-hidden="true">${copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
    <p class="bk-ticket__service">${booking.serviceName}${booking.address.postcode ? html`<span class="bk-ticket__variant">${' · '}${booking.address.postcode}</span>` : null}</p>
  </div>`;
}

/** The booking summary card used by Confirmation and Manage. `live` booking from the store. */
export function ConfirmTicket({ booking, service, brand, hours = 24, settings = null, calendar = false, testid = 'confirmation-ticket', refTestid = 'confirmation-ref' }) {
  if (isEnquiry(booking)) {
    return html`<${EnquiryTicket} booking=${booking} testid=${testid} refTestid=${refTestid} />`;
  }
  const ids = bookingWindowIds(booking);
  const win = ids.length ? WINDOWS[ids[0]] : null;
  const half = ids.length === 2;
  let when;
  if (booking.urgent) when = 'As soon as possible';
  else if (half) when = `${fmtDayShort(stampDay(booking.start))} · ${ids[0] === 0 ? 'morning' : 'afternoon'}, arrives ${win.arrive}`;
  else when = `${fmtDayShort(stampDay(booking.start))} · arrives ${win ? win.arrive : stampTime(booking.start)}`;
  const address = [booking.address.line1, booking.address.postcode].filter(Boolean).join(', ');
  const price = booking.urgent
    ? `${priceText(service, booking.quotedPrice)} · pay after the job`
    : `${priceText(service, booking.quotedPrice)}${service && (service.priceType === 'free' || service.priceType === 'quoted') ? '' : ' · pay after the job'}`;
  return html`<div class="bk-ticket bk-ticket--big" data-testid=${testid}>
    <p class="bk-ticket__ref u-mono" data-testid=${refTestid}>${booking.ref}</p>
    <p class="bk-ticket__service">${booking.serviceName}${booking.variantLabel ? html`<span class="bk-ticket__variant">${' · '}${booking.variantLabel}</span>` : null}</p>
    <p class="bk-ticket__when">${when}</p>
    ${booking.urgent && booking.emergencyReasons.length ? html`<p class="bk-ticket__sub">${booking.emergencyReasons.map(reasonLabel).join(', ')}</p>` : null}
    ${address ? html`<p class="bk-ticket__addr"><${Icon} name="map-pin" size=${16} />${' '}<span>${address}</span></p>` : null}
    <p class="bk-ticket__price">${price}</p>
  </div>`;
}

/**
 * The status pill (Manage, and the confirmation once Daniel has acted). Red is never a status. A new enquiry is simply "Received"; the visit has its own
 * single status inside its card (VisitCard), so the same slot is never described twice.
 */
export function statusChipFor(booking, brand) {
  switch (booking.status) {
    case 'new':
      if (isEnquiry(booking)) return { tone: 'neutral', icon: 'check', text: 'Received' };
      return { tone: 'warn', icon: 'clock', text: 'Awaiting confirmation' };
    case 'confirmed': return { tone: 'ok', icon: 'calendar-check', text: 'Confirmed' };
    case 'on_the_way': return { tone: 'accent', icon: 'navigation', text: `${brand.ownerFirst} is on the way` };
    case 'done': return { tone: 'neutral', icon: 'badge-check', text: 'Done' };
    default: return { tone: 'danger', icon: 'ban', text: 'Cancelled' };
  }
}

function titleFor(booking, first) {
  if (booking.status === 'cancelled') return `Cancelled, ${first}.`;
  if (booking.status === 'done') return `All done, ${first}.`;
  if (booking.urgent || booking.status === 'new') return `Request sent, ${first}.`;
  return `You're booked in, ${first}.`;
}

function reminderLabel(booking, remindersOn) {
  if (booking.urgent || !remindersOn) return '';
  const at = reminderSendAt(booking, booking.createdAt);
  if (!at) return '';
  return stampTime(at) === '07:00' ? 'Morning of the visit' : `${DAY_LONG[weekdayOf(stampDay(at))]} evening`;
}

/**
 * The enquiry's journey in five steps (his three, split a little). Done steps tick off live as the owner works. The suggested visit is NOT repeated
 * here (it has its own card); once Daniel has confirmed one, the step says so.
 */
export function enquiryJourney(booking, brand, hours, quote) {
  const st = booking.status;
  const when = visitWords(booking);
  const surveyOn = st === 'confirmed' || st === 'on_the_way' || st === 'done';
  const q = quote ? quoteStatus(quote, nowStamp()) : '';
  const quoteOut = q === 'sent' || q === 'viewed' || q === 'accepted';
  const items = [
    { id: 'received', when: 'Just now', text: `${brand.ownerFirst} has your enquiry`, done: true },
    { id: 'contact', when: `Within ${hours} hours`, text: `${brand.ownerFirst} reviews your details and contacts you to discuss your installation`, done: surveyOn || quoteOut },
    {
      id: 'survey',
      when: surveyOn ? 'Visit confirmed' : 'Photos or a visit',
      text: surveyOn && when ? `${when}, with ${brand.ownerFirst}` : 'Photos or a survey may be needed to prepare an accurate quote',
      done: st === 'done' || quoteOut
    },
    { id: 'quote', when: 'Your written quote', text: 'A clear quote for your charger, cable route and any electrical work, not a headline figure that changes later', done: quoteOut },
    { id: 'install', when: 'Your installation', text: 'Once you are happy with the agreed quote and scope, arrange a suitable installation date', done: q === 'accepted' }
  ];
  const current = items.findIndex((it) => !it.done);
  return items.map((it, i) => ({ ...it, current: i === current }));
}

/** What happens next: a vertical timeline whose marks tick off live. The first step not yet done pulses. */
export function JourneyTimeline({ items, testid, label = 'What happens next', hideLabel = false }) {
  return html`<div class="bk-block bk-journey">
    ${hideLabel ? null : html`<p class="bk-eyebrow">${label}</p>`}
    <ol class="bk-timeline" data-testid=${testid} aria-label=${label}>
      ${items.map((it) => html`<li key=${it.id} class=${cx('bk-timeline__item', it.done && 'is-done', it.current && 'is-current')} aria-current=${it.current ? 'step' : undefined} data-testid=${`journey-${it.id}`}>
        <span class="bk-timeline__mark" aria-hidden="true">${it.done ? html`<${Icon} name="check" size=${14} />` : null}</span>
        <span class="bk-timeline__body"><span class="bk-timeline__when">${it.when}</span><span class="bk-timeline__text">${it.text}</span></span>
      </li>`)}
    </ol>
  </div>`;
}

/** The quote the owner has sent for this enquiry (a sample, from the owner's dashboard), when there is one the customer can open. */
export function QuoteNote({ state, booking, brand }) {
  const quote = selectQuoteForBooking(state, booking.id);
  if (!quote) return null;
  const q = quoteStatus(quote, nowStamp());
  if (q !== 'sent' && q !== 'viewed' && q !== 'accepted') return null;
  return html`<div class="bk-quote" data-testid="quote-note">
    <span class="bk-quote__icon" aria-hidden="true"><${Icon} name="file-text" size=${22} /></span>
    <div class="bk-quote__text">
      <p class="bk-quote__title">${q === 'accepted' ? 'You accepted your quote' : 'Your quote is ready'}</p>
      <p class="bk-quote__sub">Written by ${brand.ownerFirst} for your home.${' '}<span data-proto="true">Prototype: sample quote.</span></p>
    </div>
    <${Button} variant="primary" size="md" class="bk-pill" href=${pageHref('quote.html', '#q=' + quote.id)} target=${pageTarget('quote.html')} data-testid="quote-open">${q === 'accepted' ? 'View' : 'View my quote'}<//>
  </div>`;
}

function Timeline({ booking, brand, remindersOn }) {
  let items;
  if (booking.urgent) {
    items = [
      { when: 'Now', text: `${brand.ownerFirst} has been alerted`, done: true },
      { when: `Within ${PROMISES.emergencyReplyMinutes} minutes`, text: 'A reply with an arrival time' },
      { when: `If you haven't heard in ${PROMISES.emergencyCallAfterMinutes} minutes`, text: `Call ${brand.phone}` }
    ];
  } else {
    const rem = reminderLabel(booking, remindersOn);
    items = [
      { when: 'Just now', text: `${brand.ownerFirst} has your booking`, done: true },
      rem ? { when: rem, text: 'Reminder text with your arrival window' } : null,
      { when: 'On the day', text: `A message when ${brand.ownerFirst} is ${PROMISES.awayMinutes} minutes away` },
      { when: 'After the job', text: 'Certificate and receipt, then a quick review request' }
    ].filter(Boolean);
  }
  return html`<div class="bk-block">
    <p class="bk-eyebrow">What happens next</p>
    <ol class="bk-timeline" data-testid="confirmation-timeline">
      ${items.map((it, i) => html`<li key=${i} class=${'bk-timeline__item' + (it.done ? ' is-done' : '')}>
        <span class="bk-timeline__mark" aria-hidden="true">${it.done ? html`<${Icon} name="check" size=${14} />` : null}</span>
        <span class="bk-timeline__body"><span class="bk-timeline__when">${it.when}</span><span class="bk-timeline__text">${it.text}</span></span>
      </li>`)}
    </ol>
  </div>`;
}

function SafetyLines() {
  return html`<ol class="bk-safety">
    <li>Fire, or someone has had a shock: call 999.</li>
    <li>If it is safe, switch off at the fuse box (consumer unit).</li>
    <li>Do not touch anything wet, scorched or sparking.</li>
  </ol>`;
}

/**
 * V4: the REAL way this enquiry reaches Daniel's phone in the prototype. A wa.me link opens the customer's own WhatsApp with their details written
 * out and a dashboard link at the end (docs/V4-HANDOFF.md); they tap send themselves. The page cannot know whether they did, so it says "opened",
 * never "sent". The one-line note under the button is data-proto (a live build does this silently through the funnel's webhook); the button is not,
 * because it is the transport and must keep working in a clean preview. It is the page's one filled button (the photo prompt below is drawn quiet).
 */
function WhatsAppSendCard({ booking, state, brand }) {
  const [opened, setOpened] = useState(() => recallHandoff('enq', booking.ref));
  const handoff = enquiryHandoff(booking, state);
  if (!handoff.ok) return null;
  const onOpen = () => {
    rememberHandoff('enq', booking.ref, {});
    setOpened(recallHandoff('enq', booking.ref) || { at: nowStamp() });
  };
  const label = `Send my enquiry to ${brand.ownerFirst} on WhatsApp`;
  const when = opened && opened.at ? `${fmtDayShort(stampDay(opened.at))} at ${stampTime(opened.at)}` : '';
  return html`<section class=${cx('bk-wa', opened && 'is-opened')} aria-labelledby="bk-wa-title" data-testid="wa-send-card" data-state=${opened ? 'opened' : 'ready'}>
    <div class="bk-wa__head">
      <span class="bk-wa__icon" aria-hidden="true"><${Icon} name=${opened ? 'check' : 'whatsapp'} size=${24} /></span>
      <div class="bk-wa__main">
        <h3 class="bk-wa__title" id="bk-wa-title" data-testid="wa-send-title">${opened ? 'Opened in WhatsApp' : `Send it to ${brand.ownerFirst} on WhatsApp`}</h3>
        <p class="bk-wa__text" data-testid="wa-send-text">${opened
          ? `You opened WhatsApp on ${when}. Press send there if you have not yet, so ${brand.ownerFirst} gets your details on his phone.`
          : `Your enquiry is saved on this phone. This opens WhatsApp with your details already written: press send and ${brand.ownerFirst} sees it on his phone.`}</p>
      </div>
    </div>
    <${Button} variant=${opened ? 'secondary' : 'primary'} size="lg" block icon="whatsapp" href=${handoff.url} onClick=${onOpen} data-testid=${opened ? 'wa-send-again' : 'wa-send'}>${opened ? 'Open WhatsApp again' : label}<//>
    <p class="bk-wa__note" data-proto="true" data-testid="wa-send-note">In your live site this happens automatically through your funnel's webhook.</p>
  </section>`;
}

function DemoPanel({ booking, state, brand, ownerMsg, custMsgs }) {
  const stamp = nowStamp();
  const actions = bubbleActions(ownerMsg, booking, stamp).map((a) => ({ id: a.id, label: a.label }));
  const enquiry = isEnquiry(booking);
  return html`<section class="bk-demo" data-testid="demo-panel" aria-labelledby="bk-demo-title">
    <p class="bk-demo__tag">DEMO · SIMULATED</p>
    <h3 class="bk-demo__title" id="bk-demo-title">On ${brand.ownerFirst}'s phone, just now</h3>
    <p class="bk-demo__sub">This is what a live build puts on ${brand.ownerFirst}'s WhatsApp the moment you submit, with no tapping. Here it is a simulation: ${brand.ownerFirst} only gets your enquiry when you send the WhatsApp message from the card above.</p>
    <${PhoneMock} title=${enquiry ? 'New enquiries' : brand.shortName + ' bookings'} subtitle=${brand.ownerFirst + "'s phone (simulated)"}>
      <${WhatsAppBubble} direction="in" body=${ownerMsg.body} time=${stampTime(ownerMsg.at)} stateLabel="Sent (simulated)" actions=${actions} onAction=${() => {}} data-testid="demo-owner-bubble" />
    <//>
    ${custMsgs.map((m, i) => html`<div key=${m.id}><p class="bk-eyebrow bk-demo__label">${i === 0 ? 'What you received' : `Then, when ${brand.ownerFirst} confirmed`}</p>
    <${PhoneMock} title=${brand.name} subtitle=${firstName(booking.customer.name) + "'s phone (simulated)"}>
      <${WhatsAppBubble} direction="out" body=${m.body} time=${stampTime(m.at)} stateLabel="Sent (simulated)" data-testid=${i === 0 ? 'demo-customer-bubble' : `demo-customer-bubble-${i}`} />
    <//></div>`)}
    <${Button} variant="secondary" size="lg" block iconRight="arrow-right" href=${pageHref('dashboard.html', '#/bookings/' + booking.id)} target=${pageTarget('dashboard.html')} data-testid="demo-open-dashboard">Open ${brand.ownerFirst}'s dashboard<//>
  </section>`;
}

/**
 * The whole prototype demo behind ONE dashed button: the customer's screen stays a clean thank-you, and "Prototype" and
 * "Simulated" appear only here. Closed until tapped; the two phone mocks are drawn only while it is open.
 */
function DemoDisclosure({ booking, state, brand }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const msgs = selectMessages(state, { bookingId: booking.id });
  const ownerMsg = msgs.find((m) => m.kind === 'owner_new_booking' || m.kind === 'owner_emergency');
  if (!ownerMsg) return null;
  // Oldest first: what the customer got when they booked, then (live) what they got when the owner confirmed.
  const custMsgs = [...msgs].reverse().filter((m) => ['customer_confirmed', 'customer_received', 'customer_emergency_received'].includes(m.kind));
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) setTimeout(() => { if (box.current && box.current.scrollIntoView) box.current.scrollIntoView({ block: 'start', behavior: 'auto' }); }, 30);
  };
  return html`<div class="bk-demo-wrap" ref=${box} data-proto="true">
    <button type="button" class=${cx('bk-demo-toggle', open && 'is-open')} aria-expanded=${open ? 'true' : 'false'} aria-controls="bk-demo-body" onClick=${toggle} data-proto="true" data-testid="demo-toggle">
      <${Icon} name="smartphone" size=${20} /><span class="bk-demo-toggle__text">See what ${brand.ownerFirst}'s phone just received</span><${Icon} name=${open ? 'chevron-up' : 'chevron-down'} size=${20} />
    </button>
    <div id="bk-demo-body">${open ? html`<${DemoPanel} booking=${booking} state=${state} brand=${brand} ownerMsg=${ownerMsg} custMsgs=${custMsgs} />` : null}</div>
  </div>`;
}

/**
 * His thank-you page, ONE story. Top to bottom: the green tick, his headline and his paragraph, the reference, the WhatsApp send card (the page's one
 * filled action), the suggested visit (a tagged IDEA with one status, or Daniel's confirmed visit), "Add photos" and "What happens next" as closed
 * rows, Call, the prototype demo behind one dashed button, and a plain ending (Done as a real button, Change or cancel as a quiet link).
 */
function EnquiryConfirmation({ ctx, booking }) {
  const { state, brand, go, close } = ctx;
  const cancelled = booking.status === 'cancelled';
  const hours = replyHours(state);
  const quote = selectQuoteForBooking(state, booking.id);
  // ONE status at a time. A new enquiry needs no pill (the headline says it was received, and the visit card says "Daniel will confirm."); once Daniel
  // confirms the visit, the visit card says so and moves to the top, so the pill stays away; it speaks only for what the card cannot (on the way, cancelled).
  // The live region stays so a change is announced.
  const hasVisit = !!visitWords(booking) && !cancelled;
  const visitSaysIt = hasVisit && (booking.status === 'confirmed' || booking.status === 'done');
  const chip = booking.status === 'new' || visitSaysIt ? null : statusChipFor(booking, brand);
  const confirmed = hasVisit && booking.status === 'confirmed';
  const visit = cancelled ? null : html`<${VisitCard} booking=${booking} brand=${brand} settings=${state.settings} />`;
  return html`<div class="bk-step bk-confirm bk-confirm--enquiry" data-testid="confirmation">
    <div class="bk-confirm__art"><${Tick} /></div>
    <div class="bk-titleblock bk-titleblock--center">
      <h2 class="bk-title" tabindex="-1" data-bk-title="true" data-testid="confirmation-title">${cancelled ? 'This enquiry was cancelled.' : FUNNEL_CONFIRM.title}</h2>
      ${cancelled ? null : html`<p class="bk-sub bk-confirm__lead" data-testid="confirmation-lead">${FUNNEL_CONFIRM.body(brand.ownerFirst, hours)}</p>`}
    </div>
    <div class="bk-confirm__status" role="status" aria-live="polite">
      ${chip ? html`<${Chip} tone=${chip.tone} icon=${chip.icon} data-testid="confirmation-status">${chip.text}<//>` : null}
    </div>
    <${ConfirmTicket} booking=${booking} brand=${brand} />
    <${QuoteNote} state=${state} booking=${booking} brand=${brand} />
    ${confirmed ? visit : null}
    ${cancelled ? null : html`<${WhatsAppSendCard} booking=${booking} state=${state} brand=${brand} />`}
    <${StorageNote} where="confirmation" phone=${brand.phone} />
    ${confirmed ? null : visit}
    ${cancelled ? null : html`<div class="bk-accs">
      <${Disclosure} class="bk-acc bk-acc--photos" testid="funnel-ready-box" title=${html`<span class="bk-acc__title"><${Icon} name="camera" size=${20} />Add photos<span class="bk-acc__opt">Optional</span></span>`}>
        <${PhotoCard} booking=${booking} brand=${brand} compact=${true} prompt=${FUNNEL_CONFIRM.ready(brand.ownerFirst)} />
      <//>
      <${Disclosure} class="bk-acc" testid="journey-box" title=${html`<span class="bk-acc__title"><${Icon} name="list-checks" size=${20} />What happens next</span>`}>
        <${JourneyTimeline} items=${enquiryJourney(booking, brand, hours, quote)} testid="confirmation-timeline" hideLabel=${true} />
      <//>
    </div>`}
    <div class="bk-confirm__help">
      <p class="bk-confirm__helptext">Prefer to speak to us?</p>
      <${Button} variant="secondary" size="md" class="bk-pill bk-callbtn" icon="phone" href=${brand.telHref} data-testid="confirmation-call">Call ${brand.phone}<//>
    </div>
    <${DemoDisclosure} booking=${booking} state=${state} brand=${brand} />
    <div class="bk-confirm__end">
      <${Button} variant="secondary" size="lg" block class="bk-pill bk-done" onClick=${() => close()} data-testid="confirmation-done">Done<//>
      <button type="button" class="bk-quietlink" onClick=${() => go({ manageRef: booking.ref })} data-testid="confirmation-manage">Change or cancel</button>
    </div>
  </div>`;
}

export function Confirmation({ ctx, refId }) {
  const { state, brand, go, close } = ctx;
  const booking = selectBookingByRef(state, refId);
  if (!booking) {
    return html`<div class="bk-step" data-testid="confirmation">
      <${EmptyState} icon="calendar-x" title="We couldn't find that reference" body=${`Check the reference, or call ${brand.ownerFirst} on ${brand.phone}.`}
        action=${html`<div class="bk-contact"><${Button} variant="primary" class="bk-pill" onClick=${() => go({})}>Get my installation quote<//><${Button} icon="phone" href=${brand.telHref}>Call ${brand.ownerFirst}<//></div>`} />
    </div>`;
  }
  if (isEnquiry(booking)) return html`<${EnquiryConfirmation} ctx=${ctx} booking=${booking} />`;
  const service = selectService(state, booking.serviceId);
  const first = firstName(booking.customer.name);
  const chip = statusChipFor(booking, brand);
  const ids = bookingWindowIds(booking);
  const arriveLabel = ids.length ? WINDOWS[ids[0]].label : '';
  const waText = booking.urgent
    ? `Hi ${brand.ownerFirst}, it's ${first}, emergency request ${booking.ref}.`
    : `Hi ${brand.ownerFirst}, it's ${first}, booking ${booking.ref} for ${fmtDayShort(stampDay(booking.start))} ${arriveLabel}.`;
  return html`<div class="bk-step bk-confirm" data-testid="confirmation">
    <div class="bk-confirm__art"><${Tick} /></div>
    <div class="bk-titleblock bk-titleblock--center">
      <h2 class="bk-title" tabindex="-1" data-bk-title="true" data-testid="confirmation-title">${titleFor(booking, first)}</h2>
    </div>
    <div class="bk-confirm__status" role="status" aria-live="polite">
      <${Chip} tone=${chip.tone} icon=${chip.icon} data-testid="confirmation-status">${chip.text}<//>
    </div>
    <${ConfirmTicket} booking=${booking} service=${service} brand=${brand} />
    ${booking.urgent ? html`<${SafetyLines} />` : null}
    <${Timeline} booking=${booking} brand=${brand} remindersOn=${state.settings.remindersOn} />
    <div class="bk-actions">
      ${booking.urgent ? null : html`<${Button} variant="secondary" size="lg" block icon="download" onClick=${() => downloadIcs(booking, state.settings)} data-testid="add-to-calendar">Add to calendar<//>`}
      <${Button} variant="secondary" size="lg" block icon="message-circle" href=${waLink(brand.phone, waText, brand.demoPhoneDigits)} data-testid="confirmation-whatsapp">Message ${brand.ownerFirst} on WhatsApp<//>
      <${Button} variant="secondary" size="lg" block icon="phone" href=${brand.telHref} data-testid="confirmation-call">Call ${brand.ownerFirst}<//>
      <div class="bk-actions__links">
        <button type="button" class="bk-linkbtn" onClick=${() => go({ manageRef: booking.ref })} data-testid="confirmation-manage">Change or cancel</button>
        <button type="button" class="bk-linkbtn" onClick=${() => close()} data-testid="confirmation-done">Done</button>
      </div>
    </div>
    <${DemoDisclosure} booking=${booking} state=${state} brand=${brand} />
  </div>`;
}
