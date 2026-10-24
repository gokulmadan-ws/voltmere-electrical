# His public images (hot-linked, not copied)

Decision: the prototype links to the images his own public funnel already serves. They were checked from outside this sandbox: all 7 return HTTP 200 with and without a github.io Referer (no hot-link block). Agents in this sandbox CANNOT load them (network policy), so you will see broken images or your fallbacks in local screenshots: build robust fallbacks and fixed-aspect boxes, and never judge the photos by local screenshots.

Rules for using them
- One place only: `business.images` in js/core/config.js (keys below) and a helper `imageUrl(key, { width })` there that returns the URL (for perspective.imgix.net URLs, replace the query string with `?w=<width>&q=70`; do NOT add `auto=compress,format`: measured on the live host it returned BIGGER files, w=800 was 185 KB plain versus 265 KB with it; for Unsplash append/replace `w=<width>`). The landing page and quote page use the helper; nothing else hard-codes an image URL. They are editable in dashboard Settings (a simple URL field per image is enough) so a real build can swap them for local files.
- Every `<img>` has width/height (or an aspect-ratio box), `loading="lazy"` (except the logo in the first screen), `decoding="async"`, a descriptive alt, `referrerpolicy="no-referrer"`, and an `onerror` fallback to a neutral dark on-brand SVG placeholder (charger line art) so a blocked or slow image never breaks layout.
- The logo has a near-black background: use `mix-blend-mode: lighten` on the dark theme; local fallback is img/logo-180.png (a crop from a screenshot).
- The logo is shown through a CROP WINDOW (`.lp-logo` in css/landing.css, fractions `--crop-x/y/w/h` of the 1119x743 picture) so only the "180 ELECTRICAL" lockup shows at 44 to 56 px tall (whole, the red wordmark was unreadable at header size and the corner stripes made a dark box); the header bar is solid near-black so the `lighten` blend leaves no box. img/logo-180.png has the same layout, so the same window fits it. The hero photo is 3:2 and is shown as a true 3:2 band on phones (nothing cropped); work2 is a phone screenshot and is zoomed 1.45 in its tile so its black bars fall outside it.
- QA network gates must ALLOW exactly these two hosts for images: perspective.imgix.net and images.unsplash.com. Everything else off-site stays forbidden.
- Page weight: only the logo and hero load in the first screen; gallery and about images lazy-load.

| key | URL | shows |
|---|---|---|
| logo | https://perspective.imgix.net/6ac64662b8d25e3fced4de9e.jpeg?w=2000&h=2000&fit=max&fm=jpg | white "180" with a red bolt as the 0, red ELECTRICAL wordmark, red/white corner stripes, near-black background (1119x743) |
| hero | https://images.unsplash.com/photo-1704475386627-dcfcd97ed51a?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3wyMjcwN3wwfDF8YWxsfHx8fHx8fHx8MTc4OTI5NjM4Nnw&ixlib=rb-4.1.0&q=80&w=1080 | man in an olive jacket plugging a charger cable into a black wall unit on a timber-clad wall, white Audi SUV on block paving (1080x720, landscape) |
| about | https://perspective.imgix.net/6ac64bf1b8d25e3fced53c3e.jpeg?auto=compress&crop=focalpoint&cropHeight=480&cropWidth=640&dpr=2&fit=crop&fp-x=0.50&fp-y=0.59&fp-z=1&h=1348.6880466472303&w=1800 | smiling man, arms crossed, black "180" hoodie, beside a white Nissan van on a residential street (3600x2697 original, landscape) |
| work1 | https://perspective.imgix.net/6ac64c7dfd2652fd454c9753.jpeg | black/grey Zappi charger on a red brick wall with tethered cable (1170x1532, portrait) |
| work2 | https://perspective.imgix.net/6ac64c898c0de982eaa037ce.jpeg | Zappi charger on grey pebbledash, cable clipped along the wall, yellow ladder at right, black bars top and bottom like a phone screenshot (739x1600, tall portrait: crop with object-fit cover and zoom to hide the bars) |
| work3 | https://perspective.imgix.net/6abce0349736daf21b921061.jpeg | black Fox ESS charger on a red brick pillar, grey cable on a holster, wooden fence (1200x1600, portrait) |
| work4 | https://perspective.imgix.net/6abb7d69173b2b4f1bfd30e9.jpeg?auto=compress&crop=focalpoint&cropHeight=477&cropWidth=640&dpr=2&fit=crop&fp-x=0.50&fp-y=0.39&fp-z=1&h=1341.8181818181818&w=1800 | Ohme charger (black, blue buttons) and holster on an orange brick wall by a black downpipe (3600x2684 original, landscape) |

Note: the photos show real chargers by Zappi, Ohme and Fox ESS: his own work. Do not write product claims about them.
