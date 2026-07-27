---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
title: "Atoms Plus — managed filing plane"
date: 2026-07-17
deepened: 2026-07-17
# U5 mock approved 2026-07-17 (docs/design-handoff/atoms-plus/index.html v3)
---

# Atoms Plus — managed filing plane - Plan

## Goal Capsule

**Objective.** Let people who will not set up an Anthropic account file past daily captures through **Atoms Plus** — one paid plan with managed keys — while free BYOK and the full second-brain loop remain complete forever.

**Product authority.** This requirements-only Product Contract. North star and non-negotiables still live in `docs/architecture.md` and `CLAUDE.md` (body sacred, flat atoms, never process today by default, second brain not task app).

**Open blockers.** None product-blocking. Deferred planning choices: Stripe product IDs, proxy host deployment target, promo redemption default cap (operator-tunable).

**Product Contract preservation.** Product Contract core unchanged (R1–R15, KD1–KD12). **UI surface authority** updated 2026-07-17: approved mock `docs/design-handoff/atoms-plus/index.html` (v3) — no ambient counters; Apple-plain limit copy; no rollover; no “For You” label. Planning HOW below; U1–U4 code partially landed on `feat/atoms-plus-managed-filing`.

## Product Contract

### Summary

Atoms Plus is a **managed filing plane**, not a second product and not a paywall on recall. Strangers (and phone-first users) who will not paste `sk-ant-…` subscribe monthly (with a yearly discount). Atoms routes classify / paid refile through a managed Anthropic path under hard caps. Free users keep full home, library, For you, and BYOK with free-text model choice. Plus never pushes “just use your own key” when the plan is exhausted — wait for reset or optional top-up only. Subscription status works **across devices** (phone + desktop share one plan). **Time-boxed free Plus** (trial and/or promo codes) uses the same entitlement for marketing and testing — not unlimited free managed keys.

**Pricing / model (bakeoff-backed):** Commercial numbers live in repo-root **`plus-pricing.json`** (SSOT — edit there only; plugin `src/shared/plusPricing.ts` + `plus-service` load it). Currently **$6/mo** or **$60/yr**, **150 filings/period**, top-up **+50 for $2**, **14-day trial**. **Sonnet 5-class** + local enrich. **Email magic link** for cross-device. Preview **costs a filing** when classify runs, but **cached results re-open free**. Capture companion / widgets / Efficient mode / multi-tier are out of scope for MVP.

### Problem Frame

Filing already works when a key is present. The drop-off is **identity and setup**: home shows `need_key` when past captures wait and this device has no key (`atomsHomeData` filing hero). Keys are device-local (SecretStorage / non-synced fallback), so phone dogfood forces Anthropic account plumbing per device. Target person: **someone without an Anthropic account who will not go out of their way to get a key**. Today they dump bullets and never file — or abandon the loop. Adjacent paid AI plugins (e.g. Copilot Plus) already sell managed access while free BYOK remains; Atoms should own **classify daily → atoms**, not vault chat.

### Requirements

**R1. Free path complete forever.** Full plugin value — capture→file→For you, library, auto-run (with existing gates), Update notes — remains available on **user-supplied Anthropic key** with no paid tier required. (session-settled: user-directed — free BYOK forever over paywalled core)

**R2. Plus removes key setup, not product features.** Subscribers file without pasting an Anthropic API key. Library, For you, polish, protect-existing, and home habit surfaces are **never Plus-only**. (session-settled: user-directed — managed key convenience over feature lock)

**R3. One plan at launch.** Single **Atoms Plus** SKU: **$6/month** or **$60/year** (~2 months free). No multi-tier ladder (Plus / Plus More) in v1. (session-settled: user-directed — $6/$60; was $5/$50)

**R4. Managed model policy — Sonnet 5-class (MVP).** On Plus, Atoms chooses the filing model: **Sonnet 5-class only** for MVP (best quality on bakeoff ~98% with enrich). No free-text model id on the Plus path. BYOK keeps the existing free-text model setting. Local enrich (idea rescue, person/media links, link-quality rewrite) always runs. **Not in MVP:** user-facing Efficient / lower-model toggle for more filings — track as follow-up issue (session-settled: user-directed — Sonnet-only MVP; Efficient later via issue).

**R5. Included volume = 150 filings/mo; top-up for more; no rollover (MVP).** Product-facing included filings: **150 per billing period**. **Unused filings do not roll over** to the next period (MVP). Allotment resets on the next billing date only. Heavy users buy **top-up packs** (R6). `PER_LAUNCH_CAP` (15 today) remains an engineering auto-run safety fuse, not marketing quota. (session-settled: user-directed — N=150, no rollover for MVP; partial rollover may be considered later)

**R6. Exhaustion: wait + top-up; never push BYOK.** When the 150 included filings are used: managed filing pauses with calm copy; user may **wait for period reset** or buy **+50 filings for $2** (required product path). Limit UX **must not** pitch “use your own API key”. BYOK may remain in Settings for people who already have a key — passive, not marketed on the limit path. (session-settled: user-directed — +50/$2 top-up; wait + top-up over BYOK escape)

**R7. Cross-device via email magic link.** One Plus entitlement covers phone + desktop. **Auth: email magic link** (no password). Sign-in / restore on a second device enables managed filing without re-buying. (session-settled: user-directed — magic link over password/OAuth/license key; cross-device required)

**R8. Trust and egress copy.** Plus onboarding and settings restate what leaves the vault (titles, tags, person-hub titles, capture text → Anthropic over TLS), that the model does not rewrite hand-authored capture bodies, and that captures are not used to train models under the product’s policy. Same honesty bar as existing auto-run egress ack — not silent cloud.

**R9. Real managed filing MVP (first ship).** First paid ship is **working** managed classify for Process / auto-run / Update refile paths that today require a user API key — not waitlist-only, not a marketing page without filing. (session-settled: user-directed — real MVP over fake-door first)

**R10. Home conversion surface.** When past captures wait and the device has neither a usable BYOK key nor active Plus, home offers a clear path to **start filing** via Plus (and still allows BYOK in Settings without shaming). Replaces pure dead-end `need_key` for the target person.

**R11. Plan status visible.** Settings (and home when relevant) show Plus status: active / exhausted / renews when — without a shaming credit arcade on every Process.

**R12. Cost gates stay honest.** Large backfill / Update refile on Plus still **name impact before spend** (in plan units once defined), reusing the spirit of today’s estimate→confirm — never silent burn of the monthly included volume.

**R13. Abuse and margin floors.** Managed path enforces hard server-side caps (daily/monthly and per-run safety). Client-only limits are insufficient. Planning owns mechanics; product requires that worst-case abuse cannot open-endedly bill the operator.

**R14. Filing unit + Preview metering.** A countable unit is a **managed-path Anthropic classify/refile**, including **Preview dry-run** when it actually classifies. Not: opening home, free local polish, or re-opening **cached** Preview results. Pure transport retries: prefer not double-charge. (session-settled: user-directed — Preview costs money when classify runs)

**R14b. Preview cache / no crappy re-charge.** Paid Preview results **persist** for free re-view. Re-charge only when we **re-classify**: new captures, or captures whose inputs changed (capture text / relevant context fingerprint). **Do not** invalidate and re-bill the whole day because one capture or one hub changed — only the affected units. (session-settled: user-directed — per-capture cache invalidation over whole-batch invalidate)

**R15. Trial + promo free months.** (a) **14-day free trial with card upfront** (normal SaaS convert path). (b) **Capped founding/marketing promo codes** granting **1–3 free months** of the same Plus entitlement (limited redemptions; operator-issued). Same managed path, caps, trust copy, cross-device as paid. Not unlimited free managed keys. After window: convert to paid or passive free BYOK. (session-settled: user-directed — 14-day trial + card; promo 1–3 mo capped; not open unlimited codes)

### Scope Boundaries

**In scope**

- One Plus SKU ($6/mo or $60/yr)
- Managed Anthropic proxy path for classify / Preview / auto-run / Update refile
- Cross-device via email magic link
- Exhaustion: wait + **+50/$2** top-up; no BYOK push on limit path
- Preview costs when classify runs; per-capture cache for free re-view
- Trust/egress copy; home/settings Plus status
- Free local polish and full free BYOK path
- 14-day trial (card upfront) + capped promo codes (1–3 free months)


**Deferred for later**

- Capture companion, widgets, share sheet (separate product surface)
- Multi-tier upgrade ladder with proration
- Unattended cloud worker that files when Obsidian is fully closed (beyond existing device auto-run)
- **Efficient model toggle** (Haiku / lower model for more filings at same $6) — post-MVP; tracked as [#90](https://github.com/taihartman/obsidian-atoms/issues/90)
- Multi-provider BYOK, lifetime SKU
- Public Community listing as a hard gate (may ship Plus to dogfooders in parallel)

**Outside this product’s identity**

- Paywalling For you, library, or capture habit
- Vault chat / RAG competitor positioning
- Full standalone second brain that replaces Obsidian as system of record
- Silent training on user captures

### Success Criteria

- A person without an Anthropic account can complete **dump → managed file → open atom** on phone and again on desktop under one subscription.
- Free BYOK user loses no features and keeps free-text model choice.
- Hitting the included cap never surfaces a “paste your API key” upsell.
- Operator can state a hard upper bound on per-user monthly Anthropic COGS under abuse.
- Egress/privacy copy is visible before first managed classify.

### Key Decisions

| ID | Decision | Notes |
|----|----------|--------|
| KD1 | Managed filing plane, not feature paywall | session-settled: user-directed — convenience over locking For you |
| KD2 | One SKU; **$6/mo or $60/yr** | session-settled: user-directed — $60/yr ≈ 2 months free (was $5/$50) |
| KD3 | We pick Plus model (Sonnet 5); BYOK keeps free-text | session-settled: user-approved — margin control |
| KD4 | Cap exhaustion = wait + **+50/$2** top-up; never push BYOK | session-settled: user-directed — protect Plus revenue |
| KD5 | Cross-device via **email magic link** | session-settled: user-directed — over password/OAuth/license key |
| KD6 | Real proxy MVP first ship | session-settled: user-directed — over waitlist-only |
| KD7 | Product quota ≠ `PER_LAUNCH_CAP` | session-settled: user-directed — 15 is safety fuse only |
| KD8 | **$6 + Sonnet 5 + N=150 + top-up; no rollover** | session-settled: user-directed — unused do not bank; top-up for overflow |
| KD9 | **14-day trial + card upfront**; capped promo **1–3 free months** | session-settled: user-directed — short trial + marketing codes |
| KD10 | Bakeoff evidence | Sonnet 5 ~98%, Sonnet 4.5 ~96%, Haiku ~81%; enrich +0 soft judgment; `scripts/plus-model-bakeoff.mjs` |
| KD11 | Preview costs when classify runs; **per-capture cache** | session-settled: user-directed — no double-charge on re-open; only changed captures re-bill |
| KD12 | Efficient mode deferred | session-settled: user-directed — MVP Sonnet only; [#90](https://github.com/taihartman/obsidian-atoms/issues/90) |

### Dependencies / Assumptions

- Anthropic remains the classify backend for v1 (stack today is Anthropic-only).
- Obsidian remains host; Plus does not replace the vault.
- Payment can be completed via web checkout and/or platform-appropriate IAP — planning chooses; product requires cross-device restore either way.
- Demand is assumed from `need_key` pain; no waitlist measurement required before MVP (risk accepted).

### Outstanding Questions

- Q1: ~~N~~ → **150** locked.
- Q2: ~~Top-up~~ → **+50 for $2** locked.
- Q3: ~~Auth~~ → **email magic link** locked.
- Q4: ~~Preview~~ → **counts when classify runs** + **per-capture cache** locked.
- Q5: ~~Trial~~ → **14 days + card upfront** locked.
- Q6: ~~Promo~~ → **capped founding/marketing codes, 1–3 free months** locked.
- Q7: ~~Yearly~~ → **$60/yr** locked (with $6/mo).
- Q8: ~~fingerprint~~ → **KTD-P3** (capture text + model + quality stamp; vault title list not required for cache key).
- Q9: Promo redemption cap defaults — **operator-tunable** (suggest 100); non-blocking.

### Non-goals (v1)

- Capture app / widgets
- Selling storage or Sync
- Multi-model marketplace
- Training or analytics products on vault content

## Planning Contract

### Technical approach

Two deployables:

1. **Plus service** (greenfield, outside the plugin bundle) — email magic-link auth, Stripe (subscription $6/$60, top-up +50/$2, 14-day trial card-upfront, promo codes), entitlement store, **Anthropic proxy** that holds the operator key, meters filings (150/mo + top-ups), enforces hard caps. Never returns the Anthropic master key to clients.
2. **Plugin** — credential resolution **BYOK | Plus session**; when Plus, classify/Preview/Update refile/auto-run call the proxy via `requestUrl` (not raw `fetch`); home CTA replaces dead-end `need_key`; Settings Plus section; **client Preview cache** per R14b.

```
Plugin                          Plus service                     Anthropic
  |-- magic link / session ---->|                                 |
  |-- POST /v1/classify ------->|-- meter + forward ------------->|
  |   (Bearer plus_session)     |-- usage++                       |
  |<-- classification JSON -----|<-- model JSON ------------------|
  |-- BYOK path: existing x-api-key to api.anthropic.com (unchanged)
```

**Credential resolution (plugin):**

```
resolveFilingAuth():
  if plusSession valid && entitlement active → { mode: "plus", token }
  else if getApiKey() → { mode: "byok", apiKey }
  else → { mode: "none" }
```

Limit UX when Plus exhausted: wait + top-up only — **never** pitch BYOK (R6). BYOK remains in Settings for users who already have a key.

**Patterns to follow:** Secret **ids** only in `data.json`; session tokens in **device-local** storage (same family as auto-run flags), never synced vault settings. All network via injectable `requestUrl`. Pure home copy in `atomsHomeData`; actions in view. `PER_LAUNCH_CAP=15` stays engineering fuse; **server** owns 150/mo (R13).

### Key technical decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| KTD-P1 | Separate Plus service + plugin client; plugin never holds Anthropic master key | Abuse, key rotation, Community trust |
| KTD-P2 | `ClassifyDeps` gains optional `plusAuth` / base URL; BYOK path unchanged when `mode=byok` | Minimal blast radius on pipeline |
| KTD-P3 | Preview cache key = hash(captureText + modelId + CURRENT_ATOMS_QUALITY); store result + fingerprint device-local | R14b; title-list churn must not invalidate every capture |
| KTD-P4 | Server returns `remaining` + `periodEnd` on each classify; plugin displays status | Single source of truth for quota |
| KTD-P5 | Stripe Checkout (web) for MVP subscribe/top-up/trial; magic link binds email → customer | Cross-device without App Store first; IAP can follow |
| KTD-P6 | Transport failure (5xx/network) before model response: do not consume filing; 4xx after model: consume | Fair metering |
| KTD-P7 | Plus model fixed server-side (Sonnet 5-class); ignore client model field on Plus path | Margin + R4 |
| KTD-P8 | **UI SSOT = approved mock** `docs/design-handoff/atoms-plus/index.html` (v3). CSS/copy in mock is the product surface; plugin chrome matches mock, not invents meters | User approved mocks 2026-07-17 |
| KTD-P9 | **No ambient remaining/150 UI** — server still meters; client may cache `remaining` for limit detection only. Numbers appear only on Offer / Get More sheets | Minimal UI direction |
| KTD-P10 | **No rollover (MVP)** — allotment resets on billing date only | User-directed |
| KTD-P11 | Limit copy: **“Monthly Limit Reached”** + allotment-starts-over language (not “renews automatically” next to Get More; not “filing paused”) | Apple-plain + anti auto-top-up confusion |
| KTD-P12 | Offer always states: cost reason (AI usage costs us / supports development) + free own-key path | User-directed |

### Implementation status (branch `feat/atoms-plus-managed-filing`)

| Unit | Status |
|------|--------|
| U1 Filing auth | **Landed** (`src/platform/filingAuth.ts`, tests) |
| U2 plusClient | **Landed** (`src/platform/plusClient.ts`, tests) |
| U3 Classify Plus path | **Partial** (`deps.plus` on `classifyCapture`; wire from main/write/preview still open) |
| U4 Preview cache | **Partial** (module landed; not wired into `runDryRun`) |
| U5 UI | **Mock approved** → implement per U5a–U5e below |
| U6 Service | Not started |
| U7 Ship | Not started |

### Assumptions

- Plus service can be a small monorepo package or sibling repo under operator control; planning does not mandate Cloudflare vs Fly vs etc.
- Email delivery (magic link) via Resend/Postmark/SES — planning leaves vendor to implementer.
- Dogfood can use Stripe test mode + private service URL in plugin settings (dev) before public hostname.

### Sequencing

```
U1 ✓ → U2 ✓ → U3 wire remaining call sites → U4 wire cache
U5a pure hero copy → U5b home bind → U5c settings → U5d offer/top-up sheets → U5e fidelity
U6 Plus service (can parallel U5 once API shapes frozen; needed for live checkout)
U7 dogfood + version + README
```

**Recommended next execution slice:** finish U3 call-site wiring + U4 cache wire, then **U5a→U5d** against mock (can use fixture Plus session without full U6 for UI). Live Stripe/trial needs U6.

### Risks

| Risk | Mitigation |
|------|------------|
| Trial abuse / multi-account | Card-upfront trial; server hard caps; promo codes capped |
| Session token in synced `data.json` | Device-local only; document never put in settings object |
| Preview burns 150 on re-open | R14b cache mandatory before Plus GA |
| Mobile magic-link deep link | Open system browser for checkout/login; paste code fallback |
| Community plugin review | Clear egress copy; free core; optional paid convenience language |

## Implementation Units

### U1 — Filing auth resolution (plugin)

**Goal.** Plugin can answer “BYOK, Plus, or none” without calling Anthropic yet.

**Files:** `src/shared/types.ts`, `src/plugin/main.ts`, `test/` (new `filingAuth.test.ts` or extend existing plugin tests)

**Approach.** Introduce `FilingAuth` union type. Extend `getApiKey` usage sites later via `resolveFilingAuth()`. Store Plus session token + email in device-local storage keys (new constants next to `LOCAL_STORAGE_API_KEY`). No network in U1.

**Test scenarios:**
- No key, no session → none
- BYOK only → byok
- Valid session + active entitlement fields → plus (even if BYOK also set: **prefer Plus if active**, else BYOK — document: Plus preferred when entitlement active)
- Expired session → fall through to BYOK or none

**Verify:** unit tests green; no behavior change for existing BYOK users until U3.

---

### U2 — Plus client module (plugin)

**Goal.** Typed HTTP client for Plus service using `requestUrl`.

**Files:** `src/platform/plusClient.ts` (new), tests `test/plusClient.test.ts`

**Approach.** Functions: `requestMagicLink(email)`, `exchangeMagicToken(token)`, `getEntitlement(session)`, `classifyViaProxy(session, body)`, `createCheckout(session, kind)`. Injectable `request` for tests. Redact tokens in logs. Base URL from settings (default production; override for dogfood).

**API shape (directional, not final schema):**

```
POST /v1/auth/magic-link { email }
POST /v1/auth/exchange { token } → { session, email }
GET  /v1/me { Authorization: Bearer session } → { status, remaining, periodEnd, plan }
POST /v1/classify { Authorization, capture, context, ... } → { result, remaining, usageId }
POST /v1/billing/checkout { kind: subscribe_monthly|subscribe_yearly|topup_50|... }
```

**Test scenarios:** mock requestUrl success/401/402(exhausted)/5xx; ensure 402 maps to exhausted UI state without throwing uncaught.

---

### U3 — Pipeline Plus path

**Goal.** Process, Preview, Update refile, auto-run use proxy when `mode=plus`.

**Files:** `src/pipeline/classify.ts`, `src/pipeline/write.ts`, `src/pipeline/preview.ts`, `src/pipeline/refreshAtoms.ts`, `src/plugin/main.ts`, existing classify tests

**Approach.** `ClassifyDeps` includes `filingAuth`. When plus: POST to proxy with session; do **not** send Anthropic `x-api-key`. When byok: existing path. Auto-run: if none, silent skip (today); if plus exhausted, silent or one quiet status (no BYOK pitch). Manual paths: Notice for exhausted with top-up CTA string.

**Test scenarios:**
- byok still hits Anthropic URL with x-api-key
- plus hits proxy URL with Bearer, never Anthropic key header
- 402 exhausted → structured outcome, no vault write

**Execution note:** characterization tests on classify deps injection first if brittle.

---

### U4 — Preview cache (wire-up)

**Goal.** R14/R14b: charge only on real classify; free re-open of valid cache entries. **No ambient remaining UI.**

**Files:** `src/pipeline/preview.ts`, `src/platform/previewCache.ts` (exists), `src/plugin/main.ts`, `test/previewCache.test.ts` + preview integration tests

**Approach.** Module already exists. Wire into dry-run loop: lookup by KTD-P3 key before classify; on hit skip network; on miss classify + put. Device-local store via `LS_PREVIEW_CACHE`. Shared for BYOK and Plus. On 402 from Plus, surface limit UX (U5) — do not show remaining meters.

**Test scenarios:**
- second Preview same capture → 0 network
- capture text change → miss + re-classify
- quality stamp bump → miss
- shared cache for byok + plus

**Verify:** unit + dry-run path tests; no Settings “118/150” chrome.

---

### U5 — Home + Settings (mock-approved) — split units

**Visual SSOT:** `docs/design-handoff/atoms-plus/index.html` (v3) + `docs/design-handoff/atoms-plus/README.md`  
**Gate satisfied:** mock reviewed and approved by product owner (2026-07-17). Implement to match mock copy and hierarchy.

#### U5a — Pure hero / limit copy model

**Goal.** Extend `filingHeroCopy` (and related pure helpers) for Plus states without DOM.

**Files:** `src/home/atomsHomeData.ts`, `test/atomsHomeData.test.ts`

**Approach.** Expand inputs beyond `hasKey`:
- `filingAuthMode`: `none` | `byok` | `plus_active` | `plus_exhausted` (map from `resolveFilingAuth` + status)
- Modes / copy (lock to mock):

| Condition | Title | Body (intent) | Primary | Quiet |
|-----------|--------|---------------|---------|-------|
| past>0, none | N Captures Waiting | Turn past notes into linked atoms with Atoms Plus, or use your own Anthropic API key for free. | **Try Atoms Plus** | **Use My Own Key** |
| past>0, plus_exhausted | **Monthly Limit Reached** | You’ve used this month’s included AI filings. Your allotment starts over on your next billing date. If you need more before then, you can buy additional filings. | **Get More** | **Not Now** |
| past>0, byok or plus_active | (existing enable_auto / auto_on / process paths) | unchanged spirit | existing | existing |

Actions to add: `open_plus` | `open_byok_settings` | `get_more` | `dismiss_limit` (Not Now).  
**Never** primary/secondary that pitches BYOK on exhausted.  
**Never** show remaining counts in hero.

**Test scenarios:**
- none + past → Try Atoms Plus + Use My Own Key; no “Open settings” only
- plus_exhausted → Monthly Limit Reached; Get More; no BYOK string in body
- byok + past → existing auto/process paths (regression)
- past=0 → null hero

**Patterns:** pure functions in `atomsHomeData.ts` (see existing `filingHeroCopy` tests).

---

#### U5b — Home view wiring

**Goal.** Bind new actions in `atomsHomeView` / plugin.

**Files:** `src/home/atomsHomeView.ts`, `src/plugin/main.ts`, `styles.css` only if existing card classes insufficient

**Approach.**
- Pass filing auth into hero builder (from `plugin.resolveFilingAuth()`).
- `open_plus` → open Settings focused on Plus section (or open Offer modal — prefer Settings Plus section first; Offer can be nested).
- `open_byok_settings` → open Settings API key section / focus secret field.
- `get_more` → open Get More sheet / checkout topup_50 via plusClient when session exists.
- `dismiss_limit` → hide soft prompt for session (device-local flag optional).
- Match mock card hierarchy: kicker, title, body, primary then quiet (not three competing primaries).

**Test scenarios:** unit-test pure action resolution if extracted; smoke manual on demo vault.

**Execution note:** Prefer extending existing wait-card DOM builders; avoid new design system. Match `docs/design-handoff/tokens` (flat cards, ≥44px targets).

---

#### U5c — Settings Plus section (status + invite)

**Goal.** Settings surfaces for signed-out / active / limit — **no ambient meters**.

**Files:** `src/settings/settings.ts`, `src/shared/types.ts` (plusBaseUrl optional setting), `styles.css` as needed

**Approach.** `renderPlusSection` after API section (mock order).

**Signed out (S1 mock):**
- Card: kicker Optional · **Skip the API Key**
- Body: files for you; own key free forever; full app either way
- Primary **See Plans** → Offer sheet (U5d)
- Quiet **Enter Promo Code**
- Footer privacy note (TLS / no train)

**Active (S2 mock):**
- Grouped rows: Status Active · Account email · Plan Monthly/Yearly · Renews date  
- **No** remaining / 150 / progress bar  
- **Manage Subscription** · **Sign Out**  
- Footer: own key still available under API Key

**Limit (S3 mock):**
- Same **Monthly Limit Reached** copy as home  
- **Get More** · **Manage Subscription**

**Patterns:** private `renderXSection` + `settingHeading` in `settings.ts`.

**Test scenarios:** pure builders for section model if extracted; otherwise light DOM-free snapshot of copy strings per status.

---

#### U5d — Offer sheet + Get More sheet (copy-locked)

**Goal.** Only places that show **price and 150 / +50**.

**Files:** `src/settings/` or `src/home/` modal helpers (prefer small Modal classes next to settings), `plusClient.createCheckout`

**Offer (buy mock) — required copy beats:**
- Title **Atoms Plus**
- **$6** per month · **$60** per year · save two months
- Bullets: **150 AI filings each month** (classifying/updating); **Unused filings don’t roll over**; no API key setup; library stays free / Plus optional
- Cost: AI usage has a real cost; subscription helps cover it and supports development
- Free path: Prefer to stay free? Own Anthropic API key in Settings. No Plus required
- Primary **Start Free Trial** · Quiet **Not Now**
- Fine print: 14 days free, then $6/month; cancel anytime; card required

**Get More (top-up mock):**
- Title **Additional Filings** / **Get More**
- **$2** · 50 AI filings · one-time  
- Explicit: **Does not change your subscription or renew automatically**
- Primary **Continue** · Quiet **Cancel**

**Test scenarios:** string constants or pure `offerCopy()` / `topUpCopy()` functions unit-tested so copy cannot drift silently.

---

#### U5e — Visual fidelity pass (scoped)

**Goal.** Side-by-side mock vs live at 375-wide: hierarchy, button order, no For You, no meters.

**Files:** screenshots under `docs/qa/screenshots/atoms-plus/`; PR evidence

**Approach.** After U5a–d: seed device-local Plus session fixtures for active/exhausted; screenshot home + settings; compare to mock. Fix only fidelity gaps.

**Verify:** PR links screenshots; world-class-qa optional if desired later.

---

### U6 — Plus service (auth, Stripe, meter, proxy)

**Goal.** Backend that makes U2–U5 real.

**Files:** new service tree (e.g. `plus-service/` or sibling repo) — implementer chooses layout; document entrypoint in README.

**Approach.**
- Magic link email → short-lived token → session
- Stripe: products for $6/mo, $60/yr, one-time +50/$2; Checkout Sessions; webhooks update entitlement
- 14-day trial with card on subscription
- Promo codes: Stripe coupons or app-level codes with max redemptions
- Meter: atomic increment remaining; reject when 0 with 402
- Proxy: inject Sonnet 5 model server-side; forward structured classify body; return usage
- Hard rate limits per session/IP

**Test scenarios:** service unit/integration tests for meter race, webhook idempotency, trial→paid, top-up adds 50.

**Execution note:** smoke-first against Stripe test mode before plugin dogfood.

---

### U7 — Ship readiness

**Goal.** Dogfood end-to-end; docs; version.

**Files:** `README.md` (optional paid language), `manifest.json` / `package.json` version, `docs/security/` note if needed, demo copy

**Approach.** Walk: magic link on desktop + phone, Preview cache, Process, exhaust 150 in test meter or simulate 402, top-up, trial signup. Confirm no BYOK pitch on exhaust. Bump version for user-visible Plus UI.

**Test scenarios:** manual QA checklist in PR body; screenshots under `docs/qa/screenshots/atoms-plus/`.

## Verification Contract

| Gate | Command / check |
|------|-----------------|
| Unit | `npm test` |
| Typecheck | `npm run typecheck` |
| Build | `npm run build` |
| Bakeoff (optional regression) | `npx tsx scripts/plus-model-bakeoff.mjs` with key |
| Service | service test suite + Stripe test webhook |
| Manual | Phone + desktop magic link; Preview re-open free; exhaust UX |

## Definition of Done

- [ ] Free BYOK path unchanged for users without Plus
- [ ] Plus user can file without pasting Anthropic key
- [ ] Server enforces 150 + top-up; **no ambient remaining meter in UI**
- [ ] Preview re-open does not re-bill unchanged captures
- [ ] Exhausted UX: **Monthly Limit Reached** + Get More only (no BYOK pitch)
- [ ] Offer sheet: 150, no rollover, cost reason, free own-key path, trial
- [ ] UI matches approved mock (`docs/design-handoff/atoms-plus/`) within fidelity pass
- [ ] Cross-device magic link works on phone and desktop
- [ ] Privacy/egress copy visible before first managed classify
- [ ] Tests green; version bumped; QA screenshots on PR
- [ ] #90 left open (Efficient mode not in MVP)


## Appendix

### Research breadcrumbs

- Key resolution: `src/plugin/main.ts` getApiKey/requireApiKey
- Classify: `src/pipeline/classify.ts` requestUrl + x-api-key
- Home hero: `src/home/atomsHomeData.ts` need_key
- Auto-run fuse: `src/platform/autorun.ts` PER_LAUNCH_CAP=15
- Settings sections: `src/settings/settings.ts` display()
- Product requirements: this file Product Contract (ce-brainstorm)
- Bakeoff: `scripts/plus-model-bakeoff.mjs`
- Efficient follow-up: https://github.com/taihartman/obsidian-atoms/issues/90

### Origin

Seeded from ce-ideate monetization run + ce-brainstorm Product Contract in this file.
