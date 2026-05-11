#!/usr/bin/env node

/**
 * synology-nas-mcp — entry point.
 *
 * Subcommands:
 *   serve     Run MCP over stdio (for `claude mcp add` / claude.json or local dev).
 *   daemon    Run MCP over Streamable HTTP on the configured interface/port.
 *
 * Required env (both modes):
 *   DSM_BASE_URL, DSM_OP_VAULT, OP_SERVICE_ACCOUNT_TOKEN
 * Required env (daemon only):
 *   MCP_BIND_HOST / MCP_BIND_PORT optional; allowlisted Origin / bearer in 1Password.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { startHttpDaemon } from "./http.js";

async function serveStdio() {
  const cfg = loadConfig();
  if (!cfg.tlsRejectUnauthorized) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
  const server = createServer(cfg);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[serve] synology-nas-mcp ready on stdio");
}

async function serveHttp() {
  const cfg = loadConfig();
  if (!cfg.tlsRejectUnauthorized) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
  const server = createServer(cfg);
  await startHttpDaemon(cfg, server);
}

/**
 * Bridge subcommand: a tiny stdio MCP server that proxies to the HTTP daemon.
 * Use this from Claude Desktop, which only accepts stdio MCP entries — the
 * bridge runs on your Mac, the daemon runs on the NAS.
 *
 * Required env (set in claude_desktop_config.json under "env"):
 *   MCP_BRIDGE_URL    e.g. http://nas.local:8765/mcp
 *   MCP_BRIDGE_TOKEN  the bearer token (the same one used by claude mcp add)
 */
async function bridge() {
  const url = process.env.MCP_BRIDGE_URL;
  const token = process.env.MCP_BRIDGE_TOKEN;
  if (!url || !token) {
    console.error(
      "[bridge] missing MCP_BRIDGE_URL or MCP_BRIDGE_TOKEN env var"
    );
    process.exit(2);
  }
  const upstream = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const downstream = new StdioServerTransport();

  // Bidirectional message forwarding.
  upstream.onmessage = (msg) => downstream.send(msg);
  downstream.onmessage = (msg) => upstream.send(msg);
  upstream.onclose = () => downstream.close();
  downstream.onclose = () => upstream.close();
  upstream.onerror = (err) => console.error("[bridge] upstream:", err);
  downstream.onerror = (err) => console.error("[bridge] downstream:", err);

  await Promise.all([upstream.start(), downstream.start()]);
}

async function main() {
  const cmd = process.argv[2] ?? "serve";
  switch (cmd) {
    case "serve":
      await serveStdio();
      break;
    case "daemon":
      await serveHttp();
      break;
    case "bridge":
      await bridge();
      break;
    default:
      console.error(
        `Unknown command: ${cmd}. Use 'serve' (stdio direct), 'daemon' (HTTP), or 'bridge' (stdio→HTTP proxy).`
      );
      process.exit(2);
  }
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
