# World-Class QA — Atoms Plus managed filing

**Date:** 2026-07-17  
**Branch:** `feat/atoms-plus-managed-filing`  
**PR:** https://github.com/taihartman/obsidian-atoms/pull/92  
**Plan:** `docs/plans/2026-07-17-005-feat-atoms-plus-managed-filing-plan.md`  
**Mock SSOT:** `docs/design-handoff/atoms-plus/index.html` (v3)

---

## Verdict

### **NOT MERGE-READY for public Plus** · **DOGFOOD-OK (local)** — prior P1/P2 **re-verified fixed**

| Claim | Result |
|--------|--------|
| Unit / typecheck | ✅ **322** plugin tests + 5 service store; typecheck clean |
| Plus service API (auth, meter, refund, top-up) | ✅ Live HTTP smoke on `:8799` (retest) |
| Plugin pure product copy / auth matrix | ✅ Unit tests |
| Prior QA P1/P2 fixes | ✅ Re-verified (see Retest) |
| Live Obsidian UI (home + Settings) | ❌ **Not tested** — requires human Obsidian session |
| Live managed classify with real Anthropic key | ❌ **Not tested** this pass (no key in smoke) |
| Stripe / real email magic link | ❌ Not built |

**Hard gate trip:** Live Obsidian leaf still not driven. Not public Ready.

---

## Charter

Ship **Atoms Plus**: optional metered AI filing plane ($6 / 150 Sonnet / no rollover) with free BYOK forever, Apple-plain limit UX, dogfood Plus service. Must not paywall library; must not pitch BYOK on exhaust; must not double-charge Preview re-open.

**Regression risk:** Process / Preview / auto-run / Update notes auth paths; home wait card; Settings.

**Platforms:** Agent automation = unit + service HTTP. Product primary = Obsidian mobile (untested here). Desktop Obsidian CLI available but UI leaf not driven.

---

## Preflight

| Check | Status |
|--------|--------|
| Navigation map `docs/qa/app-navigation-map.md` | ✅ Present |
| Fixtures `docs/qa/testing-fixtures.md` | ✅ Present |
| Dev commands | ✅ `npm test`, `npm run build`, `plus-service` `npm start` |
| Viewport | ✅ Mobile-first home (~phone); mock at phone frames |
| Auth path for Plus | ⚠️ Dogfood paste session / magic-link console — not production |
| Mock | ✅ Locked design-handoff |
| Automation | ✅ Vitest + Node test + curl; ❌ Playwright Obsidian N/A |
| Deploy reality | N/A for plugin branch; Plus service not deployed |

---

## User intent & perception

| Question | Answer |
|----------|--------|
| Goal | File past captures without owning Anthropic key, or keep free BYOK |
| Confidence signals | Clear Try Plus vs own key; Active status; limit only when needed |
| Distrust triggers | Ambient 118/150; “renews automatically” next to Get More; BYOK pitch on limit |
| Decision before pay | Offer sheet: price, 150, no rollover, cost reason, free path |

---

## §4a Target enumeration (new / changed)

### Interactive

| Surface | Expected | Evidence |
|---------|----------|----------|
| Home **Try Atoms Plus** | Open Settings (atoms) | Code: `atomsHomeView.ts` → `open_plus`; unit: primaryAction |
| Home **Use My Own Key** | Open Settings API key area | Code: `open_byok_settings` |
| Home **Get More** | Open Settings Plus | Code: `get_more` |
| Home **Not Now** | Soft re-render | Code: `dismiss_limit` (weak — see findings) |
| Settings **See Plans** | Notice with offer copy | Manual / code path |
| Settings **Send Magic Link** | POST magic-link | HTTP smoke ✅ |
| Settings **Save Session** | Device-local Plus session | Code; not live Obsidian |
| Settings **Start Free Trial** | dogfood checkout grant | HTTP top-up/subscribe path ✅ |
| Settings **Get More** (exhausted) | topup_50 | HTTP ✅ remaining 150→200 |
| Settings **Sign Out** | clear session | Unit store-level N/A; code present |

### Informational

| Surface | Expected | Evidence |
|---------|----------|----------|
| Wait title none | “N Captures Waiting” | Unit ✅ |
| Wait body none | Plus or own key free | Unit ✅ |
| Limit title | “Monthly Limit Reached” | Unit ✅ |
| Limit body | allotment starts over; buy additional | Unit ✅; no BYOK pitch ✅ |
| Offer bullets | 150, no rollover, library free | Unit `atomsPlusOfferCopy` ✅ |
| Top-up body | one-time; no auto-renew | Unit ✅ |
| Active settings | Status / Account / Plan — **no remaining meter** | Code review ✅ (no progress bar) |

---

## User stories

### Primary

1. **As someone without an Anthropic key, I want a clear path to try Plus or use my own key, so I can file past captures.**  
   Acceptance: Wait card primary Try Atoms Plus, quiet Use My Own Key.  
   Evidence: unit `filingHeroCopy` need_key.  
   Status: **Passed (unit)** · **Not tested (live Obsidian)**

2. **As a Plus user, I want classify to go through the service with my session, so I never paste a managed master key.**  
   Acceptance: Bearer to `/v1/classify`; no x-api-key from client for Plus.  
   Evidence: `classify.ts` plus branch; plusClient tests.  
   Status: **Passed (code + unit)** · **Not tested (live Anthropic classify)**

3. **As a Plus user at limit, I want a calm limit message and Get More, not a BYOK upsell.**  
   Acceptance: Monthly Limit Reached; no “paste key”.  
   Evidence: unit plus_exhausted; `resolveClassifyAuth` exhausted message.  
   Status: **Passed (unit)**

### Continuation

4. **As a user who Previews then backs out, I don’t want a second charge for the same capture.**  
   Acceptance: same fingerprint → cache hit.  
   Evidence: `previewCache` unit; wire in `runDryRun`.  
   Status: **Passed (unit + code)** · **Not tested (live)**

5. **As a dogfood user, I want magic-link → session → me → top-up.**  
   Acceptance: HTTP 200 paths.  
   Evidence: live curl smoke 2026-07-17.  
   Status: **Passed (service live)**

### Negative

6. **As the service, if Anthropic is misconfigured, I must not burn a filing.**  
   Acceptance: 503 + remaining unchanged.  
   Evidence: live curl remaining stayed **150** after failed classify.  
   Status: **Passed**

7. **As a user with invalid session, classify fails closed.**  
   Acceptance: 401.  
   Evidence: store tests + code path.  
   Status: **Passed (unit/store)**

### Edge

8. **No rollover on period re-grant.**  
   Evidence: store test `no rollover on re-grant`.  
   Status: **Passed**

9. **Top-up adds 50 without auto-subscription language in API.**  
   Evidence: live top-up 150→200 after grant (started 150, +50).  
   Status: **Passed (service)** · Product note: top-up while full increases bank (by design)

### Perception

10. **No ambient remaining counters in Settings Active.**  
    Evidence: `renderPlusSection` code review — Status/Account/Plan only.  
    Status: **Passed (code)** · **Not tested (screenshot)**

11. **Mock v3 copy alignment for hero/limit/offer.**  
    Evidence: unit tests for strings.  
    Status: **Passed (unit)** · Fidelity screenshots **Not tested**

### Regression

12. **BYOK Process/Preview still works without Plus session.**  
    Evidence: classifyAuth byok path unit; existing classify tests green.  
    Status: **Passed (automated)** · **Not tested (live Obsidian)**

---

## Risk matrix

| Risk | Type | Story | Status |
|------|------|-------|--------|
| Happy: dogfood auth + meter | Happy | #5 | Passed service |
| Happy: hero conversion copy | Happy | #1 | Passed unit |
| Negative: missing Anthropic key refund | Negative | #6 | Passed live |
| Edge: no rollover | Edge | #8 | Passed unit |
| Perception: no meters | Perception | #10 | Code only |
| Live Obsidian UI | Regression | #1,#12 | **Not tested** |
| Real Stripe/email | Edge | — | **Not tested / not built** |
| Fake session paste | Negative | adversarial | See findings |

---

## Evidence — automation

```text
npm test                          → 318 passed
cd plus-service && npm test       → 5 passed
npm run typecheck                 → clean
```

## Evidence — live Plus service (2026-07-17)

Host: `http://127.0.0.1:8799` · `DOGFOOD_AUTO_GRANT=1` · no `ANTHROPIC_API_KEY`

| Step | Result |
|------|--------|
| GET /health | ok, includedFilings 150, hasAnthropicKey false |
| POST magic-link | ok; token logged |
| POST exchange | trialing, remaining 150 |
| GET /me | matches |
| POST classify (no key) | **503**; remaining still **150** (refund) |
| POST checkout topup_50 | remaining **200** |

Log: `/tmp/plus-qa-server.log` (ephemeral)

## Evidence — screenshots

**None.** Live Obsidian leaf not driven. Mock HTML exists at `docs/design-handoff/atoms-plus/index.html` (design, not live app).

---

## Findings

### P1 — Dogfood “Not Now” does not dismiss limit card — **FIXED**

- **Was:** no-op re-render.
- **Fix:** device-local dismiss day (`LS_PLUS_LIMIT_DISMISS_DAY`); after Not Now, quieter card (count + Get More only) for rest of local day.
- **Proof:** unit tests `plus_exhausted after Not Now`, `filingAuthDismiss`.

### P1 — Paste session without server proof — **FIXED**

- **Was:** write session then maybe `/me`.
- **Fix:** Save Session only after successful `GET /v1/me`; otherwise Notice and no persist.
- **Proof:** code path in `settings.ts`.

### P2 — Magic link port mismatch — **FIXED**

- **Was:** `PUBLIC_BASE_URL` default always `:8787`.
- **Fix:** default `http://127.0.0.1:${PORT}`; log `publicBase=` on listen.

### P2 — In-memory store: restart wipes sessions

- Expected for dogfood; **not** production.

### P3 — See Plans is Notice-only, not full Offer modal

- Matches interim plan; full U5d modal still thin.

---

## Adversarial scenario ledger

| Scenario | Result |
|----------|--------|
| Exhaust → classify | solid (402 / client message) |
| Classify fail → refund | solid (live 503 remaining 150) |
| Top-up after grant | solid (+50) |
| Re-grant period no rollover | solid (unit) |
| Double Process / Preview same capture | solid cache unit; live Obsidian blocked |
| Edit session mid-flight | solid (device-local overwrite) |
| Delete session Sign Out | solid (code) |
| Fake session Process | solid fail closed on 401 (code) |
| Offline service | solid network error path (plusClient unit) |
| Weird: top-up while already full | solid product (200 remaining) — not a bug |
| Not Now on limit | **holed** (P1 no-op dismiss) |
| Live multi-device same session | blocked (no second device) |
| Stripe charge / cancel | blocked (not built) |
| Real email magic link | blocked (console only) |

---

## Not tested (named)

1. Obsidian desktop/mobile **live** home + Settings UI  
2. Managed classify with **real** Anthropic key end-to-end  
3. Phone Sync install path  
4. Stripe trial/card  
5. Screenshot fidelity vs mock (U5e)  
6. Preview cache across Obsidian restarts  
7. Auto-run with Plus session on real vault  

---

## Merge decision

| Question | Answer |
|----------|--------|
| Merge plugin+service to master as **public Plus**? | **No** |
| Continue dogfood on branch / draft PR? | **Yes** |
| Blockers for Ready | Live Obsidian pass; real classify with key; Stripe+email for public; fix or accept P1 dismiss |

**Recommended next:** Human dogfood checklist (below) + U7 when loop feels good; then adversarial re-check on live UI.

### Human dogfood checklist (headline path)

1. `cd plus-service && ANTHROPIC_API_KEY=… npm start`  
2. Plugin URL `http://127.0.0.1:8787`  
3. Magic link → paste session  
4. Home: confirm Try Plus / Use My Own Key when logged out of Plus and no key  
5. Process past capture on demo/test vault  
6. Force remaining 0 → Monthly Limit Reached / Get More  
7. Top-up → Process again  
8. BYOK without session still works  

---

## Commands log

```bash
npm test                                    # 322 pass (retest)
cd plus-service && npm test                 # 5 pass
npm run typecheck                           # clean (from plugin root)
DOGFOOD_AUTO_GRANT=1 PORT=8799 node src/server.mjs
curl health / magic-link / exchange / me / classify / topup
```

---

## Retest after fixes (2026-07-17 later)

| Fix | How re-verified | Result |
|-----|-----------------|--------|
| **Not Now dismiss** | Unit: `plus_exhausted after Not Now` → quieter title `4 Captures Waiting`, secondary null; `isPlusLimitDismissedToday` | ✅ |
| **Session only after /me** | Live: forged `sess_forged_*` → **401** Invalid session (client must not save); real session → **200** me | ✅ code + HTTP |
| **Magic link port = PORT** | Live `PORT=8799`: log `publicBase=http://127.0.0.1:8799`; link contains `:8799` | ✅ `PORT_OK=yes` |
| Refund still works | classify without Anthropic key → **503**, remaining stays **150** | ✅ |
| Full suite | `npm test` **322** pass; service store **5** pass | ✅ |

**Still open for Ready:** human Obsidian dogfood checklist + real Anthropic classify + Stripe/email for public.
