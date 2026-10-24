// js/dashboard/views/share.js: Share and promote (the live site link, a QR code, tracked campaign links, a printable QR card).
// Owner: E3
import { html, useState } from '../../vendor/preact-htm.js';
import {
  Banner, Button, Card, Chip, CopyField, Field, Icon, Input, PageHeader, QrCode, Select, copyText, pageHref, pageTarget,
  qrSvgMarkup, saveFile, toast, useStore
} from '../../ui/index.js';
import { selectBrand, selectImageUrl } from '../../core/selectors.js';
import { LEAD_SOURCE_LABELS, SITE_BASE_URL } from '../../core/config.js';
import { normaliseLeadSource } from '../../core/utm.js';
import { waShareLink } from '../../core/messages.js';
import { routeHref } from '../router.js';

export const title = 'Share and promote';
export const css = ['css/share.css'];

const selectAll = (state) => state;

const SITE_URL = `${SITE_BASE_URL}index.html`;

// Where each link will be used. `source` becomes the lead source on the enquiry: the landing page reads utm_source, utm_medium
// and utm_campaign from the address. Sources that are not one of the sales channels count as "Direct or other" (shown on screen).
const PRESETS = [
  { id: 'facebook', label: 'Facebook ad', icon: 'megaphone', source: 'facebook', medium: 'paid_social', campaign: 'ev_charger_leads', use: 'Use it as the website link on your Facebook ad.' },
  { id: 'instagram', label: 'Instagram bio', icon: 'camera', source: 'instagram', medium: 'social', campaign: 'bio_link', use: 'Paste it into the link in your Instagram bio.' },
  { id: 'google', label: 'Google Business Profile', icon: 'search', source: 'google', medium: 'organic', campaign: 'business_profile', use: 'Use it as the website link on your Google Business Profile.' },
  { id: 'van', label: 'Van sign / QR', icon: 'truck', source: 'van', medium: 'qr', campaign: 'van_sign', use: 'Turn it into a QR code for the van, then print it below.' },
  { id: 'flyer', label: 'Flyer', icon: 'file-text', source: 'flyer', medium: 'print', campaign: 'door_drop', use: 'Put it, or its QR code, on a leaflet or business card.' },
  { id: 'whatsapp', label: 'WhatsApp status', icon: 'message-circle', source: 'whatsapp', medium: 'social', campaign: 'status', use: 'Post it on your WhatsApp status or in a customer chat.' }
];

/** Letters, digits and _ - . only, lower case, spaces become underscores (what the landing page keeps). */
const clean = (text) => String(text || '').toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_.-]/g, '').slice(0, 40);

export function trackedLink({ source, medium, campaign }) {
  const parts = [['utm_source', source], ['utm_medium', medium], ['utm_campaign', campaign]].filter(([, v]) => v);
  return parts.length ? `${SITE_URL}?${parts.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}` : SITE_URL;
}

const shortUrl = (url) => url.replace(/^https?:\/\//, '');

async function copyLink(url, what) {
  const ok = await copyText(url);
  toast({ message: ok ? `${what} copied` : 'Could not copy. Select the link and copy it by hand.', tone: ok ? 'default' : 'danger' });
}

// ---------- 1. the live link ----------

function LinkCard({ brand, domain }) {
  const text = `Get a home EV charger quote from ${brand.name}: ${SITE_URL}`;
  return html`<${Card} as="section" class="sh-card" aria-labelledby="sh-link-title" data-testid="share-link-card">
    <h2 class="sh-card__title" id="sh-link-title">Your enquiry page</h2>
    <p class="sh-card__text">This is the page customers answer your six questions on. Every enquiry lands in your diary as a pencilled-in survey.</p>
    <${CopyField} label="Page address" value=${SITE_URL} testid="share-url" hint="The prototype address. It changes when your own domain goes live." />
    <div class="sh-actions">
      <${Button} icon="external-link" href=${pageHref('index.html')} target=${pageTarget('index.html')} data-testid="share-open-site">Open the page<//>
      <${Button} icon="send" href=${waShareLink(text)} data-testid="share-send-whatsapp">Send on WhatsApp<//>
    </div>
    ${domain && domain.status === 'live'
      ? html`<p class="sh-card__note" data-testid="share-domain-note"><${Icon} name="globe" size=${16} /><span>${`${domain.domain} is connected (simulated). These links still use the prototype address until a real domain points at the site.`}</span></p>`
      : html`<p class="sh-card__note"><${Icon} name="globe" size=${16} /><span>Want your own address? <a class="ui-link ui-link--inline" href=${routeHref('connections-domain')}>Set up your domain</a>.</span></p>`}
  <//>`;
}

// ---------- 2. campaign links (UTM builder) ----------

function Builder() {
  const [presetId, setPresetId] = useState('facebook');
  const preset = PRESETS.find((p) => p.id === presetId);
  const [fields, setFields] = useState({ source: preset.source, medium: preset.medium, campaign: preset.campaign });

  const pick = (p) => {
    setPresetId(p.id);
    setFields({ source: p.source, medium: p.medium, campaign: p.campaign });
  };
  const set = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));
  const tidy = (key) => () => setFields((f) => ({ ...f, [key]: clean(f[key]) }));

  const link = trackedLink({ source: clean(fields.source), medium: clean(fields.medium), campaign: clean(fields.campaign) });
  const counts = LEAD_SOURCE_LABELS[normaliseLeadSource(clean(fields.source))];
  const text = `Get a home EV charger quote: ${link}`;

  return html`<${Card} as="section" class="sh-card" aria-labelledby="sh-utm-title" data-testid="share-builder">
    <h2 class="sh-card__title" id="sh-utm-title">Campaign links</h2>
    <p class="sh-card__text">Use a different link for each place you advertise. When someone enquires, the booking shows where they came from, so you can see which ads bring real work.</p>
    <div class="sh-presets" role="group" aria-label="Where will you use the link?">
      ${PRESETS.map((p) => html`<${Chip} key=${p.id} icon=${p.icon} selected=${p.id === presetId} onClick=${() => pick(p)} data-testid=${`share-preset-${p.id}`}>${p.label}<//>`)}
    </div>
    <p class="sh-card__note sh-use"><${Icon} name="info" size=${16} /><span>${preset.use}</span></p>
    <div class="sh-fields">
      <${Field} label="Source" id="utm-source" hint="Where it is posted">
        <${Input} id="utm-source" value=${fields.source} onInput=${set('source')} onBlur=${tidy('source')} maxlength="40" autocapitalize="none" spellcheck=${false} data-testid="share-utm-source" />
      <//>
      <${Field} label="Medium" id="utm-medium" hint="Type of link">
        <${Input} id="utm-medium" value=${fields.medium} onInput=${set('medium')} onBlur=${tidy('medium')} maxlength="40" autocapitalize="none" spellcheck=${false} data-testid="share-utm-medium" />
      <//>
      <${Field} label="Campaign name" id="utm-campaign" hint="Your own label, such as spring_offer">
        <${Input} id="utm-campaign" value=${fields.campaign} onInput=${set('campaign')} onBlur=${tidy('campaign')} maxlength="40" autocapitalize="none" spellcheck=${false} data-testid="share-utm-campaign" />
      <//>
    </div>
    <${CopyField} label="Your tracked link" value=${link} multiline testid="utm-link" />
    <p class="sh-counts" data-testid="share-counts-as"><${Icon} name="tag" size=${16} /><span>${`Counts as ${counts} in your lead sources.`}</span></p>
    <div class="sh-actions">
      <${Button} icon="external-link" href=${link} target=${pageTarget('index.html')} data-testid="share-utm-open">Try the link<//>
      <${Button} icon="send" href=${waShareLink(text)} data-testid="share-utm-whatsapp">Send on WhatsApp<//>
    </div>

    <h3 class="sh-sub">Ready-made links</h3>
    <ul class="sh-ready" data-testid="share-ready-links">
      ${PRESETS.map((p) => {
        const url = trackedLink(p);
        return html`<li class="sh-ready__item" key=${p.id}>
          <span class="sh-ready__text">
            <span class="sh-ready__label"><${Icon} name=${p.icon} size=${16} />${p.label}</span>
            <span class="sh-ready__url u-mono">${shortUrl(url)}</span>
          </span>
          <${Button} size="sm" icon="copy" onClick=${() => copyLink(url, `${p.label} link`)} aria-label=${`Copy the ${p.label} link`} data-testid=${`share-copy-${p.id}`}>Copy<//>
        </li>`;
      })}
    </ul>
  <//>`;
}

// ---------- 3. the QR card ----------

function QrCard({ state, brand }) {
  const [which, setWhich] = useState('site');
  const preset = PRESETS.find((p) => p.id === which);
  const value = preset ? trackedLink(preset) : SITE_URL;
  const [logoFailed, setLogoFailed] = useState(false);
  const options = [{ value: 'site', label: 'Your enquiry page' }].concat(PRESETS.map((p) => ({ value: p.id, label: `Tracked: ${p.label}` })));

  const download = async () => {
    try {
      const svg = await qrSvgMarkup(value, { title: `QR code for ${shortUrl(value)}`, margin: 4 });
      saveFile('enquiry-qr-code.svg', svg, 'image/svg+xml');
    } catch (err) {
      toast({ message: 'The QR code could not be saved here.', tone: 'danger' });
    }
  };
  const print = () => {
    try {
      if (typeof window.print !== 'function') throw new Error('no print');
      window.print();
    } catch (err) {
      toast({ message: 'Printing is blocked in this browser. Download the QR code and print it from there.', tone: 'danger' });
    }
  };

  return html`<${Card} as="section" class="sh-card sh-qrcard" aria-labelledby="sh-qr-title" data-testid="share-qr-card">
    <h2 class="sh-card__title" id="sh-qr-title">QR code for the van, flyers and cards</h2>
    <p class="sh-card__text">Customers scan it with their camera and land on your enquiry page. Print it, or save it and send it to your sign writer.</p>
    <${Field} label="What should it open?" id="share-qr-target">
      <${Select} id="share-qr-target" value=${which} options=${options} onChange=${(e) => setWhich(e.target.value)} data-testid="share-qr-target" />
    <//>
    <div class="sh-print" data-testid="share-print-card">
      <div class="sh-print__logo">
        ${logoFailed
          ? html`<span class="sh-print__name">${brand.name}</span>`
          : html`<img src=${selectImageUrl(state, 'logo', { width: 640 })} alt=${`${brand.name} logo`} width="320" height="212" decoding="async" referrerpolicy="no-referrer"
              onError=${(e) => {
                const el = e.target;
                if (el.dataset.fell) setLogoFailed(true);
                else { el.dataset.fell = '1'; el.src = 'img/logo-180.png'; }
              }} />`}
      </div>
      <p class="sh-print__kicker">Home EV charger installation</p>
      <p class="sh-print__title">Scan for your free EV charger quote</p>
      <div class="sh-print__qr"><${QrCode} value=${value} size=${220} label=${`QR code that opens ${shortUrl(value)}`} data-testid="qr-code" /></div>
      <p class="sh-print__phone u-tabular" data-testid="share-print-phone">${brand.phone}</p>
      <p class="sh-print__area">${`Serving ${brand.areaName}`}</p>
    </div>
    <div class="sh-actions sh-noprint">
      <${Button} variant="primary" icon="printer" onClick=${print} data-testid="share-print">Print the QR card<//>
      <${Button} icon="download" onClick=${download} data-testid="share-download-qr">Save QR code (SVG)<//>
    </div>
    <p class="sh-card__note sh-noprint"><${Icon} name="info" size=${16} /><span>Pick "Save as PDF" in the print window to keep a copy. Phone numbers and the QR code come from your Settings.</span></p>
  <//>`;
}

// ---------- the view ----------

export default function ShareView() {
  const state = useStore(selectAll);
  const brand = selectBrand(state);
  const domain = state.settings.connections && state.settings.connections.domain;
  return html`<div class="db-page sh-page" data-testid="share-view">
    <${PageHeader} title="Share and promote" subtitle="Get your page in front of more people, and see which ads work." />
    <div class="sh-stack">
      <${LinkCard} brand=${brand} domain=${domain} />
      <${QrCard} state=${state} brand=${brand} />
      <${Builder} />
      <${Banner} tone="info" icon="trending-up" class="sh-noprint">Enquiries from these links show their source on each booking and in your lead sources.<//>
    </div>
  </div>`;
}
