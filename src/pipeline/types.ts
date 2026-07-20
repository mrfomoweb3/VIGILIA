// Core type definitions for the Vigilia pipeline.
// Defined FIRST — every stage speaks in these terms.

/** The three verdicts the service can return. */
export type Verdict = "SAFE" | "SUSPICIOUS" | "CONFIRMED_SCAM";

export type Confidence = "low" | "medium" | "high";

/**
 * Result state of a single deterministic check.
 * - "flagged"    — the check found a positive scam indicator
 * - "suspicious" — weaker/soft indicator (e.g. domain 2 months old)
 * - "clean"      — the check ran and found nothing wrong
 * - "unknown"    — the check ran but data was unavailable (NOT the same as clean)
 * - "error"      — the check itself failed (NEVER report as clean)
 */
export type SignalResult = "flagged" | "suspicious" | "clean" | "unknown" | "error";

/** The name of the deterministic tool that produced a signal. */
export type SignalName =
  | "safe_browsing"
  | "domain_age"
  | "typosquat"
  | "header_auth";

/** One structured signal emitted by a deterministic verify stage. */
export interface Signal {
  signal: SignalName;
  result: SignalResult;
  /** Human-readable, shown verbatim in the evidence list on the page. */
  detail: string;
  /** Optional machine context (which domain, which brand) for the reasoner. */
  meta?: Record<string, unknown>;
}

/** What Stage 2 (extract) produces and Stage 3 (verify) consumes. */
export interface ExtractedInput {
  /** Every URL found in the input (normalized to absolute http(s)). */
  links: string[];
  /** Raw email/message body text, if any. */
  emailText: string | null;
  /** Raw header block, only if the input contained parseable email headers. */
  rawHeaders: string | null;
  /** Sender display name, if surfaced by vision extraction. */
  senderDisplayName: string | null;
  /** Sender address, if surfaced by vision extraction. */
  senderAddress: string | null;
  /**
   * Verbatim urgency/pressure phrases. These are the ONLY free text allowed
   * into the reasoning prompt — everything else stays out to avoid injection.
   */
  urgencyCues: string[];
  /** Which input modality this came from — for logging only. */
  source: "url" | "email_text" | "screenshot";
}

/** The final object returned by POST /api/check. */
export interface CheckResult {
  verdict: Verdict;
  confidence: Confidence;
  evidence: EvidenceRow[];
  explanation: string;
  recommendation: string;
  checkId: string;
  timestamp: string;
}

/** A single row in the evidence[] array of the response. */
export interface EvidenceRow {
  signal: SignalName;
  result: SignalResult;
  detail: string;
}

/** What the bounded LLM reasoner is expected to return (pre-validation). */
export interface ReasonOutput {
  verdict: Verdict;
  confidence: Confidence;
  explanation: string;
  recommendation: string;
}
