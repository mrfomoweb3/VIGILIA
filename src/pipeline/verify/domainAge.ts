// Stage 3(b) — DOMAIN AGE
// WHOIS creation-date lookup. A newly-registered domain is a strong scam
// signal. WHOIS is flaky (rate limits, unreliable TLDs like .ng) — on any
// missing data we return "unknown", NEVER "clean".

import whoiser from "whoiser";
import { registrableDomain } from "./typosquat.js";
import type { Signal } from "../types.js";

const TIMEOUT_MS = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

const FLAGGED_DAYS = 30; // < 30 days old  → flagged
const SUSPICIOUS_DAYS = 180; // 30–180 days old → suspicious

/** Keys WHOIS servers use for the creation date, in rough priority order. */
const CREATION_KEYS = [
  "Created Date",
  "Creation Date",
  "created",
  "Created On",
  "Domain Registration Date",
  "Registered On",
  "Registration Time",
];

/** Pull a creation Date out of a whoiser result object. Returns null if none. */
function extractCreationDate(data: unknown): Date | null {
  if (!data || typeof data !== "object") return null;

  // whoiser returns { [whoisServer]: { field: value, ... }, ... } and may nest.
  const record = data as Record<string, unknown>;

  // First, look at top-level fields.
  const direct = findCreationInFields(record);
  if (direct) return direct;

  // Then descend one level into per-server sub-objects.
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      const nested = findCreationInFields(value as Record<string, unknown>);
      if (nested) return nested;
    }
  }
  return null;
}

function findCreationInFields(fields: Record<string, unknown>): Date | null {
  for (const key of CREATION_KEYS) {
    const raw = fields[key];
    const val = Array.isArray(raw) ? raw[0] : raw;
    if (typeof val === "string" && val.trim()) {
      const d = new Date(val.trim());
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("whois-timeout")), ms),
    ),
  ]);
}

/** Look up a single registrable domain's age. */
async function lookupOne(
  domain: string,
): Promise<{ result: Signal["result"]; detail: string; ageDays?: number }> {
  try {
    const data = await timeout(whoiser(domain, { timeout: TIMEOUT_MS }), TIMEOUT_MS + 500);
    const created = extractCreationDate(data);

    if (!created) {
      return {
        result: "unknown",
        detail: `Registration date for ${domain} was unavailable (WHOIS did not return a creation date)`,
      };
    }

    const ageDays = Math.floor((Date.now() - created.getTime()) / DAY_MS);
    const createdStr = created.toISOString().slice(0, 10);

    if (ageDays < 0) {
      return {
        result: "unknown",
        detail: `Registration date for ${domain} could not be interpreted`,
      };
    }

    if (ageDays < FLAGGED_DAYS) {
      return {
        result: "flagged",
        detail: `${domain} was registered ${ageDays} day${ageDays === 1 ? "" : "s"} ago (${createdStr}) — newly-created domains are a strong scam indicator`,
        ageDays,
      };
    }
    if (ageDays <= SUSPICIOUS_DAYS) {
      return {
        result: "suspicious",
        detail: `${domain} was registered ${ageDays} days ago (${createdStr}) — relatively recent`,
        ageDays,
      };
    }
    const years = (ageDays / 365).toFixed(1);
    return {
      result: "clean",
      detail: `${domain} was registered ${createdStr} (~${years} years ago) — well-established`,
      ageDays,
    };
  } catch {
    return {
      result: "unknown",
      detail: `WHOIS lookup for ${domain} failed or timed out — domain age could not be verified`,
    };
  }
}

/** Rank for choosing the most-severe per-domain result to surface. */
const SEVERITY: Record<string, number> = {
  flagged: 4,
  suspicious: 3,
  unknown: 2,
  clean: 1,
  error: 0,
};

export async function checkDomainAge(links: string[]): Promise<Signal> {
  if (links.length === 0) {
    return {
      signal: "domain_age",
      result: "unknown",
      detail: "No domains were available to check registration age",
    };
  }

  const domains = new Set<string>();
  for (const link of links) {
    const rd = registrableDomain(link);
    if (rd) domains.add(rd);
  }

  if (domains.size === 0) {
    return {
      signal: "domain_age",
      result: "unknown",
      detail: "Could not parse a registrable domain to check registration age",
    };
  }

  const results = await Promise.all([...domains].map((d) => lookupOne(d)));

  // Surface the most-severe finding across all domains.
  let worst = results[0];
  for (const r of results) {
    if (SEVERITY[r.result] > SEVERITY[worst.result]) worst = r;
  }

  return {
    signal: "domain_age",
    result: worst.result,
    detail: worst.detail,
    meta: { ageDays: worst.ageDays, domainsChecked: [...domains] },
  };
}
