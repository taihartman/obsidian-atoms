# Ask ChatGPT connector dogfood — 0.6.41 / #119

**Vault:** `test_vault/` only. **Depends on:** plus-service deployed with ChatGPT OAuth allowlist.

## Checklist

| ID | Steps | Pass? |
|---|---|---|
| AE1 | OAuth with ChatGPT redirect completes (or unit tests green) | |
| AE2 | Evil redirect still rejected | |
| AE3 | Settings show ChatGPT steps + OpenAI privacy line | |
| AE4 | Claude connector still works | |
| AE5 | Human: ChatGPT tool call returns atom body from test_vault mirror | |

## Steps (AE5)

1. Enable Ask + privacy ack; Sync now on test_vault  
2. Copy MCP connector URL from Settings  
3. ChatGPT → Developer mode → add connector → OAuth with Plus email  
4. Ask a fact only present in a mirrored atom  
5. Confirm `search_atoms` / `fetch_atom` answer  

## Residual

- Transport/SSE failures → new issue (stateless POST is intentional)  
- `private_key_jwt` only if `none` fails in live ChatGPT  
