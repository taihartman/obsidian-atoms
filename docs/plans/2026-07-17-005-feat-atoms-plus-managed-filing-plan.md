---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
title: "Atoms Plus — managed filing plane"
date: 2026-07-17
deepened: 2026-07-17
---

# Atoms Plus — managed filing plane - Plan

## Goal Capsule

**Objective.** Let people who will not set up an Anthropic account file past daily captures through **Atoms Plus** — one paid plan with managed keys — while free BYOK and the full second-brain loop remain complete forever.

**Product authority.** This requirements-only Product Contract. North star and non-negotiables still live in `docs/architecture.md` and `CLAUDE.md` (body sacred, flat atoms, never process today by default, second brain not task app).

**Open blockers.** None product-blocking. Deferred planning choices: Stripe product IDs, proxy host deployment target, promo redemption default cap (operator-tunable).

**Product Contract preservation.** Product Contract unchanged from ce-brainstorm enrichment (R1–R15, KD1–KD12). Planning adds HOW only.

## Product Contract

### Summary

Atoms Plus is a **managed filing plane**, not a second product and not a paywall on recall. Strangers (and phone-first users) who will not paste `sk-ant-…` subscribe monthly (with a yearly discount). Atoms routes classify / paid refile through a managed Anthropic path under hard caps. Free users keep full home, library, For you, and BYOK with free-text model choice. Plus never pushes “just use your own key” when the plan is exhausted — wait for reset or optional top-up only. Subscription status works **across devices** (phone + desktop share one plan). **Time-boxed free Plus** (trial and/or promo codes) uses the same entitlement for marketing and testing — not unlimited free managed keys.

**Pricing / model (bakeoff-backed):** **$5/mo** or **$50/yr** (~2 months free), **Sonnet 5-class** + local enrich, **150 filings/mo**, top-up **+50 for $2**. **14-day trial with card upfront**; capped **founding/marketing promo codes** for 1–3 free months. **Email magic link** for cross-device. Preview **costs a filing** when classify runs, but **cached results re-open free**; only changed captures re-classify/re-charge. Capture companion / widgets / Efficient mode / multi-tier are out of scope for MVP.

### Problem Frame

Filing already works when a key is present. The drop-off is **identity and setup**: home shows `need_key` when past captures wait and this device has no key (`atomsHomeData` filing hero). Keys are device-local (SecretStorage / non-synced fallback), so phone dogfood forces Anthropic account plumbing per device. Target person: **someone without an Anthropic account who will not go out of their way to get a key**. Today they dump bullets and never file — or abandon the loop. Adjacent paid AI plugins (e.g. Copilot Plus) already sell managed access while free BYOK remains; Atoms should own **classify daily → atoms**, not vault chat.

### Requirements

**R1. Free path complete forever.** Full plugin value — capture→file→For you, library, auto-run (with existing gates), Update notes — remains available on **user-supplied Anthropic key** with no paid tier required. (session-settled: user-directed — free BYOK forever over paywalled core)

**R2. Plus removes key setup, not product features.** Subscribers file without pasting an Anthropic API key. Library, For you, polish, protect-existing, and home habit surfaces are **never Plus-only**. (session-settled: user-directed — managed key convenience over feature lock)

**R3. One plan at launch.** Single **Atoms Plus** SKU: **$5/month** or **$50/year** (~2 months free). No multi-tier ladder (Plus / Plus More) in v1. (session-settled: user-directed — $5/$50; one plan over multi-tier)

**R4. Managed model policy — Sonnet 5-class (MVP).** On Plus, Atoms chooses the filing model: **Sonnet 5-class only** for MVP (best quality on bakeoff ~98% with enrich). No free-text model id on the Plus path. BYOK keeps the existing free-text model setting. Local enrich (idea rescue, person/media links, link-quality rewrite) always runs. **Not in MVP:** user-facing Efficient / lower-model toggle for more filings — track as follow-up issue (session-settled: user-directed — Sonnet-only MVP; Efficient later via issue).

**R5. Included volume = 150 filings/mo; top-up for more.** Product-facing included filings: **150 per calendar month** so maxed Sonnet 5 COGS stays ~$2.50 on bakeoff rates (~50% gross at $5). Not “hundreds unlimited.” `PER_LAUNCH_CAP` (15 today) remains an **engineering auto-run safety fuse**, not marketing quota. Heavy users buy **top-up packs** (R6), not a higher tier. (session-settled: user-directed — N=150 with top-up over 150–200 band or Haiku volume play)

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

- One Plus SKU ($5/mo or $50/yr)
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
- **Efficient model toggle** (Haiku / lower model for more filings at same $5) — post-MVP; tracked as [#90](https://github.com/taihartman/obsidian-atoms/issues/90)
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
| KD2 | One SKU; **$5/mo or $50/yr** | session-settled: user-directed — $50/yr ≈ 2 months free |
| KD3 | We pick Plus model (Sonnet 5); BYOK keeps free-text | session-settled: user-approved — margin control |
| KD4 | Cap exhaustion = wait + **+50/$2** top-up; never push BYOK | session-settled: user-directed — protect Plus revenue |
| KD5 | Cross-device via **email magic link** | session-settled: user-directed — over password/OAuth/license key |
| KD6 | Real proxy MVP first ship | session-settled: user-directed — over waitlist-only |
| KD7 | Product quota ≠ `PER_LAUNCH_CAP` | session-settled: user-directed — 15 is safety fuse only |
| KD8 | **$5 + Sonnet 5 + N=150 + top-up** | session-settled: user-directed — ~50% gross if maxed (bakeoff) |
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
- Q7: ~~Yearly~~ → **$50/yr** locked.
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

1. **Plus service** (greenfield, outside the plugin bundle) — email magic-link auth, Stripe (subscription $5/$50, top-up +50/$2, 14-day trial card-upfront, promo codes), entitlement store, **Anthropic proxy** that holds the operator key, meters filings (150/mo + top-ups), enforces hard caps. Never returns the Anthropic master key to clients.
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

### Assumptions

- Plus service can be a small monorepo package or sibling repo under operator control; planning does not mandate Cloudflare vs Fly vs etc.
- Email delivery (magic link) via Resend/Postmark/SES — planning leaves vendor to implementer.
- Dogfood can use Stripe test mode + private service URL in plugin settings (dev) before public hostname.

### Sequencing

```
U1 Credential types + resolveFilingAuth (plugin, tests)
U2 plusClient surface (auth + entitlement + classify HTTP shapes; mockable)
U3 Classify/write/preview/refresh/auto-run branch to proxy
U4 Preview per-capture cache + remaining UI wiring
U5 Home CTA + Settings Plus section + privacy copy
U6 Plus service: auth, Stripe, meter, proxy (can parallel U1–U2 after API contract freeze)
U7 Integration dogfood + version bump + README optional-payments refresh
```

U6 can start once U2 request/response shapes are frozen in a short API contract note under `docs/` or in this plan appendix.

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

### U4 — Preview cache + metering display

**Goal.** R14/R14b: charge only on real classify; free re-open of valid cache entries.

**Files:** `src/pipeline/preview.ts`, `src/platform/previewCache.ts` (new), `src/plugin/main.ts`, tests

**Approach.** Before classify in dry-run loop: lookup cache by KTD-P3 key. Hit → use stored result, do not call network. Miss → classify (proxy or BYOK), store. Cache device-local, size-capped (e.g. last 200 entries). Surface remaining from last proxy response on home/settings.

**Test scenarios:**
- second Preview same capture → 0 network
- capture text change → miss + re-classify
- quality stamp bump → miss
- BYOK path can use same cache (optional) or Plus-only — **prefer shared cache** for both

---

### U5 — Home + Settings product surfaces

**Goal.** Conversion and status UX without paywalling habit features.

**Execution note.** **Mock-first UI before real chrome.** Before shipping production Settings/home Plus UI: (1) static mock or throwaway visual entry / HTML mock of hero + Settings Plus section (states: none / trial / active / exhausted), (2) user review, (3) then implement against the approved mock. Do not jump straight from pure data modes to final CSS in the live plugin without that gate. (session-settled: user-directed — mock before build for U5)

**Files:** `src/home/atomsHomeData.ts`, `src/home/atomsHomeView.ts`, `src/settings/settings.ts`, `styles.css` as needed; mock under `docs/design-handoff/` or `docs/qa/screenshots/atoms-plus/` as agreed at U5 start

**Approach.**
- `need_key` → when past unprocessed and auth none: primary **“Try Atoms Plus”** / open Plus settings; secondary still open settings for BYOK without shame.
- Settings: `renderPlusSection` after API — email, magic link status, remaining 150, period end, subscribe/top-up/open checkout, privacy blurb (R8).
- Model section: when Plus active, show “Managed: Sonnet (Plus)” and disable free-text model for managed path (BYOK model field still available when using own key).

**Test scenarios:** pure functions on hero mode selection (hasKey / hasPlus / pastUnprocessed matrix).

---

### U6 — Plus service (auth, Stripe, meter, proxy)

**Goal.** Backend that makes U2–U5 real.

**Files:** new service tree (e.g. `plus-service/` or sibling repo) — implementer chooses layout; document entrypoint in README.

**Approach.**
- Magic link email → short-lived token → session
- Stripe: products for $5/mo, $50/yr, one-time +50/$2; Checkout Sessions; webhooks update entitlement
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
- [ ] Server enforces 150 + top-up; client shows remaining
- [ ] Preview re-open does not re-bill unchanged captures
- [ ] Exhausted UX offers wait/top-up only (no BYOK push)
- [ ] Cross-device magic link works on phone and desktop
- [ ] Privacy/egress copy visible before first managed classify
- [ ] Tests green; version bumped; QA evidence on PR
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
