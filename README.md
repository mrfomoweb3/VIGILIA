# VIGILIA

Pay-per-check scam detection ASP. Submit a link, raw email text, or a screenshot;
get a verdict (**SAFE** / **SUSPICIOUS** / **CONFIRMED_SCAM**) with plain-language evidence.

**Core principle:** the LLM never judges raw evidence. Deterministic tools
(Safe Browsing, WHOIS domain age, typosquat distance, SPF/DKIM/DMARC) produce
structured signals; the LLM's only bounded job is to synthesize verified signals
into a verdict + explanation. Deterministic hard rules always override the model.

Pipeline: **Observe → Extract → Verify (deterministic) → Reason (LLM, bounded) → Act**

## Run

```bash
npm install
cp .env.example .env      # fill ANTHROPIC_API_KEY + GOOGLE_SAFE_BROWSING_API_KEY
npm run dev               # or: npm run build && npm start
```

Open http://localhost:3000. Works without keys too — checks that can't run report
`error`/`unknown` honestly (never a false `clean`) and the verdict degrades safely.

## API

- `GET  /api/health` → `{ status, version }`
- `GET  /api/config` → `{ pricePerCheckUsdt, paymentsEnabled }`
- `POST /api/check` → JSON `{ url }` or `{ emailText }`, or multipart `screenshot`
  file (png/jpg/gif/webp, ≤5 MB). Returns `{ verdict, confidence, evidence[],
  explanation, recommendation, checkId, timestamp }`.

## Test

```bash
npm run typecheck
npm test          # 18 fixture-based tests incl. the hard-rule override path
```

## Architecture

| File | Role |
|------|------|
| `src/pipeline/types.ts` | Signal / CheckResult / Verdict interfaces |
| `src/pipeline/extract.ts` | Stage 2 — URL / email-text / vision → structured input |
| `src/vision.ts` | Screenshot OCR (Claude vision, JSON-only, untrusted output) |
| `src/pipeline/verify/*` | Stage 3 — safeBrowsing, domainAge, typosquat, headerAuth |
| `src/brands.ts` | ~110 brand domains (global + Nigerian/African banks & fintech) |
| `src/pipeline/reason.ts` | Stage 4 — bounded LLM + hard-rule post-validation |
| `src/pipeline/index.ts` | Orchestrator (`Promise.allSettled` verify stage) |
| `src/server.ts` | Express routes, payment middleware, static serving |
| `public/*` | Brutalist single-page landing + check widget |

## Deploy

Any Docker host (Railway / Fly.io / Render / Cloud Run). The image builds TypeScript and
serves both the API and the landing page.

```bash
docker build -t vigilia .
docker run -p 3000:3000 --env-file .env vigilia
```

Required env vars on the host: `ANTHROPIC_API_KEY`, `GOOGLE_SAFE_BROWSING_API_KEY`.
Optional: `PORT` (hosts usually inject it), `PRICE_PER_CHECK_USDT`, `PAYMENTS_ENABLED`.
Health check path for the platform: `/api/health`.

> **Use a custom domain for the public endpoint.** The ASP listing stores the endpoint URL
> permanently on-chain, so registering a host-generated URL (`*.up.railway.app`,
> `*.onrender.com`) locks the listing to that host. Point a domain you control at the host
> instead — then you can migrate later without touching the listing.

## Payment gating (ASP layer)

`PAYMENTS_ENABLED=false` by default. When true, `/api/check` requires an
`X-Payment-Proof` header (returns 402 otherwise). The OKX.AI marketplace fronts
the actual payment — wire their current ASP billing spec at listing time
(placeholder middleware in `src/server.ts`).

Built for the OKX.AI Genesis Hackathon.
