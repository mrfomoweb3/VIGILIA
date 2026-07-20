// Stage 2 — EXTRACT
// Turn a raw URL or email-text input into a structured ExtractedInput.
// The screenshot path lives in vision.ts and feeds into extractFromVision().

import type { ExtractedInput } from "./types.js";

/**
 * URL matcher. Deliberately greedy about catching links in prose, then each
 * candidate is validated/normalized with the URL constructor before use.
 */
const URL_REGEX = /\bhttps?:\/\/[^\s<>"')\]]+/gi;

/**
 * Bare-domain matcher (no scheme) for things like "click paypa1.com now".
 * We only accept these when they look domain-shaped to avoid false hits.
 */
const BARE_DOMAIN_REGEX =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b/gi;

/** Lines that indicate a raw email header block is present. */
const HEADER_LINE_REGEX =
  /^(From|To|Reply-To|Return-Path|Received|DKIM-Signature|Authentication-Results|Message-ID|Subject|Date):/im;

/**
 * Strip trailing punctuation that commonly rides along when a URL ends a
 * sentence, e.g. "visit https://x.com." — but keep legitimate path chars.
 */
function trimTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:!?)\]}'"]+$/, "");
}

/** Normalize a candidate to an absolute http(s) URL, or null if invalid. */
export function normalizeUrl(candidate: string): string | null {
  const trimmed = trimTrailingPunctuation(candidate.trim());
  if (!trimmed) return null;

  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;

  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null; // reject "localhost"-style
    return u.href;
  } catch {
    return null;
  }
}

/** Deduplicate while preserving first-seen order. */
function unique(items: string[]): string[] {
  return [...new Set(items)];
}

/**
 * Extract all links from a block of free text. Handles both full URLs and
 * bare domains. Returns normalized absolute URLs.
 */
export function extractLinksFromText(text: string): string[] {
  const found: string[] = [];

  for (const m of text.matchAll(URL_REGEX)) {
    const n = normalizeUrl(m[0]);
    if (n) found.push(n);
  }

  // Bare domains only if they weren't already captured as part of a full URL.
  for (const m of text.matchAll(BARE_DOMAIN_REGEX)) {
    const raw = m[0];
    // Skip if this domain already appears inside a matched full URL.
    if (found.some((f) => f.includes(raw.toLowerCase()))) continue;
    // Skip common false positives (filenames, version numbers handled by TLD len).
    const n = normalizeUrl(raw);
    if (n) found.push(n);
  }

  return unique(found);
}

/** Detect whether the pasted text contains a raw email header block. */
export function detectRawHeaders(text: string): string | null {
  if (!HEADER_LINE_REGEX.test(text)) return null;

  // Grab the leading contiguous header block: consecutive lines that look
  // like "Header-Name: value" or folded continuations (leading whitespace).
  const lines = text.split(/\r?\n/);
  const headerLines: string[] = [];
  let started = false;

  for (const line of lines) {
    const isHeader = /^[A-Za-z][A-Za-z0-9-]*:\s?/.test(line);
    const isFold = /^\s+\S/.test(line);
    if (isHeader || (started && isFold)) {
      started = true;
      headerLines.push(line);
    } else if (started && line.trim() === "") {
      break; // blank line ends the header block
    } else if (started) {
      break;
    }
  }

  const block = headerLines.join("\n").trim();
  return block.length > 0 && HEADER_LINE_REGEX.test(block) ? block : null;
}

/**
 * Pull verbatim urgency/pressure phrases out of email text. Deterministic,
 * dictionary-driven — NOT an LLM call. These are the only free-text snippets
 * allowed to reach the reasoning prompt.
 */
const URGENCY_PATTERNS: RegExp[] = [
  /\b(?:within|in)\s+\d+\s*(?:hours?|hrs?|minutes?|mins?|days?)\b[^.!?\n]*/gi,
  /\byour\s+account\s+(?:will\s+be|has\s+been|is)\s+(?:closed|suspended|locked|deactivated|terminated|limited|restricted)\b[^.!?\n]*/gi,
  /\b(?:urgent|immediate|immediately|act\s+now|final\s+notice|last\s+warning|verify\s+now|confirm\s+now)\b[^.!?\n]*/gi,
  /\b(?:failure\s+to|if\s+you\s+(?:do\s+not|don'?t))\b[^.!?\n]*/gi,
  /\b(?:unauthorized|suspicious)\s+(?:login|activity|access|sign-?in|transaction)\b[^.!?\n]*/gi,
  /\bclick\s+(?:here|the\s+link\s+below|below)\b[^.!?\n]*/gi,
];

export function extractUrgencyCues(text: string): string[] {
  const cues: string[] = [];
  for (const pat of URGENCY_PATTERNS) {
    for (const m of text.matchAll(pat)) {
      const phrase = m[0].trim().replace(/\s+/g, " ");
      if (phrase.length > 3) cues.push(phrase);
    }
  }
  // Cap to keep the reasoning prompt small, dedupe case-insensitively.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of cues) {
    const key = c.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
    if (out.length >= 8) break;
  }
  return out;
}

/** Extract from a single URL input. */
export function extractFromUrl(url: string): ExtractedInput {
  const normalized = normalizeUrl(url);
  return {
    links: normalized ? [normalized] : [],
    emailText: null,
    rawHeaders: null,
    senderDisplayName: null,
    senderAddress: null,
    urgencyCues: [],
    source: "url",
  };
}

/** Extract from pasted email/message text. */
export function extractFromEmailText(text: string): ExtractedInput {
  return {
    links: extractLinksFromText(text),
    emailText: text,
    rawHeaders: detectRawHeaders(text),
    senderDisplayName: null,
    senderAddress: null,
    urgencyCues: extractUrgencyCues(text),
    source: "email_text",
  };
}

/** Shape of the JSON the vision model returns (see vision.ts). */
export interface VisionExtraction {
  visibleText?: string;
  links?: string[];
  senderDisplayName?: string | null;
  senderAddress?: string | null;
  urgencyCues?: string[];
}

/**
 * Merge vision output into an ExtractedInput. Vision-provided links are
 * UNTRUSTED — normalized here and then flow through the same verify stage.
 */
export function extractFromVision(v: VisionExtraction): ExtractedInput {
  const visionLinks = (v.links ?? [])
    .map((l) => normalizeUrl(l))
    .filter((l): l is string => l !== null);

  // Also scan the transcribed text for any links vision listed inline but
  // didn't put in links[].
  const textLinks = v.visibleText ? extractLinksFromText(v.visibleText) : [];

  const emailText = v.visibleText ?? null;

  return {
    links: unique([...visionLinks, ...textLinks]),
    emailText,
    rawHeaders: emailText ? detectRawHeaders(emailText) : null,
    senderDisplayName: v.senderDisplayName ?? null,
    senderAddress: v.senderAddress ?? null,
    urgencyCues: (v.urgencyCues ?? [])
      .map((c) => c.trim())
      .filter((c) => c.length > 0)
      .slice(0, 8),
    source: "screenshot",
  };
}
