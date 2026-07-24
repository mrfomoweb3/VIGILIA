// x402 facilitator client (resource-server / seller side).
//
// Adapted from the approved reference agent (Aval #6040). A resource server that
// issues a 402 verifies and settles a buyer's payment by POSTing to a facilitator:
//   POST {facilitator}/verify  { x402Version, paymentPayload, paymentRequirements } -> { isValid, invalidReason?, payer? }
//   POST {facilitator}/settle  { x402Version, paymentPayload, paymentRequirements } -> { success, transaction?, payer?, errorReason? }
// The buyer's signed EIP-3009 `transferWithAuthorization` (exact scheme) is
// redeemed on-chain at settle. Facilitator field names vary slightly across
// implementations, so responses are read tolerantly.

import { x402 } from "../config.js";

export interface PaymentRequirements {
  scheme: "exact";
  network: string; // eip155:196
  asset: string; // USDT contract
  maxAmountRequired: string; // atomic units
  payTo: string;
  resource: string; // the resource URL
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  extra?: { name?: string; version?: string };
}

export interface FacilitatorResult {
  ok: boolean;
  payer?: string;
  transaction?: string;
  amountAtomic?: string;
  reason?: string;
}

const X402_VERSION = 1; // wire payload version for `exact` + EIP-3009

/** Atomic units for a human USD amount, per the token's decimals. */
export function atomic(usd: number): string {
  return BigInt(Math.round(usd * 10 ** x402.assetDecimals)).toString();
}

/** Build the paymentRequirements object — mirrors what we advertise in the 402. */
export function buildRequirements(resourceUrl: string): PaymentRequirements {
  return {
    scheme: "exact",
    network: x402.network,
    asset: x402.assetUsdt,
    maxAmountRequired: atomic(x402.priceUsd),
    payTo: x402.payTo || "0x-payto-unset",
    resource: resourceUrl,
    description: "Vigilia scam check — verdict with evidence",
    mimeType: "application/json",
    maxTimeoutSeconds: 120,
    extra: { name: x402.assetName, version: x402.assetVersion },
  };
}

/**
 * Verify then settle a decoded payment payload against the facilitator.
 * Returns ok:false (never throws) on any failure — the caller re-issues a 402.
 */
export async function verifyAndSettle(
  paymentPayload: unknown,
  requirements: PaymentRequirements,
): Promise<FacilitatorResult> {
  const base = x402.facilitatorUrl.replace(/\/$/, "");
  if (!base) return { ok: false, reason: "facilitator_url_unset" };

  try {
    const verify = await postJson(`${base}/verify`, {
      x402Version: X402_VERSION,
      paymentPayload,
      paymentRequirements: requirements,
    });
    if (!verify.ok) return { ok: false, reason: `verify_http_${verify.status}` };
    const isValid = verify.body.isValid ?? verify.body.valid ?? verify.body.success;
    if (!isValid) {
      return {
        ok: false,
        reason: String(verify.body.invalidReason ?? verify.body.reason ?? "invalid_payment"),
      };
    }

    const settle = await postJson(`${base}/settle`, {
      x402Version: X402_VERSION,
      paymentPayload,
      paymentRequirements: requirements,
    });
    if (!settle.ok) return { ok: false, reason: `settle_http_${settle.status}` };
    const success = settle.body.success ?? settle.body.settled ?? settle.body.isValid;
    if (!success) {
      return {
        ok: false,
        reason: String(settle.body.errorReason ?? settle.body.reason ?? "settle_failed"),
      };
    }

    return {
      ok: true,
      payer: strOrUndef(settle.body.payer ?? verify.body.payer),
      transaction: strOrUndef(settle.body.transaction ?? settle.body.txHash ?? settle.body.tx_hash),
      amountAtomic: strOrUndef(settle.body.amount) ?? requirements.maxAmountRequired,
    };
  } catch (err) {
    return {
      ok: false,
      reason: `facilitator_error:${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function postJson(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; body: Record<string, any> }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (x402.facilitatorApiKey) headers["authorization"] = `Bearer ${x402.facilitatorApiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    let parsed: Record<string, any> = {};
    try {
      parsed = (await res.json()) as Record<string, any>;
    } catch {
      parsed = {};
    }
    return { ok: res.ok, status: res.status, body: parsed };
  } finally {
    clearTimeout(t);
  }
}

function strOrUndef(v: unknown): string | undefined {
  return v === undefined || v === null ? undefined : String(v);
}
