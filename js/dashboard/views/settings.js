// js/dashboard/views/settings.js: Settings as a single-open accordion (business and brand, website photos, services, quote price list and terms, reply promise, hours, rules, theme). Saves as you go.
// Owner: E3 (v1 by WP8, website switches, credentials and brands by E2); accordion, photo upload and availability matrix by DASH
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import {
  BrandMark, Button, Card, ConfirmDialog, Field, Icon, IconButton, Disclosure, Input, PageHeader, SampleTag, Select, Switch, Textarea, ThemeToggle,
  cx, showUndoToast, toast, useStore
} from '../../ui/index.js';
import {
  addDaysOff, getState, removeDayOff, updateService, updateSettings
} from '../../core/store.js';
import { gbp, normalisePhone, plural } from '../../core/format.js';
import { selectImageUrl, selectServices, servicePriceLabel } from '../../core/selectors.js';
import { DEFAULT_IMAGES, IMAGE_KEYS, IMAGE_META, WINDOWS } from '../../core/config.js';
import { DAY_LONG, DAY_SHORT, addDays, fmtDayShort, isDayKey, weekStart } from '../../core/dates.js';
import { fileToWebsitePhoto } from '../shared/photos.js';
import { todayKey } from '../../core/clock.js';

export const title = 'Settings';
export const css = ['css/settings.css'];

const FAIL_TEXT = 'That did not work: the diary changed. Please check and try again.';
const FULL_TEXT = 'This device has no room left to save that. Free some space, or reset the demo in Demo tools.';
const failToast = (res) => toast({ message: res && res.reason === 'storage_full' ? FULL_TEXT : FAIL_TEXT, tone: 'danger' });

// Business lists (credentials, brands) are stored as arrays and edited as one comma-separated line.
const listText = (list) => (Array.isArray(list) ? list.join(', ') : String(list || ''));
const parseList = (text) => text.split(',').map((t) => t.trim()).filter(Boolean);
const listNormalise = (text) => parseList(text).join(', ');

// Selectors live outside the components so useStore gets stable functions. Plain strings, so shallowEqual holds between saves.
const selectBiz = (state) => {
  const b = state.settings.business;
  return {
    name: b.name, shortName: b.shortName, ownerFirst: b.ownerFirstName, tagline: b.tagline, phone: b.phone, email: b.email, area: b.areaName, areaText: b.areaText,
    address: typeof b.address === 'string' ? b.address : '',
    credentials: listText(b.credentials), brands: listText(b.brands)
  };
};
const selectAllServices = (state) => selectServices(state, { activeOnly: false });
const selectHours = (state) => state.settings.hours;
const selectDaysOff = (state) => state.settings.daysOff;
const selectItems = (state) => state.settings.quoteItems || [];
const selectQuoteDefaults = (state) => ({ validDays: String(state.settings.quoteDefaults.validDays), notes: state.settings.quoteDefaults.notes });
const selectReplyHours = (state) => (state.settings.sla ? state.settings.sla.replyHours : 24);
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
const emailCheck = (text) => (!text || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? '' : 'Enter an email like name@example.co.uk');
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
  // Save a comma-separated line as a list (credentials, brands).
  const saveBizList = (storeKey, text) => {
    const res = updateSettings({ business: { [storeKey]: parseList(text) } });
    if (res.ok) { onSaved(); return ''; }
    return (res.errors && res.errors[storeKey]) || FAIL_TEXT;
  };
  // CONTRACT-GAP: the Area input edits areaName; areaText ("Across Northern Ireland") keeps its tail and follows the new name.
  const saveArea = (text) => {
    const tail = biz.areaText.startsWith(biz.area) ? biz.areaText.slice(biz.area.length) : null;
    const patch = { areaName: text };
    if (tail !== null) patch.areaText = text + tail;
    const res = updateSettings({ business: patch });
    if (res.ok) { onSaved(); return ''; }
    return FAIL_TEXT;
  };

  return html`<${Card} class="st-fields" data-testid="settings-panel-business">
      <div class="st-fields st-fields--2">
        <${EditField} id="setting-business-name" label="Business name" value=${biz.name} check=${requiredCheck} commit=${saveBiz('name')} onDraft=${track('name')} inputProps=${{ autocomplete: 'organization' }} />
        <${EditField} id="setting-short-name" label="Short name" hint="Shown next to the logo" value=${biz.shortName} check=${requiredCheck} commit=${saveBiz('shortName')} onDraft=${track('shortName')} />
        <${EditField} id="setting-owner-first" label="Your first name" value=${biz.ownerFirst} check=${requiredCheck} commit=${saveBiz('ownerFirstName')} onDraft=${track('ownerFirst')} inputProps=${{ autocomplete: 'given-name' }} />
        <${EditField} id="setting-phone" label="Phone" value=${biz.phone} check=${phoneCheck} normalise=${normalisePhone} commit=${saveBiz('phone')} inputProps=${{ type: 'tel', inputmode: 'tel', autocomplete: 'tel' }} />
      </div>
      <${EditField} id="setting-tagline" label="Tagline" value=${biz.tagline} commit=${saveBiz('tagline')} onDraft=${track('tagline')} />
      <${EditField} id="settings-credentials" label="Credentials" hint="Comma separated. Shown in the trust bar on the website. Leave empty to hide it."
        value=${biz.credentials} normalise=${listNormalise} commit=${(text) => saveBizList('credentials', text)} />
      <${EditField} id="settings-brands" label="Charger brands we install" hint="Comma separated. Shown as plain text on the website."
        value=${biz.brands} normalise=${listNormalise} commit=${(text) => saveBizList('brands', text)} />
      <div class="st-fields st-fields--2">
        <${EditField} id="setting-email" label="Email" value=${biz.email} check=${emailCheck} commit=${saveBiz('email')} inputProps=${{ type: 'email', inputmode: 'email', autocomplete: 'email' }} />
        <${EditField} id="setting-area" label="Area" value=${biz.area} check=${requiredCheck} commit=${saveArea} />
      </div>
      <${EditField} id="setting-address" label="Address (optional)" hint="Add your address to show it in your site footer"
        value=${biz.address} commit=${saveBiz('address')} inputProps=${{ autocomplete: 'street-address', placeholder: 'Left empty: the footer says Serving Northern Ireland' }} />
      <div class="st-preview" role="group" aria-label="Preview of your brand on the website" data-testid="setting-preview">
        <${BrandMark} size=${44} />
        <div class="st-preview__text">
          <p class="st-preview__label">Preview</p>
          <p class="st-preview__name">${draft('name')}</p>
          <p class="st-preview__tag">${draft('tagline') || biz.tagline}</p>
        </div>
        <span class="ui-btn ui-btn--primary st-preview__btn" aria-hidden="true">Get my installation quote</span>
      </div>
      <p class="st-note">Your website shows no reviews, so none are added. Credentials and charger brands appear on the website as typed.</p>
    <//>`;
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
  // The website switch is the service's showOnWebsite flag; an older store without the flag falls back to `active`.
  const hasFlag = service.showOnWebsite !== undefined;
  const onWebsite = hasFlag ? !!service.showOnWebsite : !!service.active;
  const setWebsite = (checked) => { if (save(hasFlag ? { showOnWebsite: checked } : { active: checked })) failToast(); };
  const byVariant = service.variants.length > 0;
  const quoted = service.priceType === 'quoted' || service.priceType === 'quote';
  return html`<${Card} as="div" class=${`st-service${onWebsite ? '' : ' is-off'}`} role="group" aria-label=${service.name}>
    <div class="st-service__head">
      <h3 class="st-service__name">${service.name}</h3>
      <span class="st-service__price">${servicePriceLabel(service)}</span>
    </div>
    ${service.id === 'emergency' ? html`<p class="st-free">Follows the emergency rule below, which is off by default.</p>` : html`<div class="st-service__switch">
      <${Switch} id=${`svc-active-${service.id}`} checked=${onWebsite} label="Show on website"
        description=${onWebsite ? 'Customers can pick this on your website.' : 'Not on your website. You can still book it from the dashboard.'}
        onChange=${setWebsite} data-testid=${`service-active-${service.id}`} />
    </div>`}
    ${service.priceType === 'free'
      ? html`<p class="st-free">Free visit, no price to set.</p>`
      : (byVariant
        ? html`<div class="st-variants">${service.variants.map((v) => html`<${PriceField} key=${v.id} id=${`service-variant-price-${v.id}`}
            label=${v.label} ariaLabel=${`${service.name}: ${v.label} price`} value=${v.price}
            commit=${(n) => save({ variants: [{ id: v.id, price: n }] })} />`)}</div>`
        : html`<${PriceField} id=${`service-price-${service.id}`} label=${quoted ? 'Starting price' : 'Price'} ariaLabel=${`Price for ${service.name}`}
            value=${service.price} commit=${(n) => save({ price: n })} />
          ${quoted ? html`<p class="st-free">Used as the starting price when you book it. The website never shows a price for it.</p>` : null}`)}
  <//>`;
}

function ServicesSection({ onSaved }) {
  const services = useStore(selectAllServices);
  const main = services.filter((s) => s.id === 'ev_quote' || s.id === 'ev');
  const other = services.filter((s) => s.id !== 'ev_quote' && s.id !== 'ev');
  return html`<div class="st-panel" data-testid="settings-panel-services">
    <p class="st-intro">Your website offers the free survey visit and a quote for each home. Switch a service on to show it there. Whole pounds only.</p>
    <div class="st-services">${main.map((s) => html`<${ServiceRow} key=${s.id} service=${s} onSaved=${onSaved} />`)}</div>
    ${other.length > 0 ? html`<div class="st-other"><${Disclosure} title="Other jobs" summary=${`${other.length} you can still book by phone`} testid="settings-other-services">
      <p class="st-intro">Your website only sells EV charger quotes. These older job types stay here for work you take by phone, with their own prices.</p>
      <div class="st-services">${other.map((s) => html`<${ServiceRow} key=${s.id} service=${s} onSaved=${onSaved} />`)}</div>
    <//></div>` : null}
  </div>`;
}

// ---------- C. Availability ----------

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first; 0 is Sunday (JS weekday numbers)
const LEAD_OPTIONS = [
  { value: '60', label: '1 hour' }, { value: '90', label: '90 minutes' }, { value: '120', label: '2 hours' },
  { value: '180', label: '3 hours' }, { value: '240', label: '4 hours' }
];
const AHEAD_OPTIONS = [7, 14, 21, 28].map((n) => ({ value: String(n), label: `${n} days` }));

/**
 * The week as a small matrix: Monday to Sunday down the side, the four arrival windows across. A tap on a cell opens or closes that window;
 * an open window is a neutral cell with a check (the colour never carries the meaning, and nothing here is brand red).
 */
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
  return html`<div class="st-matrix" role="group" aria-label="Which windows you work" data-testid="settings-hours">
    <div class="st-matrix__row st-matrix__row--head" aria-hidden="true">
      <span></span>${WINDOWS.map((w) => html`<span class="st-matrix__win" key=${w.id}>${w.short}</span>`)}
    </div>
    ${WEEK_ORDER.map((wd) => {
      const open = hours[wd] || [];
      return html`<div class="st-matrix__row" role="group" aria-label=${DAY_LONG[wd]} key=${wd}>
        <span class="st-matrix__day">${DAY_SHORT[wd]}${open.length === 0 ? html`<span class="st-matrix__closed">Closed</span>` : null}</span>
        ${WINDOWS.map((w) => {
          const on = open.includes(w.id);
          return html`<button type="button" key=${w.id} class=${cx('st-cell', on && 'is-on')} aria-pressed=${on ? 'true' : 'false'}
            aria-label=${`${DAY_LONG[wd]} ${w.label}`} onClick=${() => toggle(wd, w.id)} data-testid=${`hours-${wd}-${w.id}`}>
            ${on ? html`<${Icon} name="check" size=${18} />` : null}
          </button>`;
        })}
      </div>`;
    })}
  </div>`;
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
      <${Field} label="Pick a date" id="dayoff-date" error=${error}>
        <div class=${cx('st-date', !date && 'is-empty')}>
          <${Input} id="dayoff-date" type="date" min=${todayKey()} value=${date} onInput=${(e) => { setDate(e.target.value); setError(''); }} data-testid="dayoff-date" />
          ${!date ? html`<span class="st-date__ph" aria-hidden="true">Tap to choose the day</span>` : null}
        </div>
      <//>
      <${Field} label="Reason (optional)" id="dayoff-label">
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
  return html`<div class="st-panel" data-testid="settings-panel-availability">
    <${Card} class="db-stack">
      <p class="st-note">Tap the windows you work. The calendar on this prototype's page changes straight away.</p>
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
  </div>`;
}

// ---------- D. Rules and look ----------

function RulesSection({ onSaved }) {
  const rules = useStore(selectRules);
  const set = (patch) => { const res = updateSettings(patch); if (res.ok) onSaved(); else failToast(); };
  return html`<div class="st-panel" data-testid="settings-panel-rules">
    <${Card} class="st-rules">
      <${Switch} id="rule-auto" checked=${rules.autoConfirm} label="Confirm other bookings instantly"
        description="Website enquiries (free survey visits) always wait for you to confirm, whatever this says."
        onChange=${(c) => set({ autoConfirm: c })} data-testid="setting-auto-confirm" />
      <${Switch} id="rule-emergency" checked=${rules.emergencies} label="I'm taking emergency visits"
        description="Off by default: your website only offers EV charger quotes. On adds the emergency request to your website."
        onChange=${(c) => set({ takingEmergencies: c })} data-testid="setting-emergencies" />
      <${Switch} id="rule-reminders" checked=${rules.reminders} label="Day-before reminders"
        onChange=${(c) => set({ remindersOn: c })} data-testid="setting-reminders" />
    <//>
    <h3 class="db-section__title st-sub">Appearance</h3>
    <${ThemeToggle} variant="segmented" />
  </div>`;
}

// ---------- Website photos ----------

const urlCheck = (text) => (!text || /^https:\/\/\S+$/.test(text) || /^[\w./-]+$/.test(text) ? '' : 'Use a web address that starts with https://');

/**
 * One of his photos: a thumbnail and "Change photo" (a picture from the phone, shrunk to about 1200px and saved with the settings, so the website
 * shows it after a reload). The raw web address is a developer thing, so it sits under "Advanced".
 */
function ImageTile({ imgKey, onSaved }) {
  const meta = IMAGE_META[imgKey];
  const stored = useStore((state) => state.settings.business.images[imgKey]);
  const src = useStore((state) => selectImageUrl(state, imgKey, { width: 240 }));
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => { setFailed(false); }, [src]);
  const isOriginal = stored === DEFAULT_IMAGES[imgKey];
  const isUpload = typeof stored === 'string' && stored.startsWith('data:');
  const commit = (text) => {
    const res = updateSettings({ business: { images: { [imgKey]: text } } });
    if (res.ok) { onSaved(); return ''; }
    if (res.reason === 'storage_full') return FULL_TEXT;
    return (res.errors && res.errors[`images.${imgKey}`]) || FAIL_TEXT;
  };
  const onFile = async (e) => {
    const file = (e.target.files || [])[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const url = await fileToWebsitePhoto(file, { maxSide: 1200 });
      const problem = commit(url);
      if (problem) toast({ message: problem, tone: 'danger' });
      else toast({ message: `${meta.label} changed. It shows on your website straight away.` });
    } catch (err) {
      toast({ message: 'That photo could not be read. Try another one.', tone: 'danger' });
    }
    setBusy(false);
  };
  const hint = isOriginal ? 'The photo from your current website' : isUpload ? 'A photo from your phone' : 'Your own photo address';
  return html`<${Card} as="div" class="st-img" role="group" aria-label=${meta.label} data-testid=${`image-tile-${imgKey}`}>
    <div class=${`st-img__preview${imgKey === 'logo' ? ' is-logo' : ''}`} data-testid=${`setting-image-preview-${imgKey}`}>
      ${failed
        ? html`<span class="st-img__missing"><${Icon} name="image" size=${24} /><span>Not loading</span></span>`
        : html`<img src=${src} alt=${`Preview: ${meta.alt}`} loading="lazy" decoding="async" referrerpolicy="no-referrer" onError=${() => setFailed(true)} />`}
    </div>
    <div class="st-img__fields">
      <div class="st-img__title">
        <p class="st-img__name">${meta.label}</p>
        <p class="st-img__hint">${hint}</p>
      </div>
      <div class="st-img__btns">
        <${Button} size="sm" icon="camera" disabled=${busy} onClick=${() => fileRef.current && fileRef.current.click()} data-testid=${`setting-image-change-${imgKey}`}>${busy ? 'Saving' : 'Change photo'}<//>
        ${isOriginal ? null : html`<${Button} size="sm" variant="ghost" icon="rotate-ccw" onClick=${() => { const p = commit(''); if (p) toast({ message: p, tone: 'danger' }); }} data-testid=${`setting-image-reset-${imgKey}`}>Back to the original<//>`}
        <input ref=${fileRef} type="file" accept="image/*" hidden onChange=${onFile} data-testid=${`setting-image-file-${imgKey}`} />
      </div>
    </div>
    <${Disclosure} class="st-img__adv" title="Advanced" summary="Web address" testid=${`image-advanced-${imgKey}`}>
      ${isUpload
        ? html`<p class="st-note">This photo is saved from your phone. Paste a web address here to use a hosted photo instead, or clear it to go back to the original.</p>` : null}
      <${EditField} id=${`setting-image-${imgKey}`} label=${`${meta.label} web address`} value=${isUpload ? '' : stored} check=${urlCheck} commit=${commit}
        hint="Paste a link that starts with https://" inputProps=${{ type: 'url', inputmode: 'url', autocapitalize: 'none', autocomplete: 'off', placeholder: 'https://' }} />
    <//>
  <//>`;
}

function ImagesSection({ onSaved }) {
  return html`<div class="st-panel" data-testid="settings-images">
    <p class="st-intro">These are the photos on your website. Tap Change photo to pick one from your phone. A real build stores your photos on its own hosting.</p>
    <div class="st-imgs">${IMAGE_KEYS.map((k) => html`<${ImageTile} key=${k} imgKey=${k} onSaved=${onSaved} />`)}</div>
  </div>`;
}

// ---------- Quote price list, terms and reply promise ----------

const qtyCheck = (text) => (/^\d{1,3}$/.test(text) && Number(text) >= 1 ? '' : 'Enter a whole number from 1 to 999.');
const requiredText = (text) => (text ? '' : "This can't be empty.");

/** Replace one catalogue line (read fresh from the store, so a fast second edit never overwrites the first). */
function patchItem(id, patch, onSaved) {
  const items = getState().settings.quoteItems;
  const res = updateSettings({ quoteItems: items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  if (res.ok) { onSaved(); return ''; }
  return typeof (res.errors && res.errors.quoteItems) === 'string' ? res.errors.quoteItems : FAIL_TEXT;
}

function QuoteItemRow({ item, open, onSaved, onRemove }) {
  const per = item.unit === 'metre' ? 'per metre' : 'each';
  return html`<details class="st-item" open=${open || undefined} data-testid=${`quote-item-${item.id}`}>
    <summary class="st-item__sum">
      <span class="st-item__text">
        <span class="st-item__label">${item.label}</span>
        <span class="st-item__sub u-tabular">${`${gbp(item.unitPrice)} ${per} · sample price${item.suggested ? ' · in new quotes' : ''}${item.optional === true ? ' · possible extra' : ''}`}</span>
      </span>
      <${Icon} name="chevron-down" size=${20} class="st-item__chev" />
    </summary>
    <div class="st-item__body">
      <${EditField} id=${`quote-item-label-${item.id}`} label="Name on the quote" value=${item.label} check=${requiredText}
        commit=${(text) => patchItem(item.id, { label: text }, onSaved)} inputProps=${{ maxlength: 80 }} />
      <${EditField} id=${`quote-item-detail-${item.id}`} label="Extra line (optional)" value=${item.detail || ''}
        commit=${(text) => patchItem(item.id, { detail: text }, onSaved)} inputProps=${{ maxlength: 120 }} />
      <div class="st-pair">
        <${PriceField} id=${`quote-item-price-${item.id}`} label=${`Sample price (${per})`} ariaLabel=${`Price for ${item.label}`} value=${item.unitPrice}
          commit=${(n) => patchItem(item.id, { unitPrice: n }, onSaved)} />
        <${EditField} id=${`quote-item-qty-${item.id}`} label="Starts at (quantity)" value=${String(item.defaultQty)} check=${qtyCheck}
          normalise=${(t) => String(parseInt(t, 10))} commit=${(text) => patchItem(item.id, { defaultQty: parseInt(text, 10) }, onSaved)}
          inputProps=${{ inputmode: 'numeric', pattern: '[0-9]*' }} />
      </div>
      <${Field} label="Priced" id=${`quote-item-unit-${item.id}`}>
        <${Select} id=${`quote-item-unit-${item.id}`} value=${item.unit} onChange=${(e) => { if (patchItem(item.id, { unit: e.target.value }, onSaved)) failToast(); }}
          options=${[{ value: 'each', label: 'Each' }, { value: 'metre', label: 'Per metre' }]} />
      <//>
      <${Switch} id=${`quote-item-suggested-${item.id}`} checked=${!!item.suggested} label="Include in every new quote"
        description="Switched off, it is still in the list when you build a quote."
        onChange=${(c) => { if (patchItem(item.id, { suggested: c }, onSaved)) failToast(); }} data-testid=${`quote-item-suggested-${item.id}`} />
      <${Switch} id=${`quote-item-optional-${item.id}`} checked=${item.optional === true} label="Possible extra"
        description="Listed on the quote, but not added into the total. For work that may or may not be needed."
        onChange=${(c) => { if (patchItem(item.id, { optional: c }, onSaved)) failToast(); }} data-testid=${`quote-item-optional-${item.id}`} />
      <${Button} variant="ghost" icon="trash-2" class="st-item__remove" onClick=${() => onRemove(item)} data-testid=${`quote-item-remove-${item.id}`}>Remove from the list<//>
    </div>
  </details>`;
}

function NotesField({ onSaved }) {
  const q = useStore(selectQuoteDefaults);
  const [text, setText] = useState(q.notes);
  const [error, setError] = useState('');
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(q.notes); }, [q.notes]);
  const save = () => {
    focused.current = false;
    if (text.trim() === q.notes) return;
    const res = updateSettings({ quoteDefaults: { notes: text } });
    if (res.ok) { setError(''); onSaved(); } else setError((res.errors && res.errors.notes) || FAIL_TEXT);
  };
  return html`<${Field} label="Terms on every quote" id="setting-quote-notes" error=${error}
    hint="Sample wording. Replace it with your own terms: payment, validity, what is not included.">
    <${Textarea} id="setting-quote-notes" rows=${5} maxlength="1500" value=${text} onInput=${(e) => setText(e.target.value)}
      onFocus=${() => { focused.current = true; }} onBlur=${save} data-testid="setting-quote-notes" />
  <//>`;
}

function QuotesSection({ onSaved }) {
  const items = useStore(selectItems);
  const defaults = useStore(selectQuoteDefaults);
  const replyHours = useStore(selectReplyHours);
  const [openId, setOpenId] = useState('');
  const [removing, setRemoving] = useState(null);

  const add = () => {
    const before = getState().settings.quoteItems;
    const res = updateSettings({ quoteItems: [...before, { label: 'New item', detail: '', unit: 'each', unitPrice: 0, defaultQty: 1, kind: 'extra', suggested: false }] });
    if (!res.ok) { failToast(); return; }
    onSaved();
    const added = res.settings.quoteItems[res.settings.quoteItems.length - 1];
    if (added) setOpenId(added.id);
  };
  const remove = () => {
    const item = removing;
    setRemoving(null);
    if (!item) return;
    const before = getState().settings.quoteItems;
    const res = updateSettings({ quoteItems: before.filter((it) => it.id !== item.id) });
    if (!res.ok) { failToast(); return; }
    onSaved();
    toast({ message: `${item.label} removed from your price list.`, actionLabel: 'Undo', onAction: () => { updateSettings({ quoteItems: before }); onSaved(); } });
  };
  const setSla = (e) => {
    const res = updateSettings({ sla: { replyHours: Number(e.target.value) } });
    if (res.ok) onSaved(); else failToast();
  };
  const hours = [2, 4, 8, 12, 24, 48, 72];
  if (!hours.includes(replyHours)) hours.push(replyHours);
  hours.sort((a, b) => a - b);

  return html`<div class="st-panel" id="st-quotes" data-testid="settings-quotes">
    <${Card} class="db-stack">
      <h3 class="st-card-title">Quote price list</h3>
      <p class="st-note"><${SampleTag} /> These prices are examples, not yours. Replace them with your own before you send a real quote. The quote builder starts from this list.</p>
      <div class="st-items" data-testid="quote-items">
        ${items.length === 0 ? html`<p class="st-dayoff-empty st-items__empty">No items yet. Add your first one below and the quote builder will offer it.</p>` : null}
        ${items.map((it) => html`<${QuoteItemRow} key=${it.id} item=${it} open=${openId === it.id} onSaved=${onSaved} onRemove=${setRemoving} />`)}
      </div>
      <${Button} icon="plus" onClick=${add} data-testid="quote-item-add">Add an item<//>
    <//>

    <${Card} class="db-stack st-quote-terms">
      <h3 class="st-card-title">Quote terms</h3>
      <${EditField} id="setting-quote-valid-days" label="Quotes are valid for (days)" value=${defaults.validDays}
        check=${(t) => (/^\d{1,3}$/.test(t) && Number(t) >= 1 && Number(t) <= 365 ? '' : 'Enter a whole number of days from 1 to 365.')}
        normalise=${(t) => String(parseInt(t, 10))} commit=${(t) => {
          const res = updateSettings({ quoteDefaults: { validDays: parseInt(t, 10) } });
          if (res.ok) { onSaved(); return ''; }
          return (res.errors && res.errors.validDays) || FAIL_TEXT;
        }} inputProps=${{ inputmode: 'numeric', pattern: '[0-9]*' }} />
      <${NotesField} onSaved=${onSaved} />
    <//>

    <${Card} class="db-stack st-quote-terms">
      <h3 class="st-card-title">Reply promise</h3>
      <${Field} label="You reply to a new enquiry within" id="setting-sla-hours"
        hint="Customers are told this in their messages, and Today counts down against it.">
        <${Select} id="setting-sla-hours" value=${String(replyHours)} onChange=${setSla} data-testid="setting-sla-hours"
          options=${hours.map((h) => ({ value: String(h), label: `${h} ${h === 1 ? 'hour' : 'hours'}` }))} />
      <//>
    <//>

    <${ConfirmDialog} open=${!!removing} title="Remove this item?" confirmLabel="Remove" tone="danger"
      body=${removing ? `${removing.label} leaves your price list. Quotes you have already written keep their own lines.` : ''}
      onConfirm=${remove} onCancel=${() => setRemoving(null)} />
  </div>`;
}

// ---------- the accordion ----------

const SECTIONS = [
  { id: 'business', label: 'Business and brand', icon: 'house' },
  { id: 'photos', label: 'Website photos', icon: 'image' },
  { id: 'services', label: 'Services and prices', icon: 'wrench' },
  { id: 'quotes', label: 'Quotes and replies', icon: 'file-text' },
  { id: 'availability', label: 'Availability', icon: 'calendar-days' },
  { id: 'rules', label: 'Rules and look', icon: 'settings' }
];
const SECTION_IDS = SECTIONS.map((x) => x.id);

/** 'Mon–Sat 8–5': the days that have any window open, and the earliest start to the latest finish. */
function hoursLine(hours, daysOff) {
  const open = WEEK_ORDER.filter((wd) => (hours[wd] || []).length > 0);
  if (open.length === 0) return 'Closed every day';
  const ids = open.flatMap((wd) => hours[wd]);
  const h12 = (hhmm) => Number(hhmm.slice(0, 2)) % 12 || 12;
  const from = WINDOWS[Math.min(...ids)].start;
  const to = WINDOWS[Math.max(...ids)].end;
  const contiguous = open.length === WEEK_ORDER.indexOf(open[open.length - 1]) - WEEK_ORDER.indexOf(open[0]) + 1;
  const days = contiguous ? (open.length === 1 ? DAY_SHORT[open[0]] : `${DAY_SHORT[open[0]]}–${DAY_SHORT[open[open.length - 1]]}`) : open.map((wd) => DAY_SHORT[wd]).join(', ');
  const off = daysOff.length > 0 ? ` · ${plural(daysOff.length, 'day')} off` : '';
  return `${days} ${h12(from)}–${h12(to)}${off}`;
}

// One line per section, read from the store (plain strings, so useStore's shallow compare holds between saves).
const selectSummaries = (state) => {
  const s = state.settings;
  const b = s.business;
  const changed = IMAGE_KEYS.filter((k) => b.images[k] !== DEFAULT_IMAGES[k]).length;
  const shown = (s.services || []).filter((x) => (x.showOnWebsite !== undefined ? x.showOnWebsite : x.active) && x.id !== 'emergency').length;
  const items = (s.quoteItems || []).length;
  return {
    business: [b.name, b.phone].filter(Boolean).join(' · '),
    photos: changed === 0 ? 'All original' : `${changed} of ${IMAGE_KEYS.length} changed`,
    services: `${shown} on your website`,
    quotes: `${plural(items, 'price-list item')} · reply in ${s.sla ? s.sla.replyHours : 24} h`,
    availability: hoursLine(s.hours, s.daysOff),
    rules: `Instant confirm ${s.autoConfirm ? 'on' : 'off'} · Emergencies ${s.takingEmergencies ? 'on' : 'off'}`
  };
};

function Panel({ id, onSaved }) {
  switch (id) {
    case 'business': return html`<${BusinessSection} onSaved=${onSaved} />`;
    case 'photos': return html`<${ImagesSection} onSaved=${onSaved} />`;
    case 'services': return html`<${ServicesSection} onSaved=${onSaved} />`;
    case 'quotes': return html`<${QuotesSection} onSaved=${onSaved} />`;
    case 'availability': return html`<${AvailabilitySection} onSaved=${onSaved} />`;
    default: return html`<${RulesSection} onSaved=${onSaved} />`;
  }
}

// ---------- the page ----------

export default function SettingsView({ route }) {
  const [saved, setSaved] = useState(false);
  const asked = route && route.query ? route.query.open : '';
  const [open, setOpen] = useState(SECTION_IDS.includes(asked) ? asked : '');
  const timer = useRef(null);
  const itemRefs = useRef({});
  const summaries = useStore(selectSummaries);
  const flash = () => {
    setSaved(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaved(false), 2000);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  // A link that asks for a section (#/settings?open=photos) lands with it open and at the top.
  useEffect(() => {
    const el = open ? itemRefs.current[open] : null;
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
  }, []);

  // One section open at a time: opening one closes the last, and the opened one is brought to the top so its fields are on screen.
  const toggle = (id) => {
    const next = open === id ? '' : id;
    setOpen(next);
    if (!next) return;
    const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => {
      const el = itemRefs.current[id];
      if (el) el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    });
  };

  return html`<div class="db-page">
    <div class="st-saved-wrap">
      <span class=${`st-saved${saved ? ' is-visible' : ''}`} role="status" data-testid="setting-saved">${saved ? html`<${Icon} name="check" size=${18} /><span>Saved</span>` : null}</span>
    </div>
    <${PageHeader} title="Settings" subtitle="Changes save as you go and show on this prototype's page straight away." />
    <div class="st-acc" data-testid="settings-accordion">
      ${SECTIONS.map((sec) => {
        const isOpen = open === sec.id;
        return html`<section class=${cx('st-acc__item', isOpen && 'is-open')} key=${sec.id} ref=${(el) => { itemRefs.current[sec.id] = el; }}>
          <h2 class="st-acc__h">
            <button type="button" class="st-acc__btn" id=${`st-h-${sec.id}`} aria-expanded=${isOpen ? 'true' : 'false'} aria-controls=${`st-p-${sec.id}`}
              onClick=${() => toggle(sec.id)} data-testid=${`settings-section-${sec.id}`}>
              <span class="st-acc__icon"><${Icon} name=${sec.icon} size=${20} /></span>
              <span class="st-acc__text">
                <span class="st-acc__label">${sec.label}</span>
                <span class="st-acc__sum" data-testid=${`settings-summary-${sec.id}`}>${summaries[sec.id]}</span>
              </span>
              <${Icon} name="chevron-down" size=${20} class="st-acc__chev" />
            </button>
          </h2>
          ${isOpen ? html`<div class="st-acc__panel" id=${`st-p-${sec.id}`} role="region" aria-labelledby=${`st-h-${sec.id}`}>
            <${Panel} id=${sec.id} onSaved=${flash} />
          </div>` : null}
        </section>`;
      })}
    </div>
  </div>`;
}
