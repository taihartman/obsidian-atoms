# Ask brain P0 dogfood — protocol spike

**Date:** 2026-07-27  
**Issue:** #112 · **Plan:** `docs/plans/2026-07-27-001-feat-ask-brain-remote-mcp-plan.md`  
**Label:** AE1-**protocol** (fixture seed), not full product Process→mirror→ask.

## Automated evidence (CI-local)

```bash
cd plus-service && npm test
# includes: store-ask, http-ask-mirror, http-ask-mcp, http-ask-oauth (full PKCE → tools/call)
```

OAuth e2e proves: PRM/AS metadata → authorize → magic-link → consent → token → MCP `search_atoms`.

## Manual phone Claude (human / after deploy)

1. Deploy plus-service with `ATOMS_ASK_MIRROR_KEY` + public `PUBLIC_BASE_URL`.
2. Seed fixtures: `PLUS_SESSION=sess_… npm run ask:seed` (or Settings Sync after P1).
3. Claude mobile → Connectors → custom URL `https://plus.taihartman.com/mcp`.
4. Complete OAuth (same browser for magic-link).
5. Ask a question only answerable from seeded bodies (e.g. tea preference).
6. Expect `[[title]]` citations + body quotes.
7. Wipe mirror → tools empty / admit unknown.

**Cookie note:** Open magic-link in the **same browser** as the authorize tab.

## Status

- [x] Automated OAuth + MCP tool path  
- [ ] Live phone Claude against production (fill after deploy)  
- [ ] Screenshots under `docs/qa/screenshots/ask-brain/` when phone pass lands  
