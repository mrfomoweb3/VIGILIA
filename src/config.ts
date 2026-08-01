// Central configuration + cost controls.
//
// SINGLE SOURCE OF TRUTH FOR THE MODEL. Nothing in this codebase may call the
// Anthropic API with any other model — assertModelAllowed() enforces it.
// Haiku 4.5 is the cheapest current model and the only one this service uses.

/** The only model this service is permitted to call. */
export const MODEL = "claude-haiku-4-5";

/** Everything the app is allowed to send to Anthropic. Deliberately a set of one. */
const MODEL_ALLOWLIST = new Set<string>([MODEL]);

/**
 * Hard guard: throws if any code path tries to use a model other than the
 * allowlisted one. Called immediately before every API request.
 */
export function assertModelAllowed(model: string): void {
  if (!MODEL_ALLOWLIST.has(model)) {
    throw new Error(
      `Model "${model}" is not permitted. This service may only call ${MODEL}.`,
    );
  }
}

// ---- Pricing (USD per 1M tokens) — Claude Haiku 4.5 --------------------------
export const PRICE_INPUT_PER_MTOK = 1.0;
export const PRICE_OUTPUT_PER_MTOK = 5.0;

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
