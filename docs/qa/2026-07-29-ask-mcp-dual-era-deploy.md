# QA — Ask MCP dual-era deploy (Bar A)

**Date:** 2026-07-29  
**PR:** #189 · **Issue:** #188  
**Fly:** `atoms-plus` **v33** · image `deployment-01KYQ5KDP1BHW7PT4BWQRVJ4FF`  
**Rollback:** previous complete release **v32**

## Automated / curl (agent)

| Check | Result |
|-------|--------|
| `GET /health` | `{"ok":true,"service":"atoms-plus"}` |
| `POST /mcp` unauth (modern headers) | **401** + `WWW-Authenticate` resource_metadata + **`cache-control: private, no-store`** (new handler) |
| `POST /mcp` Bearer `sess_fake` | **401** |
| AS metadata | `authorization_response_iss_parameter_supported: true`, CIMD + `none`, issuer `https://plus.tryatoms.app` |
| PRM | resource `https://plus.tryatoms.app/mcp` |
| `GET /oauth/authorize` (Claude redirect) | **200** HTML |

## CI (pre-deploy)

`cd plus-service && npm test` — **176 pass** including `mcp-modern-era.test.mjs` (legacy init + modern tools/list/call without initialize).

## Human dogfood still required (AE5a + authenticated AE9)

Agent cannot complete Plus magic-link OAuth non-interactively in production (`DOGFOOD_AUTO_GRANT=0`).

**You (human):**

1. **Claude** — custom connector → `https://plus.tryatoms.app/mcp` → OAuth → ask something that triggers `search_atoms` / `fetch_atom`.
2. **ChatGPT** — same URL → tools/list shows titles; search works.
3. Optional authenticated modern probe (after you have a short-lived `mcp_` token from connector/debug):

```bash
# Replace $MCP_TOKEN
curl -sS -X POST https://plus.tryatoms.app/mcp \
  -H "authorization: Bearer $MCP_TOKEN" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'mcp-protocol-version: 2026-07-28' \
  -H 'mcp-method: tools/list' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"ae9","version":"0"},"io.modelcontextprotocol/clientCapabilities":{}}}}'
# Expect tools with titles; create_atom destructiveHint true; optional ttlMs/cacheScope
```

## Verdict

- **Deploy + public auth surface:** green  
- **Authenticated dual-era on prod:** pending human connector dogfood  
- **Merge:** OK after human AE5a green (or mark ready and dogfood in parallel if preferred)
