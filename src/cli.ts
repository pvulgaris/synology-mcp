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

async function main() {
  const cmd = process.argv[2] ?? "serve";
  switch (cmd) {
    case "serve":
      await serveStdio();
      break;
    case "daemon":
      await serveHttp();
      break;
    default:
      console.error(
        `Unknown command: ${cmd}. Use 'serve' (stdio) or 'daemon' (HTTP).`
      );
      process.exit(2);
  }
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
