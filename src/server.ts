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
// Official OKX Payment seller SDK — builds the 402 challenge, verifies the
// buyer's proof, and settles through the OKX facilitator (Broker).
import { paymentMiddleware, x402ResourceServer } from "@okxweb3/x402-express";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import type { Network } from "@okxweb3/x402-core/types";

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

// ---- x402 payment gating via the official OKX seller SDK ---------------------
// /api/check is the endpoint registered on-chain as an A2MCP service. The OKX
// paymentMiddleware turns any unpaid call into a conformant HTTP 402 carrying
// the PAYMENT-REQUIRED header (so it never 404s), verifies a buyer's payment
// proof, and settles through the OKX facilitator before the handler runs.
const facilitator = new OKXFacilitatorClient({
  apiKey: x402.okx.apiKey,
  secretKey: x402.okx.secretKey,
  passphrase: x402.okx.passphrase,
});
const resourceServer = new x402ResourceServer(facilitator).register(
  x402.network as Network,
  new ExactEvmScheme(),
);

// Gate both methods so an OKX review probe never 404s regardless of the verb it
// uses; both resolve to the same paid check below.
const checkAccepts = [
  {
    scheme: "exact",
    network: x402.network as Network,
    payTo: x402.payTo,
    price: x402.price,
  },
];
const okxPaymentMiddleware = paymentMiddleware(
  {
    "GET /api/check": {
      accepts: checkAccepts,
      description: "Scam / phishing check — verdict with evidence",
      mimeType: "application/json",
    },
    "POST /api/check": {
      accepts: checkAccepts,
      description: "Scam / phishing check — verdict with evidence",
      mimeType: "application/json",
    },
  },
  resourceServer,
);

// ---- Routes -----------------------------------------------------------------

// The OKX payment gate runs first for /api/check; unmatched routes (/, /api/demo,
// /api/health, static) pass straight through.
app.use(okxPaymentMiddleware);

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
// Payment is already verified + settled by okxPaymentMiddleware above; if control
// reaches these handlers, the call is paid. They just run the check.
app.get("/api/check", rateLimit, handleCheck);
app.post("/api/check", rateLimit, upload.single("screenshot"), handleCheck);

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
    x402: { network: x402.network, asset: x402.assetName },
  });
});
app.use(express.static(PUBLIC_DIR));

app.listen(PORT, () => {
  console.log(
    `Vigilia v${VERSION} on :${PORT} — /api/check x402-gated via OKX SDK ` +
      `(${x402.price} ${x402.assetName}, ${x402.network}, payTo ${
        x402.payTo || "UNSET"
      }); /api/demo free`,
  );
  if (!x402.configured) {
    console.warn(
      "⚠  OKX facilitator not fully configured — set OKX_API_KEY / OKX_SECRET_KEY / " +
        "OKX_PASSPHRASE and a payTo (X402_PAYTO_ADDRESS or WALLET_ADDRESS) to verify + settle payments.",
    );
  }
});

export { app };
