/**
 * Streamable HTTP transport with Bearer + Origin defenses.
 *
 *   - Bind to a specific interface (default: tailscale0's IP, resolved at startup).
 *   - Require Authorization: Bearer <mcp_bearer_token> on every request.
 *   - Reject requests whose Origin header is not in MCP_ALLOWED_ORIGINS
 *     (defense against DNS rebinding per MCP spec recommendations).
 */

import express from "express";
import os from "node:os";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import { loadCredentials } from "./auth.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function resolveBindHost(cfg: Config): string {
  if (cfg.mcpBindHost) return cfg.mcpBindHost;
  // Find tailscale0's IPv4 address, fall back to 127.0.0.1 if missing (dev).
  const ifaces = os.networkInterfaces();
  const ts = ifaces["tailscale0"];
  const v4 = ts?.find((i) => i.family === "IPv4");
  if (v4) return v4.address;
  console.error(
    "[http] tailscale0 not found; falling back to 127.0.0.1. " +
      "Set MCP_BIND_HOST explicitly to bind to a specific interface."
  );
  return "127.0.0.1";
}

export async function startHttpDaemon(
  cfg: Config,
  server: McpServer
): Promise<{ host: string; port: number }> {
  const creds = await loadCredentials(cfg);
  const expected = `Bearer ${creds.bearerToken}`;
  const host = resolveBindHost(cfg);
  const port = cfg.mcpBindPort;

  const app = express();
  app.use(express.json({ limit: "4mb" }));

  // Health endpoint — bypasses auth so you can curl it from a tailnet host
  // without rotating the bearer token. Returns no NAS state.
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, server: "synology-nas-mcp", version: "0.1.0" });
  });

  // Auth + Origin middleware applied to /mcp.
  const authMw: express.RequestHandler = (req, res, next) => {
    if (req.header("authorization") !== expected) {
      res.status(401).json({ error: "missing or invalid bearer token" });
      return;
    }
    const origin = req.header("origin") ?? "null";
    if (cfg.allowedOrigins.size > 0 && !cfg.allowedOrigins.has(origin)) {
      res
        .status(403)
        .json({ error: `origin '${origin}' not in MCP_ALLOWED_ORIGINS` });
      return;
    }
    next();
  };

  // One Streamable HTTP session per request (stateless mode). Simpler than
  // server-managed sessions; clients reconnect transparently.
  app.all("/mcp", authMw, async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  await new Promise<void>((resolve) =>
    app.listen(port, host, () => resolve())
  );
  console.error(`[http] listening on http://${host}:${port}/mcp`);
  return { host, port };
}
