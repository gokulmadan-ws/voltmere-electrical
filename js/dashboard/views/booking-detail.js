// js/dashboard/views/booking-detail.js: BookingDetail named component (status, customer, quote, answers, photos, job, story, history, messages, sticky action bar).
// Owner: E3 (v1 by WP5, enquiry card and quote trail by E2)
import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import {
  Avatar, Button, Card, Chip, Disclosure, EmptyState, Field, Icon, IconButton, PageHeader, Textarea, TextLink, Timeline,
  loadCss, showUndoToast, toast, useMediaQuery, useNow, useStore
} from '../../ui/index.js';
import { addBookingPhotos, markSeen, removeBookingPhoto, updateBooking, sendQuickMessage } from '../../core/store.js';
import {
  quoteExpiresInDays, quoteStatus, quoteTotal, selectBookingById, selectBrand, selectJourney, selectMessages, selectService, customerKeyOf
} from '../../core/selectors.js';
import { KIND_LABELS, messageIsScheduled, telLink, waLink } from '../../core/messages.js';
import { bookingWhen, bookingWindowLabel } from '../../core/availability.js';
import { fmtDayShort, fmtTimeAgo, stampDay, stampTime, weekdayOf, DAY_SHORT, fmtClock, toStamp } from '../../core/dates.js';
import { SOURCE_LABELS, PAID_METHOD_LABELS, EMERGENCY_REASONS, QUOTE_VIA_LABELS, answerLabel } from '../../core/config.js';
import { PHOTO_LIMITS } from '../../core/photos.js';
import { gbp } from '../../core/format.js';
import { routeHref } from '../router.js';
import { JobActionBar, primaryActionFor, primaryHref } from '../shared/job-actions.js';
import { BookingPill, answerSummaryLine, answersOf, isEnquiry, isOutsideNi, isPencilled, isQuotedInstall, quoteProgress } from '../shared/enquiry.js';
import { slaFor } from '../shared/sla.js';
import { leadOf } from '../shared/lead.js';
import { QuotePill } from './quotes.js';
import { PhotoGrid, PhotoLightbox, fileToJpegDataUrl } from '../shared/photos.js';
import { stampText, storyItems } from '../shared/story.js';

const selectAll = (state) => state;

// The quote pill (the same one the Quotes list draws) is styled in quotes.css; this card is shown from Bookings and Customers too.
if (typeof document !== 'undefined') loadCss('css/quotes.css');

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

function failToast(res) {
  toast({
    message: res && res.reason === 'not_found' ? 'That booking no longer exists.'
      : res && res.reason === 'storage_full' ? 'This device has no room left to save that. Free some space, or reset the demo in Demo tools.'
        : 'That did not work: the diary changed. Please check and try again.',
    tone: 'danger'
  });
}

// ---------- pieces ----------

/**
 * Page header: the customer's name is the h1. The line above it carries the way back, the booking ref with its one status pill, and Call and
 * WhatsApp pinned at the right, so the person and the two ways to reach them come before anything else. Beside the list (1100px+) the same
 * thing as an h2 without the back arrow.
 */
function DetailHeader({ embedded, title, backHref, eyebrow, actions }) {
  if (embedded) {
    return html`<div class="bd-embedded-head">
      <div class="bd-embedded-head__main">
        ${eyebrow ? html`<p class="bd-embedded-head__eyebrow">${eyebrow}</p>` : null}
        <h2 class="bd-embedded-head__title">${title}</h2>
      </div>
      ${actions ? html`<div class="bd-head__actions">${actions}</div>` : null}
    </div>`;
  }
  return html`<header class="bd-head">
    <div class="bd-head__bar">
      <${IconButton} icon="arrow-left" label="Back to bookings" href=${backHref} size="lg" class="ui-page-header__back" data-testid="page-back" />
      ${eyebrow ? html`<p class="bd-head__eyebrow">${eyebrow}</p>` : null}
      ${actions ? html`<div class="bd-head__actions">${actions}</div>` : null}
    </div>
    <h1 class="bd-head__title" data-testid="view-title" tabindex="-1">${title}</h1>
  </header>`;
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

/**
 * The quote for this enquiry (or the quote an install came from): status, total, lines, and the buttons that open or build it.
 * `primaryTo` is where the action bar's one big button goes; a button here that would go to the same place is left out, so a quote that
 * is out never says "Open quote" twice.
 */
function QuoteCard({ booking: b, journey, nowStampStr, primaryTo }) {
  const enquiry = journey && journey.enquiry;
  const quote = journey && journey.quote;
  const install = journey && journey.install;
  const status = quote ? quoteStatus(quote, nowStampStr) : null;
  const left = quote ? quoteExpiresInDays(quote, nowStampStr) : 0;
  const total = quote ? quoteTotal(quote) : 0;
  const forId = enquiry ? enquiry.id : b.id;
  const buildHref = routeHref('quote-detail', { id: 'new' }, { booking: forId });
  if (!quote && enquiry && (b.status === 'new' || b.status === 'confirmed' || b.status === 'on_the_way')) {
    return html`<${Card} class="bd-card bd-quote bd-quote--later" aria-label="Quote" data-testid="detail-quote-card">
      <div class="bd-quote__head">
        <h2 class="bd-card__title">Quote</h2>
        <p class="bd-quote__none" data-testid="detail-quote-status">No quote yet</p>
      </div>
      <p class="bd-muted">You write it after the survey visit, from your price list.</p>
    <//>`;
  }
  if (!quote) {
    return html`<${Card} class="bd-card bd-quote" aria-label="Quote" data-testid="detail-quote-card">
      <h2 class="bd-card__title">Quote</h2>
      <p class="bd-quote__none" data-testid="detail-quote-status">No quote yet</p>
      <p class="bd-muted">Build it from your price list and send it by WhatsApp or email. In the live version they open it on their phone, accept and pick an install day.</p>
      <${Button} variant="secondary" block icon="file-plus" href=${buildHref} data-testid="detail-build-quote">Build quote<//>
    <//>`;
  }
  const lines = [...quote.lines].sort((a, b) => (a.optional === true) - (b.optional === true)).slice(0, 5); // fixed lines first, possible extras after
  const when = status === 'accepted' ? `Accepted ${stampText(quote.acceptedAt)}`
    : status === 'declined' ? `Declined ${stampText(quote.declinedAt)}`
      : status === 'viewed' ? `Opened ${stampText(quote.viewedAt)}`
        : status === 'sent' ? `Sent by ${QUOTE_VIA_LABELS[quote.sentVia] || 'a link'} ${stampText(quote.sentAt)} (simulated)`
          : status === 'draft' ? 'Not sent yet' : 'Not answered in time';
  const validity = status === 'sent' || status === 'viewed'
    ? (left < 0 ? 'Expired' : left === 0 ? 'Valid until today' : `Valid for ${left} more ${left === 1 ? 'day' : 'days'}`) : '';
  const openHref = routeHref('quote-detail', { id: quote.id });
  const actions = [
    { key: 'open', href: openHref, node: html`<${TextLink} href=${openHref} class="bd-quote__link" data-testid="detail-open-quote">${status === 'draft' ? 'Finish quote' : 'Open quote'}<//>` },
    status === 'declined' || status === 'expired'
      ? { key: 'new', href: buildHref, node: html`<${Button} variant="secondary" icon="file-plus" href=${buildHref} data-testid="detail-new-quote">Write a new quote<//>` } : null,
    install && b.id !== install.id
      ? { key: 'install', href: routeHref('bookings', { id: install.id }), node: html`<${Button} icon="plug-zap" href=${routeHref('bookings', { id: install.id })} data-testid="detail-open-install">Open the install<//>` } : null,
    enquiry && b.id !== enquiry.id
      ? { key: 'enquiry', href: routeHref('bookings', { id: enquiry.id }), node: html`<${Button} icon="bell" href=${routeHref('bookings', { id: enquiry.id })} data-testid="detail-open-enquiry">${`From enquiry ${enquiry.ref}`}<//>` } : null
  ].filter((a) => a && a.href !== primaryTo);
  return html`<${Card} class="bd-card bd-quote" aria-label="Quote" data-testid="detail-quote-card">
    <div class="bd-quote__head">
      <h2 class="bd-card__title">Quote</h2>
      <${QuotePill} status=${status} data-testid="detail-quote-status" />
    </div>
    <p class="bd-quote__total u-tabular" data-testid="detail-quote-total">${gbp(total)}</p>
    <p class="bd-muted bd-quote__when">${when}${validity ? ` · ${validity}` : ''}</p>
    <ul class="bd-quote__lines">
      ${lines.map((l) => html`<li key=${l.id}><span>${l.qty > 1 ? `${l.qty} × ` : ''}${l.label}${l.optional === true ? html`<br /><span class="bd-muted">Possible extra. Not in the total.</span>` : null}</span><span class="u-tabular">${gbp(l.qty * l.unitPrice)}</span></li>`)}
      ${quote.lines.length > lines.length ? html`<li class="bd-muted"><span>${`and ${quote.lines.length - lines.length} more`}</span></li>` : null}
    </ul>
    ${actions.length ? html`<div class="bd-quote__actions">${actions.map((a) => a.node)}</div>` : null}
  <//>`;
}

/** The visit this booking is about, as a row of the first card: "Survey visit" (or "Install day"), when, and the pencilled-in note. */
function VisitRow({ booking: b, first, replyHours }) {
  const install = isQuotedInstall(b);
  const pencilled = isPencilled(b);
  const note = !pencilled ? ''
    : install ? `${first} accepted the quote and picked this day for the install. It is pencilled in until you confirm it.`
      : `You'll confirm within ${replyHours} h. ${first} has been told it's provisional.`;
  return html`<div class=${`bd-visit${pencilled ? ' is-pencilled' : ''}`} data-testid=${pencilled ? 'detail-pencilled' : 'detail-visit'}>
    <${Icon} name=${pencilled ? 'clock' : 'calendar-check'} size=${20} class="bd-visit__icon" />
    <div class="bd-visit__text">
      <p class="bd-visit__label">${install ? 'Install day' : 'Survey visit'}${pencilled ? ' · pencilled in' : ''}</p>
      <p class="bd-visit__when">${bookingWhen(b)}</p>
      ${note ? html`<p class="bd-visit__note">${note}</p>` : null}
    </div>
  </div>`;
}

/** Photos the customer sent with the enquiry, a lightbox, "Request photos" (logs the message) and "Add a photo" (from the owner's phone). */
function PhotosCard({ booking: b, requestedAt, brand }) {
  const photos = b.photos || [];
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const room = PHOTO_LIMITS.maxPhotos - photos.length;

  const request = () => {
    const res = sendQuickMessage(b.id, 'customer_photos_request');
    if (!res.ok) { failToast(res); return; }
    const url = waLink(b.customer.phone, res.message.body, brand.demoPhoneDigits);
    toast({
      message: `Photos request to ${b.customer.name.split(' ')[0]} logged (simulated). Open it in your WhatsApp to send it for real.`,
      actionLabel: 'Open WhatsApp', duration: 9000,
      onAction: () => { window.open(url, '_blank', 'noopener,noreferrer'); }
    });
  };

  const onFile = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, room);
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    try {
      const made = [];
      for (const file of files) made.push({ name: (file.name || 'Photo').slice(0, 60), dataUrl: await fileToJpegDataUrl(file) });
      const res = addBookingPhotos(b.id, made);
      if (!res.ok) {
        toast({
          message: res.reason === 'too_many' ? 'There are already three photos. Remove one first.'
            : res.reason === 'storage_full' ? 'This device has no room left to save that photo. Remove one, or free some space.' : 'That photo could not be added.',
          tone: 'danger'
        });
      }
      else toast({ message: res.added === 1 ? 'Photo added.' : `${res.added} photos added.` });
    } catch (err) {
      toast({ message: 'That photo could not be read. Try another one.', tone: 'danger' });
    }
    setBusy(false);
  };

  const remove = (photo) => {
    const res = removeBookingPhoto(b.id, photo.id);
    if (!res.ok) { failToast(res); return; }
    showUndoToast('Photo removed.', res.undoToken);
  };

  return html`<${Card} class="bd-card bd-photos" aria-label="Photos" data-testid="detail-photos-card">
    <div class="bd-quote__head">
      <h2 class="bd-card__title">Photos</h2>
      <${Chip} data-testid="detail-photo-count">${`${photos.length} of ${PHOTO_LIMITS.maxPhotos}`}<//>
    </div>
    ${photos.length > 0
      ? html`<${PhotoGrid} photos=${photos} onOpen=${setOpen} />`
      : html`<p class="bd-muted" data-testid="detail-photos-empty">No photos yet. A photo of the consumer unit and of where the charger will go helps you quote without a second visit.</p>`}
    ${requestedAt ? html`<p class="bd-muted" data-testid="detail-photos-requested"><${Icon} name="check" size=${16} /> Requested ${stampText(requestedAt)} (simulated)</p>` : null}
    <div class="bd-photos__actions">
      <${Button} icon="camera" onClick=${request} data-testid="detail-request-photos">${requestedAt ? 'Ask again' : 'Request photos'}<//>
      <${Button} icon="plus" disabled=${room <= 0 || busy} onClick=${() => fileRef.current && fileRef.current.click()} data-testid="detail-add-photo">${busy ? 'Adding' : 'Add a photo'}<//>
      <input ref=${fileRef} type="file" accept="image/*" multiple hidden onChange=${onFile} data-testid="detail-photo-input" />
    </div>
    <${PhotoLightbox} photos=${photos} index=${open} onIndex=${setOpen} onClose=${() => setOpen(null)} onRemove=${remove} />
  <//>`;
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
  // From 1024px the one big action sits inline in the panel, not in a fixed bar that would float over the cards (it stays a bar on a phone).
  const inlineActions = useMediaQuery('(min-width: 1024px)');

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
  // "Repeat" means he has already finished a job for this customer (a free survey visit is a visit, not a job).
  const key = customerKeyOf(b.customer.phone);
  const earlierJobs = state.bookings.filter((x) => x.id !== b.id && x.status === 'done' && !isEnquiry(x) && customerKeyOf(x.customer.phone) === key && x.createdAt <= b.createdAt);
  const repeat = { isRepeat: !isEnquiry(b) && earlierJobs.length > 0, nth: earlierJobs.length + 1 };
  const service = selectService(state, b.serviceId);
  const ago = fmtTimeAgo(b.createdAt, nowStampStr);
  const waText = `Hi ${first}, it's ${brand.ownerFirst} from ${brand.name} about booking ${b.ref}.`;
  const msgs = selectMessages(state, { bookingId: b.id });
  const latest = msgs.slice(0, 3);
  const enquiry = isEnquiry(b);
  const quotedInstall = isQuotedInstall(b);
  const journey = enquiry || quotedInstall ? selectJourney(state, b.id, nowStampStr) : null;
  const enquiryBooking = journey && journey.enquiry ? journey.enquiry : enquiry ? b : null;
  const replyHours = state.settings.sla ? state.settings.sla.replyHours : 24;
  const sla = slaFor(b, replyHours, nowStampStr);
  const progress = quoteProgress(state, b);
  const primary = primaryActionFor(b, progress);
  const primaryTo = primary ? primaryHref(b, primary, progress) : '';
  // ONE stage badge: the quote's own status (the same pill as the Quotes list) once a survey is done and a quote exists, else the booking status.
  const quoteBadge = !!journey && enquiry && b.status === 'done' && !!journey.quote;
  const lead = enquiry ? leadOf(b) : null;
  const leadWord = lead && lead.id !== 'other' ? (lead.id === 'facebook' ? 'Facebook ad' : lead.label) : '';
  const metaParts = [leadWord, `via ${(SOURCE_LABELS[b.source] || b.source || 'website').toLowerCase()}`,
    `${enquiry ? 'received' : 'booked'} ${ago === 'Yesterday' ? 'yesterday' : ago}`].filter(Boolean);
  const answersLine = answerSummaryLine(answersOf(b) ? b : (enquiryBooking || b));
  const live = b.status === 'confirmed' || b.status === 'on_the_way';
  const showEta = b.etaAt && (b.status === 'confirmed' || b.status === 'on_the_way');
  const photoRequest = enquiryBooking
    ? selectMessages(state, { bookingId: enquiryBooking.id }).find((m) => m.kind === 'customer_photos_request') : null;

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

  const story = journey ? storyItems(journey, { replyHours, nowStampStr, photoRequestedAt: photoRequest ? photoRequest.at : '' }) : [];

  // Once the quote is accepted the survey is history: its photos and its visit summary step out of the way.
  const accepted = enquiry && progress.quoteState === 'accepted';
  const showVisit = (enquiry || quotedInstall) && b.status !== 'done' && b.status !== 'cancelled' && !b.urgent;
  const statusPill = quoteBadge
    ? html`<${QuotePill} status=${quoteStatus(journey.quote, nowStampStr)} compact data-testid="detail-status" />`
    : html`<${BookingPill} booking=${b} compact single urgentTestid="detail-urgent" data-testid="detail-status" />`;
  const eyebrow = html`<span class="bd-head__ref u-mono">Booking ${b.ref}</span>${statusPill}`;
  const contact = html`<${IconButton} icon="phone" label=${`Call ${first}`} size="lg" class="bd-head__btn" href=${telLink(b.customer.phone)} data-testid="detail-call" />
    <${IconButton} icon="message-circle" label=${`WhatsApp ${first}`} size="lg" class="bd-head__btn" href=${waLink(b.customer.phone, waText, brand.demoPhoneDigits)} data-testid="detail-whatsapp" />`;
  const historyList = html`<ol class="bd-timeline" data-testid="detail-timeline">
    ${b.history.map((e, i) => html`<li class="bd-timeline__item" key=${i}>
      <span class="bd-timeline__when">${stampText(e.at)}</span> · <span class="bd-timeline__text">${historyText(e, b)}</span>
    </li>`)}
  </ol>`;

  return html`<div class="bd" data-testid="booking-detail">
    <${DetailHeader} embedded=${embedded} title=${b.customer.name} backHref=${backHref} eyebrow=${eyebrow} actions=${contact} />

    <div class="bd-stack">
      ${inlineActions ? html`<div class="bd-actions bd-actions--inline" data-testid="detail-actions-inline"><${JobActionBar} booking=${b} variant="bar" /></div>` : null}

      <${Card} class="bd-card bd-first" aria-label="Customer">
        <div class="bd-status">
          <p class="bd-meta" data-testid="detail-meta">${metaParts.map((part, i) => html`${i ? ' · ' : ''}${part === leadWord && leadWord ? html`<span data-testid="detail-lead" data-lead=${lead.id}>${part}</span>` : part}`)}${sla ? html`${' · '}<span class=${`bd-meta__sla bd-meta__sla--${sla.state}`} data-testid="detail-sla">${sla.label}</span>` : null}</p>
        </div>
        <div class="bd-who">
          <${Avatar} name=${b.customer.name} size=${44} />
          <div class="bd-who__main">
            <p class="bd-who__phone u-tabular">${b.customer.phone}</p>
            ${answersLine ? html`<p class="bd-who__answers" data-testid="detail-answers-line">${answersLine}</p>` : null}
            ${repeat.isRepeat ? html`<${Chip} tone="accent" class="bd-who__tag" data-testid="detail-repeat-tag">${`Repeat customer · ${ordinal(repeat.nth)} job`}<//>` : null}
          </div>
        </div>
        ${showVisit ? html`<${VisitRow} booking=${b} first=${first} replyHours=${replyHours} />` : null}
        <div class="bd-address">
          <${Icon} name="map-pin" size=${20} class="bd-address__icon" />
          <p class="bd-address__text">${b.address.line1 ? `${b.address.line1}, ${b.address.postcode}` : b.address.postcode}</p>
        </div>
        <p class="bd-cust-link"><${TextLink} href=${routeHref('customers', { key: customerKeyOf(b.customer.phone) })}>${`All bookings from ${first}`}<//></p>
      <//>

      ${journey && b.status !== 'cancelled' ? html`<${QuoteCard} booking=${b} journey=${journey} nowStampStr=${nowStampStr} primaryTo=${primaryTo} />` : null}

      <${HomeCard} booking=${answersOf(b) ? b : (enquiryBooking || b)} />

      ${enquiry && !accepted ? html`<${PhotosCard} key=${b.id} booking=${b} requestedAt=${photoRequest ? photoRequest.at : ''} brand=${brand} />` : null}

      <${Card} class="bd-card" aria-label=${accepted ? 'Notes' : 'Job'}>
        <h2 class="bd-card__title">${accepted ? 'Notes' : b.variantLabel ? `${b.serviceName} (${b.variantLabel})` : b.serviceName}</h2>
        ${accepted ? null : html`<dl class="bd-rows">
          ${showVisit ? null : html`<${Row} label="When">${b.urgent ? 'ASAP' : html`${fmtDayShort(stampDay(b.start))} · ${bookingWindowLabel(b)}`}<//>`}
          ${b.urgent ? html`<${Row} label="Request">${`Sent ${stampText(b.createdAt)}`}<//>` : null}
          ${showEta ? html`<${Row} label="ETA">${fmtClock(b.etaAt)}<//>` : null}
          ${service && !b.urgent ? html`<${Row} label="Takes">${service.durationLabel}<//>` : null}
          ${b.urgent && b.emergencyReasons.length ? html`<${Row} label="Problem">${b.emergencyReasons.map((r) => (EMERGENCY_REASONS.find((x) => x.id === r) || { label: r }).label).join(', ')}<//>` : null}
          <${Row} label="Price">${priceBlock(b)}<//>
        </dl>`}
        <div class="bd-note" data-testid="detail-notes">
          <p class="bd-note__label">Note from customer</p>
          ${b.notes ? html`<p class="bd-note__text">${b.notes}</p>` : html`<p class="bd-note__text bd-muted">No note.</p>`}
        </div>
        <${InternalNotes} key=${b.id} booking=${b} />
      <//>

      <section class="bd-section" aria-labelledby="bd-timeline-title">
        <h2 class="db-section__title" id="bd-timeline-title">Timeline</h2>
        <${Card} class="bd-card">
          ${story.length > 0
            ? html`<${Timeline} ariaLabel="From enquiry to install" items=${story} data-testid="detail-story" />
              <${Disclosure} class="bd-history" title="Full history" summary=${`${b.history.length} events`} testid="detail-history">${historyList}<//>`
            : historyList}
        <//>
      </section>

      <${Disclosure} class="bd-messages" title="Messages" summary=${latest.length === 0 ? 'None yet' : `${msgs.length} for this booking`} testid="detail-messages">
        ${latest.length === 0
          ? html`<p class="bd-empty-msgs">No messages yet.</p>`
          : html`<ul class="bd-msgs">
            ${latest.map((m) => html`<li class="bd-msgs__item" key=${m.id}>
              <span class="bd-msgs__kind">${KIND_LABELS[m.kind] || m.kind}</span>
              <span class="bd-msgs__meta"><${Icon} name=${m.channel === 'email' ? 'mail' : 'message-circle'} size=${14} /> ${m.channel === 'email' ? 'Email' : 'WhatsApp'} · ${stampText(m.at)} · ${sentText(m)}</span>
            </li>`)}
          </ul>`}
        <${TextLink} href=${routeHref('messages', {}, { b: b.id })} class="bd-seeall">See all messages<//>
      <//>

      ${enquiry ? live : (live || b.status === 'new') ? html`<section class="bd-section" aria-labelledby="bd-quick-title">
        <h2 class="db-section__title" id="bd-quick-title">Quick messages</h2>
        <div class="bd-quick">
          <${Button} variant="secondary" onClick=${() => sendQuick('customer_running_late')} data-testid="detail-quick-late">Running late<//>
          <${Button} variant="secondary" onClick=${() => sendQuick('customer_need_access')} data-testid="detail-quick-access">Need access<//>
        </div>
      </section>` : null}
    </div>

    ${inlineActions ? null : html`<div class="db-sticky-actions bd-actions">
      <${JobActionBar} booking=${b} variant="bar" />
    </div>`}
  </div>`;
}
