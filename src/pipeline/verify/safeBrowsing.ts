// Stage 3(a) — SAFE BROWSING
// Google Safe Browsing v4 threatMatches:find. This is the deterministic
// backbone: a hit here is decisive (see the hard rules in reason.ts).
//
// CRITICAL: an API error is reported as result "error", NEVER "clean".
// A failed check is a failed check — the reasoner must know the difference.

import type { Signal } from "../types.js";

const THREAT_TYPES = [
  "MALWARE",
  "SOCIAL_ENGINEERING",
  "UNWANTED_SOFTWARE",
  "POTENTIALLY_HARMFUL_APPLICATION",
];

const ENDPOINT = "https://safebrowsing.googleapis.com/v4/threatMatches:find";
const TIMEOUT_MS = 5000;

interface ThreatMatch {
  threatType: string;
  threat: { url: string };
}

/** Human-friendly labels for Safe Browsing threat types. */
const THREAT_LABEL: Record<string, string> = {
  MALWARE: "malware",
  SOCIAL_ENGINEERING: "social engineering / phishing",
  UNWANTED_SOFTWARE: "unwanted software",
  POTENTIALLY_HARMFUL_APPLICATION: "potentially harmful application",
};

export async function checkSafeBrowsing(links: string[]): Promise<Signal> {
  if (links.length === 0) {
    return {
      signal: "safe_browsing",
      result: "unknown",
      detail: "No links were present to check against Google Safe Browsing",
    };
  }

  const apiKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
  if (!apiKey) {
    return {
      signal: "safe_browsing",
      result: "error",
      detail: "Safe Browsing check unavailable — API key not configured",
    };
  }

  const body = {
    client: { clientId: "vigilia", clientVersion: "1.0.0" },
    threatInfo: {
      threatTypes: THREAT_TYPES,
      platformTypes: ["ANY_PLATFORM"],
      threatEntryTypes: ["URL"],
      threatEntries: links.map((url) => ({ url })),
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        signal: "safe_browsing",
        result: "error",
        detail: `Safe Browsing API returned HTTP ${res.status} — could not verify these links`,
      };
    }

    const data = (await res.json()) as { matches?: ThreatMatch[] };
    const matches = data.matches ?? [];

    if (matches.length === 0) {
      return {
        signal: "safe_browsing",
        result: "clean",
        detail: `Checked ${links.length} link${links.length === 1 ? "" : "s"} against Google Safe Browsing — no known threats`,
      };
    }

    const first = matches[0];
    const label = THREAT_LABEL[first.threatType] ?? first.threatType;
    const extra = matches.length > 1 ? ` (+${matches.length - 1} more match)` : "";
    return {
      signal: "safe_browsing",
      result: "flagged",
      detail: `Google Safe Browsing flagged a link as ${label}${extra}`,
      meta: {
        matches: matches.map((m) => ({ url: m.threat.url, threatType: m.threatType })),
      },
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      signal: "safe_browsing",
      result: "error",
      detail: aborted
        ? "Safe Browsing check timed out — could not verify these links"
        : "Safe Browsing check failed — could not verify these links",
    };
  } finally {
    clearTimeout(timer);
  }
}
