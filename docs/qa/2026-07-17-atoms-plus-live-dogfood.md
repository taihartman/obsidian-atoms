# Live dogfood — Atoms Plus (agent-driven)

**Date:** 2026-07-17  
**Branch:** `feat/atoms-plus-managed-filing`  
**Driver:** agent (CLI + HTTP), not full human phone

---

## Verdict

| Flow | Result |
|------|--------|
| **Plus service HTTP** (auth → me → classify fail refund → top-up) | ✅ Automated `plus-service/test/http-dogfood.test.mjs` (7/7 with store) |
| **Plugin install + reload** into test vault | ✅ `npm run build` + `install-to-vault.sh` |
| **Seed past dailies** | ✅ `npm run seed:vault` |
| **Obsidian CLI** open home / list / process / dry-run / auto-run-status | ✅ Commands **executed** |
| **BYOK Process write path** (new atoms this run) | ⚠️ Commands ran; **no new Atoms/** mtimes (key in SecretStorage likely missing/invalid — `data.json` has secret id `testkey2` only) |
| **Plus path inside Obsidian** (session → Process via proxy) | ❌ **Not completed** — cannot inject device-local `sess_` via CLI (no eval/localStorage API) |
| **Settings UI** (magic link, paste session, meters absent) | ❌ **Not driven** (needs human or UI automation) |

**Bottom line:** Service + install + CLI command surface dogfooded. **In-app Plus session + live AI Process** still needs a human (or a dogfood CLI hook). BYOK Process did not prove a successful network write this session.

---

## What I ran

```bash
npm run build
./scripts/install-to-vault.sh          # → test_vault/test vault, reloaded atoms
npm run seed:vault
# plus-service
DOGFOOD_AUTO_GRANT=1 PORT=8787 npm start
# Obsidian CLI (vault="test vault")
atoms:open-home
atoms:list-unprocessed-captures
atoms:dry-run-preview
atoms:process-unprocessed
atoms:auto-run-status
atoms:test-connection
# automated HTTP dogfood
cd plus-service && node --test test/http-dogfood.test.mjs test/store.test.mjs  # 7 pass
```

Plugin `data.json` set: `plusBaseUrl: "http://127.0.0.1:8787"` for human follow-up.

---

## Flows covered (service)

1. Magic link request → token in logs with **correct PORT** in URL  
2. Exchange → trialing + remaining 150  
3. Forged session → **401**  
4. Classify without Anthropic key → **503** + **remaining still 150** (refund)  
5. Top-up → remaining increases  
6. No-rollover unit coverage  

## Flows not covered (need you)

1. Settings → paste verified session → home shows Plus-ready (not Try Plus)  
2. Process with Plus session + real `ANTHROPIC_API_KEY` on service  
3. Exhaust 150 → **Monthly Limit Reached** / **Not Now** quieter card  
4. BYOK-only Process with a known-good SecretStorage key  

### 5-minute human finish

```bash
cd plus-service && ANTHROPIC_API_KEY=sk-… DOGFOOD_AUTO_GRANT=1 npm start
```

1. Open **test vault** in Obsidian  
2. Settings → Atoms Plus → URL `http://127.0.0.1:8787`  
3. Email → Send Magic Link → open console link → paste `sess_` → **Save Session** (must succeed only if service accepts)  
4. Home: should not show Try Plus if session active  
5. Process past captures → new atoms  
6. Optional: force remaining 0 on server / top-up  

---

## Gaps / honesty

| Gap | Why |
|-----|-----|
| No UI screenshots | CLI cannot screenshot home leaf |
| Process no-op on vault writes | SecretStorage key not available to agent |
| Plus-in-plugin unproven | localStorage session not injectable via CLI |

Agent dogfood **maximized automation**; remaining gap is **Obsidian UI + real key**, not more unit tests.
