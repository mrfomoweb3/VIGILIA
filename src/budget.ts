// Local safety switches for model calls.
//
// Spend is enforced by Otari, not here. This file used to keep its own daily
// dollar counter, priced by hand and reset on every restart. It now leaves
// money to the gateway, which knows the real price of every model, survives
// restarts and enforces three layers of budget:
//
//   1. the service key's own spend ceiling (all checks together)
//   2. a routing policy that moves the verdict to a cheaper open-weight model
//      once 80% of the budget is used (budget_used_pct in the policy)
//   3. a per-end-user budget, so one visitor can't use up everyone's checks
//
// What stays local is what the gateway can't know: the operator's kill
// switches and a hard ceiling on calls per process per day.

import { guardrails } from "./config.js";

interface DayCounters {
  /** UTC day key, e.g. "2026-07-20". */
  day: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

function utcDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function fresh(): DayCounters {
  return { day: utcDayKey(), calls: 0, inputTokens: 0, outputTokens: 0 };
}

let counters: DayCounters = fresh();

function rollIfNewDay(): void {
  if (counters.day !== utcDayKey()) counters = fresh();
}

export type SpendDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

/** Gate called before every model call. Returns a reason rather than throwing. */
export function canSpend(kind: "reason" | "vision"): SpendDecision {
  rollIfNewDay();
  if (!guardrails.llmEnabled) return { allowed: false, reason: "llm_disabled" };
  if (kind === "vision" && !guardrails.visionEnabled) {
    return { allowed: false, reason: "vision_disabled" };
  }
  if (counters.calls >= guardrails.maxCallsPerDay) {
    return { allowed: false, reason: "daily_call_cap_reached" };
  }
  return { allowed: true };
}

/** Record a completed call (token counts are for the health page only). */
export function record(inputTokens: number, outputTokens: number): void {
  rollIfNewDay();
  counters.calls += 1;
  counters.inputTokens += inputTokens;
  counters.outputTokens += outputTokens;
}

/** Snapshot for /api/health. Dollars live in Otari's usage records. */
export function snapshot(): Readonly<DayCounters> & { maxCallsPerDay: number; spendEnforcedBy: "otari" } {
  rollIfNewDay();
  return { ...counters, maxCallsPerDay: guardrails.maxCallsPerDay, spendEnforcedBy: "otari" };
}

/** Test hook — reset counters. */
export function __resetForTests(): void {
  counters = fresh();
}
