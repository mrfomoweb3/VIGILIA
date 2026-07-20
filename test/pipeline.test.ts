import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractFromEmailText,
  extractFromUrl,
  extractLinksFromText,
  detectRawHeaders,
  extractUrgencyCues,
  normalizeUrl,
} from "../src/pipeline/extract.ts";
import { checkTyposquat } from "../src/pipeline/verify/typosquat.ts";
import { checkHeaderAuth } from "../src/pipeline/verify/headerAuth.ts";
import {
  deriveContext,
  enforceHardRules,
  reason,
  type LLMClient,
} from "../src/pipeline/reason.ts";
import { runCheck } from "../src/pipeline/index.ts";
import { MODEL, assertModelAllowed, estimateCostUsd } from "../src/config.ts";
import {
  canSpend,
  record,
  __resetForTests as __resetBudget,
} from "../src/budget.ts";
import {
  checkRateLimit,
  __resetForTests as __resetRateLimit,
} from "../src/ratelimit.ts";
import {
  VisionParseError,
  VisionBudgetError,
  type VisionClient,
} from "../src/vision.ts";
import type { ReasonOutput, Signal } from "../src/pipeline/types.ts";

// ---------- EXTRACT ----------

test("normalizeUrl rejects non-http and accepts bare domains", () => {
  assert.equal(normalizeUrl("ftp://x.com"), null);
  assert.equal(normalizeUrl("javascript:alert(1)"), null);
  assert.equal(normalizeUrl("localhost"), null);
  assert.equal(normalizeUrl("paypa1.com"), "http://paypa1.com/");
  assert.equal(normalizeUrl("https://www.google.com"), "https://www.google.com/");
});

test("extractLinksFromText pulls full URLs and bare domains, strips trailing punctuation", () => {
  const links = extractLinksFromText(
    "Visit https://secure-gtbank.com/login. Also try kuda-verify.xyz now!",
  );
  assert.ok(links.some((l) => l.includes("secure-gtbank.com")));
  assert.ok(links.some((l) => l.includes("kuda-verify.xyz")));
  // no trailing period captured
  assert.ok(!links.some((l) => l.endsWith(".")));
});

test("detectRawHeaders finds a header block", () => {
  const email = `From: "PayPal" <billing@mail-updates.xyz>
To: victim@example.com
Authentication-Results: mx.google.com; spf=fail; dkim=none; dmarc=fail
Subject: Urgent

Body text here.`;
  const headers = detectRawHeaders(email);
  assert.ok(headers);
  assert.ok(headers!.includes("Authentication-Results"));
});

test("extractUrgencyCues captures pressure phrases", () => {
  const cues = extractUrgencyCues(
    "Your account will be suspended within 24 hours. Click here to verify now.",
  );
  assert.ok(cues.length > 0);
  assert.ok(cues.some((c) => /within 24 hours/i.test(c) || /suspended/i.test(c)));
});

test("extractFromUrl produces a single normalized link", () => {
  const e = extractFromUrl("https://paypa1-secure.com/verify");
  assert.equal(e.links.length, 1);
  assert.equal(e.source, "url");
});

// ---------- TYPOSQUAT ----------

test("typosquat flags an edit-distance squat of paypal", () => {
  const sig = checkTyposquat(["http://paypa1.com/login"]);
  assert.equal(sig.result, "flagged");
  assert.match(sig.detail, /PayPal/i);
});

test("typosquat flags a containment squat of gtbank", () => {
  const sig = checkTyposquat(["https://secure-gtbank.com/login"]);
  assert.equal(sig.result, "flagged");
  assert.match(sig.detail, /GTBank/i);
});

test("typosquat passes the real brand domain", () => {
  const sig = checkTyposquat(["https://www.paypal.com/signin"]);
  assert.equal(sig.result, "clean");
});

test("typosquat returns unknown with no links", () => {
  const sig = checkTyposquat([]);
  assert.equal(sig.result, "unknown");
});

// Homoglyph regression: lookalike characters must not defeat detection.
// "paypa1-secure.com" evades BOTH plain edit distance (suffix inflates it) and
// plain containment (digit 1 breaks the literal match) — the classic combo.
test("typosquat catches homoglyph substitution combined with a suffix", () => {
  const sig = checkTyposquat(["https://paypa1-secure.com/verify"]);
  assert.equal(sig.result, "flagged");
  assert.match(sig.detail, /PayPal/i);
});

test("typosquat catches digit-for-letter lookalikes", () => {
  for (const url of [
    "http://g00gle.com",           // 0 -> o
    "http://paypa1.com",           // 1 -> l
    "http://secure-gtb4nk.com",    // 4 -> a
    "http://micr0soft-login.com",  // 0 -> o + suffix
  ]) {
    const sig = checkTyposquat([url]);
    assert.equal(sig.result, "flagged", `${url} should be flagged`);
  }
});

test("homoglyph normalization does not false-flag unrelated domains", () => {
  for (const url of [
    "https://www.google.com",   // exact brand — clean
    "https://github.com",       // unrelated
    "https://news.ycombinator.com",
    "https://en.wikipedia.org",
  ]) {
    const sig = checkTyposquat([url]);
    assert.equal(sig.result, "clean", `${url} should be clean, got: ${sig.detail}`);
  }
});

// ---------- HEADER AUTH ----------

test("headerAuth flags display-name spoofing", () => {
  const headers = `From: "PayPal" <billing@mail-updates.xyz>
Authentication-Results: mx.google.com; spf=pass`;
  const sig = checkHeaderAuth(headers);
  assert.equal(sig.result, "flagged");
  assert.match(sig.detail, /PayPal/i);
});

test("headerAuth flags SPF/DMARC failure", () => {
  const headers = `From: security@example.com
Authentication-Results: mx.google.com; spf=fail; dkim=none; dmarc=fail`;
  const sig = checkHeaderAuth(headers);
  assert.equal(sig.result, "flagged");
});

// ---------- HARD RULES ----------

test("deriveContext detects a safe_browsing flag", () => {
  const signals: Signal[] = [
    { signal: "safe_browsing", result: "flagged", detail: "flagged" },
    { signal: "typosquat", result: "clean", detail: "ok" },
  ];
  const ctx = deriveContext(signals);
  assert.equal(ctx.hasSafeBrowsingFlag, true);
});

test("enforceHardRules overrides SAFE -> CONFIRMED_SCAM on safe_browsing flag", () => {
  const proposed: ReasonOutput = {
    verdict: "SAFE", // the LLM got it wrong on purpose
    confidence: "high",
    explanation: "looks fine",
    recommendation: "go ahead",
  };
  const ctx = deriveContext([
    { signal: "safe_browsing", result: "flagged", detail: "SOCIAL_ENGINEERING" },
  ]);
  const { output, overrides } = enforceHardRules(proposed, ctx);
  assert.equal(output.verdict, "CONFIRMED_SCAM");
  assert.ok(overrides.some((o) => /CONFIRMED_SCAM/.test(o)));
});

test("enforceHardRules bumps SAFE -> SUSPICIOUS on typosquat flag", () => {
  const proposed: ReasonOutput = {
    verdict: "SAFE",
    confidence: "high",
    explanation: "x",
    recommendation: "y",
  };
  const ctx = deriveContext([
    { signal: "typosquat", result: "flagged", detail: "paypa1.com" },
  ]);
  const { output } = enforceHardRules(proposed, ctx);
  assert.equal(output.verdict, "SUSPICIOUS");
});

test("enforceHardRules caps confidence when a check is error/unknown", () => {
  const proposed: ReasonOutput = {
    verdict: "SAFE",
    confidence: "high",
    explanation: "x",
    recommendation: "y",
  };
  const ctx = deriveContext([
    { signal: "safe_browsing", result: "clean", detail: "ok" },
    { signal: "domain_age", result: "error", detail: "whois failed" },
  ]);
  const { output } = enforceHardRules(proposed, ctx);
  assert.notEqual(output.confidence, "high");
});

// ---------- REASON with a mocked LLM (rule-override end-to-end) ----------

const rogueLLM: LLMClient = {
  // The LLM insists everything is SAFE — the rules must overrule it.
  async synthesize() {
    return JSON.stringify({
      verdict: "SAFE",
      confidence: "high",
      explanation: "Nothing to worry about here.",
      recommendation: "Proceed.",
    });
  },
};

test("reason() overrides a rogue LLM that says SAFE despite a safe_browsing flag", async () => {
  const signals: Signal[] = [
    { signal: "safe_browsing", result: "flagged", detail: "SOCIAL_ENGINEERING" },
    { signal: "typosquat", result: "clean", detail: "ok" },
    { signal: "domain_age", result: "clean", detail: "old" },
  ];
  const { output, overrides } = await reason(signals, [], rogueLLM);
  assert.equal(output.verdict, "CONFIRMED_SCAM");
  assert.ok(overrides.length > 0);
});

test("reason() falls back deterministically when the LLM returns garbage", async () => {
  const brokenLLM: LLMClient = { async synthesize() { return "not json at all"; } };
  const signals: Signal[] = [
    { signal: "typosquat", result: "flagged", detail: "gtbank-secure.com" },
  ];
  const { output, overrides } = await reason(signals, [], brokenLLM);
  assert.equal(output.verdict, "SUSPICIOUS");
  assert.ok(overrides.includes("llm_unavailable_used_fallback"));
});

// ---------- COST GUARDRAILS ----------

test("assertModelAllowed permits only claude-haiku-4-5", () => {
  assert.equal(MODEL, "claude-haiku-4-5");
  assert.doesNotThrow(() => assertModelAllowed(MODEL));
  assert.throws(() => assertModelAllowed("claude-opus-4-8"), /not permitted/);
  assert.throws(() => assertModelAllowed("claude-sonnet-5"), /not permitted/);
});

test("estimateCostUsd uses Haiku 4.5 pricing ($1/$5 per 1M)", () => {
  // 1M input + 1M output = $1.00 + $5.00
  assert.equal(estimateCostUsd(1_000_000, 1_000_000), 6);
  // A representative text check: ~300 in, ~200 out
  const perCheck = estimateCostUsd(300, 200);
  assert.ok(perCheck < 0.002, `expected < $0.002, got ${perCheck}`);
});

test("budget blocks spending once the daily cap is reached", () => {
  __resetBudget();
  assert.equal(canSpend("reason").allowed, true);
  // Burn the default $0.50 budget: 1M output tokens = $5.
  record(0, 1_000_000);
  const decision = canSpend("reason");
  assert.equal(decision.allowed, false);
  assert.equal(
    decision.allowed === false ? decision.reason : "",
    "daily_budget_exhausted",
  );
  __resetBudget();
});

test("rate limiter blocks a single IP past the hourly cap", () => {
  __resetRateLimit();
  const limit = 15; // default MAX_CHECKS_PER_HOUR_PER_IP
  for (let i = 0; i < limit; i++) {
    assert.equal(checkRateLimit("1.2.3.4").allowed, true, `request ${i} should pass`);
  }
  const blocked = checkRateLimit("1.2.3.4");
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec > 0);
  // A different IP is unaffected.
  assert.equal(checkRateLimit("5.6.7.8").allowed, true);
  __resetRateLimit();
});

// ---------- FULL PIPELINE with mocked LLM + vision (no network) ----------

// ---------- SCREENSHOT / VISION PATH (mocked vision client) ----------

/** Stands in for Claude vision — returns what a phishing screenshot would yield. */
const phishingVision: VisionClient = {
  async extract() {
    return {
      visibleText:
        "Your PayPal account will be suspended within 24 hours. Verify now at https://paypa1-secure.com/verify",
      links: ["https://paypa1-secure.com/verify"],
      senderDisplayName: "PayPal Security",
      senderAddress: "billing@mail-updates.xyz",
      urgencyCues: ["account will be suspended within 24 hours"],
    };
  },
};

test("screenshot path extracts links and flags the typosquat", async () => {
  const mockLLM: LLMClient = {
    async synthesize() {
      return JSON.stringify({
        verdict: "SUSPICIOUS",
        confidence: "medium",
        explanation: "The link impersonates PayPal.",
        recommendation: "Do not click.",
      });
    },
  };

  const result = await runCheck(
    { screenshot: { buffer: Buffer.from("fake-png-bytes"), mimetype: "image/png" } },
    { llm: mockLLM, vision: phishingVision },
  );

  // The vision-extracted URL is untrusted input — it must flow through the
  // deterministic verify stage, not straight to a verdict.
  const typo = result.evidence.find((e) => e.signal === "typosquat");
  assert.ok(typo, "typosquat signal should be present");
  assert.equal(typo!.result, "flagged");
  assert.match(typo!.detail, /PayPal/i);
  assert.ok(["SUSPICIOUS", "CONFIRMED_SCAM"].includes(result.verdict));
});

test("screenshot path rejects an unsupported image type", async () => {
  const mockLLM: LLMClient = { async synthesize() { return "{}"; } };
  await assert.rejects(
    runCheck(
      { screenshot: { buffer: Buffer.from("x"), mimetype: "application/pdf" } },
      { llm: mockLLM, vision: phishingVision },
    ),
    /Unsupported image type/,
  );
});

test("screenshot path surfaces a clear error when vision cannot read the image", async () => {
  const blindVision: VisionClient = {
    async extract() {
      throw new VisionParseError("Could not read the screenshot");
    },
  };
  const mockLLM: LLMClient = { async synthesize() { return "{}"; } };
  await assert.rejects(
    runCheck(
      { screenshot: { buffer: Buffer.from("x"), mimetype: "image/png" } },
      { llm: mockLLM, vision: blindVision },
    ),
    /Could not read the screenshot/,
  );
});

test("screenshot path degrades honestly when the vision budget is exhausted", async () => {
  const brokeVision: VisionClient = {
    async extract() {
      throw new VisionBudgetError("daily_budget_exhausted");
    },
  };
  const mockLLM: LLMClient = { async synthesize() { return "{}"; } };
  // Must NOT pretend the screenshot was read — it tells the user to paste text.
  await assert.rejects(
    runCheck(
      { screenshot: { buffer: Buffer.from("x"), mimetype: "image/png" } },
      { llm: mockLLM, vision: brokeVision },
    ),
    /temporarily unavailable/,
  );
});

test("runCheck end-to-end on a typosquat URL yields at least SUSPICIOUS", async () => {
  // No Safe Browsing key in test env -> safe_browsing reports "error" (honest).
  const mockLLM: LLMClient = {
    async synthesize() {
      return JSON.stringify({
        verdict: "SUSPICIOUS",
        confidence: "medium",
        explanation: "The domain impersonates GTBank.",
        recommendation: "Do not enter credentials.",
      });
    },
  };
  const result = await runCheck(
    { url: "https://gtbank-secure.com/verify" },
    { llm: mockLLM },
  );
  assert.ok(["SUSPICIOUS", "CONFIRMED_SCAM"].includes(result.verdict));
  assert.ok(result.evidence.some((e) => e.signal === "typosquat" && e.result === "flagged"));
  assert.ok(result.checkId.length > 0);
});
