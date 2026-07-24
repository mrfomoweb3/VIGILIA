# Vigilia — 90-second demo script

Every result below is **verified working** against the live pipeline with real
API keys. Do not improvise new inputs on camera — these are the ones we know land.

Assets in this folder:
- `phishing-sample.png` — the screenshot to upload (a PayPal impersonation)
- `phishing-sample.html` — source, if you want to re-render it

---

## Architecture note (why two routes)

- **`/api/check`** — the endpoint registered on-chain. **x402 payment-gated**: a GET
  returns a 402 challenge; a paid POST returns the verdict. This is what agents call.
- **`/api/demo`** — same engine, **free**, no payment. This is what the website's
  RUN CHECK button uses, so anyone can try it live.

The demo shows the free route (the website) and *proves* the paid route with the
terminal shot at the end.

## Pre-flight (do this before recording)

- [ ] Use the live URL: **https://vigilia-production-f7de.up.railway.app**
- [ ] `curl .../api/health` → `status: ok`, `remainingUsd` > 0
- [ ] Browser at ~1280px wide, zoom 100%, **light mode**
- [ ] Hide bookmarks bar and any personal tabs
- [ ] Run each input once before recording (warms WHOIS/Safe Browsing; second run is faster on camera)
- [ ] Recording ≤ 90s — the hackathon caps demo length

---

## What this video is judged on

Two things only:

1. **Idea — sell the story in 10 seconds.** The first sentence has to land the
   problem and the twist. If a judge stops watching at 0:10, they should still
   be able to repeat what Vigilia is.
2. **Degree of execution.** Depth of the build, not visual polish. **Do not
   spend seconds admiring the page.** Every shot below exists to prove either
   the idea or the engineering behind it.

**Cut from the old script:** slow scrolling, UI appreciation, the "no false
alarms" google.com shot. They cost 15 seconds and prove nothing a judge scores.

---

## Shot list

### 0:00–0:10 — THE IDEA (the whole pitch, in one breath)
**On screen:** the phishing screenshot already open, full frame. No page tour.

> "Your bank texts you. It looks real. It isn't — the web address is a digit,
> not a letter. Vigilia catches that in five seconds, and shows you the
> receipts. It doesn't ask an AI if something looks scammy. It runs real
> security checks."

> 💡 Why this works: problem everyone recognises → the twist (a *digit*, not a
> letter) → the credibility claim (not an AI guessing). A judge who stops here
> can still repeat the idea.

---

### 0:10–0:30 — EXECUTION: it reads a screenshot and catches the lookalike
**On screen:** Drag `phishing-sample.png` onto the drop zone → click **RUN CHECK**.

> "No link to paste — this is just a screenshot. It reads the image, pulls the
> address out, and checks it."

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

### 0:30–0:50 — EXECUTION: the architecture (the part engineers score)
**On screen:** the evidence rows. Point at them; don't scroll slowly.

> "The AI never decides. Google Safe Browsing, domain age, brand-impersonation
> distance, sender authentication — those produce signals, and hard rules in
> code pick the verdict. If the model disagrees, the code overrules it.
> And look at that middle row: WHOIS didn't answer, so it says **unknown** and
> the confidence drops. It never guesses and calls it clean."

> 💡 This is the strongest execution beat in the video. Two things judges rarely
> see: **deterministic rules overriding the model**, and a system that **admits
> what it couldn't verify** instead of faking confidence.

---

### 0:50–1:05 — IDEA: who it's actually for
**On screen:** Clear the box, paste `https://gtbank-secure.com/verify` → **RUN CHECK**.

> "And it isn't built for Silicon Valley brands. GTBank, Kuda, OPay, Moniepoint,
> Flutterwave, Paystack, MTN — 106 brands, weighted to where people actually
> get phished. That's a different product, not a different logo."

**Verified output:** `SUSPICIOUS`, typosquat flagged against GTBank.

> 💡 This is the second half of the idea, and it's genuinely differentiated —
> most scam detectors only know US brands. Don't cut this one.

---

### ~~1:05–1:18 — No false alarms~~ ❌ CUT THIS SHOT
The `google.com` → SAFE shot proves nothing a judge scores. It costs 13
seconds and shows the product *not* doing anything. Spend the time on the
close instead. (It stays in the appendix if you ever need it for a longer cut.)

---

### 1:05–1:30 — EXECUTION: it's a real paid endpoint, on-chain
**On screen:** Split/cut to a terminal, run:

```bash
onchainos payment quote https://vigilia-production-f7de.up.railway.app/api/check
```

Let the output land — it prints `Will pay 0.2 USD₮0 (exact, X Layer)`.

> "And this isn't a website with a demo button. It's a paid endpoint any agent
> can call — that's the live x402 challenge on X Layer. Discover it, pay two
> tenths of a USDT, get a verdict. No account. Nothing stored."

**Verified output:** `ok: true`, `"summary": "Will pay 0.2 USD₮0 (exact, X Layer)"`.

> 💡 **Strongest execution proof in the video.** Most submissions *claim* to be
> an agent service; this shows the payment protocol answering live, in their own
> tooling. Let the terminal output sit on screen for a beat — judges read it.

**Optional last line, only if the listing is approved by recording time:**
> "It's live on OKX.AI as agent 7072."

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

**The first line is the whole pitch — it has to work alone in a timeline.**

> That "bank" text isn't from your bank. The web address has a digit where a
> letter should be: paypa1[.]com, not paypal.
>
> I built Vigilia to catch that in 5 seconds and show you the receipts.
>
> Send it a link, an email, or just a screenshot. It reads the image, pulls the
> address out, and runs real security checks — Google Safe Browsing, how old the
> domain is, whether it imitates a real brand, whether the sender is forged.
>
> The AI never decides. Deterministic rules pick the verdict in code; if the
> model disagrees, the code overrules it. And when a check can't complete, it
> says "unknown" and lowers its confidence instead of guessing.
>
> It knows 106 brands, weighted to where people actually get phished — GTBank,
> Kuda, OPay, Moniepoint, Flutterwave, Paystack, MTN — not just US logos.
>
> It's a real paid endpoint, not a demo page: agents discover it and pay 0.2
> USDT per check over x402 on X Layer. No account. Nothing stored.
>
> Built for #OKXAI

*(Attach the ≤90s demo video. Defang scam domains as `paypa1[.]com` so X
doesn't linkify them.)*

**Before posting, check two things:**
1. **"Built for #OKXAI"** → change to **"Live on OKX.AI"** only once the listing
   is approved. Until then the current wording is the true one.
2. If you need it shorter, cut the 106-brands paragraph — **never** the opening
   two lines. Those are the idea; everything else is supporting evidence.

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
| "a real paid endpoint / x402 on X Layer" | ✅ verified — `payment quote` returns ok:true |
| 0.2 USDT per check | ✅ that's the advertised x402 price (0.2 USD₮0) |
| "live as an ASP on OKX.AI" | ⚠️ **only after approval — still under review** |

> ⚠️ **The one line to hold back.** Everything above is true *right now* except
> being listed on OKX.AI. Until the status flips to approved, say **"built for
> #OKXAI"** instead of "live on OKX.AI" — in both the video and the X post.
> Line 146 of the X copy below needs that edit if you post before approval.
