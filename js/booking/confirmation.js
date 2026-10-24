// js/booking/confirmation.js: Confirmation screen (#booked/<ref>): enquiry thanks (his copy), pencilled survey, photos, timeline, DEMO panel; classic ticket for other jobs.
// Owner: WP3, rebuilt for the quote enquiry by D2, delight, photos, calendar and timeline by D3
import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { Icon, Button, Chip, PhoneMock, WhatsAppBubble, EmptyState, pageHref, pageTarget, copyText, cx } from '../ui/index.js';
import { downloadIcs } from '../core/ics.js';
import { bubbleActions, reminderSendAt, waLink } from '../core/messages.js';
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

const reasonLabel = (id) => (EMERGENCY_REASONS.find((r) => r.id === id) || { label: id }).label;

/** True for a website quote enquiry (service ev_quote). */
export const isEnquiry = (booking) => !!booking && booking.serviceId === FUNNEL_SERVICE_ID;

/** 'Mon 26 Oct, 8–10am' for the pencilled or confirmed survey window, or '' when the booking has no window. */
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

/** The survey-visit sentence for an enquiry, by status. '' when there is nothing to say (no window, cancelled). */
function visitSentence(booking, brand, hours) {
  const when = visitWhen(booking);
  if (booking.status === 'cancelled') return '';
  // The diary was full, so the enquiry is kept without a window and the owner places it.
  if (!when) return booking.status === 'new' ? `${brand.ownerFirst} will be in touch within ${hours} hours to arrange your free survey visit.` : '';
  if (booking.status === 'new') {
    return booking.tentative !== false
      ? `We've pencilled in a free survey visit for ${when}. It's provisional until ${brand.ownerFirst} confirms.`
      : `Your free survey visit is requested for ${when}. ${brand.ownerFirst} will confirm it.`;
  }
  return `Your free survey visit is confirmed for ${when}.`;
}

/** A calendar-page tile: 'SAT', '24', 'OCT'. */
function DateTile({ day }) {
  return html`<span class="bk-datetile" aria-hidden="true">
    <span class="bk-datetile__wd">${DAY_SHORT[weekdayOf(day)]}</span>
    <span class="bk-datetile__day">${Number(day.slice(8))}</span>
    <span class="bk-datetile__mon">${MONTH_SHORT[Number(day.slice(5, 7)) - 1]}</span>
  </span>`;
}

/** The pencilled-in (or confirmed) survey visit: date tile, provisional or confirmed pill, his sentence, and add-to-calendar. */
function VisitBlock({ booking, brand, hours, settings, calendar }) {
  const sentence = visitSentence(booking, brand, hours);
  if (!sentence) return null;
  const when = visitWhen(booking);
  const provisional = isProvisionalVisit(booking);
  const ids = bookingWindowIds(booking);
  const arrive = ids.length ? WINDOWS[ids[0]].arrive : '';
  return html`<div class=${cx('bk-visit', provisional && 'is-provisional')} data-testid="confirmation-visit">
    ${when ? html`<div class="bk-visit__head">
      <${DateTile} day=${stampDay(booking.start)} />
      <div class="bk-visit__main">
        <p class="bk-visit__kicker">Free survey visit</p>
        <p class="bk-visit__when">${when}</p>
        <p class="bk-visit__arrive">Arriving ${arrive}</p>
        <span class=${cx('bk-pill-tag', provisional ? 'bk-pill-tag--warn' : 'bk-pill-tag--ok')} data-testid="confirmation-visit-tag"><${Icon} name=${provisional ? 'clock' : 'check'} size=${14} />${' '}<span>${provisional ? 'Provisional' : 'Confirmed'}</span></span>
      </div>
    </div>` : null}
    <p class="bk-visit__sentence" data-testid="confirmation-pencilled">${sentence}</p>
    ${calendar && when ? html`<div class="bk-visit__calwrap">
      <${Button} variant="secondary" size="md" icon="calendar-plus" class="bk-visit__cal" onClick=${() => downloadVisitIcs(booking, settings)} data-testid="add-to-calendar">Add to calendar<//>
      <p class="bk-visit__calnote" data-testid="add-to-calendar-note">${provisional ? `Saved as provisional until ${brand.ownerFirst} confirms.` : 'Saved as confirmed.'}</p>
    </div>` : null}
  </div>`;
}

/** Reference card for an enquiry: reference, what it is, postcode, the (provisional) survey visit. */
function EnquiryTicket({ booking, service, brand, hours, settings, testid, refTestid, showAlert, calendar }) {
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
  return html`<div class="bk-ticket bk-ticket--big bk-ticket--pass" data-testid=${testid}>
    <div class="bk-ticket__top">
      <div class="bk-ticket__id">
        <p class="bk-ticket__label">Your reference</p>
        <p class="bk-ticket__ref u-mono" data-testid=${refTestid}>${booking.ref}</p>
      </div>
      <button type="button" class=${cx('bk-copy', copied && 'is-copied')} onClick=${copy} aria-label=${copied ? 'Reference copied' : `Copy reference ${booking.ref}`} data-testid="confirmation-copy">
        <${Icon} name=${copied ? 'check' : 'copy'} size=${18} /><span class="bk-copy__text" aria-hidden="true">${copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
    <p class="bk-ticket__service">${booking.serviceName}<span class="bk-ticket__variant">${' · '}${priceText(service, booking.quotedPrice)}</span></p>
    ${booking.address.postcode ? html`<p class="bk-ticket__addr"><${Icon} name="map-pin" size=${16} />${' '}<span>${booking.address.postcode}</span></p>` : null}
    <div class="bk-ticket__tear" aria-hidden="true"></div>
    <${VisitBlock} booking=${booking} brand=${brand} hours=${hours} settings=${settings} calendar=${calendar} />
    ${showAlert ? html`<p class="bk-ticket__alert"><${Icon} name="message-circle" size=${16} />${' '}<span>${brand.ownerFirst} gets a WhatsApp alert (simulated in this prototype).</span></p>` : null}
  </div>`;
}

/** The booking summary card used by Confirmation and Manage. `live` booking from the store. */
export function ConfirmTicket({ booking, service, brand, hours = 24, settings = null, calendar = false, testid = 'confirmation-ticket', refTestid = 'confirmation-ref', showAlert = true }) {
  if (isEnquiry(booking)) {
    return html`<${EnquiryTicket} booking=${booking} service=${service} brand=${brand} hours=${hours} settings=${settings} calendar=${calendar} testid=${testid} refTestid=${refTestid} showAlert=${showAlert} />`;
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
    ${showAlert ? html`<p class="bk-ticket__alert"><${Icon} name="message-circle" size=${16} />${' '}<span>${brand.ownerFirst} gets a WhatsApp alert (simulated in this prototype).</span></p>` : null}
  </div>`;
}

export function statusChipFor(booking, brand) {
  switch (booking.status) {
    case 'new': return { tone: 'accent', icon: 'bell', text: `Waiting for ${brand.ownerFirst} to confirm` };
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

/** The enquiry's journey in five steps (his three, plus the survey and the first message). Done steps tick off live as the owner works. */
export function enquiryJourney(booking, brand, hours, quote) {
  const st = booking.status;
  const when = visitWhen(booking);
  const surveyOn = st === 'confirmed' || st === 'on_the_way' || st === 'done';
  const q = quote ? quoteStatus(quote, nowStamp()) : '';
  const quoteOut = q === 'sent' || q === 'viewed' || q === 'accepted';
  const items = [
    { id: 'received', when: 'Just now', text: `${brand.ownerFirst} has your enquiry on WhatsApp (simulated)`, done: true },
    { id: 'contact', when: `Within ${hours} hours`, text: 'The team reviews your details and contacts you to discuss your installation', done: surveyOn || quoteOut },
    {
      id: 'survey',
      when: surveyOn ? 'Survey visit confirmed' : 'Free survey visit',
      text: when
        ? (surveyOn ? `${when}, free and no obligation` : `${when}, pencilled in and provisional until ${brand.ownerFirst} confirms`)
        : 'Photos or a survey may be needed to prepare an accurate quote',
      done: st === 'done' || quoteOut
    },
    { id: 'quote', when: 'Your written quote', text: 'A clear quote for your charger, cable route and any electrical work, not a headline figure that changes later', done: quoteOut },
    { id: 'install', when: 'Your installation', text: 'Once you are happy with the agreed quote and scope, arrange a suitable installation date', done: q === 'accepted' }
  ];
  const current = items.findIndex((it) => !it.done);
  return items.map((it, i) => ({ ...it, current: i === current }));
}

/** What happens next: a vertical timeline whose marks tick off live. The first step not yet done pulses. */
export function JourneyTimeline({ items, testid, label = 'What happens next' }) {
  return html`<div class="bk-block bk-journey">
    <p class="bk-eyebrow">${label}</p>
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
      <p class="bk-quote__sub">Written by ${brand.ownerFirst} for your home. Prototype: sample quote.</p>
    </div>
    <${Button} variant="primary" size="md" class="bk-pill" href=${pageHref('quote.html', '#q=' + quote.id)} target=${pageTarget('quote.html')} data-testid="quote-open">${q === 'accepted' ? 'View' : 'View my quote'}<//>
  </div>`;
}

function Timeline({ booking, brand, remindersOn }) {
  let items;
  if (booking.urgent) {
    items = [
      { when: 'Now', text: `${brand.ownerFirst} has been alerted (simulated)`, done: true },
      { when: `Within ${PROMISES.emergencyReplyMinutes} minutes`, text: 'A reply with an arrival time' },
      { when: `If you haven't heard in ${PROMISES.emergencyCallAfterMinutes} minutes`, text: `Call ${brand.phone}` }
    ];
  } else {
    const rem = reminderLabel(booking, remindersOn);
    items = [
      { when: 'Just now', text: `${brand.ownerFirst} has your booking on WhatsApp (simulated)`, done: true },
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

function DemoPanel({ booking, state, brand }) {
  const msgs = selectMessages(state, { bookingId: booking.id });
  const ownerMsg = msgs.find((m) => m.kind === 'owner_new_booking' || m.kind === 'owner_emergency');
  if (!ownerMsg) return null;
  // Oldest first: what the customer got when they booked, then (live) what they got when the owner confirmed.
  const custMsgs = [...msgs].reverse().filter((m) => ['customer_confirmed', 'customer_received', 'customer_emergency_received'].includes(m.kind));
  const stamp = nowStamp();
  const actions = bubbleActions(ownerMsg, booking, stamp).map((a) => ({ id: a.id, label: a.label }));
  const enquiry = isEnquiry(booking);
  return html`<section class="bk-demo" data-testid="demo-panel" aria-labelledby="bk-demo-title">
    <p class="bk-demo__tag">DEMO · SIMULATED</p>
    <h3 class="bk-demo__title" id="bk-demo-title">This is the message ${brand.ownerFirst}'s phone just received</h3>
    <p class="bk-demo__sub">Nothing was really sent. This is what a live build would put on ${brand.ownerFirst}'s WhatsApp the moment you submit.</p>
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

/** His thank-you page, plus the reference, the pencilled-in survey, photos and the simulated alerts (our value add). */
function EnquiryConfirmation({ ctx, booking }) {
  const { state, brand, go, close } = ctx;
  const service = selectService(state, booking.serviceId);
  const chip = statusChipFor(booking, brand);
  const cancelled = booking.status === 'cancelled';
  const hours = replyHours(state);
  const quote = selectQuoteForBooking(state, booking.id);
  const first = firstName(booking.customer.name);
  const waText = `Hi ${brand.ownerFirst}, it's ${first}, about my EV charger enquiry ${booking.ref} (${booking.address.postcode}).`;
  return html`<div class="bk-step bk-confirm bk-confirm--enquiry" data-testid="confirmation">
    <div class="bk-confirm__art"><${Tick} /></div>
    <div class="bk-titleblock bk-titleblock--center">
      <h2 class="bk-title" tabindex="-1" data-bk-title="true" data-testid="confirmation-title">${cancelled ? 'This enquiry was cancelled.' : FUNNEL_CONFIRM.title}</h2>
      ${cancelled ? null : html`<p class="bk-sub bk-confirm__lead" data-testid="confirmation-lead">${FUNNEL_CONFIRM.body(brand.name, hours)}</p>`}
    </div>
    <div class="bk-confirm__status" role="status" aria-live="polite">
      <${Chip} tone=${chip.tone} icon=${chip.icon} data-testid="confirmation-status">${chip.text}<//>
    </div>
    <${ConfirmTicket} booking=${booking} service=${service} brand=${brand} hours=${hours} settings=${state.settings} calendar=${!cancelled} />
    <${QuoteNote} state=${state} booking=${booking} brand=${brand} />
    ${cancelled ? null : html`<div class="bk-ready" data-testid="funnel-ready-box">
      <p class="bk-ready__title"><${Icon} name="info" size=${18} />${' '}<span>${FUNNEL_CONFIRM.readyTitle}</span></p>
      <p class="bk-ready__text">${FUNNEL_CONFIRM.ready}</p>
      <${PhotoCard} booking=${booking} brand=${brand} />
    </div>`}
    ${cancelled ? null : html`<${JourneyTimeline} items=${enquiryJourney(booking, brand, hours, quote)} testid="confirmation-timeline" />`}
    <div class="bk-actions">
      <${Button} variant="secondary" size="lg" block class="bk-pill bk-callbtn" icon="phone" href=${brand.telHref} data-testid="confirmation-call">Prefer to speak to us?${' '}<span class="bk-nowrap">Call ${brand.phone}</span><//>
      <${Button} variant="secondary" size="lg" block class="bk-pill bk-callbtn" icon="message-circle" href=${waLink(brand.phone, waText, brand.demoPhoneDigits)} data-testid="confirmation-whatsapp">WhatsApp ${brand.ownerFirst}<//>
      <div class="bk-actions__links">
        <button type="button" class="bk-linkbtn" onClick=${() => go({ manageRef: booking.ref })} data-testid="confirmation-manage">Change or cancel</button>
        <button type="button" class="bk-linkbtn" onClick=${() => close()} data-testid="confirmation-done">Done</button>
      </div>
    </div>
    <${DemoPanel} booking=${booking} state=${state} brand=${brand} />
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
    <${DemoPanel} booking=${booking} state=${state} brand=${brand} />
  </div>`;
}
