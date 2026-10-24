// js/dashboard/views/settings.js: Settings (business and brand, services and prices, hours and days off, rules and theme). Saves as you go.
// Owner: WP8
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import {
  BrandMark, Button, Card, Chip, Field, Icon, IconButton, Input, PageHeader, Select, Switch, ThemeToggle,
  showUndoToast, toast, useStore
} from '../../ui/index.js';
import {
  addDaysOff, removeDayOff, updateService, updateSettings
} from '../../core/store.js';
import { normalisePhone, plural } from '../../core/format.js';
import { selectServices, servicePriceLabel } from '../../core/selectors.js';
import { WINDOWS } from '../../core/config.js';
import { DAY_LONG, addDays, fmtDayShort, isDayKey, weekStart } from '../../core/dates.js';
import { todayKey } from '../../core/clock.js';

export const title = 'Settings';
export const css = ['css/settings.css'];

const FAIL_TEXT = 'That did not work: the diary changed. Please check and try again.';
const failToast = () => toast({ message: FAIL_TEXT, tone: 'danger' });

// Selectors live outside the components so useStore gets stable functions. Plain strings, so shallowEqual holds between saves.
const selectBiz = (state) => {
  const b = state.settings.business;
  return { name: b.name, shortName: b.shortName, ownerFirst: b.ownerFirstName, tagline: b.tagline, phone: b.phone, email: b.email, area: b.areaName, areaText: b.areaText };
};
const selectAllServices = (state) => selectServices(state, { activeOnly: false });
const selectHours = (state) => state.settings.hours;
const selectDaysOff = (state) => state.settings.daysOff;
const selectRules = (state) => ({
  lead: state.settings.leadMinutes, ahead: state.settings.maxDaysAhead,
  autoConfirm: state.settings.autoConfirm, emergencies: state.settings.takingEmergencies, reminders: state.settings.remindersOn
});

// ---------- one text field that saves as you type (when valid) and on blur ----------

/**
 * `value` is what the store holds. `check(text)` returns an error message or ''. `commit(text)` saves and returns
 * '' on success or an error message. Errors show on blur, or after a short pause while typing, so a half-typed
 * phone number does not shout at the owner.
 */
function EditField({ id, label, hint, value, check, commit, normalise, prefix, onDraft, ariaLabel, inputProps }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  const focused = useRef(false);
  const timer = useRef(null);
  const stored = useRef(value);

  // Follow the store (another tab, "Reset everything") unless the owner is typing here.
  useEffect(() => {
    stored.current = value;
    if (!focused.current) { setDraft(value); if (onDraft) onDraft(value); }
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const run = (raw, final) => {
    clearTimeout(timer.current);
    const text = raw.trim();
    const bad = check ? check(text) : '';
    if (bad) {
      if (final) setError(bad); else timer.current = setTimeout(() => setError(bad), 500);
      return;
    }
    setError('');
    const canon = normalise ? normalise(text) : text;
    if (canon !== stored.current) {
      const problem = commit(canon);
      if (problem) setError(problem); else stored.current = canon;
    }
    if (final) { setDraft(canon); if (onDraft) onDraft(canon); }
  };

  const onInput = (e) => {
    const next = e.target.value;
    setDraft(next);
    if (onDraft) onDraft(next);
    run(next, false);
  };
  const onFocus = () => { focused.current = true; };
  const onBlur = () => { focused.current = false; run(draft, true); };

  const input = html`<${Input} id=${id} value=${draft} onInput=${onInput} onFocus=${onFocus} onBlur=${onBlur}
    aria-label=${ariaLabel} data-testid=${id} ...${inputProps || {}} />`;
  return html`<${Field} label=${label} id=${id} hint=${hint} error=${error}>
    ${prefix ? html`<div class="st-money"><span class="st-money__prefix" aria-hidden="true">${prefix}</span>${input}</div>` : input}
  <//>`;
}

// ---------- A. Business and brand ----------

const requiredCheck = (text) => (text ? '' : "This can't be empty.");
const emailCheck = (text) => (!text || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? '' : 'Enter an email like dan@example.com');
const phoneCheck = (text) => (normalisePhone(text) ? '' : 'Enter a UK mobile like 07700 900412');

function BusinessSection({ onSaved }) {
  const biz = useStore(selectBiz);
  // The preview shows what is typed right now, before it is saved.
  const [live, setLive] = useState({});
  const draft = (key) => (live[key] !== undefined && String(live[key]).trim() ? String(live[key]).trim() : biz[key]);
  const track = (key) => (text) => setLive((l) => (l[key] === text ? l : { ...l, [key]: text }));

  // Save one business key. Returns '' or the store's message for that key.
  const saveBiz = (storeKey) => (text) => {
    const res = updateSettings({ business: { [storeKey]: text } });
    if (res.ok) { onSaved(); return ''; }
    return (res.errors && res.errors[storeKey]) || FAIL_TEXT;
  };
  // CONTRACT-GAP: the Area input edits areaName; areaText ("Marlbury and 15 miles around") keeps its tail and follows the new name.
  const saveArea = (text) => {
    const tail = biz.areaText.startsWith(biz.area) ? biz.areaText.slice(biz.area.length) : null;
    const patch = { areaName: text };
    if (tail !== null) patch.areaText = text + tail;
    const res = updateSettings({ business: patch });
    if (res.ok) { onSaved(); return ''; }
    return FAIL_TEXT;
  };

  return html`<section class="db-section" aria-labelledby="st-biz-title">
    <h2 class="db-section__title" id="st-biz-title">Business and brand</h2>
    <${Card} class="st-fields">
      <div class="st-fields st-fields--2">
        <${EditField} id="setting-business-name" label="Business name" value=${biz.name} check=${requiredCheck} commit=${saveBiz('name')} onDraft=${track('name')} inputProps=${{ autocomplete: 'organization' }} />
        <${EditField} id="setting-short-name" label="Short name" hint="Shown next to the logo" value=${biz.shortName} check=${requiredCheck} commit=${saveBiz('shortName')} onDraft=${track('shortName')} />
        <${EditField} id="setting-owner-first" label="Your first name" value=${biz.ownerFirst} check=${requiredCheck} commit=${saveBiz('ownerFirstName')} onDraft=${track('ownerFirst')} inputProps=${{ autocomplete: 'given-name' }} />
        <${EditField} id="setting-phone" label="Phone" value=${biz.phone} check=${phoneCheck} normalise=${normalisePhone} commit=${saveBiz('phone')} inputProps=${{ type: 'tel', inputmode: 'tel', autocomplete: 'tel' }} />
      </div>
      <${EditField} id="setting-tagline" label="Tagline" value=${biz.tagline} commit=${saveBiz('tagline')} onDraft=${track('tagline')} />
      <div class="st-fields st-fields--2">
        <${EditField} id="setting-email" label="Email" value=${biz.email} check=${emailCheck} commit=${saveBiz('email')} inputProps=${{ type: 'email', inputmode: 'email', autocomplete: 'email' }} />
        <${EditField} id="setting-area" label="Area" value=${biz.area} check=${requiredCheck} commit=${saveArea} />
      </div>
      <div class="st-preview" role="group" aria-label="Preview of your brand on the website" data-testid="setting-preview">
        <${BrandMark} size=${44} />
        <div class="st-preview__text">
          <p class="st-preview__label">Preview</p>
          <p class="st-preview__name">${draft('name')}</p>
          <p class="st-preview__tag">${draft('tagline') || biz.tagline}</p>
        </div>
        <span class="ui-btn ui-btn--primary st-preview__btn" aria-hidden="true">Book a visit</span>
      </div>
      <p class="st-note">Reviews, ratings and the registration line stay sample content after you rebrand.</p>
    <//>
  </section>`;
}

// ---------- B. Services and prices ----------

const priceCheck = (text) => (/^\d{1,5}$/.test(text) ? '' : 'Enter a whole number of pounds.');
const priceNormalise = (text) => String(parseInt(text, 10));

function PriceField({ id, label, ariaLabel, value, commit }) {
  return html`<${EditField} id=${id} label=${label} ariaLabel=${ariaLabel} prefix="£" value=${String(value)}
    check=${priceCheck} normalise=${priceNormalise}
    commit=${(text) => commit(parseInt(text, 10))} inputProps=${{ inputmode: 'numeric', pattern: '[0-9]*', enterkeyhint: 'done', autocomplete: 'off' }} />`;
}

function ServiceRow({ service, onSaved }) {
  // Save one patch to this service. Returns '' or an error message for the field.
  const save = (patch) => {
    const res = updateService(service.id, patch);
    if (res.ok) { onSaved(); return ''; }
    return (res.errors && res.errors.price) || FAIL_TEXT;
  };
  const setActive = (checked) => { if (save({ active: checked })) failToast(); };
  const byVariant = service.variants.length > 0;
  return html`<${Card} as="div" class=${`st-service${service.active ? '' : ' is-off'}`} role="group" aria-label=${service.name}>
    <div class="st-service__head">
      <h3 class="st-service__name">${service.name}</h3>
      <span class="st-service__price">${servicePriceLabel(service)}</span>
    </div>
    ${service.id === 'emergency' ? null : html`<div class="st-service__switch">
      <${Switch} id=${`svc-active-${service.id}`} checked=${service.active} label="Show on website" onChange=${setActive} data-testid=${`service-active-${service.id}`} />
    </div>`}
    ${service.priceType === 'free'
      ? html`<p class="st-free">Free visit, no price to set.</p>`
      : (byVariant
        ? html`<div class="st-variants">${service.variants.map((v) => html`<${PriceField} key=${v.id} id=${`service-variant-price-${v.id}`}
            label=${v.label} ariaLabel=${`${service.name}: ${v.label} price`} value=${v.price}
            commit=${(n) => save({ variants: [{ id: v.id, price: n }] })} />`)}</div>`
        : html`<${PriceField} id=${`service-price-${service.id}`} label="Price" ariaLabel=${`Price for ${service.name}`}
            value=${service.price} commit=${(n) => save({ price: n })} />`)}
  <//>`;
}

function ServicesSection({ onSaved }) {
  const services = useStore(selectAllServices);
  return html`<section class="db-section" aria-labelledby="st-svc-title">
    <h2 class="db-section__title" id="st-svc-title">Services and prices</h2>
    <p class="st-intro">Prices show on the website straight away. Whole pounds only.</p>
    <div class="st-services">${services.map((s) => html`<${ServiceRow} key=${s.id} service=${s} onSaved=${onSaved} />`)}</div>
  </section>`;
}

// ---------- C. Availability ----------

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first; 0 is Sunday (JS weekday numbers)
const LEAD_OPTIONS = [
  { value: '60', label: '1 hour' }, { value: '90', label: '90 minutes' }, { value: '120', label: '2 hours' },
  { value: '180', label: '3 hours' }, { value: '240', label: '4 hours' }
];
const AHEAD_OPTIONS = [7, 14, 21, 28].map((n) => ({ value: String(n), label: `${n} days` }));

function HoursGrid({ onSaved }) {
  const hours = useStore(selectHours);
  const toggle = (weekday, windowId) => {
    const next = hours.map((day) => day.slice());
    const open = next[weekday];
    const at = open.indexOf(windowId);
    if (at >= 0) open.splice(at, 1); else open.push(windowId);
    const res = updateSettings({ hours: next });
    if (res.ok) onSaved(); else failToast();
  };
  return html`<div class="st-hours">${WEEK_ORDER.map((wd) => {
    const open = hours[wd] || [];
    return html`<div class="st-hours__day" role="group" aria-label=${DAY_LONG[wd]} key=${wd}>
      <div class="st-hours__head">
        <span class="st-hours__name">${DAY_LONG[wd]}</span>
        ${open.length === 0 ? html`<span class="st-hours__closed">Closed</span>` : null}
      </div>
      <div class="st-hours__chips">${WINDOWS.map((w) => html`<${Chip} key=${w.id} selected=${open.includes(w.id)}
        onClick=${() => toggle(wd, w.id)} data-testid=${`hours-${wd}-${w.id}`}>${w.label}<//>`)}</div>
    </div>`;
  })}</div>`;
}

function DaysOff({ onSaved }) {
  const daysOff = useStore(selectDaysOff);
  const [date, setDate] = useState('');
  const [label, setLabel] = useState('Day off');
  const [error, setError] = useState('');
  const sorted = daysOff.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const add = (dates, name, msg) => {
    const res = addDaysOff(dates, name);
    if (!res.ok) { failToast(); return false; }
    onSaved();
    const booked = res.bookedCount > 0 ? ` ${plural(res.bookedCount, 'booked job')} stay${res.bookedCount === 1 ? 's' : ''} in your diary.` : '';
    if (res.added.length === 0) toast({ message: 'Those days are already off.' });
    else showUndoToast(`${msg}${booked}`, res.undoToken);
    return true;
  };
  const addOne = () => {
    if (!isDayKey(date)) { setError('Pick a date.'); return; }
    if (date < todayKey()) { setError('Pick today or a day in the future.'); return; }
    setError('');
    if (add([date], label.trim() || 'Day off', `${fmtDayShort(date)} is off.`)) { setDate(''); setLabel('Day off'); }
  };
  const tomorrow = () => { const d = addDays(todayKey(), 1); add([d], 'Day off', 'Tomorrow marked as a day off. Customers cannot book it.'); };
  const nextWeek = () => {
    const monday = addDays(weekStart(todayKey()), 7);
    const days = [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(monday, n));
    add(days, 'Holiday', 'Next week marked as days off.');
  };
  const remove = (off) => {
    const res = removeDayOff(off.id);
    if (!res.ok) { failToast(); return; }
    onSaved();
    showUndoToast(`${fmtDayShort(off.date)} is open again.`, res.undoToken);
  };

  return html`<div class="db-stack">
    <div data-testid="dayoff-list">
      ${sorted.length === 0
        ? html`<p class="st-dayoff-empty">No days off booked.</p>`
        : html`<ul class="st-dayoff-list">${sorted.map((off) => html`<li class="st-dayoff-item" key=${off.id} data-testid=${`dayoff-item-${off.id}`}>
          <span class="st-dayoff-item__text">
            <span class="st-dayoff-item__date">${fmtDayShort(off.date)}</span>
            <span class="st-dayoff-item__label">${off.label}</span>
          </span>
          <${IconButton} icon="x" label=${`Remove day off, ${fmtDayShort(off.date)}`} onClick=${() => remove(off)} data-testid=${`dayoff-remove-${off.id}`} />
        </li>`)}</ul>`}
    </div>
    <div class="st-quick">
      <${Button} size="sm" onClick=${tomorrow} data-testid="dayoff-tomorrow">Take tomorrow off<//>
      <${Button} size="sm" onClick=${nextWeek} data-testid="dayoff-next-week">Take next week off<//>
    </div>
    <div class="st-dayoff-add">
      <${Field} label="Date" id="dayoff-date" error=${error}>
        <${Input} id="dayoff-date" type="date" min=${todayKey()} value=${date} onInput=${(e) => { setDate(e.target.value); setError(''); }} data-testid="dayoff-date" />
      <//>
      <${Field} label="Label" id="dayoff-label">
        <${Input} id="dayoff-label" value=${label} maxlength="40" onInput=${(e) => setLabel(e.target.value)} data-testid="dayoff-label" />
      <//>
      <${Button} variant="primary" icon="calendar-x" onClick=${addOne} data-testid="dayoff-add">Add day off<//>
    </div>
  </div>`;
}

function AvailabilitySection({ onSaved }) {
  const rules = useStore(selectRules);
  const setNum = (key) => (e) => {
    const res = updateSettings({ [key]: Number(e.target.value) });
    if (res.ok) onSaved(); else failToast();
  };
  return html`<section class="db-section" aria-labelledby="st-avail-title">
    <h2 class="db-section__title" id="st-avail-title">Availability</h2>
    <${Card} class="db-stack">
      <p class="st-note">Tap the windows you work. The website calendar changes straight away.</p>
      <${HoursGrid} onSaved=${onSaved} />
      <div class="st-pair">
        <${Field} label="Minimum notice" id="setting-lead" hint="Customers cannot book a window that starts sooner than this.">
          <${Select} id="setting-lead" value=${String(rules.lead)} options=${LEAD_OPTIONS} onChange=${setNum('leadMinutes')} data-testid="setting-lead" />
        <//>
        <${Field} label="Book up to" id="setting-ahead" hint="How far ahead customers can book.">
          <${Select} id="setting-ahead" value=${String(rules.ahead)} options=${AHEAD_OPTIONS} onChange=${setNum('maxDaysAhead')} data-testid="setting-ahead" />
        <//>
      </div>
    <//>
    <h3 class="db-section__title st-sub">Days off</h3>
    <${Card}><${DaysOff} onSaved=${onSaved} /><//>
  </section>`;
}

// ---------- D. Rules and look ----------

function RulesSection({ onSaved }) {
  const rules = useStore(selectRules);
  const set = (patch) => { const res = updateSettings(patch); if (res.ok) onSaved(); else failToast(); };
  return html`<section class="db-section" aria-labelledby="st-rules-title">
    <h2 class="db-section__title" id="st-rules-title">Rules and look</h2>
    <${Card} class="st-rules">
      <${Switch} id="rule-auto" checked=${rules.autoConfirm} label="Confirm normal bookings instantly"
        description="Emergency requests and bookings outside your usual area always wait for you."
        onChange=${(c) => set({ autoConfirm: c })} data-testid="setting-auto-confirm" />
      <${Switch} id="rule-emergency" checked=${rules.emergencies} label="I'm taking emergency visits"
        description="Off hides the emergency request on your website."
        onChange=${(c) => set({ takingEmergencies: c })} data-testid="setting-emergencies" />
      <${Switch} id="rule-reminders" checked=${rules.reminders} label="Day-before reminders"
        onChange=${(c) => set({ remindersOn: c })} data-testid="setting-reminders" />
    <//>
    <h3 class="db-section__title st-sub">Appearance</h3>
    <${ThemeToggle} variant="segmented" />
  </section>`;
}

// ---------- the page ----------

export default function SettingsView() {
  const [saved, setSaved] = useState(false);
  const timer = useRef(null);
  const flash = () => {
    setSaved(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 2000);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  return html`<div class="db-page">
    <div class="st-saved-wrap">
      <span class=${`st-saved${saved ? ' is-visible' : ''}`} role="status" data-testid="setting-saved">${saved ? html`<${Icon} name="check" size=${18} /><span>Saved</span>` : null}</span>
    </div>
    <${PageHeader} title="Settings" subtitle="Changes save as you go and show on your website straight away." />
    <${BusinessSection} onSaved=${flash} />
    <${ServicesSection} onSaved=${flash} />
    <${AvailabilitySection} onSaved=${flash} />
    <${RulesSection} onSaved=${flash} />
  </div>`;
}
