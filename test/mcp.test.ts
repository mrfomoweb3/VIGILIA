import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handleMcp, MCP_PATH } from "../src/mcp.ts";

async function withServer(fn: (base: string) => Promise<void>) {
  process.env.VIGILIA_MCP_TOKEN = "test-token";
  const app = express();
  app.use(express.json());
  app.all(MCP_PATH, (req, res) => void handleMcp(req, res));
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    delete process.env.VIGILIA_MCP_TOKEN;
  }
}

test("MCP endpoint lists Vigilia's checkers and runs the look-alike check", async () => {
  await withServer(async (base) => {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}${MCP_PATH}`), {
        requestInit: { headers: { Authorization: "Bearer test-token" } },
      }),
    );
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ["check_domain_age", "check_lookalike_domain", "check_safe_browsing"],
    );

    const res = await client.callTool({
      name: "check_lookalike_domain",
      arguments: { targets: ["paypa1.com"] },
    });
    const payload = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    assert.equal(payload.result, "flagged");
    await client.close();
  });
});

test("MCP endpoint refuses callers without the token", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}${MCP_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 401);
  });
});
