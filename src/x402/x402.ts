// x402 seller-side helpers for Vigilia's A2MCP endpoint.
//
// Adapted from the approved reference agent (Aval #6040). Emits an accepts-based
// v2 402 (`PAYMENT-REQUIRED`, `exact` scheme) and verifies the buyer's replayed
// authorization. Two modes:
//   - sandbox    : admit any well-formed authorization (dev/demo, no on-chain settlement).
//   - production : parse the authorization -> verify + SETTLE via the facilitator (fail-closed).
//
// Header names are protocol literals — do NOT rename.

import { createHash } from "node:crypto";
import { x402 } from "../config.js";
import { atomic, buildRequirements, verifyAndSettle } from "./facilitator.js";

export const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
export const PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE";
export const PAYMENT_LEGACY_HEADER = "X-PAYMENT"; // legacy x402 v1
export const PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE";

function isSandbox(): boolean {
  return x402.mode !== "production";
}

export interface PaymentContext {
  paymentId: string;
  amountUsd: number;
  payer?: string;
  transaction?: string;
}

/** Build the base64 PAYMENT-REQUIRED payload advertised on an unpaid call. */
export function buildPaymentRequired(resourceUrl: string): string {
  const payload = {
    x402Version: 2,
    resource: {
      url: resourceUrl,
      description: "Vigilia scam check — verdict with evidence",
      method: "POST",
    },
    accepts: [
      {
        scheme: "exact",
        network: x402.network, // eip155:196 (XLayer)
        asset: x402.assetUsdt,
        amount: atomic(x402.priceUsd),
        payTo: x402.payTo || "0x-payto-unset",
        maxTimeoutSeconds: 120,
        // EIP-712 domain the buyer needs to sign the EIP-3009 authorization.
        extra: { name: x402.assetName, version: x402.assetVersion },
      },
    ],
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

/** The JSON body returned alongside a 402 (human-readable, for browsers/probes). */
export function paymentRequiredBody(): Record<string, unknown> {
  return {
    error: "payment_required",
    message:
      "POST here with an x402 payment to run a scam check. Body: { url } | { emailText } | multipart screenshot.",
    scheme: "exact",
    price: `${x402.priceUsd} ${x402.assetName}`,
    network: x402.network,
  };
}

/** Read the payment proof from either the v2 or legacy header. */
export function readPaymentHeader(
  get: (name: string) => string | undefined,
): string | undefined {
  return get(PAYMENT_SIGNATURE_HEADER) ?? get(PAYMENT_LEGACY_HEADER);
}

/** Stable id derived from the proof (idempotency key). No network, no settlement. */
export function derivePaymentId(headerValue: string): string {
  return "pay_" + createHash("sha256").update(headerValue.trim()).digest("hex").slice(0, 32);
}

/** Decode a replayed payment header (base64 JSON or raw JSON). null if unparseable. */
export function parsePaymentPayload(headerValue: string): unknown | null {
  const v = headerValue.trim();
  try {
    const decoded = Buffer.from(v, "base64").toString("utf8");
    if (decoded && (decoded.trim().startsWith("{") || decoded.trim().startsWith("["))) {
      return JSON.parse(decoded);
    }
  } catch {
    /* fall through */
  }
  try {
    if (v.startsWith("{") || v.startsWith("[")) return JSON.parse(v);
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Verify (and in production, settle) a payment proof. Returns a PaymentContext on
 * success, null on failure. In production this performs on-chain settlement, so
 * the caller MUST check idempotency first if it persists jobs.
 */
export async function verifyPaymentAuthorization(
  headerValue: string,
  resourceUrl: string,
): Promise<PaymentContext | null> {
  const proof = headerValue.trim();
  if (proof.length < 16) return null;
  const paymentId = derivePaymentId(proof);

  if (isSandbox()) {
    return { paymentId, amountUsd: x402.priceUsd };
  }

  const payload = parsePaymentPayload(proof);
  if (payload === null) return null;

  const requirements = buildRequirements(resourceUrl);
  const result = await verifyAndSettle(payload, requirements);
  if (!result.ok) return null;

  return {
    paymentId,
    amountUsd: fromAtomic(result.amountAtomic ?? requirements.maxAmountRequired),
    payer: result.payer,
    transaction: result.transaction,
  };
}

/** Build the PAYMENT-RESPONSE header value (base64 JSON) returned on a settled call. */
export function buildPaymentResponse(pc: PaymentContext): string {
  const body = {
    status: isSandbox() ? "settled-sandbox" : "settled",
    amount: atomic(pc.amountUsd),
    transaction: pc.transaction ?? null,
    payer: pc.payer ?? null,
  };
  return Buffer.from(JSON.stringify(body)).toString("base64");
}

export function fromAtomic(atomicStr: string): number {
  try {
    return Number(BigInt(atomicStr)) / 10 ** x402.assetDecimals;
  } catch {
    return x402.priceUsd;
  }
}
