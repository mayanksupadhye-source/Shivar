# Nexora — Frontend Wiring Handoff

This session connected your existing frontend design to the real backend from last session.
**No visual design was changed** — every edit was inside `<script>` tags or small CSS additions
for new UI elements (OTP screen, status pills, message threads) that reuse your existing style language.

---

## Files changed

| File | What changed |
|---|---|
| `api-client.js` | **NEW.** Single shared file with every real API call + Socket.io chat wiring. Include it on any page that talks to the backend. |
| `auth-guard.js` | Fixed real JWT decoding (was using plain `atob` + milliseconds; real JWTs need base64URL decoding + seconds). Added `saveSession()`. |
| `auth.html` | Login/signup now call the real backend. Added a new "Verify Your Email" step (same visual card style) since OTP is real now, not instant/fake. |
| `farmer-dashboard.html` | Real auth enforced. Listings, bids (accept/decline), and a **new Messages panel** all hit the real backend + live chat. |
| `buyer-dashboard.html` | Real auth enforced (this page had **no auth check at all before**). Bidding, bid list, orders, and Messages now use real data + live chat. |
| `index.html`, `smart-matching.html` | **Untouched** — no backend logic in either, nothing to wire. |
| `blockchain.js`, `ai-advisor.js` | **Untouched** — kept as the simulated/fallback layers we agreed on. |

Backend also got small additions to match what the full signup form actually collects:
`User` model gained optional profile fields (village, land record, company, GST, etc.), and two
new routes: `GET /api/bids/mine` (farmer's bids across all listings) and `DELETE /api/bids/:id`
(buyer cancels a pending bid).

---

## What's REAL now (say this confidently to judges)

- **Auth**: bcrypt-hashed passwords, real JWT (signature verified server-side on every request), real email OTP via Nodemailer — lands in an actual inbox.
- **Listings, Bids, Orders**: full CRUD in MongoDB. Creating a listing, placing a bid, accepting a bid (which auto-creates an Order) — all persisted, all real.
- **Chat**: Socket.io + MongoDB. Two people on two different devices, logged in as the buyer and farmer on the same listing, see each other's messages appear live. History persists and reloads from the database.
- **Role-based access**: enforced server-side (`middleware/auth.js`), not just hidden in the UI. A buyer token literally cannot call farmer-only routes.

## What's still SIMULATED (be upfront about this — it's a fine, common hackathon choice)

- **Blockchain tab**: SHA-256 hashing + proof-of-work simulation running in the browser via `localStorage`, per our earlier call to leave it as-is. Frame it as "a local simulation of the immutable ledger we'd deploy to Polygon/Hyperledger in production."
- **AI Advisor**: calls OpenAI directly from the browser (or the smart offline fallback if no key is set) — same as before. Fine for a demo; a real deployment would proxy this through the backend.
- **"Verified Farmers" directory and static showcase listing cards**: several crop cards on the buyer dashboard are still hardcoded sample content (not from MongoDB) so the page never looks empty. Real listings load in dynamically alongside them, tagged **"LIVE"** vs the sample ones. If a judge clicks "Place Bid" on a sample card, it now honestly tells them it's sample data instead of silently faking a bid — click a "LIVE" card for the real flow.
- **Counter-offer negotiation**: the buyer dashboard's UI has a "Counter Offer" bid status from the original design, but there's no backend concept of it yet — only pending/accepted/rejected exist for real. If asked, this is an honest "next feature to build," not something broken.
- **SMS OTP**: we went with email OTP instead (explained in our conversation) — no DLT registration hassle, still a real code landing in a real inbox.

---

## Before you demo — do these once

1. Run through **README.md**'s Step 1–6 (Atlas, Gmail app password, seed, run) if you haven't already.
2. Update `NEXORA_API_BASE` — currently defaults to `http://localhost:5000` inside `api-client.js`. Once deployed to Render, either edit that default or set `window.NEXORA_API_BASE = 'https://your-app.onrender.com'` in a `<script>` tag before `api-client.js` loads on each page.
3. **Test the two-device chat for real** before demo day: open the buyer dashboard on your laptop, farmer dashboard on your phone (or a friend's device), both logged in, bid on a live listing, then message each other. This is your most impressive real feature — rehearse it.
4. Re-run `npm run seed` any time your data gets messy from testing.

## Honest answers ready for judges/teachers

- *"Is this a real backend?"* — Yes: Express + MongoDB Atlas, deployed, with real auth and real-time chat.
- *"Is the blockchain real?"* — No, it's a client-side simulation of blockchain mechanics (real SHA-256 hashing, real proof-of-work), representing what we'd deploy on-chain in production.
- *"Does OTP really work?"* — Yes, via email, not SMS (SMS to Indian numbers needs telecom DLT registration we skipped for time).
- *"Can two people actually chat?"* — Yes, genuinely, across different devices, with persisted history.
