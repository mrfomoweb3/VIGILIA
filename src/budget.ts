// Spend tracking + budget enforcement for Anthropic API calls.
//
// Purpose: this service runs on a small prepaid balance. Every Anthropic call
// goes through canSpend() first and record() after, so the process can refuse
// to spend past a daily cap instead of silently draining the account.
//
// Counters are in-memory and reset on restart. That is intentional and
// documented: the primary abuse defense is the per-IP rate limiter, and the
// daily cap is a second line of defense within a process lifetime.

import { estimateCostUsd, guardrails } from "./config.js";

interface DayCounters {
  /** UTC day key, e.g. "2026-07-20". */
  day: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  spentUsd: number;
}

function utcDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

let counters: DayCounters = {
  day: utcDayKey(),
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  spentUsd: 0,
};

/** Roll the counters over when the UTC day changes. */
function rollIfNewDay(): void {
  const today = utcDayKey();
  if (counters.day !== today) {
    counters = {
      day: today,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      spentUsd: 0,
    };
  }
}

export type SpendDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Gate called before every Anthropic request. Returns a refusal reason rather
 * than throwing, so callers can degrade to the deterministic path.
 */
export function canSpend(kind: "reason" | "vision"): SpendDecision {
  rollIfNewDay();

  if (!guardrails.llmEnabled) {
    return { allowed: false, reason: "llm_disabled" };
  }
  if (kind === "vision" && !guardrails.visionEnabled) {
    return { allowed: false, reason: "vision_disabled" };
  }
  if (counters.calls >= guardrails.maxCallsPerDay) {
    return { allowed: false, reason: "daily_call_cap_reached" };
  }
  if (counters.spentUsd >= guardrails.dailyBudgetUsd) {
    return { allowed: false, reason: "daily_budget_exhausted" };
  }
  return { allowed: true };
}

/** Record actual usage after a successful call. Returns this call's cost. */
export function record(inputTokens: number, outputTokens: number): number {
  rollIfNewDay();
  const cost = estimateCostUsd(inputTokens, outputTokens);
  counters.calls += 1;
  counters.inputTokens += inputTokens;
  counters.outputTokens += outputTokens;
  counters.spentUsd += cost;
  return cost;
}

/** Current spend snapshot — surfaced on /api/health for monitoring. */
export function snapshot(): Readonly<DayCounters> & {
  budgetUsd: number;
  remainingUsd: number;
} {
  rollIfNewDay();
  const budgetUsd = guardrails.dailyBudgetUsd;
  return {
    ...counters,
    spentUsd: Number(counters.spentUsd.toFixed(6)),
    budgetUsd,
    remainingUsd: Number(Math.max(0, budgetUsd - counters.spentUsd).toFixed(6)),
  };
}

/** Test hook — reset counters. */
export function __resetForTests(): void {
  counters = {
    day: utcDayKey(),
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    spentUsd: 0,
  };
}
