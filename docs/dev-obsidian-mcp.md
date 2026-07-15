# Dev: Obsidian MCP (Local REST API)

Grok (and other agents) drive the **throwaway vault** via the [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin’s **built-in MCP** server. No third-party `mcp-obsidian` bridge required.

## What you get

| Capability | Use for this project |
|---|---|
| Read/write/list vault files | Seed fake dailies; inspect atoms/markers |
| Search / tags | Fixture checks |
| **Execute commands** | Run AI Linker spikes without the palette |
| Active / periodic notes | Later U3+ verification |

**Limits:** plugin is **desktop-only**. Does **not** read SecretStorage secrets (your Anthropic key stays in Obsidian). MCP auth is a **separate** Local REST API key.

## One-time setup (you)

1. Open vault:  
   `/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault`
2. Settings → Community plugins → enable **Local REST API** (already installed under `.obsidian/plugins/obsidian-local-rest-api/`).
3. Settings → **Local REST API**:
   - Copy the **API key**
   - Enable **Non-encrypted (HTTP) server** (port **27123**) — avoids self-signed TLS pain in Grok
4. In a shell used by Grok / your terminal profile:

```bash
export OBSIDIAN_REST_API_KEY='paste-the-local-rest-api-key-here'
```

5. Restart Grok (or refresh MCP) so project config loads.

### Add to Grok (if not already)

Project config lives at `.grok/config.toml` (uses `${OBSIDIAN_REST_API_KEY}`).

```bash
# From repo root — user-scoped alternative if you prefer:
grok mcp add --transport http obsidian http://127.0.0.1:27123/mcp/ \
  --header "Authorization: Bearer ${OBSIDIAN_REST_API_KEY}"
```

Prefer **project** scope (already committed template) so only this repo gets Obsidian tools.

### Sanity check

With Obsidian open on the test vault:

```bash
curl -s http://127.0.0.1:27123/
# with key:
curl -s -H "Authorization: Bearer $OBSIDIAN_REST_API_KEY" http://127.0.0.1:27123/vault/
```

Then in Grok: search tools for `obsidian` / `command_execute` / `vault_read`.

## Agent playbook (test vault only)

1. Confirm vault is the throwaway one (list root; expect `Welcome.md`, no real personal notes).
2. After AI Linker key is set in Obsidian SecretStorage, execute:
   - `Spike: probe SecretStorage read/write`
   - `Spike: classify hardcoded capture`
   - `Spike: measure cache + per-day batch fork (KTD3)`
   via MCP `command_execute` (command ids from `command_list`).
3. Never enable auto-run or write path against a real vault through MCP.

## Security

- Local REST API key grants **full vault read/write + command execution** while Obsidian is open.
- Keep it in env / shell profile — **not** committed. `.env` is gitignored.
- Only open the test vault when agents are connected.
