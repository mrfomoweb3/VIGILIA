import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildInspectRequest,
  inspect,
  parseReport,
  reportToSignal,
  type InspectionReport,
} from "../src/pipeline/inspect.ts";
import { GuardrailViolation, OtariBudgetError, type OtariClient } from "../src/otari.ts";
import type { ExtractedInput, Signal } from "../src/pipeline/types.ts";
import { deriveContext, enforceHardRules } from "../src/pipeline/reason.ts";

const extracted: ExtractedInput = {
  links: ["https://bit.ly/3xyz"],
  emailText: "Your account is locked. Verify now: https://bit.ly/3xyz",
  rawHeaders: null,
  senderDisplayName: null,
  senderAddress: null,
  urgencyCues: ["Verify now"],
  source: "email_text",
};

const baseReport: InspectionReport = {
  page_reachable: true,
  final_url: "https://secure-paypal-verify.top/login",
  asks_for: ["password"],
  brand_claimed: "PayPal",
  on_official_brand_domain: false,
  discovered_urls: ["https://secure-paypal-verify.top/login"],
  summary: "A PayPal-styled login form.",
};

function fakeClient(impl: () => Promise<unknown>): OtariClient {
  return { chat: impl } as unknown as OtariClient;
}

test("the inspect request declares fetch, code execution, a guardrail and the end user", () => {
  process.env.PUBLIC_BASE_URL = "https://vigilia.example.com";
  process.env.VIGILIA_MCP_TOKEN = "mcp-secret";
  const req = buildInspectRequest(extracted, "demo:abc");
  assert.deepEqual(req.tools, [{ type: "otari_web_fetch" }, { type: "otari_code_execution" }]);
  assert.equal(req.guardrails?.[0]?.mode, "block");
  assert.equal(req.user, "demo:abc");
  assert.equal(req.mcp_servers?.[0]?.url, "https://vigilia.example.com/mcp");
  assert.equal(req.mcp_servers?.[0]?.authorization_token, "mcp-secret");
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.VIGILIA_MCP_TOKEN;
});

test("parseReport keeps only the strict shape and drops junk", () => {
  const r = parseReport(
    'Sure! {"page_reachable": true, "asks_for": ["password","rm -rf"], "discovered_urls": ["javascript:alert(1)", "https://evil.top/x"], "on_official_brand_domain": "maybe", "summary": "ok"}',
  );
  assert.ok(r);
  assert.deepEqual(r.asks_for, ["password"]);
  assert.deepEqual(r.discovered_urls, ["https://evil.top/x"]);
  assert.equal(r.on_official_brand_domain, null);
  assert.equal(parseReport("no json here"), null);
});

test("a discovered domain that fails our own checks makes the signal flagged", async () => {
  const recheck = async (): Promise<Signal[]> => [
    { signal: "typosquat", result: "flagged", detail: "secure-paypal-verify.top imitates paypal.com" },
  ];
  const s = await reportToSignal(baseReport, extracted.links, recheck);
  assert.equal(s.signal, "page_inspection");
  assert.equal(s.result, "flagged");
  assert.match(s.detail, /secure-paypal-verify\.top/);
});

test("model claims alone can only reach 'suspicious', never 'flagged'", async () => {
  const recheck = async (): Promise<Signal[]> => [];
  const s = await reportToSignal(baseReport, extracted.links, recheck);
  assert.equal(s.result, "suspicious");
});

test("a page that asks for nothing is clean", async () => {
  const s = await reportToSignal(
    { ...baseReport, asks_for: [], on_official_brand_domain: null, discovered_urls: [], final_url: null },
    extracted.links,
    async () => [],
  );
  assert.equal(s.result, "clean");
});

test("a prompt-injection guardrail block becomes a flagged prompt_injection signal", async () => {
  const client = fakeClient(async () => {
    throw new GuardrailViolation("Input blocked by guardrail", "prompt-injection");
  });
  const signals = await inspect(extracted, { client });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].signal, "prompt_injection");
  assert.equal(signals[0].result, "flagged");

  // And the hard rules lift an LLM "SAFE" to SUSPICIOUS because of it.
  const ctx = deriveContext(signals);
  const { output } = enforceHardRules(
    { verdict: "SAFE", confidence: "high", explanation: "", recommendation: "" },
    ctx,
  );
  assert.equal(output.verdict, "SUSPICIOUS");
});

test("budget refusals propagate so the pipeline can tell the caller", async () => {
  const client = fakeClient(async () => {
    throw new OtariBudgetError("End-user budget exceeded", 429, "budget_exceeded");
  });
  await assert.rejects(inspect(extracted, { client }), OtariBudgetError);
});

test("other gateway failures degrade to an honest error signal", async () => {
  const client = fakeClient(async () => {
    throw new Error("socket hang up");
  });
  const signals = await inspect(extracted, { client });
  assert.equal(signals[0].result, "error");
});
