// Per-IP rate limiting for /api/check.
//
// This is the primary defense for a public endpoint that spends real money per
// request. Without it, a single script can drain the API balance. Fixed-window
// counter, in-memory — no dependency, adequate for a single-instance deploy.

import { guardrails } from "./config.js";

const WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface Bucket {
  count: number;
  /** Epoch ms when the current window started. */
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

/** Drop stale buckets so the map can't grow without bound. */
function sweep(now: number): void {
  if (buckets.size < 5000) return;
  for (const [key, b] of buckets) {
    if (now - b.windowStart > WINDOW_MS) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Requests left in the current window. */
  remaining: number;
  /** Seconds until the window resets. */
  retryAfterSec: number;
}

export function checkRateLimit(key: string, now = Date.now()): RateLimitResult {
  const limit = guardrails.maxChecksPerHourPerIp;
  sweep(now);

  let bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    bucket = { count: 0, windowStart: now };
    buckets.set(key, bucket);
  }

  const retryAfterSec = Math.max(
    1,
    Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000),
  );

  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  bucket.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSec,
  };
}

/** Test hook — clear all buckets. */
export function __resetForTests(): void {
  buckets.clear();
}
