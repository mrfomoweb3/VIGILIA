// Pipeline orchestrator — runs the five stages in order:
//   OBSERVE -> EXTRACT -> VERIFY (deterministic) -> REASON (bounded LLM) -> ACT
//
// Verify checks run in parallel with Promise.allSettled so one failing check
// never takes down the others. A rejected check becomes an "error" signal,
// never silently dropped.

import { randomUUID } from "node:crypto";
import type {
  CheckResult,
  EvidenceRow,
  ExtractedInput,
  Signal,
} from "./types.js";
import {
  extractFromEmailText,
  extractFromUrl,
  extractFromVision,
} from "./extract.js";
import { checkSafeBrowsing } from "./verify/safeBrowsing.js";
import { checkTyposquat } from "./verify/typosquat.js";
import { checkDomainAge } from "./verify/domainAge.js";
import { checkHeaderAuth } from "./verify/headerAuth.js";
import { reason, type LLMClient } from "./reason.js";
import {
  AnthropicVisionClient,
  toMediaType,
  VisionBudgetError,
  VisionParseError,
  type ImageMediaType,
  type VisionClient,
} from "../vision.js";

export class PipelineError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "PipelineError";
    this.status = status;
  }
}

export interface CheckInput {
  url?: string;
  emailText?: string;
  screenshot?: { buffer: Buffer; mimetype: string };
}

export interface PipelineDeps {
  llm: LLMClient;
  vision?: VisionClient;
}

/** Turn a raw signal into the trimmed evidence row returned to the client. */
function toEvidence(s: Signal): EvidenceRow {
  return { signal: s.signal, result: s.result, detail: s.detail };
}

/** Wrap a verify check so rejection becomes an explicit "error" signal. */
async function safeCheck(
  name: Signal["signal"],
  fn: () => Promise<Signal> | Signal,
): Promise<Signal> {
  try {
    return await fn();
  } catch {
    return {
      signal: name,
      result: "error",
      detail: `The ${name.replace("_", " ")} check failed to run`,
    };
  }
}

/** Stage 1+2: resolve the raw input into a structured ExtractedInput. */
async function observeAndExtract(
  input: CheckInput,
  vision: VisionClient,
): Promise<ExtractedInput> {
  if (input.screenshot) {
    const mediaType = toMediaType(input.screenshot.mimetype);
    if (!mediaType) {
      throw new PipelineError(
        "Unsupported image type. Upload a PNG, JPG, GIF, or WebP screenshot.",
      );
    }
    let extraction;
    try {
      extraction = await vision.extract(
        input.screenshot.buffer.toString("base64"),
        mediaType as ImageMediaType,
      );
    } catch (err) {
      if (err instanceof VisionParseError) {
        throw new PipelineError("Could not read the screenshot. Try a clearer image.");
      }
      if (err instanceof VisionBudgetError) {
        // Honest failure: we will not silently pretend the screenshot was read.
        throw new PipelineError(
          "Screenshot checks are temporarily unavailable (daily capacity reached). Paste the link or email text instead.",
          503,
        );
      }
      throw new PipelineError(
        "The screenshot could not be processed right now. Please try again.",
        502,
      );
    }
    return extractFromVision(extraction);
  }

  if (typeof input.url === "string" && input.url.trim()) {
    const extracted = extractFromUrl(input.url);
    if (extracted.links.length === 0) {
      throw new PipelineError(
        "That doesn't look like a valid web link. Include the full http(s) URL.",
      );
    }
    return extracted;
  }

  if (typeof input.emailText === "string" && input.emailText.trim()) {
    return extractFromEmailText(input.emailText);
  }

  throw new PipelineError("No link or email content found in input.");
}

/** Stage 3: run every applicable deterministic check in parallel. */
async function verify(extracted: ExtractedInput): Promise<Signal[]> {
  const jobs: Array<Promise<Signal>> = [];

  // safe_browsing, domain_age, typosquat always run if we have links; when
  // there are no links they self-report "unknown" (honest, not "clean").
  jobs.push(safeCheck("safe_browsing", () => checkSafeBrowsing(extracted.links)));
  jobs.push(safeCheck("domain_age", () => checkDomainAge(extracted.links)));
  jobs.push(safeCheck("typosquat", () => checkTyposquat(extracted.links)));

  // header_auth only when raw headers are actually present — otherwise it
  // would inject a spurious "unknown" that caps confidence on clean URL checks.
  if (extracted.rawHeaders) {
    jobs.push(safeCheck("header_auth", () => checkHeaderAuth(extracted.rawHeaders)));
  }

  const settled = await Promise.allSettled(jobs);
  return settled.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { signal: "safe_browsing", result: "error", detail: "A check failed unexpectedly" },
  );
}

/** Run the full pipeline and produce a CheckResult. */
export async function runCheck(
  input: CheckInput,
  deps: PipelineDeps,
): Promise<CheckResult> {
  const startedAt = Date.now();
  const checkId = randomUUID();
  const vision = deps.vision ?? new AnthropicVisionClient();

  const extracted = await observeAndExtract(input, vision);
  const signals = await verify(extracted);
  const { output, overrides } = await reason(signals, extracted.urgencyCues, deps.llm);

  const result: CheckResult = {
    verdict: output.verdict,
    confidence: output.confidence,
    evidence: signals.map(toEvidence),
    explanation: output.explanation,
    recommendation: output.recommendation,
    checkId,
    timestamp: new Date().toISOString(),
  };

  // Stage 5 ACT — audit log line to stdout (doubles as the ASP audit trail).
  const latencyMs = Date.now() - startedAt;
  console.log(
    JSON.stringify({
      checkId,
      source: extracted.source,
      verdict: result.verdict,
      confidence: result.confidence,
      signals: signals.map((s) => `${s.signal}:${s.result}`),
      overrides,
      latencyMs,
    }),
  );

  return result;
}
