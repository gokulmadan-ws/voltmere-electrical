// js/dashboard/views/connections-calendar.js: Google Calendar wizard (4 steps) and its connected dashboard. SIMULATED. Also exports the Google sign-in flow the Gmail wizard shares.
// Owner: K2
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import {
  Avatar, Button, Card, ConsentSheet, Field, Icon, Input, RealBuildNote, Select, Sheet, SimBanner, Stat, Switch, Wizard,
  focusTitle, toast, useBrand, useStore
} from '../../ui/index.js';
import { failureMessage } from '../../ui/util.js';
import { connectGoogle, getState, setConnection, settleConnections } from '../../core/store.js';
import { selectConnectionsSummary } from '../../core/selectors.js';
import { isValidEmail } from '../../core/connections.js';
import { WINDOWS, answersLine } from '../../core/config.js';
import { nowStamp } from '../../core/clock.js';
import { addressLine } from '../../core/format.js';
import { bookingWhen } from '../../core/availability.js';
import { fmtDayShort } from '../../core/dates.js';
import { routeHref, navigate } from '../router.js';
import {
  ConnHeader, ConnectedHero, DisconnectPanel, Explain, Section, TickList, failToast, sinceText, stepMemory, useLocalPref
} from './connections-whatsapp.js';

export const title = 'Google Calendar';
export const css = ['css/connections-wizards.css'];

// ====================================================================================================================
// Google sign-in (account chooser, then the simulated consent screen). Shared with connections-email.js
// ====================================================================================================================

export const SAMPLE_ACCOUNT = 'daniel@180electrical.co.uk';

/** Simulated "Choose an account" sheet: the sample account, or type another address. Nothing goes to Google. */
function AccountChooser({ open, onPick, onCancel }) {
  const brand = useBrand();
  const [other, setOther] = useState(false);
  const [email, setEmail] = useState('');
  const [bad, setBad] = useState('');
  useEffect(() => { if (open) { setOther(false); setEmail(''); setBad(''); } }, [open]);
  const submit = () => {
    const value = email.trim();
    if (!isValidEmail(value)) { setBad('Enter a Google account, like name@gmail.com'); return; }
    onPick(value);
  };
  return html`<${Sheet} open=${open} onClose=${onCancel} title="Choose an account" size="auto" testid="k2-google-chooser"
    description="Simulated Google account chooser. Nothing is sent to Google.">
    <div class="k2-chooser">
      <button type="button" class="k2-account" onClick=${() => onPick(SAMPLE_ACCOUNT)} data-testid="k2-google-account-sample">
        <${Avatar} name=${brand.ownerFirst} size=${40} />
        <span class="k2-account__text">
          <span class="k2-account__name">${brand.ownerFirst}</span>
          <span class="k2-account__email">${SAMPLE_ACCOUNT}</span>
          <span class="k2-account__tag">Sample account</span>
        </span>
      </button>
      ${other
        ? html`<div class="k2-chooser__other">
          <${Field} label="Google account" id="k2-google-other-email" error=${bad}>
            <${Input} id="k2-google-other-email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck=${false}
              value=${email} placeholder="name@gmail.com" onInput=${(e) => { setEmail(e.target.value); setBad(''); }}
              onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} data-testid="k2-google-other-email" />
          <//>
          <${Button} variant="primary" onClick=${submit} data-testid="k2-google-other-continue">Continue<//>
        </div>`
        : html`<button type="button" class="k2-account k2-account--other" onClick=${() => setOther(true)} data-testid="k2-google-other">
          <span class="k2-account__plus" aria-hidden="true"><${Icon} name="plus" size=${20} /></span>
          <span class="k2-account__text"><span class="k2-account__name">Use another account</span></span>
        </button>`}
    </div>
  <//>`;
}

/**
 * "Connect with Google": account chooser, then the simulated consent screen, then connectGoogle(). Renders the connected account
 * instead once `connected`. `service` is 'calendar' or 'email'; `provider` and `scopes` are the ConsentSheet props.
 */
export function GoogleConnect({ service, provider, scopes, label, ctaLabel = 'Connect with Google', testid, connected, account, onConnected }) {
  const [chooser, setChooser] = useState(false);
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const allow = () => {
    if (busy) return;
    setBusy(true);
    // A short pause so it feels like a hand-off to Google. The store call is the real (local) work.
    setTimeout(() => {
      if (!alive.current) return;
      const res = connectGoogle(service, { account: chosen });
      setBusy(false);
      setChosen('');
      if (res.ok) {
        toast({ message: `${label || provider.service || provider.name} connected (simulated).`, icon: 'circle-check' });
        if (onConnected) onConnected(res);
      } else {
        setError(failureMessage(res));
      }
    }, 500);
  };

  if (connected) {
    return html`<div class="k2-verified" data-testid=${`${testid}-connected`}>
      <span class="k2-verified__tick" aria-hidden="true"><${Icon} name="check" size=${22} /></span>
      <div><p class="k2-verified__title">Signed in with Google (simulated)</p><p class="k2-verified__sub">${account}</p></div>
    </div>`;
  }
  return html`<div class="k2-connect">
    <${Button} variant="primary" size="lg" icon="link" block onClick=${() => { setError(''); setChooser(true); }} data-testid=${`${testid}-connect`}>${ctaLabel}<//>
    <p class="k2-connect__fine">A pretend Google sign-in opens next. Nothing is shared with Google.</p>
    ${error ? html`<p class="k2-connect__error" role="alert" data-testid=${`${testid}-connect-error`}><${Icon} name="circle-alert" size=${18} /><span>${error}</span></p>` : null}
    <${AccountChooser} open=${chooser} onPick=${(email) => { setChooser(false); setChosen(email); }} onCancel=${() => setChooser(false)} />
    <${ConsentSheet} open=${!!chosen} provider=${provider} account=${chosen} scopes=${scopes} busy=${busy} onAllow=${allow}
      onCancel=${() => { if (!busy) setChosen(''); }} />
  </div>`;
}

// ====================================================================================================================
// Google Calendar
// ====================================================================================================================

const STEP_KEY = 'k2_cal_step';
const PREF_KEY = 'k2_cal_prefs';
// CONTRACT-GAP: the store keeps twoWay and addJobs but no reminder setting, and no sync history. Both are saved per device (k2_cal_prefs).
const PREF_DEFAULTS = { reminders: true, remindMins: '60', lastSync: '' };
const NEW_NAME = '180 Electrical jobs';
const STEPS = ['connect', 'calendar', 'options', 'sync'];
const PROVIDER = { name: 'Google', service: 'Calendar', icon: 'calendar-days' };
const SCOPES = [
  { id: 'events', label: 'See and create events on your calendars', detail: 'So 180 Electrical can show your busy times in the diary and add your confirmed jobs.' },
  { id: 'email', label: 'See your email address', detail: 'To show which Google account is connected.' }
];
const REMIND_OPTIONS = [
  { value: '30', label: '30 minutes before' },
  { value: '60', label: '1 hour before' },
  { value: '1440', label: 'The day before' }
];
const remindLabel = (mins) => (REMIND_OPTIONS.find((o) => o.value === String(mins)) || REMIND_OPTIONS[1]).label;

const selectCal = (state) => state.settings.connections.calendar;
const selectCalSummary = (state) => selectConnectionsSummary(state).find((row) => row.key === 'calendar');

/** The simulated Google busy blocks, as one line per day: [{ date, label }]. Plain values so the selector stays stable. */
const selectGoogleBusy = (state) => {
  const byDay = new Map();
  for (const b of state.blocks) {
    if (b.source !== 'google_calendar') continue;
    const ids = byDay.get(b.date) || [];
    ids.push(b.windowId);
    byDay.set(b.date, ids);
  }
  return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, ids]) => {
    const sorted = ids.slice().sort((x, y) => x - y);
    const from = WINDOWS[sorted[0]].start;
    const to = WINDOWS[sorted[sorted.length - 1]].end;
    return `${fmtDayShort(date)}|${from}–${to}`;
  });
};

/** The next upcoming job (real data from the store) for the "what goes in your calendar" example; a sample when there is none. */
const selectExampleJob = (state) => {
  const stamp = nowStamp();
  const jobs = state.bookings
    .filter((b) => ['new', 'confirmed'].includes(b.status) && !b.urgent && b.start && b.start >= stamp && (b.serviceId === 'ev' || b.serviceId === 'ev_quote'))
    .sort((a, b) => (a.start < b.start ? -1 : 1));
  const job = jobs[0];
  if (!job) {
    return { title: 'Free survey visit: Aoife Magee', when: '', address: '14 Larkfield Gardens, BT9 6QP', notes: 'Parking: private driveway. Car: ordered. Timing: as soon as possible. Permission: yes.', real: false };
  }
  return {
    title: `${job.serviceName}: ${job.customer.name}`,
    when: bookingWhen(job),
    address: addressLine(job.address),
    notes: answersLine(job.answers) || (job.notes ? `Note: "${job.notes}"` : ''),
    real: true
  };
};
const selectUpcomingCount = (state) => {
  const stamp = nowStamp();
  return state.bookings.filter((b) => b.status === 'confirmed' && b.start && b.start >= stamp).length;
};

const isSampleCalendar = (name, account) => name === account || name === 'Family' || name === 'Van and tools';

/** Two radio cards: a new calendar (named) or an existing one. */
function CalendarChoice({ mode, name, existing, account, onMode, onName, onExisting, invalid }) {
  const existingOptions = [{ value: account || SAMPLE_ACCOUNT, label: `${account || SAMPLE_ACCOUNT} (main calendar)` }, { value: 'Family', label: 'Family' }, { value: 'Van and tools', label: 'Van and tools' }];
  const card = (value, titleText, sub, testid) => html`<label class=${`k2-choice${mode === value ? ' is-on' : ''}`}>
    <input class="k2-choice__input" type="radio" name="k2-cal-mode" value=${value} checked=${mode === value} onChange=${() => onMode(value)} data-testid=${testid} />
    <span class="k2-choice__dot" aria-hidden="true"></span>
    <span class="k2-choice__body"><span class="k2-choice__title">${titleText}</span><span class="k2-choice__sub">${sub}</span></span>
  </label>`;
  return html`<fieldset class="k2-choices" data-testid="k2-cal-choice">
    <legend class="u-sr-only">Which calendar should jobs go in</legend>
    ${card('new', 'Create a new calendar', 'Recommended. Jobs get a calendar of their own, so your personal diary stays tidy.', 'k2-cal-mode-new')}
    ${card('existing', 'Use one you already have', 'Jobs go into a calendar on this Google account (sample calendars shown).', 'k2-cal-mode-existing')}
    ${mode === 'new'
      ? html`<${Field} label="Calendar name" id="k2-cal-name">
        <${Input} id="k2-cal-name" value=${name} maxlength="60" error=${invalid} onInput=${(e) => onName(e.target.value)} data-testid="k2-cal-name" />
      <//>`
      : html`<${Field} label="Calendar" id="k2-cal-existing">
        <${Select} id="k2-cal-existing" value=${existing} options=${existingOptions} onChange=${(e) => onExisting(e.target.value)} data-testid="k2-cal-existing" />
      <//>`}
  </fieldset>`;
}

/** One example calendar event, from the next real job. Shows what lands in Google Calendar. */
function ExampleEvent({ remind, reminderOn }) {
  const job = useStore(selectExampleJob);
  return html`<figure class="k2-event" data-testid="k2-cal-example">
    <figcaption class="k2-event__cap">Example event${job.real ? ' from your next job' : ''}</figcaption>
    <div class="k2-event__card">
      <span class="k2-event__bar" aria-hidden="true"></span>
      <div class="k2-event__main">
        <p class="k2-event__title">${job.title}</p>
        ${job.when ? html`<p class="k2-event__when"><${Icon} name="clock" size=${16} /><span>${job.when}</span></p>` : null}
        <p class="k2-event__where"><${Icon} name="map-pin" size=${16} /><span>${job.address}</span></p>
        ${job.notes ? html`<p class="k2-event__notes">${job.notes}</p>` : null}
        ${reminderOn ? html`<p class="k2-event__remind"><${Icon} name="bell" size=${16} /><span>Reminder ${remind.toLowerCase()}</span></p>` : null}
      </div>
    </div>
  </figure>`;
}

/** The three options: two-way sync, add confirmed jobs, reminders. Saved as you go. */
function OptionsPanel({ cal, prefs, patchPrefs }) {
  const save = (patch) => {
    const res = setConnection('calendar', patch);
    if (!res.ok) failToast(res);
  };
  return html`<div class="k2-prefs" data-testid="k2-cal-options">
    <${Card} class="k2-switches" padded=${false}>
      <${Switch} checked=${cal.twoWay} label="Two-way sync" description="Busy times in your Google Calendar block those slots in the diary, so customers are never offered them."
        onChange=${(v) => save({ twoWay: v })} data-testid="k2-cal-twoway" />
      <${Switch} checked=${cal.addJobs} label="Add confirmed jobs" description="Each confirmed job goes into your calendar with the address and what the customer told you."
        onChange=${(v) => save({ addJobs: v })} data-testid="k2-cal-addjobs" />
      <${Switch} checked=${prefs.reminders} label="Reminders" description="A reminder on your phone before each job."
        onChange=${(v) => patchPrefs({ reminders: v })} data-testid="k2-cal-reminders" />
      ${prefs.reminders ? html`<div class="k2-times k2-times--single">
        <${Field} label="Remind me" id="k2-cal-remind">
          <${Select} id="k2-cal-remind" value=${String(prefs.remindMins)} options=${REMIND_OPTIONS} onChange=${(e) => patchPrefs({ remindMins: e.target.value })} data-testid="k2-cal-remind" />
        <//>
      </div>` : null}
    <//>
    <p class="k2-note">Saved on this device. A real build writes these settings to Google Calendar for you.</p>
  </div>`;
}

// CONTRACT-GAP: V3-API has no "sync" function. Connecting (or switching two-way on) already imports the busy blocks, so Sync now reports what is in the
// diary and, only when nothing was imported, switches twoWay off and on again so the store re-imports them.
/** "Sync now": a pretend pull from Google, then what is in the diary. Imports through the store (see setConnection). */
function SyncPanel({ cal, prefs, patchPrefs }) {
  const busy = useStore(selectGoogleBusy);
  const upcoming = useStore(selectUpcomingCount);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const sync = () => {
    if (running) return;
    setRunning(true);
    setResult('');
    setTimeout(() => {
      if (!alive.current) return;
      let message = '';
      if (!cal.twoWay) {
        message = 'Two-way sync is off, so no busy times were brought in. Turn it on to see Google Calendar in your diary.';
      } else {
        let count = busy.length;
        if (count === 0) {
          // Nothing imported yet: switch two-way off and on again so the store re-imports the Google busy times.
          const off = setConnection('calendar', { twoWay: false });
          const on = off.ok ? setConnection('calendar', { twoWay: true }) : off;
          if (!on.ok) { setRunning(false); failToast(on, 'The sync did not finish. Check two-way sync is on and try again.'); return; }
          count = selectGoogleBusy(getState()).length;
          message = `Synced. ${count} busy ${count === 1 ? 'time' : 'times'} from Google Calendar now show in your diary (simulated).`;
        } else {
          message = prefs.lastSync
            ? `Synced. ${count} busy ${count === 1 ? 'time' : 'times'} from Google Calendar show in your diary (simulated), nothing new since last time.`
            : `Synced. ${count} busy ${count === 1 ? 'time' : 'times'} from Google Calendar now show in your diary (simulated).`;
        }
      }
      if (cal.addJobs) message += ` ${upcoming} confirmed ${upcoming === 1 ? 'job' : 'jobs'} would be in your Google calendar.`;
      patchPrefs({ lastSync: nowStamp() });
      setRunning(false);
      setResult(message);
      toast({ message: 'Calendar synced (simulated).', icon: 'refresh-cw' });
    }, 1100);
  };

  return html`<div class="k2-sync" data-testid="k2-cal-sync-panel">
    <${Card}>
      <p class="k2-sync__text">Pull in what is already in your Google Calendar. In the prototype this brings in a few example busy times, so you can see how they block the diary.</p>
      <div class="k2-test__actions">
        <${Button} variant="primary" icon="refresh-cw" onClick=${sync} loading=${running} data-testid="k2-cal-sync">Sync now<//>
        <${Button} href=${routeHref('calendar')} icon="calendar-days" data-testid="k2-cal-open-calendar">See it in Calendar<//>
      </div>
      <p class="k2-sync__result" role="status" aria-live="polite" data-testid="k2-cal-sync-result">${running ? 'Checking Google Calendar...' : result}</p>
      ${prefs.lastSync ? html`<p class="k2-sync__last" data-testid="k2-cal-last-sync">Last synced ${sinceText(prefs.lastSync)}</p>` : null}
    <//>
    ${busy.length > 0 && cal.twoWay ? html`<div class="k2-busy" data-testid="k2-cal-busy">
      <h4 class="k2-busy__title">Busy times from Google Calendar</h4>
      <ul class="k2-busy__list">
        ${busy.map((line) => {
          const [day, time] = line.split('|');
          return html`<li key=${line} class="k2-busy__item"><span class="k2-busy__day">${day}</span><span class="k2-busy__time">${time}</span><span class="k2-busy__label">Google Calendar</span></li>`;
        })}
      </ul>
    </div>` : null}
  </div>`;
}

const REAL_BUILD_CAL = [
  'A Google Cloud project with the Calendar API switched on, and an OAuth consent screen.',
  'Google reviews apps that ask to see or change calendars. Allow a few days to a few weeks. Until it is verified, sign-in shows a warning screen and can lapse.',
  'Safe storage for the sign-in token, and a refresh routine so the link does not quietly drop.',
  'Clear sync rules: which events count as busy (all-day events? events marked free?), time zones, and what happens when a job is moved or deleted in Google.',
  'Google push notifications, or regular checks, to notice changes made in Google Calendar.'
];

function CalRealBuild() {
  return html`<${RealBuildNote} items=${REAL_BUILD_CAL}>
    <p class="k2-realbuild__time" data-testid="k2-cal-timescale"><strong>Typical timescale:</strong> about one to two weeks to build and test, plus Google's review time.</p>
  <//>`;
}

function CalWizard({ cal, onDone }) {
  const [prefs, patchPrefs] = useLocalPref(PREF_KEY, PREF_DEFAULTS);
  const connected = cal.status === 'connected';
  const [step, setStep] = useState(() => {
    const saved = stepMemory.get(STEP_KEY);
    if (cal.status !== 'connected') return 'connect';
    return STEPS.includes(saved) ? saved : 'calendar';
  });
  const [mode, setMode] = useState(() => (isSampleCalendar(cal.calendarName, cal.account) && cal.calendarName !== NEW_NAME ? 'existing' : 'new'));
  const [name, setName] = useState(() => (isSampleCalendar(cal.calendarName, cal.account) ? NEW_NAME : cal.calendarName));
  const [existing, setExisting] = useState(() => (isSampleCalendar(cal.calendarName, cal.account) ? cal.calendarName : (cal.account || SAMPLE_ACCOUNT)));
  const [nameBad, setNameBad] = useState(false);
  const goStep = (id) => { setStep(id); stepMemory.set(STEP_KEY, id); };

  // Signed out in another tab: go back to the first step.
  useEffect(() => { if (!connected && step !== 'connect') goStep('connect'); }, [connected]);

  const steps = [
    {
      id: 'connect', title: 'Connect Google', hint: 'Sign in with the Google account your diary lives in.', canNext: connected, nextLabel: 'Next',
      content: html`<div class="k2-stack">
        <${Explain} icon="calendar-days" title="What does connecting do?" testid="k2-cal-explain">
          <p>Your calendar and your diary here stay in step, so you never get double-booked.</p>
          <${TickList} items=${['Your busy times show in the diary, so customers are never offered a day you are out.', 'Confirmed jobs go into your calendar with the address and what the customer told you.', 'Reminders reach your phone through Google Calendar.']} />
        <//>
        <${GoogleConnect} service="calendar" provider=${PROVIDER} scopes=${SCOPES} label="Google Calendar" testid="k2-cal" connected=${connected} account=${cal.account}
          onConnected=${() => goStep('calendar')} />
      </div>`
    },
    {
      id: 'calendar', title: 'Choose a calendar', hint: 'Where should your jobs go?',
      validate: () => {
        const calendarName = mode === 'new' ? name.trim() : existing;
        if (!calendarName || calendarName.length > 60) { setNameBad(true); return 'Enter a calendar name, up to 60 characters.'; }
        setNameBad(false);
        const res = setConnection('calendar', { calendarName });
        return res.ok ? true : failureMessage(res);
      },
      content: html`<${CalendarChoice} mode=${mode} name=${name} existing=${existing} account=${cal.account} invalid=${nameBad}
        onMode=${setMode} onName=${(v) => { setName(v); setNameBad(false); }} onExisting=${setExisting} />`
    },
    {
      id: 'options', title: 'How it should work', hint: 'Switch on what you want. You can change these any time.',
      content: html`<div class="k2-stack">
        <${OptionsPanel} cal=${cal} prefs=${prefs} patchPrefs=${patchPrefs} />
        <${ExampleEvent} remind=${remindLabel(prefs.remindMins)} reminderOn=${prefs.reminders} />
      </div>`
    },
    {
      id: 'sync', title: 'Sync now', hint: 'Bring your Google Calendar into the diary and check it all lines up.', nextLabel: 'Finish',
      content: html`<${SyncPanel} cal=${cal} prefs=${prefs} patchPrefs=${patchPrefs} />`
    }
  ];

  const finish = () => {
    stepMemory.clear(STEP_KEY);
    onDone();
    toast({ message: 'Google Calendar is set up (simulated).', icon: 'circle-check' });
    window.scrollTo(0, 0);
    setTimeout(() => focusTitle(), 60);
    return true;
  };

  return html`<${Wizard} title="Set-up" steps=${steps} step=${step} onStepChange=${goStep} onFinish=${finish} finishLabel="Finish"
    onCancel=${() => navigate(routeHref('connections'))} testid="k2-cal-wizard" />`;
}

function CalDashboard({ cal }) {
  const summary = useStore(selectCalSummary);
  const busy = useStore(selectGoogleBusy);
  const [prefs, patchPrefs] = useLocalPref(PREF_KEY, PREF_DEFAULTS);
  const [mode, setMode] = useState(() => (isSampleCalendar(cal.calendarName, cal.account) && cal.calendarName !== NEW_NAME ? 'existing' : 'new'));
  const [name, setName] = useState(() => (isSampleCalendar(cal.calendarName, cal.account) ? NEW_NAME : cal.calendarName));
  const [existing, setExisting] = useState(() => (isSampleCalendar(cal.calendarName, cal.account) ? cal.calendarName : (cal.account || SAMPLE_ACCOUNT)));
  const [nameBad, setNameBad] = useState(false);
  const chosen = mode === 'new' ? name.trim() : existing;
  const dirty = chosen !== cal.calendarName;

  const useCalendar = () => {
    if (!chosen || chosen.length > 60) { setNameBad(true); return; }
    setNameBad(false);
    const res = setConnection('calendar', { calendarName: chosen });
    if (res.ok) toast({ message: `Jobs now go in "${chosen}" (simulated).`, icon: 'circle-check' }); else failToast(res);
  };

  return html`<div class="k2-stack" data-testid="k2-cal-connected">
    <${ConnectedHero} testid="k2-cal-hero" badgeTestid="k2-cal-status" icon="calendar-days" title="Google Calendar"
      lines=${[{ text: cal.account, mono: true }, { text: `Jobs go in: ${cal.calendarName}` }]}
      status=${summary ? summary.status : 'connected'} label=${summary ? summary.label : 'Connected'} since=${sinceText(cal.connectedAt)} />
    <div class="k2-stats">
      <${Stat} label="Busy times" value=${cal.twoWay ? String(busy.length) : 'Off'} data-testid="k2-cal-stat-busy" />
      <${Stat} label="Two-way sync" value=${cal.twoWay ? 'On' : 'Off'} data-testid="k2-cal-stat-twoway" />
      <${Stat} label="Jobs added" value=${cal.addJobs ? 'On' : 'Off'} data-testid="k2-cal-stat-jobs" />
    </div>
    <div class="k2-cols">
      <div class="k2-col">
        <${Section} title="Sync" hint="Bring your Google Calendar into the diary." testid="k2-cal-section-sync"><${SyncPanel} cal=${cal} prefs=${prefs} patchPrefs=${patchPrefs} /><//>
        <${Section} title="What goes in your calendar" testid="k2-cal-section-example"><${ExampleEvent} remind=${remindLabel(prefs.remindMins)} reminderOn=${prefs.reminders} /><//>
      </div>
      <div class="k2-col">
        <${Section} title="How it works" testid="k2-cal-section-options"><${OptionsPanel} cal=${cal} prefs=${prefs} patchPrefs=${patchPrefs} /><//>
        <${Section} title="Calendar" testid="k2-cal-section-calendar">
          <${CalendarChoice} mode=${mode} name=${name} existing=${existing} account=${cal.account} invalid=${nameBad}
            onMode=${setMode} onName=${(v) => { setName(v); setNameBad(false); }} onExisting=${setExisting} />
          <${Button} variant="primary" icon="save" onClick=${useCalendar} disabled=${!dirty} data-testid="k2-cal-save">Use this calendar<//>
        <//>
      </div>
    </div>
    <${CalRealBuild} />
    <${DisconnectPanel} connKey="calendar" name="Google Calendar" testid="k2-cal-disconnect"
      body="Stops the diary and Google Calendar talking to each other. The busy times from Google leave your diary."
      confirmBody="The busy times that came from Google Calendar will leave your diary, and confirmed jobs will no longer be added to your calendar." />
  </div>`;
}

export default function CalendarView() {
  const cal = useStore(selectCal);
  const [setup, setSetup] = useState(() => cal.status !== 'connected' || !!stepMemory.get(STEP_KEY));
  const last = useRef(cal.status);
  useEffect(() => {
    if (last.current === 'connected' && cal.status !== 'connected') { setSetup(true); stepMemory.clear(STEP_KEY); }
    // Connected again with no wizard step in progress (an Undo of Disconnect): nothing is left to set up.
    else if (last.current !== 'connected' && cal.status === 'connected' && !stepMemory.get(STEP_KEY)) setSetup(false);
    last.current = cal.status;
  }, [cal.status]);
  useEffect(() => { settleConnections(); }, []);
  const wizard = cal.status !== 'connected' || setup;
  return html`<div class="db-page k2-page" data-testid="k2-cal-root">
    <${ConnHeader} title=${wizard ? 'Connect Google Calendar' : 'Google Calendar'} subtitle="Your busy times in the diary, your jobs in your calendar." />
    <${SimBanner} />
    ${wizard ? html`<${CalWizard} cal=${cal} onDone=${() => setSetup(false)} />` : html`<${CalDashboard} cal=${cal} />`}
  </div>`;
}
