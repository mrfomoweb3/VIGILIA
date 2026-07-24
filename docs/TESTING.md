# Vigilia — test matrix

Every command below has been run against the **live** deployment and passes.
Re-run them before recording the demo or after any deploy.

```
BASE=https://vigilia-production-f7de.up.railway.app
EP=$BASE/api/check
```

---

## 1. Health + budget

```bash
curl -s $BASE/api/health | python3 -m json.tool
```
Expect `status: ok`, `model: claude-haiku-4-5`, `remainingUsd` > 0.

## 2. The endpoint is a conformant x402 resource (this is what review probes)

```bash
# GET must be 402, never 404 — this is the bug that got us rejected the first time
curl -s -o /dev/null -w "%{http_code}\n" $EP            # -> 402

# OKX's own probe — the exact tool the reviewer uses
onchainos payment quote $EP                              # -> ok:true, "Will pay 0.2 USD₮0 (exact, X Layer)"
```

## 3. Paid path — buyer pays, gets a verdict (full x402 round-trip)

```bash
# quote to mint a paymentId, then pay WITH the input param
PID=$(onchainos payment quote $EP --method POST \
      | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['paymentId'])")

onchainos payment pay --payment-id $PID --selected-index 0 --yes \
  --param url=https://gtbank-secure.com/verify
```
Expect `status: success` and `result.verdict: SUSPICIOUS`. Receipt is
`settled-sandbox` (X402_MODE=sandbox — admits well-formed proofs without moving
funds; flip to `production` + a facilitator to collect real USDT).

> ⚠️ The `--param url=...` (or `--param emailText=...`) is required on the **pay**
> command — the endpoint has nothing to check without it. Missing it returns a
> clean 400 "No link or email content found in input."

## 4. Seller path in isolation (no wallet needed)

```bash
PROOF=$(printf '{"x402Version":1,"scheme":"exact","payload":{"t":"sandbox-proof-abc123"}}' | base64)
curl -s -D- -X POST $EP \
  -H "Content-Type: application/json" \
  -H "PAYMENT-SIGNATURE: $PROOF" \
  -d '{"url":"https://gtbank-secure.com/verify"}' | tail -1
```
Expect HTTP 200, a `PAYMENT-RESPONSE` header (`settled-sandbox`), and a verdict body.

## 5. Free public demo (what the website's RUN CHECK button uses)

```bash
# URL
curl -s -X POST $BASE/api/demo -H "Content-Type: application/json" \
  -d '{"url":"https://gtbank-secure.com/verify"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['verdict'])"

# email text
curl -s -X POST $BASE/api/demo -H "Content-Type: application/json" \
  -d '{"emailText":"Your account will be suspended in 24 hours. Verify at https://paypa1-secure.com/login"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['verdict'])"

# screenshot
curl -s -X POST $BASE/api/demo -F "screenshot=@demo/phishing-sample.png" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['verdict'])"
```
All three return a verdict (SUSPICIOUS on these scam inputs).

## 6. Guaranteed CONFIRMED_SCAM (for the demo, if you want the strongest word)

```bash
curl -s -X POST $BASE/api/demo -H "Content-Type: application/json" \
  -d '{"url":"http://malware.testing.google.test/testing/malware/"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['verdict'])"   # -> CONFIRMED_SCAM
```

## 7. Unit + pipeline tests (local, no network spend)

```bash
npm run typecheck && npm test    # 29/29 pass; mocked LLM/vision — costs nothing
```

---

## Results (last run: 2026-07-24, live)

| # | Test | Result |
|---|------|--------|
| 1 | Health | ✅ ok |
| 2 | GET 402 + `payment quote` probe | ✅ ok:true |
| 3 | Full buyer pay → verdict | ✅ success, SUSPICIOUS |
| 4 | Seller paid path (curl header) | ✅ 200 + PAYMENT-RESPONSE |
| 5 | Free demo — url / email / screenshot | ✅ all verdicts |
| 6 | Safe Browsing test URL | ✅ CONFIRMED_SCAM |
| 7 | `npm test` | ✅ 29/29 |
