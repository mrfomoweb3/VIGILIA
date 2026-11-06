// Central configuration + cost controls.
//
// SINGLE SOURCE OF TRUTH FOR MODELS. Every model call goes through the Otari
// gateway (see otari.ts), and each pipeline stage has exactly one model role.
// All roles default to open-weight models. A role's value is either a concrete
// Otari model ("provider:model") or the name of an Otari routing policy.
// assertModelAllowed() refuses anything that isn't one of the configured roles.

function envModel(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === "" ? fallback : raw.trim();
}

export const models = {
  /** Reads screenshots: an open-weight vision-language model. */
  get vision(): string {
    return envModel("OTARI_VISION_MODEL", "groq:meta-llama/llama-4-scout-17b-16e-instruct");
  },
  /** Follows links with Otari's fetch, code execution and MCP tools. */
  get investigator(): string {
    return envModel("OTARI_INVESTIGATOR_MODEL", "groq:qwen/qwen3-32b");
  },
  /** Writes the verdict from structured signals: an open-weight reasoning model. */
  get verdict(): string {
    return envModel("OTARI_VERDICT_MODEL", "groq:openai/gpt-oss-120b");
  },
};

/**
 * Hard guard: throws if any code path tries to use a model that isn't one of
 * the configured roles. Called immediately before every gateway request.
 */
export function assertModelAllowed(model: string): void {
  const allowed = new Set<string>([models.vision, models.investigator, models.verdict]);
  if (!allowed.has(model)) {
    throw new Error(`Model "${model}" is not one of Vigilia's configured model roles.`);
  }
}

// ---- Local spend estimate (USD per 1M tokens) -------------------------------
// Rough upper bound for open-weight models, used only by the local daily
// counter. Otari's own usage records are the authoritative spend.
export const PRICE_INPUT_PER_MTOK = 0.2;
export const PRICE_OUTPUT_PER_MTOK = 0.6;

/** Estimated USD cost of a single API call from its token usage. */
export function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * PRICE_INPUT_PER_MTOK +
    (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_MTOK
  );
}

// ---- Output caps (bound the worst-case cost of any single call) -------------
export const MAX_TOKENS_REASON = 700;
export const MAX_TOKENS_VISION = 1500;

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw.trim().toLowerCase() === "true";
}

function str(name: string, fallback = ""): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === "" ? fallback : raw.trim();
}

/**
 * x402 seller-side config for the A2MCP marketplace endpoint (/api/check).
 *
 * Vigilia uses the OFFICIAL OKX Payment seller SDK (@okxweb3/x402-*). The SDK
 * builds the PAYMENT-REQUIRED challenge, verifies the buyer's proof, and settles
 * through the OKX facilitator (Broker) — so we no longer hand-roll any of that.
 * We only supply the business terms (price / network / payTo) and the OKX
 * Developer-Portal credentials the facilitator authenticates with.
 */
export const x402 = {
  /** Price per check, in USD. The SDK auto-converts to the network's stablecoin. */
  get priceUsd(): number {
    return num("PRICE_PER_CHECK_USDT", 0.2);
  },
  /** USD price string the OKX SDK expects, e.g. "$0.2". */
  get price(): string {
    return `$${this.priceUsd}`;
  },
  /** CAIP-2 network — XLayer mainnet (eip155:196); testnet is eip155:1952. */
  get network(): string {
    return str("X402_NETWORK", "eip155:196");
  },
  /** Display label for the settlement stablecoin (logs / UI only). */
  get assetName(): string {
    return str("X402_ASSET_NAME", "USD₮0");
  },
  /** Wallet that receives payment — the agent's owner address. */
  get payTo(): string {
    return str("X402_PAYTO_ADDRESS", str("WALLET_ADDRESS"));
  },
  /** OKX facilitator (Broker) credentials — apply at the OKX Developer Portal. */
  okx: {
    get apiKey(): string {
      return str("OKX_API_KEY");
    },
    get secretKey(): string {
      return str("OKX_SECRET_KEY");
    },
    get passphrase(): string {
      return str("OKX_PASSPHRASE");
    },
  },
  /** True once the SDK has everything it needs to verify + settle payments. */
  get configured(): boolean {
    return Boolean(
      this.okx.apiKey && this.okx.secretKey && this.okx.passphrase && this.payTo,
    );
  },
};

/**
 * Cost guardrails. Defaults are deliberately conservative — this service is
 * expected to run on a small prepaid balance, and a public endpoint with an
 * API key behind it is a budget risk if left ungated.
 */
export const guardrails = {
  /** Master kill switch. false => no Anthropic calls at all (deterministic mode). */
  get llmEnabled(): boolean {
    return bool("LLM_ENABLED", true);
  },
  /** Screenshot/vision calls cost ~5x a text check. Separately switchable. */
  get visionEnabled(): boolean {
    return bool("VISION_ENABLED", true);
  },
  /** Stop spending once this much has been spent today (UTC day). */
  get dailyBudgetUsd(): number {
    return num("DAILY_BUDGET_USD", 0.5);
  },
  /** Hard ceiling on Anthropic calls per UTC day, independent of cost. */
  get maxCallsPerDay(): number {
    return num("MAX_LLM_CALLS_PER_DAY", 300);
  },
  /** Per-IP request cap on /api/check, per hour. Blocks scripted abuse. */
  get maxChecksPerHourPerIp(): number {
    return num("MAX_CHECKS_PER_HOUR_PER_IP", 15);
  },
};
