// js/dashboard/views/connections-domain.js: Domain wizard (#/connections/domain): choose an address, DNS records, simulated DNS check, live state.
// Owner: K1 (connections hub, domain, webhook, tracking)
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import {
  Banner, Button, ConfirmDialog, ConnectionBadge, CopyField, Disclosure, Field, Icon, Input, Meter, PageHeader, RealBuildNote,
  SimBanner, Timeline, Wizard, copyText, failureMessage, focusTitle, toast, useMediaQuery, useNow, useStore
} from '../../ui/index.js';
import { DOMAIN_TARGETS, DOMAIN_VERIFY_SECONDS } from '../../core/config.js';
import { nowStampSec } from '../../core/clock.js';
import { domainRecords, validateHostname } from '../../core/connections.js';
import { checkDomain, disconnect, settleConnections, startDomainSetup } from '../../core/store.js';
import { fmtDayShort, secondsBetween, stampDay, stampTime } from '../../core/dates.js';
import { routeHref, goBack } from '../router.js';
import { StorageNote, undoToast } from './connections.js';

export const title = 'Your domain';
export const css = ['css/connections.css'];

const SUGGESTED = 'book.180electrical.co.uk';
const MAIN = '180electrical.co.uk';

const selectDomain = (state) => state.settings.connections.domain;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** 'Fri 23 Oct, 20:31' from a stamp. */
const whenText = (stamp) => (stamp ? `${fmtDayShort(stampDay(stamp))}, ${stampTime(stamp)}` : '');

const TWO_LEVEL = new Set(['co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'gov.uk', 'ac.uk', 'sch.uk']);

/** '180electrical.co.uk' from 'book.180electrical.co.uk' (the part you actually own and manage DNS for). */
function registrable(host) {
  const labels = String(host || '').split('.');
  const keep = TWO_LEVEL.has(labels.slice(-2).join('.')) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

const ttlText = (ttl) => {
  if (ttl % 3600 === 0) return ttl === 3600 ? '1 hour' : `${ttl / 3600} hours`;
  if (ttl % 60 === 0) return `${ttl / 60} minutes`;
  return `${ttl} seconds`;
};

/** A friendly reason for a typed address that is not one ('' when it is fine). Falls back to the core message. */
function friendlyHostError(text) {
  const raw = String(text || '').trim();
  if (!raw) return 'Type the address you want, like book.180electrical.co.uk.';
  if (/\s/.test(raw)) return 'Web addresses cannot have spaces in them.';
  if (raw.includes('@')) return 'That looks like an email address. A web address looks like book.180electrical.co.uk.';
  const check = validateHostname(raw);
  if (check.ok) return '';
  const bare = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0];
  if (!bare.includes('.')) return 'That needs an ending, like .co.uk or .com. For example book.180electrical.co.uk.';
  return check.message;
}

/** Which of the three choices a stored domain corresponds to. */
function choiceOf(domain) {
  if (!domain || domain === SUGGESTED) return 'suggested';
  if (domain === MAIN) return 'main';
  return 'custom';
}

// ---------- step 1: choose the address ----------

const CHOICES = [
  { id: 'suggested', title: SUGGESTED, tag: 'Suggested', text: 'A separate address for your quote page. Your main website carries on exactly as it is.' },
  { id: 'main', title: MAIN, text: 'Use your main domain. Best if this is going to be your main site. You will point it at us instead of where it points now.' },
  { id: 'custom', title: 'A different address', text: 'Type the one you want, such as www.180electrical.co.uk.' }
];

function AddressStep({ choice, setChoice, custom, setCustom, error, setError }) {
  const preview = choice === 'custom' ? validateHostname(custom) : null;
  return html`<div class="k1-stack">
    <div class="k1-choices" role="radiogroup" aria-label="Web address" data-testid="k1-domain-choices">
      ${CHOICES.map((c) => html`<label class=${`k1-choice${choice === c.id ? ' is-selected' : ''}`} key=${c.id} data-testid=${`k1-domain-choice-${c.id}`}>
        <input class="k1-choice__input" type="radio" name="k1-domain-choice" value=${c.id} checked=${choice === c.id}
          onChange=${() => { setChoice(c.id); setError(''); }} />
        <span class="k1-choice__mark" aria-hidden="true"></span>
        <span class="k1-choice__body">
          <span class="k1-choice__title"><span class=${c.id === 'custom' ? '' : 'k1-mono'}>${c.title}</span>${c.tag ? html`<span class="k1-tag">${c.tag}</span>` : null}</span>
          <span class="k1-choice__text">${c.text}</span>
        </span>
      </label>`)}
    </div>
    ${choice === 'custom' ? html`<div class="k1-reveal">
      <${Field} label="Your web address" id="k1-domain-custom" error=${error} errorTestid="k1-domain-error"
        hint=${preview && preview.ok ? `We will use ${preview.host}` : 'No need for https:// at the start.'}>
        <${Input} id="k1-domain-custom" value=${custom} placeholder="www.180electrical.co.uk" inputmode="url" autocapitalize="none" autocomplete="off" spellcheck=${false}
          data-testid="k1-domain-input" onInput=${(e) => { setCustom(e.target.value); if (error) setError(''); }} />
      <//>
    </div>` : (error ? html`<p class="ui-field__error" role="alert" data-testid="k1-domain-error"><${Icon} name="circle-alert" size=${16} /><span>${error}</span></p>` : null)}
    <p class="k1-small"><${Icon} name="info" size=${16} class="k1-small__icon" /> Your current page stays where it is until you switch the address over. Nothing here changes a real website.</p>
  </div>`;
}

// ---------- step 2: the DNS records ----------

function RecordsTable({ domain, compact }) {
  const records = domainRecords(domain);
  if (!records.length) return null;
  return html`<div class=${`k1-records${compact ? ' k1-records--compact' : ''}`} role="table" aria-label=${`DNS records for ${domain}`} data-testid="k1-records">
    <div class="k1-records__head" role="row">
      <span role="columnheader">Type</span><span role="columnheader">Name</span><span role="columnheader">Value</span><span role="columnheader">TTL</span>
    </div>
    ${records.map((r, i) => html`<div class="k1-record" role="row" key=${`${r.type}-${r.host}`} data-testid=${`k1-record-${i}`}>
      <div class="k1-record__type" role="cell"><span class="k1-typepill" data-testid=${`k1-record-type-${i}`}>${r.type}</span></div>
      <div class="k1-record__cell" role="cell"><${CopyField} label="Name" value=${r.host} testid=${`k1-record-name-${i}`} /></div>
      <div class="k1-record__cell" role="cell"><${CopyField} label="Value" value=${r.value} testid=${`k1-record-value-${i}`} /></div>
      <div class="k1-record__ttl" role="cell"><span class="k1-record__ttl-label">TTL</span><span><span class="k1-mono">${r.ttl}</span> <span class="k1-muted">(${ttlText(r.ttl)})</span></span></div>
    </div>`)}
  </div>`;
}

function RecordsStep({ domain }) {
  const records = domainRecords(domain);
  const copyAll = async () => {
    const lines = records.map((r) => `${r.type}  ${r.host}  ${r.value}  TTL ${r.ttl}`);
    const ok = await copyText([`DNS records for ${domain}`, ...lines].join('\n'));
    toast({ message: ok ? 'Records copied' : 'Could not copy. Select the values above instead.', detail: ok ? 'Paste them into an email to whoever looks after your domain.' : undefined, icon: ok ? 'copy' : undefined, tone: ok ? 'default' : 'danger' });
  };
  return html`<div class="k1-stack">
    <div class="k1-records-meta">
      <p class="k1-small">For <strong class="k1-mono">${domain}</strong></p>
      <span class="k1-tag k1-tag--sample">Example values</span>
    </div>
    <${RecordsTable} domain=${domain} />
    <div class="k1-actions">
      <${Button} variant="secondary" size="sm" icon="copy" onClick=${copyAll} data-testid="k1-records-copyall">Copy all records<//>
    </div>
    <p class="k1-small" data-testid="k1-records-example-note">These are placeholders for the prototype: <span class="k1-inline-code">${DOMAIN_TARGETS.cname}</span> and <span class="k1-inline-code">${DOMAIN_TARGETS.a}</span> are not real servers. A real build gives you the real values.</p>
    <${Disclosure} title="Where do I paste these?" summary="Plain steps" defaultOpen testid="k1-where-paste">
      <ol class="k1-steps k1-steps--tight">
        <li><span class="k1-steps__n" aria-hidden="true">1</span><span>Sign in to wherever you bought your web address. That is usually somewhere like GoDaddy, 123-reg, Namecheap or Cloudflare.</span></li>
        <li><span class="k1-steps__n" aria-hidden="true">2</span><span>Find the page called <strong>DNS</strong>, <strong>DNS records</strong> or <strong>Manage DNS</strong> for ${registrable(domain)}.</span></li>
        <li><span class="k1-steps__n" aria-hidden="true">3</span><span>Add a new record. Choose the <strong>Type</strong> from the table, paste the <strong>Name</strong> and the <strong>Value</strong>, and leave the rest as it is.</span></li>
        <li><span class="k1-steps__n" aria-hidden="true">4</span><span>Save it. If a record with that name is already there, edit it instead of adding a second one.</span></li>
      </ol>
      <p class="k1-small">Stuck? Press <strong>Copy all records</strong> and send them to whoever looks after your domain. They will know what to do.</p>
    <//>
    <p class="k1-note" data-testid="k1-dns-wait"><${Icon} name="clock" size=${18} /><span>Changes to DNS can take up to 48 hours to spread. Most take a few minutes.</span></p>
  </div>`;
}

// ---------- step 3: check ----------

function checkItems(dom, lastCheck) {
  const live = dom.status === 'live';
  const looked = dom.checks > 0 && !live;
  return [
    { id: 'added', title: 'You add the records', detail: `At your domain provider, for ${dom.domain}.`, tone: 'done', testid: 'k1-tl-added' },
    live
      ? { id: 'found', title: 'Records found', detail: 'We can see the records pointing at us (simulated).', tone: 'done', testid: 'k1-tl-found' }
      : looked
        ? { id: 'found', title: 'We cannot see your records yet', detail: (lastCheck && lastCheck.message) || 'DNS changes can take a while, so try again in a minute. We also keep looking by ourselves.', tone: 'warn', testid: 'k1-tl-found' }
        : { id: 'found', title: 'We look for your records', detail: 'Press Check my DNS. The prototype pretends to look.', tone: 'current', testid: 'k1-tl-found' },
    { id: 'ssl', title: live ? 'Security certificate issued' : 'Security certificate', detail: live ? 'The padlock is ready (simulated).' : 'Issued automatically once the records are found.', tone: live ? 'done' : 'upcoming', testid: 'k1-tl-ssl' },
    { id: 'live', title: live ? 'Your address is live' : 'Your address goes live', detail: live ? (dom.verifiedAt ? `Verified ${whenText(dom.verifiedAt)}.` : undefined) : undefined, tone: live ? 'done' : 'upcoming', testid: 'k1-tl-live' }
  ];
}

function CheckStep({ dom, lastCheck, wentLive }) {
  useNow(1000); // the countdown moves with the clock
  const live = dom.status === 'live';
  const verifying = dom.status === 'verifying' && dom.firstCheckAt;
  const elapsed = verifying ? Math.max(0, secondsBetween(dom.firstCheckAt, nowStampSec())) : 0;
  const left = Math.max(0, DOMAIN_VERIFY_SECONDS - elapsed);
  return html`<div class="k1-stack" data-testid="k1-check">
    <div class=${`k1-addr${live ? ' is-live' : ''}`}>
      <span class="k1-addr__icon" aria-hidden="true"><${Icon} name="globe" size=${22} /></span>
      <span class="k1-addr__host k1-mono" data-testid="k1-check-host">${dom.domain}</span>
      <${ConnectionBadge} status=${dom.status} label=${live ? 'Live' : dom.status === 'verifying' ? 'Checking' : 'Waiting for DNS'} data-testid="k1-domain-badge" />
    </div>
    ${wentLive || live ? html`<${Banner} tone="ok" data-testid="k1-check-success">
      <strong>Your address is connected.</strong> The security certificate is ready. This is simulated: nothing real was set up.
    <//>` : null}
    <${Timeline} ariaLabel="DNS check progress" items=${checkItems(dom, lastCheck)} data-testid="k1-check-timeline" />
    ${verifying && !live ? html`<div class="k1-wait">
      <${Meter} label="Looking again by ourselves" value=${Math.min(elapsed, DOMAIN_VERIFY_SECONDS)} max=${DOMAIN_VERIFY_SECONDS}
        valueText=${left > 0 ? `About ${left} seconds` : 'Any moment now'} showValue size="sm" data-testid="k1-check-meter" />
      <p class="k1-small">In real life this wait is DNS spreading across the internet. Here it takes about ${DOMAIN_VERIFY_SECONDS} seconds, or press the button again.</p>
    </div>` : null}
    ${!live ? html`<p class="k1-note"><${Icon} name="clock" size=${18} /><span>Real DNS changes can take up to 48 hours. You can leave this page and come back: your progress is saved on this device.</span></p>` : null}
  </div>`;
}

// ---------- live state ----------

function LiveView({ dom, justWentLive, onRemove }) {
  const url = `https://${dom.domain}`;
  return html`<div class="k1-stack" data-testid="k1-live">
    ${justWentLive ? html`<${Banner} tone="ok" data-testid="k1-live-banner"><strong>You are live.</strong> Your address is connected and the security certificate is ready (simulated).<//>` : null}
    <section class="k1-live" aria-label="Your website address">
      <div class="k1-live__top">
        <${ConnectionBadge} status="live" label="Live (simulated)" data-testid="k1-domain-badge" />
        ${dom.verifiedAt ? html`<span class="k1-live__when" data-testid="k1-live-when">Verified ${whenText(dom.verifiedAt)}</span>` : null}
      </div>
      <p class="k1-live__host k1-mono" data-testid="k1-live-host">${dom.domain}</p>
      <ul class="k1-ticks">
        <li><${Icon} name="shield-check" size=${18} /> Security certificate issued (simulated)</li>
        <li><${Icon} name="check" size=${18} /> DNS records found (simulated)</li>
      </ul>
      <div class="k1-live__actions">
        <${Button} variant="primary" icon="external-link" disabled aria-describedby="k1-open-why" data-testid="k1-open-site">Open site<//>
      </div>
      <p class="k1-small k1-live__why" id="k1-open-why" data-testid="k1-open-why">Open site is switched off. This address is simulated, so there is nothing at it to open yet. In a real build it opens your quote page.</p>
      <${CopyField} label="Link to share" value=${url} testid="k1-live-link" hint="Simulated: this link will not open yet." />
    </section>
    <${Disclosure} title="DNS records for this address" summary="For reference" testid="k1-live-records">
      <${RecordsTable} domain=${dom.domain} compact />
    <//>
    <${RealBuildNote} items=${[
      'A web address you own, with access to its DNS settings',
      'Hosting that answers on that address (your quote page and funnel)',
      'A security certificate, usually issued by the host once DNS points at it',
      'A real DNS lookup in place of this simulated check'
    ]} />
    <div class="k1-danger-zone">
      <${Button} variant="danger" icon="trash-2" onClick=${onRemove} data-testid="k1-domain-remove">Remove domain<//>
      <p class="k1-small">Takes your address off this prototype. You can set it up again at any time.</p>
    </div>
  </div>`;
}

// ---------- the screen ----------

export default function DomainView() {
  const dom = useStore(selectDomain);
  const status = dom.status;

  // Simulated delays finish by themselves: nudge the store now and every 5 seconds while this screen is open.
  useEffect(() => {
    settleConnections();
    const id = setInterval(() => { settleConnections(); }, 5000);
    return () => clearInterval(id);
  }, []);

  const [view, setView] = useState(status === 'live' ? 'live' : 'wizard');
  const [step, setStep] = useState(status === 'none' ? 'address' : (status === 'verifying' || dom.checks > 0 ? 'check' : 'records'));
  const [choice, setChoice] = useState(choiceOf(dom.domain));
  const [custom, setCustom] = useState(choiceOf(dom.domain) === 'custom' ? dom.domain : '');
  const [addrError, setAddrError] = useState('');
  const [lastCheck, setLastCheck] = useState(null);
  const [wentLive, setWentLive] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Keep the screen in step with the store (another tab, an Undo, or a simulated delay finishing).
  const quiet = useRef(false); // true right after Remove, so an Undo does not show the "you are live" banner
  useEffect(() => {
    if (view === 'live' && status !== 'live') {
      setView('wizard');
      setStep(status === 'none' ? 'address' : 'records');
      return;
    }
    if (view !== 'wizard') return;
    if (status === 'none' && step !== 'address') setStep('address');
    else if (status === 'live') {
      if (quiet.current) { quiet.current = false; setView('live'); return; }
      setWentLive(true);
      if (step !== 'check') setView('live'); // on the check step the success stays visible until Done
    }
  }, [status, view, step]);

  // When the screen swaps between the wizard and the live state, the focused button disappears: put focus on the page title.
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return; }
    focusTitle();
  }, [view]);

  const hostFor = () => (choice === 'main' ? MAIN : choice === 'custom' ? custom : SUGGESTED);

  const validateAddress = () => {
    const text = hostFor();
    const problem = friendlyHostError(text);
    if (problem) { setAddrError(problem); return problem; }
    const check = validateHostname(text);
    setAddrError('');
    quiet.current = false;
    if (status !== 'none' && dom.domain === check.host) return true; // nothing changed: keep any progress
    const res = startDomainSetup(check.host);
    if (!res || !res.ok) {
      const message = failureMessage(res, 'We could not save that address. Please try again.');
      setAddrError(message);
      return message;
    }
    undoToast({ message: `Address saved: ${check.host}`, detail: 'Simulated. Saved on this device only.', icon: 'globe', token: res.undoToken });
    return true;
  };

  const runCheck = async () => {
    if (status === 'live') { setView('live'); return true; }
    await sleep(700); // a short, honest pause: the check is simulated
    const res = checkDomain();
    if (!res || !res.ok) return failureMessage(res, 'We could not run the check. Please try again.');
    setLastCheck({ found: res.found, message: res.message });
    if (res.found) {
      setWentLive(true);
      toast({ message: 'Your address is connected', detail: 'Security certificate issued (simulated).', icon: 'shield-check' });
    }
    return true;
  };

  const remove = () => {
    setConfirmRemove(false);
    const res = disconnect('domain');
    if (!res || !res.ok) {
      toast({ message: failureMessage(res, 'We could not remove it. Please try again.'), tone: 'danger' });
      return;
    }
    quiet.current = true;
    setWentLive(false);
    setLastCheck(null);
    setChoice('suggested');
    setCustom('');
    setView('wizard');
    setStep('address');
    undoToast({ message: 'Address removed', detail: dom.domain, icon: 'trash-2', token: res.undoToken });
  };

  // The wizard footer shares one row with Back, so on the very narrowest phones the labels are the shortest that still make sense.
  const tiny = useMediaQuery('(max-width: 359px)');
  const checkLabel = status === 'live' ? 'Done' : (dom.checks > 0 ? 'Check again' : 'Check my DNS');
  const steps = [
    {
      id: 'address', title: 'Choose your web address', hint: 'This is what customers type to reach your quote page.',
      nextLabel: tiny ? 'Next' : 'Continue', validate: validateAddress,
      content: html`<${AddressStep} choice=${choice} setChoice=${setChoice} custom=${custom} setCustom=${setCustom} error=${addrError} setError=${setAddrError} />`
    },
    {
      id: 'records', title: 'Add these records', hint: 'You add them once, where you manage your web address.',
      nextLabel: tiny ? 'Next' : "I've added them", canNext: status !== 'none',
      content: html`<${RecordsStep} domain=${dom.domain || hostFor()} />`
    },
    {
      id: 'check', title: 'Check my DNS', hint: 'We look for your records and set up the security certificate.',
      nextLabel: checkLabel, content: html`<${CheckStep} dom=${dom} lastCheck=${lastCheck} wentLive=${wentLive} />`
    }
  ];

  const subtitle = view === 'live' ? 'Your quote page has its own address.' : 'Three short steps. Takes about five minutes, plus the wait for DNS.';
  return html`<div class="db-page k1-page k1-page--narrow" data-testid="k1-domain">
    <${PageHeader} back=${{ href: routeHref('connections'), label: 'Back to Connections' }} eyebrow="Connections" title="Your website address" subtitle=${subtitle} />
    <${SimBanner}>The records and the check are examples. Nothing is looked up for real.<//>
    <${StorageNote} />
    ${view === 'live'
      ? html`<${LiveView} dom=${dom} justWentLive=${wentLive} onRemove=${() => setConfirmRemove(true)} />`
      : html`<${Wizard} title="Your website address" testid="k1-domain-wizard" steps=${steps} step=${step} onStepChange=${(id) => setStep(id)}
          onFinish=${runCheck} finishLabel=${checkLabel} onCancel=${() => goBack(routeHref('connections'))} />`}
    <${ConfirmDialog} open=${confirmRemove} tone="danger" title="Remove this address?"
      body=${`Your quote page will stop answering at ${dom.domain} (simulated). You can set it up again whenever you like.`}
      confirmLabel="Remove address" cancelLabel="Keep it" onConfirm=${remove} onCancel=${() => setConfirmRemove(false)} />
  </div>`;
}
