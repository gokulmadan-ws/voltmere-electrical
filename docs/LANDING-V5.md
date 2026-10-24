# LANDING V5: build spec for the landing page rebuild

Status: decided, ready to build. Written 2026-10-24 by the lead designer for two engineers (B1, B2).
Scope: `index.html` head, `js/landing/*`, `css/landing.css`, new `css/landing-sections.css`, new `css/public-tokens.css`, and the small shared edits listed in 9.2.
Not in scope: the funnel's own steps and the quote page's own layout (section 10 lists the small token-level changes they must take).

Reference mock (real HTML and CSS, rendered): `docs/landing-v5-mock/`. Open it with `cd docs/landing-v5-mock && python3 -m http.server 4244`, then `http://localhost:4244/mock.html` (add `?ideas=off`, `?theme=dark`, `?photos=fail`, `?rates=open`).
Screenshots in `docs/landing-v5-mock/shots/`: `m-01` to `m-11` are the page at 390 x 844 (2x) scrolled in 844px steps and `d-01` to `d-11` the same at 1280 x 900; `m-full`, `d-full` and `off-d-full` are whole pages (colour-reduced); `dark-m-*` and `dark-d-*` the opt-in dark theme; `w-768`, `w-1024`, `w-1440` the hero at those widths; `x-*` are states (tools popover, lightbox, postcode error and success, funnel stub, gallery end, rates open, focus ring, failed photos).
The mock's CSS is written against the production class names and the production `data-testid`s, so `docs/landing-v5-mock/css/*.css` can be copied across and adapted rather than re-typed (see 9.1). Where this document and the mock disagree, this document wins. Where this document and `css/public-tokens.css` in the mock disagree on a token value, the token file wins (it was measured).

Baseline this spec was written against: git `ba0a446` plus the working-tree changes of 2026-10-24 about 10:50 (the PERF round: `js/landing/below.js`, `booking-host.js`, `ready.js`, the lazy booking sheet, the preload block in `index.html`). Keep all of that behaviour (9.7).

## Contents

0. Decisions at a glance
1. The design idea and the anti-slop blacklist
2. Tokens
3. Fonts and preload plan
4. Global components
5. Sections in order (390, 768, 1280, copy, spacing, images)
6. How the three prototype ideas are integrated
7. Motion
8. Theme: Light by default, dark mapping, and one coherent public product
9. Engineering notes (split, shared edits, testids, helpers, accessibility, performance, tests, acceptance checklist)
10. What the funnel sheet and the quote page must adopt
- Appendix A: where the three judges disagreed, and what was decided
- Appendix B: launch gates that need Daniel
- Appendix C: copy that is ours, not his

---

## 0. Decisions at a glance

1. Direction A, "Swiss editorial, light". One paper canvas (`#F5F5F4`, his near-white), one family (Archivo), a 12-column grid, 1px ink rules instead of boxes, photography in plain rectangles. No cards, no icon tiles, no radii, no shadows, no gradients.
2. The logo's colours carry the page by being rationed: near-black is the header, the closing band and the footer (the logo's own ground), red is "your move" or "open", and the logo's red/white stripes appear exactly once, at scale, in the closing composition (final call to action plus footer).
3. The logo's shapes carry the page through three devices only: the extended label voice (the ELECTRICAL wordmark), the bold italic extended "logo voice" (the 180) used for exactly three things (the two credential figures, the three step numerals, the three brand names), and the 45 degree cut on exactly two photos.
4. Display type is Archivo at width 108, weight 650, tracking -0.03em. This was tested against four other width/weight/tracking combinations (see Appendix A, item 9). Body is width 100, weight 400, in full ink.
5. The page is light by default (public pages only). Dark is opt-in in Prototype tools. The dashboard stays dark and untouched.
6. At most one red button is on screen at a time. The header button appears only after the hero button has scrolled out and steps aside while the postcode check or the closing band is on screen. The Why section's call to action is an underlined text link.
7. Seven sections used to open with the same "rule, number, label, H2" module. Now the section numbers are gone, labels are kept only where they are his own words and carry information (hero eyebrow, "Accredited and qualified", "Charger brands we install", "Our recent work"), and the compositions differ (split, photo first, plate with a heading cell, numerals in columns, standfirst row, field row, accordion, closing block).
8. The earliest-visit idea moves from the hero into step 02 as a margin annotation. The other two ideas sit in "Your installation, clearly quoted." as ruled rows. All three keep the tag "Idea from us, not on your site today" and a dashed rule. "Only my content" leaves no gap.
9. All copy is his, verbatim from `docs/reference/180-site-report.md` ("we", "the team", "180 Electrical"). The About band is no longer personalised to "Meet Daniel". Our own words are limited to the list in Appendix C.
10. Photos carry nothing: no chips, labels, badges, overlays, gradients, frames, shadows or rounded corners.

---

## 1. The design idea and the anti-slop blacklist

### 1.1 The idea

The landing page is set like a printed specification sheet for a piece of electrical equipment. A flat paper page, a very large confident headline, a hairline under everything, and a real photograph doing the heavy lifting. There is one typeface used in three voices that are all taken from his logo. There is one accent colour and it only ever means "this is the next thing to do" or "this is open". Near-black appears where the logo needs its own ground, and at the end the page becomes the logo at scale.

Three principles for every decision the engineers have to make that this document does not cover:

- Fewer things, used the same way every time. There are eight components (4). Do not add a ninth.
- A rule or whitespace before a box. If a thing seems to need a border, a background or a shadow, it needs a hairline or more space instead.
- Red is never decoration. If you are unsure whether something may be red, it may not.

### 1.2 Where the logo shows up

| Logo feature | Where it appears | Rule |
|---|---|---|
| Near-black ground (#0B0B0C) | Header, closing band, footer | The logo picture sits on this ground with `mix-blend-mode: lighten`, so it never shows a box. Nothing else on the page is black. |
| Red ELECTRICAL (extended, wide) | The label voice: Archivo at width 125, uppercase, +0.08em, 13px | Used for eyebrows, hanging labels, table headers, form labels, footer keys. Never larger than 13px. |
| White bold italic "180" | The logo voice: Archivo width 125, weight 800, italic | Exactly three uses: credential figures ("Level 3", "2391"), step numerals (01 to 03), brand names (ZAPPI, OHME, SYNC). Nowhere else, never in a heading. |
| Corner stripes, top-left and bottom-right | (a) The 45 degree cut on the hero photo (top-left) and the About photo (bottom-right). (b) The real stripes, rebuilt in CSS, in the closing composition: top-left of the final band, bottom-right of the footer. | (a) is bare geometry: the paper shows through, no stroke, no fill, no colour. (b) is the only place red and white stripes appear, and the footer lockup beside it is the un-striped crop so the device is never shown twice. |
| Red | See 1.3 | |

### 1.3 The red budget

Red `#E11414` may appear in exactly these places, and nowhere else:

1. The fill of every primary button (label white, 4.87:1, so 16px/600 or larger only).
2. The open marker of the FAQ (the plus turns into a red minus).
3. The active underline under the header nav item.
4. The 2px top rule of step 01 ("the one step the visitor does today").
5. The logo itself and the closing composition's stripes.

Red-deep `#B00E12` is button hover and pressed, and (as `--err`) the field error text and border. It is never a resting colour on paper.
Never: red text on paper, red headings, red icons, red washes, red glows, a red word inside the H1, red links, red numerals, red dots.

### 1.4 The anti-slop blacklist

If a pull request contains any of these, it is rejected. The numbers refer to the slop list in the brief.

1. Near-black sections as the page's main rhythm (black is only header, closing band, footer). No alternating black/white bands. [near-black everything]
2. Any glow, blur, backdrop-filter or `filter: drop-shadow`, and any `box-shadow` that is not a 1px hairline (the outline button's inset edge, the header's 1px rule). [red glows]
3. Any gradient except the logo stripes in the closing composition. [gradient washes]
4. A repeated rounded card with an icon tile. There are no cards and no icon tiles. [the same card]
5. Any border-radius other than 0. The one curved thing allowed is a status dot that is a circle by definition. [rounded]
6. The sequence overline + H2 + grey paragraph + card repeated. Sections have different compositions (5.0). [repeated rhythm]
7. Pill buttons, light sweeps, lift on hover, scale on press, glow on hover. [pill buttons]
8. Bolt watermarks, bolt icons, breaker graphics on the landing page, the hero "slash" underline, the old `hero-wiring.svg`. The bolt exists only inside his logo. [bolt watermarks]
9. Seal badges, credential chips, chips of any kind, pills over photos. His credentials are typography. [seal badges, chips]
10. Anything laid over a photograph: labels, captions, chips, scrims, gradients, frames, stripes. [chips over photos]
11. Centred composition. Everything is flush left on the grid (the closing band's H2 and the footer included). [centred everything]
12. Scroll reveals, parallax, auto-playing or looping motion, number tweens, progress bars, shimmer. [decorative motion]
13. Accent colour used as text, as a heading word, as an icon colour, or as a background. [accent on everything]
14. A two-tone H1 (white first sentence, grey second), a coloured last phrase, or italic headings. The H1 is solid ink on paper. [template tropes]
15. Widgets bolted on: the calculator and the example quote are ruled rows in the same type and the same tag/dashed-rule signature as everything else. [bolted-on widgets]
16. Grey body copy. Body paragraphs are ink. Grey (`--ink-2`) is for captions, notes, units, table captions, tag text, the footer legal line only. [low-contrast slop]
17. An icon font or icon library on the landing page. Five hand-drawn glyphs only (4.14).
18. Numbers 01 to 07 in front of section labels, "overline" eyebrows other than the four in 1.2, and any invented label that repeats its H2.
19. Anything that looks like a review, rating, years in business, grant, guarantee, trade-body membership or price. None exists on his site and none may be added.

---

## 2. Tokens

Authoritative source: `docs/landing-v5-mock/css/public-tokens.css`. Copy it to `css/public-tokens.css` verbatim (B1). The tables below explain it.

### 2.1 Colour

All values are his brand file or neutrals derived from his near-black. Nothing new is invented.

| Token | Light | Dark | Allowed use | Never |
|---|---|---|---|---|
| `--paper` | `#F5F5F4` | `#131315` | Page canvas. | A card or a band. |
| `--paper-2` | `#ECECEA` | `#1B1B1E` | The prototype strip and its popover hover. | Any public-content section. |
| `--paper-3` | `#E3E3E0` | `#232327` | A photo box before its picture arrives, or when it never does. Flat. | A pattern or a gradient. |
| `--field` | `#FFFFFF` | `#1B1B1E` | Input fill (postcode, funnel fields) and the popover panel. | A surface. |
| `--ink` | `#0B0B0C` | `#F5F5F4` | All text that matters, section rules, input borders, the selected segment, the slider thumb, bars (home), focus ring. 18.0:1 on paper. | A fill behind a section. |
| `--ink-2` | `#55555A` | `#B4B4B8` | Captions, notes, units, table captions, tag text, footer legal, helper text. 6.8:1 / 9.0:1. | Body paragraphs. |
| `--ink-3` | `#6B6B70` | `#97979B` | Table headers, line numbers, blank amount cells, placeholders. 4.9:1 / 6.4:1 on paper or field. | Body copy, anything under 13px, and never on `--paper-2` or `--paper-3` (4.5:1 on paper-2). |
| `--rule` | `rgba(11,11,12,.16)` | `rgba(245,245,244,.16)` | Inner hairlines (rows, tables, FAQ, footer rows). Decorative. | A boundary the layout depends on. |
| `--rule-d` | `rgba(11,11,12,.42)` | `rgba(245,245,244,.44)` | The dashed top rule of a prototype idea; the pager ticks. | |
| `--red` | `#E11414` | same | See 1.3. | See 1.3. |
| `--red-deep` | `#B00E12` | same | Button hover and pressed. | Resting state. |
| `--err` | `#B00E12` | `#FF8A80` | Field error text and border only. 6.6:1 / 8.1:1. | |
| `--black` | `#0B0B0C` | same | Header, closing band, footer. Equals the logo picture's own ground. | |
| `--on-black` | `#F5F5F4` | same | Text on black. | |
| `--on-black-2` | `rgba(245,245,244,.72)` | same | Secondary text on black. 9.4:1 (primary on-black text 18.0:1). | |
| `--rule-b` | `rgba(245,245,244,.20)` | same | Hairlines on black; the hairline under the header. | |

Contrast was computed for every text pair, light and dark: all 4.5:1 or better; axe-core (wcag2a, wcag2aa, wcag21aa, best-practice) reports 0 violations on the mock in light and dark, at 390 and 1280, and with ideas off.

### 2.2 Type scale

Families: `--f` (body: Archivo, width 100) and `--f-display` (Archivo with the display fallback, used with width 108). One family only. Numerals: `font-variant-numeric: lining-nums` on the body; `tabular-nums` additionally on every figure that aligns or changes (phone, dates, prices, rates, bar values, step numerals, credential figures).

Voices (all Archivo):

| Voice | Settings | Used for |
|---|---|---|
| Display | weight 650, `font-stretch: 108%`, tracking -0.03em, word-spacing +0.02em, `text-wrap: balance` | H1, H2, closing H2, the running-costs result, the footer phone |
| Title | weight 600, width 104, tracking -0.015em (idea H3: -0.03em) | H3 row and step titles, idea titles |
| Body | weight 400, width 100 | Everything else |
| Label | weight 600, `font-stretch: 125%`, uppercase, +0.08em, 13px/16px | Eyebrows, hanging labels, table headers, form labels, footer keys |
| Logo | weight 800, `font-stretch: 125%`, italic, tabular | Credential figures, step numerals, brand names. Nothing else. |

Scale (size / line-height; measured from the mock at 390, 768 and 1280):

| Role | 390 | 768 | 1280 | Notes |
|---|---|---|---|---|
| H1 | 32.9 / 33.5 | 67.7 / 69 | 92 / 93.8 | `clamp(26px, (100vw - 2*margin) / 10.4, 92px)`; line-height 1.02; max-width 11.4em; first sentence is its own line and never wraps at any width 320 and up |
| H2 | 30 / 31.8 | 44 / 46.6 | 52 / 55 | line-height 1.06, max-width 16em |
| H2 compact | 30 | 44 | 44 / 46.6 | About column and the gallery heading cell, at 1024 and up |
| Closing H2 | 40 / 40 | 64 / 64 | 88 / 88 | line-height 1.0; from 1024 `clamp(56px, (100vw - 2*margin) * 0.0775, 88px)` |
| Statement (pricing, area) | 20 / 28 | 22 / 30.8 | 22 / 30.8 | weight 400, tracking -0.012em, ink, max 30em |
| Lede (hero) | 18 / 27 | 20 / 30 | 20 / 30 | ink, max 30em |
| About paragraph 1 | 20 / 28 | 20 / 28 | 24 / 32.4 | tracking -0.01em |
| Body | 17 / 25.5 | 17 / 25.5 | 18 / 27 | ink; paragraphs never wider than 40em |
| H3 (rows, steps) | 20 / 25 | 20 / 25 | 24 / 30 | |
| H3 (ideas) | 26 / 29 | 32 / 36 | 32 / 36 | |
| Credential figure | 26 | 34 | 40 | logo voice, tracking -0.02em, line-height 1 |
| Brand names | 20 | 28 | 32 | logo voice, tracking +0.02em |
| Step numerals | 56 (lh 0.9) | 56 | 104 (lh 0.9) | logo voice, tracking -0.04em |
| Visit date | 24 / 30 | 24 / 30 | 24 / 30 | weight 600, tabular, tracking -0.025em, optical margin-left -0.04em |
| Running-costs result | 62 | 72 | 72 | display voice, tracking -0.04em, `clamp(56px, 16vw, 72px)` |
| FAQ question | 19 / 24.7 | 19 / 24.7 | 22 / 28.6 | weight 600, tracking -0.015em |
| FAQ answer | 17 / 25.5 | 17 / 25.5 | 18 / 27 | ink, max 40em |
| Footer phone | 32 / 35 | 40 / 44 | 48 / 53 | display voice, tabular |
| Footer values | 20 / 26 | 20 / 26 | 24 / 31 | weight 500 |
| Label | 13 / 16 | 13 / 16 | 13 / 16 | |
| Small (notes, captions, table captions, legal) | 14 / 20 | 14 / 20 | 14 / 20 | `--ink-2`; 14px is the floor for readable text (13px only in uppercase labels and the tag; 12px only in the prototype strip) |
| Button | 16 | 16 | 16 | weight 600, tracking -0.005em. Small 14, xl 18 (16 below 360). |
| Nav / phone | 15 (phone) | 15 | 14 (nav) / 15 (phone) | weight 500; phone tabular, +0.01em |
| Postcode field | 24 | 24 | 28 | weight 500 |
| Miles field | 28 | 28 | 28 | weight 600 |

### 2.3 Spacing (8pt rhythm)

Scale: 4 (inside controls only), 8, 12, 16, 24, 32, 40, 48, 56, 64, 72, 96, 128, 160.

| Token | 390 | 720 | 1024 | Used for |
|---|---|---|---|---|
| `--sec` | 72 | 96 | 128 | Space above Work, Pricing, Questions (the standard gap) |
| `--sec-l` | 96 | 128 | 160 | Space above Why, About, How it works, Area, and above the closing band (sections with large type or a photo breathe more) |
| Section rule to content | 16 | 16 | 20 | Between the 1px ink rule and the first element |
| Page margin `--m` | 24 | 32 | 48 | Left and right |

Other gaps used: hero eyebrow to H1 16/16/20; H1 to hero body 32/32/48; body to CTA 32; CTA to notes 16; photo margin-top 40 on phones; spec strip margin-top 40/40/72; rows padding 24 (32 at 1024); H2 to content 32 (mobile) and per 5.x (desktop); idea block margin-top 64 (96 at 1024); sticky bar padding 12.

### 2.4 Shape, hairlines, shadows

- Radii: 0 everywhere (the logo is angular). The legacy `--r-*` and `--r-pill` tokens are set to 0 on public pages. If Daniel asks for softer corners, the only permitted value is 2px on buttons and form fields (one change to the token block); never on photos, rules or the cut.
- Hairlines: `--hair: 1px` for every rule and border; `--bold: 2px` for emphasis (step top rules, the focus ring, the FAQ plus lines, the focused postcode field, the miles underline).
- Shadows: none. The legacy `--shadow-*` tokens are `none`, except `--shadow-2/3` which become a 1px ink edge (for popovers and sheets over a scrim).

### 2.5 Container, grid, breakpoints

- Container: `.lp-wrap` max-width 1280 including the 48px margins (content 1184); full width below. Margins 24 / 32 / 48 at under 720 / 720 to 1023 / 1024 and up.
- Grid: 12 columns, 24px gutter, used from 1024. Below 1024 everything is a single column except the gallery film strip.
- Bleeds: the hero photo runs to the viewport's right edge at 1024 and up (`margin-right: calc(-1 * (var(--m) + var(--bleed)))`, `--bleed: max(0px, (100vw - 1280px) / 2)`, `.lp-hero { overflow-x: clip }`). On phones the hero and About photos run edge to edge (`margin-inline: calc(-1 * var(--m))`).
- Breakpoints (min-width): 720 (tablet: margin 32, header CTA allowed, sticky bar off, bigger H2), 1024 (desktop grid, header nav, 88px cut), 1200 (the running-costs rates stay open). Narrow fixes: under 360 (button sizes, sticky bar, strip), under 400 (the "Show:" word hides), 1024 to 1179 (header phone number hides, icon only with an `aria-label`).
- Measure: paragraphs 40 to 62 characters wide at every breakpoint.

### 2.6 z-index

`--z-header: 20` (header), `--z-bar: 30` (sticky bar), `--z-pop: 40` (prototype strip and its popover, above the sticky header), `--z-lightbox: 120`, skip link 300. The funnel sheet and scrim keep their own 100 and 110; toasts keep 200.

### 2.7 The cut and the stripes (exact geometry)

- Cut: `clip-path` on the `<figure>`, never on a button. `--cut`: 40px under 720, 56px from 720, 88px from 1024.
  - Top-left: `polygon(var(--cut) 0, 100% 0, 100% 100%, 0 100%, 0 var(--cut))`.
  - Bottom-right: `polygon(0 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%)`.
  - Rules: exactly two photographs, the hero (top-left) and the About photo (bottom-right). Never on the gallery, buttons, inputs or cards. Never a third. The paper shows through; no fill, stroke or colour.
- Closing stripes: an element `--sl` square (128 / 176 / 232px) with `clip-path: polygon(0 0, 100% 0, 0 100%)` and `linear-gradient(135deg, red 0 19%, transparent 19% 25%, on-black 25% 32%, transparent 32% 38%, red 38% 50%)`. Top-left on the final band (`::before`), bottom-right on the footer (`::after`, rotated 180deg). Text must clear them: the final band's top padding is `--sl + 16px`, the footer's bottom padding is `--sl`.

---

## 3. Fonts and preload plan

### 3.1 What to vendor

One package: `@fontsource-variable/archivo@5.3.0` (SIL OFL 1.1). Copy exactly these two files to `fonts/` (they are already in `docs/landing-v5-mock/fonts/`):

| File | Axes | Size | sha256 |
|---|---|---|---|
| `fonts/archivo-latin-wdth-normal.woff2` | weight 100 to 900, width 62 to 125 | 90,104 B | `e3a28eade21a900c7155a247757f4b2834c07bb7ef07ad7efa55cebaac1e8f5e` |
| `fonts/archivo-latin-wdth-italic.woff2` | weight 100 to 900, width 62 to 125 | 101,676 B | `d63de74ee5ad92cd506c8dd0f795e84bd084aea8eef90173b5d2464096c5fa4a` |
| `fonts/LICENSE-archivo-OFL.txt` | licence | | |

Use the `wdth` files, not the `wght`-only files: the width axis is the whole point (the display voice is width 108, the label and logo voices are width 125). Latin subset only (his copy is English; `£` and the en dash are in Latin). Inter and Manrope files and their `@font-face` rules stay in `css/fonts.css` for the owner dashboard but are no longer preloaded or used on `index.html` and `quote.html`.

PERF round: the two files in `fonts/` are NOT the sizes above any more. They were the heaviest thing on the first screen (192 KB, both fetched before the page loads), so `scripts/subset-fonts.py archivo` trims them from the originals kept in `docs/landing-v5-mock/fonts/`: the upright file keeps weight 400 to 800 and width 100 to 125 (54.8 KB), the italic file is a static font pinned at weight 800, width 125, the logo voice (14.4 KB). Same code points, same outlines. `tests/unit/fonts.test.mjs` holds the size budget and checks `.lp-logovoice` still asks for exactly 800 and 125%; if the CSS ever needs another weight or width, change `JOBS` in the script and run it again. Do not re-copy the originals into `fonts/`.

### 3.2 `css/fonts.css` additions

The exact text is in `docs/landing-v5-mock/css/fonts.css` (append it above the existing Inter and Manrope rules). Summary:

```css
@font-face { font-family: 'Archivo'; font-style: normal; font-weight: 100 900; font-stretch: 62% 125%; font-display: swap;
  src: url('../fonts/archivo-latin-wdth-normal.woff2') format('woff2'); unicode-range: /* same latin range as the existing Inter rule */; }
@font-face { font-family: 'Archivo'; font-style: italic; /* same, italic file */ }
/* Metric-matched fallbacks so the swap moves nothing (measured in Chromium against Liberation Sans / Arial: Archivo ascent 0.878, descent 0.210). */
@font-face { font-family: 'Archivo Fallback'; src: local('Arial'), local('Helvetica Neue'), local('Helvetica'), local('Liberation Sans');
  size-adjust: 98%; ascent-override: 89.6%; descent-override: 21.4%; line-gap-override: 0%; }
@font-face { font-family: 'Archivo Fallback Display'; font-weight: 700; src: local('Arial Bold'), local('Arial-BoldMT'), local('Helvetica Neue Bold'), local('Liberation Sans Bold');
  size-adjust: 105%; ascent-override: 83.6%; descent-override: 20%; line-gap-override: 0%; }
```

Body fallback (width 100, weight 400) is 98% as wide as Arial; display fallback (width 108, weight 650) is 105% as wide as Arial Bold. Stacks (in `public-tokens.css`): `--f: 'Archivo', 'Archivo Fallback', system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif` and `--f-display` with `'Archivo Fallback Display'`. `font-display: swap` on both faces. The fallbacks cannot imitate the width axis; the shift is small because the H1 is sized from the container width, not from the glyphs.

### 3.3 Preload plan

First view requests, and only these: the HTML, the CSS (`fonts.css`, `tokens.css`, `base.css`, `components.css`, `public-tokens.css`, `landing.css`), the module graph (already `modulepreload`ed), the logo (360w, remote), the hero photo (the width the phone will pick), `archivo-latin-wdth-normal.woff2` (preloaded) and `archivo-latin-wdth-italic.woff2` (requested by the credential figures as soon as the hero lays out; not preloaded). `landing-sections.css` and the gallery, About and lightbox images load with the sections (9.7).

`index.html` head, in this order (replacing the two Inter and Manrope preloads; keep the existing preconnects and the two image preloads):

```html
<html lang="en-GB" data-scope="public" data-theme="light">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#0B0B0C">
<link rel="preload" href="fonts/archivo-latin-wdth-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="css/fonts.css">
<link rel="stylesheet" href="css/tokens.css">
<link rel="stylesheet" href="css/base.css">
<link rel="stylesheet" href="css/components.css">
<link rel="stylesheet" href="css/public-tokens.css">   <!-- AFTER tokens.css: same specificity on the auto-dark block, later wins -->
<link rel="stylesheet" href="css/landing.css">
```

The hero image preload keeps its `href` and `imagesrcset` (widths 640, 960, 1100, 1280 from `imageUrl('hero', ...)`) but its `imagesizes` becomes `(min-width: 1024px) 65vw, 100vw` (the photo is 8 of 12 columns plus the bleed from 1024, full width below). `<Photo>` in `hero.js` must use the same `sizes` string. Update the one assertion in `tests/unit/modulepreload.test.mjs` that pins the old string.
`quote.html` gets the same `data-scope`, `color-scheme`, font preload and `public-tokens.css` line. `dashboard.html` is not touched.

Optional follow-up (not part of this build): the italic file is used only for digits, "Level" and the three brand names; subsetting it to Basic Latin with `pyftsubset` (keeping the `wght` and `wdth` axes) would save most of its 99 KB. Do it only if the Lighthouse font budget demands it.

---

## 4. Global components

Eight components, plus the strip, header, photo and glyph primitives. All CSS is in `docs/landing-v5-mock/css/landing.css` (B1) unless marked B2.

### 4.1 Button (the only red fill)

`<LpButton>` in a new `js/landing/ui.js` (B1) renders an `<a>` when `href` is given, else a `<button type="button">`. Classes `lp-btn lp-cta` (the `lp-cta` class stays: tests and the booking prefetch select on it). Not the shared `ui/button.js` (its sizing, radius and press behaviour are the old look). Variants:

| Variant | Spec |
|---|---|
| Primary | `#E11414` fill, white 16px/600 label left, 20px arrow glyph right, 24px gap, 24px side padding, 56px high, square. Hover `--red-deep` and the arrow moves 4px right (200ms). Pressed `--red-deep` and 1px down. Full width below 720 where it stands alone, auto width from 720. Label is always exactly "Get my installation quote". |
| `--sm` (header) | 44px high, 14px, 16px padding, no arrow. |
| `--xl` (postcode check, closing band) | 64px high, 18px, 32px padding (16px type and 16px padding under 360). |
| `--outline` | Transparent, 1px ink inset edge, ink label. Used once: the sticky bar's Call. Hover and pressed: ink fill, paper label. |

Focus: the global ring, 2px solid `--focus` at 3px offset (paper-coloured ring on black). Hover rules sit inside `@media (hover: hover)`. In forced-colors mode the button gets `border: 1px solid ButtonText`.

### 4.2 Text link

`<TextLink>`: ink, 16px/600, a 1px underline that also runs under the trailing arrow, 44px hit area (12px vertical padding; the underline is a pseudo-element 9px above the box bottom). The arrow moves 4px on hover. Quiet variant: 14px/500 `--ink-2`, no arrow (Reset). Used for: the Why call to action, "See how a quote looks", Reset, the popover's page links (underlined, no chips).

### 4.3 Rules

- Section rule: 1px ink at the top of the container (content edge to content edge, not viewport edge), 16px (20px at 1024) above the first element.
- Inner hairline: 1px `--rule` between rows, table rows, FAQ items, footer rows.
- Strong row: 1px ink (above the spec strip, above the trust row on desktop, the rates disclosure's top).
- Idea rule: 1px dashed `--rule-d`, full container width, directly above an idea's tag.
- Step rule: 2px, ink for steps 02 and 03 and red for step 01 (at 1024 and up; on phones step 01 has a 2px red top and the others a hairline).

### 4.4 Form field

- Postcode (`lp-pc__in`): white (`--field`) fill, 1px ink border, square, 64px high, 24px/500 (28px from 1024), label above in the label voice, placeholder `e.g. BT7 3AB` in `--ink-3`, uppercase input. Joined to the button with no gap from 720 (one row); stacked with an 8px gap below 720. Focus: 2px ink outline flush against the border (`outline-offset: 0`). Invalid: border and outline `--err`, `aria-invalid="true"`, message below in `--err` 15px/500. Success state: the verdict line in ink 15px/500 with the tick glyph in ink in front.
- Calculator fields: underline-only, no box. Miles: 56px high, 28px/600, 2px ink underline, left-aligned; rates: 44px high, 72px wide, 16px/500, right-aligned, tabular, 1px `--ink-3` underline, the unit in `--ink-2` 14px beside it. Focus: underline becomes 2px ink, no outline. 16px or larger always (no iOS zoom).
- Slider: 1px ink track, a flat 20px ink square thumb, 44px hit area. No round knob, no coloured fill.
- Label voice above every field. Helper text 14px `--ink-2` below. Errors have text, never colour alone.

### 4.5 Accordion

Native `<details name="faq">` and `<summary>`: exclusive (one open at a time) in current browsers; in older ones several may open, which is acceptable. First item open: the cost question, by passing `open` on that one `<details>` only and never changing it. Summary: min-height 48px, padding 18px 0 (28px from 1024), question 19px/600 (22px from 1024), a 20px plus drawn with two 2px lines on the right, `--ink-2`, turning into a red minus when open (200ms). Answer: 17px/18px ink, 40em max, 28px (36px) bottom padding. The height animates with `::details-content` plus `interpolate-size: allow-keywords` (progressive enhancement: instant where unsupported). Hairlines between items, a hairline under the last.

### 4.6 Chip

None. There are no chips on the page. Chip-like things are re-expressed: the prototype switch is a square segmented control; the popover's page links are underlined text links; credentials are typography; the idea tag is plain text with a diamond. A status or tag need in the funnel or quote page uses the label voice with a hairline, not a pill.

### 4.7 Tag for prototype ideas

`ProtoTag` in `js/landing/idea.js` (B1; also used by the funnel confirmation and the quote page) renders `<span class="ui-idea-tag" data-testid="idea-tag"><i class="ui-idea-tag__d" aria-hidden="true"></i><span>Idea from us, not on your site today</span></span>`. Style: 13px/16px weight 500 `--ink-2`, no border, no background, no radius, a 7px square outlined and rotated 45 degrees in front (the same angle as the cut). Always directly under a dashed rule. Never red, never clickable. The component accepts a `label` for a tighter spot, as now. The bulb icon is removed.

### 4.8 Lightbox

Keep the existing logic in `gallery.js` (modal `role="dialog"`, focus trap, Esc, arrow keys, swipe, neighbour prefetch, scroll lock via `html.is-scroll-locked`, focus returns to the opening tile). New skin: full-screen `--black`, a 64px top bar with "Photo 1 of 4" (14px `--on-black-2`, tabular; the `aria-live` text stays) and a text button "Close" (14px/600, underlined, 44px high; keeps `aria-label="Close photo viewer"`), the photo contained (never cropped, never zoomed: the phone screenshot shows whole), the caption (the wall type, 14px `--on-black-2`) below it, and Previous and Next as 56px (72px from 720) outlined squares with the arrow glyph (1px `--rule-b`, `--on-black` on hover). No round buttons, no icons from the shared set, no scrim gradient.

### 4.9 Sticky mobile bar

`<nav class="lp-sticky" aria-label="Quick actions" data-testid="sticky-bar">`, below 720 only. 80px plus the bottom safe-area inset: `--paper` fill, 1px ink top rule, 12px padding, an outlined Call (`sticky-call`, phone glyph and "Call", `aria-label="Call 07885 496800"`, 56px high) and the red button (`sticky-book`, label "Get my installation quote", 15px, arrow). It slides up (250ms) once the hero button has scrolled out above the viewport and goes away while any `[data-sticky-hide]` block (the postcode section, the final band) is on screen, while a sheet is open (`html.is-scroll-locked`) and while the on-screen keyboard is open (`html.is-keyboard-open`). Under 360px the arrow hides and the label drops to 14px so the label always fits. Hidden means `visibility: hidden`, so it leaves the tab order.

### 4.10 Header

Black (`--black`) bar, 64px (72px from 1024). Position: static below 720 (it scrolls away; the sticky bar is the persistent control and a 64px sticky header plus an 80px bar would eat 17% of an 844px screen), sticky from 720. A 1px `--rule-b` hairline below it (visible where it passes over the black closing band and in dark theme). Contents: the logo lockup left (the crop window of 5.1), the nav centred from 1024 (About, Our work, How it works, Pricing, Questions; 14px/500 `--on-black-2`, white when active, 2px red underline scaling in from the left over 200ms; driven by `useScrollSpy`), the phone number right (`lp-header-phone`, 15px tabular, phone glyph; under 1180 and over 1024 the number hides and the link keeps `aria-label="Call 07885 496800"`), and the small red button (`lp-header-book`) only from 720 and only while `.is-cta-on` (hero button gone and no in-page red button on screen). The header never changes size or look on scroll (no condensing, no shadow, no progress line).

### 4.11 Prototype strip and tools popover

Same DOM and testids as now (`js/ui/notice.js`, `js/ui/ideas.js`), re-skinned only by CSS in `landing.css` under `:root[data-scope="public"]` so the funnel and the quote page get it too (the selectors are listed in the mock's `landing.css`, section "prototype strip"). Light `--paper-2` strip with a 1px bottom hairline, 44px high (every control a real 44px target around a 24 to 28px visible element), `Prototype tools` on the left as 12px text with a chevron and a 1px underline, the switch on the right: "Show:" then two square segments in a 1px ink border, the selected one ink-filled with paper text. The popover: a `--field` panel with a 1px ink border, square, no shadow, hairline rows, label-voice titles, "Appearance" as a three-way square segmented control (Light, Dark, Auto), owner area links, page links as underlined text. Wording is unchanged. The strip is never `data-proto` (it carries the way back from "Only my content"). Removed entirely in production.

### 4.12 Label

`.lp-lbl`: the label voice (2.2). It hangs in the margin only where it carries information (his words). It is never boxed.

### 4.13 Photo and logo primitives (`media.js`, B1)

- `Photo` keeps its props (`img`, `ratio`, `widths`, `sizes`, `eager`, `as`, `class`, `fallback` is dropped) and its reserved box. Changes: `ratio="fill"` renders no `aspect-ratio` so CSS sizes the box; no shimmer; while loading and when failed the box is flat `--paper-3` (nothing drawn); on failure it renders `<span class="lp-photo__ph" role="img" aria-label="{alt} (photo not available right now)">` instead of the old charger-drawing placeholder (`img/landing-placeholder.svg` stays for the quote page); no fade-in. `--zoom` still applies to `has-zoom` photos (gallery-photo-1).
- `LogoImg` keeps its behaviour (remote logo, local `img/logo-180.png` fallback, `lighten` blend, `decorative` empty alt, eager for the header). The crop window changes to `--cx: .2273; --cy: .3039; --cw: .5368; --ch: .3922` (tighter than before: the wordmark reads at 48px). `.lp-logo` and `.lp-logo__img` class names stay (the funnel header uses them); the funnel's `.bk-brand--logo .lp-logo { --logo-h: 40px }` stays. `quote.css` `.q2-logo` takes the same four fractions.

### 4.14 Glyphs

`js/landing/glyphs.js` (B1): `Glyph({ name, size })` returning inline SVG, `fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: square`. Names: `arrow` (20x20, `M3 10h13M11 4.5 16.5 10 11 15.5`), `tick` (`M3.5 10.5 8 15 16.5 5.5`), `phone` (24x24, the stroke-1.6 handset path in the mock), `chev` (12x12), `x`. The paths are the `<symbol>`s at the top of `docs/landing-v5-mock/mock.html`. The shared `Icon` set is not used on the landing page. The shared `Icon` still draws the popover close button inside `notice.js`; the mock restyles it with CSS only.

---

## 5. Sections in order

Order, with the composition that makes each one different at 1280:

| # | Section (id) | Composition at 1280 | Gap above |
|---|---|---|---|
| a | Prototype strip | slim bar (prototype only) | |
| b | Header | black bar | |
| c | Hero (`top`) | H1 across 9 columns, copy and CTA in columns 1 to 4, 3:2 photo from column 5 bleeding right | 56 |
| d | Spec strip (inside hero) | ticks row, then trust row in the logo voice | 72 |
| e | Why (`why`) | H2 sticky left (cols 1 to 5), three ruled rows right (cols 6 to 12), text link | `--sec-l` |
| f | About (`about`) | photo first (cols 1 to 7), H2 and his two paragraphs right (cols 9 to 12), brands row below | `--sec-l` |
| g | Work (`work`) | plate: heading cell then four photos on a 12 x 2 grid | `--sec` |
| h | How it works (`how`) | H2 then three columns of italic numerals | `--sec-l` |
| i | Your quote (`pricing`) | H2 left and standfirst right on one baseline, then two idea rows | `--sec` |
| j | Area (`area`) | H2, then statement left and the field row right | `--sec-l` |
| k | Questions (`faq`) | H2 sticky left (cols 1 to 4), accordion right (cols 5 to 12) | `--sec` |
| l | Final band (`final`) | black, large H2 left, paragraph and button right, stripes top-left | `--sec-l` |
| m | Footer | black continuation, un-striped lockup, three keyed rows, stripes bottom-right | 0 |
| n | Sticky bar | phones only | |

Page heights in the mock (with ideas): 9,072px at 390 and 9,790px at 1280. With "Only my content": 7,160px and 7,777px.

The mock's `docs/landing-v5-mock/mock.html` is the markup reference for every section below; this part says what it must produce.

### 5.1 Header (see 4.10) and the logo window

Logo lockup: `<a class="lp-brand" href="#top" aria-label="180 Electrical, back to the top"><span data-testid="lp-lockup"><LogoImg decorative eager/></span></a>`. Height `--hdr-logo-h`: 48px (56 from 1024); the window crop is the lockup only (the corner stripes are outside it). Nav links are anchors to `#about #work #how #pricing #faq`; `aria-current="true"` on the active one. The "Costs" nav item is removed (an idea should not be in the main nav); the popover keeps its "Running costs" page link (it hides itself under "Only my content" through `linkShown`).

### 5.2 Hero

Copy, verbatim:
- Eyebrow: "Local EV charger installation"
- H1: "Your own EV charger. Installed at home in Northern Ireland." (two spans; the second wraps balanced; `Northern Ireland.` is wrapped in `<span class="lp-nowrap">`, a CSS `white-space: nowrap`, not a non-breaking space, so the text stays byte-identical)
- Lede: "Make charging fit around your day. 180 Electrical helps homeowners across Northern Ireland choose and install the right charger for their home and vehicle."
- CTA: "Get my installation quote"
- Under the CTA, two lines: "Tell us a little about your home and what you need." (`--ink-2`) and "Free, no-obligation quote." (ink, 600, `data-testid="hero-proof-free"`)

Layout:
- 390: eyebrow, H1 (3 lines: 32.9px, container 342px), lede (18px ink), full-width red button (CTA at y 409 to 465 on an 844 screen without the strip), the two note lines, then the 3:2 photo full-bleed with the top-left cut (40px). The photo starts at y about 561 and is never cropped.
- 768: same order, button auto width, lede 20px, H1 67.7px; photo full-bleed.
- 1280: H1 spans the container (92px, 3 lines, widest line 935px of 1184), 48px below it the copy column (cols 1 to 4) and the 3:2 photo (cols 5 to 12, 829 x 553, bleeding to the right edge, top-left cut 88px). With the strip removed, the first screen at 1280 x 900 shows the full H1, lede, button, notes and about 74% of the photo (the man, the charger and the car are all in the visible part).

Header button: hidden here (the hero button is the one red button).
`id="top"` stays on the hero section (back-to-top links, `scroll-margin-top: 0`).

Image: hero 3:2 true ratio (file 1080 x 720), `object-position: 50% 42%` (existing focal point), `loading="eager"`, `fetchpriority="high"`, `sizes="(min-width: 1024px) 65vw, 100vw"`, `widths=[640, 960, 1100, 1280]`. When the real photo arrives, check that the man and the charger are clear of the top-left 88px cut.

### 5.3 Spec strip (his ticks and his two credentials)

Directly under the photo, inside the hero section, `data-testid="hero-proof"`. Two ruled bands under a 1px ink rule.

1. Ticks (`data-testid="hero-ticks"`, `aria-label="What you get"`), from `HERO.ticks` (move them out of `ABOUT.ticks`): "Advice on charger options", "Installation tailored to your property", "Speak directly with 180 Electrical". Each: the tick glyph in ink (not red), text 17px/500 (18px from 1024). 390: three stacked rows with hairlines, 16px padding. 1280: three equal columns, 28px padding, no hairlines between.
2. Trust (`data-testid="hero-creds"`, `role="group"`, labelled by the label "Accredited and qualified"): the label, then each credential from `credentialList()` (Settings, default "Level 3 Electrical Installation", "2391 Inspection and Testing"), each `data-testid="hero-cred-{i}"`. Each is split by `splitCredential(text)` = `/^(Level\s+\d+|\d+[A-Za-z]?)\s+(.*)$/i` into a figure (logo voice, 26 / 34 / 40px) and a descriptor (17 / 18px ink). If the text does not match, it renders as the descriptor only. 390: label row, then each credential as a hairline row with the figure in a 128px column and the descriptor beside it on the same baseline. 1280: three equal columns (label, credential, credential), the figure above the descriptor, 12px apart, 28 to 36px padding, 1px ink rule above.
No icons, no checks, no chips here. The textContent of each credential reads exactly "Level 3 Electrical Installation" and "2391 Inspection and Testing".

### 5.4 Why: "Home charging that works around you."

Copy, verbatim: H2 "Home charging that works around you."; rows "Charge while you're at home" / "Plug in when you arrive and charge around your routine."; "Choose with confidence" / "Get help choosing a charger suited to your vehicle, property and preferences."; "Make the most of smart charging" / "Compatible chargers and suitable electricity tariffs can let you schedule charging for off-peak periods."; then the call to action as a text link: "Get my installation quote" with the arrow (`data-testid="why-cta"`, opens the funnel).
Markup: `section#why[data-testid="why-cards"]`, `.lp-sec.lp-sec--l`, inner `.lp-wrap.lp-sec__in.lp-why`: `h2.lp-h2.lp-display`, then `.lp-why__rows` with `ul.lp-rows` and the link. No eyebrow, no numbers, no icons.
- 390: H2 30px, 32px gap, three rows (title 20px/600, text 17px ink, hairlines, 24px padding), the link 24px below.
- 768: same, the text capped at 30em.
- 1280: grid; H2 cols 1 to 5, `position: sticky; top: header + 32px`; rows cols 6 to 12 (title 24px above its 18px text, 32px padding, hairline between, the first row starts level with the H2's first line); the link 32px below the last row.

### 5.5 About: "Meet your local EV charger installers."

Copy, verbatim: H2 "Meet your local EV charger installers."; P1 "180 Electrical installs home EV chargers for homeowners across Northern Ireland. We take time to understand your property and how you drive, then fit a charger that suits both."; P2 "Every visit is planned around a safe cable route and a tidy finish, so your charger looks like it belongs on your home."; label "Charger brands we install"; brands from Settings (default ZAPPI, OHME, SYNC) as plain text in the logo voice.
Markup: DOM order is photo, then text (H2 first inside the text), then brands. `section#about[data-testid="about"]`; photo `figure.lp-about__photo.lp-cut-br` with `data-testid="about-photo"` on the Photo; text wrapper; `div[data-testid="about-body"]` holds P1 and P2 (`about-pull` is on P2); `div.lp-brands[data-testid="brands"]` with the label in `.lp-lbl`.
- 390: rule, photo edge to edge (4:3, bottom-right cut 40px) 24px below the rule, H2 (30px), P1 (20px/28 ink), P2 (17px ink), then the brands: label, then three equal cells split by hairlines (names 20px, 16px padding).
- 768: same, names 28px.
- 1280: grid; photo cols 1 to 7 (681 x 511) top-aligned at the rule with the bottom-right cut 88px; text cols 9 to 12 as a flex column with `justify-content: space-between` (the H2 at 44px top-aligned to the photo, P1 at 24px and P2 at 18px bottom-aligned to it, 40px minimum gap); then 96px below, the brands row: label hanging in cols 1 to 3 (label voice, wraps to two lines), names in cols 4 to 12 in three equal cells split by vertical hairlines (32px).
Image: About 4:3 (file 3600 x 2697), `object-position: 50% 59%` (his focal point), lazy, `sizes="(min-width: 1024px) 58vw, 100vw"`, `widths=[640, 1000, 1600]`. Keep his face and the van clear of the bottom-right cut when the real photo arrives. No caption, no name caption (the earlier "Daniel, 180 Electrical" caption was inferred, not his).

### 5.6 Our recent work: "Installations across Northern Ireland"

Copy, verbatim: label "Our recent work", H2 "Installations across Northern Ireland". The four photos with numbered captions that name only the wall: "01 Red brick wall", "02 Pebbledash wall", "03 Orange brick wall", "04 Brick pillar". Never name a charger make (the photos show Zappi, Ohme and Fox ESS; his brand list says ZAPPI, OHME, SYNC).
Display order and ratios (reorder `IMAGES.work` to this order so the testid indices equal the display order; `gallery-photo-1` remains the zoomed screenshot): index 0 `work1` (portrait 3:4, red brick), 1 `work2` (phone screenshot, tile 3:4 with `--zoom: 1.45`, `overflow: hidden` on the tile so the black bars fall outside, pebbledash), 2 `work4` (landscape, `object-position: 50% 39%`, orange brick), 3 `work3` (portrait 3:4, brick pillar). Put each caption in `IMAGES.work[i].caption`; the old `chip` and `title` fields go.
Markup: `section#work[data-testid="gallery"]`, `.lp-plate` containing `.lp-plate__head` (the label and the H2) and `ul.lp-gal[role="list"][data-testid="l3-gallery-row"]` with four `li.lp-gal__i--N`, each `figure > button.lp-gal__b[aria-haspopup="dialog"][aria-label="View photo N of 4 larger"][data-testid="l3-gallery-open-{i}"] > Photo ratio="fill"[data-testid="gallery-photo-{i}"]` plus `figcaption.lp-gal__cap[data-testid="gallery-chip-{i}"]` (number in 600 tabular, then the wall type, 14px `--ink-2`). After the list: `div.lp-gal__dots[role="group"][aria-label="Choose a photo"][data-testid="gallery-dots"]` with four `button.lp-gal__dot[data-testid="gallery-dot-{i}"]`.
- 390 and 768: heading block first (label, H2 30 / 44px), 32px gap, then a film strip that bleeds to both edges (`margin-inline: -margin`, snap-x proximity, 12px gap, no scrollbar): every photo 344px tall (420 from 720) at its own ratio (widths about 258, 258, 459, 258 at 390), the next photo always peeking; under it four pager ticks (24 x 2px, ink when current, `--rule-d` otherwise, each a 44 x 44 button) that follow the scroll and scroll to the photo on press.
- 1024 and up: the strip becomes a plate on the 12-column grid, two rows, row gap 40: row 1 = heading cell (cols 1 to 4: the label then the H2 at 44px) | photo 01 (cols 5 to 8) | photo 02 (cols 9 to 12); row 2 = photo 03 landscape (cols 1 to 8, filling the row height, so cropped to about 1.55:1 from 1.34:1 at `object-position: 50% 39%`) | photo 04 (cols 9 to 12). The portraits are 3:4 at four columns wide (379 x 505 at 1280). The pager ticks hide. There is no hint line and no empty cell.
Hover (pointer devices only): the photo drops to 94% opacity, cursor `zoom-in`. No scale. Click or Enter opens the lightbox (4.8).
Images: lazy, `decoding="async"`, `widths=[360, 600, 900]`, `sizes`: portraits `(min-width: 1024px) 31vw, 258px`, landscape `(min-width: 1024px) 62vw, 460px`, each with `width`/`height` of the original so the box is reserved. Each `alt` is the existing descriptive alt in `content.js`.

### 5.7 How it works: "From first enquiry to charging at home."

Copy, verbatim: H2 "From first enquiry to charging at home."; "01 Tell us about your home" / "Answer a few short questions about your location, parking and plans."; "02 Discuss your installation" / "The team will review your enquiry and explain the next steps. Photos or a survey may be needed to prepare an accurate quote."; "03 Arrange your installation" / "Once you are happy with the agreed quote and scope, arrange a suitable installation date."
Markup: `section#how[data-testid="how-it-works"]`, `ol.lp-steps[data-testid="l3-steps"]`, each `li.lp-step` with `span.lp-step__n.lp-logovoice[aria-hidden="true"]` (the numeral is decorative; the `ol` already numbers the steps), `h3`, `p`. Step 02 also contains the earliest-visit idea (6.1).
- 390: rule, H2, then a list of rows: numeral in an 88px column (56px, logo voice) beside the title (20px/600) and text (17px ink); hairline between rows; step 01 has a 2px red top rule.
- 768: same.
- 1280: H2 (52px, cols 1 to 8), 64px below it three equal columns, each under a 2px rule (ink, ink, and red for 01), the numeral 104px (32px above the title), the title 24px/600, the text 18px ink, 12px between. Step 02 is taller because of its annotation; the columns align at the top, not stretched.

### 5.8 Your quote: "Your installation, clearly quoted."

Copy, verbatim: H2 "Your installation, clearly quoted."; statement "Costs depend on your charger choice, cable route and any electrical work required. Tell us about your home so the team can advise on the next steps towards an accurate quote."
There is no call to action in this section (his site has none here; the red button is in the postcode section and the closing band) and no "promise" line (the old "A clear quote, not a headline figure that changes later." was a rewrite of his FAQ answer and is removed).
Markup: `section#pricing[data-testid="pricing"]`, `.lp-pricing__head` (the H2 and `p.lp-statement`), then the two ideas (6.2, 6.3).
- 390: H2, 24px gap, statement (20px/28 ink), then the ideas stacked with 64px above each.
- 1280: one row on a shared baseline (`align-items: end`): H2 cols 1 to 6 (two lines at 52px), statement cols 7 to 12 (22px/30.8, three lines in 580px); then the ideas 96px below.
- With "Only my content" the section is just this row and the next section's gap closes up normally.

### 5.9 Area: "EV charger installation in Northern Ireland."

Copy, verbatim: H2 "EV charger installation in Northern Ireland."; statement "We install home chargers across Northern Ireland. If you are not sure, enter your postcode and we will check."; the note under the field "Enter your postcode so we can check your location."; the button "Get my installation quote".
Label above the field: "Your postcode" (our wording, kept from the current page; his funnel's step label is "UK postcode"). Placeholder "e.g. BT7 3AB".
Behaviour (one press, one action; replaces the old two-step "Check my postcode" then "Continue with BT7 3AB"):
1. Submit with an invalid postcode: `aria-invalid="true"` on the field, focus returns to it, the result line (`data-testid="coverage-result"`, `aria-live="polite"`) shows his funnel's message "Please enter a valid UK postcode so we can check your location." in `--err`.
2. Submit with a valid postcode: the result line shows the verdict for `postcodeZone()`: covered "Good news, that's in our area." (tick glyph, ink), edge and outside as now (`AREA.edge`, `AREA.outside`, with `{owner}` and phone filled), then `startEnquiry({ postcode })` opens the funnel prefilled. The verdict stays visible behind the sheet and when it closes.
3. Editing the field clears the error and the verdict.
Markup: `section#area[data-testid="area"][data-sticky-hide]`, `h2`, `.lp-area__row` (the statement and `form.lp-pc[data-testid="area-form"]`), input `data-testid="coverage-input"`, button `data-testid="coverage-book"` (class `lp-btn lp-btn--xl lp-cta`), note `p.lp-pc__note`, result `p.lp-pc__result`.
- 390: H2, statement, label, 64px field, 8px gap, full-width 64px button, note, result.
- 768: field and button on one row (button auto width, joined to the field).
- 1280: H2 (cols 1 to 8, two lines); 48px below, the statement in cols 1 to 5 and the form in cols 6 to 12 (field about 370px wide at 28px type joined to a 311px button).

### 5.10 Questions: "Frequently asked questions"

Copy: H2 "Frequently asked questions" and the six questions and answers verbatim from the report, in this order, each as a `<details name="faq">` (`data-testid="faq-item-{i}"`) with the `<summary>` (`data-testid="faq-q-{i}"`) and the answer paragraph:

1. "Which charger is right for my car?" / "Most home chargers suit most electric and plug-in hybrid cars, but the best choice depends on your vehicle, how you drive and your preferences. We will help you weigh up the options once we know a little about your setup."
2. "Do I need a driveway or private parking?" / "A charger needs a suitable parking position and a safe route for the cable that does not create a hazard. We assess this for your property rather than assuming it. Running a cable across a public pavement is not a standard solution, so let us know your setup and we will advise."
3. "How much will installation cost?" (open on load) / "It depends on the charger you choose, the cable route and any electrical work your property needs. We give you a clear quote once we understand your requirements, rather than a headline figure that changes later."
4. "How long does installation take?" / "Timing varies with the property and the scope of work involved. Once the team has reviewed your enquiry, they can talk you through what to expect for your specific installation."
5. "Can I have a charger installed before my car arrives?" / "Many homeowners plan the installation while waiting for their car. Tell us where you are in the process and we will suggest sensible timing so your charger is ready when you need it."
6. "What happens after I enquire?" / "The team reviews your details and contacts you to discuss your installation and the next steps. Submitting the form is an enquiry, not a booking, and it does not produce an instant final price."

Component: 4.5. Layout: 390 H2 then the list (32px gap); 1280 grid: H2 cols 1 to 4 sticky (52px, three lines "Frequently / asked / questions"), accordion cols 5 to 12, summary padding 28px, a hairline above every item and under the last (the first item's hairline sits about 20px below the section rule, level with the H2's first line).

### 5.11 Final call to action (closing composition, top half)

Copy, verbatim: H2 "Ready to make charging at home simpler?"; paragraph "Tell us about your home and plans. 180 Electrical will review your enquiry and help you understand your installation options."; button "Get my installation quote" (`data-testid="final-book"`, class `lp-btn lp-btn--xl lp-cta lp-final__btn`).
Markup: `section.lp-final#final[data-testid="final-cta"][data-sticky-hide]` inside `<main>` (so the section stays in the main landmark); the footer follows `<main>` and is black as well, so the two read as one block with a hairline between them.
- 390: black band, the top-left stripes (128px) in the corner, top padding 144px so the H2 clears them, H2 40px (three lines), paragraph 18px `--on-black-2`, full-width 64px button, 72px bottom padding.
- 768: stripes 176px, H2 64px, button auto width, 96px bottom padding.
- 1280: stripes 232px, top padding 248px; grid: H2 cols 1 to 8 (88px, three lines, rows 1 to 2); cols 9 to 12: the paragraph aligned to the H2's top, the 64px button aligned to the H2's bottom (the two ends of the H2 are tied to the two things on the right); 128px bottom padding.
Never centred. No second button, no phone line (the footer carries the phone at 48px directly below).

### 5.12 Footer (closing composition, bottom half)

Copy: phone "07885 496800", email "daniel@180electrical.co.uk", "Serving Northern Ireland", "© {year} 180 Electrical". Keys (label voice, `--on-black-2`): Phone, Email, Area. If the owner has typed an address in Settings, a fourth row "Address" renders (`l3-footer-address`); otherwise none.
Markup: `footer.lp-footer[data-testid="footer"]` > `.lp-wrap.lp-footer__grid`: the un-striped lockup (`a[data-testid="footer-lockup"]` > `LogoImg`, window height 88px, 112px from 1024; no corner stripes because the stripes are drawn beside it), `dl.lp-footer__list` with three rows (`dt` key, `dd` value; phone `dd` is the display voice at 32 / 40 / 48px, tabular, a `tel:` link `data-testid="footer-phone"`; email a `mailto:` link `data-testid="footer-email"` at 20 / 24px with `overflow-wrap: anywhere`; every link a 44px-high target), `p.lp-footer__legal[data-testid="footer-copyright"]` (14px `--on-black-2`).
- 390: 1px `--rule-b` above, 48px, lockup, then the three rows stacked (hairlines above each and under the last), legal; bottom padding `--sl` (128px) so the bottom-right stripes (128px, rotated 180deg) clear the text.
- 1280: grid; lockup cols 1 to 4, list cols 5 to 10 (so it ends before the stripes), legal cols 5 to 10; bottom padding 232px.
No credentials line (they are in the spec strip), no WhatsApp, no link cloud, no disclosure paragraph (it lives in the Prototype tools popover).

### 5.13 The seven images

| Key | Where | Box and ratio | Crop and focus | Loading | Failed or stand-in |
|---|---|---|---|---|---|
| logo | Header, footer | window onto the lockup (crop 0.2273 / 0.3039 / 0.5368 / 0.3922), height 48 / 56 (header), 88 / 112 (footer) | none; `mix-blend-mode: lighten` | header eager, footer lazy | falls back to `img/logo-180.png` (same layout) |
| hero | Hero | 3:2 (1080 x 720), full-bleed phone, cols 5 to 12 bleeding right at 1024+, top-left cut | `object-position: 50% 42%`, never cropped | eager, `fetchpriority="high"`, preloaded in the head | flat `--paper-3` box of the same shape |
| about | About | 4:3 (3600 x 2697), full-bleed phone, cols 1 to 7 at 1024+, bottom-right cut | `object-position: 50% 59%` | lazy | flat box |
| work1 | Gallery 01 | 3:4 tile (file 1170 x 1532) | centred | lazy | flat box |
| work2 | Gallery 02 | 3:4 tile of a 739 x 1600 phone screenshot, `--zoom: 1.45`, `overflow: hidden` | centred; the zoom pushes the black bars out of the tile | lazy | flat box (zoom irrelevant) |
| work4 | Gallery 03 | 4:3 on phones, about 1.55:1 (cols 1 to 8, row height) at 1024+ (file 3600 x 2684) | `object-position: 50% 39%` (keeps the charger above centre) | lazy | flat box |
| work3 | Gallery 04 | 3:4 tile (file 1200 x 1600) | centred | lazy | flat box |

Every `<img>` has `width` and `height`, a descriptive `alt` (the existing alt text in `content.js`; no addresses, no product claims), `decoding="async"`, `referrerpolicy="no-referrer"`, a reserved box so nothing shifts. The lightbox shows each file whole (`object-fit: contain`).
A photo that fails to load, or is blocked in this sandbox: the box keeps its exact shape, filled flat with `--paper-3`, with `role="img"` and an `aria-label` that is the alt plus "(photo not available right now)". Nothing is drawn, nothing is written on it, and the cut still shows. `?photos=fail` in the mock shows this.
For local visual QA without his hot-linked photos: copy `docs/landing-v5-mock/img/{hero,about,work1,work2,work3,work4}.svg` to a git-ignored `img/standins/` and set the six photo URLs to those relative paths in dashboard Settings. They are flat tonal illustrations at the real ratios and carry no text. They are not shipped.

---

## 6. How the three prototype ideas are integrated

Common rules (every idea): it carries `data-proto="true"` (via `protoProps`) so "Only my content" removes it with the one existing rule `html[data-clean] [data-proto] { display: none !important }`; it opens with a 1px dashed `--rule-d` line across the container and the tag (4.7) directly under it; it uses only ink and hairlines (no red, no cards, no fills, no icons, no radii); it is built from the same rows, table and type as his content; it carries no price except the arithmetic the visitor can see and change. The tag is the same everywhere: "Idea from us, not on your site today".
Under "Only my content" the DOM nodes are `display: none`, the sections close up (verified in the mock at both sizes: zero idea nodes visible, no gaps), and the header's `useHiddenSections` still drops links to hidden sections.

### 6.1 Suggested earliest visit (in step 02)

Moves out of the hero into step 02 ("Discuss your installation"), the step that already mentions a survey, so it reads as a suggestion on the route, not a promise beside his accreditation. Markup: inside `li.lp-step` 02, after its paragraph: `div.lp-visit[data-proto][data-testid="hero-visit"]` (the testid name is kept so existing selectors keep working) containing the tag, then `span[data-testid="live-availability"]` with `p.lp-visit__k` "Earliest visit Daniel could offer", `p.lp-visit__date[data-testid="next-free-slot"]` ("Mon 26 Oct, 8 to 10am", 24px/600 tabular; the day in `<time>`), `p.lp-visit__conf` "Daniel will confirm.". The annotation sits 32px below the paragraph, under a dashed rule with 20px of padding beneath it. Read-only text, never a button. Diary full: "Diary full for the next {n} days." with a quiet text link "Call Daniel" to the phone. `LiveAvailability` and `visitWords` move from `hero.js` to a new `js/landing/visit.js` (B2); the logic (`nextFreeSlots`, `useNow(60000)`) is unchanged. The calendar icons are dropped.

### 6.2 See how a quote looks (in "Your installation, clearly quoted.")

`div.lp-idea.lp-qpeek[role="group"][data-proto][data-testid="quote-preview"]`. Only rendered when `pickSampleQuote()` finds a sent quote (as now). Intro (cols 1 to 5): H3 "See how a quote looks" (32px/36 from 720), "Curious what you would receive? Open an example quote and read it line by line." (ink, 24em), then a text link "See how a quote looks" with the arrow (`data-testid="pricing-sample-link"`, `href` to `quote.html#q=<id>&preview=1`, same tab-handling as now via `pageHref`/`pageTarget`). Body (cols 6 to 12): a four-row table (`aria-hidden`, names only): No. / Line / Amount; 01 Your chosen home charger, 02 Installation, 03 Dedicated circuit, 04 Testing and certification; the amount cells are blank 72px underlines (it looks like a blank quote form and shows no figures); caption "Example only" (14px `--ink-2`, `data-testid="quote-preview-tag"`). 390: intro, then the table; the first and fourth names wrap to two lines.

### 6.3 Running-costs calculator (in "Your installation, clearly quoted.")

`div.lp-idea.lp-calc#savings[data-proto][data-testid="l3-calc"]`, directly under the example quote. It keeps `calc.js` unchanged (same arithmetic: 8,000 miles gives £617 home, £1,212 petrol, £1,714 public; the CALC copy is unchanged except the additions in Appendix C).
Structure (cols 1 to 5: intro; cols 6 to 12: body; the intro is sticky at 1024+):
1. Intro: H3 "What would home charging cost you?", "A rough guide, using example rates that you can change."
2. Miles: label "Miles you drive in a year", a 28px/600 underline field (`l3-calc-miles`) with "miles a year" beside it (`--ink-2`), a hairline slider with a flat 20px ink square thumb (`l3-calc-slider`, min 1,000, max 25,000, step 500).
3. Result (`l3-calc-result`, `aria-live="polite"`): "Home charging would cost about" (14px `--ink-2`), then "£617" at 62 to 72px in the display voice with "a year" in `--ink-2` beside it (`l3-calc-headline`, the figure `l3-calc-home-big`), then one comparison sentence in ink (`l3-calc-compare`: "The same miles in a petrol car would cost about £1,212 a year, which is about £595 more."). The `l3-calc-saving-big` span stays around the difference inside that sentence (the mock's script writes the sentence as plain text; production keeps the span).
4. Bars (`table.lp-bars[data-testid="l3-calc-workings"]`, caption "The same miles, three ways"): Home charging, Petrol, Public charging; a 6px bar (home solid ink, the others 28% ink), the value right-aligned tabular (`l3-calc-home`, `l3-calc-petrol`, `l3-calc-public`); the bar widths ease over 300ms. Never red.
5. Rates (`details.lp-calc__more[data-testid="l3-calc-assumptions"]`, summary "Change the rates" with the plus/minus): the label "Rates we have assumed", five ruled rows (label left; underline-only right-aligned tabular input; the unit beside it; `l3-calc-field-{homePence|petrolPence|mpg|milesPerKwh|publicPence}`), the note "Examples only, not 180 Electrical prices. A kWh is the unit of electricity on your bill. Change any figure to match yours.", the label "How we worked this out" and the workings sentence (`l3-calc-workings-text`), and the quiet text link "Reset" (`l3-calc-reset`, `aria-label="Reset to the example figures"`). Under 1200 it is a closed disclosure (so the phone page is not five rows longer); from 1200 it is open and its summary is hidden (a `useMedia('(min-width: 1200px)')` hook sets `open`).
6. Footnote row under a hairline: the label "Illustrative estimate" (`l3-calc-badge`) and "An illustration, not a quote or a promise. Your own costs will differ with your car, your driving and the rates you pay." (`l3-calc-footnote`).
The old number tween (`useTween`) and the old card chrome are removed; figures update instantly, bars ease. A screen-reader summary still settles 600ms after the last change (`u-sr-only` live region), as now.

---

## 7. Motion

Calm and functional only. Everything is under 250ms. Everything is disabled under `prefers-reduced-motion: reduce` (one global rule zeroes transitions and animations on public pages; the booking-wait spinner alone slows to 2.4s per turn).

| What | Motion | Duration and easing |
|---|---|---|
| Primary button | background to `--red-deep`; the arrow moves 4px right | 150ms ease; 200ms ease. Pressed: 1px down, no scale |
| Text link | arrow moves 4px right | 200ms ease |
| Header nav | red underline scales in from the left for the active section | 200ms ease |
| Header button, sticky bar | the header button appears (no animation); the sticky bar slides up | 250ms ease (`visibility` delayed so hidden means untabbable) |
| FAQ | plus rotates to a red minus; the answer height eases open | 200ms ease; 250ms ease (`::details-content`, instant where unsupported) |
| Calculator | bar widths | 300ms ease |
| Gallery | none on press; hover 94% opacity on pointer devices | instant |
| Lightbox, popover, funnel sheet | open instantly | none |

None of: scroll reveal (delete `initReveal`, every `data-reveal` and `data-rv`, `.lp-rv`, `lp-rise`), parallax, glow, shimmer, light sweep, pulse, the header scroll progress line, the header condensing, number tweens, a looping animation anywhere. `scroll-behavior: smooth` only under `prefers-reduced-motion: no-preference`; `scroll-padding-top` = header height + 16 from 720 (16 below), `scroll-padding-bottom` = bar + safe area + 12 below 720.

---

## 8. Theme: Light by default, dark mapping, one coherent public product

### 8.1 Defaults

- The public pages (`index.html`, `quote.html`, and the funnel sheet that opens on them) are LIGHT with no saved choice. They never fall back to dark or to Auto. A customer on a dark-mode phone still sees the light page.
- The dashboard stays dark by default, with its own storage key and tokens.
- The two scopes must not leak into each other (an owner who chose dark on the dashboard must not get a dark landing page on the same device, and a customer previewing dark must not flip the owner's dashboard in another tab).

Implementation (B1; the edit to `js/ui/theme.js` is about ten lines):
- Public pages: `<html data-scope="public" data-theme="light">` in the HTML. The inline head script reads `localStorage['vm_theme_public']` (`light`, `dark` or `auto`); anything else is `light`. `dark` and `light` set `data-theme`; `auto` removes it. `theme-color` stays `#0B0B0C` in every case (the header is black at the top of the page).
- `theme.js`: `const PUBLIC = document.documentElement.getAttribute('data-scope') === 'public'`; `KEY = PUBLIC ? 'vm_theme_public' : 'vm_theme'`; `DEFAULT_CHOICE = PUBLIC ? 'light' : 'dark'`; in public scope `setThemeChoice` does not call `storeSetTheme` and `initTheme` does not subscribe to the store mirror. The dashboard path is byte-for-byte the same as today.
- Appearance lives only in Prototype tools (Light, Dark, Auto). In production the strip is removed and the page is simply light.

### 8.2 Token mapping

| Token | Light (default) | Dark (opt-in) | Same in both |
|---|---|---|---|
| `--paper` | `#F5F5F4` | `#131315` | |
| `--paper-2` | `#ECECEA` | `#1B1B1E` | |
| `--paper-3` | `#E3E3E0` | `#232327` | |
| `--field` | `#FFFFFF` | `#1B1B1E` | |
| `--ink` | `#0B0B0C` | `#F5F5F4` | |
| `--ink-2` | `#55555A` | `#B4B4B8` | |
| `--ink-3` | `#6B6B70` | `#97979B` | |
| `--rule` | `rgba(11,11,12,.16)` | `rgba(245,245,244,.16)` | |
| `--rule-d` | `rgba(11,11,12,.42)` | `rgba(245,245,244,.44)` | |
| `--err` | `#B00E12` | `#FF8A80` | |
| `--red`, `--red-deep` | | | `#E11414`, `#B00E12` |
| `--black`, `--on-black`, `--on-black-2`, `--rule-b` | | | `#0B0B0C`, `#F5F5F4`, `rgba(245,245,244,.72)`, `rgba(245,245,244,.20)` |
| Focus ring | `--ink` | `--ink` (so it inverts with the theme) | on black: `#F5F5F4` |
| Scrim | `rgba(11,11,12,.72)` | `rgba(0,0,0,.8)` | |

In dark the red usage rules are identical; the header, closing band and footer stay `#0B0B0C` so the logo keeps its ground (a 1px `--rule-b` hairline under the header separates it from the `#131315` page); photos are never dimmed or filtered; the selected segment is paper-on-ink inverted automatically (ink is light). The dark values appear twice, byte-identical, in `public-tokens.css` (under `[data-theme="dark"]` and under the `prefers-color-scheme` block for an explicit "Auto"), the same contract as `tokens.css`.

### 8.3 What happens to the funnel sheet, the quote page and the footer

- The funnel sheet opens over the light landing page and is itself light: paper body, black header with the logo (the existing `.bk-header--dark`), square, no shadow. It takes everything in section 10.
- The quote page (`quote.html`) loads `public-tokens.css`, is light by default, has the black header with the logo (`.q2-logo`) and the same black footer ground.
- The footer on the landing page is the bottom half of the closing composition (5.12). The quote page's footer (`.q2-footer`) takes the same black ground, the same lockup crop and the same keyed rows, without the stripes (the stripes are the landing page's finale only).
- The dashboard is untouched.

---

## 9. Engineering notes

### 9.1 File split and ownership

Two builders. B1 lands the foundations first (tokens, global CSS, shared primitives, boot); B2 can start the same hour because the token and class names are fixed by this spec and by the mock.

B1 owns:
- `css/public-tokens.css` (new; copy the mock's file), `css/fonts.css` (Archivo faces), `css/landing.css` (rewrite; start from the mock's `css/landing.css`), `index.html` and `quote.html` heads (3.3, 8.1), `js/ui/theme.js` (8.1), `fonts/` (the three files in 3.1), `tests/unit/modulepreload.test.mjs` (the `imagesizes` string) and `scripts/modulepreload.mjs` run.
- `js/landing/app.js` (boot; keep the lazy `below.js` split and `useBelowTheFold`; delete `initReveal` calls), `header.js`, `hero.js` (Hero and the spec strip), `footer.js`, `final.js` (new: `FinalCta`, moved out of `sections.js` because its CSS and stripes are coupled to the footer), `sticky-bar.js`, `media.js`, `idea.js`, `content.js` (CTA, HERO incl. `ticks`, IMAGES incl. captions and the reordered `work`, DEFAULT_*, `startEnquiry`, `bookClick`, `bookLinkProps`, `fillOwner`), `fx.js` (trim: keep `reducedMotion`, `useScrollSpy`; add `useHeroCtaGone`, `useInPageCtaVisible` moved here from `sticky-bar.js`, and `useMedia`), `ui.js` (new: `LpButton`, `TextLink`), `glyphs.js` (new).
- The booking sheet's lazy host (`booking-host.js`) and `ready.js` are unchanged.
- Moves `.lp-breaker*` rules (BreakerArt) from `landing.css` into `css/booking.css` unchanged; `art.js` is unchanged.

B2 owns:
- `css/landing-sections.css` (new; start from the mock's file), `js/landing/sections.js` (split into `why.js`, `about.js`, `steps.js`, `pricing.js`, `area.js`, `faq.js`, each exporting its section; `SectionHead` and `AccentText` are deleted), `gallery.js` (plate, film strip, pager ticks, lightbox re-skin), `calculator.js`, `visit.js` (new), `copy.js` (new: `WHY`, `ABOUT`, `STEPS`, `PRICING`, `AREA`, `FAQ`, `FINAL`, `CALC`, moved out of `content.js` so the two builders do not both edit one file), `below.js` (imports the sections; see 9.7 for the CSS load).
- `Final CTA` is B1's (`final.js`); B2 does not touch it.

Handoff contract B1 to B2 (first hour): `public-tokens.css`, `landing.css` primitives (`.lp-wrap`, `.lp-lbl`, `.lp-display`, `.lp-logovoice`, `.lp-btn*`, `.lp-link*`, `.lp-cut-*`, `.lp-photo*`, `.ui-idea-tag*`, `.lp-glyph`), `ui.js` (`LpButton`, `TextLink`), `glyphs.js`, the `Photo` `ratio="fill"` prop, `ProtoTag`. Until they land, B2 can work against the mock's CSS.

How to use the mock's CSS: it is written with the production class names; copy and adapt. Differences you must handle: (1) `.lp-btn` etc. are rendered by `LpButton` instead of raw elements; (2) the prototype strip classes (`ui-notice*`, `ui-tools*`, `ui-ideas*`, `ui-seg*`) re-skin the existing shared components, so keep their DOM; (3) the mock loads all CSS eagerly, production loads `landing-sections.css` with the sections (9.7); (4) the mock's lightbox and popover are always in the DOM and toggled with `hidden`, production renders them only when open; (5) `mock-reset.css` and `mock-only.css` are mock-only; (6) the glyph `<symbol>` sprite becomes `Glyph`; (7) the funnel is a stub.

### 9.2 Edits outside the landing files (all small, all listed)

| File | Edit | Owner |
|---|---|---|
| `index.html`, `quote.html` | `data-scope`, `data-theme`, `color-scheme`, font preload, `public-tokens.css`, theme script, `imagesizes` (3.3, 8.1) | B1 |
| `css/fonts.css` | Archivo faces and fallbacks | B1 |
| `js/ui/theme.js` | public scope key and default (8.1) | B1 |
| `css/base.css` | the `.lp-hero :focus-visible, .lp-final ..., .lp-footer ...` focus-on-panel rule keeps working (same class names); no change needed | |
| `css/components.css` | none. The shared components re-skin through the token remap and the scoped overrides in `landing.css` | |
| `css/booking.css` | receive `.lp-breaker*`; section 10 | B1 (10) |
| `css/quote.css`, `js/quote/*` | section 10 | later pass |
| `tests/e2e/landing.mjs`, `tests/qa/audit.mjs`, `tests/unit/modulepreload.test.mjs` | the edits in 9.8 | B1 and B2 for their own sections |
| `scripts/modulepreload.mjs` | run it after the import graph changes; it rewrites the block in `index.html` | B1 |
| `img/hero-wiring.svg`, `img/landing-bolt.svg`, `img/landing-portrait.svg` | stop being referenced by the landing page (the quote page still references `hero-wiring.svg` until section 10 is done); delete them in the commit that removes their last reference. `img/landing-placeholder.svg` stays (the quote page's charger thumbnail). `tests/e2e/landing.mjs` line 454 (the bolt-mask check) then asserts the new rule: no `::after` mask-image anywhere in `.lp-main` | B1 |

### 9.3 Every `data-testid` in `js/landing/*` (grepped from the working tree on 2026-10-24)

Dynamic ones are written with `{i}` or `{key}`. "Keep" means the same role on the same kind of element.

Header (`header.js`):
| testid | Disposition |
|---|---|
| `lp-header` | keep (the `<header>`) |
| `lp-lockup` | keep (the logo wrapper) |
| `lp-header-phone` | keep (the phone link; under 1180 and over 1024 it is icon-only with an `aria-label`) |
| `lp-header-book` | keep (appears from 720 while `.is-cta-on`) |
| `lp-call-button` | RETIRED: there is no separate "Call" button; the phone number link is the call control on every size. Update the e2e assertion "the header Call is the ONE call control" to "the header phone link and the sticky Call are the two call controls" |

Hero (`hero.js`):
| testid | Disposition |
|---|---|
| `hero-cta` | keep (also the observer target for the sticky bar and the header button) |
| `hero-photo` | keep (on the `Photo` box) |
| `l3-hero-visual` | keep (the `<figure>`) |
| `hero-proof-free` | keep (now the line "Free, no-obligation quote.") |
| `hero-proof` | keep, re-homed: the spec strip wrapper (ticks and credentials), no longer the list under the button |
| `hero-creds`, `hero-cred-{i}` | keep (the trust group and each credential) |
| `hero-visit`, `live-availability`, `next-free-slot` | keep, re-homed to step 02 (6.1). Update the assertions that look for them in the hero |
| `hero-ticks` | NEW on the ticks list (the current e2e asserts there is no tick list in the hero; that assertion is reversed) |

Sections (`sections.js`):
| testid | Disposition |
|---|---|
| `why-cards` | keep (`section#why`) |
| `why-cta` | NEW (the text link) |
| `about`, `about-photo`, `about-body`, `brands` | keep |
| `about-pull` | keep, re-homed to P2 ("Every visit is planned around...") |
| `about-ticks` | RETIRED: his ticks are in the hero (`hero-ticks`) and are not repeated |
| `about-caption` | RETIRED: the "Daniel, 180 Electrical" caption was inferred from his email address and is gone |
| `about-call`, `about-whatsapp` | RETIRED: not on his site; red and outlined buttons here broke the one-red-button rule. If Daniel wants WhatsApp on the public page, add it as a fourth keyed row in the footer list (a text link), nothing else |
| `how-it-works`, `l3-steps` | keep |
| `pricing` | keep |
| `pricing-cta` | RETIRED: his pricing block has no call to action; the red button is in Area and the closing band |
| `pricing-promise` | RETIRED: it was a rewrite of his FAQ answer; verbatim only |
| `quote-preview`, `pricing-sample-link` | keep |
| `quote-preview-tag` | keep, re-homed to the "Example only" caption |
| `area`, `area-form`, `coverage-input`, `coverage-result`, `coverage-book` | keep (the button now acts in one press; its label is "Get my installation quote" always, never "Check my postcode" or "Continue with ...") |
| `faq`, `faq-item-{i}`, `faq-q-{i}` | keep (`faq-q-{i}` is now the `<summary>`; assert `details[open]`, not `aria-expanded`) |
| `final-cta`, `final-book` | keep (in `final.js`) |
| `final-call`, `l3-final-whatsapp` | RETIRED: the footer's 48px phone is directly below; no WhatsApp on the public page |

Gallery (`gallery.js`):
| testid | Disposition |
|---|---|
| `gallery`, `l3-gallery-row` | keep (`l3-gallery-row` is the `ul`) |
| `l3-gallery-open-{i}`, `gallery-photo-{i}` | keep (index = display order; `gallery-photo-1` still carries `--zoom`) |
| `gallery-chip-{i}` | keep, re-homed: the numbered caption under each photo (the "chip over the photo" is gone) |
| `gallery-dots`, `gallery-dot-{i}` | keep (the pager ticks, below 1024) |
| `l3-lightbox`, `-count`, `-close`, `-prev`, `-next`, `-img`, `-caption` | keep (all seven) |

Calculator (`calculator.js`): keep all of `l3-calc`, `l3-calc-assumptions`, `l3-calc-badge`, `l3-calc-compare`, `l3-calc-footnote`, `l3-calc-headline`, `l3-calc-home-big`, `l3-calc-miles`, `l3-calc-reset`, `l3-calc-result`, `l3-calc-saving-big`, `l3-calc-slider`, `l3-calc-workings`, `l3-calc-workings-text`, `l3-calc-home`, `l3-calc-petrol`, `l3-calc-public`, `l3-calc-field-{homePence|petrolPence|mpg|milesPerKwh|publicPence}`. Note `l3-calc-assumptions` is now the `<details>`; `l3-calc-workings` is the bars table; `l3-calc-workings-text` is inside the details.

Footer (`footer.js`): keep `footer`, `footer-copyright`, `footer-email`, `footer-lockup`, `footer-phone`, `l3-footer-address` (conditional). `l3-footer-credentials` RETIRED (credentials appear once, in the spec strip).

Sticky bar (`sticky-bar.js`): keep `sticky-bar`, `sticky-book`; NEW `sticky-call`.

Other: `idea-tag` keep (`ProtoTag`); `booking-loading` keep (`booking-host.js`); `breaker-art` keep (`art.js`, untouched).

Shared UI on the page (not in `js/landing`, must keep working): `prototype-strip`, `prototype-tools`, `prototype-tools-panel`, `prototype-tools-close`, `prototype-tools-links`, `ideas-switch`, `ideas-with`, `ideas-only`, `footer-disclosure`, `footer-owner-link`, `footer-about-link`, `theme-light`, `theme-dark`, `theme-auto`.

Not to be reintroduced (the e2e asserts their absence): `trust-bar`, `quote-preview-total`.

### 9.4 Helpers to reuse (do not rewrite)

`media.js` `Photo` (changes in 4.13) and `LogoImg`, `photoSrc`, `selectImages`; `idea.js` `ProtoTag`, `protoProps`, `IDEA_LABEL` and the `ideas.js` re-exports; the ideas switch (`js/ui/ideas.js`: `initIdeasMode` in `app.js` before `bootApp`, `useIdeasMode`, `html[data-clean]`); `imageUrl` in `js/core/config.js` (the only place an image URL is built); `content.js` `startEnquiry`, `bookClick`, `bookLinkProps`, `CTA_LABEL` (every call to action calls `bookClick({})`, which opens the funnel through `openBooking`); `credentialList` from `js/booking/bk-shared.js`; `postcodeZone`, `isValidPostcode`, `normalisePostcode` from `js/core/format.js`; `calc.js` (unchanged); `nextFreeSlots`; `useBrand`, `useStore`, `useNow` from `js/ui/hooks.js`; `pageHref` and `pageTarget` from `js/ui/util.js`; `waLink` is no longer used on the landing page.
Import from the specific `js/ui/*.js` modules (`button.js`, `display.js`, `hooks.js`, `util.js`, `notice.js`), never from `js/ui/index.js`: the existing `modulepreload` test requires that barrel to stay out of the landing graph.

### 9.5 Accessibility

- Landmarks: the strip is an `aside` (labelled "Prototype notice", prototype only), then `header`, `nav` ("Page sections"), `main#main` (tabindex -1, the skip link targets it), `nav` ("Quick actions"), `footer`. One `h1`; each section one `h2` (the About H2 and the gallery H2 are real `h2`s even though they are visually compact); `h3` for rows, steps and ideas. `aria-labelledby` on every section points at its `h2`.
- Focus: 2px solid ring at 3px offset on every interactive element, ink on paper and `#F5F5F4` on black, never removed; the postcode field uses a 2px outline flush on its border. Focus never lands under the sticky header (`scroll-padding`/`scroll-margin`) or the sticky bar. Lightbox: focus moves to Close, is trapped, Esc closes, focus returns to the opening tile.
- Targets: 44px minimum for every link, button, input, summary and slider (measured: none under 44 in the mock, light, at 390 and 1280). The visible element may be smaller (the pager ticks are 24 x 2 inside a 44 x 44 button).
- Contrast: all text 4.5:1 or better in both themes (2.1). White on red is 4.87:1, so primary button labels are 16px/600 or larger on every instance (the sticky bar's 15px label is 600 too; under 360px it is 14px/600, which is the one exception and only on that bar).
- Names: the icon-only header phone link has `aria-label="Call 07885 496800"`; the decorative step numerals are `aria-hidden` (the `ol` numbers them); the idea table is `aria-hidden`; decorative glyphs are `aria-hidden`; every photo has an alt; a failed photo keeps its alt plus "(photo not available right now)".
- Forms: real `<label for>`, `autocomplete="postal-code"`, `autocapitalize="characters"`, `enterkeyhint="go"`, 16px or larger type, errors in text with `aria-invalid`, the result line is `aria-live="polite"`.
- Motion and colour: `prefers-reduced-motion` honoured (7); forced-colors keeps buttons bordered; colour is never the only signal (the open FAQ item also changes its glyph from plus to minus; errors have words).
- `lang="en-GB"`. No auto-playing anything.

### 9.6 Responsive checks that passed on the mock

No horizontal overflow at 320, 360, 390, 414, 600, 768, 900, 1024, 1180, 1280, 1366, 1440, 1920. Hero button above the fold at 390 x 844 (with the 45px prototype strip it sits at y 454 to 510; without it 409 to 465). Sticky bar steps aside on the postcode section and the closing band (checked). The H1's first sentence stays on one line from 320 up.

### 9.7 Performance

- First view requests: the HTML, the six CSS files, the module graph (already preloaded), the logo, the hero photo and the two Archivo files (3.3). No Inter or Manrope on the public pages. Nothing else.
- CSS budget (measured on the mock, gzip -9): `public-tokens.css` 3.2 KB, `landing.css` 6.3 KB (first paint), `landing-sections.css` 4.8 KB (below the fold). Together 14.3 KB against about 15.5 KB for the current `landing.css` alone. Targets: `landing.css` under 8 KB gzip, `landing-sections.css` under 6 KB.
- Keep the PERF round's architecture: the header and the hero paint first; `below.js` (sections, footer, sticky bar) loads after the first paint with a dynamic import; `booking-host.js` fetches the booking sheet and `css/booking.css` on first touch or hover of a `.lp-cta`; `ready.js` tells the scroll spy when the sections exist. `below.js` must also load `css/landing-sections.css` before the sections mount: `Promise.all([import('./sections...'), loadCss('css/landing-sections.css')])` using `js/ui/load-css.js`, so the sections never mount unstyled. The sticky bar, the closing band and the footer styles are in `landing.css` (B1) because they mount in the same chunk and are small.
- Images: only the logo and the hero in the first screen; the About, gallery and lightbox images lazy-load; every box reserves its space (no layout shift); `decoding="async"` everywhere; the lightbox prefetches only its two neighbours.
- No JS animation loops, no scroll listeners other than the existing rAF-throttled gallery listener, one `IntersectionObserver` each for the hero button, the in-page buttons and the scroll spy.
- The mock's fonts: 192 KB for both files (3.1).

### 9.8 Test edits that this rebuild requires

The tests assert the old look; update them in the same change (B1 the header, hero, footer, sticky bar and boot assertions, B2 the sections).
- `tests/e2e/landing.mjs`: hero (the ticks now exist in the hero, the credentials are figures, the H1 has no red span, no `.lp-hl`, no `.lp-hero__slashes`, the photo is a 3:2 true ratio with no frame or shade, the header Call button is gone, the photo is not a rounded card); the header (not sticky below 720, the red button only after the hero button and not while an in-page red button is on screen); sections (no eyebrows except the four, no `.lp-section--band`, no `.lp-qcard`, no radius anywhere, `.lp-gallery*` becomes `.lp-gal*`, the FAQ uses `details[open]`, the postcode check opens the funnel on one press with the postcode prefilled, "Meet your local EV charger installers." is his verbatim H2 with both paragraphs, the earliest visit lives in step 02); the sticky bar now has Call (`sticky-call`) and the quote button; `about-call`, `about-whatsapp`, `pricing-cta`, `final-call`, `l3-final-whatsapp`, `l3-footer-credentials` assertions are removed.
- `tests/qa/robust.mjs` fills `l3-calc-field-*` (the rates are in a closed disclosure below 1200: open `l3-calc-assumptions` first) and presses `coverage-book` once with hostile input (now one press, no "Continue" step); `tests/qa/matrix.mjs` measures contrast and fixed or sticky elements pixel by pixel (the header is no longer sticky below 720; the sticky bar is outlined plus red). Both open the landing page by `hero-cta`, which stays.
- `tests/qa/audit.mjs` (verbatim diff against the report): the "Meet {owner}" deviation allowance for About is removed (About is now verbatim), the retired "pricing promise" line is gone, and the ticks are searched in the hero.
- `tests/unit/modulepreload.test.mjs`: `imagesizes` is `(min-width: 1024px) 65vw, 100vw` (and `hero.js` uses the same string); run `node scripts/modulepreload.mjs` after any import change.
- Add: a test that no element in `.lp-main` has a non-zero computed `border-radius` or any `box-shadow` other than `none`; a test that at most one `.lp-cta` red button is visible at each scroll stop; a test that `html[data-scope="public"]` defaults to `data-theme="light"` with empty storage and that the dashboard still defaults to dark.

### 9.9 Acceptance checklist

Visual (compare with `docs/landing-v5-mock/shots/` at 390 x 844 and 1280 x 900):
- [ ] Light paper page; black only in the header, the closing band and the footer.
- [ ] H1 is Archivo width 108 / weight 650 / -0.03em, three lines, solid ink; 92px at 1280, 32.9px at 390 with the first sentence on one line.
- [ ] No card, icon tile, chip, pill, radius, shadow, gradient (except the closing stripes), overlay on a photo.
- [ ] Exactly two photos carry the cut (hero top-left, About bottom-right), the same `--cut` token, visible at both sizes (40px and 88px).
- [ ] Red appears only as 1.3 lists. At most one red button on screen at any time at 390 and at 1280.
- [ ] The logo voice is used only for the credential figures, the step numerals, the brand names.
- [ ] Credentials read "Level 3 Electrical Installation" and "2391 Inspection and Testing" in the DOM.
- [ ] No section numbers; labels only where 1.2 allows; the seven sections are visibly different compositions.
- [ ] Gallery: plate with the heading in a cell at 1024+, film strip with four pager ticks below; no empty cell, no hint line; screenshot photo's black bars are not visible.
- [ ] Closing composition: stripes top-left of the band and bottom-right of the footer, un-striped lockup, 48px phone, text clears the stripes at every width.
- [ ] "Only my content" leaves no gap and no tag; "With ideas" shows three tagged blocks, all with the dashed rule.
- [ ] Dark theme (opt-in) holds together; default is light with empty storage.
Functional:
- [ ] Every call to action opens the funnel (`hero-cta`, `lp-header-book`, `why-cta`, `coverage-book`, `final-book`, `sticky-book`); the postcode check opens it prefilled and shows the verdict and the error states.
- [ ] Sticky bar: slides up after the hero button leaves, steps aside on the postcode section and the closing band, hidden when a sheet or the keyboard is open, absent from 720.
- [ ] Lightbox: open, previous, next, Esc, arrows, swipe, focus trap and return, scroll lock, caption, "Photo N of 4".
- [ ] FAQ: exclusive, the cost question open on load, all six answers verbatim.
- [ ] Calculator: 8,000 miles gives £617 / £1,212 / £1,714; 12,000 gives £926 home; Reset restores; invalid input falls back to the example figure; rates collapse below 1200.
- [ ] Prototype tools popover: owner login, what's real, appearance, page links; the switch persists.
Quality:
- [ ] axe-core (wcag2a, wcag2aa, wcag21aa, best-practice): 0 violations in light and dark, 390 and 1280, with and without ideas.
- [ ] No horizontal overflow from 320 to 1920; no target under 44px; all text 4.5:1.
- [ ] First view requests are exactly the list in 9.7; `landing.css` under 8 KB gzip.
- [ ] Verbatim script (`tests/qa/audit.mjs`) reports zero missing strings.
- [ ] `npm test` and the e2e suites pass after the edits in 9.8.

---

## 10. What the funnel sheet and the quote page must adopt

Because `public-tokens.css` remaps the legacy tokens (`--bg`, `--surface`, `--text`, `--line`, `--cta`, `--panel`, `--r-*`, `--shadow-*`, `--font-*`, `--h-btn`), the funnel (`css/booking.css`) and the quote page (`css/quote.css`) turn light, square, shadowless and Archivo the moment `public-tokens.css` is loaded. That is phase 1 and is part of B1's work. Phase 2 is a short pass over the two stylesheets; list for whoever does it (nothing here changes behaviour):

Both:
1. Load `public-tokens.css` on `quote.html` (done in 3.3) and make sure `css/booking.css` (lazy) is loaded after it.
2. Headers stay black (`.bk-header--dark`, `.q2-logo--header`) with the same logo window (`--cx .2273`, `--cy .3039`, `--cw .5368`, `--ch .3922`), 1px `--rule-b` under them. `.bk-header--dark`'s `border-radius` on tablet goes to 0 (the token does it).
3. Display headings (`.bk-title`, `.q2-h2`, any `font-family: var(--font-display)` heading 26px and up) take the display voice: width 108, weight 650, tracking -0.03em. Smaller headings (17 to 20px) take the title voice (weight 600, width 104). Replace `--fw-heavy` (800) on headings with 650 or 600; 800 italic extended is only the logo voice.
4. Buttons: the red primary is the 56px square `.lp-btn` look (label left, arrow right where there is one). Secondary actions are the outline button or a text link. "Back" is a text link. No pill, no lift.
5. Inputs: white (`--field`) fill, 1px ink border, square, 56 to 64px, 16px or larger type, label above in the label voice, focus a 2px flush ink outline, error `--err` text and border with words.
6. No card gradient (`--card-bg` is flat), no `box-shadow`, no icon tiles. Hairline rows instead of boxes.
7. The idea tag and the dashed rule are the same everywhere (`ProtoTag` is shared). `BreakerArt` stays in the sheet's confirmation for now; replace it in a later pass with a quiet typographic confirmation using the logo-voice numerals.

Funnel only (`bk-fn-*`):
- Progress (`bk-fn-progress__seg`): six 2px segments, ink for done and current, `--rule` for to come, no rounded ends, no colour fill. "Step N of 6" in the label voice.
- Options (`bk-fn-opt`): full-width ruled rows 64px high (hairline above and below, no box), the A to E key in the label voice on the left, the label 19px/600, a square outline tick on the right; selected = 2px ink border and ink tick, not a red tint and not a red border (red is for the next action). Auto-advance on click is unchanged.
- The postcode step (`bk-fn-postcode`, `bk-fn-input`) is the landing postcode field exactly (4.4); the zone lines (`bk-fn__zone--ok`, `--warn`) use ink with the tick glyph and `--err` respectively.
- The sheet: edge to edge on phones; on tablets and desktops a square panel with the 1px ink edge (`--shadow-2`) over the `--scrim`.
- The confirmation: "Thanks, your enquiry has been received." in the display voice; the visit card is a ruled block with the dashed idea rule and tag while it is a suggestion.

Quote page only (`q2-*`):
- Line items (`q2-lines`, `q2-line`) become a ruled table with tabular right-aligned figures (as the landing page's example quote); the sum (`q2-lines__sumvalue`) in the display voice.
- Accept (`q2-accept`) is the one red button; decline is a text link; status badges (`q2-badge*`) become label-voice text with a hairline, not a coloured pill; the footer takes the black ground and the keyed rows of 5.12 (no stripes).
- The hero's `hero-wiring.svg` background (a dotted grid with a pale bolt: a bolt watermark) goes: remove it from `css/quote.css` (two rules) and its `<link rel="preload">` from `quote.html`; the quote hero is flat paper with the display-voice headline.
- `q2-chip` day chips become ruled rows or a square segmented control; dates use the logo-voice numerals only at 1.5rem and above where a date is the hero of the row.

---

## Appendix A: where the three judges disagreed, and what was decided

All three judges picked A. Their must-fix lists were all applied. Where they pulled in different directions:

1. Stripes on the photo corners (judge 3 wanted B's red band and hairline on the hero and About photos; judges 1 and 2 killed it as decoration on photography, which the brief forbids). Decided: the cut stays bare (the paper shows through) but is now committed (40 / 56 / 88px instead of 24 / 40 / 56, so it reads as a device and not a rendering nick), and the logo's real stripes appear once, at scale, in the closing composition (the graft all three judges liked). Photography stays undecorated.
2. Gallery (judge 1 and 2: fill the empty cell and drop the hint; judge 3: B's bento). Decided: the heading goes in a cell of the plate (it also breaks the repeated section opener for one section), the layout is 12 x 2 with no empty cell. Native ratios are kept except the landscape, which fills its row (cropped from 1.34:1 to about 1.55:1 around the charger).
3. Section numbers and labels (judge 3: remove both; judge 1: remove numbers, keep labels; judge 2: remove numbers on phones, drop labels on two sections). Decided: numbers are gone everywhere; labels survive only where they are his own words and carry information.
4. The mobile header (judge 2: do not keep it sticky). Decided: static below 720, sticky from 720.
5. Credential figures (judges 1, 2, 3 all asked for B's). Decided: logo voice, 26 / 34 / 40px, descriptor in body type beside or beneath.
6. Earliest visit (judges 2 and 3: move it into step 02). Decided: step 02, as a margin annotation.
7. The header button (all three): appears only after the hero button, and steps aside while an in-page red button is on screen. The Why call to action is a text link.
8. Ink versus grey body copy (all three): body is ink everywhere; grey is for captions, notes, units, tag text and the legal line.
9. Display type. Five variants were rendered at 92px and 32px (`docs/landing-v5-mock/shots/type-test-1280.png` and `type-test-390.png`, labelled A to E top to bottom, E being the version as judged): A width 108 / 650 / -0.03em, B 110 / 700 / -0.03, C 112 / 700 / -0.028, D 104 / 700 / -0.03, E 100 / 600 / -0.045 (letters collide). Decided: 108 / 650 / -0.03em. 112 / 700 wraps the first sentence at 390; 104 / 700 and 110 / 700 are heavier and set tighter; 108 / 650 is the most open and calm while still carrying the extended character of the wordmark.
10. Hero scale (judge 3: 88 to 92px). Decided: 92px at 1280 (the wider width makes it read larger than A's 104px did), which shows about 74% of the photo on a 1280 x 900 screen without the strip.
11. Default theme (judge 3: never dark by default, never Auto as a fallback). Decided: light; separate storage key so the dashboard and the public pages cannot affect each other.
12. Ideas default (judge 3: off in production). The prototype keeps "With ideas" as the default because the prototype's job is to show them; for production, add one constant in `js/ui/ideas.js` that `readStored()` uses when nothing is saved, set to "Only my content" (Appendix B).
13. The lightbox (the mock used a native `<dialog>`). Decided: keep the existing custom lightbox (it has the focus trap, swipe, prefetch and the tests); re-skin only.
14. Rates on phones (judge 2). Decided: a "Change the rates" disclosure below 1200, always open from 1200.

## Appendix B: launch gates that need Daniel

These are not build tasks; they are things the page cannot ship without.
1. Voice. His copy says "we", "the team", "our"; he is one person. This spec uses his words as written. Ask him whether to keep them; nothing is invented.
2. Trade body, insurance and anything else he holds: nothing is shown; ask what he actually has and add it as plain typography next to the credentials, never as a badge.
3. The three ideas are claims or promises Daniel would have to honour: the earliest visit (make it a live diary field or leave it out), the running-costs result and its petrol and public-charging comparison (keep behind his sign-off; the rates are examples, not his prices), the example quote (shows no prices). In production remove the Prototype strip and make "Only my content" the default when nothing is saved (add a new `IDEAS_DEFAULT_CLEAN = true` constant to `js/ui/ideas.js`, read by `readStored()`; it does not exist today).
4. Real photos: swap the seven hot-linked URLs, confirm the man and the charger are clear of the hero's top-left cut and the face and van are clear of the About photo's bottom-right cut; confirm the gallery screenshot's bars are out of the tile.
5. Names on the page: the About band no longer names Daniel. Only our own additions say "Daniel" (the earliest-visit idea and the area verdict lines, which are our wording); confirm he is comfortable with his first name there.
6. WhatsApp: his site has none; removed from About and the final band. Add as a footer row if he wants it.
7. Footer address: none (his site has none). Renders only if he types one in Settings.

## Appendix C: copy that is ours, not his

Everything else on the page is verbatim from `docs/reference/180-site-report.md`.
- Navigation labels: "About", "Our work", "How it works", "Pricing", "Questions".
- Gallery captions: "Red brick wall", "Pebbledash wall", "Orange brick wall", "Brick pillar"; the pager and button labels ("View photo N of 4 larger", "Show photo N of 4", "Choose a photo", "Photo N of 4", "Close", "Previous photo", "Next photo").
- Area: the field label "Your postcode", the placeholder "e.g. BT7 3AB", the verdict strings `AREA.covered`, `AREA.edge`, `AREA.outside` (the first is his funnel's wording).
- Idea blocks (all tagged): "Earliest visit Daniel could offer", "Daniel will confirm.", "Diary full for the next {n} days.", "Call Daniel", "See how a quote looks" and its sentence and "Example only", the example line names (taken from the quote model), "What would home charging cost you?" and its lead, "Change the rates", "Rates we have assumed", "How we worked this out", "Illustrative estimate", the calculator notes, the comparison sentence, the workings sentence.
- The tag: "Idea from us, not on your site today".
- Accessibility strings: "Skip to main content", "Quick actions", "Page sections", the `aria-label`s in 9.5.
- The footer keys "Phone", "Email", "Area" and the copyright line.
