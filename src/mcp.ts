// Vigilia's deterministic checkers, exposed as an MCP server.
//
// Otari connects to this endpoint (inline `mcp_servers` on the investigator
// call) so the page-inspection model can run the SAME checks Vigilia's verify
// stage uses on domains it only discovers while inspecting a page: redirect
// hops, form-submission targets, links hidden in obfuscated markup.
//
// Read-only by design: every tool is a lookup. Nothing here writes, spends or
// reaches anything private, so a hostile page steering the model can at worst
// make it look up another domain.

import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { checkDomainAge } from "./pipeline/verify/domainAge.js";
import { checkTyposquat } from "./pipeline/verify/typosquat.js";
import { checkSafeBrowsing } from "./pipeline/verify/safeBrowsing.js";
import type { Signal } from "./pipeline/types.js";

export const MCP_PATH = "/mcp";

/** Bearer token Otari presents when it connects. Empty = endpoint disabled. */
export function mcpToken(): string {
  return (process.env.VIGILIA_MCP_TOKEN ?? "").trim();
}

/** Public URL Otari reaches this server at, e.g. https://vigilia.up.railway.app/mcp. */
export function mcpPublicUrl(): string | null {
  const base = (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return base ? `${base}${MCP_PATH}` : null;
}

/** Accept a bare domain or a URL; always hand the checkers an absolute URL. */
export function toUrl(target: string): string {
  const t = target.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

const MAX_TARGETS = 5;
const targetsShape = {
  targets: z
    .array(z.string().min(3).max(2048))
    .min(1)
    .max(MAX_TARGETS)
    .describe("Domains or URLs to check, e.g. ['paypa1-secure.com']"),
};

function asResult(signal: Signal) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ result: signal.result, detail: signal.detail, meta: signal.meta ?? {} }),
      },
    ],
  };
}

export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "vigilia-checkers", version: "1.0.0" });

  server.registerTool(
    "check_domain_age",
    {
      title: "Domain age (WHOIS)",
      description:
        "Look up when each domain was registered. Domains registered days or weeks ago are a common phishing tell.",
      inputSchema: targetsShape,
    },
    async ({ targets }) => asResult(await checkDomainAge(targets.map(toUrl))),
  );

  server.registerTool(
    "check_lookalike_domain",
    {
      title: "Look-alike domain",
      description:
        "Check whether domains imitate a known brand using swapped characters (rn for m, 1 for l), Cyrillic homoglyphs or extra words.",
      inputSchema: targetsShape,
    },
    async ({ targets }) => asResult(checkTyposquat(targets.map(toUrl))),
  );

  server.registerTool(
    "check_safe_browsing",
    {
      title: "Google Safe Browsing",
      description: "Check URLs against Google Safe Browsing's lists of known phishing and malware sites.",
      inputSchema: targetsShape,
    },
    async ({ targets }) => asResult(await checkSafeBrowsing(targets.map(toUrl))),
  );

  return server;
}

/**
 * Express handler. Stateless streamable HTTP: a fresh server and transport per
 * request, so concurrent checks never share state.
 */
export async function handleMcp(req: Request, res: Response): Promise<void> {
  const token = mcpToken();
  if (!token || req.headers.authorization !== `Bearer ${token}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).set("Allow", "POST").json({ error: "method not allowed" });
    return;
  }

  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
