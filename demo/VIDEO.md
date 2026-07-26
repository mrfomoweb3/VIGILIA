# Vigilia — hackathon video (Aval-style, judge-focused)

**Goal:** sell the best use case in the first 10 seconds, then prove execution.
**Length:** ≤90s. **Structure:** Hook → Proof (live page) → Explainer (motion
graphics) → Close.

Judging weighs two things: **the idea, sold fast**, and **degree of execution**.
Every section below serves one of them. No UI appreciation, no filler.

---

## SECTION 1 — HOOK (0:00–0:10) · the 5 hack screenshots

**On screen:** your 5 real-hack screenshots, cut fast — ~1.5s each, slight
push-in on each, a hard cut on the beat. Desaturated / cold grade. A thin red
scan-line or "⚠" stamp can hit on the last one.

**Hook line (voiceover — pick ONE):**

**A — the invisible character (recommended, ties to the product):**
> "Every one of these was one click from working. Not because the victim was
> careless — because the thing that gives it away is a single character you were
> never meant to notice."

**B — the "you" version (more personal):**
> "You've gotten one of these. Maybe you caught it. Maybe you're not sure. The
> tell is always there — it's just too small to see in the moment."

**C — short and cold (most punchy):**
> "This is what a scam looks like one second before it works. Looks real. That's
> the whole point."

> 💡 Pick A if you want the hook to set up the product's core trick (the digit-
> not-a-letter). Pick C if you want maximum punch and will reveal the trick in
> Section 2. Either lands the *idea* — that scams win on an invisible detail.

**Last frame of the hook** holds ~0.5s on a black card, white text:
> **What if software could see it for you?**
Then hard cut to the live page.

---

## SECTION 2 — PROOF (0:10–0:35) · the live product

**On screen:** screen recording of the live page (https://vigilia-production-f7de.up.railway.app).
No page tour — start mid-action.

- Drag the phishing screenshot (`demo/phishing-sample.png`) onto the drop zone →
  click **RUN CHECK**.
- Verdict stamps in. Push in on the **typosquat evidence row**.

**Voiceover:**
> "This is Vigilia. I gave it a screenshot — no link, nothing typed. It read the
> image, pulled the address out, and caught it: paypa1 — a digit one, not the
> letter L. Verdict, with the evidence. About five seconds."

**Verified:** screenshot → `SUSPICIOUS` or `CONFIRMED SCAM`, typosquat FLAGGED,
`paypa1-secure.com uses lookalike characters to imitate "paypal"`.

---

## SECTION 3 — EXPLAINER (0:35–1:10) · motion graphics

Clean animated graphics. This is where you sell it as a **software utility** and
prove **execution depth**. Three frames, ~10–12s each. Exact copy + layout for
each frame is in `demo/motion-graphics/` (built as an on-brand HTML animation you
screen-record — see "Producing the motion graphics" below).

**Frame 1 — "The AI never decides."**
Animated flow: `INPUT → 4 CHECKS → RULES → VERDICT`. The 4 checks light up one by
one: Safe Browsing · Domain age · Brand impersonation · Sender auth.
> VO: "Here's what makes it different. It doesn't ask an AI if something looks
> scammy. It runs four real security checks — and deterministic rules pick the
> verdict in code. The AI only writes the explanation."

**Frame 2 — "It won't lie to you."**
Show a check going `UNKNOWN` → the confidence meter dropping from HIGH to LOW.
> VO: "When a check can't complete, it says so — and lowers its confidence
> instead of guessing. If the model disagrees with the rules, the code wins."

**Frame 3 — "Who it's for."**
Grid of brand chips filling in — global + GTBank, Kuda, OPay, Moniepoint,
Flutterwave, Paystack, MTN. Counter ticks to **106**.
> VO: "106 brands, weighted to where people actually get phished — not just US
> logos. Paste a link, an email, or a screenshot, before you click, pay, or reply."

---

## SECTION 4 — CLOSE (1:10–1:25) · it's a real agent

**On screen:** cut to a terminal, run:
```
onchainos payment quote https://vigilia-production-f7de.up.railway.app/api/check
```
Let the output land: `Will pay 0.2 USD₮0 (exact, X Layer)`. Then the OKX listing
page (okx.ai/agents/7072).

**Voiceover:**
> "And it's not a demo page — it's a live agent on OKX.AI. Any agent can find it
> and pay 0.2 USDT a check over x402 on X Layer. It's listed and running right now."

**Final card:** VIGILIA logo · "Live on OKX.AI · #OKXAI"

---

## Producing the motion graphics — the honest options

You said "import hyperframes." Two real paths, and they're good at different things:

| Approach | Great for | Weak at |
|---|---|---|
| **Generative video (Higgsfield/Hyperframes)** | the *hook* — cinematic, abstract, moody B-roll behind the screenshots | **readable on-screen text/labels** — AI video garbles words, so it's a poor fit for the explainer frames that need "Safe Browsing", "UNKNOWN", "106" legible |
| **HTML/CSS animation I build for you** | the *explainer* — precise, readable, on-brand with the landing page (same fonts/colors), exact copy, clean transitions; you screen-record it in the browser | not cinematic/photoreal |

**Recommendation:** use each for what it's best at —
- **Hook (Section 1):** your 5 screenshots + optional Higgsfield atmosphere.
- **Explainer (Section 3):** I build it as an HTML animation → you screen-record
  it → it looks like broadcast motion graphics and stays consistent with the brand.

I can build the HTML explainer right now. I **cannot** record your screen or
speak the voiceover — those stay with you (same as Aval).

---

## What I need from you
1. The **5 hack screenshots** (drop them in `demo/hooks/`), so I can spec the
   exact cut timing and the ⚠ stamp placement.
2. Pick a **hook line** (A / B / C above).
3. **Go-ahead to build the HTML motion-graphics explainer** (Section 3) — or say
   you'd rather generate it with Higgsfield and I'll spec prompts instead.

---

## Voiceover (generated — macOS "Samantha")

Files in `demo/motion-graphics/voiceover/`:
- `s0.mp3 … s5.mp3` — one narration line per scene.
- `narration-full.mp3` — **all lines on one 46s track, pre-aligned to the
  animation timeline** (t=0 matches the animation's t=0).

**To record the explainer WITH narration — two ways:**

1. **Easiest / most reliable (editor):** in the browser, click ▶, screen-record
   the *video only* (QuickTime ⌘⇧5). Then in your editor drop
   `voiceover/narration-full.mp3` at **0:00** under the clip — it lines up with
   every scene automatically. This avoids macOS's system-audio limitation.
2. **One-shot with sound:** the HTML plays the narration when you click ▶, but
   QuickTime records the *mic*, not browser audio. To capture the audio live you
   need a system-audio route — OBS with "Desktop Audio", or BlackHole/Loopback.
   If you're not set up for that, use method 1.

Re-voice any line: `say -v Samantha -r 180 -o s2.aiff "new text"` then
`ffmpeg -y -i s2.aiff -q:a 4 s2.mp3`. Tell me and I'll regenerate + realign the
combined track.
