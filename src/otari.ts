// Otari gateway client.
//
// Every model call Vigilia makes goes through Otari (otari.ai), Mozilla.ai's
// open-source LLM gateway, on its OpenAI-compatible Chat Completions route.
// Otari owns what this codebase used to hand-roll: provider credentials,
// spend budgets, routing/fallbacks and guardrails. This module is a thin,
// dependency-free fetch wrapper so the rest of the pipeline stays testable.

export const otariConfig = {
  get baseUrl(): string {
    return (process.env.OTARI_BASE_URL ?? "https://api.otari.ai/api/v1").replace(/\/+$/, "");
  },
  get apiKey(): string {
    return (process.env.OTARI_API_KEY ?? "").trim();
  },
  get configured(): boolean {
    return this.apiKey.length > 0;
  },
};

/** A message part in OpenAI Chat Completions format. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

/** Request body. Otari-specific fields sit beside the standard ones. */
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  /** Stable end-user id: Otari bills and caps each one separately. */
  user?: string;
  /** Otari built-in tools, e.g. { type: "otari_web_fetch" }. */
  tools?: Array<Record<string, unknown>>;
  /** Inline MCP servers Otari connects to and runs the tool loop for. */
  mcp_servers?: Array<Record<string, unknown>>;
  /** Request-level input checks Otari runs before any provider call. */
  guardrails?: Array<Record<string, unknown>>;
  max_tool_iterations?: number;
}

export interface ChatResult {
  text: string;
  /** The concrete model that answered (may differ from a policy name). */
  model: string;
  usage: { promptTokens: number; completionTokens: number };
  /** Gateway-run tool calls (fetch, code execution, MCP), as Otari reports them. */
  toolCalls: Array<Record<string, unknown>>;
  /** Response headers worth logging (request id, guardrail verdicts, budgets). */
  headers: Record<string, string>;
}

/** Base error for anything the gateway refused or failed. */
export class OtariError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null,
  ) {
    super(message);
    this.name = "OtariError";
  }
}

/** A guardrail flagged the input and blocked the call (HTTP 403). */
export class GuardrailViolation extends OtariError {
  constructor(message: string, public readonly profile: string | null) {
    super(message, 403, "guardrail_violation");
    this.name = "GuardrailViolation";
  }
}

/** A key, workspace or end-user budget refused the call. */
export class OtariBudgetError extends OtariError {
  constructor(message: string, status: number, code: string | null) {
    super(message, status, code);
    this.name = "OtariBudgetError";
  }
}

const LOGGED_HEADERS = [
  "otari-request-id",
  "otari-guardrails",
  "otari-end-user-budget",
  "otari-route",
  "otari-model",
];

function pickHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of LOGGED_HEADERS) {
    const v = h.get(name);
    if (v) out[name] = v;
  }
  return out;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : ""))
      .join("");
  }
  return "";
}

function classify(status: number, body: unknown): OtariError {
  const err = (body as { error?: { message?: string; code?: string; type?: string; profile?: string } })?.error;
  const detail = (body as { detail?: unknown })?.detail;
  const code = err?.code ?? err?.type ?? null;
  const message =
    err?.message ?? (typeof detail === "string" ? detail : `Otari request failed with HTTP ${status}`);
  const haystack = `${code ?? ""} ${message}`.toLowerCase();

  if (status === 403 && haystack.includes("guardrail")) {
    return new GuardrailViolation(message, err?.profile ?? null);
  }
  if (haystack.includes("budget") || status === 402) {
    return new OtariBudgetError(message, status, code);
  }
  return new OtariError(message, status, code);
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class OtariClient {
  constructor(
    private readonly apiKey = otariConfig.apiKey,
    private readonly baseUrl = otariConfig.baseUrl,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs = 90_000,
  ) {}

  async chat(req: ChatRequest): Promise<ChatResult> {
    if (!this.apiKey) {
      throw new OtariError("OTARI_API_KEY is not set", 0, "not_configured");
    }
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const raw = await res.text();
    let body: unknown = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = { detail: raw.slice(0, 300) };
    }
    if (!res.ok) throw classify(res.status, body);

    const b = body as {
      model?: string;
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      otari_tool_calls?: Array<Record<string, unknown>>;
    };
    return {
      text: textOf(b.choices?.[0]?.message?.content),
      model: b.model ?? req.model,
      usage: {
        promptTokens: b.usage?.prompt_tokens ?? 0,
        completionTokens: b.usage?.completion_tokens ?? 0,
      },
      toolCalls: b.otari_tool_calls ?? [],
      headers: pickHeaders(res.headers),
    };
  }
}

/** Shared default client, built lazily so tests can run without a key. */
let shared: OtariClient | null = null;
export function otari(): OtariClient {
  shared ??= new OtariClient();
  return shared;
}
