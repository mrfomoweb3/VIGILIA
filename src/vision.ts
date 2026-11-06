// Stage 1 (screenshot path) — VISION / OCR
// An open-weight vision-language model, served through Otari, transcribes a
// screenshot into structured JSON. This is an EXTRACTION engine only: it reads
// what's on screen, character-for-character. Its output (especially links) is
// UNTRUSTED and flows into the same deterministic verify stage — never
// straight to a verdict.

import {
  models,
  MAX_TOKENS_VISION as MAX_TOKENS,
  assertModelAllowed,
} from "./config.js";
import { canSpend, record } from "./budget.js";
import { otari, type OtariClient } from "./otari.js";
import type { VisionExtraction } from "./pipeline/extract.js";

const SYSTEM = "You are an OCR and extraction engine. Output ONLY valid JSON, no prose.";

const TASK = `Extract from this screenshot of an email/message:
{
  "visibleText": "all readable text",
  "links": ["every URL visible, including partially visible ones"],
  "senderDisplayName": "if visible, else null",
  "senderAddress": "if visible, else null",
  "urgencyCues": ["verbatim phrases creating urgency/pressure, e.g. 'account will be closed in 24 hours'"]
}
Rules: transcribe URLs character-for-character. Do NOT guess or complete
truncated URLs — return them exactly as shown with a "truncated": true flag.`;

export type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export interface VisionClient {
  extract(imageBase64: string, mediaType: ImageMediaType): Promise<VisionExtraction>;
}

function parseJsonLoose(text: string): VisionExtraction | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as VisionExtraction;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as VisionExtraction;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export class OtariVisionClient implements VisionClient {
  constructor(private readonly client: OtariClient = otari()) {}

  private async callOnce(
    imageBase64: string,
    mediaType: ImageMediaType,
    appendRetry: boolean,
  ): Promise<string> {
    // Vision is the most expensive path (~5x a text check) — gate every call,
    // including the retry.
    const decision = canSpend("vision");
    if (!decision.allowed) {
      throw new VisionBudgetError(decision.reason);
    }

    const model = models.vision;
    assertModelAllowed(model);
    const res = await this.client.chat({
      model,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
            { type: "text", text: appendRetry ? `${TASK}\n\nReturn only JSON.` : TASK },
          ],
        },
      ],
    });

    const cost = record(res.usage.promptTokens, res.usage.completionTokens);
    console.log(
      JSON.stringify({
        llm: "vision",
        model: res.model,
        retry: appendRetry,
        inputTokens: res.usage.promptTokens,
        outputTokens: res.usage.completionTokens,
        costUsd: Number(cost.toFixed(6)),
        otari: res.headers,
      }),
    );

    return res.text;
  }

  async extract(imageBase64: string, mediaType: ImageMediaType): Promise<VisionExtraction> {
    // First attempt.
    const first = await this.callOnce(imageBase64, mediaType, false);
    const parsed = parseJsonLoose(first);
    if (parsed) return parsed;

    // Retry once with "Return only JSON" appended.
    const second = await this.callOnce(imageBase64, mediaType, true);
    const parsedRetry = parseJsonLoose(second);
    if (parsedRetry) return parsedRetry;

    // Both attempts failed to yield JSON.
    throw new VisionParseError("Could not read the screenshot");
  }
}

export class VisionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisionParseError";
  }
}

/** Thrown when a guardrail blocks a vision call (budget, kill switch, cap). */
export class VisionBudgetError extends Error {
  constructor(public readonly reason: string) {
    super(`Vision call blocked: ${reason}`);
    this.name = "VisionBudgetError";
  }
}

/** Map an uploaded file's mimetype to a supported vision media type. */
export function toMediaType(mimetype: string): ImageMediaType | null {
  switch (mimetype) {
    case "image/png":
      return "image/png";
    case "image/jpeg":
    case "image/jpg":
      return "image/jpeg";
    case "image/gif":
      return "image/gif";
    case "image/webp":
      return "image/webp";
    default:
      return null;
  }
}
