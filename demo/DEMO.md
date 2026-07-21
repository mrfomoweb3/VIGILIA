# Vigilia — 90-second demo script

Every result below is **verified working** against the live pipeline with real
API keys. Do not improvise new inputs on camera — these are the ones we know land.

Assets in this folder:
- `phishing-sample.png` — the screenshot to upload (a PayPal impersonation)
- `phishing-sample.html` — source, if you want to re-render it

---

## Pre-flight (do this before recording)

- [ ] `npm run build && npm start`, or point at the deployed URL
- [ ] `curl .../api/health` → `status: ok`, `remainingUsd` > 0
- [ ] Browser at ~1280px wide, zoom 100%, **light mode**
- [ ] Hide bookmarks bar and any personal tabs
- [ ] Run each input once before recording (warms WHOIS/Safe Browsing; second run is faster on camera)
- [ ] Recording ≤ 90s — the hackathon caps demo length

---

## Shot list

### 0:00–0:08 — Hook
**On screen:** Vigilia landing page, hero visible.

> "Everyone says *don't click suspicious links*. Nobody tells you how to actually
> tell. Vigilia does — in about five seconds, for a fifth of a cent."

---

### 0:08–0:30 — The catch (the money shot)
**On screen:** Drag `phishing-sample.png` onto the drop zone → click **RUN CHECK**.

> "Here's a PayPal email. Looks real. Watch."

**Let the verdict stamp in. Pause on it.** Then point at the **typosquat evidence row**
(not the verdict word):

> "That's not PayPal. It's p-a-y-p-a-**one**. A digit, not an L. Vigilia read the
> screenshot, pulled the link out, and caught the lookalike."

**Verified output:**
- Verdict: **`SUSPICIOUS` or `CONFIRMED SCAM`** — both are correct here
- `typosquat: FLAGGED — paypa1-secure.com uses lookalike characters to imitate "paypal"`

> ⚠️ **Don't script the verdict word for this shot.** Safe Browsing hasn't
> catalogued this domain, so the deterministic floor is SUSPICIOUS and the model
> may go higher. The *evidence row* is deterministic and always reads the same —
> narrate that. If you want a guaranteed `CONFIRMED SCAM` on camera, use the
> Safe Browsing test URL from the appendix instead, where the hard rule forces it.

---

### 0:30–0:50 — Why it's trustworthy
**On screen:** Scroll the evidence rows slowly.

> "This is the part that matters. The verdict didn't come from an AI's opinion —
> it came from deterministic checks: Google Safe Browsing, domain registration
> age, brand-impersonation distance. The AI only writes the explanation.
> Notice the middle row: WHOIS didn't answer, so it says *unknown* and the
> confidence drops. It doesn't guess."

---

### 0:50–1:05 — The regional edge
**On screen:** Clear the box, paste `https://gtbank-secure.com/verify` → **RUN CHECK**.

> "And it isn't only built for Silicon Valley brands. GTBank, Kuda, OPay,
> Moniepoint, Flutterwave, Paystack, MTN — the brands people actually get
> phished with in Nigeria."

**Verified output:** `SUSPICIOUS`, typosquat flagged against GTBank.

---

### 1:05–1:18 — No false alarms
**On screen:** Paste `https://www.google.com` → **RUN CHECK**.

> "And it doesn't cry wolf. Clean link, clean verdict — registered 1997, nothing
> flagged, high confidence."

**Verified output:** `SAFE`, `high` confidence, *"registered 1997-09-15 (~28.9 years ago)"*.

---

### 1:18–1:30 — Close
**On screen:** Scroll to the pricing section.

> "Zero point two USDT per check. No account, no subscription, nothing stored.
> Vigilia — on OKX.AI."

---

## Appendix — guaranteed `CONFIRMED SCAM` input

If you want the strongest verdict word on camera, use Google's official Safe
Browsing test URL. Safe Browsing flags it, and the hard rule forces
`CONFIRMED_SCAM` in code every time:

```
http://malware.testing.google.test/testing/malware/
```

**Verified live output:** `CONFIRMED SCAM`, `safe_browsing: FLAGGED`.

---

## Recording notes

- **Do not speed up the verdict.** The 3–5s wait is the product doing real
  network checks; cutting it makes it look faked.
- Record at 1080p or better; the evidence text must be legible.
- Keep the cursor still while a verdict is on screen.
- If a check errors on camera, keep it — the honest-failure behavior is a
  feature. But re-run once before recording to avoid a cold-start error.

---

## X post copy

> Meet Vigilia — a pay-per-check scam detector, live as an ASP on OKX.AI.
>
> Paste a link, an email, or a screenshot. Get a verdict with the evidence
> behind it.
>
> The part I care about: the AI never judges. Google Safe Browsing, WHOIS
> domain age, and brand-impersonation checks decide — the model only explains
> the result in plain language. If a check fails, it says so instead of
> guessing.
>
> It catches lookalike domains too: paypa1-secure[.]com is a digit 1, not an L.
> And it covers the brands people actually get phished with in Nigeria —
> GTBank, Kuda, OPay, Moniepoint, Flutterwave, Paystack.
>
> 0.2 USDT per check. No account. Nothing stored.
>
> #OKXAI

*(Attach the ≤90s demo video. Defang the scam domain as `paypa1-secure[.]com`
so X doesn't linkify it.)*

---

## Claims check — everything above is true of the build

| Claim | Status |
|---|---|
| Reads screenshots, extracts links | ✅ verified live in production |
| Catches `paypa1-secure.com` lookalike | ✅ verified |
| Catches `gtbank-secure.com` | ✅ verified |
| `google.com` → SAFE / high | ✅ verified |
| Safe Browsing / WHOIS / typosquat are deterministic | ✅ rules override the model in code |
| Says "unknown" instead of guessing | ✅ verified (WHOIS failure path) |
| Nothing submitted is stored | ✅ no persistence beyond request lifecycle |
| 0.2 USDT per check | ⚠️ **only say this once the OKX listing is live** |
| "live as an ASP on OKX.AI" | ⚠️ **only after the listing is approved** |
