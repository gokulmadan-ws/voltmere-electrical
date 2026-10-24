# Demo script: the 5-minute, two-phone loop

For a pre-sales engineer showing 180 Electrical (owner: Daniel) what his funnel and dashboard become. It shows the real loop between two phones with no server: customer funnel, WhatsApp send, Daniel's phone imports it, Daniel sends a quote, the customer accepts, Daniel imports the acceptance.

Everything below was walked through in a real browser with the labels as written. Taps are in **bold**. "Say" lines are suggestions, kept honest: nothing here is sent by a server, and every price is a labelled sample.

## What you need

- **Phone A, the customer**: any phone with WhatsApp and a normal browser tab (Safari or Chrome). Not an installed home-screen app: installed apps can have separate storage.
- **Phone B, Daniel's phone**: same. If Daniel is in the room and agrees, this can be his own phone.
- Both on the live site: https://gokulmadan-ws.github.io/voltmere-electrical/ (customer) and https://gokulmadan-ws.github.io/voltmere-electrical/dashboard.html (owner). Or your local copy (`python3 -m http.server 4100`).
- Each phone's own mobile number to hand.

## Set-up (two minutes, before anyone is watching)

**Stop and read this first.** "Send my enquiry to Daniel on WhatsApp" opens a WhatsApp chat to Daniel's real number, 07885 496800. If you press send, the real Daniel gets a real message. So, unless Phone B is Daniel's own phone and he expects it, point each phone at the other one:

1. On **Phone A**: open the dashboard, tap **More**, then **Demo tools**. Under **Try on your phone**, type **Phone B's mobile number** in "Open WhatsApp links with this mobile number" and tap **Save**. It says "Links open WhatsApp for +44..." with that number.
2. On **Phone B**: the same, but type **Phone A's mobile number**.
3. On **Phone B** (Daniel's), still in Demo tools, tap **Reset diary and messages**, then **Reset diary**. This gives him a fresh sample diary built around today.
4. On **Phone A**, go back to the customer site (the address without `dashboard.html`).

Why this works: each phone keeps its own copy of the data and its own WhatsApp target. The enquiry reaches Phone B because it travels inside the WhatsApp message, not because the phones share anything.

If Phone B is Daniel's real phone, skip step 1 (the default number is his) and do steps 2 to 4.

## The demo

### 1. His site, his words (0:00 to 0:45) on Phone A

| Tap or do | Say |
|---|---|
| Open the customer site. Scroll the hero: "Your own EV charger. Installed at home in Northern Ireland." | "This is your site, word for word: your headline, your three steps, your six questions, your two credentials. Nothing invented." |
| At the top, in the strip, tap **Only my content**. The calculator, the example quote and the suggested visit disappear. Tap **With ideas** to bring them back. | "Anything we added that is not on your site today is tagged 'Idea from us'. Flip it off and it is exactly your site." |
| Tap **Get my installation quote**. | "That is your button, with your exact words." |

### 2. The customer's six steps (0:45 to 1:45) on Phone A

| Tap or do | Say |
|---|---|
| **Step 1:** type a postcode such as **BT9 6QP**, tap **Continue**. | "Your first question. It checks it is a real postcode." |
| **Step 2:** tap **Private driveway**. It moves on by itself. | "One tap per question, your exact options." |
| **Step 3:** tap **It's ordered or arriving soon**. **Step 4:** tap **As soon as possible**. **Step 5:** tap **Yes**. | |
| **Step 6:** type a name, **Phone A's real mobile**, and an email (use a made-up one such as `name@example.com`). Leave the optional offers box as it is. Tap **Request my installation quote**. | "No price, no promise beyond your own 24 hours. The small print is yours." |

Short on time or typing on a small phone? Tap **Demo: fill sample details** on steps 1 and 6. Use your own mobile number if you want the quote to reach Phone A later.

### 3. The confirmation, then WhatsApp (1:45 to 2:15) on Phone A

| Tap or do | Say |
|---|---|
| Read the page: "Thanks, your enquiry has been received." and the reference (for example EL-1043). | "Your thank-you page, your 24 hours." |
| Tap **Send my enquiry to Daniel on WhatsApp**. WhatsApp opens to Phone B's number with the enquiry written out. Press **send** in WhatsApp. | "On your live site your funnel's webhook does this silently. Here WhatsApp is the pipe, so the whole loop is real without a server." |
| (Optional) Tap **Demo: see what Daniel's phone would receive**. | "This is the alert Daniel's phone gets." |

### 4. Daniel's phone imports it (2:15 to 3:00) on Phone B

| Tap or do | Say |
|---|---|
| Open WhatsApp. The customer's message is there, ending "Tap to add my enquiry to your dashboard:" and a link. Tap the link. It opens the dashboard on the **Import** screen ("Aoife Magee sent an enquiry"). | "Exactly what the customer typed: name, mobile, postcode, her five answers in your words. Nothing is added until you tap." |
| Tap **Add to my dashboard**. It says **Enquiry added**, with a survey visit and "Reply due in 24 h". | "The 24 hour clock starts from when she sent it. It also suggested the next free survey slot from your diary." |
| Tap **Open the enquiry**, then **Confirm survey visit**. A toast says the customer has been told (simulated). | "One tap. The message to her is shown in the outbox, marked simulated." |

If the link does not open in your browser (some phones open links in WhatsApp's own viewer), use the menu to open it in Safari or Chrome. If it still will not, tap **More**, **Demo tools**, **Paste a customer's WhatsApp message** (it opens the Import screen), and paste the whole message there.

### 5. Daniel sends a quote (3:00 to 3:45) on Phone B

| Tap or do | Say |
|---|---|
| Tap **More**, then **Quotes**, then **New quote**. Tap **Aoife Magee** (under "Not surveyed yet: you can still quote ahead"). | "Normally you would survey first. Quoting ahead works too." |
| The builder opens with a charger, installation, circuit and testing already chosen. Tap **Ohme** or **Sync** to swap the charger. Tap **Send**. | "Every price is a labelled sample from a list you edit in Settings. Your real prices go in there." |
| In "Send the quote to Aoife" tap **WhatsApp**. It opens to Phone A's number. Press **send**. | "Her message says the total, when it is valid until, and carries a link." |

### 6. The customer accepts (3:45 to 4:20) on Phone A

| Tap or do | Say |
|---|---|
| In WhatsApp tap the quote link. The quote opens: total, "What's included", "Prototype: sample prices". | "This phone has never seen this quote. The quote is inside the link, so it opens anywhere." |
| Tap **Accept quote**. In "Which days suit you?" tap **Thu**, **Fri** and **Morning**, then **Open WhatsApp**. Press **send**. | "No server holds his diary, so she says which days suit her and the message is written for her. It also has a link for you." |
| (Optional) Tap **Back to my quote**, then **Not for me**, to show the reason chips. | "A decline works the same way, with a reason." |

### 7. Daniel imports the acceptance (4:20 to 5:00) on Phone B

| Tap or do | Say |
|---|---|
| In WhatsApp tap the link in her reply. **Import** says "Aoife accepted quote Q-EL-1043 (£1,514), prefers Thu/Fri mornings". Tap **Mark quote accepted and plan the install**. It says **Quote accepted**. | "The quote is accepted in your dashboard and an install is created, with her preferred days in its notes." |
| Tap **Plan the install day**. Tap **Confirm install day**, pick a day and a time, tap **Set this day**, then **Confirm install day** again. | "You agree the exact day with her and confirm it. She is told." |
| Tap **More**, then **Pipeline**. Show the stages: Enquiry, Survey, Quote, Accepted, Install, Done. | "Your whole sales process, with money in each stage. Today shows what needs you." |
| Tap **More**, then **What's real**. | "Everything you just saw crossed between two phones with no server. A live build replaces four things: your funnel's webhook, a database, a login, and automatic delivery. Here is the list, with effort." |

## One phone only (3 minutes)

1. On the customer site tap **Prototype tools**, then **Owner login (demo)** (or open `dashboard.html` in a second tab). Both pages share one store on one device.
2. In the dashboard tap **More**, **Demo tools**, **Add a sample website enquiry**, **New enquiry**. A toast and a badge appear; Today shows it under **Needs you**.
3. Tap **Confirm survey**. In Demo tools tap **A customer opens a quote**, then **A customer accepts a quote**. Today shows the accepted quote waiting for an install day.
4. Finish on **More**, **What's real**.

## If something goes wrong

| Problem | Fix |
|---|---|
| WhatsApp is not installed or does not open | On the quote page, after tapping **Accept quote**, use **Copy message**, then paste it into the other phone's **More, Demo tools, Paste a customer's WhatsApp message**. For the enquiry itself, use a device that has WhatsApp, or use the one-phone version above. |
| The link says it is damaged or cut off | A messenger or keyboard trimmed it. Copy the whole message and paste it into **Paste a customer's WhatsApp message** as above. |
| A quote link says it cannot be opened | Check that the whole link was copied. A link that holds only a quote number (`#q=...`) works only in the browser that made it. |
| You pressed send to the real number by mistake | Tell Daniel. Then set the demo mobile on both phones before trying again. |
| The diary looks odd or full | **More, Demo tools, Reset diary and messages**. |
| You want to rehearse with a fixed date | Add `?now=2026-10-23T20:30&freeze=1` to the address (a Friday evening, which the sample diary is built around). |

## After the demo

On both phones tap **More, Demo tools, Reset diary and messages** and clear the demo mobile (tap **Clear**), so nothing points at your own number next time.

## Questions Daniel is likely to ask

- **"Does it send WhatsApp messages by itself?"** Not yet. Here the customer or you tap send, which is why it works with no server. A live build uses the WhatsApp Business Platform and your funnel's webhook. See `docs/PRODUCTION-PLAN.md`.
- **"Where is my data?"** In the browser on each phone. There is no server and nothing leaves a phone except the WhatsApp messages people choose to send. The data inside a link is not encrypted or signed, which is why the import screen shows it and needs a tap.
- **"Why are there no prices on my site?"** Yours has none, so neither does this. The quote prices are samples that you replace.
- **"Is that all my wording?"** Yes: the headline, the three steps, the six questions and answers, your six funnel steps and your thank-you page are word for word from your site. Flip **Only my content** to see exactly that. Anything we added carries the tag "Idea from us, not on your site today".
- **"What would the real thing take?"** About 15 weeks for one engineer, 10 to 12 with a second person, plus optional payments and paperwork. These are estimates, not a quote.
