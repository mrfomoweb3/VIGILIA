#!/usr/bin/env node
// Otari setup + health check for Vigilia.
//
//   node scripts/otari-setup.mjs            # check only: models, tools, guardrails
//   node scripts/otari-setup.mjs --apply    # also create/update the verdict routing policy
//
// Reads OTARI_API_KEY and OTARI_BASE_URL from .env. --apply also needs
// OTARI_WORKSPACE_ID and an API key belonging to an organization owner/admin;
// if the gateway refuses, the script prints the policy to paste into the
// dashboard's Routing page instead.

import "dotenv/config";

const BASE = (process.env.OTARI_BASE_URL ?? "https://api.otari.ai/api/v1").replace(/\/+$/, "");
const KEY = (process.env.OTARI_API_KEY ?? "").trim();
const APPLY = process.argv.includes("--apply");

const POLICY_NAME = process.env.OTARI_VERDICT_POLICY ?? "vigilia-verdict";
const PRIMARY = process.env.OTARI_VERDICT_PRIMARY ?? "groq:openai/gpt-oss-120b";
const THRIFTY = process.env.OTARI_VERDICT_THRIFTY ?? "groq:openai/gpt-oss-20b";
const FALLBACK = process.env.OTARI_VERDICT_FALLBACK ?? "together:meta-llama/Llama-3.3-70B-Instruct-Turbo";

// Families whose weights are public. Used only to highlight candidates.
const OPEN_WEIGHT = /llama|qwen|gpt-oss|mistral|mixtral|gemma|deepseek|kimi|glm|phi|olmo|granite|nemotron|hermes/i;

if (!KEY) {
  console.error("OTARI_API_KEY is not set. Add it to .env first.");
  process.exit(1);
}

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, ok: res.ok, json };
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

section("Models");
const models = await call("GET", "/models");
if (models.ok) {
  const ids = (models.json?.data ?? []).map((m) => m.id).filter(Boolean);
  const open = ids.filter((id) => OPEN_WEIGHT.test(id));
  console.log(`${ids.length} models available, ${open.length} look open-weight:`);
  for (const id of open) console.log(`  ${id}`);
  const vision = open.filter((id) => /vision|scout|maverick|vl|llava|pixtral|gemma-3/i.test(id));
  if (vision.length) console.log(`Likely vision-capable: ${vision.join(", ")}`);
} else {
  console.log(`GET /models -> ${models.status}`, models.json);
}

section("Built-in tools");
const tools = await call("GET", "/tools");
if (tools.ok) {
  for (const t of tools.json?.data ?? tools.json?.tools ?? (Array.isArray(tools.json) ? tools.json : [])) {
    console.log(`  ${t.type ?? t.name}: ${t.available ? "available" : `NOT available (${t.reason ?? "?"})`}`);
  }
} else {
  console.log(`GET /tools -> ${tools.status}`, tools.json);
}

section("Guardrail profiles");
const profiles = await call("GET", "/tool-settings/guardrails/profiles");
console.log(profiles.ok ? JSON.stringify(profiles.json, null, 2) : `-> ${profiles.status} ${JSON.stringify(profiles.json)}`);

const spec = {
  select: [
    { when: { budget_used_pct: { gte: 80 } }, target: THRIFTY },
    { default: PRIMARY },
  ],
  on_failure: [FALLBACK],
};

section(`Routing policy "${POLICY_NAME}"`);
console.log(JSON.stringify(spec, null, 2));
if (APPLY) {
  const workspaceId = (process.env.OTARI_WORKSPACE_ID ?? "").trim();
  if (!workspaceId) {
    console.log("Set OTARI_WORKSPACE_ID to apply it over the API.");
  } else {
    const res = await call("POST", "/organizations/me/routing-policies", {
      name: POLICY_NAME,
      spec,
      workspace_id: workspaceId,
    });
    if (res.ok) {
      console.log(`Saved. Set OTARI_VERDICT_MODEL=${POLICY_NAME} in .env.`);
    } else {
      console.log(`The API refused (${res.status}): ${JSON.stringify(res.json)}`);
      console.log("Create it in the dashboard instead: Routing -> New policy, with the spec above.");
    }
  }
}

section("Explain");
const explain = await call("POST", "/routing/policies/explain", { name: POLICY_NAME, spec });
console.log(explain.ok ? JSON.stringify(explain.json, null, 2) : `-> ${explain.status} ${JSON.stringify(explain.json)}`);
