// Vigilia — Express app: static landing page + the two-endpoint API.

import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runCheck, PipelineError, type CheckInput } from "./pipeline/index.js";
import { AnthropicLLMClient } from "./pipeline/reason.js";
import { checkRateLimit } from "./ratelimit.js";
import { snapshot } from "./budget.js";
import { MODEL, guardrails, x402 } from "./config.js";
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  buildPaymentRequired,
  buildPaymentResponse,
  paymentRequiredBody,
  readPaymentHeader,
  verifyPaymentAuthorization,
} from "./x402/x402.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");

const PORT = Number(process.env.PORT ?? 3000);
const PAYMENTS_ENABLED = process.env.PAYMENTS_ENABLED === "true";
const PRICE_PER_CHECK_USDT = process.env.PRICE_PER_CHECK_USDT ?? "0.2";
const VERSION = "1.0.0";

const app = express();

// Railway (and every PaaS) puts a reverse proxy in front of the app. Without
// this, req.ip is the proxy's address — so every visitor would share a single
// rate-limit bucket, letting one caller lock everyone else out. Trusting the
// first hop makes req.ip the real client from X-Forwarded-For.
app.set("trust proxy", 1);

app.use(express.json({ limit: "256kb" }));

// Screenshot upload: in-memory, 5 MB cap, single file field "screenshot".
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Shared LLM client (reused across requests).
const llm = new AnthropicLLMClient();

// ---- x402 payment gating (A2MCP marketplace endpoint) -----------------------
// /api/check is the endpoint registered on-chain as an A2MCP service. Per the
// x402 protocol it must NEVER 404: any unpaid call (including a GET from a
// browser, an OKX review probe, or x402 discovery) gets a conformant 402
// carrying the PAYMENT-REQUIRED challenge. A call with a valid payment proof
// runs the check and returns 200 + PAYMENT-RESPONSE.

/** Absolute URL of this resource, as advertised in the challenge. */
function resourceUrl(req: Request): string {
  const base =
    process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ??
    `${req.protocol}://${req.get("host")}`;
  return `${base}/api/check`;
}

/** Send the 402 challenge (header + human-readable body). */
function sendPaymentRequired(req: Request, res: Response) {
  res.setHeader(PAYMENT_REQUIRED_HEADER, buildPaymentRequired(resourceUrl(req)));
  return res.status(402).json(paymentRequiredBody());
}

// ---- Routes -----------------------------------------------------------------

app.get("/api/health", (_req, res) => {
  const spend = snapshot();
  res.json({
    status: "ok",
    version: VERSION,
    model: MODEL,
    budget: {
      day: spend.day,
      calls: spend.calls,
      spentUsd: spend.spentUsd,
      budgetUsd: spend.budgetUsd,
      remainingUsd: spend.remainingUsd,
      llmEnabled: guardrails.llmEnabled,
      visionEnabled: guardrails.visionEnabled,
    },
  });
});

/**
 * Per-IP rate limit on the only endpoint that spends money. Without this a
 * single script could drain the API balance on a public deploy.
 */
function rateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const result = checkRateLimit(ip);
  res.setHeader("X-RateLimit-Remaining", String(result.remaining));
  if (!result.allowed) {
    res.setHeader("Retry-After", String(result.retryAfterSec));
    return res.status(429).json({
      error: `Too many checks from this address. Try again in ${Math.ceil(
        result.retryAfterSec / 60,
      )} minute(s).`,
    });
  }
  return next();
}

/** Shared check handler — used by both the paid and the free-demo route. */
async function handleCheck(req: Request, res: Response) {
  try {
    const input: CheckInput = {};

    if (req.file) {
      input.screenshot = { buffer: req.file.buffer, mimetype: req.file.mimetype };
    } else {
      const body = req.body ?? {};
      if (typeof body.url === "string") input.url = body.url;
      if (typeof body.emailText === "string") input.emailText = body.emailText;
    }

    if (!input.screenshot && !input.url && !input.emailText) {
      return res.status(400).json({ error: "No link or email content found in input." });
    }

    const result = await runCheck(input, { llm });
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof PipelineError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("Unhandled check error:", err);
    return res
      .status(500)
      .json({ error: "Something went wrong running the check. Please try again." });
  }
}

// ---- /api/check — the A2MCP endpoint registered on-chain (x402-gated) --------

// Discovery/probe. An A2MCP resource must never 404: a GET returns the same
// conformant 402 challenge that OKX's review probe and x402 discovery expect.
app.get("/api/check", (req, res) => sendPaymentRequired(req, res));

app.post(
  "/api/check",
  rateLimit,
  upload.single("screenshot"),
  async (req: Request, res: Response) => {
    const proof = readPaymentHeader((n) => req.header(n));
    if (!proof) return sendPaymentRequired(req, res);

    const payment = await verifyPaymentAuthorization(proof, resourceUrl(req));
    if (!payment) {
      res.setHeader(PAYMENT_REQUIRED_HEADER, buildPaymentRequired(resourceUrl(req)));
      return res.status(402).json({
        error: "payment_invalid",
        message: "Payment could not be verified. Retry with a fresh payment.",
      });
    }

    res.setHeader(PAYMENT_RESPONSE_HEADER, buildPaymentResponse(payment));
    return handleCheck(req, res);
  },
);

// ---- /api/demo — free public demo powering the landing page ------------------
// Same engine, no payment. Protected by the per-IP rate limit and the daily
// budget cap so a public free endpoint can't drain the API balance.
app.post("/api/demo", rateLimit, upload.single("screenshot"), handleCheck);

// Multer / body errors (e.g. file too large) rendered as clean 400s.
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    const msg =
      err.code === "LIMIT_FILE_SIZE"
        ? "Screenshot is too large. Maximum size is 5 MB."
        : "Could not process the uploaded file.";
    return res.status(400).json({ error: msg });
  }
  if (err) {
    console.error("Unhandled error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
  return next();
});

// ---- Static landing page ----------------------------------------------------
// Inject the configured price into index.html at request time so the page and
// the config never drift.
app.get("/", (_req, res) => {
  res.sendFile(join(PUBLIC_DIR, "index.html"));
});
app.get("/api/config", (_req, res) => {
  res.json({
    pricePerCheckUsdt: PRICE_PER_CHECK_USDT,
    paymentsEnabled: PAYMENTS_ENABLED,
    x402: { network: x402.network, mode: x402.mode },
  });
});
app.use(express.static(PUBLIC_DIR));

app.listen(PORT, () => {
  console.log(
    `Vigilia v${VERSION} on :${PORT} — /api/check x402-gated ` +
      `(${x402.mode}, ${x402.priceUsd} ${x402.assetName}, ${x402.network}, payTo ${
        x402.payTo || "UNSET"
      }); /api/demo free`,
  );
});

export { app };
