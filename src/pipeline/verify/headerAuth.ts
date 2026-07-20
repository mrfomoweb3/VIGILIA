// Stage 3(d) — HEADER AUTH
// Only runs when raw email headers are present. Two independent checks:
//   1. SPF/DKIM/DMARC results (parsed from Authentication-Results if present).
//   2. Display-name spoofing: From display-name names a brand but the From
//      address domain doesn't belong to that brand.

import { BRAND_TOKENS, BRAND_DOMAIN_SET } from "../../brands.js";
import { registrableDomain } from "./typosquat.js";
import type { Signal } from "../types.js";

/** Parse the From header into { displayName, address }. */
function parseFrom(headers: string): { displayName: string | null; address: string | null } {
  // Unfold headers (folded lines start with whitespace).
  const unfolded = headers.replace(/\r?\n[ \t]+/g, " ");
  const m = unfolded.match(/^From:\s*(.+)$/im);
  if (!m) return { displayName: null, address: null };

  const value = m[1].trim();
  // Form:  "Display Name" <addr@domain>  OR  Display Name <addr@domain>  OR  addr@domain
  const angle = value.match(/^(.*?)<([^>]+)>/);
  if (angle) {
    let name = angle[1].trim().replace(/^"|"$/g, "").trim();
    return { displayName: name || null, address: angle[2].trim().toLowerCase() };
  }
  // Bare address.
  if (/@/.test(value)) return { displayName: null, address: value.toLowerCase() };
  return { displayName: value || null, address: null };
}

/** Read pass/fail for spf/dkim/dmarc out of an Authentication-Results block. */
function parseAuthResults(headers: string): {
  spf?: string;
  dkim?: string;
  dmarc?: string;
} {
  const unfolded = headers.replace(/\r?\n[ \t]+/g, " ");
  const out: { spf?: string; dkim?: string; dmarc?: string } = {};
  for (const m of unfolded.matchAll(/Authentication-Results:\s*(.+)/gi)) {
    const line = m[1];
    const spf = line.match(/\bspf=(\w+)/i);
    const dkim = line.match(/\bdkim=(\w+)/i);
    const dmarc = line.match(/\bdmarc=(\w+)/i);
    if (spf && !out.spf) out.spf = spf[1].toLowerCase();
    if (dkim && !out.dkim) out.dkim = dkim[1].toLowerCase();
    if (dmarc && !out.dmarc) out.dmarc = dmarc[1].toLowerCase();
  }
  return out;
}

/**
 * Check whether a From display name impersonates a brand whose domain the
 * address does not match. e.g. "PayPal <billing@mail-updates.xyz>".
 */
function detectDisplayNameSpoof(
  displayName: string | null,
  address: string | null,
): { spoofed: boolean; detail?: string } {
  if (!displayName || !address) return { spoofed: false };

  const nameLower = displayName.toLowerCase();
  const addrDomain = registrableDomain(address.split("@").pop() ?? "");
  if (!addrDomain) return { spoofed: false };

  for (const { token, brand } of BRAND_TOKENS) {
    // Brand name mentioned in display name...
    const re = new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`, "i");
    if (re.test(nameLower)) {
      // ...but the sending domain is neither the brand's domain nor clean-matching.
      if (addrDomain === brand.domain || BRAND_DOMAIN_SET.has(addrDomain)) {
        // Address genuinely belongs to a known brand — not a spoof of this one
        // unless the domains differ AND the addr domain isn't the named brand.
        if (addrDomain === brand.domain) return { spoofed: false };
      }
      if (addrDomain !== brand.domain) {
        return {
          spoofed: true,
          detail: `Sender display name says "${displayName}" (${brand.label}) but the actual email address is at ${addrDomain}, which is not ${brand.label}'s domain`,
        };
      }
    }
  }
  return { spoofed: false };
}

export function checkHeaderAuth(rawHeaders: string | null): Signal {
  if (!rawHeaders) {
    return {
      signal: "header_auth",
      result: "unknown",
      detail: "No raw email headers were provided to check sender authentication",
    };
  }

  const { displayName, address } = parseFrom(rawHeaders);
  const auth = parseAuthResults(rawHeaders);
  const spoof = detectDisplayNameSpoof(displayName, address);

  // Display-name spoofing is decisive — flag it.
  if (spoof.spoofed) {
    return {
      signal: "header_auth",
      result: "flagged",
      detail: spoof.detail!,
      meta: { displayName, address, auth },
    };
  }

  // Explicit auth failures.
  const failed: string[] = [];
  if (auth.spf === "fail" || auth.spf === "softfail") failed.push(`SPF ${auth.spf}`);
  if (auth.dkim === "fail") failed.push("DKIM fail");
  if (auth.dmarc === "fail") failed.push("DMARC fail");

  if (failed.length > 0) {
    return {
      signal: "header_auth",
      result: "flagged",
      detail: `Sender authentication failed: ${failed.join(", ")} — the message may be spoofed`,
      meta: { auth, address },
    };
  }

  // We had auth results and they all passed.
  if (auth.spf || auth.dkim || auth.dmarc) {
    const passes = [
      auth.spf ? `SPF ${auth.spf}` : null,
      auth.dkim ? `DKIM ${auth.dkim}` : null,
      auth.dmarc ? `DMARC ${auth.dmarc}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return {
      signal: "header_auth",
      result: "clean",
      detail: `Sender authentication checks present and passing (${passes})`,
      meta: { auth, address },
    };
  }

  // Headers present but no auth results and no spoof detected — inconclusive.
  return {
    signal: "header_auth",
    result: "unknown",
    detail: "No SPF/DKIM/DMARC results were present in the headers to evaluate",
    meta: { displayName, address },
  };
}
