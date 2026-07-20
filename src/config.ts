// Central configuration + cost controls.
//
// SINGLE SOURCE OF TRUTH FOR THE MODEL. Nothing in this codebase may call the
// Anthropic API with any other model — assertModelAllowed() enforces it.
// Haiku 4.5 is the cheapest current model and the only one this service uses.

/** The only model this service is permitted to call. */
export const MODEL = "claude-haiku-4-5";

/** Everything the app is allowed to send to Anthropic. Deliberately a set of one. */
const MODEL_ALLOWLIST = new Set<string>([MODEL]);

/**
 * Hard guard: throws if any code path tries to use a model other than the
 * allowlisted one. Called immediately before every API request.
 */
export function assertModelAllowed(model: string): void {
  if (!MODEL_ALLOWLIST.has(model)) {
    throw new Error(
      `Model "${model}" is not permitted. This service may only call ${MODEL}.`,
    );
  }
}

// ---- Pricing (USD per 1M tokens) — Claude Haiku 4.5 --------------------------
export const PRICE_INPUT_PER_MTOK = 1.0;
export const PRICE_OUTPUT_PER_MTOK = 5.0;

/** Estimated USD cost of a single API call from its token usage. */
export function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * PRICE_INPUT_PER_MTOK +
    (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_MTOK
  );
}

// ---- Output caps (bound the worst-case cost of any single call) -------------
export const MAX_TOKENS_REASON = 700;
export const MAX_TOKENS_VISION = 1500;

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw.trim().toLowerCase() === "true";
}

/**
 * Cost guardrails. Defaults are deliberately conservative — this service is
 * expected to run on a small prepaid balance, and a public endpoint with an
 * API key behind it is a budget risk if left ungated.
 */
export const guardrails = {
  /** Master kill switch. false => no Anthropic calls at all (deterministic mode). */
  get llmEnabled(): boolean {
    return bool("LLM_ENABLED", true);
  },
  /** Screenshot/vision calls cost ~5x a text check. Separately switchable. */
  get visionEnabled(): boolean {
    return bool("VISION_ENABLED", true);
  },
  /** Stop spending once this much has been spent today (UTC day). */
  get dailyBudgetUsd(): number {
    return num("DAILY_BUDGET_USD", 0.5);
  },
  /** Hard ceiling on Anthropic calls per UTC day, independent of cost. */
  get maxCallsPerDay(): number {
    return num("MAX_LLM_CALLS_PER_DAY", 300);
  },
  /** Per-IP request cap on /api/check, per hour. Blocks scripted abuse. */
  get maxChecksPerHourPerIp(): number {
    return num("MAX_CHECKS_PER_HOUR_PER_IP", 15);
  },
};
