// js/quote/confirmed.js: what the customer sees once the quote is accepted ("Thanks <name>, quote accepted" with ONE status, "To be confirmed", then "You're all set" once the owner confirms), on the day and on every reload after.
// Owner: Q2 (customer quote page)
import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { Button } from '../ui/button.js';
import { Disclosure } from '../ui/sim.js';
import { cx, pageHref } from '../ui/util.js';
import { waLink } from '../core/messages.js';
import { DateBox, Footer, Hero, LinesCard, StepsCard } from './parts.js';
import { installText, installWhen, money, shownTotal } from './format.js';
import { downloadInstallIcs } from './install-ics.js';

/** The install booking's status in the customer's words: { id, label, icon, tone }. A day the owner has not confirmed yet has ONE status: "To be confirmed". */
export function installStatus(booking) {
  if (!booking) return { id: 'none', label: 'Day to be arranged', icon: 'hourglass', tone: 'wait' };
  switch (booking.status) {
    case 'confirmed': return { id: 'confirmed', label: 'Confirmed', icon: 'calendar-check', tone: 'ok' };
    case 'on_the_way': return { id: 'on_the_way', label: 'On the way', icon: 'navigation', tone: 'ok' };
    case 'done': return { id: 'done', label: 'Installed', icon: 'badge-check', tone: 'done' };
    case 'cancelled': return { id: 'cancelled', label: 'Cancelled', icon: 'calendar-x', tone: 'warn' };
    default: return { id: 'to_confirm', label: 'To be confirmed', icon: 'hourglass', tone: 'wait' };
  }
}

/** The headline and the line under it, for each state of the install day. */
export function confirmCopy(d, brand, status) {
  const first = d.customerFirst;
  switch (status.id) {
    case 'confirmed':
      return { eyebrow: 'Quote accepted', title: `You're all set, ${first}.`, lead: 'Your install day is confirmed. Everything is booked in.' };
    case 'on_the_way':
      return { eyebrow: 'Install day', title: 'We are on the way.', lead: 'We are heading to you now. Call if you need anything.' };
    case 'done':
      return { eyebrow: 'Installed', title: 'Your charger is installed.', lead: `Thanks for choosing ${brand.name}. If anything is not right, call us.` };
    case 'cancelled':
      return { eyebrow: 'Quote accepted', title: 'Your install day needs rearranging.', lead: 'The day you chose was cancelled. We will be in touch to find a new one, or you can call us.' };
    case 'none':
      return { eyebrow: 'Quote accepted', title: `Thank you, ${first}.`, lead: 'We will be in touch to arrange your install day.' };
    default:
      // The day they chose is waiting for our OK, so the headline does not say "all set".
      return { eyebrow: 'Quote accepted', title: `Thanks ${first}, quote accepted`, lead: 'We will confirm your install day with you by WhatsApp or phone.' };
  }
}

function InstallCard({ d, brand, settings, when, status }) {
  const booking = d.installBooking;
  const [saved, setSaved] = useState(false);
  const wa = waLink(brand.phone, installText(brand, d, when), brand.demoPhoneDigits);
  const canCalendar = !!booking && (status.id === 'to_confirm' || status.id === 'confirmed' || status.id === 'on_the_way');
  const addToCalendar = () => { if (downloadInstallIcs(booking, settings, d.quote)) setSaved(true); };
  return html`
    <section class="q2-card q2-install" aria-labelledby="q2-install-h" data-testid="q2-install">
      <div class="q2-install__head">
        <h2 class="q2-label" id="q2-install-h">Your install day</h2>
        <p class=${cx('q2-status', `q2-status--${status.tone}`)} data-testid="q2-install-status">${status.label}</p>
      </div>
      ${when
    ? html`
        <div class="q2-install__when">
          <${DateBox} dayKey=${when.dayKey} />
          <div>
            <p class="q2-install__day" data-testid="q2-install-day">${when.long}</p>
            <p class="q2-install__part" data-testid="q2-install-part">${when.part ? `${when.part}, arriving ${when.arrive}` : ''}</p>
          </div>
        </div>`
    : html`<p class="q2-install__part">We will be in touch to arrange a day.</p>`}
      <div class="q2-actions">
        ${canCalendar ? html`<${Button} variant="primary" size="lg" block icon="calendar-plus" onClick=${addToCalendar} data-testid="q2-ics">Add to calendar<//>` : null}
        ${saved ? html`<p class="q2-install__saved" role="status" data-testid="q2-ics-saved">Calendar file saved. Open it to add the day to your calendar.</p>` : null}
        <div class="q2-pair">
          <${Button} variant=${canCalendar ? 'secondary' : 'primary'} icon="phone" href=${brand.telHref} aria-label=${`Call us on ${brand.phone}`} data-testid="q2-call">Call us<//>
          <${Button} variant="secondary" icon="message-circle" href=${wa} data-testid="q2-whatsapp">WhatsApp<//>
        </div>
        <a class="lp-link q2-done" href=${pageHref('index.html')} aria-label=${`Done, back to the ${brand.name} home page`} data-testid="q2-done"><span>Done</span></a>
      </div>
    </section>
  `;
}

function nextSteps(d, brand, status, when) {
  const accepted = { title: 'Quote accepted', text: when ? `You accepted ${money(shownTotal(d))} and chose ${when.short}, ${when.part.toLowerCase()}.` : `You accepted ${money(shownTotal(d))}.` };
  const confirm = { title: 'We confirm your day', text: status.id === 'to_confirm' ? 'We will get in touch by WhatsApp or phone.' : 'Confirmed. You will not need to do anything else.' };
  const fit = { title: 'Your charger is installed', text: when && when.arrive ? `We arrive ${when.arrive}.` : 'On the day you agree with us.' };
  return { steps: [accepted, confirm, fit], done: status.id === 'to_confirm' ? 1 : 2 };
}

/** The accepted state: headline, the install day, what happens next, references, the quote itself. */
export function AcceptedView({ d, brand, settings }) {
  const booking = d.installBooking;
  const status = installStatus(booking);
  const when = installWhen(booking);
  const copy = confirmCopy(d, brand, status);
  const showSteps = status.id === 'to_confirm' || status.id === 'confirmed';
  const steps = nextSteps(d, brand, status, when);
  const ref = useRef(null);

  // The new headline takes focus (once per arrival), so a screen reader starts at the thank-you.
  useEffect(() => {
    const el = document.getElementById('q2-title');
    if (el) { try { el.focus({ preventScroll: true }); } catch (e) { /* not focusable */ } }
    window.scrollTo(0, 0);
  }, []);

  return html`
    <div class="q2-state" data-testid="q2-confirm" ref=${ref}>
      <${Hero} brand=${brand} variant="done" who=${d.customerFirst} eyebrow=${copy.eyebrow} title=${copy.title} lead=${copy.lead} titleTestid="q2-confirm-title" />
      <main class="q2-wrap q2-stack q2-pull" id="q2-main" tabindex="-1">
        <${InstallCard} d=${d} brand=${brand} settings=${settings} when=${when} status=${status} />
        ${showSteps ? html`<${StepsCard} brand=${brand} heading="What happens next" steps=${steps.steps} done=${steps.done} />` : null}
        <section class="q2-card q2-refs" aria-labelledby="q2-refs-h" data-testid="q2-refs">
          <h2 class="q2-h2" id="q2-refs-h">Your references</h2>
          <dl class="q2-kv">
            <div><dt>Quote</dt><dd class="u-mono" data-testid="q2-quote-ref">${d.quote.id}</dd></div>
            ${booking ? html`<div><dt>Install booking</dt><dd class="u-mono" data-testid="q2-install-ref">${booking.ref}</dd></div>` : null}
            ${d.quote.brand ? html`<div><dt>Charger</dt><dd>${d.quote.brand}</dd></div>` : null}
            <div class="q2-kv__sum"><dt>Total</dt><dd data-testid="q2-total">${money(shownTotal(d))}</dd></div>
          </dl>
        </section>
        <${Disclosure} title="Read your quote again" summary=${money(shownTotal(d))} testid="q2-quote-disclosure" class="q2-disclosure">
          <${LinesCard} d=${d} compact />
        <//>
        <p class="q2-simnote" data-proto data-testid="q2-simnote"><span><strong>Prototype.</strong> We are not really notified and no WhatsApp or email was sent. A live version would tell us straight away.</span></p>
      </main>
      <${Footer} brand=${brand} />
    </div>
  `;
}
