// js/dashboard/views/quote-detail.js: quote builder and detail (#/quotes/:id, #/quotes/new?booking=<id>): charger brand, price-list lines, notes, send, timeline.
// Owner: Q1
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import {
  Avatar, Button, Card, Chip, ConfirmDialog, Disclosure, EmptyState, Field, Icon, IconButton, Input, MoneyInput, PageHeader, Segmented, Sheet,
  QrCode, SimBanner, Skeleton, Stepper, Switch, Textarea, Timeline, WhatsAppBubble, copyText, cx, pageHref, pageTarget, toast, useBrand, useMediaQuery, useNow, useStore
} from '../../ui/index.js';
import { createQuote, updateQuote, deleteQuote, sendQuote, acceptQuote, declineQuote, undo, getState } from '../../core/store.js';
import { quoteTotal, quoteLineTotal, quoteStatus, selectQuotesForBooking, selectQuoteDetail } from '../../core/selectors.js';
import { quoteShareUrl, quoteUrl } from '../../core/quotes.js';
import { buildMessage, telLink, waLink, mailtoLink } from '../../core/messages.js';
import { bookingWhen, getBookableDays, getDaySlots } from '../../core/availability.js';
import { QUOTE_VIA_LABELS } from '../../core/config.js';
import { addDays, diffDays, fmtDayLong, fmtDayShort, parseDayKey, stampDay, stampTime, toStamp, weekdayOf, DAY_SHORT, MONTH_SHORT } from '../../core/dates.js';
import { todayKey } from '../../core/clock.js';
import { firstName, gbp, makeId, own } from '../../core/format.js';
import { goBack, navigate, routeHref } from '../router.js';
import { AnswerChips, answerSummaryLine, answersOf, isEnquiry, isOutsideNi, isPencilled } from '../shared/enquiry.js';
import { QuotePill, ageText, brandLabel, nudgeHref, plural } from './quotes.js';

export const title = 'Quote';
export const css = ['css/quotes.css'];

const selectAll = (state) => state;

// ---------- pure helpers ----------

const formOf = (q) => ({
  brand: q.brand || '',
  lines: q.lines.map((l) => ({ id: l.id, label: l.label, detail: l.detail || '', qty: l.qty, unitPrice: l.unitPrice, optional: l.optional === true })),
  notes: q.notes || '',
  validUntil: q.validUntil
});
const sigOf = (f) => JSON.stringify([f.brand, f.lines.map((l) => [l.id, l.label, l.detail, l.qty, l.unitPrice, l.optional === true]), f.notes, f.validUntil]);
const stampText = (stamp) => `${fmtDayShort(stampDay(stamp))} ${stampTime(stamp)}`;
const lineFromItem = (item) => ({
  id: makeId('ln'), label: item.label, detail: item.detail || '', qty: Number.isInteger(item.defaultQty) && item.defaultQty > 0 ? item.defaultQty : 1, unitPrice: item.unitPrice,
  optional: item.optional === true
});
const priceWord = (item) => (item && item.unit === 'metre' ? 'per metre' : 'each');

/** A plain sentence for a store failure ({ ok: false, reason, errors? }). */
function failText(res) {
  if (res && res.errors) {
    const first = Object.values(res.errors)[0];
    if (first) return String(first);
  }
  switch (res && res.reason) {
    case 'not_found': return 'That quote or enquiry no longer exists.';
    case 'bad_transition': return 'That quote cannot be changed any more. They may have opened it.';
    case 'storage_full': return 'This device is full, so nothing was saved. Free up some space and try again.';
    case 'no_email': return 'There is no email address for this customer.';
    case 'expired': return 'This quote has run out. Send it again first to give it fresh days.';
    case 'slot_taken': return 'That half day was just taken. Please pick another.';
    case 'already_accepted': return 'This quote was already accepted.';
    case 'service_unavailable': return 'Home charger installs are switched off in Settings.';
    default: return 'That did not work. Please check and try again.';
  }
}

/** If the customer's own words name exactly one of your charger brands, start with that one. */
export function guessBrand(booking, brands) {
  const text = String((booking && booking.notes) || '').toLowerCase();
  const hits = (brands || []).filter((b) => text.includes(String(b).toLowerCase()));
  return hits.length === 1 ? hits[0] : undefined;
}

/** Which catalogue rows the lines cover. `entries` follow the price list (the charger row is the chosen brand only); `others` are lines the list does not know. */
function menuFor(lines, items, brand) {
  const catalogue = items.filter((i) => i.kind !== 'charger' || (brand && i.brand === brand));
  const claimed = new Set();
  const entries = catalogue.map((item) => {
    const index = lines.findIndex((l, i) => !claimed.has(i) && l.label === item.label);
    if (index >= 0) claimed.add(index);
    return { item, index };
  });
  const others = [];
  lines.forEach((l, i) => { if (!claimed.has(i)) others.push(i); });
  return { entries, others };
}

/** Lines in price-list order (what the menu shows), then any lines the list does not know, in the order they were added. */
function inMenuOrder(lines, items, brand) {
  const { entries, others } = menuFor(lines, items, brand);
  return [...entries.filter((e) => e.index >= 0).map((e) => lines[e.index]), ...others.map((i) => lines[i])];
}

function guardTap() {
  let busy = false;
  return (fn) => { if (busy) return; busy = true; try { fn(); } finally { setTimeout(() => { busy = false; }, 400); } };
}

// ---------- small pieces ----------

function NotFound({ what }) {
  return html`<div class="db-page q1-page" data-testid="q1-not-found">
    <${PageHeader} title=${what === 'enquiry' ? 'Enquiry not found' : 'Quote not found'} back=${{ href: routeHref('quotes'), label: 'Back to quotes' }} />
    <${EmptyState} icon="search" title=${what === 'enquiry' ? "We couldn't find that enquiry." : "We couldn't find that quote."}
      body="It may have been deleted, or the link is out of date."
      action=${html`<${Button} variant="primary" size="lg" href=${routeHref('quotes')}>Back to quotes<//>`} />
  </div>`;
}

function SaveStatus({ editable, dirty, saveState, status }) {
  if (!editable) return null;
  if (saveState.kind === 'error') {
    return html`<p class="q1-save is-error" role="alert" data-testid="q1-saved"><${Icon} name="circle-alert" size=${18} /><span>Not saved: ${saveState.message}</span></p>`;
  }
  const text = dirty ? 'Saving…' : status === 'draft' ? 'Draft saved on this device' : 'Saved. Their link shows this now';
  return html`<p class=${cx('q1-save', !dirty && 'is-saved')} role="status" data-testid="q1-saved">
    <${Icon} name=${dirty ? 'loader-circle' : 'check'} size=${18} /><span>${text}</span></p>`;
}

/** The quote's story, for the Timeline kit component. */
function timelineFor({ quote, status, first, booking, install }) {
  const items = [{ id: 'created', title: 'Quote started', time: stampText(quote.createdAt), tone: 'done' }];
  if (quote.sentAt) {
    const via = quote.sentVia === 'email' ? 'Sent by email (simulated)' : quote.sentVia === 'link' ? 'Link copied to send yourself (simulated)' : 'Sent by WhatsApp (simulated)';
    const to = quote.sentVia === 'email' ? booking && booking.customer.email : booking && booking.customer.phone;
    items.push({ id: 'sent', title: via, time: stampText(quote.sentAt), detail: to ? `To ${first}, ${to}` : `To ${first}`, tone: 'done' });
  } else {
    items.push({ id: 'send', title: `Send it to ${first}`, detail: 'By WhatsApp, email or a link you share yourself.', tone: 'current' });
    return items;
  }
  if (quote.viewedAt) items.push({ id: 'viewed', title: `Opened by ${first}`, time: stampText(quote.viewedAt), tone: 'done' });
  else if (status === 'sent') items.push({ id: 'viewed', title: `Waiting for ${first} to open it`, tone: 'current' });
  if (status === 'accepted') {
    items.push({
      id: 'accepted', title: `Accepted by ${first}`, time: quote.acceptedAt ? stampText(quote.acceptedAt) : '', tone: 'done',
      detail: install ? `Install pencilled in for ${bookingWhen(install)}` : ''
    });
  } else if (status === 'declined') {
    items.push({ id: 'declined', title: `Declined by ${first}`, time: quote.declinedAt ? stampText(quote.declinedAt) : '', detail: quote.declineReason || 'No reason given.', tone: 'error' });
  } else if (status === 'expired') {
    items.push({ id: 'expired', title: `Ran out on ${fmtDayShort(quote.validUntil)}`, detail: 'Send it again to give it fresh days.', tone: 'warn' });
  } else {
    items.push({ id: 'answer', title: 'Waiting for a yes or no', tone: quote.viewedAt ? 'current' : 'upcoming' });
  }
  return items;
}

/** Headline and one sentence under it for the status card. */
function statusCopy({ quote, status, first, nowStampStr, defaults, install }) {
  switch (status) {
    case 'sent': return { headline: `Waiting for ${first} to open it`, sub: `Sent ${ageText(quote.sentAt, nowStampStr)}.` };
    case 'viewed': return { headline: `${first} has opened it`, sub: `Opened ${ageText(quote.viewedAt, nowStampStr)}, no answer yet. A quick nudge often helps.` };
    case 'accepted': return { headline: `${first} said yes`, sub: install && isPencilled(install) ? 'The install day is pencilled in. Open it and confirm to lock the day in.' : 'The install is in your diary.' };
    case 'declined': return { headline: `${first} said no`, sub: quote.declineReason ? `Reason: ${quote.declineReason}` : 'They gave no reason. A friendly message can reopen the door.' };
    case 'expired': return { headline: 'This quote has run out', sub: `Its last day was ${fmtDayShort(quote.validUntil)}. Send it again and it gets a fresh ${defaults.validDays || 30} days.` };
    default: return null;
  }
}

// ---------- enquiry picker (#/quotes/new without ?booking) ----------

function EnquiryPicker() {
  const state = useStore(selectAll);
  const nowDate = useNow(60000);
  const nowStampStr = toStamp(nowDate);
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();

  const rows = state.bookings.filter(isEnquiry).filter((b) => b.status !== 'cancelled').map((b) => {
    const quotes = selectQuotesForBooking(state, b.id);
    const latest = quotes[0] || null;
    const latestStatus = latest ? quoteStatus(latest, nowStampStr) : null;
    const draft = quotes.find((x) => x.status === 'draft') || null;
    const open = quotes.find((x) => ['sent', 'viewed'].includes(quoteStatus(x, nowStampStr)) || x.status === 'accepted') || null;
    const target = draft || open || null;
    return { booking: b, latest, latestStatus, target, needs: !draft && !open };
  }).filter(({ booking: b }) => !term || [b.customer.name, b.ref, b.address.postcode].join(' ').toLowerCase().includes(term));

  const ready = rows.filter((r) => r.needs && r.booking.status === 'done');
  const early = rows.filter((r) => r.needs && r.booking.status !== 'done');
  const quoted = rows.filter((r) => !r.needs);
  const sections = [
    { key: 'ready', heading: 'Ready for a quote', hint: 'Survey done', list: ready },
    { key: 'early', heading: 'Not surveyed yet', hint: 'You can still quote ahead', list: early },
    { key: 'quoted', heading: 'Already quoted', hint: 'Opens the quote', list: quoted }
  ].filter((s) => s.list.length > 0);

  const sub = (r) => {
    const b = r.booking;
    const surveyed = b.status === 'done' ? 'Survey done' : b.status === 'new' ? 'Waiting for your reply' : 'Survey booked';
    return html`${b.address.postcode} · <span class="u-nowrap">${b.ref}</span> · ${surveyed}`;
  };

  return html`<div class="db-page q1-page" data-testid="q1-picker">
    <${PageHeader} title="New quote" subtitle="Choose the enquiry this quote is for." back=${{ href: routeHref('quotes'), label: 'Back to quotes' }} />
    <div class="q1-picker__search">
      <${Icon} name="search" size=${20} class="q1-picker__icon" />
      <${Input} id="q1-picker-search" type="search" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Name, postcode or ref"
        aria-label="Search enquiries" enterkeyhint="search" autocomplete="off" spellcheck=${false} class="q1-picker__input" data-testid="q1-picker-search" />
    </div>
    ${sections.length === 0
      ? html`<${EmptyState} icon="inbox" title=${term ? `No enquiries match "${q.trim()}".` : 'No enquiries to quote.'}
          body=${term ? 'Try a name, postcode or enquiry ref.' : 'A quote belongs to a home charger enquiry. They arrive from your website form.'} data-testid="q1-picker-empty" />`
      : sections.map((s) => html`<section class="q1-group" key=${s.key} aria-label=${s.heading}>
          <h2 class="q1-group__title"><span>${s.heading}</span><span class="q1-group__sum">${s.hint}</span></h2>
          <ul class="db-list q1-rows">
            ${s.list.map((r) => html`<li key=${r.booking.id} class="ui-row__li">
              <a class="db-list__item ui-row ui-row--interactive" data-testid=${`q1-pick-${r.booking.id}`}
                href=${r.target ? routeHref('quote-detail', { id: r.target.id }) : routeHref('quote-detail', { id: 'new' }, { booking: r.booking.id })}>
                <span class="ui-row__lead"><${Avatar} name=${r.booking.customer.name} size=${44} /></span>
                <span class="ui-row__main">
                  <span class="ui-row__title">${r.booking.customer.name}</span>
                  <span class="ui-row__sub">${sub(r)}</span>
                </span>
                <span class="ui-row__end">${r.target
                  ? html`<${QuotePill} status=${quoteStatus(r.target, nowStampStr)} compact />`
                  : html`<span class="q1-pick__go">${r.latestStatus ? 'New version' : 'Write'}</span>`}</span>
                <${Icon} name="chevron-right" size=${20} class="ui-row__chev" />
              </a>
            </li>`)}
          </ul>
        </section>`)}
  </div>`;
}

// ---------- new quote for an enquiry (#/quotes/new?booking=<id>) ----------

function StartFromBooking({ bookingId }) {
  const [problem, setProblem] = useState('');
  const started = useRef('');
  useEffect(() => {
    if (started.current === bookingId) return;
    started.current = bookingId;
    const state = getState();
    const booking = state.bookings.find((b) => b.id === bookingId);
    if (!booking) { setProblem('missing'); return; }
    if (booking.serviceId !== 'ev_quote') { setProblem('not_enquiry'); return; }
    if (booking.status === 'cancelled') { setProblem('cancelled'); return; }
    const existing = selectQuotesForBooking(state, bookingId);
    const accepted = existing.find((x) => x.status === 'accepted');
    if (accepted) { setProblem('accepted:' + accepted.id); return; }
    const draft = existing.find((x) => x.status === 'draft');
    if (draft) {
      navigate(routeHref('quote-detail', { id: draft.id }), { replace: true });
      toast({ message: 'Carrying on with your draft.' });
      return;
    }
    const res = createQuote({ bookingId, brand: guessBrand(booking, state.settings.business.brands) });
    if (res.ok) {
      navigate(routeHref('quote-detail', { id: res.quote.id }), { replace: true });
    } else {
      setProblem(res.reason === 'storage_full' ? 'storage_full' : 'failed');
    }
  }, [bookingId]);

  if (problem === 'missing') return html`<${NotFound} what="enquiry" />`;
  if (problem) {
    const accepted = problem.startsWith('accepted:') ? problem.slice(9) : '';
    const text = {
      not_enquiry: 'A quote belongs to a home charger enquiry. Pick one from the list.',
      cancelled: 'That enquiry was cancelled, so there is nothing to quote.',
      storage_full: 'This device is full, so the quote could not be started. Free up some space and try again.',
      failed: 'The quote could not be started. Please try again.'
    }[problem] || 'This enquiry already has an accepted quote. Open it to see the install.';
    return html`<div class="db-page q1-page" data-testid="q1-start-problem">
      <${PageHeader} title="New quote" back=${{ href: routeHref('quotes'), label: 'Back to quotes' }} />
      <${EmptyState} icon="file-text" title="No new quote started" body=${text}
        action=${accepted
          ? html`<${Button} variant="primary" size="lg" href=${routeHref('quote-detail', { id: accepted })}>Open the accepted quote<//>`
          : html`<${Button} variant="primary" size="lg" href=${routeHref('quote-detail', { id: 'new' })}>Choose an enquiry<//>`} />
    </div>`;
  }
  return html`<div class="db-page q1-page" data-testid="q1-starting" aria-busy="true">
    <${PageHeader} title="New quote" back=${{ href: routeHref('quotes'), label: 'Back to quotes' }} />
    <${Skeleton} lines=${4} />
  </div>`;
}

// ---------- builder pieces ----------

/** One line (first name, postcode, what they answered) with an expand for the phone number, the full answers and what they said. */
function CustomerCard({ booking, quote, brand }) {
  const [open, setOpen] = useState(false);
  const first = firstName(quote.customerName);
  if (!booking) {
    return html`<${Card} class="q1-card" data-testid="q1-customer"><p class="q1-muted">The enquiry for this quote is no longer in your diary.</p><//>`;
  }
  const c = booking.customer;
  const a = booking.address;
  const outside = isOutsideNi((answersOf(booking) && answersOf(booking).postcode) || a.postcode);
  const waText = `Hi ${first}, it's ${brand.ownerFirst} from ${brand.name} about your charger quote.`;
  const summary = answerSummaryLine(booking);
  return html`<${Card} class=${cx('q1-card', 'q1-customer', open && 'is-open')} aria-label="Customer" data-testid="q1-customer">
    <button type="button" class="q1-who q1-who--toggle" aria-expanded=${open ? 'true' : 'false'} aria-controls="q1-customer-more" onClick=${() => setOpen(!open)} data-testid="q1-customer-toggle">
      <${Avatar} name=${quote.customerName} size=${40} />
      <span class="q1-who__main">
        <span class="q1-who__name">${first}${a.postcode ? html` <span class="q1-who__pc">· ${a.postcode}</span>` : null}</span>
        ${summary ? html`<span class="q1-who__sub">${summary}</span>` : null}
        ${outside ? html`<span class="q1-who__out" data-testid="q1-outside-ni"><${Icon} name="triangle-alert" size=${14} />Outside Northern Ireland</span>` : null}
      </span>
      <${Icon} name="chevron-down" size=${20} class="q1-who__chev" />
    </button>
    ${open ? html`<div class="q1-customer__more" id="q1-customer-more">
      <div class="q1-who">
        <div class="q1-who__main">
          <p class="q1-who__phone u-tabular">${c.phone}</p>
          <p class="q1-who__addr">${[a.line1, a.postcode].filter(Boolean).join(', ')}</p>
        </div>
        <div class="q1-who__tools">
          <${IconButton} icon="phone" label=${`Call ${first}`} href=${telLink(c.phone)} data-testid="q1-call" />
          <${IconButton} icon="message-circle" label=${`WhatsApp ${first}`} href=${waLink(c.phone, waText, brand.demoPhoneDigits)} data-testid="q1-whatsapp" />
        </div>
      </div>
      ${answersOf(booking)
        ? html`<div class="q1-answers"><p class="q1-cap">Their answers</p><${AnswerChips} booking=${booking} /></div>`
        : null}
      ${booking.notes ? html`<blockquote class="q1-said" data-testid="q1-customer-note"><span class="q1-cap">In their words</span>${booking.notes}</blockquote>` : null}
      <a class="q1-link" href=${routeHref('bookings', { id: booking.id })} data-testid="q1-enquiry-link">
        <${Icon} name="inbox" size=${18} /><span>Open enquiry ${booking.ref}</span><${Icon} name="chevron-right" size=${18} />
      </a>
    </div>` : null}
  <//>`;
}

function BrandPicker({ brands, value, items, onChange, mention, disabled }) {
  const options = brands.includes(value) || !value ? brands : [value, ...brands];
  const priceOf = (b) => { const it = items.find((i) => i.kind === 'charger' && i.brand === b); return it ? gbp(it.unitPrice) : ''; };
  return html`<fieldset class="q1-brands" data-testid="q1-brands" disabled=${disabled ? true : undefined}>
    <legend class="u-sr-only">Which charger?</legend>
    <div class="q1-brands__grid">
      ${options.map((b) => html`<label class=${cx('q1-brand', b === value && 'is-selected')} key=${b} data-testid=${`q1-brand-${String(b).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
        <input type="radio" name="q1-brand" value=${b} checked=${b === value} onChange=${() => onChange(b)} class="q1-brand__input" />
        <span class="q1-brand__name">${brandLabel(b)}</span>
        <span class="q1-brand__price">${priceOf(b) ? `from ${priceOf(b)}` : 'Price it below'}</span>
        <span class="q1-brand__tick" aria-hidden="true"><${Icon} name="check" size=${16} /></span>
      </label>`)}
    </div>
    ${mention ? html`<p class="q1-hint-line"><${Icon} name="sparkles" size=${16} /> They mentioned ${brandLabel(mention)} in their message.</p>` : null}
  </fieldset>`;
}

/**
 * One quote line you can edit. A one-off line (the charger, the installation, testing, an extra) is a single 56px row: its name, its price (tap the
 * amount to change it) and a bin. Only a per-metre line, or one that is already more than one of something, gets the quantity stepper.
 * `item` is the price-list entry it came from (null for a custom line).
 */
function LineCard({ line, item, tid, onPatch, onRemove, onEdit }) {
  const negative = line.unitPrice < 0;
  const priceId = `q1-price-field-${tid}`;
  const metres = item && item.unit === 'metre';
  const oneOff = !metres && line.qty === 1;
  const total = quoteLineTotal(line);
  // A possible extra is listed on the quote but never added into its total (quoteTotal skips it).
  const extra = line.optional === true ? html`<p class="q1-line__extra" data-testid=${`q1-extra-${tid}`}>Possible extra. Not in the total.</p>` : null;
  const remove = html`<button type="button" class="q1-line__remove" onClick=${onRemove} aria-label=${`Remove ${line.label}`} data-testid=${`q1-remove-${tid}`}>
    <${Icon} name="trash-2" size=${20} />
  </button>`;
  if (oneOff) {
    return html`<li class="q1-line q1-line--row" data-testid=${`q1-line-${tid}`} data-line-id=${line.id}>
      <div class="q1-line__text">
        ${onEdit
          ? html`<button type="button" class="q1-line__edit" onClick=${onEdit} data-testid=${`q1-edit-${tid}`} aria-label=${`Edit ${line.label}`}>
              <span class="q1-line__label">${line.label}</span><${Icon} name="pencil" size=${16} /></button>`
          : html`<label class="q1-line__label" for=${priceId}>${line.label}</label>`}
        ${line.detail ? html`<p class="q1-line__detail">${line.detail}</p>` : null}
        ${extra}
      </div>
      ${item
        ? html`<${MoneyInput} id=${priceId} value=${Math.abs(line.unitPrice)} onChange=${(n) => onPatch({ unitPrice: negative ? -(n || 0) : (n || 0) })}
            min=${0} max=${99999} aria-label=${`Price of ${line.label}`} data-testid=${`q1-price-${tid}`} class="q1-money q1-money--inline" />
          <span class="u-sr-only" data-testid=${`q1-line-total-${tid}`}>${gbp(total)}</span>`
        : html`<p class=${cx('q1-line__total', negative && 'is-discount')} data-testid=${`q1-line-total-${tid}`}><span key=${total} class="q1-bump">${gbp(total)}</span></p>`}
      ${remove}
    </li>`;
  }
  return html`<li class="q1-line" data-testid=${`q1-line-${tid}`} data-line-id=${line.id}>
    <div class="q1-line__top">
      <div class="q1-line__text">
        ${onEdit
          ? html`<button type="button" class="q1-line__edit" onClick=${onEdit} data-testid=${`q1-edit-${tid}`} aria-label=${`Edit ${line.label}`}>
              <span class="q1-line__label">${line.label}</span><${Icon} name="pencil" size=${16} /></button>`
          : html`<p class="q1-line__label">${line.label}</p>`}
        ${line.detail ? html`<p class="q1-line__detail">${line.detail}</p>` : null}
        ${extra}
      </div>
      <p class=${cx('q1-line__total', negative && 'is-discount')} data-testid=${`q1-line-total-${tid}`}><span key=${total} class="q1-bump">${gbp(total)}</span></p>
      ${remove}
    </div>
    <div class="q1-line__controls">
      <div class="q1-line__field">
        <span class="q1-cap" id=${`q1-qty-cap-${tid}`}>${metres ? 'Metres' : 'Quantity'}</span>
        <${Stepper} value=${line.qty} onChange=${(n) => onPatch({ qty: n })} step=${1} min=${1} max=${999} format=${(n) => String(n)}
          label=${`${metres ? 'Metres' : 'Quantity'} of ${line.label}`} class="q1-stepper"
          testids=${{ minus: `q1-qty-minus-${tid}`, input: `q1-qty-${tid}`, plus: `q1-qty-plus-${tid}` }} />
      </div>
      <div class="q1-line__field q1-line__field--price">
        <label class="q1-cap" for=${priceId}>${negative ? 'Discount' : `Price ${priceWord(item)}`}</label>
        <${MoneyInput} id=${priceId} value=${Math.abs(line.unitPrice)} onChange=${(n) => onPatch({ unitPrice: negative ? -(n || 0) : (n || 0) })}
          min=${0} max=${99999} data-testid=${`q1-price-${tid}`} class="q1-money" />
      </div>
    </div>
  </li>`;
}

function AddRow({ item, onAdd }) {
  const hint = [item.detail, item.unit === 'metre' ? 'Per metre' : ''].filter(Boolean).join('. ');
  return html`<li class="q1-addrow">
    <button type="button" class="q1-add" onClick=${onAdd} data-testid=${`q1-add-${item.id}`}
      aria-label=${`Add ${item.label}, ${gbp(item.unitPrice)} ${priceWord(item)}`}>
      <span class="q1-add__plus" aria-hidden="true"><${Icon} name="plus" size=${18} /></span>
      <span class="q1-add__text">
        <span class="q1-add__label">${item.label}</span>
        ${hint ? html`<span class="q1-add__hint">${hint}</span>` : null}
      </span>
      <span class="q1-add__price">${gbp(item.unitPrice)}</span>
    </button>
  </li>`;
}

function ReadOnlyLines({ lines }) {
  return html`<ul class="q1-ro" data-testid="q1-lines-readonly">
    ${lines.map((l) => html`<li class="q1-ro__line" key=${l.id}>
      <div class="q1-ro__text">
        <p class="q1-ro__label">${l.label}</p>
        ${l.detail ? html`<p class="q1-line__detail">${l.detail}</p>` : null}
        ${l.qty > 1 ? html`<p class="q1-ro__calc">${l.qty} × ${gbp(l.unitPrice)}</p>` : null}
        ${l.optional === true ? html`<p class="q1-line__extra">Possible extra. Not in the total.</p>` : null}
      </div>
      <p class="q1-ro__total">${gbp(quoteLineTotal(l))}</p>
    </li>`)}
  </ul>`;
}

// ---------- sheets ----------

/** Add or edit a custom line (anything that is not in the price list: a discount, a one-off job). */
function CustomLineSheet({ open, line, onSave, onClose }) {
  const editing = !!line;
  // `edits` stays null until something is typed, so the first paint already shows the line being edited (no empty flash).
  const initial = {
    label: line ? line.label : '', detail: line ? line.detail || '' : '', kind: line && line.unitPrice < 0 ? 'discount' : 'charge',
    price: line ? Math.abs(line.unitPrice) : 0, qty: line ? line.qty : 1, optional: !!line && line.optional === true
  };
  const [edits, setEdits] = useState(null);
  const [error, setError] = useState('');
  const v = edits || initial;
  const { label, detail, kind, price, qty, optional } = v;
  const setLabel = (x) => setEdits({ ...v, label: x });
  const setDetail = (x) => setEdits({ ...v, detail: x });
  const setKind = (x) => setEdits({ ...v, kind: x });
  const setPrice = (x) => setEdits({ ...v, price: x });
  const setQty = (x) => setEdits({ ...v, qty: x });
  const setOptional = (x) => setEdits({ ...v, optional: x });
  useEffect(() => { if (!open) { setEdits(null); setError(''); } }, [open]);

  const submit = () => {
    const name = label.trim();
    if (!name) { setError('Say what this line is for, for example "Extra socket".'); return; }
    if (name.length > 120) { setError('Keep the description under 120 characters.'); return; }
    onSave({ label: name, detail: detail.trim(), qty, unitPrice: kind === 'discount' ? -price : price, optional: optional && kind !== 'discount' });
  };
  const footer = html`<${Button} variant="primary" size="lg" block icon=${editing ? 'check' : 'plus'} onClick=${submit} data-testid="q1-custom-save">${editing ? 'Save line' : 'Add to quote'}<//>`;
  return html`<${Sheet} open=${open} title=${editing ? 'Edit line' : 'Add a custom line'} testid="q1-custom-sheet" onClose=${onClose} footer=${footer}
    initialFocus="#q1-custom-label"
    description="For anything that is not in your price list: an extra socket, a discount, a one-off job.">
    <div class="q1-form">
      <${Field} label="What is it for?" id="q1-custom-label" error=${error} errorTestid="q1-custom-error">
        <${Input} id="q1-custom-label" value=${label} onInput=${(e) => { setLabel(e.target.value); setError(''); }} maxlength="120" enterkeyhint="next"
          autocomplete="off" placeholder="For example: Extra outdoor socket" data-testid="q1-custom-label" />
      <//>
      <${Field} label="Extra detail (optional)" id="q1-custom-detail">
        <${Input} id="q1-custom-detail" value=${detail} onInput=${(e) => setDetail(e.target.value)} maxlength="200" autocomplete="off" data-testid="q1-custom-detail" />
      <//>
      <${Segmented} ariaLabel="Charge or discount" value=${kind} onChange=${setKind}
        options=${[{ value: 'charge', label: 'Charge', testid: 'q1-custom-charge' }, { value: 'discount', label: 'Discount', testid: 'q1-custom-discount' }]} />
      <div class="q1-form__row">
        <${Field} label=${kind === 'discount' ? 'Discount each' : 'Price each'} id="q1-custom-price">
          <${MoneyInput} id="q1-custom-price" value=${price} onChange=${(n) => setPrice(n || 0)} min=${0} max=${99999} data-testid="q1-custom-price" />
        <//>
        <div class="ui-field">
          <span class="ui-field__label" id="q1-custom-qty-label">Quantity</span>
          <${Stepper} value=${qty} onChange=${setQty} step=${1} min=${1} max=${999} format=${(n) => String(n)} label="Quantity" class="q1-stepper"
            testids=${{ minus: 'q1-custom-qty-minus', input: 'q1-custom-qty', plus: 'q1-custom-qty-plus' }} />
        </div>
      </div>
      ${kind === 'charge' ? html`<${Switch} id="q1-custom-optional" checked=${optional} onChange=${setOptional} label="Possible extra"
        description="Listed on the quote, but not added into the total. For work that may or may not be needed." data-testid="q1-custom-optional" />` : null}
    </div>
  <//>`;
}

/** How the quote goes out. Opens only after unsaved edits have been saved, so the preview is exactly what they get. */
function SendSheet({ open, quoteId, resend, onPick, onClose }) {
  const state = useStore(selectAll);
  const quote = own(state.quotes, quoteId);
  const booking = quote ? state.bookings.find((b) => b.id === quote.bookingId) || null : null;
  if (!open || !quote || !booking) return html`<${Sheet} open=${false} title="Send" onClose=${onClose} />`;
  const first = firstName(quote.customerName);
  const preview = buildMessage('customer_quote_sent', booking, state, { quote });
  const email = booking.customer.email || '';
  return html`<${Sheet} open title=${resend ? `Send ${first} the quote again` : `Send the quote to ${first}`} testid="q1-send-sheet" onClose=${onClose}
    initialFocus='[data-testid="q1-send-whatsapp"]'
    description="They get a link to read the quote and choose an install day.">
    <div class="q1-send">
      <div class="q1-preview" data-testid="q1-send-preview">
        <p class="q1-cap">What they will get</p>
        <${WhatsAppBubble} body=${preview.body} direction="out" class="q1-bubble" />
      </div>
      <ul class="q1-opts" aria-label="How to send it">
        <li><button type="button" class="q1-opt q1-opt--primary" onClick=${() => onPick('whatsapp')} data-testid="q1-send-whatsapp">
          <span class="q1-opt__icon"><${Icon} name="message-circle" size=${24} /></span>
          <span class="q1-opt__text"><span class="q1-opt__title">WhatsApp</span><span class="q1-opt__sub">To ${booking.customer.phone}. Opens WhatsApp with the message ready.</span></span>
          <${Icon} name="chevron-right" size=${20} />
        </button></li>
        <li><button type="button" class="q1-opt" onClick=${() => onPick('email')} disabled=${email ? undefined : true} data-testid="q1-send-email">
          <span class="q1-opt__icon"><${Icon} name="mail" size=${24} /></span>
          <span class="q1-opt__text"><span class="q1-opt__title">Email</span><span class="q1-opt__sub">${email ? `To ${email}. Logged here, simulated in this prototype.` : `No email address for ${first}.`}</span></span>
          <${Icon} name="chevron-right" size=${20} />
        </button></li>
        <li><button type="button" class="q1-opt" onClick=${() => onPick('link')} data-testid="q1-send-link">
          <span class="q1-opt__icon"><${Icon} name="link" size=${24} /></span>
          <span class="q1-opt__text"><span class="q1-opt__title">Copy the link</span><span class="q1-opt__sub">Paste it into any app you like. Marked as sent.</span></span>
          <${Icon} name="chevron-right" size=${20} />
        </button></li>
      </ul>
      <p class="q1-note q1-xdevice" data-testid="q1-send-xdevice"><${Icon} name="smartphone" size=${18} /><span>The link carries the quote, so it opens on any phone. In this prototype, accept and decline are saved on the phone they were tapped on.</span></p>
      <${SimBanner} compact>Nothing is really sent from this prototype. WhatsApp opens your own app with the message ready.<//>
    </div>
  <//>`;
}

/** "Open on my phone": the same link he sends, as a QR code, so a desktop screen hands the real customer page to his iPhone. */
function PhoneSheet({ open, link, total, first, onCopy, onClose }) {
  return html`<${Sheet} open=${open} title="Open on my phone" testid="q1-phone-sheet" onClose=${onClose}
    description=${`Scan this with your phone camera to see exactly what ${first} sees.`}>
    <div class="q1-phone">
      <div class="q1-phone__qr"><${QrCode} value=${link} size=${240} level="L" label=${`Opens the quote for ${first} on your phone`} data-testid="q1-phone-qr" /></div>
      <p class="q1-phone__total" data-testid="q1-phone-total">Quote total ${gbp(total)}</p>
      <p class="q1-note">The link carries the quote, so it opens on any phone. Accept and decline are saved on the phone they were tapped on in this prototype.</p>
      <div class="q1-phone__link"><a href=${link} target=${pageTarget('quote.html')} rel="noopener" data-testid="q1-phone-link">Open the link here instead</a></div>
      <${Button} variant="secondary" icon="copy" onClick=${onCopy} data-testid="q1-phone-copy">Copy the link<//>
    </div>
  <//>`;
}

const DECLINE_REASONS = ['Went with another installer', 'Too expensive', 'Not going ahead for now', 'Landlord said no'];

function DeclineSheet({ open, first, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (!open) setReason(''); }, [open]);
  const footer = html`<${Button} variant="danger" size="lg" block icon="circle-x" onClick=${() => onConfirm(reason.trim())} data-testid="q1-decline-confirm">Mark as declined<//>`;
  return html`<${Sheet} open=${open} title=${`${first} said no`} testid="q1-decline-sheet" onClose=${onClose} footer=${footer}
    description="Record it so your quotes and numbers stay true. You can add their reason.">
    <div class="q1-form">
      <div class="q1-chips" role="group" aria-label="Common reasons">
        ${DECLINE_REASONS.map((r) => html`<${Chip} key=${r} selected=${reason === r} onClick=${() => setReason(reason === r ? '' : r)} data-testid=${`q1-decline-chip-${DECLINE_REASONS.indexOf(r)}`}>${r}<//>`)}
      </div>
      <${Field} label="Their reason (optional)" id="q1-decline-reason">
        <${Input} id="q1-decline-reason" value=${reason} onInput=${(e) => setReason(e.target.value)} maxlength="200" autocomplete="off" data-testid="q1-decline-reason" />
      <//>
    </div>
  <//>`;
}

/** Owner override: the customer said yes on the phone. The install day is checked against the same open days the customer page offers. */
function AcceptSheet({ open, first, quoteId, onConfirm, onClose }) {
  const state = useStore(selectAll);
  const [date, setDate] = useState('');
  const [windowId, setWindowId] = useState(null);
  const [problem, setProblem] = useState('');
  useEffect(() => { if (!open) { setDate(''); setWindowId(null); setProblem(''); } }, [open]);

  const days = open ? getBookableDays(state, { serviceOrBlocks: 'ev' }).slice(0, 28) : [];
  const slots = open && date ? getDaySlots(state, date, 'ev').filter((s) => s.state !== 'closed') : [];
  const picked = windowId === null ? null : slots.find((s) => s.windowId === windowId && s.state === 'free') || null;
  const submit = () => {
    if (!picked) return;
    const res = onConfirm({ date, windowId });
    if (res && !res.ok) { setProblem(failText(res)); if (res.reason === 'slot_taken') setWindowId(null); }
  };
  const footer = html`<${Button} variant="primary" size="lg" block icon="calendar-check" disabled=${!picked} onClick=${submit} data-testid="q1-accept-confirm">Mark as accepted<//>`;
  const stateText = { free: 'Free', booked: 'Booked', blocked: 'Blocked', full: 'Full', past: 'Passed', too_soon: 'Too soon' };
  return html`<${Sheet} open=${open} title=${`${first} said yes`} testid="q1-accept-sheet" onClose=${onClose} footer=${footer}
    description="Pick the install day you agreed on the phone. It goes in your diary as pencilled in until you confirm it.">
    <div class="q1-form">
      <div class="q1-block">
        <p class="q1-cap" id="q1-accept-days-label">Pick a day (days customers can book)</p>
        <div class="q1-days" role="group" aria-labelledby="q1-accept-days-label">
          ${days.map((d, i) => {
            const dt = parseDayKey(d.date);
            const usable = d.status.kind === 'open' && d.freeSlots > 0;
            const monthTag = i === 0 || dt.getDate() === 1 ? MONTH_SHORT[dt.getMonth()] : '';
            return html`<button type="button" key=${d.date} class=${cx('q1-day', d.date === date && 'is-selected')} disabled=${!usable}
              aria-pressed=${d.date === date ? 'true' : 'false'} data-testid=${`q1-accept-day-${d.date}`}
              aria-label=${`${fmtDayLong(d.date)}${usable ? '' : ', not available'}`}
              onClick=${() => { setDate(d.date); setWindowId(null); setProblem(''); }}>
              <span class="q1-day__dow">${DAY_SHORT[weekdayOf(d.date)]}</span>
              <span class="q1-day__num">${dt.getDate()}</span>
              <span class="q1-day__mon">${monthTag}</span>
            </button>`;
          })}
        </div>
      </div>
      ${date ? html`<div class="q1-block">
        <p class="q1-cap">${fmtDayLong(date)}</p>
        <div class="q1-wins">
          ${slots.map((s) => html`<button type="button" key=${s.windowId} class=${cx('q1-win', s.windowId === windowId && 'is-selected')}
            disabled=${s.state !== 'free'} aria-pressed=${s.windowId === windowId ? 'true' : 'false'} data-testid=${`q1-accept-window-${s.windowId}`}
            onClick=${() => { setWindowId(s.windowId); setProblem(''); }}>
            <span class="q1-win__label">${s.label}</span><span class="q1-win__state">${stateText[s.state] || s.state}</span>
          </button>`)}
        </div>
      </div>` : null}
      ${problem ? html`<p class="q1-problem" role="alert" data-testid="q1-accept-problem"><${Icon} name="circle-alert" size=${18} /> ${problem}</p>` : null}
      <p class="q1-note">${first} gets the usual "quote accepted" message (simulated). Quote ${quoteId}.</p>
    </div>
  <//>`;
}

// ---------- the builder ----------

function Builder({ quote, booking, state, nowStampStr }) {
  const brand = useBrand();
  const wide = useMediaQuery('(min-width: 1100px)');
  const items = state.settings.quoteItems || [];
  const brands = state.settings.business.brands || [];
  const defaults = state.settings.quoteDefaults || { validDays: 30, notes: '' };
  const first = firstName(quote.customerName);
  const today = todayKey();

  const storedForm = formOf(quote);
  const storedSig = sigOf(storedForm);
  const status = quoteStatus(quote, nowStampStr);
  const editable = quote.status === 'draft' || quote.status === 'sent';

  const [form, setForm] = useState(storedForm);
  // baseSig is the stored version the form was last in step with. "Dirty" means edited HERE and not saved yet, so a change that
  // arrives from another tab is adopted (not mistaken for an unsaved edit, and never overwritten by autosave).
  const baseSig = useRef(storedSig);
  const formSig = sigOf(form);
  const dirty = editable && formSig !== baseSig.current;
  const view = editable ? form : storedForm;
  const total = quoteTotal({ lines: view.lines });

  const [saveState, setSaveState] = useState({ kind: 'idle', message: '' });
  const [sheet, setSheet] = useState(null);          // 'send' | 'accept' | 'decline' | 'delete' | 'phone' | 'menu' | { custom: lineId|null }
  const [showAllLines, setShowAllLines] = useState(false);
  const [customDate, setCustomDate] = useState(false); // the date picker sits behind "Custom"; it opens by itself for a date that is not 14, 30 or 60 days away
  const mounted = useRef(true);
  const live = useRef({});
  live.current = { form, formSig, dirty, editable, id: quote.id };
  const tap = useRef(null);
  if (!tap.current) tap.current = guardTap();

  useEffect(() => () => { mounted.current = false; }, []);

  /** Save what is on screen. Returns the store's result; { ok: true, noop: true } when nothing changed. */
  const persist = () => {
    const cur = live.current;
    if (!cur.editable) return { ok: true, noop: true };
    const stored = getState().quotes[cur.id];
    if (!stored) return { ok: false, reason: 'not_found' };
    if (cur.formSig === sigOf(formOf(stored))) { baseSig.current = cur.formSig; return { ok: true, noop: true }; }
    const f = cur.form;
    const res = updateQuote(cur.id, { brand: f.brand, lines: f.lines, notes: f.notes, validUntil: f.validUntil });
    if (res.ok) baseSig.current = cur.formSig;
    if (mounted.current) setSaveState(res.ok ? { kind: 'saved', message: '' } : { kind: 'error', message: failText(res) });
    return res;
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;

  // Autosave shortly after the last change, so a draft is never lost by leaving the page.
  useEffect(() => {
    if (!dirty) return undefined;
    const t = setTimeout(() => persistRef.current(), 700);
    return () => clearTimeout(t);
  }, [formSig, dirty]);

  // A change made elsewhere (another tab) is adopted unless something is being edited here.
  useEffect(() => {
    if (live.current.formSig !== baseSig.current || storedSig === baseSig.current) return;
    baseSig.current = storedSig;
    setForm(storedForm);
  }, [storedSig]);

  // Leaving the page or hiding the tab flushes pending edits.
  useEffect(() => {
    const flush = () => { if (live.current.dirty) persistRef.current(); };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', onHide); flush(); };
  }, []);

  // ----- edits -----
  const setLines = (fn) => setForm((f) => ({ ...f, lines: fn(f.lines) }));
  const patchLine = (id, patch) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLine = (id) => {
    const index = form.lines.findIndex((l) => l.id === id);
    const gone = form.lines[index];
    if (!gone) return;
    setLines((ls) => ls.filter((l) => l.id !== id));
    toast({
      message: `Removed ${gone.label}.`, actionLabel: 'Undo',
      onAction: () => setForm((f) => (f.lines.some((l) => l.id === gone.id) ? f : { ...f, lines: [...f.lines.slice(0, index), gone, ...f.lines.slice(index)] }))
    });
  };
  const addItem = (item) => setForm((f) => ({ ...f, lines: inMenuOrder([...f.lines, lineFromItem(item)], items, f.brand) }));
  const switchBrand = (next) => setForm((f) => {
    if (f.brand === next) return f;
    const chargers = items.filter((i) => i.kind === 'charger');
    const target = chargers.find((i) => i.brand === next);
    let lines = f.lines;
    if (target) {
      const at = lines.findIndex((l) => chargers.some((c) => c.label === l.label));
      if (at >= 0) lines = lines.map((l, i) => (i === at ? { ...l, label: target.label, detail: target.detail || '', unitPrice: target.unitPrice } : l));
      else lines = [lineFromItem(target), ...lines];
    }
    return { ...f, brand: next, lines };
  });
  const saveCustom = (data) => {
    const target = sheet && sheet.custom;
    if (target) patchLine(target, data);
    else setLines((ls) => [...ls, { id: makeId('ln'), ...data }]);
    setSheet(null);
  };
  const setValid = (day) => { if (day) setForm((f) => ({ ...f, validUntil: day })); };

  // ----- actions -----
  const canSend = view.lines.length > 0 && total > 0;
  const undoToast = (message, token, detail) => toast({
    message, detail, actionLabel: 'Undo', duration: 8000,
    onAction: () => { const res = undo(token); if (!res || !res.ok) toast({ message: 'Too late to undo.' }); }
  });
  const openSend = () => {
    const saved = persist();
    if (!saved.ok) { toast({ message: `Fix this before sending: ${failText(saved)}`, tone: 'danger' }); return; }
    if (editable && !canSend) { toast({ message: 'Add at least one line with a price first.', tone: 'danger' }); return; }
    setSheet('send');
  };
  const doSend = (via) => tap.current(() => {
    const res = sendQuote(quote.id, { via });
    if (!res.ok) { toast({ message: failText(res), tone: 'danger' }); return; }
    setSheet(null);
    const c = booking ? booking.customer : null;
    if (via === 'whatsapp' && c) {
      window.open(waLink(c.phone, res.message.body, brand.demoPhoneDigits), '_blank', 'noopener,noreferrer');
      undoToast('Logged as sent by WhatsApp (simulated).', res.undoToken, 'Your WhatsApp opened with the message ready to send.');
    } else if (via === 'email' && c) {
      toast({
        message: 'Logged as sent by email (simulated).', detail: 'Nothing was really sent. You can open it in your email app.', actionLabel: 'Open email', duration: 9000,
        onAction: () => { window.location.href = mailtoLink(c.email, `Your quote ${quote.id} from ${brand.name}`, res.message.body); }
      });
    } else {
      copyText(res.link).then((ok) => undoToast(ok ? 'Link copied. Marked as sent.' : 'Marked as sent. Copy the link from the Copy link action.', res.undoToken, ok ? res.link : undefined));
    }
  });
  // The link carries the quote itself (&d=...), so it opens on the customer's own phone, not only in this browser.
  const shareLink = () => quoteShareUrl(quote, { ownerFirst: brand.ownerFirst, postcode: booking && booking.address ? booking.address.postcode : '' });
  const doCopyLink = async () => {
    const link = shareLink();
    const ok = await copyText(link);
    toast({ message: ok ? 'Link copied.' : 'Could not copy. Select the link and copy it yourself.', detail: ok ? quoteUrl(quote.id) : link, tone: ok ? 'default' : 'danger' });
  };
  const doSaveDraft = () => {
    const res = persist();
    if (!res.ok) { toast({ message: failText(res), tone: 'danger' }); return; }
    toast({ message: 'Saved.', detail: 'You will find it under Quotes, Draft.', actionLabel: 'All quotes', onAction: () => navigate(routeHref('quotes')) });
  };
  const doDuplicate = () => tap.current(() => {
    const saved = persist();
    if (!saved.ok) { toast({ message: failText(saved), tone: 'danger' }); return; }
    const src = storedForm;
    const res = createQuote({ bookingId: quote.bookingId, brand: src.brand, lines: (editable ? form : src).lines, notes: (editable ? form : src).notes });
    if (!res.ok) { toast({ message: failText(res), tone: 'danger' }); return; }
    navigate(routeHref('quote-detail', { id: res.quote.id }));
    toast({ message: 'Copied into a new draft.', detail: quote.status === 'draft' || status === 'declined' || status === 'expired' ? undefined : 'The earlier quote is still out with them.' });
  });
  const doDelete = () => {
    setSheet(null);
    const res = deleteQuote(quote.id);
    if (!res.ok) { toast({ message: failText(res), tone: 'danger' }); return; }
    mounted.current = false;
    navigate(routeHref('quotes'), { replace: true });
    toast({
      message: 'Draft deleted.', actionLabel: 'Undo', duration: 8000,
      onAction: () => { const r = undo(res.undoToken); if (!r || !r.ok) toast({ message: 'Too late to undo.' }); }
    });
  };
  const doAccept = ({ date, windowId }) => {
    const res = acceptQuote(quote.id, { date, windowId });
    if (!res.ok) return res;
    setSheet(null);
    undoToast('Marked accepted. Install pencilled in.', res.undoToken, bookingWhen(res.booking));
    return res;
  };
  const doDecline = (reason) => {
    const res = declineQuote(quote.id, { reason, by: 'owner' });
    if (!res.ok) { toast({ message: failText(res), tone: 'danger' }); return; }
    setSheet(null);
    undoToast('Marked as declined.', res.undoToken);
  };
  const goBackToList = (e) => { e.preventDefault(); persistRef.current(); goBack(routeHref('quotes')); };

  // ----- derived view data -----
  const detail = selectQuoteDetail(state, quote.id, nowStampStr);
  const install = detail ? detail.installBooking : null;
  const { entries, others } = menuFor(view.lines, items, view.brand);
  const addable = entries.filter((e) => e.index < 0);
  const copy = statusCopy({ quote, status, first, nowStampStr, defaults, install });
  const expiresIn = diffDays(today, view.validUntil);
  const validText = expiresIn < 0 ? 'Past its last day' : expiresIn === 0 ? 'Last day is today' : `${plural(expiresIn, 'day', 'days')} from today`;
  const mention = guessBrand(booking, brands);
  // preview=1 tells the customer page this is you looking, so it does not count as them opening the quote.
  const previewHref = pageHref('quote.html', `#q=${encodeURIComponent(quote.id)}&preview=1`);
  // A quote that is out (or won) opens as a short read-only summary with one thing to do; the builder sits behind "Edit quote".
  const summaryMode = status === 'sent' || status === 'viewed' || status === 'accepted';
  const nudge = nudgeHref({ quote, booking, brand, total });

  const primary = (() => {
    if (status === 'draft') return { id: 'send', label: 'Send', icon: 'send', onClick: openSend, disabled: !canSend, testid: 'q1-send' };
    if (status === 'accepted') {
      return install
        ? { id: 'install', label: 'Open install booking', icon: 'calendar-check', href: routeHref('bookings', { id: install.id }), testid: 'q1-open-install' }
        : { id: 'enquiry', label: 'Open enquiry', icon: 'inbox', href: routeHref('bookings', { id: quote.bookingId }), testid: 'q1-open-enquiry' };
    }
    if (status === 'declined') return { id: 'again', label: 'Write a new version', icon: 'file-plus', onClick: doDuplicate, testid: 'q1-new-version' };
    if ((status === 'sent' || status === 'viewed') && nudge) return { id: 'chase', label: 'Nudge on WhatsApp', icon: 'message-circle', href: nudge, testid: 'q1-chase' };
    return { id: 'resend', label: 'Send again', icon: 'send', onClick: openSend, testid: 'q1-send' };
  })();
  const primaryButton = (block) => html`<${Button} variant="primary" size="lg" block=${block} icon=${primary.icon} href=${primary.href} onClick=${primary.onClick}
    disabled=${primary.disabled} data-testid=${primary.testid}>${primary.label}<//>`;

  // ----- sections -----
  const statusRow = html`<div class="q1-statusrow">
    <${QuotePill} status=${status} data-testid="q1-status" />
  </div>`;

  const statusCard = copy ? html`<${Card} class=${cx('q1-card', 'q1-status', `q1-status--${status}`)} aria-label="Where this quote is up to" data-testid="q1-status-card">
    <h2 class="q1-status__headline" data-testid="q1-headline">${copy.headline}</h2>
    <p class="q1-status__sub">${copy.sub}</p>
    <${Timeline} ariaLabel="Quote history" compact items=${timelineFor({ quote, status, first, booking, install })} data-testid="q1-timeline" />
    ${(status === 'sent' || status === 'viewed') ? html`<div class="q1-decide" role="group" aria-label=${`Heard back from ${first}?`}>
      <p class="q1-cap q1-decide__cap">Heard back from ${first}?</p>
      <${Button} variant="secondary" onClick=${() => setSheet('accept')} data-testid="q1-accept-phone">They said yes<//>
      <${Button} variant="secondary" onClick=${() => setSheet('decline')} data-testid="q1-decline-phone">They said no<//>
    </div>` : null}
    ${status !== 'draft' ? html`<${Button} variant="secondary" icon="qr-code" class="q1-phonebtn" onClick=${() => setSheet('phone')} data-testid="q1-open-phone">Open on my phone<//>` : null}
  <//>` : null;

  // The short version of the quote: total, the first three lines (all of them behind one clear row), what it is up to. Read only.
  const shownLines = showAllLines ? view.lines : view.lines.slice(0, 3);
  const moreLines = Math.max(0, view.lines.length - 3);
  const lineRows = shownLines.map((l) => html`<li key=${l.id}><span class="q1-sum__label">${l.label}${l.qty > 1 ? ` × ${l.qty}` : ''}${l.optional === true ? html`<span class="q1-line__extra q1-sum__extra">Possible extra. Not in the total.</span>` : null}</span><span class="q1-sum__amt">${gbp(quoteLineTotal(l))}</span></li>`);
  const summaryCard = summaryMode ? html`<${Card} class="q1-card q1-sum" aria-label="Quote summary" data-testid="q1-summary">
    <div class="q1-sum__top">
      ${wide ? html`<p class="q1-cap">Quote</p>` : html`<div class="q1-sum__totalwrap"><p class="q1-cap q1-sum__cap">Quote total <span class="ui-tag-sample q1-sample" data-testid="q1-sample-tag">Sample prices</span></p><p class="q1-sum__total" data-testid="q1-summary-total">${gbp(total)}</p></div>`}
      <${QuotePill} status=${status} data-testid="q1-status" />
    </div>
    <p class="q1-muted">${[brandLabel(view.brand), plural(view.lines.length, 'line', 'lines'), `valid until ${fmtDayShort(view.validUntil)}`].join(' · ')}</p>
    <ul class="q1-sum__items" data-testid="q1-summary-items">
      ${lineRows}
    </ul>
    ${moreLines > 0 ? html`<button type="button" class="q1-sum__toggle" aria-expanded=${showAllLines ? 'true' : 'false'} onClick=${() => setShowAllLines(!showAllLines)} data-testid="q1-summary-more">
      <span>${showAllLines ? 'Show fewer lines' : `Show all ${view.lines.length} lines`}</span><${Icon} name=${showAllLines ? 'chevron-up' : 'chevron-down'} size=${20} />
    </button>` : null}
  <//>` : null;

  const installCard = status === 'accepted' && install ? html`<${Card} class="q1-card q1-install" aria-label="Install booking" data-testid="q1-install-card">
    <p class="q1-cap">Install booking</p>
    <p class="q1-install__when">${bookingWhen(install)}</p>
    <p class="q1-muted">${install.ref} · ${isPencilled(install) || install.status === 'new' ? 'Pencilled in. Confirm it when you are ready.' : install.status === 'done' ? 'Installed.' : 'Confirmed.'}</p>
    <${Button} variant="secondary" icon="calendar-check" href=${routeHref('bookings', { id: install.id })} data-testid="q1-install-link">Open the install booking<//>
  <//>` : null;

  const brandSection = html`<section class="q1-section" aria-labelledby="q1-h-brand">
    <h2 class="q1-sectitle" id="q1-h-brand">Charger</h2>
    ${editable
      ? html`<${BrandPicker} brands=${brands} value=${view.brand} items=${items} onChange=${switchBrand} mention=${!view.brand || view.brand === mention ? undefined : mention} />`
      : html`<p class="q1-brandro" data-testid="q1-brand-readonly"><${Icon} name="plug-zap" size=${20} /> <strong>${brandLabel(view.brand)}</strong></p>`}
  </section>`;

  const linesSection = html`<section class="q1-section" aria-labelledby="q1-h-lines">
    <h2 class="q1-sectitle" id="q1-h-lines">What is included</h2>
    ${editable ? html`
      <p class="q1-lead">Tap an item to add it. Tap a price to change it.</p>
      <ul class="q1-lines" data-testid="q1-lines">
        ${entries.map((e) => (e.index >= 0
          ? html`<${LineCard} key=${view.lines[e.index].id} tid=${e.item.id} line=${view.lines[e.index]} item=${e.item}
              onPatch=${(p) => patchLine(view.lines[e.index].id, p)} onRemove=${() => removeLine(view.lines[e.index].id)} />`
          : html`<${AddRow} key=${e.item.id} item=${e.item} onAdd=${() => addItem(e.item)} />`))}
        ${others.map((i, k) => html`<${LineCard} key=${view.lines[i].id} tid=${`custom-${k}`} line=${view.lines[i]} item=${null}
          onPatch=${(p) => patchLine(view.lines[i].id, p)} onRemove=${() => removeLine(view.lines[i].id)} onEdit=${() => setSheet({ custom: view.lines[i].id })} />`)}
        <li class="q1-addrow"><button type="button" class="q1-add q1-add--custom" onClick=${() => setSheet({ custom: null })} data-testid="q1-add-custom">
          <span class="q1-add__plus" aria-hidden="true"><${Icon} name="pencil" size=${20} /></span>
          <span class="q1-add__text"><span class="q1-add__label">Add a custom line</span><span class="q1-add__hint">An extra, a one-off job or a discount</span></span>
        </button></li>
      </ul>
      ${view.lines.length === 0 ? html`<p class="q1-empty-lines" data-testid="q1-lines-empty">No lines yet. Tap the items above to build the quote.</p>` : null}
    ` : html`<${ReadOnlyLines} lines=${view.lines} />`}
  </section>`;

  // The sample terms are ghost text, not words in the box: until he writes his own, the box is empty, a one-line notice says which terms go out,
  // and the customer page already leaves the placeholder sentence out.
  const usingSampleTerms = editable && form.notes === (defaults.notes || '');
  const ghostTerms = (String(defaults.notes || '').match(/[^.!?]+[.!?]+\s*/g) || []).map((t) => t.trim()).filter((t) => !/sample terms|to be replaced/i.test(t)).join(' ') || 'Anything you want them to know about the job.';
  const notesSection = html`<section class="q1-section" aria-labelledby="q1-h-notes">
    <h2 class="q1-sectitle" id="q1-h-notes">Notes for ${first}</h2>
    ${editable ? html`
      <${Field} label="These appear on the quote" id="q1-notes">
        <${Textarea} id="q1-notes" rows=${4} maxlength="1500" value=${usingSampleTerms ? '' : form.notes}
          placeholder=${usingSampleTerms ? ghostTerms : 'Anything you want them to know. Leave it empty for none.'}
          onInput=${(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          data-testid="q1-notes" />
      <//>
      <div class="q1-notes__foot">
        ${usingSampleTerms
          ? html`<span class="q1-muted" data-testid="q1-notes-sample"><${Icon} name="info" size=${16} /> Using sample terms. Type to write your own.</span>`
          : form.notes !== (defaults.notes || '')
            ? html`<${Button} variant="ghost" size="sm" icon="rotate-ccw" onClick=${() => setForm((f) => ({ ...f, notes: defaults.notes || '' }))} data-testid="q1-notes-reset">Use my standard terms<//>`
            : null}
        ${form.notes.length > 1200 ? html`<span class="q1-muted u-tabular">${form.notes.length}/1500</span>` : null}
      </div>`
      : html`<p class="q1-notes-ro" data-testid="q1-notes-readonly">${view.notes || 'No notes.'}</p>`}
  </section>`;

  const presetDays = [14, 30, 60].filter((n) => form.validUntil === addDays(today, n));
  const showDate = customDate || presetDays.length === 0;
  const validSection = editable ? html`<section class="q1-section" aria-labelledby="q1-h-valid">
    <h2 class="q1-sectitle" id="q1-h-valid">Valid until</h2>
    <div class="q1-valid">
      <${Segmented} ariaLabel="How long the price holds" value=${showDate ? 'custom' : String(presetDays[0])} class="q1-validseg" data-testid="q1-valid"
        options=${[14, 30, 60].map((n) => ({ value: String(n), label: `${n} days`, testid: `q1-valid-${n}` })).concat([{ value: 'custom', label: 'Custom', testid: 'q1-valid-custom' }])}
        onChange=${(v) => { if (v === 'custom') { setCustomDate(true); return; } setCustomDate(false); setValid(addDays(today, Number(v))); }} />
      <p class="q1-muted q1-valid__day" data-testid="q1-valid-text">${fmtDayLong(view.validUntil)} (${validText})</p>
      ${showDate ? html`<${Field} label="Last day the price holds" id="q1-valid-date">
        <${Input} id="q1-valid-date" type="date" value=${form.validUntil} min=${today} onInput=${(e) => setValid(e.target.value)} data-testid="q1-valid-date" />
      <//>` : null}
    </div>
  </section>` : null;

  // One total on a phone (the bar at the bottom); the card with the big number is only for the wide layout, where there is no bar.
  const problemLine = editable && !canSend ? html`<p class="q1-problem" data-testid="q1-cannot-send"><${Icon} name="info" size=${18} /> Add at least one line with a price to send this quote.</p>` : null;
  const totalsCard = html`<${Card} class="q1-card q1-totals" aria-label="Quote total" data-testid="q1-totals">
    <p class="q1-cap q1-totals__cap">Quote total <span class="ui-tag-sample q1-sample" data-testid="q1-sample-tag">Sample prices</span></p>
    <p class="q1-totals__sum" data-testid="q1-total"><span key=${total} class="q1-bump">${gbp(total)}</span></p>
    <p class="q1-muted">${plural(view.lines.length, 'line', 'lines')} · ${brandLabel(view.brand)}</p>
    ${problemLine}
    <${SaveStatus} editable=${editable} dirty=${dirty} saveState=${saveState} status=${status} />
    ${wide ? html`<div class="q1-totals__actions">${primaryButton(true)}
      ${status === 'draft' ? html`<${Button} variant="secondary" size="lg" block icon="save" onClick=${doSaveDraft} data-testid="q1-save">Save draft<//>` : null}</div>` : null}
  <//>`;

  const canPreview = true;
  const actionRows = [
    canPreview ? html`<li key="preview"><a class="db-list__item q1-act" href=${previewHref} target=${pageTarget('quote.html')} data-testid="q1-preview"
      onClick=${() => { persist(); }}><${Icon} name="external-link" size=${22} /><span class="q1-act__text"><span class="q1-act__title">Preview as customer</span><span class="q1-act__sub">Opens their page in a new tab. It does not count as them opening it.</span></span></a></li>` : null,
    status !== 'draft' ? html`<li key="copy"><button type="button" class="db-list__item q1-act" onClick=${doCopyLink} data-testid="q1-copy-link">
      <${Icon} name="link" size=${22} /><span class="q1-act__text"><span class="q1-act__title">Copy customer link</span><span class="q1-act__sub">To paste into any message</span></span></button></li>` : null,
    status !== 'accepted' ? html`<li key="dup"><button type="button" class="db-list__item q1-act" onClick=${doDuplicate} data-testid="q1-duplicate">
      <${Icon} name="files" size=${22} /><span class="q1-act__text"><span class="q1-act__title">${status === 'draft' ? 'Duplicate' : 'Make a new version'}</span><span class="q1-act__sub">${status === 'draft' ? 'Copy it into another draft' : 'Copy it into a new draft you can change'}</span></span></button></li>` : null,
    quote.status === 'draft' ? html`<li key="del"><button type="button" class="db-list__item q1-act is-danger" onClick=${() => setSheet('delete')} data-testid="q1-delete">
      <${Icon} name="trash-2" size=${22} /><span class="q1-act__text"><span class="q1-act__title">Delete draft</span><span class="q1-act__sub">Asks first. You can undo straight after.</span></span></button></li>` : null
  ].filter(Boolean);
  // "..." menu for a quote that is out: send it again, copy it, preview it, or write a new version.
  const closeThen = (fn) => () => { setSheet(null); setTimeout(fn, 0); };
  const menuRows = [
    primary.id !== 'resend' && status !== 'accepted' ? { key: 'send', icon: 'send', title: 'Send again', sub: 'By WhatsApp, email or a link', testid: 'q1-send', onClick: closeThen(openSend) } : null,
    status !== 'accepted' ? { key: 'dup', icon: 'files', title: 'Make a new version', sub: 'Copy it into a new draft you can change', testid: 'q1-duplicate', onClick: closeThen(doDuplicate) } : null,
    { key: 'copy', icon: 'link', title: 'Copy customer link', sub: 'To paste into any message', testid: 'q1-copy-link', onClick: closeThen(doCopyLink) },
    { key: 'phone', icon: 'qr-code', title: 'Open on my phone', sub: 'Scan a code to see exactly what they see', testid: 'q1-open-phone-menu', onClick: closeThen(() => setSheet('phone')) },
    { key: 'preview', icon: 'external-link', title: 'Preview as customer', sub: 'Opens their page in a new tab. It does not count as them opening it.', testid: 'q1-preview', href: previewHref, onClick: () => { persist(); setSheet(null); } }
  ].filter(Boolean);
  const moreMenu = summaryMode ? html`<${Sheet} open=${sheet === 'menu'} title="More for this quote" testid="q1-menu-sheet" onClose=${() => setSheet(null)}>
    <ul class="q1-opts" aria-label="More actions">
      ${menuRows.map((r) => html`<li key=${r.key}>${r.href
        ? html`<a class="q1-opt" href=${r.href} target=${pageTarget('quote.html')} onClick=${r.onClick} data-testid=${r.testid}>
            <span class="q1-opt__icon"><${Icon} name=${r.icon} size=${24} /></span><span class="q1-opt__text"><span class="q1-opt__title">${r.title}</span><span class="q1-opt__sub">${r.sub}</span></span></a>`
        : html`<button type="button" class="q1-opt" onClick=${r.onClick} data-testid=${r.testid}>
            <span class="q1-opt__icon"><${Icon} name=${r.icon} size=${24} /></span><span class="q1-opt__text"><span class="q1-opt__title">${r.title}</span><span class="q1-opt__sub">${r.sub}</span></span></button>`}</li>`)}
    </ul>
  <//>` : null;
  const moreButton = summaryMode ? html`<${IconButton} icon="ellipsis" label="More actions for this quote" size="lg" onClick=${() => setSheet('menu')} data-testid="q1-more" />` : null;

  const actionsList = html`<section class="q1-section" aria-labelledby="q1-h-more">
    <h2 class="q1-sectitle" id="q1-h-more">More</h2>
    <ul class="db-list q1-acts" data-testid="q1-actions">${actionRows}</ul>
  </section>`;

  const draftTimeline = status === 'draft' ? html`<section class="q1-section" aria-labelledby="q1-h-hist">
    <h2 class="q1-sectitle" id="q1-h-hist">History</h2>
    <${Card} class="q1-card"><${Timeline} ariaLabel="Quote history" compact items=${timelineFor({ quote, status, first, booking, install })} data-testid="q1-timeline" /><//>
  </section>` : null;

  const frozen = quote.status === 'viewed' || quote.status === 'accepted' || quote.status === 'declined';
  const editSections = html`${brandSection}${linesSection}${notesSection}${validSection}${!wide && editable ? html`<div class="q1-bfoot">${problemLine}<${SaveStatus} editable=${editable} dirty=${dirty} saveState=${saveState} status=${status} /></div>` : null}`;
  const editQuote = summaryMode ? html`<${Disclosure} title=${editable ? 'Edit quote' : 'Full quote'} summary=${plural(view.lines.length, 'line', 'lines')} class="q1-edit" testid="q1-edit">
    <div class="q1-edit__body">
      <p class="q1-lead">${editable
        ? 'Anything you change shows on their link at once.'
        : status === 'accepted' ? 'This quote is accepted, so it is locked. Make a new version from the menu if the job changes.' : 'It is locked now they have opened it. Make a new version from the menu to change the price.'}</p>
      ${editSections}
    </div>
  <//>` : null;
  const liveTotal = editable ? html`<div class="q1-live" aria-hidden="true"><span class="q1-live__cap">Total</span><span class="q1-live__sum">${gbp(total)}</span></div>` : null;
  const page = wide
    ? html`<div class="q1-layout q1-layout--wide">
        <div class="q1-main">${liveTotal}${summaryMode ? null : statusRow}${summaryCard}${statusCard}<${CustomerCard} booking=${booking} quote=${quote} brand=${brand} />${installCard}${summaryMode ? editQuote : html`${brandSection}${linesSection}${notesSection}${validSection}`}</div>
        <aside class="q1-aside" aria-label="Total and actions">${totalsCard}${summaryMode ? null : actionsList}${draftTimeline}</aside>
      </div>`
    : summaryMode
      ? html`<div class="q1-layout">
          ${liveTotal}${summaryCard}${statusCard}${installCard}<${CustomerCard} booking=${booking} quote=${quote} brand=${brand} />${editQuote}
        </div>`
      : html`<div class="q1-layout">
          ${liveTotal}${statusRow}${statusCard}${installCard}<${CustomerCard} booking=${booking} quote=${quote} brand=${brand} />${brandSection}${linesSection}${notesSection}${validSection}<div class="q1-bfoot">${problemLine}<${SaveStatus} editable=${editable} dirty=${dirty} saveState=${saveState} status=${status} /></div>${actionsList}${draftTimeline}
        </div>`;

  return html`<div class=${cx('db-page', 'q1-page', 'q1-builder', frozen && 'is-frozen', summaryMode && 'is-summary')} data-testid="q1-builder" data-status=${status}>
    <${PageHeader} eyebrow=${html`<span class="u-mono">Quote ${quote.id}</span>`} title=${quote.customerName}
      back=${{ href: routeHref('quotes'), label: 'Back to quotes', onClick: goBackToList }} actions=${moreButton} />
    ${page}
    <p class="u-sr-only" role="status" aria-live="polite" data-testid="q1-live-total">Quote total ${gbp(total)}</p>

    ${wide ? null : html`<div class="db-sticky-actions q1-bar" data-testid="q1-bar">
      <div class="q1-bar__total"><span class="q1-bar__cap"><span class="u-sr-only">Total</span>${summaryMode ? 'Total' : html`<span class="ui-tag-sample q1-sample" data-testid="q1-sample-tag">Sample prices</span>`}</span><span class="q1-bar__sum" data-testid="q1-bar-total"><span key=${total} class="q1-bump">${gbp(total)}</span></span></div>
      ${status === 'draft' ? html`<${Button} variant="secondary" size="lg" icon="save" onClick=${doSaveDraft} class="q1-bar__save" aria-label="Save draft" data-testid="q1-save"><span class="q1-bar__savetext">Save draft</span><//>` : null}
      ${primaryButton(false)}
    </div>`}

    ${moreMenu}
    <${PhoneSheet} open=${sheet === 'phone'} link=${shareLink()} total=${total} first=${first} onCopy=${doCopyLink} onClose=${() => setSheet(null)} />
    <${SendSheet} open=${sheet === 'send'} quoteId=${quote.id} resend=${quote.status !== 'draft'} onPick=${doSend} onClose=${() => setSheet(null)} />
    <${CustomLineSheet} open=${!!(sheet && sheet.custom !== undefined)} line=${sheet && sheet.custom ? form.lines.find((l) => l.id === sheet.custom) || null : null}
      onSave=${saveCustom} onClose=${() => setSheet(null)} />
    <${DeclineSheet} open=${sheet === 'decline'} first=${first} onConfirm=${doDecline} onClose=${() => setSheet(null)} />
    <${AcceptSheet} open=${sheet === 'accept'} first=${first} quoteId=${quote.id} onConfirm=${doAccept} onClose=${() => setSheet(null)} />
    <${ConfirmDialog} open=${sheet === 'delete'} title="Delete this draft?" tone="danger" confirmLabel="Delete draft"
      body=${`Quote ${quote.id} for ${quote.customerName} will be removed. You can undo straight after.`} onConfirm=${doDelete} onCancel=${() => setSheet(null)} />
  </div>`;
}

// ---------- routes ----------

function QuoteScreen({ id }) {
  const state = useStore(selectAll);
  const nowDate = useNow(60000);
  const quote = own(state.quotes, id);
  if (!quote) return html`<${NotFound} what="quote" />`;
  const booking = state.bookings.find((b) => b.id === quote.bookingId) || null;
  return html`<${Builder} key=${quote.id} quote=${quote} booking=${booking} state=${state} nowStampStr=${toStamp(nowDate)} />`;
}

export default function QuoteDetailView({ route }) {
  const id = route.params.id;
  if (id === 'new') {
    return route.query.booking
      ? html`<${StartFromBooking} key=${route.query.booking} bookingId=${route.query.booking} />`
      : html`<${EnquiryPicker} />`;
  }
  return html`<${QuoteScreen} key=${id} id=${id} />`;
}
