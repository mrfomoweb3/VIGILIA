// Stage 1 (screenshot path) — VISION / OCR
// Claude vision transcribes a screenshot into structured JSON. This is an
// EXTRACTION engine only: it reads what's on screen, character-for-character.
// Its output (especially links) is UNTRUSTED and flows into the same
// deterministic verify stage — never straight to a verdict.

import Anthropic from "@anthropic-ai/sdk";
import {
  MODEL,
  MAX_TOKENS_VISION as MAX_TOKENS,
  assertModelAllowed,
} from "./config.js";
import { canSpend, record } from "./budget.js";
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

export class AnthropicVisionClient implements VisionClient {
  private client: Anthropic;
  constructor(apiKey?: string) {
    this.client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });
  }

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

    assertModelAllowed(MODEL);
    const res = await this.client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: imageBase64 },
            },
            { type: "text", text: appendRetry ? `${TASK}\n\nReturn only JSON.` : TASK },
          ],
        },
      ],
    });

    const cost = record(res.usage.input_tokens, res.usage.output_tokens);
    console.log(
      JSON.stringify({
        llm: "vision",
        model: MODEL,
        retry: appendRetry,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        costUsd: Number(cost.toFixed(6)),
      }),
    );

    const block = res.content.find((b) => b.type === "text");
    return block && block.type === "text" ? block.text : "";
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
