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
doc_review: 2026-07-27
doc_review_resolved: 2026-07-27
deepened: null
---

# Atoms Plus — stripe-first mobile onboarding

## Goal Capsule

Ship the **stranger-grade** Plus signup path: **email in plugin → soft device session → Stripe trial (card) → return to Obsidian → Process**, without pasting `sess_` on the happy path. Mobile-first (refresh-on-resume + onload poll). Magic link only for restore / second device / already-entitled sign-in.

**Authority:** origin design `docs/plans/2026-07-27-001-design-atoms-plus-stripe-first-onboarding.md` wins on UX. Backend meter/security KTDs from `docs/plans/2026-07-22-001-feat-atoms-plus-production-backend-meter-security-plan.md` remain (fail-closed, webhook grants, no dogfood in prod). Pricing SSOT: `plus-pricing.json`.

**Stop when:** success criteria in origin design §11 pass on test_vault (+ human phone smoke), except Privacy/Terms URLs may be placeholders until human hosts pages (see R-PRIVACY). Do not expand into IAP, MCP, or promo redesign.

**Doc-review (2026-07-27):** P0/P1 auto-resolved into KTDs + units below (session mint gate, returning user, webhook matrix, resume extract, checkout RL, exchange HTML, risks).

---

## Product Contract

**Product Contract preservation:** carries origin design decisions A/A1/E2/X2/H3/D1–D2; no re-pricing; BYOK forever. **Added from review:** R-RETURN, R-SESS (session mint security).

### Requirements

| ID | Requirement |
|----|-------------|
| R-START | Email → **Start free trial** creates **soft account** (`inactive`, remaining 0) + device `sess_` **only if** account is new/inactive and not already entitled |
| R-RETURN | If email already `active`\|`trialing`\|`exhausted` (or has `stripeCustomerId`): **do not** mint session via start; **do not** open `start_trial` Checkout — offer **Send sign-in link** (magic) only |
| R-TRIAL | Primary CTA opens Stripe Checkout `start_trial` (card + `trial_period_days` from pricing SSOT) when soft-start succeeded |
| R-LOCK | Checkout email bound to session account; webhook grants **only** server-set `metadata.email` / `client_reference_id` |
| R-GRANT | Filings only after successful Checkout webhook (not on soft start) |
| R-RESUME | While `awaitingCheckout` (persisted LS): on **onload/layoutReady**, visibility/focus, and bounded interval → `GET /v1/me`; no paste required |
| R-HOME | Home **Try Atoms Plus** and Settings both enter the same flow |
| R-FINISH | Abandoned Checkout → **Finish trial setup** whenever token + inactive (flag optional) |
| R-DEVICE2 | Second device / lost session / entitled restore → magic link only (no second charge; no start mint) |
| R-SESS | Unauthenticated start **never** returns a usable `sess_` for already-entitled accounts |
| R-KILL | Remove dogfood labels; paste-`sess_` collapsed Advanced only; remove Advanced paste in next minor after AE1 phone green (follow-up issue) |
| R-PORTAL | Settings **Manage billing** → Customer Portal when customer exists |
| R-PRIVACY | Privacy + Terms link **slots** + Anthropic disclosure near trial CTA; **public launch** of this UX requires non-placeholder URLs or explicit human waiver |
| R-ABUSE | RL soft-start + magic-link + **checkout** (IP + email/session); soft account cannot classify; start budgets below |
| R-IAP | Web Stripe only; no native IAP this plan |

### Actors

| ID | Actor |
|----|--------|
| A-NEW | New user, no BYOK, wants Plus |
| A-MOBILE | iOS/Android Obsidian (primary) |
| A-DESKTOP | Desktop Obsidian (same spine) |
| A-RETURN | User with paid/trial entitlement, new device or reinstall |
| A-BYOK | User with own key — Process stays BYOK while Plus inactive/setup; Plus preferred when entitled |

### Key flows

| ID | Flow |
|----|------|
| F1 | Happy: Try Plus → email → Checkout → resume → Process |
| F2 | Abandon Checkout → Finish setup → complete pay → Process |
| F3 | Second device / entitled restore: magic link → Process |
| F4 | Exhausted → Get More top-up (existing) |
| F5 | Manage / cancel via Portal |
| F6 | Already subscribed + Start free trial email → magic-link prompt, no Checkout |

### Acceptance examples

| ID | Example |
|----|---------|
| AE1 | Phone: complete trial without ever seeing “paste sess_” |
| AE2 | Soft session alone: Process does not file (inactive); BYOK still works if key present |
| AE3 | Stripe `customer_details.email` ≠ metadata email: **no** grant; event claimed; user sees “checkout email must match” |
| AE4 | Burst soft-starts: HTTP 429 after budget (e.g. 5/email/hour, 20/IP/hour) |
| AE5 | After pay, kill Safari, cold-start Obsidian: onload poll → trialing without paste |
| AE6 | `POST /v1/auth/start` for entitled email: **no** `sess_` in response; client shows magic-link UI |
| AE7 | Attacker knows victim email: start cannot steal active meter |

### Scope

**In:** plugin Settings + home Modal, filingAuth + `awaitingCheckout`, plusClient start + shared refresh, plus-service start/session gate, Stripe webhook harden + checkout RL, return + exchange HTML, resume onload poll, copy, tests, version bump, QA note.

**Out:** Apple/Google IAP; session in vault Sync; password accounts; Checkout-with-zero-pre-session; Ask/MCP (#112); limit/top-up chrome redesign; live Stripe/Resend ops (#115); durable shared RL (Redis); disposable-email blocklist; CONCEPTS.md thrash (optional later).

### Deferred (non-blocking)

- Desktop `obsidian://` deep link polish  
- Magic-link auto-inject session (v1: Refresh OK)  
- Disposable-email / CAPTCHA  
- Hosted Privacy/Terms **content** (URLs human-owned)  
- Shared multi-instance rate limiter  
- “Sign out all devices” / revoke-others-on-magic (cap sessions only in v1)  
- Remove Advanced paste (next minor after AE1)  

---

## Planning Contract

### Key technical decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| KTD-O1 | `POST /v1/auth/start` `{ email }`: normalize → `ensureAccount`. **Mint session only if** status is `inactive` **and** not entitled (no active/trialing/exhausted; treat `stripeCustomerId` as entitled). Else return **409** (or 200 without session) + `{ needsMagicLink: true, email }` — **never** `sess_`. Account-idempotent; **each successful soft start mints a fresh session** (prior soft sess_ left until TTL; optional oldest revoke if >10 sessions/email). | Soft path without magic; blocks ATO of paid emails |
| KTD-O2 | `awaitingCheckout` in LS (sibling key or session blob). Set when Checkout URL opened. Clear when: entitlement active/trialing/exhausted; **sign-out / clearPlusSession**; start failure before open; poll cap after final refresh. | Resume without classifying inactive |
| KTD-O3 | Classify: inactive never Plus-classifies. UI: soft signed-in when **token + inactive**. `awaitingCheckout` = poll only. BYOK: Process uses BYOK while inactive. | Finish setup + BYOK coexistence |
| KTD-O4 | Checkout: `customer_email` + `metadata.email` + `client_reference_id` = session email. Webhook grant target = `metadata.email` ?? `client_reference_id` only. If `customer_email` or `customer_details.email` present and **normalizes ≠** grant target → **no grant**, log, **claim event** (stop retries). Return/Finish copy: email must match. | AE3 single rule |
| KTD-O5 | Resume: persist flag; **onload + onLayoutReady** immediate `/v1/me`; then visibility/focus + interval backoff ~30–60s (3–8 polls). Extract **`refreshPlusSession(app, cfg)`** in `plusClient`/`filingAuth` — Settings + resume both call it (do not use private Settings method). Quiet “Updating subscription…” while polling. | Mobile WebView + cold start |
| KTD-O6 | Shared **Modal** for home + Settings entry (email + Start free trial / Finish / magic). | H3 mobile |
| KTD-O7 | Return HTML: mobile copy; magic form → existing magic-link API (same RL); **never** embed sess_; generic success. Exchange HTML: restore-first copy; paste last resort. | Kill paste happy path server-side too |
| KTD-O8 | RL budgets (in-process, best-effort): `start:{email}` ≤5/hour, `start:{ip}` ≤20/hour; `ml:{email}` + `ml:{ip}`; `checkout:{ip}` + `checkout:{session}` ≤10/hour. Document multi-instance residual. | Abuse without Redis |
| KTD-O9 | Privacy/Terms URL constants; hide if empty; **DoD public** needs real URLs or waiver note in PR. | Legal surface |
| KTD-O10 | Version bump + BRAT release on merge | CLAUDE.md |
| KTD-O11 | Checkout `start_trial` if account already active\|trialing → **409** (client should not open). | Server belt for F6 |
| KTD-O12 | Email squatting residual: card-required + Radar + start-only-if-inactive; support runbook one-liner (cancel/refund). Card ≠ email proof. | Adversarial residual |

### Patterns to follow

- Session LS: `src/platform/filingAuth.ts`  
- HTTP: `src/platform/plusClient.ts` + `plusFetchRequest`  
- Checkout session-scoped: `plus-service/src/server.mjs`  
- Rate limit: `plus-service/src/ratelimit.mjs`  
- Offer copy: `src/home/atomsHomeData.ts`  
- Design: `docs/design-handoff/atoms-plus/`  
- Security tests: `plus-service/test/security-meter.test.mjs`, `stripe.test.mjs`

### Assumptions

- Implement against test Stripe + current host; #115 live secrets parallel.  
- Privacy/Terms URLs may ship empty in dev builds.  
- IAP out of scope.

### Sequencing

U1 → U2 → U3 → U4 → U5 → U6 → U7 → shipping tail.

**Depends on:** production-shaped plus-service on master.  
**Parallel:** #115 ops.

### Risks

| Risk | Mitigation |
|------|------------|
| Start ATO of entitled email | KTD-O1/O11 + AE6/AE7 tests |
| Soft session vs BYOK | KTD-O3; inactive never classifies |
| Stripe email edit | KTD-O4 fail-closed + matrix tests + user copy |
| Mobile visibility flaky | onload poll + interval + manual Refresh |
| Soft-account / Stripe spam | KTD-O8 + no filings until webhook |
| Email squatting (pay as victim) | KTD-O12; support runbook |
| In-process RL multi-instance | Residual; deferred shared RL |
| Paste Advanced stays forever | R-KILL exit: remove next minor after AE1 |
| Mismatch: paid but no grant | Return/Finish copy + claim event + runbook refund |

---

## Implementation Units

### U1 — Store: session mint + entitled gate

**Goal:** Soft mint without dogfood; never mint for entitled accounts.

**Files:** `plus-service/src/store/{postgres,sqlite,memory}.mjs`, `plus-service/test/store.test.mjs`

**Approach:**  
- Extract `createSession(email)`.  
- `startWithEmail(email)`: ensureAccount → if entitled (`active`\|`trialing`\|`exhausted` or `stripeCustomerId`) return `{ ok: false, needsMagicLink: true, account }` **without** session; else createSession → `{ ok: true, session, account }` inactive/0.  
- Never dogfood-grant on start.  
- Optional: if sessions for email > 10, revoke oldest on mint.

**Tests:**  
- inactive start → sess_ + remaining 0  
- second start → new sess_, still inactive  
- entitled email start → no sess_  
- exchangeMagic unchanged; dogfood grant only when flag on  

**Done when:** store tests green.

---

### U2 — HTTP: start, RL, Stripe lock, return + exchange HTML

**Goal:** Public start API; abuse RL; webhook mismatch matrix; restore HTML.

**Files:** `plus-service/src/server.mjs`, `stripe.mjs`, `ratelimit.mjs`, tests `security-meter`, `stripe`, new `http-onboarding.test.mjs`

**Approach:**  
1. `POST /v1/auth/start` — validate email; RL start budgets; map store result to JSON (session only if ok).  
2. Magic-link RL `ml:{email}` + ip.  
3. Checkout RL; `start_trial` → 409 if entitled (KTD-O11).  
4. Webhook KTD-O4; matrix tests (a–d from review).  
5. Return HTML + exchange HTML restore copy; magic form → magic-link handler; never embed sess_.  
6. Mismatch/cancel copy: email must match plugin.

**Tests:** AE2/3/4/6/7 server-side; checkout 429; return/exchange string smoke.

**Done when:** service tests green; prod gate intact.

---

### U3 — Plugin client + awaitingCheckout + shared refresh

**Goal:** Client start + flags + `refreshPlusSession` extract.

**Files:** `src/platform/plusClient.ts`, `filingAuth.ts`, `test/plusClient.test.ts`, `test/filingAuth.test.ts`

**Approach:**  
- `startPlusAccount` → handle needsMagicLink vs session.  
- LS awaitingCheckout helpers; clear on clearPlusSession.  
- `refreshPlusSession(app, cfg)` writes entitlement from `getEntitlement`.  
- `hasPlusSetupSession` for UI; classify rules unchanged for inactive.

**Tests:** start parse; entitled/needsMagicLink; inactive !plusCanClassify; awaiting round-trip + clear on sign-out helper.

**Done when:** units green.

---

### U4 — Settings + Modal UI

**Goal:** Primary Start free trial; F6 magic branch; kill dogfood primary.

**Files:** `src/settings/settings.ts`, shared modal module, `atomsHomeData.ts` as needed, tests for copy helpers

**Approach:**  
1. Email + **Start free trial** → start → if needsMagicLink show Send sign-in link UI; else checkout start_trial → open → set awaiting.  
2. Soft inactive: Finish trial setup + Sign out (uses refreshPlusSession).  
3. Active: quiet status + portal + refresh + sign out.  
4. Advanced: paste + magic collapsed.  
5. Privacy/Terms if URLs set.  
6. Interaction states (loading, 429, network, Updating subscription…).  
7. BYOK copy: setup doesn’t remove own key path until entitled.

**Done when:** build + units; smoke path in QA note.

---

### U5 — Resume poll lifecycle

**Goal:** Cold start + visibility entitlement refresh.

**Files:** `src/platform/plusResume.ts` (new) or `main.ts`, wire Settings to shared refresh

**Approach:** If awaitingCheckout: immediate refresh on onload/layoutReady; interval + visibility; Notices; clear flag on entitled/sign-out/cap.

**Tests:** poll controller fake clock.

**Done when:** wired once; Settings uses same refresh.

---

### U6 — Home CTA

**Goal:** Try Atoms Plus → shared Modal (Finish if inactive session).

**Files:** `atomsHomeView.ts`, `atomsHomeData.ts`, tests

**Approach:** `open_plus` → Modal; soft inactive shows Finish; BYOK secondary unchanged.

**Done when:** same start function as Settings.

---

### U7 — Version, QA, runbook one-liner

**Goal:** Ship gate.

**Files:** `manifest.json`, `package.json`, `versions.json`, `docs/qa/` note (onboarding + AE list), optional one paragraph in `docs/runbooks/atoms-plus-prod.md` (start vs magic; mismatch refund)

**Commands:** `npm test` · `npm run build` · `cd plus-service && npm test`

**Manual:** phone F1/F2/F3/F6; test_vault only.

**Done when:** version bumped; PR checkboxes real; Privacy waiver or URLs noted.

---

## Verification Contract

| Layer | Action |
|-------|--------|
| Plugin unit | `npm test` |
| Build | `npm run build` |
| plus-service | `cd plus-service && npm test` |
| Security | start entitled no sess_; webhook matrix; checkout RL |
| Human phone | AE1, AE5, F6 |
| No Remote Vault | constitution |

**Execution direction:** test-first U1–U3; characterize `resolveFilingAuth` inactive before UI; U4–U6 after client green.

---

## Definition of Done

### Global

- [ ] AE1–AE7 covered by automated and/or phone evidence  
- [ ] R-SESS / AE6–AE7 green (no entitled start sess_)  
- [ ] No dogfood on primary path  
- [ ] Soft account cannot classify  
- [ ] Webhook mismatch matrix green  
- [ ] `npm test` + plus-service tests + build green  
- [ ] Version + BRAT on user-visible merge  
- [ ] Claim Issue + STATUS + `Closes #N`  
- [ ] Privacy URLs set or PR waiver  
- [ ] Shipping tail: simplify → code-review → compound if needed → scoped QA  

### Per unit

U1–U7 goals + tests.

---

## Multiplayer / claim

| | |
|--|--|
| Suggested Issue | `feat: Plus stripe-first onboarding (no paste sess happy path)` |
| Hot files | `plus-service/src/server.mjs`, `store/*`, `stripe.mjs`, `src/platform/plusClient.ts`, `filingAuth.ts`, `plusResume.ts`, `settings/settings.ts`, `home/atomsHomeView.ts`, `plugin/main.ts` |
| Parallel | #115 secrets only |

---

## Appendix — research breadcrumbs

- Inactive drops Plus mode in `resolveFilingAuth` — UI special-case only.  
- Session mint was exchange-only — extract + gate.  
- `refreshPlusEntitlement` is Settings-private — extract shared.  
- Home `open_plus` only opened Settings.  
- In-process RL multi-instance residual.

**External research:** skipped — local Stripe patterns sufficient.
