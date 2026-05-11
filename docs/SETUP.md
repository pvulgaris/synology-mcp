# Setup

Pre-reqs you do once. Most are clickthrough in DSM; the only command-line work is the final container build.

## 1. DSM packages

In DSM → Package Center, install:

- **Container Manager** (Synology's Docker frontend).
- **Tailscale** (official Synology package). Sign in to your tailnet. After sign-in, SSH or DSM Terminal: `ifconfig tailscale0` should show an IPv4 address — that's what the MCP HTTP server will bind to.

## 2. Dedicated DSM user

DSM → Control Panel → User & Group → Create.

| Setting | Value |
|---|---|
| Username | `claude-mcp` |
| Description | "MCP server account; managed by 1Password" |
| Email | (leave blank) |
| Password | strong random, captured into 1Password (next step) |
| Disallow password change | yes |
| Password never expires | yes |
| Allow this user to access | Package Center, Security Advisor, Control Panel, Resource Monitor — no others |
| Application permissions | Deny: File Station, all file services |
| User group | `users` only (NOT `administrators`) |
| 2-Factor Authentication | enable; capture the TOTP secret to 1Password |
| Speed limit | leave default |

DSM privileges are app-scoped, not action-scoped — there is no "Package Center read-only." Granting Package Center access enables install/uninstall. The MCP server constrains that further: it hard-refuses DSM-self updates and any operation outside the registered tool list.

Verify the user cannot SSH in: `ssh claude-mcp@nas.local` should fail (SSH access requires the `administrators` group on DSM).

## 3. 1Password item + service account

In 1Password:

1. Create item **"Synology DSM — claude-mcp"** in a vault you don't share. Fields:
   - `password` — the DSM password set above
   - `totp` — the TOTP **secret** (not a generated code; the raw base32 string DSM showed when you enabled 2FA)
   - `mcp_bearer_token` — generate a random 32-byte hex string: `openssl rand -hex 32`
2. Create a **service account** scoped read-only to the vault containing that item. Capture the service account token; you'll set it as `OP_SERVICE_ACCOUNT_TOKEN` on the container project.

## 4. Tailscale ACL

In the Tailscale admin console → Access Controls, restrict TCP :8765 on the NAS so only your Mac(s) and phone can hit it:

```jsonc
"acls": [
  // ... your existing rules ...
  {
    "action": "accept",
    "src":    ["<your-user-tag-or-email>"],
    "dst":    ["nas.local:8765"]
  }
]
```

If your tailnet uses the default open ACL ("everyone can talk to everyone"), add a `tag:nas` and restrict `*` → `tag:nas:*` so only your devices reach the NAS.

## 5. Optional but useful: DSM notification email

DSM → Control Panel → Notification → Email — point at your Gmail account. When packages have updates, DSM emails you. Set up a Gmail filter to label those messages (e.g., `synology/updates`) so Claude can find them via the Gmail MCP tools.

## 6. Container build + run

On the NAS (via SSH as your normal admin user, or via File Station upload):

```sh
mkdir -p /volume1/docker/synology-nas-mcp/audit
cd /volume1/docker
git clone https://github.com/pvulgaris/synology-nas-mcp.git
```

In DSM → Container Manager → Project → Create:

- **Path**: `/volume1/docker/synology-nas-mcp`
- **Source**: "Create docker-compose.yml" — paste `synology.compose.yml` contents, OR upload the file.
- **Environment variables** (project-level — set them here, not in the compose file):
  - `OP_SERVICE_ACCOUNT_TOKEN` = (the service-account token from step 3)
  - `DSM_BASE_URL` = `https://localhost:5001`
  - `DSM_OP_VAULT` = the 1Password vault name from step 3
  - (anything else from the compose file's optional list, if you want to override)

Click **Build** → **Run**. Container Manager builds the image, starts the container.

## 7. Verify

From a Mac on the tailnet (read the bearer token via `op read "op://<vault>/Synology DSM — claude-mcp/mcp_bearer_token"`):

```sh
TOKEN=$(op read "op://<vault>/Synology DSM — claude-mcp/mcp_bearer_token")
curl -i -H "Authorization: Bearer $TOKEN" http://nas.local:8765/healthz
# expect: 200 OK {"ok":true,"server":"synology-nas-mcp","version":"0.1.0"}

curl -i -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
     http://nas.local:8765/mcp
# expect: a tools list including nas_status, nas_packages_list, ...
```

From outside the tailnet, the same curl times out (no LAN binding).
From a tailnet device not in the ACL allowlist, same curl times out at the ACL layer.

## 8. Wire up Claude

`~/Library/Application Support/Claude/claude_desktop_config.json` — add under `mcpServers`:

```json
"synology": {
  "type": "http",
  "url": "http://nas.local:8765/mcp",
  "headers": { "Authorization": "Bearer <paste token>" }
}
```

Claude Code CLI (one Mac):
```sh
TOKEN=$(op read "op://<vault>/Synology DSM — claude-mcp/mcp_bearer_token")
claude mcp add synology http://nas.local:8765/mcp --header "Authorization: Bearer $TOKEN"
```

Restart Claude Desktop / Claude Code. Tools `mcp__synology__*` should appear.

## Uninstall, in reverse

To remove the integration completely:

1. Remove the `synology` entry from `claude_desktop_config.json` and any Claude Code MCP registration (`claude mcp remove synology`).
2. Container Manager → stop + delete the `synology-nas-mcp` project.
3. `rm -rf /volume1/docker/synology-nas-mcp` (this deletes the audit log too — copy it out first if you want to keep it).
4. Tailscale ACL → remove the `:8765` rule you added.
5. DSM → Control Panel → User & Group → delete `claude-mcp`.
6. 1Password → delete the item and revoke the service account.
