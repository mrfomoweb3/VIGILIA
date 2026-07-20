// Stage 4 — REASON (bounded LLM) + hard-rule post-validation.
//
// The LLM's role is narrow: synthesize structured signals into a verdict and a
// plain-language explanation. It NEVER sees raw email text or the image — only
// the signals plus extracted urgency cues. Deterministic rules always win: we
// re-check them in code after the LLM answers and override any violation.

import Anthropic from "@anthropic-ai/sdk";
import {
  MODEL,
  MAX_TOKENS_REASON as MAX_TOKENS,
  assertModelAllowed,
} from "../config.js";
import { canSpend, record } from "../budget.js";
import type {
  Confidence,
  ReasonOutput,
  Signal,
  Verdict,
} from "./types.js";

const SYSTEM_PROMPT = `You are the verdict synthesizer for Vigilia, a scam-check service.
You receive structured signals from deterministic security tools. You must:
1. Choose a verdict: SAFE, SUSPICIOUS, or CONFIRMED_SCAM.
2. HARD RULES you cannot override:
   - Any "flagged" from safe_browsing => verdict is CONFIRMED_SCAM.
   - typosquat "flagged" OR header_auth spoofing "flagged" => at minimum SUSPICIOUS.
   - All checks "clean" and none "error"/"unknown" => SAFE, confidence per signal coverage.
   - Any check "error" or "unknown" => confidence cannot be "high"; say what couldn't be verified.
3. Write a 2-4 sentence plain-language explanation citing the specific evidence
   (e.g., "this domain was registered 6 days ago and is one character away from paypal.com").
   No hedging filler. No security jargon without a gloss.
4. One-line recommendation (do not click / verify via official app / appears safe).
Output ONLY JSON: { "verdict": ..., "confidence": ..., "explanation": ..., "recommendation": ... }`;

/** Minimal interface so tests can inject a mock LLM. */
export interface LLMClient {
  synthesize(userPrompt: string): Promise<string>;
}

/** Thrown when a guardrail blocks the call (budget, kill switch, call cap). */
export class BudgetExhaustedError extends Error {
  constructor(public readonly reason: string) {
    super(`LLM call blocked: ${reason}`);
    this.name = "BudgetExhaustedError";
  }
}

/** Default client backed by the Anthropic API. */
export class AnthropicLLMClient implements LLMClient {
  private client: Anthropic;
  constructor(apiKey?: string) {
    this.client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });
  }
  async synthesize(userPrompt: string): Promise<string> {
    // Budget gate — refuse rather than spend past the daily cap. The caller
    // falls back to the deterministic verdict path.
    const decision = canSpend("reason");
    if (!decision.allowed) {
      throw new BudgetExhaustedError(decision.reason);
    }

    assertModelAllowed(MODEL);
    const res = await this.client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const cost = record(res.usage.input_tokens, res.usage.output_tokens);
    console.log(
      JSON.stringify({
        llm: "reason",
        model: MODEL,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        costUsd: Number(cost.toFixed(6)),
      }),
    );

    const block = res.content.find((b) => b.type === "text");
    return block && block.type === "text" ? block.text : "";
  }
}

/** Build the user prompt from ONLY the structured signals + urgency cues. */
export function buildUserPrompt(signals: Signal[], urgencyCues: string[]): string {
  const signalLines = signals.map(
    (s) => `- ${s.signal}: ${s.result.toUpperCase()} — ${s.detail}`,
  );
  const cues =
    urgencyCues.length > 0
      ? urgencyCues.map((c) => `- "${c}"`).join("\n")
      : "- (none extracted)";

  return `SIGNALS FROM DETERMINISTIC CHECKS:
${signalLines.join("\n")}

URGENCY / PRESSURE PHRASES EXTRACTED FROM THE MESSAGE (verbatim):
${cues}

Produce the verdict JSON now.`;
}

/** Extract the first JSON object from a possibly-noisy LLM string. */
function parseJsonLoose(text: string): Partial<ReasonOutput> | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

const VERDICT_RANK: Record<Verdict, number> = {
  SAFE: 0,
  SUSPICIOUS: 1,
  CONFIRMED_SCAM: 2,
};

function isVerdict(v: unknown): v is Verdict {
  return v === "SAFE" || v === "SUSPICIOUS" || v === "CONFIRMED_SCAM";
}
function isConfidence(c: unknown): c is Confidence {
  return c === "low" || c === "medium" || c === "high";
}

export interface HardRuleContext {
  hasSafeBrowsingFlag: boolean;
  hasTyposquatFlag: boolean;
  hasHeaderSpoofFlag: boolean;
  hasErrorOrUnknown: boolean;
  allClean: boolean;
}

/** Derive the hard-rule facts from the raw signals. */
export function deriveContext(signals: Signal[]): HardRuleContext {
  const by = (name: string) => signals.filter((s) => s.signal === name);

  const hasSafeBrowsingFlag = by("safe_browsing").some((s) => s.result === "flagged");
  const hasTyposquatFlag = by("typosquat").some((s) => s.result === "flagged");
  const hasHeaderSpoofFlag = by("header_auth").some((s) => s.result === "flagged");

  // Only checks that actually ran count toward "error/unknown". A signal that
  // is "unknown" purely because it wasn't applicable still caps confidence —
  // that's the honest behavior the spec wants.
  const hasErrorOrUnknown = signals.some(
    (s) => s.result === "error" || s.result === "unknown",
  );

  const allClean =
    signals.length > 0 && signals.every((s) => s.result === "clean");

  return {
    hasSafeBrowsingFlag,
    hasTyposquatFlag,
    hasHeaderSpoofFlag,
    hasErrorOrUnknown,
    allClean,
  };
}

/**
 * Apply the hard rules to an LLM-proposed output. Returns the final,
 * rule-compliant output plus a list of overrides that were applied (logged
 * by the caller as an audit trail).
 */
export function enforceHardRules(
  proposed: ReasonOutput,
  ctx: HardRuleContext,
): { output: ReasonOutput; overrides: string[] } {
  const overrides: string[] = [];
  let verdict = proposed.verdict;
  let confidence = proposed.confidence;

  // Rule 1: safe_browsing flagged => CONFIRMED_SCAM.
  if (ctx.hasSafeBrowsingFlag && verdict !== "CONFIRMED_SCAM") {
    overrides.push(
      `verdict ${verdict} -> CONFIRMED_SCAM (safe_browsing flagged; hard rule)`,
    );
    verdict = "CONFIRMED_SCAM";
  }

  // Rule 2: typosquat/header spoof flagged => at least SUSPICIOUS.
  if (
    (ctx.hasTyposquatFlag || ctx.hasHeaderSpoofFlag) &&
    VERDICT_RANK[verdict] < VERDICT_RANK["SUSPICIOUS"]
  ) {
    overrides.push(
      `verdict ${verdict} -> SUSPICIOUS (typosquat/header spoof flagged; hard rule)`,
    );
    verdict = "SUSPICIOUS";
  }

  // Rule 4: any error/unknown => confidence cannot be "high".
  if (ctx.hasErrorOrUnknown && confidence === "high") {
    overrides.push(
      `confidence high -> medium (a check was error/unknown; cannot claim high)`,
    );
    confidence = "medium";
  }

  return {
    output: { ...proposed, verdict, confidence },
    overrides,
  };
}

/** Deterministic fallback if the LLM call/parse fails entirely. */
export function fallbackOutput(signals: Signal[], ctx: HardRuleContext): ReasonOutput {
  let verdict: Verdict = "SAFE";
  if (ctx.hasSafeBrowsingFlag) verdict = "CONFIRMED_SCAM";
  else if (ctx.hasTyposquatFlag || ctx.hasHeaderSpoofFlag) verdict = "SUSPICIOUS";
  else if (ctx.hasErrorOrUnknown && !ctx.allClean) verdict = "SUSPICIOUS";

  const confidence: Confidence = ctx.hasErrorOrUnknown ? "low" : ctx.allClean ? "medium" : "low";

  const flaggedDetails = signals
    .filter((s) => s.result === "flagged")
    .map((s) => s.detail);

  const explanation =
    flaggedDetails.length > 0
      ? `Automated checks raised concerns: ${flaggedDetails.join("; ")}.`
      : "The automated verdict summary could not be generated, so this reflects the raw security checks directly. Review the evidence below.";

  const recommendation =
    verdict === "CONFIRMED_SCAM"
      ? "Do not click any links. Delete this message."
      : verdict === "SUSPICIOUS"
        ? "Do not act on this message until you verify it through the official app or website."
        : "No threats were detected, but stay cautious with unexpected messages.";

  return { verdict, confidence, explanation, recommendation };
}

/**
 * Run the reason stage: build prompt, call LLM, parse, enforce hard rules.
 * Returns the final output and any override notes for logging.
 */
export async function reason(
  signals: Signal[],
  urgencyCues: string[],
  llm: LLMClient,
): Promise<{ output: ReasonOutput; overrides: string[] }> {
  const ctx = deriveContext(signals);
  const prompt = buildUserPrompt(signals, urgencyCues);

  let proposed: ReasonOutput | null = null;
  try {
    const raw = await llm.synthesize(prompt);
    const parsed = parseJsonLoose(raw);
    if (
      parsed &&
      isVerdict(parsed.verdict) &&
      isConfidence(parsed.confidence) &&
      typeof parsed.explanation === "string" &&
      typeof parsed.recommendation === "string"
    ) {
      proposed = {
        verdict: parsed.verdict,
        confidence: parsed.confidence,
        explanation: parsed.explanation.trim(),
        recommendation: parsed.recommendation.trim(),
      };
    }
  } catch {
    proposed = null;
  }

  if (!proposed) {
    // LLM failed or returned garbage — deterministic fallback, still rule-safe.
    const fb = fallbackOutput(signals, ctx);
    const { output, overrides } = enforceHardRules(fb, ctx);
    return { output, overrides: ["llm_unavailable_used_fallback", ...overrides] };
  }

  return enforceHardRules(proposed, ctx);
}
