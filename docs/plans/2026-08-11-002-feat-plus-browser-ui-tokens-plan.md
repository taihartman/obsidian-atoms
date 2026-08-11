---
title: "Plus browser UI tokens - Plan"
type: feat
date: 2026-08-11
topic: plus-browser-ui-tokens
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Plus browser UI tokens - Plan

## Goal Capsule

- **Objective:** Every first-party page the user sees in an external browser during Plus sign-in, Ask pairing/OAuth, or post-checkout return feels like Atoms on a phone: product tokens, ≥44px targets, readable without pinch-zoom.
- **Product authority:** this Product Contract; design tokens in `docs/design-handoff/tokens/README.md`; tryatoms token values already shipped in `www/src/styles.css` as the browser-side reference. Magic-link behavior stays under the #240 plan (copy, handoff, fallback, no scripts).
- **Open blockers:** none.
- **Stop conditions:** stop if matching tokens requires external CSS/fonts/images under the current landing CSP without an explicit CSP change and test update; stop if any restyle would mint, print, or imply a session outcome the page cannot observe.
- **Execution profile:** `plus-service` only → Fly deploy. No plugin bump, no www rebuild.
- **Tail ownership:** full shipping tail (`ce-simplify-code` → `ce-code-review` → `ce-compound` optional → live smoke of one magic-link + one OAuth page). Human owns Fly promote if CI does not auto-deploy.

**Product Contract preservation:** unchanged — R/A/AE/KD IDs and scope from the requirements-only pass stand. Planning adds HOW only.

## Product Contract

### Summary

Restyle the plus-service HTML shells that open outside Obsidian so they share one product shell: dark-canonical surfaces, light via system preference, tint action color, mobile viewport, and full-width primary buttons. Behavior, routes, and user-facing copy stay frozen. Stripe-hosted Checkout/Portal and third-party docs are out of scope.

### Problem Frame

Setup and Ask pairing send people into Safari or an in-app browser at the highest-trust moments: finishing sign-in, pasting a session, allowing Claude/ChatGPT to read the cloud mirror, landing after Checkout. Those pages are bare light `system-ui` HTML, missing a viewport meta, using Tailwind violet `#7c3aed` instead of product tint `#0a84ff`, and (on OAuth) shipping buttons under the 44px floor. tryatoms and the plugin already speak one token language; plus-service does not. The brand break is most visible exactly where trust matters.

### Key Decisions

- KD1. **One shared product shell for all first-party plus-service HTML.** (session-settled: user-approved — chosen over per-page tint swaps or a full tryatoms chrome clone: one home for tokens, still CSP-safe with inline styles.) Magic-link landings, billing return, and OAuth authorize/chooser/consent/simple messages all render through it.
- KD2. **Dark is canonical; light follows `prefers-color-scheme`.** (session-settled: user-approved — chosen over dark-only or light-only: matches tryatoms and system Safari theme.)
- KD3. **Visual and mobile only; copy and semantic structure stay frozen.** (session-settled: user-approved — chosen over a copy pass: #240 and OAuth tests lock phrases, `id="fallback"`, form fields, and no-script.)
- KD4. **Token source of truth is the design-handoff sheet, with tryatoms CSS as the browser reference values.** Accent is tint `#0a84ff` for primary fills and links. Purple stays typographic-only and never fills a button. No external fonts or images.
- KD5. **CSP for magic-link landings stays `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'`** unless planning proves a change is required and updates the locked tests in the same change. Shell styles are inline. No `<script>`.
- KD6. **Billing return uses the same shell and the same security headers as magic-link landings** (today it only sets `content-type`). Same for OAuth HTML responses where headers are thinner than landing.
- KD7. **Quiet polish is in scope:** a small Atoms eyebrow (`Atoms Plus` / `Atoms Ask` by surface), primary full-width CTAs, secondary elevated CTAs, consent **Allow** stacked above **Deny**, session token in an elevated monospace block that is easy to select. No logo asset, no confetti, no outcome animation, no “signed in” claim the page cannot observe.

### Actors

- A1. **The user on a phone or desktop browser** — opens an emailed magic link, finishes Stripe Checkout, or completes Claude/ChatGPT OAuth.
- A2. **The plus-service HTML shell** — paints every first-party page in this scope.
- A3. **Mail clients and in-app browsers** — often strip or sandbox deep links; troubleshooting copy already covers this and must remain readable on a narrow screen.

### Requirements

**Shell and tokens**

- R1. Every page in scope renders inside one shared shell that sets viewport (`width=device-width, initial-scale=1`), system sans UI stack, and CSS variables for bg, surface, elev, sep, label, muted, tint, radius (12 buttons / 16 cards), and gutter.
- R2. Default theme is dark (`#000` / `#1c1c1e` / `#2c2c2e`, white label, muted secondary). Light theme flips under `prefers-color-scheme: light` with tryatoms-aligned contrast (including darkened tint ink on light).
- R3. Primary actions use solid tint (`#0a84ff`) on white label text, min-height ≥44px, radius 12, full width of the content measure on narrow viewports. Secondary actions use elevated surface + hairline, same touch floor. Interactive press may use brief scale/opacity; no hover-only affordances.
- R4. Body text and controls are readable without horizontal scroll at a 320px-wide viewport. Form inputs use at least 16px font size so iOS does not zoom on focus.
- R5. Content measure stays narrow (about 28–34rem), centered, with ≥16px side gutter.

**Surfaces in scope**

- R6. Magic-link handoff, unbound, dead-link, fallback block, and fallback session pages use the shared shell.
- R7. `GET /v1/billing/return` uses the shared shell and the same security header set as magic-link landings.
- R8. OAuth authorize (email + pairing code), account chooser, consent, and simple status/error messages use the shared shell.
- R9. OAuth consent presents **Allow** as the primary full-width control and **Deny** as a secondary control below it (not two undersized side-by-side buttons).

**Frozen behavior**

- R10. User-facing copy strings on these pages do not change in this work (titles, body sentences, button labels, troubleshooting list, paste instructions). Layout and chrome may wrap them.
- R11. Semantic anchors tests rely on stay: `id="fallback"`, `obsidian://atoms-signin` handoff, fallback POST form, pairing/email field names, Allow/Deny decision values. No new scripts. No session printed except on the existing fallback-session success path.
- R12. Pages still do not assert outcomes they cannot observe (handoff page does not claim “signed in”; billing success still points the user back to Obsidian).

**Out of visual scope (non-goals)**

- R13. Stripe-hosted Checkout and Customer Portal UIs are not restyled.
- R14. tryatoms.app marketing/setup pages are not in this change (already on tokens).
- R15. iCloud Shortcuts install pages and GitHub companion docs are not restyled.
- R16. Plugin in-Obsidian UI and plugin version bump are not required for this server-only visual change.

### Acceptance Examples

- AE1. On an iPhone-width viewport, magic-link handoff shows a dark (or system-light) card-like page, tint **Open Obsidian** ≥44px tall, no horizontal scroll, and still offers troubleshooting + `id="fallback"`. Covers R1–R6, R10–R11.
- AE2. After Checkout, billing return matches the same shell and ships CSP + no-store + nosniff + no-referrer like magic-link. Covers R7, R12.
- AE3. Claude OAuth authorize and consent pages match the shell; email and pairing inputs do not trigger iOS input-zoom; Allow is primary and full-width above Deny. Covers R3, R4, R8, R9.
- AE4. Existing plus-service HTTP tests for magic-link landing, fallback, and Ask OAuth still pass after any assertion updates that only loosen style pinning (not copy or security headers unless KD6 intentionally tightens billing/OAuth headers). Covers R10, R11, KD5, KD6.
- AE5. No page introduces `<script>`, external stylesheets, or purple primary fills. Covers KD4, KD5, R11.

### Scope Boundaries

**In**

- plus-service first-party HTML for magic-link exchange landings, billing return, and OAuth HTML module pages
- Shared shell tokens aligned to design-handoff / tryatoms values
- Header parity for billing return (and OAuth responses as planning specifies)
- Test updates required by the restyle

**Out**

- Stripe-hosted surfaces
- www / tryatoms.app
- Plugin UI and version bump
- Copy rewrites, new flows, JS enhancement
- Email HTML templates (plain-text magic mail stays as today unless a separate claim)

### Success Criteria

- A phone user opening any in-scope URL recognizes Atoms chrome (tint, surfaces, touch targets) without pinch-zoom.
- plus-service test suite green; CSP string for magic-link landings unchanged unless deliberately revised with tests.
- Fly deploy of plus-service is the only release surface required.

### Assumptions

- ASM1. Inline CSS under the existing `style-src 'unsafe-inline'` CSP is sufficient; no CDN or shared static asset host is required.
- ASM2. OAuth `writeHtml` can adopt landing-class security headers without breaking Claude/ChatGPT connectors (HTML body consumers, not header-sensitive API clients).
- ASM3. Tests that match full inline `style="…"` attributes will be updated to assert structure/copy/classes rather than exact old purple hex.

### Risks and Open Questions

- Risk: over-matching tests on inline styles → brittle PR. Mitigation: assert class names / roles / copy, not full style blobs. The existing KTD4 touch-target test that scrapes `min-height` off the `<a>` tag must move to class + shell CSS (U4).
- Risk: light-theme contrast on tint secondary text. Mitigation: follow tryatoms `--tint-ink` darkening under light scheme.
- Deferred (non-blocking): whether a tiny plain-text eyebrow is enough brand (yes per KD7); no data-URI logo.

### Dependencies

- Design tokens: `docs/design-handoff/tokens/README.md`
- Browser token reference: `www/src/styles.css` `:root` and `.btn*`
- Behavior freeze: `docs/plans/2026-08-05-240-feat-magic-link-plugin-handoff-plan.md` (landing semantics)
- Current shells: `plus-service/src/server.mjs`, `plus-service/src/oauth/html.mjs`
- Locked tests: `plus-service/test/http-magic-link-landing.test.mjs`, `http-magic-link-fallback.test.mjs`, `http-ask-oauth.test.mjs`
- Learnings: `docs/solutions/logic-errors/a-double-quote-in-an-inline-style-closes-the-attribute-not-the-value.md` (single-quote font stacks inside any remaining `style="…"`); `docs/solutions/documentation-gaps/setup-docs-written-from-a-configured-machine.md` (structural HTML/CSP tests)

---

## Planning Contract

### Key Technical Decisions

- KTD1. **New module `plus-service/src/html/shell.mjs` is the single home for shell HTML, CSS variables, button classes, and the shared security header map.** Both `server.mjs` and `oauth/html.mjs` / `oauth/routes.mjs` import it. Prefer a new `html/` folder over stuffing shell into `oauth/` (landings are not OAuth).
- KTD2. **Shell API (directional):** export `HTML_SECURITY_HEADERS` (today’s `LANDING_HEADERS` values, CSP string byte-identical), `renderPage({ title, eyebrow?, bodyHtml })` → full HTML document string with `<meta viewport>`, one `<style>` block of product tokens + component classes, and a centered main card. Export small class-name helpers or document the class contract: `btn btn--primary`, `btn btn--secondary`, `field`, `token-block`, `muted`, `stack`, `eyebrow`. Page bodies pass semantic HTML using those classes — not per-control hex inline styles.
- KTD3. **Token values copy from tryatoms `www/src/styles.css` `:root` / light scheme** (bg, surface, elev, sep, label, muted, tint `#0a84ff`, tint-ink, radii 12/16, font stacks). Do not import www CSS as a file (different deploy surface). Keep values in one place inside `shell.mjs` with a one-line comment pointing at the tryatoms source.
- KTD4. **Touch targets live in CSS classes (`.btn { min-height: 44px; … }`)** so primary anchors and buttons share one rule. Update the landing KTD4 test that currently regexes `min-height` on the raw `<a>` tag to assert `btn btn--primary` on the handoff anchor **and** that the shell stylesheet declares `.btn` min-height ≥ 44.
- KTD5. **Unify writers:** `writeLanding` becomes thin (`res.writeHead(status, HTML_SECURITY_HEADERS); res.end(renderPage(…))`). Billing return calls the same path (delete the content-type-only fork). OAuth `writeHtml` merges `HTML_SECURITY_HEADERS` (plus content-length). Cookie-setting OAuth HTML responses that bypass `writeHtml` must also spread the same headers.
- KTD6. **Shared `escHtml`:** move the entity escaper once into `shell.mjs` (or `html/esc.mjs`) and delete the duplicate private `esc` in `oauth/html.mjs` and local `escHtml` in `server.mjs` if both become pure importers. Do not change escaping rules.
- KTD7. **No purple fills.** Replace every `#7c3aed` primary/secondary control with tint classes. Grep the plus-service tree for `7c3aed` at the end of the change; zero hits.
- KTD8. **Consent layout:** Allow = `btn btn--primary` full width; Deny = `btn btn--secondary` full width in a vertical stack with gap. Field labels and inputs use `.field` with `font-size: 16px` minimum on inputs.
- KTD9. **Eyebrow:** plain text above the H1 — `Atoms Plus` for magic-link and billing, `Atoms Ask` for OAuth pages. Not a logo image. Not counted as copy change (chrome, not instructional prose).
- KTD10. **Session token block:** class `token-block` — mono, elevated surface, padding, `word-break: break-all`, `user-select: all` where supported. Copy strings around it stay frozen.

### Technical Design

```
plus-service/src/html/
  shell.mjs          # renderPage, HTML_SECURITY_HEADERS, escHtml, CSS string
plus-service/src/server.mjs
  # writeLanding → renderPage; billing return → writeLanding; fallback/handoff bodies use classes
plus-service/src/oauth/html.mjs
  # htmlPage → renderPage({ eyebrow: 'Atoms Ask', … }); forms use btn/field classes
plus-service/src/oauth/routes.mjs
  # writeHtml (+ cookie HTML path) spreads HTML_SECURITY_HEADERS
plus-service/test/
  html-shell.test.mjs                 # new unit tests on renderPage
  http-magic-link-landing.test.mjs    # viewport, tint class, touch via class+CSS
  http-magic-link-fallback.test.mjs   # headers still; no purple
  http-ask-oauth.test.mjs             # headers + Allow/Deny stack classes
  http-billing-return.test.mjs        # new thin HTTP smoke for headers + shell
```

**CSS shape (directional, not a paste-ready dump):** one `<style>` in the document head with `:root` tokens, `@media (prefers-color-scheme: light)`, reset/`box-sizing`, `body` bg + padding, `.card` surface radius 16, `.btn` / `.btn--primary` / `.btn--secondary`, `.field input`, `.token-block`, `.muted`, `.stack`, `.eyebrow`. Prefer single-quoted font stacks inside any attribute styles that remain (`docs/solutions/logic-errors/a-double-quote-in-an-inline-style-closes-the-attribute-not-the-value.md`).

**Header map (byte-identical CSP for landings):**

```
content-type: text/html; charset=utf-8
content-security-policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
```

OAuth and billing adopt the same map (KD6 / ASM2).

### Codebase Patterns to Follow

- Pure HTML builders in a module + I/O in the route writer (`oauth/html.mjs` already; landings should match).
- Spawn + `fetch` HTTP tests in `plus-service/test/http-*.test.mjs` (no supertest).
- Token hexes and button recipe from `www/src/styles.css` L10–57 and L1029–1064.
- Frozen-copy discipline from #240 landing tests: assert phrases and structure, not full style blobs.

### Implementation Units Summary

| Unit | Goal | Primary files | Tests |
|---|---|---|---|
| U1 | Shared shell module | `src/html/shell.mjs` | `test/html-shell.test.mjs` |
| U2 | Magic-link + billing on shell | `server.mjs` | landing + fallback + new billing HTTP |
| U3 | OAuth HTML + headers on shell | `oauth/html.mjs`, `oauth/routes.mjs` | `http-ask-oauth.test.mjs` |
| U4 | Suite green + purple gone | test updates | full `npm test` in plus-service |

Sequence: U1 → U2 → U3 → U4 (U2 and U3 can parallel after U1 if desired; U4 closes).

### Risks and Dependencies

- **KTD4 test rewrite** is load-bearing — green suite without it would accept undersized CTAs again.
- **Cookie HTML path** in `oauth/routes.mjs` must not skip security headers.
- **Fly deploy** required for production; local `npm test` proves HTML only.
- No plugin or www dependency.

---

## Implementation Units

### U1. Shared HTML shell module

**Goal:** One pure module that renders a full product-token HTML document and exports the shared security headers + escaper.

**Requirements:** R1–R5, KD1–KD2, KD4–KD5, KTD1–KTD3, KTD6

**Dependencies:** none

**Files:**
- Create: `plus-service/src/html/shell.mjs`
- Create: `plus-service/test/html-shell.test.mjs`

**Approach:**
- Implement `renderPage({ title, eyebrow, bodyHtml })` returning a complete document: doctype, charset, viewport meta, title, single style block (dark default + light media query + component classes), body with optional eyebrow, and `bodyHtml` unescaped (caller escapes text nodes).
- Export `HTML_SECURITY_HEADERS` with the exact CSP string locked by landing tests.
- Export `escHtml` with the same entity map as today’s server helper.
- Comment that token hexes track `www/src/styles.css`.
- No network, no `res` object.

**Test scenarios:**
- `renderPage` includes `<meta name="viewport"` with `width=device-width`
- Style block defines `--tint` as `#0a84ff` and `.btn` with `min-height` ≥ 44
- Style block has `prefers-color-scheme: light` overrides
- No `#7c3aed` anywhere in the stylesheet
- No `<script` in output
- `escHtml` escapes `<>&"`
- Document has no external `href`/`src` to http(s) stylesheets or fonts
- Eyebrow when provided appears before the first body content region

**Verification:** `node --test test/html-shell.test.mjs` from `plus-service/`

---

### U2. Magic-link landings and billing return on the shell

**Goal:** Every magic-link HTML path and billing return uses `renderPage` + `HTML_SECURITY_HEADERS`; CTAs use tint button classes; purple gone.

**Requirements:** R6–R7, R10–R12, KD3, KD6–KD7, KTD4–KTD5, KTD7, KTD9–KTD10

**Dependencies:** U1

**Files:**
- Modify: `plus-service/src/server.mjs` (`writeLanding`, `fallbackBlockHtml`, `renderFallbackSession`, `renderHandoffPage`, `renderUnboundPage`, `renderDeadLink`, billing return handler; drop local `LANDING_HEADERS` / duplicate shell / `escHtml` if moved)
- Modify: `plus-service/test/http-magic-link-landing.test.mjs`
- Modify: `plus-service/test/http-magic-link-fallback.test.mjs`
- Create: `plus-service/test/http-billing-return.test.mjs`

**Approach:**
- `writeLanding(res, status, bodyHtml, { title?, eyebrow? })` → headers + `renderPage`.
- Handoff primary: `<a class="btn btn--primary" href="obsidian://…">Open Obsidian</a>` (copy unchanged).
- Fallback submit: `<button type="submit" class="btn btn--secondary">` or primary when promoted — match visual hierarchy (promoted = primary, demoted = secondary) without changing labels.
- Session paste: wrap token in `<p class="token-block">…</p>`.
- Billing return: call `writeLanding` / `renderPage` for ok and cancel; same headers as landings.
- Eyebrow `Atoms Plus` on these pages.
- Keep troubleshooting `<details>`, `id="fallback"`, form action path, and all instructional sentences byte-stable where tests freeze them.

**Test scenarios:**
- Existing landing CSP header equality still passes (byte-identical string)
- Handoff HTML matches `btn btn--primary` on the `obsidian://` anchor; shell CSS still enforces ≥44px (replace old tag-level min-height scrape)
- No `7c3aed` in handoff or fallback HTML
- Viewport meta present on handoff and dead-link
- Fallback success still forbids “Refresh status”; still shows paste + Settings
- Fallback success still has `cache-control: no-store`
- No script; handoff still does not say “Signed in”
- Billing return `ok=1` and `ok=0`: status 200, same CSP/no-store/nosniff/no-referrer, viewport present, no script, titles still “You’re set” / “Checkout canceled”

**Verification:** landing + fallback + billing return test files green

---

### U3. OAuth HTML and response headers on the shell

**Goal:** Authorize, chooser, consent, and simple messages use the shared shell; OAuth HTML responses ship landing-class security headers; consent buttons stacked and ≥44px.

**Requirements:** R8–R9, R3–R4, KD6–KD7, KTD5, KTD8–KTD9

**Dependencies:** U1

**Files:**
- Modify: `plus-service/src/oauth/html.mjs`
- Modify: `plus-service/src/oauth/routes.mjs` (`writeHtml` and any HTML path that sets cookies without `writeHtml`)
- Modify: `plus-service/test/http-ask-oauth.test.mjs`

**Approach:**
- `htmlPage(title, body)` → `renderPage({ title, eyebrow: "Atoms Ask", bodyHtml: body })`.
- Replace inline padding-only buttons with `btn btn--primary` / `btn btn--secondary`.
- Inputs: `class="field"` wrappers; `font-size` ≥16px via CSS.
- Consent: Allow primary full width, then Deny secondary full width (order preserved: Allow first).
- `writeHtml`: merge `HTML_SECURITY_HEADERS` with content-length.
- Audit cookie-setting HTML branch so it does not regress headers.
- Import `escHtml` from shell; delete local `esc`.

**Test scenarios:**
- Authorize HTML still matches `pending_id` and Claude/ChatGPT copy
- Pairing code field and Allow control still present
- Chooser still matches Continue as / account flows
- New: OAuth authorize response carries the same CSP string and `cache-control: no-store` as landings
- New: consent HTML has Allow before Deny; both carry `btn` classes; Allow has `btn--primary`
- New: viewport meta on authorize page
- Existing OAuth happy-path redirects still pass (header change must not break flows)

**Verification:** `node --test test/http-ask-oauth.test.mjs`

---

### U4. Suite close-out and purple purge

**Goal:** Full plus-service suite green; no residual brand-wrong purple; shell coverage complete.

**Requirements:** AE4–AE5, KTD7

**Dependencies:** U2, U3

**Files:**
- Modify: any remaining test that pins old inline styles
- Touch: greps only — no product code unless a stray `#7c3aed` or missing header remains

**Approach:**
- Run `npm test` in `plus-service/`.
- `rg '7c3aed' plus-service` → zero.
- `rg 'htmlPage|writeLanding|billing/return' plus-service/src` sanity that all HTML exits go through shell.
- Fix any test that still expects purple borders or tag-level min-height only.

**Test scenarios:**
- Full suite green
- Optional one-liner unit or grep-backed test that fails if `7c3aed` reappears in `src/**` (nice-to-have; not required if U1–U3 already ban it)

**Verification:** `cd plus-service && npm test`

---

## Verification Contract

- **Unit / HTTP:** from `plus-service/`: `npm test` (or targeted `node --test test/html-shell.test.mjs test/http-magic-link-landing.test.mjs test/http-magic-link-fallback.test.mjs test/http-billing-return.test.mjs test/http-ask-oauth.test.mjs`).
- **Static:** `rg '7c3aed' plus-service` empty; CSP string unchanged in landing header test.
- **Manual smoke (post-deploy or local server):** open handoff HTML and OAuth authorize on a phone-width viewport (DevTools or device); confirm tint primary, no pinch needed, light/dark follows system.
- **No plugin build/lint required** for this change.
- **Deploy:** Fly `plus-service` per repo runbook after merge (human or existing CI).

## Definition of Done

- [ ] U1–U4 complete; `plus-service` `npm test` green
- [ ] No `#7c3aed` in plus-service source
- [ ] Magic-link CSP string still exact-match tested
- [ ] Billing return and OAuth HTML ship landing-class security headers
- [ ] Copy and semantic ids frozen (fallback, Open Obsidian, Allow/Deny, paste path)
- [ ] PR opened; Fly deploy when merged
- [ ] No plugin version bump
- [ ] Optional: one-line `docs/solutions/` note if a durable CSS/CSP lesson emerges beyond existing double-quote-in-style learning
