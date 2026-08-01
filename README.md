# VIGILIA

**Scam & phishing detection you can pay for by the check.** Send a link, raw email
text, or just a screenshot — get a verdict (**SAFE** / **SUSPICIOUS** /
**CONFIRMED_SCAM**) with a confidence level and plain-language evidence you can act on.

> **Live on OKX.AI** as agent **[#7072](https://www.okx.ai/agents/7072)** ·
> Try it: **https://vigilia-production-f7de.up.railway.app**

---

## The problem

In 2017 a researcher registered `аpple.com` — with a Cyrillic `а` — and browsers
rendered it as `apple.com`. Nobody could see the difference. That trick still drains
bank accounts today: `rn` looks like `m` (`rnicrosoft.com`), a `1` stands in for an
`l` (`paypa1.com`), an extra word makes it feel official (`gtbank-secure.com`). The
tell is always there — it's just too small to notice in the moment.

Vigilia is the second opinion you consult **before you click, pay, or reply.**

## Why you can trust the verdict

The AI never decides. Deterministic security checks produce structured signals, and
**hard-coded rules pick the verdict in code** — if the model disagrees with the rules,
the code wins. When a check can't complete (e.g. WHOIS is unavailable), the system
says `unknown` and **lowers its confidence instead of guessing**. The LLM's only job
is to write the explanation.

**Pipeline:** `Observe → Extract → Verify (deterministic) → Reason (LLM, bounded) → Act`

The deterministic checks:

| Check | What it proves |
|-------|----------------|
| **Google Safe Browsing** | Is the URL on a known malware/phishing blocklist? |
| **Domain age (WHOIS)** | Was the domain registered days ago? (a classic scam tell) |
| **Typosquat / brand impersonation** | Homoglyph-normalized edit distance against 106 brands — catches `rn→m`, `1→l`, `0→o`, and lookalike/containment tricks |
| **Sender auth (SPF / DKIM / DMARC)** | When email headers are present, is the sender forged? |

Brand list is weighted to **where people actually get phished** — global names *plus*
Nigerian/African banks & fintech (GTBank, Kuda, OPay, Moniepoint, Flutterwave,
Paystack, MTN). That's a different product, not a different logo.

## Inputs

Exactly one of:
- a **link** (URL),
- raw **email text** (headers included when you have them), or
- a **screenshot** (png/jpg/gif/webp, ≤5 MB) — OCR reads the address out of the image,
  so a victim doesn't even need to type anything.

Nothing you submit is stored beyond the request.

---

## How it's sold: a live agent (A2MCP + x402)

Vigilia is an **Agentic Service Provider (A2MCP)** on OKX.AI — an API any agent can
discover and pay per call. Payment is the **x402** protocol on **X Layer** (chainIndex
196), integrated with the **official OKX Payment seller SDK** (`@okxweb3/x402-express`
· `@okxweb3/x402-core` · `@okxweb3/x402-evm`): the SDK's `paymentMiddleware` issues the
HTTP `402` challenge on `/api/check`, verifies the buyer's payment proof, and settles
through the OKX facilitator (Broker) — no hand-rolled payment code.

- **Price:** 0.2 USDT (`USD₮0`) per check
- **Network:** X Layer (`eip155:196`)
- **Verify it:**
  ```bash
  onchainos payment quote https://vigilia-production-f7de.up.railway.app/api/check
  # → Will pay 0.2 USD₮0 (exact, X Layer)
  ```

### Two routes, one engine

| Route | Access | Used by |
|-------|--------|---------|
| `POST /api/check` | **x402 payment-gated** — GET/unpaid POST returns a 402 challenge; paid POST returns the verdict | agents on OKX.AI |
| `POST /api/demo` | **free**, rate-limited | the website's RUN CHECK button, so anyone can try it live |

Both call the identical pipeline, so an agent's paid verdict is byte-for-byte what the
web demo returns.

## API reference

- `GET  /api/health` → `{ status, version, remainingUsd }`
- `GET  /api/config` → `{ pricePerCheckUsdt, paymentsEnabled }`
- `POST /api/check` → x402-gated. JSON `{ url }` / `{ emailText }`, or multipart
  `screenshot`. Unpaid → `402` + `PAYMENT-REQUIRED` challenge.
- `POST /api/demo`  → free. Same body shapes. Returns:
  ```json
  {
    "verdict": "SUSPICIOUS",
    "confidence": "high",
    "evidence": [{ "signal": "typosquat", "result": "flagged", "detail": "…" }],
    "explanation": "…",
    "recommendation": "…",
    "checkId": "…",
    "timestamp": "…"
  }
  ```

---

## Run locally

```bash
npm install
cp .env.example .env      # fill ANTHROPIC_API_KEY + GOOGLE_SAFE_BROWSING_API_KEY
npm run dev               # or: npm run build && npm start
```

Open http://localhost:3000. Works without keys too — checks that can't run report
`error`/`unknown` honestly (never a false `clean`) and the verdict degrades safely.

Guardrails are built in for a small budget: the model is pinned to
`claude-haiku-4-5`, with a daily USD spend cap, a daily call cap, and a per-IP
hourly rate limit (see `src/config.ts`).

## Test

```bash
npm run typecheck
npm test          # 29 fixture-based tests incl. the hard-rule override and homoglyph paths
```

## Architecture

| File | Role |
|------|------|
| `src/config.ts` | Model pin, x402 config, budget/rate-limit guardrails |
| `src/pipeline/types.ts` | Signal / CheckResult / Verdict interfaces |
| `src/pipeline/extract.ts` | Stage 2 — URL / email-text / vision → structured input |
| `src/vision.ts` | Screenshot OCR (Claude vision, JSON-only, untrusted output) |
| `src/pipeline/verify/*` | Stage 3 — safeBrowsing, domainAge, typosquat, headerAuth |
| `src/pipeline/verify/typosquat.ts` | Homoglyph normalization + edit-distance/containment |
| `src/brands.ts` | 106 brand domains (global + Nigerian/African banks & fintech) |
| `src/pipeline/reason.ts` | Stage 4 — bounded LLM + hard-rule post-validation |
| `src/pipeline/index.ts` | Orchestrator (`Promise.allSettled` verify stage) |
| `src/budget.ts`, `src/ratelimit.ts` | Daily spend cap + per-IP fixed-window limit |
| `src/server.ts` | Express routes, official OKX `paymentMiddleware` gate, static serving |
| `public/*` | Single-page landing + check widget |
| `demo/` | 90s video script, X copy, motion-graphics explainer + narration |

## Deploy

Any Docker host (Railway / Fly.io / Render / Cloud Run) — being **online** just means the
endpoint responds; no daemon and no always-on laptop.

```bash
docker build -t vigilia .
docker run -p 3000:3000 --env-file .env vigilia
```

Required env: `ANTHROPIC_API_KEY`, `GOOGLE_SAFE_BROWSING_API_KEY`. For the paid
`/api/check` endpoint the OKX SDK also needs `OKX_API_KEY`, `OKX_SECRET_KEY`,
`OKX_PASSPHRASE` (OKX Developer Portal) and a `X402_PAYTO_ADDRESS` / `WALLET_ADDRESS`.
Optional: `PORT` (hosts usually inject it), `PRICE_PER_CHECK_USDT`, `X402_NETWORK`
(`eip155:196` mainnet / `eip155:1952` testnet). Health check path: `/api/health`.

> **Prefer a custom domain for the public endpoint.** The ASP listing stores the endpoint
> URL permanently on-chain, so a host-generated URL (`*.up.railway.app`) locks the listing
> to that host. Point a domain you control at the host to stay portable.

---

Built for the **OKX.AI Genesis Hackathon**. An ASP by Diacreate.
