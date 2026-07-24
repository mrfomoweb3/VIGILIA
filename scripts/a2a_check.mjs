#!/usr/bin/env node
// Vigilia A2A task fulfiller.
//
// When Vigilia (ASP #7072) is delegated a scam-check task over OKX A2A, the
// spawned session runs THIS script to do the work. It reuses the already-live
// endpoint, so an A2A verdict is byte-identical to what the web app returns —
// one engine, one source of truth.
//
// Usage (exactly one input):
//   node scripts/a2a_check.mjs --url "https://suspicious-link.example"
//   node scripts/a2a_check.mjs --email "raw pasted email text..."
//   node scripts/a2a_check.mjs --screenshot /path/to/image.png
//
// Output: prints a JSON object to stdout:
//   { ok, verdict, confidence, evidence[], explanation, recommendation,
//     deliveryMessage, checkId }
// `deliveryMessage` is the plain-language text to send to the buyer.
// Exit code 0 on a produced verdict, 1 on a usage/service error.

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const ENDPOINT =
  process.env.VIGILIA_ENDPOINT ??
  "https://vigilia-production-f7de.up.railway.app/api/check";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") out.url = argv[++i];
    else if (a === "--email") out.email = argv[++i];
    else if (a === "--screenshot") out.screenshot = argv[++i];
  }
  return out;
}

function fail(message) {
  console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}

/** Human-readable one-liner per signal, for the delivery message. */
function evidenceLine(e) {
  return `- ${e.signal} [${e.result}]: ${e.detail}`;
}

function buildDeliveryMessage(r) {
  const header = {
    SAFE: "VERDICT: SAFE",
    SUSPICIOUS: "VERDICT: SUSPICIOUS",
    CONFIRMED_SCAM: "VERDICT: CONFIRMED SCAM",
  }[r.verdict] ?? `VERDICT: ${r.verdict}`;

  return [
    `${header} (confidence: ${r.confidence})`,
    "",
    r.explanation,
    "",
    "Evidence:",
    ...r.evidence.map(evidenceLine),
    "",
    `Recommendation: ${r.recommendation}`,
    "",
    `Checked by Vigilia — check id ${r.checkId}. Deterministic security checks; the AI only explains the verdict.`,
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const modes = ["url", "email", "screenshot"].filter((k) => args[k]);
  if (modes.length !== 1) {
    fail(
      "Provide exactly one of --url, --email, or --screenshot. " +
        `Got: ${modes.length === 0 ? "none" : modes.join(", ")}.`,
    );
  }

  let res;
  try {
    if (args.screenshot) {
      const buf = await readFile(args.screenshot);
      const name = basename(args.screenshot);
      const ext = name.split(".").pop()?.toLowerCase();
      const type =
        ext === "png" ? "image/png"
        : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
        : ext === "gif" ? "image/gif"
        : ext === "webp" ? "image/webp"
        : "application/octet-stream";
      const form = new FormData();
      form.append("screenshot", new Blob([buf], { type }), name);
      res = await fetch(ENDPOINT, { method: "POST", body: form });
    } else {
      const body = args.url ? { url: args.url } : { emailText: args.email };
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
  } catch (err) {
    fail(`Could not reach the Vigilia service: ${err.message}`);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.verdict) {
    fail(
      `Vigilia service returned an error (HTTP ${res.status}): ` +
        (data?.error ?? "unexpected response"),
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        verdict: data.verdict,
        confidence: data.confidence,
        evidence: data.evidence,
        explanation: data.explanation,
        recommendation: data.recommendation,
        checkId: data.checkId,
        deliveryMessage: buildDeliveryMessage(data),
      },
      null,
      2,
    ),
  );
}

main();
