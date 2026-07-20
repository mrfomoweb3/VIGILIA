// Stage 3(c) — TYPOSQUAT
// Deterministic, zero-cost, no API. Compares each extracted domain's
// registrable form (eTLD+1) against the brand list using edit distance and
// substring containment.

import { distance } from "fastest-levenshtein";
import { parse } from "tldts";
import { BRANDS, BRAND_DOMAIN_SET, BRAND_TOKENS } from "../../brands.js";
import type { Signal } from "../types.js";

/** Get the registrable domain (eTLD+1) for a URL or hostname. */
export function registrableDomain(input: string): string | null {
  const parsed = parse(input);
  return parsed.domain ?? null;
}

/** The label portion before the public suffix, e.g. "paypa1" from "paypa1.com". */
function coreLabel(registrable: string): string {
  return registrable.split(".")[0];
}

/**
 * Homoglyph normalization — collapse characters that look alike in a browser
 * address bar so lookalike substitutions can't evade detection.
 *
 * "paypa1-secure.com" and "g00gle.com" are classic phishing domains that defeat
 * both plain edit distance (the added suffix inflates the distance) and plain
 * substring containment (the digit breaks the literal match). Normalizing first
 * makes both checks see through the substitution.
 */
const HOMOGLYPHS: Array<[RegExp, string]> = [
  [/rn/g, "m"], // rn -> m  (modern-looking but a classic swap)
  [/vv/g, "w"],
  [/1/g, "l"],
  [/0/g, "o"],
  [/3/g, "e"],
  [/4/g, "a"],
  [/5/g, "s"],
  [/7/g, "t"],
  [/8/g, "b"],
  [/\$/g, "s"],
];

export function normalizeHomoglyphs(label: string): string {
  let out = label.toLowerCase();
  for (const [pattern, replacement] of HOMOGLYPHS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

interface TyposquatHit {
  domain: string;
  result: "flagged";
  detail: string;
  meta: Record<string, unknown>;
}

/**
 * Evaluate a single registrable domain against the brand list.
 * Returns a hit if it looks like a typosquat, else null (clean/unrelated).
 */
function evaluateDomain(registrable: string): TyposquatHit | null {
  const lower = registrable.toLowerCase();

  // Exact match with a real brand domain — explicitly clean, short-circuit.
  if (BRAND_DOMAIN_SET.has(lower)) return null;

  const core = coreLabel(lower);
  // Compare against the homoglyph-normalized form so lookalike substitutions
  // (paypa1 -> paypal, g00gle -> google) can't slip past either check.
  const coreNorm = normalizeHomoglyphs(core);

  // 1) Edit-distance check against each brand's core label AND full domain.
  for (const brand of BRANDS) {
    const brandCore = coreLabel(brand.domain);

    // Compare core labels (paypa1 vs paypal) — the most common squat.
    const dCore = Math.min(distance(core, brandCore), distance(coreNorm, brandCore));
    if (dCore >= 1 && dCore <= 2 && core !== brandCore) {
      // Guard: don't flag if the core is drastically shorter/longer (noise).
      if (Math.abs(core.length - brandCore.length) <= 2 && brandCore.length >= 4) {
        return {
          domain: registrable,
          result: "flagged",
          detail: `${registrable} is ${dCore} character${dCore === 1 ? "" : "s"} away from ${brand.label}'s domain ${brand.domain}`,
          meta: { matchedBrand: brand.domain, brandLabel: brand.label, distance: dCore, kind: "edit-distance" },
        };
      }
    }
  }

  // 2) Containment check: a brand token embedded in a longer domain,
  //    e.g. paypal-secure-login.com, secure-gtbank.net, kuda-verify.xyz.
  for (const { token, brand } of BRAND_TOKENS) {
    if (core === token) continue; // exact core handled by exact-match/edit paths
    // Token appears as a bounded segment (surrounded by non-alphanumerics or ends).
    // Checked against the raw core AND the homoglyph-normalized core, so
    // "paypa1-secure" is caught the same as "paypal-secure".
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegex(token)}([^a-z0-9]|$)`, "i");
    const rawHit = re.test(core);
    const normHit = re.test(coreNorm);
    if (rawHit || normHit) {
      const lookalike = !rawHit && normHit;
      return {
        domain: registrable,
        result: "flagged",
        detail: lookalike
          ? `${registrable} uses lookalike characters to imitate "${token}" (impersonating ${brand.label}) — the official domain is ${brand.domain}`
          : `${registrable} embeds the brand name "${token}" (impersonating ${brand.label}) but is not the official domain ${brand.domain}`,
        meta: {
          matchedBrand: brand.domain,
          brandLabel: brand.label,
          kind: lookalike ? "homoglyph-containment" : "containment",
        },
      };
    }
  }

  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Run the typosquat check over every extracted link. Emits ONE aggregate
 * signal summarizing the strongest finding across all domains.
 */
export function checkTyposquat(links: string[]): Signal {
  if (links.length === 0) {
    return {
      signal: "typosquat",
      result: "unknown",
      detail: "No domains were available to check for brand impersonation",
    };
  }

  const registrables = new Set<string>();
  for (const link of links) {
    const rd = registrableDomain(link);
    if (rd) registrables.add(rd);
  }

  if (registrables.size === 0) {
    return {
      signal: "typosquat",
      result: "unknown",
      detail: "Could not parse a registrable domain from the input links",
    };
  }

  const hits: TyposquatHit[] = [];
  for (const rd of registrables) {
    const hit = evaluateDomain(rd);
    if (hit) hits.push(hit);
  }

  if (hits.length > 0) {
    const primary = hits[0];
    const extra = hits.length > 1 ? ` (+${hits.length - 1} more)` : "";
    return {
      signal: "typosquat",
      result: "flagged",
      detail: primary.detail + extra,
      meta: { hits: hits.map((h) => ({ domain: h.domain, ...h.meta })) },
    };
  }

  return {
    signal: "typosquat",
    result: "clean",
    detail: `Checked ${registrables.size} domain${registrables.size === 1 ? "" : "s"} against ${BRANDS.length} known brands — no impersonation detected`,
  };
}
