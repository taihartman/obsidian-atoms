---
title: "Atoms Plus — stripe-first mobile onboarding"
type: feat
date: 2026-07-27
origin: docs/plans/2026-07-27-001-design-atoms-plus-stripe-first-onboarding.md
related: docs/plans/2026-07-22-001-feat-atoms-plus-production-backend-meter-security-plan.md
related_design: docs/design-handoff/atoms-plus/
issue: null
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
doc_review: null
deepened: null
---

# Atoms Plus — stripe-first mobile onboarding

## Goal Capsule

Ship the **stranger-grade** Plus signup path: **email in plugin → soft device session → Stripe trial (card) → return to Obsidian → Process**, without pasting `sess_` on the happy path. Mobile-first (refresh-on-resume). Magic link only for restore / second device.

**Authority:** origin design `docs/plans/2026-07-27-001-design-atoms-plus-stripe-first-onboarding.md` wins on UX. Backend meter/security KTDs from `docs/plans/2026-07-22-001-feat-atoms-plus-production-backend-meter-security-plan.md` remain (fail-closed, webhook grants, no dogfood in prod). Pricing SSOT: `plus-pricing.json`.

**Stop when:** success criteria in origin design §11 pass on test_vault (+ human phone smoke). Do not expand into IAP, MCP, or promo redesign.

---

## Product Contract

**Product Contract preservation:** carries origin design decisions A/A1/E2/X2/H3/D1–D2; no re-pricing; BYOK forever.

### Requirements

| ID | Requirement |
|----|-------------|
| R-START | Email → Continue creates **soft account** (`inactive`, remaining 0) + device `sess_` before Checkout |
| R-TRIAL | Primary CTA opens Stripe Checkout `start_trial` (card + `trial_period_days` from pricing SSOT) |
| R-LOCK | Checkout email **locked** to session account; webhook grants **only** that email |
| R-GRANT | Filings only after successful Checkout webhook (not on soft start) |
| R-RESUME | On app/vault focus after “awaiting payment”, auto `GET /v1/me` with short poll; no paste required |
| R-HOME | Home **Try Atoms Plus** and Settings both enter the same flow |
| R-FINISH | Abandoned Checkout → **Finish trial setup** (reuse session + Checkout) |
| R-DEVICE2 | Second device / lost session → magic link only (no second charge) |
| R-KILL | Remove dogfood labels; paste-`sess_` is power-user/fallback only (collapsed or gone from primary UI) |
| R-PORTAL | Settings **Manage billing** → Customer Portal when `stripeCustomerId` exists |
| R-PRIVACY | Privacy + Terms links + existing Anthropic disclosure near trial CTA |
| R-ABUSE | Rate-limit soft-start + magic-link (IP + email); soft account cannot classify |
| R-IAP | Web Stripe only (plugin in host Obsidian); no native IAP this plan |

### Actors

| ID | Actor |
|----|--------|
| A-NEW | New user, no BYOK, wants Plus |
| A-MOBILE | iOS/Android Obsidian (primary) |
| A-DESKTOP | Desktop Obsidian (same spine; optional deep link polish) |
| A-RETURN | User with paid/trial entitlement, new device |
| A-BYOK | User with own key (Plus preferred when entitled) |

### Key flows

| ID | Flow |
|----|------|
| F1 | Happy: Try Plus → email → Checkout → resume → Process |
| F2 | Abandon Checkout → Finish setup → complete pay → Process |
| F3 | Second device magic link → Process (shared meter) |
| F4 | Exhausted → Get More top-up (existing; keep) |
| F5 | Manage / cancel via Portal |

### Acceptance examples

| ID | Example |
|----|---------|
| AE1 | Phone: complete trial without ever seeing “paste sess_” |
| AE2 | Soft session alone: Process does not file (inactive) |
| AE3 | Stripe email edited away from plugin email: **no** grant to wrong account (fail closed or force plugin email) |
| AE4 | Two rapid soft-starts same email: rate-limited or idempotent session refresh |
| AE5 | After pay, kill Safari and reopen Obsidian: status becomes trialing within poll window |

### Scope

**In:** plugin Settings + home CTA wiring, filingAuth soft-session UX, plusClient start API, plus-service `auth/start` + session mint, Stripe email lock + webhook harden, return HTML, resume poll, copy, tests, version bump, QA notes.

**Out:** Apple/Google IAP; session in vault Sync; password accounts; Checkout-with-zero-pre-session; Ask/MCP (#112); redesign of limit/top-up chrome (keep handoff); live Stripe/Resend ops (#115 secrets) — parallel track.

### Deferred (non-blocking)

- Desktop `obsidian://` deep link polish  
- Magic-link page that auto-delivers session without any copy (v1: Refresh status OK)  
- Disposable-email blocklist / CAPTCHA  
- Hosted Privacy/Terms page content (links can point to placeholders human fills)

---

## Planning Contract

### Key technical decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| KTD-O1 | `POST /v1/auth/start` `{ email }` → `ensureAccount` + **mint session** (no filings). Idempotent for same email if already inactive. | Soft account without magic token; magic stays restore-only |
| KTD-O2 | Plugin flag `awaitingCheckout: true` (device-local, next to session) set when Checkout URL opened; cleared when `/v1/me` is active/trialing/exhausted | Drives resume poll without treating inactive as classifiable |
| KTD-O3 | `resolveFilingAuth`: keep **inactive** from classifying; allow Settings/home to show signed-in-soft UI when token + inactive + awaitingCheckout | Today inactive falls through to BYOK/none — breaks Finish setup unless we special-case UI |
| KTD-O4 | Stripe Checkout: pass `customer_email` + metadata + `client_reference_id`; prefer Stripe API options that **disable email edit** if available for account mode; webhook resolve order: `metadata.email` → `client_reference_id` **only** (drop free-form customer_details if mismatch) | Origin mismatch rule |
| KTD-O5 | Resume: `document.visibilitychange` + `window focus` (desktop) + short `registerInterval` while `awaitingCheckout` (3–6 polls / ~30s) calling existing `refreshPlusEntitlement` | No Obsidian “app resume” API; visibility is portable |
| KTD-O6 | Home `open_plus` opens Settings **or** a small Modal with email field (prefer **Modal** so mobile doesn’t bury CTA in Settings) | Design H3; less friction than settings-only |
| KTD-O7 | Return page: copy “Switch back to Obsidian — Atoms updates automatically”; link **Send sign-in email** (magic) if lost session; optional desktop deep link later | Mobile-first |
| KTD-O8 | Rate limit `start:{ip}` and `start:{email}` + existing `ml:{ip}`; add `ml:{email}` | Origin abuse |
| KTD-O9 | Privacy/Terms: settings keys or constants for URLs (empty → hide link); no fake legal HTML in repo | Human hosts pages |
| KTD-O10 | Version bump on ship (0.6.x); Release after merge for BRAT | CLAUDE.md versioning |

### Patterns to follow

- Session LS: `src/platform/filingAuth.ts` (`atoms-plus-session`)  
- HTTP client: `src/platform/plusClient.ts` + `plusFetchRequest`  
- Checkout already session-scoped: `plus-service/src/server.mjs` checkout handler  
- Rate limit: `plus-service/src/ratelimit.mjs`  
- Offer copy SSOT: `src/home/atomsHomeData.ts` `atomsPlusOfferCopy`  
- Design chrome: `docs/design-handoff/atoms-plus/`  
- Security tests: `plus-service/test/security-meter.test.mjs`, `stripe.test.mjs`

### Assumptions

- Live Stripe + Resend domain may still be incomplete (#115); implement against **test** Stripe + local/prod host; email lock tests don’t need live money.  
- Hosted Privacy/Terms URLs may be TBD — ship link slots.  
- IAP out of scope (settled).

### Sequencing

U1 store/session mint → U2 HTTP start + RL + Stripe lock → U3 plugin client + filingAuth flag → U4 Settings/Modal UI + kill dogfood → U5 resume poll + return HTML → U6 home CTA → U7 tests/QA/version → shipping tail.

**Depends on:** plus-service already production-shaped (Postgres, webhook, portal) on master.

**Parallel OK:** #115 ops secrets (human).

### Risks

| Risk | Mitigation |
|------|------------|
| Soft session confuses BYOK path | KTD-O3: inactive never classifies; UI-only “Plus setup” |
| Stripe still allows email edit | Fail-closed webhook on mismatch; test in stripe.test.mjs |
| Mobile never fires visibility | Interval while awaitingCheckout + manual Refresh |
| Abuse of soft accounts | RL + no filings until webhook |
| Paste power-users | Keep collapsed “Advanced: paste session” optional one release |

---

## Implementation Units

### U1 — Store: mint session without magic exchange

**Goal:** Soft account can receive a `sess_` without dogfood grant.

**Files:**  
- `plus-service/src/store/postgres.mjs`  
- `plus-service/src/store/sqlite.mjs`  
- `plus-service/src/store/memory.mjs`  
- `plus-service/test/store.test.mjs`

**Approach:** Extract `createSession(email)` used by `exchangeMagic` and new start path. `startWithEmail(email)` = normalize → `ensureAccount` → `createSession` → `{ session, account }` with account still inactive/0 remaining when not auto-grant. **Never** call dogfood grant on start.

**Tests:**  
- start creates inactive remaining 0  
- second start same email returns new session, still inactive  
- exchangeMagic still one-time; dogfood grant only when flag on  

**Done when:** store tests green; no classify path changed.

---

### U2 — HTTP: `POST /v1/auth/start` + Stripe email harden + return page

**Goal:** Public API for soft start; checkout/webhook mismatch-safe; better return HTML.

**Files:**  
- `plus-service/src/server.mjs`  
- `plus-service/src/stripe.mjs`  
- `plus-service/src/ratelimit.mjs` (if key helpers needed)  
- `plus-service/test/security-meter.test.mjs`  
- `plus-service/test/stripe.test.mjs`  
- `plus-service/test/http-dogfood.test.mjs` (or new `http-onboarding.test.mjs`)

**Approach:**  
1. `POST /v1/auth/start` body `{ email }` — validate email, RL `start:{ip}` + `start:{email}`, return same JSON shape as exchange (session + publicAccount).  
2. Magic-link: also RL `ml:{email}`.  
3. Webhook email resolution: prefer `metadata.email` / `client_reference_id`; if `customer_details.email` differs, **do not grant** (log).  
4. Checkout: keep `customer_email` + metadata; document Stripe Dashboard “collect email” settings if API can’t hard-lock.  
5. `GET /v1/billing/return`: mobile-first copy + optional “Email me a sign-in link” form posting to magic-link.

**Tests:**  
- start → me shows inactive 0  
- start → classify rejected  
- start → checkout kind start_trial returns url (mock Stripe)  
- webhook mismatch does not grant  
- RL 429 on start burst  
- return HTML contains expected strings (light)

**Done when:** service tests green; prod gate still requires Stripe/Resend.

---

### U3 — Plugin client + device “awaiting checkout”

**Goal:** Client can start + track payment wait without classifying as Plus-ready.

**Files:**  
- `src/platform/plusClient.ts`  
- `src/platform/filingAuth.ts`  
- `test/plusClient.test.ts`  
- `test/filingAuth.test.ts`

**Approach:**  
- `startPlusAccount(cfg, email)` → `POST /v1/auth/start` → write session.  
- Extend local storage: either fold `awaitingCheckout` into serialized session blob or sibling LS key `atoms-plus-awaiting-checkout`.  
- Helpers: `setAwaitingCheckout`, `clearAwaitingCheckout`, `isAwaitingCheckout`.  
- `resolveFilingAuth`: unchanged classify rules for inactive; export `hasPlusSetupSession` for UI (token present).

**Tests:**  
- start client parses session  
- inactive + token ⇒ not `plusCanClassify`  
- awaiting flag round-trip  

**Done when:** unit tests green; no Settings UI yet required.

---

### U4 — Settings + offer Modal UI (kill dogfood)

**Goal:** Primary UX = email → Start free trial; advanced paste optional.

**Files:**  
- `src/settings/settings.ts`  
- `src/home/atomsHomeData.ts` (copy helpers if needed)  
- optional small modal module under `src/settings/` or `src/home/`  
- `test/atomsHomeData.test.ts` if copy keys change  

**Approach:**  
1. Signed-out Plus section: Email field + **Continue / Start free trial** → `startPlusAccount` → `createCheckout(..., "start_trial")` → `window.open` → set awaitingCheckout → Notice “Complete checkout, then return here.”  
2. Soft signed-in inactive: show email + **Finish trial setup** + Sign out.  
3. Active/trialing: existing quiet status + Manage billing + Refresh + Sign out.  
4. Remove or collapse dogfood paste/magic under “Sign in on another device” / Advanced.  
5. Privacy/Terms: `Setting` links if URL constants non-empty.  
6. Replace dogfood strings.

**Tests:** prefer pure helpers for button enablement/copy; full DOM optional.

**Done when:** build + unit tests; manual smoke path documented.

---

### U5 — Resume poll + plugin lifecycle

**Goal:** Returning from Safari updates entitlement without paste.

**Files:**  
- `src/plugin/main.ts` (or small `src/platform/plusResume.ts`)  
- `src/settings/settings.ts` (`refreshPlusEntitlement` reuse)

**Approach:** While `isAwaitingCheckout()`, on `visibilitychange` (visible) and/or interval: call `getEntitlement` / `refreshPlusEntitlement`; on active|trialing|exhausted clear awaiting + Notice “Atoms Plus is ready”. Cap polls. Always keep manual Refresh.

**Tests:** unit-test poll controller with fake clock if extracted; else light integration via mock.

**Done when:** controller tested; wired once in `onload`.

---

### U6 — Home CTA

**Goal:** **Try Atoms Plus** starts F1 without hunting Settings.

**Files:**  
- `src/home/atomsHomeView.ts`  
- `src/home/atomsHomeData.ts`  
- `test/atomsHomeData.test.ts`

**Approach:** `open_plus` → open email/trial Modal (shared with Settings). If already awaitingCheckout, Modal shows Finish setup. `open_settings` still used for BYOK.

**Tests:** hero still exposes `open_plus`; optional action enum if new action id.

**Done when:** home path reaches same start function as Settings.

---

### U7 — Verification, version, docs

**Goal:** Ship readiness.

**Files:**  
- `manifest.json`, `package.json`, `versions.json`  
- `docs/qa/` short note or amend launch checklist onboarding section  
- `docs/runbooks/atoms-plus-prod.md` one paragraph on start vs magic  
- optional `CONCEPTS.md` terms: soft account, awaiting checkout  

**Commands:**  
```bash
npm test
npm run build
cd plus-service && npm test
```

**Manual (test_vault / phone):** F1–F3 smoke; no Remote Vault.

**Done when:** version bumped; PR test plan checkboxes real; screenshots optional (Settings/home CTA).

---

## Verification Contract

| Layer | Command / action |
|-------|------------------|
| Plugin unit | `npm test` (plusClient, filingAuth, atomsHomeData, …) |
| Plugin typecheck/build | `npm run build` |
| plus-service | `cd plus-service && npm test` |
| Security regression | existing security-meter + new start/mismatch cases |
| Human | phone Try Plus → test Checkout → resume → Process on **test_vault** only |
| Agent vault | CLI reload + Process only if session injectable; otherwise human phone |

**Execution direction:** test-first on U1–U3 pure store/client; UI U4–U6 after client green; characterization of `resolveFilingAuth` inactive behavior before changing it.

---

## Definition of Done

### Global

- [ ] Origin design §11 success criteria met or explicitly waived with reason  
- [ ] No user-visible “dogfood” on primary path  
- [ ] Soft account cannot classify (service + plugin)  
- [ ] Webhook email mismatch cannot grant wrong account  
- [ ] `npm test` + `plus-service` tests + `npm run build` green  
- [ ] Version bump + BRAT release when merging user-visible change  
- [ ] Claim Issue + STATUS + PR `Closes #N`  
- [ ] Shipping tail: simplify → code-review → compound if durable learning → world-class-qa scoped to Plus onboarding  

### Per unit

U1–U7 each: tests listed + behavior matches unit Goal.

---

## Multiplayer / claim

| | |
|--|--|
| Suggested Issue title | `feat: Plus stripe-first onboarding (no paste sess happy path)` |
| Hot files | `plus-service/src/server.mjs`, `store/*`, `stripe.mjs`, `src/platform/plusClient.ts`, `filingAuth.ts`, `settings/settings.ts`, `home/atomsHomeView.ts`, `plugin/main.ts` |
| Conflict | Avoid parallel edits to Plus Settings with other Plus UI claims |
| Parallel | #115 public launch secrets (ops only) |

---

## Appendix — research breadcrumbs

- Inactive today drops out of Plus mode in `resolveFilingAuth` (`src/platform/filingAuth.ts`) — must special-case **UI** not classify.  
- Session mint only in `exchangeMagic` today — extract for start.  
- Checkout already uses session email server-side; Stripe customer_email still editable in hosted page without harden.  
- Rate limit exists; start/checkout not covered.  
- No visibility resume hook yet; only `onLayoutReady` + intervals.  
- Home `open_plus` only opens Settings today.  
- Exchange HTML still instructs paste — demote when magic is restore-only.  

**External research:** skipped — Stripe Checkout + existing local stripe.mjs patterns sufficient; payment surface already in-repo.
