/* Behaviour for the V5 reference mock. Everything here is a stand-in for the real page's Preact behaviour (see docs/LANDING-V5.md):
   CTAs open the funnel (a stub here), the postcode check opens it prefilled, the sticky bar and the header button follow the hero button,
   "Show: With ideas | Only my content" hides every [data-proto], the tools popover holds the appearance switch, native <details name="faq"> is the accordion. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var root = document.documentElement;
  var q = new URLSearchParams(location.search);

  /* ?photos=fail: what a photo that cannot load looks like (the box keeps its shape; flat tone, nothing drawn on it) */
  if (q.get('photos') === 'fail') {
    $$('.lp-photo').forEach(function (ph) {
      var img = $('img', ph); if (!img) return; var alt = img.getAttribute('alt'); img.remove();
      var s = document.createElement('span'); s.className = 'lp-photo__ph'; s.setAttribute('role', 'img'); s.setAttribute('aria-label', alt + ' (photo not available right now)');
      ph.classList.remove('is-loaded'); ph.classList.add('is-failed'); ph.appendChild(s);
    });
  }

  /* ---------- funnel stub ---------- */
  var funnel = $('#funnel'), fpc = $('#f-pc');
  function openFunnel(pc) {
    fpc.value = pc || '';
    if (typeof funnel.showModal === 'function') funnel.showModal(); else funnel.setAttribute('open', '');
    fpc.focus();
  }
  $$('[data-cta]').forEach(function (b) { b.addEventListener('click', function (e) { e.preventDefault(); openFunnel(''); }); });
  $$('[data-close]', funnel).forEach(function (b) { b.addEventListener('click', function () { funnel.close(); }); });
  $$('[data-example-quote]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); }); });

  /* ---------- postcode check: one press validates, shows the verdict, and opens the funnel prefilled ---------- */
  var pcForm = $('#pc-form'), pc = $('#pc'), res = $('#pc-result');
  var POSTCODE = /^[A-Z]{1,2}[0-9][0-9A-Z]?\s*[0-9][A-Z]{2}$/i;
  var TICK = '<svg class="lp-glyph" width="20" height="20" aria-hidden="true"><use href="#g-tick"/></svg>';
  pcForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = pc.value.trim();
    res.className = 'lp-pc__result';
    if (!POSTCODE.test(v)) {
      res.textContent = 'Please enter a valid UK postcode so we can check your location.';
      res.classList.add('is-bad'); pc.setAttribute('aria-invalid', 'true'); pc.focus(); return;
    }
    pc.removeAttribute('aria-invalid');
    if (/^BT/i.test(v)) res.innerHTML = TICK + "<span>Good news, that's in our area.</span>";
    else res.textContent = 'That postcode looks to be outside Northern Ireland. You can still send an enquiry and Daniel will check.';
    openFunnel(v.toUpperCase());
  });
  pc.addEventListener('input', function () { if (pc.hasAttribute('aria-invalid')) { pc.removeAttribute('aria-invalid'); res.textContent = ''; res.className = 'lp-pc__result'; } });

  /* ---------- "Show: With ideas | Only my content" ---------- */
  function setIdeas(off) {
    if (off) root.setAttribute('data-clean', '1'); else root.removeAttribute('data-clean');
    $$('[data-ideas-btn]').forEach(function (x) {
      var sel = (x.getAttribute('data-ideas-btn') === 'off') === off;
      x.setAttribute('aria-pressed', String(sel)); x.classList.toggle('is-selected', sel);
    });
  }
  $$('[data-ideas-btn]').forEach(function (b) { b.addEventListener('click', function () { setIdeas(b.getAttribute('data-ideas-btn') === 'off'); }); });
  if (q.get('ideas') === 'off') setIdeas(true);

  /* ---------- prototype tools popover + appearance (Light is the default; Dark and Auto are opt-in) ---------- */
  var tbtn = $('#tools-btn'), tpanel = $('#tools-panel');
  function toolsOpen(open) { tpanel.hidden = !open; tbtn.setAttribute('aria-expanded', String(open)); if (open) tpanel.focus({ preventScroll: true }); }
  tbtn.addEventListener('click', function () { toolsOpen(tpanel.hidden); });
  $('#tools-close').addEventListener('click', function () { toolsOpen(false); tbtn.focus(); });
  document.addEventListener('pointerdown', function (e) { if (!tpanel.hidden && !e.target.closest('.ui-notice--public')) toolsOpen(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !tpanel.hidden) { toolsOpen(false); tbtn.focus(); } });
  function setTheme(t) {
    if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
    $$('[data-theme-btn]').forEach(function (x) { var s = x.getAttribute('data-theme-btn') === t; x.setAttribute('aria-checked', String(s)); x.classList.toggle('is-selected', s); });
  }
  $$('[data-theme-btn]').forEach(function (b) { b.addEventListener('click', function () { setTheme(b.getAttribute('data-theme-btn')); }); });
  if (q.get('theme') === 'dark' || q.get('theme') === 'auto') setTheme(q.get('theme'));

  /* ---------- header button + sticky bar: follow the hero button; both step aside while an in-page red quote button (postcode check, closing band) is on screen: one red button at a time ---------- */
  var hdr = $('#hdr'), sticky = $('#sticky'), heroCta = $('[data-hero-cta]');
  var gone = typeof IntersectionObserver !== 'function', blocked = new Map();
  function paint() {
    var any = false; blocked.forEach(function (v) { if (v) any = true; });
    sticky.classList.toggle('is-on', gone && !any);
    hdr.classList.toggle('is-cta-on', gone && !any);
  }
  if (typeof IntersectionObserver === 'function') {
    var zone = (matchMedia('(min-width:720px)').matches ? 72 : 0);
    new IntersectionObserver(function (en) {
      var e = en[en.length - 1]; var top = e.rootBounds ? e.rootBounds.top : 0;
      gone = !e.isIntersecting && e.boundingClientRect.top < top; paint();
    }, { rootMargin: '-' + zone + 'px 0px 0px 0px' }).observe(heroCta);
    var io2 = new IntersectionObserver(function (en) { en.forEach(function (e) { blocked.set(e.target, e.isIntersecting); }); paint(); }, { rootMargin: '0px 0px 0px 0px' });
    $$('[data-sticky-hide]').forEach(function (t) { io2.observe(t); });
  }
  paint();

  /* ---------- nav scroll spy (desktop header) ---------- */
  var links = $$('[data-spy]');
  if (typeof IntersectionObserver === 'function') {
    var spy = new IntersectionObserver(function (en) {
      en.forEach(function (e) { if (!e.isIntersecting) return; links.forEach(function (a) { var on = a.getAttribute('data-spy') === e.target.id; a.classList.toggle('is-active', on); if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); }); });
    }, { rootMargin: '-35% 0px -60% 0px' });
    links.forEach(function (a) { var s = document.getElementById(a.getAttribute('data-spy')); if (s) spy.observe(s); });
  }

  /* ---------- gallery: pager ticks follow the film strip; lightbox ---------- */
  var gal = $('.lp-gal'), dots = $$('.lp-gal__dot');
  function cardAt() {
    var cards = $$('.lp-gal__i', gal); if (gal.scrollWidth - gal.clientWidth <= 1) return 0;
    if (gal.scrollLeft >= gal.scrollWidth - gal.clientWidth - 2) return cards.length - 1;
    var box = gal.getBoundingClientRect(), pad = parseFloat(getComputedStyle(gal).paddingLeft) || 0, best = 0, bestGap = 1e9;
    cards.forEach(function (c, i) { var g = Math.abs(c.getBoundingClientRect().left - box.left - pad); if (g < bestGap) { best = i; bestGap = g; } });
    return best;
  }
  function paintDots() { var n = cardAt(); dots.forEach(function (d, i) { d.classList.toggle('is-current', i === n); if (i === n) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); }); }
  gal.addEventListener('scroll', function () { requestAnimationFrame(paintDots); }, { passive: true });
  dots.forEach(function (d, i) { d.addEventListener('click', function () {
    var card = $$('.lp-gal__i', gal)[i], box = gal.getBoundingClientRect(), pad = parseFloat(getComputedStyle(gal).paddingLeft) || 0;
    gal.scrollTo({ left: gal.scrollLeft + card.getBoundingClientRect().left - box.left - pad, behavior: 'smooth' });
  }); });

  var lb = $('#lb'), lbImg = $('#lb-img'), lbCap = $('#lb-cap'), lbN = $('#lb-n');
  var shots = $$('[data-lb]').map(function (b) {
    var img = $('img', b), cap = $('.lp-gal__cap', b.closest('figure'));
    return { src: img.getAttribute('src'), alt: img.getAttribute('alt'), cap: cap ? cap.textContent.replace(/^\d+/, '').trim() : '' };
  });
  var cur = 0, opener = null;
  function show(i) { cur = (i + shots.length) % shots.length; lbImg.src = shots[cur].src; lbImg.alt = shots[cur].alt; lbCap.textContent = shots[cur].cap; lbN.textContent = String(cur + 1); }
  function closeLb() { lb.hidden = true; root.style.overflow = ''; if (opener) opener.focus(); }
  $$('[data-lb]').forEach(function (b) { b.addEventListener('click', function () { opener = b; show(+b.getAttribute('data-lb')); lb.hidden = false; root.style.overflow = 'hidden'; $('[data-lb-close]').focus(); }); });
  $('[data-lb-close]').addEventListener('click', closeLb);
  $('[data-lb-prev]').addEventListener('click', function () { show(cur - 1); });
  $('[data-lb-next]').addEventListener('click', function () { show(cur + 1); });
  document.addEventListener('keydown', function (e) {
    if (lb.hidden) return;
    if (e.key === 'Escape') closeLb(); if (e.key === 'ArrowLeft') show(cur - 1); if (e.key === 'ArrowRight') show(cur + 1);
  });

  /* ---------- running-costs idea (the same arithmetic as js/landing/calc.js) ---------- */
  var LITRES_PER_GALLON = 4.54609;
  var DEF = { miles: 8000, homePence: 27, publicPence: 75, petrolPence: 140, mpg: 42, milesPerKwh: 3.5 };
  var LIM = { miles: [0, 100000], homePence: [1, 150], publicPence: [1, 250], petrolPence: [50, 300], mpg: [5, 150], milesPerKwh: [1, 8] };
  var nf = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
  var pounds = function (n) { return '£' + nf.format(Math.round(n)); };
  var num = function (t) { var r = String(t).trim().replace(/,/g, ''); return /^\d*\.?\d+$|^\d+\.$/.test(r) ? Number(r) : NaN; };
  var miles = $('#miles'), milesR = $('#miles-r'), rateIn = $$('.lp-rates input');
  function read() {
    var v = {}; var m = num(miles.value);
    v.miles = (isFinite(m) && m >= LIM.miles[0] && m <= LIM.miles[1]) ? m : DEF.miles;
    rateIn.forEach(function (i) { var k = i.getAttribute('data-k'), n = num(i.value); v[k] = (isFinite(n) && n >= LIM[k][0] && n <= LIM[k][1]) ? n : DEF[k]; });
    return v;
  }
  function paint2() {
    var v = read();
    var kwh = v.miles / v.milesPerKwh, litres = (v.miles / v.mpg) * LITRES_PER_GALLON;
    var home = Math.round(kwh * v.homePence / 100), pub = Math.round(kwh * v.publicPence / 100), petrol = Math.round(litres * v.petrolPence / 100);
    $('#c-home').textContent = pounds(home); $('#v-home').textContent = pounds(home); $('#v-petrol').textContent = pounds(petrol); $('#v-public').textContent = pounds(pub);
    var max = Math.max(home, pub, petrol, 1);
    [['b-home', home], ['b-petrol', petrol], ['b-public', pub]].forEach(function (p) { $('#' + p[0]).style.setProperty('--w', (Math.max(2, p[1] / max * 100)).toFixed(1) + '%'); });
    var d = petrol - home;
    $('#c-cmp').textContent = 'The same miles in a petrol car would cost about ' + pounds(petrol) + ' a year' + (d > 0 ? ', which is about ' + pounds(d) + ' more.' : d < 0 ? ', which is about ' + pounds(-d) + ' less.' : ', about the same.');
    $('#c-work').textContent = 'Your ' + nf.format(v.miles) + ' miles use about ' + nf.format(Math.round(kwh)) + ' kWh a year, which is ' + pounds(home) + ' at ' + nf.format(v.homePence) + 'p a kWh. A petrol car doing ' + nf.format(v.mpg) + ' mpg would use about ' + nf.format(Math.round(litres)) + ' litres, which is ' + pounds(petrol) + ' at ' + nf.format(v.petrolPence) + 'p a litre. At a public charger, ' + nf.format(v.publicPence) + 'p a kWh would come to ' + pounds(pub) + '.';
  }
  miles.addEventListener('input', function () { var n = num(miles.value); if (isFinite(n)) milesR.value = Math.min(25000, Math.max(1000, Math.round(n / 500) * 500)); paint2(); });
  miles.addEventListener('blur', function () { var n = num(miles.value); if (isFinite(n)) miles.value = nf.format(n); });
  milesR.addEventListener('input', function () { miles.value = nf.format(+milesR.value); paint2(); });
  rateIn.forEach(function (i) { i.addEventListener('input', paint2); });
  $('#calc-reset').addEventListener('click', function () { miles.value = nf.format(DEF.miles); milesR.value = DEF.miles; rateIn.forEach(function (i) { i.value = DEF[i.getAttribute('data-k')]; }); paint2(); });
  paint2();

  /* the rates disclosure: open and fixed from 1200, a real disclosure below it (production: a matchMedia hook sets `open`) */
  var more = $('#calc-more'), wide = matchMedia('(min-width:1200px)');
  function syncMore() { if (wide.matches) more.setAttribute('open', ''); }
  wide.addEventListener('change', function () { if (wide.matches) more.setAttribute('open', ''); else more.removeAttribute('open'); });
  more.addEventListener('toggle', syncMore);
  if (wide.matches) more.setAttribute('open', '');
  $('summary', more).addEventListener('click', function (e) { if (wide.matches) e.preventDefault(); });
  if (q.get('rates') === 'open') more.setAttribute('open', '');
})();
