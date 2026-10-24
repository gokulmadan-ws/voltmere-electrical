// js/dashboard/shared/story.js: the enquiry-to-install story of a journey as Timeline items (enquiry, survey, photos, quote, install, paid).
// Owner: E3
import { bookingWhen, isUnscheduled } from '../../core/availability.js';
import { fmtDayShort, stampDay, stampTime } from '../../core/dates.js';
import { PAID_METHOD_LABELS, QUOTE_VIA_LABELS } from '../../core/config.js';
import { gbp } from '../../core/format.js';
import { quoteStatus, quoteTotal } from '../../core/selectors.js';
import { leadOf, leadDetail } from './lead.js';
import { slaFor } from './sla.js';

export const stampText = (stamp) => (stamp ? `${fmtDayShort(stampDay(stamp))} ${stampTime(stamp)}` : '');
const priceOf = (b) => (b.finalPrice === null || b.finalPrice === undefined ? b.quotedPrice : b.finalPrice);

/**
 * Timeline items for { enquiry, quote, install } (from selectJourney). `photoRequestedAt` is the stamp of the latest photos-request
 * message for the enquiry or ''. Tones: done | current | upcoming | error | warn. Nothing after a lost enquiry.
 */
export function storyItems({ enquiry: e, quote: q, install: i }, { replyHours, nowStampStr, photoRequestedAt = '' }) {
  const items = [];
  if (!e) {
    // A standalone install (no enquiry): just the install steps.
    if (i) installItems(items, null, i);
    return items;
  }
  const lead = leadOf(e);
  items.push({
    id: 'enquiry', title: 'Enquiry received', time: stampText(e.createdAt), tone: 'done', testid: 'story-enquiry',
    detail: [`From ${lead.label}`, leadDetail(e)].filter(Boolean).join(' · ')
  });

  if (e.status === 'cancelled') {
    items.push({ id: 'survey', title: e.history && e.history.some((h) => h.event === 'declined') ? 'Declined' : 'Enquiry cancelled', tone: 'error', testid: 'story-survey',
      detail: e.cancelledBy === 'customer' ? 'The customer cancelled.' : '' });
    return items;
  }

  if (e.status === 'new') {
    const sla = slaFor(e, replyHours, nowStampStr);
    items.push({ id: 'survey', title: 'Reply and confirm the survey visit', tone: 'current', testid: 'story-survey',
      detail: [sla ? sla.label : '', e.tentative ? `Pencilled in ${bookingWhen(e)}` : ''].filter(Boolean).join(' · ') });
  } else if (e.status === 'done') {
    items.push({ id: 'survey', title: 'Survey visit done', tone: 'done', testid: 'story-survey', time: stampText((e.history || []).filter((h) => h.event === 'done').map((h) => h.at).pop() || '') });
  } else {
    items.push({ id: 'survey', title: `Survey visit ${bookingWhen(e)}`, tone: 'current', testid: 'story-survey', detail: e.status === 'on_the_way' ? 'On the way' : 'Confirmed' });
  }

  const photoCount = (e.photos || []).length;
  if (photoCount > 0) {
    items.push({ id: 'photos', title: `${photoCount} ${photoCount === 1 ? 'photo' : 'photos'} from the customer`, tone: 'done', testid: 'story-photos' });
  } else if (photoRequestedAt) {
    items.push({ id: 'photos', title: 'Photos requested', tone: 'info', time: stampText(photoRequestedAt), testid: 'story-photos', detail: 'Logged as a message (simulated). Waiting for them to reply.' });
  }

  const qs = q ? quoteStatus(q, nowStampStr) : null;
  const total = q ? gbp(quoteTotal(q)) : '';
  if (!q) {
    items.push({ id: 'quote', title: 'Write the quote', tone: e.status === 'done' ? 'current' : 'upcoming', testid: 'story-quote',
      detail: e.status === 'done' ? 'The survey is done. Build the quote from your price list.' : 'You can send a quote before or after the survey.' });
  } else if (qs === 'draft') {
    items.push({ id: 'quote', title: `Quote drafted, ${total}`, tone: 'current', time: stampText(q.createdAt), testid: 'story-quote', detail: 'Not sent yet.' });
  } else if (qs === 'sent') {
    items.push({ id: 'quote', title: `Quote sent, ${total}`, tone: 'current', time: stampText(q.sentAt), testid: 'story-quote',
      detail: `By ${QUOTE_VIA_LABELS[q.sentVia] || 'a link'} (simulated). Waiting for the customer to open it.` });
  } else if (qs === 'viewed') {
    items.push({ id: 'quote', title: `Customer opened the quote, ${total}`, tone: 'current', time: stampText(q.viewedAt), testid: 'story-quote', detail: 'Waiting for their answer.' });
  } else if (qs === 'accepted') {
    items.push({ id: 'quote', title: `Quote accepted, ${total}`, tone: 'done', time: stampText(q.acceptedAt), testid: 'story-quote' });
  } else if (qs === 'declined') {
    items.push({ id: 'quote', title: `Quote declined, ${total}`, tone: 'error', time: stampText(q.declinedAt), testid: 'story-quote', detail: q.declineReason || '' });
    return items;
  } else if (qs === 'expired') {
    items.push({ id: 'quote', title: `Quote expired, ${total}`, tone: 'warn', testid: 'story-quote', detail: 'It was not answered in time. You can write a new one.' });
    return items;
  }

  if (qs === 'accepted' || i) installItems(items, q, i);
  else items.push({ id: 'install', title: 'Install day', tone: 'upcoming', testid: 'story-install' }, { id: 'paid', title: 'Paid', tone: 'upcoming', testid: 'story-paid' });
  return items;
}

function installItems(items, q, i) {
  if (!i || i.status === 'cancelled') {
    items.push({ id: 'install', title: 'Install day to arrange', tone: 'current', testid: 'story-install', detail: i ? 'The pencilled install was cancelled.' : '' },
      { id: 'paid', title: 'Paid', tone: 'upcoming', testid: 'story-paid' });
    return;
  }
  if (i.status === 'new' && isUnscheduled(i)) {
    items.push({ id: 'install', title: 'Install day to arrange', tone: 'current', testid: 'story-install', detail: 'The customer said which days suit them (see their note). Agree a day, choose it, then confirm it.' });
  } else if (i.status === 'new') {
    items.push({ id: 'install', title: `Install pencilled in, ${bookingWhen(i)}`, tone: 'current', testid: 'story-install', detail: 'The customer picked this day. Confirm it to lock it in.' });
  } else if (i.status === 'done') {
    items.push({ id: 'install', title: 'Installed', tone: 'done', testid: 'story-install', time: stampText((i.history || []).filter((h) => h.event === 'done').map((h) => h.at).pop() || '') });
  } else {
    items.push({ id: 'install', title: `Install booked, ${bookingWhen(i)}`, tone: 'current', testid: 'story-install', detail: i.status === 'on_the_way' ? 'On the way' : 'Confirmed' });
  }
  if (i.status === 'done') {
    const method = i.paidMethod ? ` by ${(PAID_METHOD_LABELS[i.paidMethod] || i.paidMethod).toLowerCase()}` : '';
    items.push(i.paid
      ? { id: 'paid', title: `Paid ${gbp(priceOf(i))}${method}`, tone: 'done', testid: 'story-paid', time: stampText(i.paidAt) }
      : { id: 'paid', title: `${gbp(priceOf(i))} to collect`, tone: 'current', testid: 'story-paid' });
  } else {
    items.push({ id: 'paid', title: 'Paid', tone: 'upcoming', testid: 'story-paid' });
  }
}
