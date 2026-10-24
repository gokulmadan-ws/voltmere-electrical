# Production plan: from the 180 Electrical prototype to a live platform

For the commercial team and for Daniel. The prototype (`README.md`) proves the screens, the logic and the two-phone WhatsApp loop in a browser with sample data. This plan is what it takes to make it a system Daniel runs his business on. Effort figures are rough estimates in weeks, not a quote; confirm them after Phase 0.

## 1. Scope

**The job to be done.** Daniel pays an agency for a Perspective funnel that sends him a WhatsApp ping. He needs every enquiry answered inside the 24 hours his own site promises, turned into a survey and a written quote, accepted, installed and paid, and he needs to see which ads bring the work. He lives in WhatsApp and works from a van.

**In scope for the first live release (MVP)**

| Area | What it does |
|---|---|
| Intake | His funnel (Perspective, or our own page with the same six steps and wording) posts every enquiry to our backend; nothing is lost, duplicates are ignored |
| Alerts | Daniel is told on WhatsApp within a minute, with the answers and a button to open the job; email as a fallback |
| Reply clock | A 24 hour promise per enquiry, due-soon and overdue flags, average reply time |
| Customer replies | WhatsApp or email acknowledgement to the customer, in his words, from templates he approves |
| Quotes | Quote builder on a price list he owns, a private link per quote, a customer page that records accept or decline with a time, expiry, a PDF copy |
| Diary | Survey and install slots with server-side locking, working days, days off, Google Calendar sync |
| Pipeline and money | Enquiry, survey, quote, accepted, install, paid, with value and ageing; lead sources and cost per enquiry |
| Owner access | One owner login on his phone (a second user later), backups, an audit trail |
| Domain | His domain, certificate and redirects |

**Out of scope for the MVP (candidates for later)**

- Customer accounts and a customer portal beyond the private quote link.
- Card payments, deposits and invoicing (an optional phase below, only if he wants them).
- Generating installation certificates or other compliance paperwork (optional; his current process decides).
- More than one installer or van, stock, rota, subcontractor handling.
- A native app. The dashboard is a web app that works well on a phone; push notifications arrive through WhatsApp.
- Replacing his Perspective funnel, unless the webhook turns out not to be available on his plan.

**What carries over from the prototype.** The domain logic is pure and unit tested (availability, pipeline, quote totals, reply clock, message templates, the WhatsApp payload codec) and ports almost line for line. The dashboard and customer screens are reusable: the data layer (`js/core/store.js`) becomes an API client and the rest stays. The WhatsApp-link handoff stays useful as a fallback when his phone is offline.

## 2. Architecture (suggested)

Chosen to keep him on managed services with no servers to look after, and to keep the relational model the prototype already has (enquiries, quotes, bookings, messages).

```
Customer ─> his funnel (Perspective or our page) ──webhook──> /api/enquiry ──┐
                                                                              v
Daniel's phone ─> dashboard (static, Vercel) ─> Supabase (Postgres, Auth, Storage) <─ jobs (cron, queues)
                                                      │          │
            private quote link (token) <──────────────┘          ├─> WhatsApp Cloud API (alerts, quote links, templates)
                                                                 ├─> Email service on his domain (SPF, DKIM, DMARC)
                                                                 ├─> Google Calendar API (OAuth, two-way sync)
                                                                 └─> Meta Pixel / Conversions API, Google tag (behind consent)
```

| Concern | Suggestion | Why |
|---|---|---|
| Front end | Keep Preact and htm for the MVP, hosted on Vercel; move to Vite and TypeScript only if the team prefers (a decision for Phase 1) | It already works, is fast and has no build; a rewrite adds weeks and no user value |
| Database and auth | Supabase: Postgres, row-level security, email magic link or one-time code (passkeys when supported), file storage for photos | The model is relational; pipeline and insights become SQL views; backups and point-in-time recovery are included on paid tiers |
| API and webhooks | Vercel serverless functions in TypeScript for the Perspective, WhatsApp, Stripe and Google webhooks; Supabase scheduled jobs for reminders and expiry | Webhooks need raw-body signature checks, idempotency keys and retries; both platforms provide them |
| WhatsApp | WhatsApp Cloud API (Meta) with a dedicated number, pre-approved utility templates, and a webhook for replies and button taps | The only supported way to send automatically; template approval is the long lead item |
| Email | A transactional email service sending from his domain | Quotes and fallbacks reach inboxes only with SPF, DKIM and DMARC set up |
| Calendar | Google Calendar API through OAuth, two-way sync with push notifications | He already lives in Google Calendar; read-only `.ics` is the fallback |
| Payments (optional) | Stripe payment links or Checkout | Hosted pages keep card data away from us |
| Monitoring | Error tracking, uptime checks, a log of every webhook received and every message sent | Silent failure is the biggest risk for a business that depends on replies |

**Data model (first cut).** `customers`, `enquiries` (answers, notes, source, utm, reply due, status), `bookings` (survey and install, window, status), `quotes` and `quote_lines` (token, validity, status, accepted_at, accepted_via), `messages` (channel, template, status, provider id, timestamps), `photos`, `settings` and `connections` (per owner), `ad_spend`, `audit_log`, `webhook_events` (raw payload, signature check result, processed_at). Every customer-facing link uses an unguessable token; every table is behind row-level security keyed to the owner.

**Security and privacy.** UK GDPR and PECR apply: a privacy notice, a lawful basis for each use, consent records for the optional marketing tick, retention and deletion rules, a processor agreement with each supplier, and whether he must pay the ICO data protection fee. Photos of a consumer unit can show an address, so they are private by default. Webhooks are signed and idempotent; quote links carry no personal data in the URL.

## 3. Phases and effort

Assumes one full-stack engineer working with a part-time designer and project manager. A second engineer shortens the elapsed time because phases 2 to 4 can run in parallel after Phase 1.

| Phase | Deliverable | Exit test | Weeks |
|---|---|---|---|
| 0. Discovery and access | Answers to the open questions below; Perspective webhook proven on his plan; domain, Google and Meta access; **Meta business verification and the WhatsApp number requested** | A test enquiry reaches a stub endpoint; access list complete | 1 |
| 1. Foundations | Repo, CI, environments, database schema and migrations, owner login, a data adapter that replaces `localStorage`, deploy previews | Daniel signs in on his phone and sees seeded data from the database | 2 |
| 2. Intake and alerts | Webhook endpoint (signature, idempotency, retries, dead-letter), enquiry inbox, 24 hour clock, WhatsApp alert and email fallback, customer acknowledgement | A real funnel submission appears on his phone in under a minute, once, with the right answers | 2 |
| 3. Quotes | Persistent quote builder on his price list, private quote links, recorded accept and decline, expiry, PDF copy, quote reminders | A customer accepts on their own phone and Daniel sees it with a time, without tapping a link | 3 |
| 4. Diary and calendar | Server-side availability and slot locking, survey and install booking, Google Calendar two-way sync | Two customers cannot take the same slot; a calendar event appears and moves both ways | 3 |
| 5. Pipeline and ads | Pipeline, insights, lead sources, Meta and Google tags behind consent, cost per enquiry (ad spend typed in monthly at first) | Numbers match a hand count for a test month | 2 |
| 6. Launch | Hardening, backups tested, monitoring, privacy documents, training, parallel run beside the old ping, cut-over | A week of live enquiries with no lost enquiry and a measured reply time | 2 |
| Optional: payments and paperwork | Payment links, deposit on acceptance, receipts, invoices, certificates if he wants them | A paid job reconciles with Stripe | 3 to 5 |

**Total.** About 15 weeks elapsed for one engineer (phases 0 to 6), or 10 to 12 with a second engineer; add 3 to 5 weeks for payments and paperwork. Elapsed time depends more on Meta verification, WhatsApp template approval and Google OAuth verification (each can take days to weeks, and run in parallel with the build) than on code.

**Running costs.** Small for one owner: hosting and database on paid tiers (tens of pounds a month), an email service, Meta's per-message charges for WhatsApp templates (check Meta's current price list by category), and Stripe's fees if payments are added. Confirm current pricing before quoting any figure to Daniel.

**Why build rather than buy.** Job-management apps for trades (for example Jobber, ServiceM8 or Tradify) cover quotes and scheduling. What they do not give him is his own funnel, his own WhatsApp-first loop, and his own numbers on which ad produced which install. If he would rather buy, this prototype is still the specification of what he wants.

## 4. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| His Perspective plan does not allow webhooks or custom endpoints | Medium | High | Prove it in Phase 0. Fallback: move the six steps onto our own page (the prototype already is that page) and keep Perspective for ads |
| Meta business verification or template approval is slow or refused | Medium | High | Apply in week 1; use utility templates with plain, non-promotional wording; keep the email fallback and the WhatsApp link handoff |
| WhatsApp number choice: a new number, or moving 07885 496800 | Medium | Medium | Decide in Phase 0. Check whether Meta's current options let the number stay in the WhatsApp Business app alongside the API |
| Google OAuth verification takes weeks for Calendar scopes | Medium | Medium | Start in Phase 1; ship read-only `.ics` first; test mode has user and token-expiry limits that make it unsuitable for production |
| Lost or duplicate enquiries | Low | High | Idempotency keys, a raw webhook log, a daily reconciliation against the funnel's own submission list, alert if no enquiry arrives for an unusual period |
| Marketing messages without consent (PECR, WhatsApp opt-in) | Medium | High | Only utility messages in the MVP; the funnel's optional tick is stored with the enquiry and honoured; legal review before any marketing send |
| Customer photos hold personal data | Medium | Medium | Private storage, short signed links, retention rule, deletion on request |
| Scope creep (payments, certificates, multi-user) | High | Medium | Keep them as the optional phase; change control after Phase 0 |
| Single point of failure: Daniel's phone is the only alert channel | Medium | High | Email fallback, an "unacknowledged for X hours" escalation, and a status page |
| The prototype's `localStorage` store hides concurrency problems | Medium | Medium | Server-side slot locking and idempotent writes from Phase 1; the robust test suite becomes the regression suite |
| Quote links in a live system are guessable or leak | Low | High | Long random tokens, expiry, no personal data in the URL, rate limits |

## 5. Open questions for Daniel

**Funnel and website**
1. Does your Perspective plan support sending each submission to a web address (a webhook)? Who can switch it on?
2. Who owns 180electrical.co.uk and its DNS? Do you have a Google Workspace or only a free Google account?
3. Are you happy for the funnel to stay on Perspective, or should it move onto your own page? Are there any words on your current site you want changed before we rebuild it?

**WhatsApp and contact**
4. Should alerts go to a new business number or to 07885 496800? Is that number used for personal WhatsApp today?
5. Who else should get alerts (a partner, an office person)?
6. What do you say to a customer today after an enquiry, and in what words? We will turn it into the templates.

**How you work**
7. Do you survey every job, or only some (your site says "photos or a survey may be needed")? How long does a survey take, and where do you want them in the day?
8. Your working days and hours, how many surveys and installs a day, and how far you will travel. Do you work alone?
9. How do you send quotes now (PDF, WhatsApp, email)? What terms go on them, including when you take payment? We have not written any: your site says none.
10. Your real price list: the three charger brands on your site (Zappi, Ohme, Sync), standard installation, extras. Are you VAT registered?
11. What paperwork do you issue after an install, and do you want the system to produce it?
12. Which accreditations and insurance may we state? Today we show only your two credentials, Level 3 Electrical Installation and 2391 Inspection and Testing.

**Marketing and data**
13. Who runs your Facebook and Instagram ads, and can we have access to the Meta account, Pixel and ad spend? Do you use Google ads?
14. Can we export your past enquiries from Perspective to load as history?
15. Do you have a privacy policy and are you registered with the ICO? Do you want to keep your customer list in one place for follow-up and reviews (your site shows no reviews today)?

**Commercial**
16. What matters most in the first release: answering faster, quoting faster, or knowing which ads work?
17. Who signs off wording, prices and the launch? Who will be the day-to-day contact?
18. Do you want payments and paperwork in the first release or later?

## 6. How we will know it works

- Share of enquiries answered inside 24 hours (target set with Daniel; the demo diary shows a sample percentage).
- Time from enquiry to first reply, and from survey to quote sent.
- Quote win rate and average accepted value.
- Cost per enquiry and per install by source, once spend is entered.
- Zero lost enquiries in the parallel-run week.
