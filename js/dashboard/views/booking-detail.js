// js/dashboard/views/booking-detail.js: BookingDetail named component (job card, timeline, messages, sticky action bar).
// Owner: WP5, enquiry card and quote trail by E2
import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import {
  Avatar, Banner, Button, Card, Chip, EmptyState, Field, Icon, PageHeader, Textarea, TextLink,
  toast, useNow, useStore
} from '../../ui/index.js';
import { markSeen, updateBooking, sendQuickMessage } from '../../core/store.js';
import {
  selectBookingById, selectBrand, selectMessages, selectRepeatInfo, selectService, customerKeyOf
} from '../../core/selectors.js';
import { KIND_LABELS, messageIsScheduled, telLink, smsLink, mailtoLink, waLink, mapsLink } from '../../core/messages.js';
import { bookingWhen, bookingWindowLabel } from '../../core/availability.js';
import { fmtDayShort, fmtTimeAgo, stampDay, stampTime, weekdayOf, DAY_SHORT, fmtClock, toStamp } from '../../core/dates.js';
import { SOURCE_LABELS, PAID_METHOD_LABELS, EMERGENCY_REASONS, answerLabel } from '../../core/config.js';
import { gbp } from '../../core/format.js';
import { routeHref } from '../router.js';
import { JobActionBar } from '../shared/job-actions.js';
import { BookingPill, answersOf, isEnquiry, isOutsideNi, isPencilled, quoteProgress } from '../shared/enquiry.js';

const selectAll = (state) => state;

// ---------- helpers ----------

/** 1 -> '1st', 2 -> '2nd', 11 -> '11th', 23 -> '23rd'. */
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const SOURCE_PHRASE = { website: 'website', phone: 'phone', whatsapp: 'WhatsApp', referral: 'word of mouth' };

/** One timeline line of 13.5 item 4. History notes follow the store's convention (see store.js CONTRACT-GAP). */
function historyText(e, b) {
  const note = e.note || '';
  const enquiry = isEnquiry(b);
  switch (e.event) {
    case 'created':
      if (enquiry) return note && SOURCE_PHRASE[note] ? `Enquiry received via ${SOURCE_PHRASE[note]}` : 'Enquiry received';
      return note && SOURCE_PHRASE[note] ? `Booked via ${SOURCE_PHRASE[note]}` : 'Booked';
    case 'confirmed': return enquiry ? 'Survey visit confirmed' : 'Confirmed';
    case 'declined': return 'Declined';
    case 'on_the_way': return note ? `On the way, about ${note}` : 'On the way';
    case 'done': return 'Done';
    case 'paid': return enquiry ? 'No charge (free survey visit)' : note ? `Paid by ${(PAID_METHOD_LABELS[note] || note).toLowerCase()}` : 'Paid';
    case 'unpaid': return 'Marked unpaid';
    case 'cancelled': return `Cancelled by ${e.by === 'customer' ? 'customer' : 'you'}${note ? `: ${note}` : ''}`;
    case 'rescheduled': return note ? `Moved to ${note}` : 'Moved';
    case 'message': return `Message logged (simulated)${note ? `: ${note}` : ''}`;
    default: return note || e.event;
  }
}

const stampText = (stamp) => `${fmtDayShort(stampDay(stamp))} ${stampTime(stamp)}`;

function failToast(res) {
  toast({
    message: res && res.reason === 'not_found' ? 'That booking no longer exists.' : 'That did not work: the diary changed. Please check and try again.',
    tone: 'danger'
  });
}

// ---------- pieces ----------

/** Page header: h1 with the ref on its own screen, a quieter h2 block when shown beside the list (1100px+). */
function DetailHeader({ embedded, title, backHref }) {
  if (embedded) {
    return html`<div class="bd-embedded-head">
      <p class="bd-embedded-head__eyebrow">Booking</p>
      <h2 class="bd-embedded-head__title u-mono">${title}</h2>
    </div>`;
  }
  return html`<${PageHeader} eyebrow="Booking" title=${html`<span class="u-mono">${title}</span>`} back=${{ href: backHref, label: 'Back to bookings' }} />`;
}

/** The private note: autosaves on blur and says so. The live region exists from first paint (5.1 item 17). */
function InternalNotes({ booking }) {
  const [text, setText] = useState(booking.internalNotes || '');
  const [saved, setSaved] = useState(false);
  const editing = useRef(false);
  const timer = useRef(0);
  // Adopt a change made in another tab, but never overwrite what is being typed.
  useEffect(() => { if (!editing.current) setText(booking.internalNotes || ''); }, [booking.internalNotes]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onBlur = () => {
    editing.current = false;
    if (text === (booking.internalNotes || '')) return;
    const res = updateBooking(booking.id, { internalNotes: text });
    if (!res.ok) { failToast(res); return; }
    setSaved(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 2500);
  };
  return html`<${Field} label="Only you can see this" id="bd-internal-notes" hint="Gate codes, parts to bring, anything for yourself.">
    <${Textarea} id="bd-internal-notes" rows=${3} maxlength="2000" value=${text} enterkeyhint="done"
      onInput=${(e) => setText(e.target.value)} onFocus=${() => { editing.current = true; }} onBlur=${onBlur}
      data-testid="detail-internal-notes" />
  <//>
  <p class="bd-saved" role="status" aria-live="polite">${saved ? html`<${Icon} name="check" size=${16} /> Saved` : ''}</p>`;
}

function Row({ label, children, testid, wide, muted }) {
  return html`<div class=${`bd-row${wide ? ' bd-row--wide' : ''}${muted ? ' bd-row--muted' : ''}`} data-testid=${testid}>
    <dt class="bd-row__label">${label}</dt>
    <dd class="bd-row__value">${children}</dd>
  </div>`;
}

function priceBlock(b) {
  if (isEnquiry(b)) return html`<strong>Free</strong> <span class="bd-muted">survey and written quote</span>`;
  if (b.status !== 'done' && b.serviceId === 'ev' && !b.quotedPrice) return html`<strong>To quote</strong> <span class="bd-muted">agreed after the survey</span>`;
  if (b.status === 'done') {
    const amount = gbp(b.finalPrice === null || b.finalPrice === undefined ? b.quotedPrice : b.finalPrice);
    if (!b.paid) return html`<strong>${amount}</strong> <span class="bd-muted">to collect</span>`;
    const how = b.paidMethod ? ` by ${(PAID_METHOD_LABELS[b.paidMethod] || b.paidMethod).toLowerCase()}` : '';
    return html`<strong>${amount}</strong> <span class="bd-muted">${`paid${how}`}</span>`;
  }
  return html`<strong>${gbp(b.quotedPrice)}</strong> <span class="bd-muted">quoted</span>`;
}

/** "About their home": the five funnel answers in the customer's own terms. Hidden when the booking has none. */
function HomeCard({ booking: b }) {
  const a = answersOf(b);
  if (!a) return null;
  const postcode = a.postcode || b.address.postcode;
  const outside = isOutsideNi(postcode);
  const rows = [['parking', 'Parking'], ['vehicle', 'Electric car'], ['timing', 'Wants it installed'], ['permission', 'Can authorise work']];
  return html`<${Card} class="bd-card bd-answers" aria-label="About their home" data-testid="detail-answers">
    <h2 class="bd-card__title">About their home</h2>
    <dl class="bd-rows">
      <${Row} label="Postcode" testid="detail-answer-postcode">${postcode}${outside
        ? html`<${Chip} tone="danger" icon="triangle-alert" class="en-outside" data-testid="detail-outside-ni">Outside Northern Ireland<//>` : null}<//>
      ${rows.filter(([k]) => a[k]).map(([k, label]) => html`<${Row} key=${k} label=${label} testid=${`detail-answer-${k}`}>${answerLabel(k, a[k]) || a[k]}<//>`)}
      ${typeof a.marketingOptIn === 'boolean' ? html`<${Row} label="Offers and tips" muted testid="detail-answer-optin">${a.marketingOptIn ? 'Opted in' : 'Not opted in'}<//>` : null}
    </dl>
    ${outside ? html`<p class="bd-answers__note">This postcode is not in Northern Ireland. Check you can travel before you confirm.</p>` : null}
  <//>`;
}

/** Where a free survey visit has got to, from the enquiry to the booked install. */
function QuoteTrail({ booking: b, progress }) {
  const done = b.status === 'done';
  const visitDone = done;
  const steps = [
    { id: 'enquiry', label: 'Enquiry received', sub: 'Their answers are above.', state: 'done' },
    { id: 'survey', label: 'Free survey visit',
      sub: visitDone ? 'Done.' : isPencilled(b) ? `Pencilled in for ${bookingWhen(b)}. Confirm it.` : `${fmtDayShort(stampDay(b.start))} · ${bookingWindowLabel(b)}`,
      state: visitDone ? 'done' : 'now' },
    { id: 'quote', label: 'Written quote sent', sub: visitDone && !progress.quoteSent ? 'Tap Quote ready to tell them it is ready.' : progress.quoteSent ? 'Quote-ready message sent (simulated).' : 'After the survey.',
      state: progress.quoteSent ? 'done' : visitDone ? 'now' : 'todo' },
    { id: 'install', label: 'Install booked', sub: progress.installBooked ? 'An install is in the diary.' : progress.quoteSent ? 'Book the install once they accept the quote.' : 'Once they agree the quote.',
      state: progress.installBooked ? 'done' : progress.quoteSent ? 'now' : 'todo' }
  ];
  return html`<section class="bd-section" aria-labelledby="bd-trail-title">
    <h2 class="db-section__title" id="bd-trail-title">From enquiry to install</h2>
    <${Card} class="bd-card">
      <ol class="en-trail" data-testid="detail-quote-trail">
        ${steps.map((st) => html`<li class=${`en-trail__item is-${st.state}`} key=${st.id} data-testid=${`trail-${st.id}`} data-state=${st.state}>
          <span class="en-trail__mark" aria-hidden="true">${st.state === 'done' ? html`<${Icon} name="check" size=${14} />` : null}</span>
          <span class="en-trail__text">
            <span class="en-trail__label">${st.label}<span class="u-sr-only">${st.state === 'done' ? ', done' : st.state === 'now' ? ', next' : ', later'}</span></span>
            <span class="en-trail__sub">${st.sub}</span>
          </span>
        </li>`)}
      </ol>
    <//>
  </section>`;
}

// ---------- BookingDetail ----------

/**
 * Booking detail (13.5). `id` is the booking id. `backHref` is where the back arrow goes (the list with its
 * filter and search kept); `embedded` renders it as the right-hand pane at 1100px and up (no back arrow, h2 title).
 */
export function BookingDetail({ id, backHref = '#/bookings', embedded = false }) {
  const state = useStore(selectAll);
  const nowDate = useNow(60000);
  const booking = selectBookingById(state, id);
  const unseen = !!booking && !booking.seenByOwner;

  // Opening a booking counts as having seen it (clears the unseen dot and the Bookings tab dot).
  useEffect(() => { if (unseen) markSeen(id); }, [id, unseen]);

  if (!booking) {
    return html`<div class="bd" data-testid="detail-not-found">
      <${DetailHeader} embedded=${embedded} title="Booking" backHref=${backHref} />
      <${EmptyState} icon="search" title="We couldn't find that booking."
        action=${html`<${Button} variant="primary" size="lg" href=${backHref}>Back to bookings<//>`} />
    </div>`;
  }

  const brand = selectBrand(state);
  const b = booking;
  const nowStampStr = toStamp(nowDate);
  const first = b.customer.name.trim().split(/\s+/)[0] || b.customer.name;
  const repeat = selectRepeatInfo(state, b);
  const service = selectService(state, b.serviceId);
  const ago = fmtTimeAgo(b.createdAt, nowStampStr);
  const waText = `Hi ${first}, it's ${brand.ownerFirst} from ${brand.name} about booking ${b.ref}.`;
  const msgs = selectMessages(state, { bookingId: b.id });
  const latest = msgs.slice(0, 3);
  const enquiry = isEnquiry(b);
  const progress = quoteProgress(state, b);
  const live = b.status === 'confirmed' || b.status === 'on_the_way';
  const showEta = b.etaAt && (b.status === 'confirmed' || b.status === 'on_the_way');

  const sendQuick = (kind) => {
    const res = sendQuickMessage(b.id, kind);
    if (!res.ok) { failToast(res); return; }
    const url = waLink(b.customer.phone, res.message.body, brand.demoPhoneDigits);
    toast({
      message: 'Message logged (simulated). Open it in your WhatsApp to send it for real.',
      actionLabel: 'Open WhatsApp', duration: 9000,
      onAction: () => { window.open(url, '_blank', 'noopener,noreferrer'); }
    });
  };

  const sentText = (m) => (messageIsScheduled(m, nowStampStr)
    ? `Scheduled for ${DAY_SHORT[weekdayOf(stampDay(m.sendAt))]} ${stampTime(m.sendAt)} (simulated)`
    : 'Sent (simulated)');

  return html`<div class="bd" data-testid="booking-detail">
    <${DetailHeader} embedded=${embedded} title=${b.ref} backHref=${backHref} />

    <div class="bd-stack">
      <div class="bd-status">
        <${BookingPill} booking=${b} urgentTestid="detail-urgent" data-testid="detail-status" />
        <${Chip} data-testid="detail-source">${SOURCE_LABELS[b.source] || b.source}<//>
        <span class="bd-muted">${enquiry ? `Received ${ago === 'Yesterday' ? 'yesterday' : ago}` : ago === 'Yesterday' ? 'Booked yesterday' : `Booked ${ago}`}</span>
      </div>

      ${isPencilled(b)
        ? html`<${Banner} tone="warn" data-testid="detail-pencilled">Survey visit pencilled in for ${bookingWhen(b)}. ${first} has been told it is provisional and that ${brand.ownerFirst} will confirm within 24 hours.<//>`
        : null}

      <${Card} class="bd-card" aria-label="Customer">
        <div class="bd-who">
          <${Avatar} name=${b.customer.name} size=${48} />
          <div class="bd-who__main">
            <p class="bd-who__name">${b.customer.name}</p>
            <p class="bd-who__phone u-tabular">${b.customer.phone}</p>
            ${repeat.isRepeat ? html`<${Chip} tone="accent" class="bd-who__tag" data-testid="detail-repeat-tag">${`Repeat customer · ${ordinal(repeat.nth)} booking`}<//>` : null}
          </div>
        </div>
        <div class="bd-contact">
          <${Button} variant="secondary" icon="phone" href=${telLink(b.customer.phone)} data-testid="detail-call">Call<//>
          <${Button} variant="secondary" icon="message-circle" href=${waLink(b.customer.phone, waText, brand.demoPhoneDigits)} data-testid="detail-whatsapp">WhatsApp<//>
          <${Button} variant="secondary" icon="smartphone" href=${smsLink(b.customer.phone)} data-testid="detail-sms">Text<//>
          ${b.customer.email ? html`<${Button} variant="secondary" icon="send" href=${mailtoLink(b.customer.email, `Booking ${b.ref}`)} data-testid="detail-email">Email<//>` : null}
        </div>
        <div class="bd-address">
          <${Icon} name="map-pin" size=${20} class="bd-address__icon" />
          <p class="bd-address__text">${b.address.line1 ? `${b.address.line1}, ${b.address.postcode}` : b.address.postcode}</p>
          <${Button} variant="secondary" size="sm" icon="navigation" href=${mapsLink(b.address.line1, b.address.postcode)} data-testid="detail-maps">Open in Maps<//>
        </div>
        <p class="bd-cust-link"><${TextLink} href=${routeHref('customers', { key: customerKeyOf(b.customer.phone) })}>${`All bookings from ${first}`}<//></p>
      <//>

      <${HomeCard} booking=${b} />

      <${Card} class="bd-card" aria-label="Job">
        <h2 class="bd-card__title">${b.variantLabel ? `${b.serviceName} (${b.variantLabel})` : b.serviceName}</h2>
        <dl class="bd-rows">
          <${Row} label="When">${b.urgent ? 'ASAP' : html`${fmtDayShort(stampDay(b.start))} · ${bookingWindowLabel(b)}`}<//>
          ${b.urgent ? html`<${Row} label="Request">${`Sent ${stampText(b.createdAt)}`}<//>` : null}
          ${showEta ? html`<${Row} label="ETA">${fmtClock(b.etaAt)}<//>` : null}
          ${service && !b.urgent ? html`<${Row} label="Takes">${service.durationLabel}<//>` : null}
          ${b.urgent && b.emergencyReasons.length ? html`<${Row} label="Problem">${b.emergencyReasons.map((r) => (EMERGENCY_REASONS.find((x) => x.id === r) || { label: r }).label).join(', ')}<//>` : null}
          <${Row} label="Price">${priceBlock(b)}<//>
        </dl>
        <div class="bd-note" data-testid="detail-notes">
          <p class="bd-note__label">Note from customer</p>
          ${b.notes ? html`<p class="bd-note__text">${b.notes}</p>` : html`<p class="bd-note__text bd-muted">No note.</p>`}
        </div>
        <${InternalNotes} key=${b.id} booking=${b} />
      <//>

      ${enquiry && b.status !== 'cancelled' ? html`<${QuoteTrail} booking=${b} progress=${progress} />` : null}

      <section class="bd-section" aria-labelledby="bd-timeline-title">
        <h2 class="db-section__title" id="bd-timeline-title">Timeline</h2>
        <${Card} class="bd-card">
          <ol class="bd-timeline" data-testid="detail-timeline">
            ${b.history.map((e, i) => html`<li class="bd-timeline__item" key=${i}>
              <span class="bd-timeline__when">${stampText(e.at)}</span> · <span class="bd-timeline__text">${historyText(e, b)}</span>
            </li>`)}
          <//>
        <//>
      </section>

      <section class="bd-section" aria-labelledby="bd-msgs-title">
        <h2 class="db-section__title" id="bd-msgs-title">
          <span>Messages for this booking</span>
          <${TextLink} href=${routeHref('messages', {}, { b: b.id })} class="bd-seeall">See all<//>
        </h2>
        <${Card} class="bd-card" padded=${false}>
          ${latest.length === 0
            ? html`<p class="bd-empty-msgs">No messages yet.</p>`
            : html`<ul class="bd-msgs">
              ${latest.map((m) => html`<li class="bd-msgs__item" key=${m.id}>
                <span class="bd-msgs__kind">${KIND_LABELS[m.kind] || m.kind}</span>
                <span class="bd-msgs__meta">${stampText(m.at)} · ${sentText(m)}</span>
              </li>`)}
            </ul>`}
        <//>
      </section>

      ${live || b.status === 'new' ? html`<section class="bd-section" aria-labelledby="bd-quick-title">
        <h2 class="db-section__title" id="bd-quick-title">Quick messages</h2>
        <div class="bd-quick">
          <${Button} variant="secondary" onClick=${() => sendQuick('customer_running_late')} data-testid="detail-quick-late">Running late<//>
          <${Button} variant="secondary" onClick=${() => sendQuick('customer_need_access')} data-testid="detail-quick-access">Need access<//>
          <${Button} variant="secondary" onClick=${() => sendQuick('customer_quote_ready')} data-testid="detail-quick-quote">Quote ready<//>
        </div>
      </section>` : null}
    </div>

    <div class="db-sticky-actions bd-actions">
      <${JobActionBar} booking=${b} variant="bar" />
    </div>
  </div>`;
}
