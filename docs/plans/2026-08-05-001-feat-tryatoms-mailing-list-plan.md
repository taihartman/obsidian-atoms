---
title: "tryatoms mailing list — use-case notes"
date: 2026-08-05
type: feat
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-brainstorm
origin: ce-brainstorm 2026-08-05
doc_review: 2026-08-05
related:
  - docs/plans/2026-07-28-001-feat-tryatoms-landing-page-plan.md
  - docs/runbooks/atoms-plus-prod.md
  - docs/runbooks/tryatoms-domain-cutover.md
  - docs/runbooks/tryatoms-pages-deploy.md
issue: null
lane: light
---

# tryatoms mailing list — use-case notes - Plan

## Goal Capsule

**Objective:** Let visitors who need a capture→recall→deepen loop join a marketing list on tryatoms.app, get a clear welcome, and receive rare real-world use-case notes that show how Obsidian + Atoms help — a path to customers, not a generic newsletter.

**Product authority:** This Product Contract. Landing surface: existing `www/` (tryatoms.app). Mail infrastructure: Resend (already used for Plus magic links — marketing stays separate). Privacy/terms must cover marketing consent before public signup.

**Authority hierarchy**
1. This plan (implementation)
2. Product Contract below (from ce-brainstorm + doc-review)
3. Live constraints: `www/src/_headers` CSP, Pages Direct Upload (`docs/runbooks/tryatoms-pages-deploy.md`)

**Open blockers (human / ops — not code-blocked for PR scaffolding):**
- Physical postal address for CAN-SPAM footers (R12) before **production** marketing sends.
- GitHub Issue + STATUS claim before code per `docs/collab.md`.
- Cloudflare Pages secrets: `RESEND_API_KEY`, marketing From, Segment id (see KTD3).
- Privacy deploy must land with or before public form (R8 hard gate).

**Stop when:** U1–U7 done; `npm run build:www` + www tests green; signup works on Pages preview or production; welcome arrives; privacy live; operator runbook + first Broadcast draft ready; draft PR `Closes #<issue>`.

**Product Contract preservation:** Unchanged from post–doc-review requirements-only text except clarifications implied by KTDs below (welcome = code-sent after contact upsert maps R10; no product scope drop).

---

## Product Contract

### Summary

Add a consent-clear email signup on tryatoms.app that stores contacts in Resend and sends a welcome Automation. Ongoing value is infrequent **use-case notes** (real workflows along the capture→recall→deepen loop), written and sent as Resend Broadcasts. Goal is customer acquisition by showing the loop; Obsidian is the home for the loop, Atoms is how it stays honest.

### Problem Frame

tryatoms.app converts visitors who are ready for install/Plus. Many people like the idea but are not ready to buy. There is no owned channel to stay in touch or teach the product through lived workflows. Resend is already verified for `mail.tryatoms.app` but only powers transactional magic links. Privacy/terms only describe sign-in and billing email — not marketing. Live `www/` CSP is `form-action 'none'` and `connect-src 'self'`, so signup needs a same-origin backend path or an explicit CSP allowlist change.

### Key Decisions

- **KD1 — Minimal marketing list (Approach A).** Signup → Resend Contacts → welcome Automation → manual Broadcasts. Not a content CMS, drip factory, or community product. `(session-settled: user-approved — chosen over capture-only, double-opt-in-first, and auto-draft/community-in-v1: best first marketing step on existing Resend)`
- **KD2 — Content is use-case / workflow stories.** Primary walk-away: “I could run my life like that.” Tips and ship notes only when they serve a story. Seed material: real dogfood (e.g. wedding logistics → atom via Ask/MCP → calendar → daily atom recap). Early notes should include a runnable first step for non-Obsidian readers (minimum setup or pre-install beat).
- **KD3 — Audience is need-based, not Obsidian-gated.** Write for people who need capture fast → trust they’ll find it → deepen later. Obsidian + Atoms is the recommended stack; copy may teach why Obsidian fits. Do not require “already a vault power user” as the only reader.
- **KD4 — Single opt-in with explicit promise.** Crystal-clear purpose + cadence on the form; working unsubscribe on every marketing send. Double opt-in and Resend Topics deferred until multi-type mail or compliance pressure. **Revisit trigger:** first consent/complaint from a strict-jurisdiction reader, or sustained signup volume that makes EU traffic non-trivial (operator judgment with Resend geo/open signals when available) — then DOI or stronger lawful-basis copy.
- **KD5 — Marketing and transactional stay separate at the product layer.** Magic-link / auth mail stays on the transactional path. List signup never grants Plus, never mints sessions, never auto-subscribes Plus users without separate marketing consent. Marketing segment membership is set **only** by the tryatoms signup path (or a future explicit marketing consent UI).
- **KD5b — Shared sending domain accepted for v1 with controls.** Marketing may use `mail.tryatoms.app` with a distinct From local-part (not `plus@`). Distinct local-part does **not** isolate domain reputation. v1 accepts shared-domain risk with: complaint/bounce monitoring, ability to pause all marketing sends without touching magic-link, and SC4. Dedicated marketing subdomain is deferred follow-up if volume or incidents warrant.
- **KD6 — Cadence under-promised.** Form promises rare notes (about once a month or less). Prefer silence over spam.
- **KD7 — Soft UI placement.** **Footer always** for v1; optional one mid-page band after the how/resurface story and **before** pricing. List CTA stays secondary to Get Atoms / install hierarchy. No aggressive popup or content gate.
- **KD8 — First Broadcast is part of launch, not optional polish.** Do not heavily promote the form until one real use-case note is ready to send (or sendable the same day).
- **KD9 — Run-state pause mirrors launch gate.** If no real Broadcast ships for ~3 months (about 3× promised cadence), hide or de-emphasize the public form and stop promoting signup until the next note is send-ready.
- **KD10 — Same-origin signup backend.** Browser must not call Resend directly. Signup posts/fetches to a first-party same-origin endpoint (e.g. Cloudflare Pages Function on tryatoms) **or** planning documents an explicit CSP `connect-src`/`form-action` allowlist change to a named host. Default preference: same-origin on tryatoms to avoid widening CSP.

### Actors

| ID | Actor |
|---|---|
| A1 | Website visitor with capture/recall need (may or may not use Obsidian yet) |
| A2 | List subscriber (after successful signup) |
| A3 | Atoms operator (human) writing welcomes/Broadcasts and monitoring the list |
| A4 | Existing Plus / magic-link user (must not be treated as marketing-subscribed by default) |

### Requirements

**Promise and copy**

- R1. The signup states what the list is (use-case notes on the capture→recall→deepen loop) and approximate cadence (rare / ~monthly).
- R2. Primary CTA language leads with outcome or use-case value, not empty “join our newsletter.” Working defaults (rename-ok): button **Get use-case notes**; helper **Rare notes on capture→recall — about monthly. Unsubscribe anytime.**
- R3. Working name unless renamed in planning: **Atoms Notes** (display); From must not impersonate transactional `plus@` magic-link identity (planning picks exact From local-part on the verified domain).

**Signup and consent**

- R4. Visitor can submit a valid email from tryatoms.app and receive clear success or failure feedback. Named control states: idle; submitting (disable double-submit); client validation fail (empty/malformed); server/network/provider fail (retryable; **do not** claim on-list); success new join; success already-on-list. Success is **inline** in the signup block (not toast-only). New-join success implies check-email / welcome coming; already-on-list is gentle confirmation.
- R5. Successful signup creates or updates a Resend **Contact** and places them on the product’s marketing **Segment**, opted in for marketing Broadcasts.
- R6. Duplicate signup is safe (idempotent): already-on-list is not an error theater; user still gets a coherent success state.
- R7. Invalid email is rejected without creating a contact.
- R7b. Public signup enforces lightweight abuse resistance before contact create / welcome (at minimum per-IP and per-email rate limits; bot friction as needed). Exact mechanism is planning. List-poisoning and welcome-send amplification are in-scope threats.
- R8. Privacy policy (and terms if needed) disclose marketing email, purpose, provider (Resend), how to unsubscribe / contact, and how to request **deletion** of marketing contact data (unsubscribe ≠ delete).
- R9. Signup does not create a Plus account, session, or billing relationship.
- R9b. Resend API credentials stay server-side only (first-party backend). Browser and static `www/` assets never hold Resend secrets; the signup UI calls a first-party endpoint, not Resend directly.

**Welcome**

- R10. New successful signup triggers a welcome message soon after join (best-effort after contact is saved).
- R10b. User-visible success means **on the list**. Welcome delivery is best-effort / soon; do not surface scary failure if contact saved but Automation lags. Operator monitors Automation failures.
- R11. Welcome delivers the promise: what they’ll get, one concrete use-case teaser or link, soft product CTA (tryatoms / install / Plus as appropriate). **Reply-with-your-loop** invite only if a working Reply-To or inbound mailbox exists for the marketing identity; otherwise omit reply invite and point feedback to an owned channel (e.g. GitHub Issues) if needed.
- R12. Every marketing message (welcome and Broadcasts) includes a working unsubscribe path and a valid physical postal address (operator-supplied).

**Ongoing mail**

- R13. Ongoing value is sent as Resend Broadcasts to the marketing segment; operator writes content in Resend (no in-app campaign builder in v1).
- R13b. Each use-case Broadcast includes one soft next step consistent with the story (tryatoms / install / Plus and/or reply-with-loop when inbound exists), without hard-selling. Story stays primary.
- R14. At launch, at least one real use-case Broadcast is drafted and send-ready (content owned by operator; product ships the pipe).
- R15. Marketing sends never reuse magic-link templates or auth-only recipient lists. Broadcasts target only the marketing Segment.

**Trust and separation**

- R16. Transactional magic-link delivery remains unchanged in behavior and purpose.
- R17. A4 is not added to the marketing list solely because they used Plus auth or Checkout.
- R17b. Marketing Segment membership / opt-in is set only by the tryatoms signup path (or a future explicit marketing consent UI) — never by magic-link, Checkout, or generic Contact create used for auth.
- R18. Unsubscribe / Resend unsubscribed state is honored for subsequent Broadcasts.
- R18b. After unsubscribe, a later form submit on tryatoms **re-opts in** (fresh consent): Contact is opted in again, may receive welcome per once-ever policy, and is eligible for Broadcasts. Success UI may note they’re back on the list.
- R18c. Operator can pause all marketing sends (Broadcasts + welcome Automation) without disabling transactional magic-link mail.

**Placement and experience**

- R19. Signup appears as a soft block: footer always; optional mid-page band after how/resurface and before pricing. Consistent with existing dark-first landing design language. Secondary to primary install CTAs.
- R20. Mobile and desktop both usable for the form; no popup gate in v1.
- R20b. Accessibility: visible label (or equivalent), errors associated/announced to the field, full keyboard submit, focus management on success/error. Match existing tryatoms control patterns.

### Key Flows

- F1. **Join**
  - **Trigger:** A1 submits email on tryatoms signup.
  - **Actors:** A1, system, Resend
  - **Steps:** Client validate → first-party backend (abuse checks) → create/update Contact + marketing Segment → success UI → welcome Automation best-effort.
  - **Outcome:** A2 on list; welcome soon (provider delay / failure does not undo on-list success).
  - **Covered by:** R4–R12, R7b, R9b, R10b, R19–R20b

- F2. **Already joined**
  - **Trigger:** Same email submits again while still opted in.
  - **Steps:** Idempotent upsert; gentle already-on-list success; prefer no duplicate welcome.
  - **Covered by:** R6, R4

- F3. **Receive ongoing note**
  - **Trigger:** A3 sends a Broadcast.
  - **Steps:** Resend delivers to marketing Segment minus unsubscribed; body is a use-case story + soft next step; unsubscribe works.
  - **Covered by:** R12–R15, R13b, R18

- F4. **Unsubscribe**
  - **Trigger:** A2 uses unsubscribe in a marketing mail.
  - **Outcome:** No further marketing Broadcasts; transactional auth mail unaffected.
  - **Covered by:** R12, R16, R18

- F5. **Plus user who never opted into marketing**
  - **Trigger:** A4 uses magic link or Checkout only.
  - **Outcome:** Not on marketing Segment; no marketing mail.
  - **Covered by:** R17, R17b, R15, KD5

- F6. **Re-subscribe after unsubscribe**
  - **Trigger:** Previously unsubscribed email submits the form again.
  - **Steps:** Treat as fresh consent; opt in; place on marketing Segment; success UI; welcome per once-ever policy.
  - **Covered by:** R18b, R5, R4

- F7. **Cadence pause**
  - **Trigger:** No real Broadcast for ~3 months while form is public.
  - **Steps:** Hide or de-emphasize form; stop promoting signup until next note is send-ready.
  - **Covered by:** KD9

### Acceptance Examples

- AE1. New email on form → Contact in Resend marketing Segment + welcome soon + privacy mentions marketing (live).
- AE2. Same email twice while opted in → second submit succeeds without scary error; list has one contact.
- AE3. Garbage email → rejected; no contact.
- AE4. Welcome names cadence/promise, includes one use-case beat, CTA, unsubscribe; reply invite only if Reply-To works.
- AE5. Operator sends first use-case Broadcast at launch; test send to self works before audience send; note includes soft next step.
- AE6. Unsubscribed contact does not receive the next Broadcast; can still receive magic link if they use Plus.
- AE7. Completing Plus checkout alone does not add the customer to the marketing Segment.
- AE8. After unsubscribe, form submit again re-opts in and makes them eligible for Broadcasts again.
- AE9. Rapid bulk submits from one IP are rate-limited; contacts/welcomes are not unbounded.
- AE10. Static www never contains a Resend API key; browser only talks to first-party endpoint.

### Scope Boundaries

**In**

- tryatoms.app signup UI (footer + optional mid-page)
- Same-origin (or explicitly CSP-allowed) first-party backend to Resend Contacts + Segment
- Validation, rate limits / bot friction, server-only secrets
- Welcome Automation (or equivalent)
- Privacy (and terms if required) marketing + deletion disclosure
- Operator runbook: Broadcasts, From, test send, pause marketing, monitoring
- First use-case Broadcast content readiness (human-written)

**Out**

- Double opt-in (unless revisit trigger fires)
- Resend Topics / multi-preference center (single content type)
- Dedicated marketing subdomain (deferred; v1 accepts shared domain + kill-switch)
- Auto-draft emails from vault atoms / Cowork pipelines
- Subscriber-submitted “share your loop” product surface
- Auto-subscribe Plus customers without marketing consent
- In-plugin or custom campaign builder
- Aggressive popups, exit-intent, lead magnets PDF factories
- Full blog/CMS as a prerequisite (optional later)
- Changing magic-link auth behavior
- Paid ads / referral program / multi-step drip sequences
- Full attribution dashboard (light UTM optional later)

### Success Criteria

Within ~90 days of public signup:

- SC1. Operator can sustain the habit: several real use-case notes sent (not zero after launch).
- SC2. List has real external subscribers (not only team / not obvious bot flood); open rates not catastrophic; unsubscribes not a flood.
- SC3. At least some human signal: replies (if inbound), “I tried this,” or anecdotal install/trial stories.
- SC4. No deliverability incident that impairs transactional magic-link; no consent complaints from silent Plus→list adds; marketing pause used if complaint/bounce thresholds breached.
- SC5. Path-to-customer signal: operator can point to at least a few subscriber-attributed install, trial, or Plus stories (reply anecdotes, support mentions, or light UTM’d clicks) — qualitative is enough in v1; not “list grew but never converted” as sole win.

### Assumptions

- A-assump1. Verified Resend domain `mail.tryatoms.app` remains available; marketing From uses that domain with a distinct local-part from `plus@`. Shared reputation risk accepted per KD5b.
- A-assump2. Single opt-in is acceptable for v1 given clear promise and easy unsubscribe; revisit per KD4 trigger.
- A-assump3. Working list name **Atoms Notes** is fine until a better brand is chosen; renaming is copy-only.
- A-assump4. First Broadcast content is operator-owned (wedding→atom story or peer); engineering does not generate the essay in v1.
- A-assump5. Live www CSP (`form-action 'none'`, `connect-src 'self'`, locked in www pricing tests) requires same-origin backend or a deliberate CSP change documented in planning.
- A-assump6. Resend account tier supports Contacts, Segments, Broadcasts, Automations, and unsubscribe tokens used in this contract.

### Outstanding Questions

- Q1. Exact From display + local-part (`notes@…` vs `hello@…` vs other) — planning default + human confirm.
- Q2. Physical postal address for footers — human must supply before production marketing sends.
- Q3. Welcome on duplicate signup / re-opt-in: suppress vs send once-ever — planning default: suppress if already welcomed recently.
- Q4. GitHub Issue number and owner claim — required before implementation per collab rules.
- Q5. Pages Function on tryatoms vs other first-party host — planning chooses within KD10.
- Q6. Exact complaint/bounce thresholds for marketing pause — planning + operator runbook.

### Deferred to Follow-Up

- Double opt-in / Topics when content types split or compliance needs harden
- Dedicated marketing subdomain / ESP for reputation isolation
- Auto-draft from personal atoms / scheduled Cowork
- Community loop collection
- Public archive of past notes (blog)
- Attribution dashboards beyond light UTM
- Segmenting Plus customers who *explicitly* opt into marketing

---

## Research breadcrumbs (non-normative)

- Resend: Contacts, Segments, Broadcasts (`{{{RESEND_UNSUBSCRIBE_URL}}}`), Automations for welcome-style flows; Topics only when multiple marketing content types.
- CAN-SPAM: accurate From/subject, physical address, working opt-out, honor promptly; commercial messages include list mail.
- Practice fit for indie products: permission + clear promise, welcome with immediate value, rare excellent cadence, separate transactional vs marketing, measure signups/opens/replies before heavy automation.
- Doc-review 2026-08-05: CSP/same-origin, abuse R, shared-domain kill-switch, form states, SC5 path-to-customer, re-opt-in, reply-only-if-inbound, KD9 pause.
- Repo: `www/src/_headers` locks CSP; `plus-service/src/email.mjs` is magic-link `POST /emails` only; no Contacts API yet; rate-limit pattern in `plus-service/src/ratelimit.mjs`; Pages deploy `.github/workflows/tryatoms-pages.yml` → `wrangler pages deploy www/dist`.

---

## From 2026-08-05 review (resolved into contract)

Applied via safe_auto + best-judgment: flow coverage fixes; server-only secrets; privacy deploy gate; CSP/same-origin; abuse R7b; form states + inline success; a11y; welcome best-effort; reply conditional on inbound; shared-domain accept + pause; marketing segment only from signup; re-opt-in after unsub; Broadcast soft CTA; SC5; KD7 placement; KD9 cadence pause; KD4 revisit trigger; retention/deletion in privacy.

---

## Planning Contract

### Key technical decisions

| ID | Decision | Rationale |
|---|---|---|
| KTD1 | **Cloudflare Pages Function** on tryatoms for `POST /api/subscribe` (same-origin). Not a plus-service route. | CSP is `form-action 'none'` + `connect-src 'self'` (`www/src/_headers`). Same-origin keeps CSP; avoids CORS and coupling marketing abuse to Plus auth host. |
| KTD2 | **CSP unchanged** for v1 (`connect-src 'self'`). | Browser only `fetch('/api/subscribe')`. Any CSP widen is a deliberate product change + `test/wwwPricing.test.ts` update. |
| KTD3 | **Secrets on Pages:** `RESEND_API_KEY`, `ATOMS_NOTES_FROM` (e.g. `Atoms Notes <notes@mail.tryatoms.app>`), `RESEND_MARKETING_SEGMENT_ID`, optional `ATOMS_NOTES_REPLY_TO`, `ATOMS_NOTES_POSTAL_ADDRESS` (footer text). | Server-only (R9b). Segment created once in Resend dashboard; id in env. |
| KTD4 | **Welcome = code-sent** after Contact upsert via Resend `POST /emails` (marketing From + unsubscribe header/footer). Not Resend Automations UI dependency. | Maps R10 outcome; testable; one deploy path. Resend Broadcasts remain for ongoing notes (operator UI). |
| KTD5 | **Contact + Segment only from this endpoint.** Create/update Contact with `unsubscribed: false` on (re)subscribe; add to marketing Segment; never called from Plus auth. | R17b. Magic-link path stays `email.mjs` only. |
| KTD6 | **In-function rate limit** (IP + email keys, sliding window or CF cache/KV if available; start with in-memory + CF edge IP). | R7b. Pattern inspired by `plus-service/src/ratelimit.mjs` but isolate in `www/functions` (no plus-service import). Optional honeypot field ignored by bots. |
| KTD7 | **Pure helpers** in `www/functions/_lib/` (or `www/lib/` imported by function) for validateEmail, normalize, rate-limit keys — unit-tested with vitest from repo root. | Test without spinning CF runtime for core logic. |
| KTD8 | **Form:** footer always + optional mid-page band before pricing; `app.js` progressive enhancement. | KD7. No framework; match dark tokens in `www/src/styles.css`. |
| KTD9 | **Deploy:** extend build/workflow so Pages Functions ship with `www/dist` (see U5). Document secrets in runbook. | Today workflow only deploys static dist. |
| KTD10 | **Defaults:** From `Atoms Notes <notes@mail.tryatoms.app>`; list name Atoms Notes; welcome suppress if already welcomed in last 7d when detectable; no reply invite until Reply-To set. | Closes Q1/Q3/R11 for implementers. |

### Architecture sketch

```
[tryatoms.app form] --fetch POST /api/subscribe--> [Pages Function]
                                                      |-- validate + rate limit
                                                      |-- Resend Contacts API (upsert + segment)
                                                      |-- Resend Emails API (welcome, marketing From)
                                                      v
                                              [Resend Segment "Atoms Notes"]
                                                      |
                                      operator Broadcasts (Resend UI)
```

plus-service / magic-link path **unchanged**.

### Dependencies / sequencing

1. Human: create Resend Segment “Atoms Notes”; confirm From on `mail.tryatoms.app`; set Pages secrets (can be after code on preview with test key).
2. U1 pure helpers + tests  
3. U2 subscribe Function + Resend client  
4. U3 form UI + styles  
5. U4 privacy/terms  
6. U5 build/deploy wiring  
7. U6 runbook + first Broadcast checklist  
8. U7 integration smoke + claim/PR evidence  

### Risks

| Risk | Mitigation |
|---|---|
| Pages Functions + Direct Upload misconfigured → 404 on `/api/subscribe` | U5 verifies deploy docs; smoke curl on preview |
| Shared `mail.tryatoms.app` reputation | KD5b; pause marketing; distinct From; monitor Resend |
| Welcome without unsubscribe | KTD4 requires unsubscribe URL/footer on welcome |
| Missing postal address | Block production Broadcast/welcome until env set; fail closed if missing in prod |
| Bot flood | R7b rate limits; honeypot |

---

## Implementation Units

### U1. Subscribe pure helpers + unit tests

- **Goal:** Email validation, normalization, rate-limit keying, response shape helpers — no network.
- **Files:** `www/functions/_lib/subscribeCore.mjs` (or `.ts` if build allows — prefer plain ESM JS for CF Functions), `test/wwwSubscribeCore.test.ts`
- **Approach:** `normalizeEmail`, `isValidEmail` (practical RFC-lite), `clientIpFromRequest` headers, sliding-window rate limit interface with injectable clock/store for tests. Export success/error codes: `ok_new`, `ok_existing`, `invalid_email`, `rate_limited`, `upstream_error`.
- **Test scenarios:**
  - Valid emails normalize lower-case trim
  - Invalid rejected
  - Rate limit trips after N hits same IP or email
  - Codes stable for UI mapping
- **Traces:** R4, R7, R7b

### U2. Pages Function `POST /api/subscribe`

- **Goal:** Same-origin API: validate → rate limit → Resend Contact upsert + Segment → welcome email best-effort → JSON response.
- **Files:** `www/functions/api/subscribe.js` (CF Pages Functions file-based routing), `www/functions/_lib/resendMarketing.mjs`
- **Approach:**
  - Accept JSON `{ email }` (+ optional honeypot field; if filled, return fake success without Resend).
  - Env: `RESEND_API_KEY`, `ATOMS_NOTES_FROM`, `RESEND_MARKETING_SEGMENT_ID`, optional `ATOMS_NOTES_REPLY_TO`, `ATOMS_NOTES_POSTAL_ADDRESS`, `ATOMS_NOTES_KILL_SWITCH=1` pauses new signups/welcomes with 503.
  - Resend: create/update contact (`unsubscribed: false` on subscribe/re-opt-in); add to segment; send welcome text/HTML with unsubscribe (Resend contact unsubscribe / headers per current Resend marketing docs) + postal address line.
  - Do not throw user-visible distinction for “already on list” vs new beyond `code` field for UI.
  - Never log full API key; log Resend status codes only.
- **Test scenarios:**
  - Unit/mock Resend: new contact path; existing contact re-opt-in sets unsubscribed false; Resend 5xx → `upstream_error` without claiming success; kill switch; honeypot short-circuit
  - Manual: curl against local `wrangler pages dev` when available
- **Traces:** R5, R6, R9b, R10, R10b, R12, R17b, R18b, AE1–3, AE8–10

### U3. Landing form UI (footer + mid-page)

- **Goal:** Soft signup blocks with R4 states, a11y, KD7 placement.
- **Files:** `www/src/index.html.tmpl`, `www/src/styles.css`, `www/src/app.js`
- **Approach:** Markup for form (email, submit, status region `aria-live`); footer always; mid-page band before pricing section. `app.js`: prevent default, fetch `/api/subscribe`, map codes to inline messages. Working copy per R2. Disable double-submit while pending.
- **Test scenarios:**
  - Manual browser: mobile + desktop states
  - Optional: lightweight DOM test if pattern exists; else QA screenshots under `docs/qa/screenshots/atoms-notes/`
- **Traces:** R1–R4, R19–R20b, KD7

### U4. Privacy + terms marketing disclosure

- **Goal:** R8 live before/with form.
- **Files:** `www/src/privacy.html.tmpl`, `www/src/terms.html.tmpl` (if needed)
- **Approach:** Add marketing list section: purpose (Atoms Notes use-case notes), Resend as processor, unsubscribe, deletion request contact, cadence. Keep existing Plus sign-in/billing language.
- **Test scenarios:** build includes new strings; manual read-through
- **Traces:** R8, AE1 privacy clause

### U5. Build, Functions deploy, CI secrets wiring

- **Goal:** Functions deploy with static site; secrets documented; workflow path filters include functions.
- **Files:** `www/build.mjs` (copy functions into deploy layout if required), `.github/workflows/tryatoms-pages.yml`, `docs/runbooks/tryatoms-pages-deploy.md`, `docs/runbooks/atoms-notes-list.md` (new)
- **Approach:** Confirm Cloudflare Direct Upload + Functions layout for this monorepo (likely `www/functions` + deploy command flags). Extend workflow to deploy functions + set note that secrets are Pages project env (Production). Update path filters for `www/functions/**`. Document `wrangler pages secret` / dashboard steps.
- **Test scenarios:**
  - CI build still green
  - After deploy: `curl -X POST https://tryatoms.app/api/subscribe` with test email returns JSON (or preview URL)
- **Traces:** KTD1, KTD9, R9b

### U6. Operator runbook + first Broadcast checklist

- **Goal:** Human can send Broadcasts, pause marketing, prepare first note without engineering.
- **Files:** `docs/runbooks/atoms-notes-list.md`
- **Approach:** Create Segment; From identity; welcome content outline; first use-case Broadcast (wedding→atom seed or peer); soft CTA; postal address; kill switch / pause; KD9 3-month pause; SC5 anecdotal tracking; do **not** auto-subscribe Plus users.
- **Test scenarios:** checklist review; no automated test
- **Traces:** R13–R15, R13b, R14, R18c, KD8, KD9, SC1–SC5

### U7. End-to-end verification + collab shipping tail

- **Goal:** Claim, PR evidence, screenshots, AE matrix.
- **Files:** `STATUS.md`, GitHub Issue/PR, `docs/qa/screenshots/atoms-notes/` (as needed)
- **Approach:** Issue + draft PR `Closes #`; fill AE1–AE10 against preview/prod; screenshot form success states; confirm magic-link still works (AE6/AE7).
- **Test scenarios:** AE1–AE10 manual; plus magic-link smoke unchanged
- **Traces:** all AE*, collab rules

---

## Verification Contract

| Layer | What |
|---|---|
| Unit | `test/wwwSubscribeCore.test.ts` (+ Resend mock tests for U2 if colocated) |
| Build | `npm run build:www`; existing `test/wwwPricing.test.ts` still locks CSP string |
| Integration | `wrangler pages dev` or preview URL: POST subscribe + inbox welcome |
| Product | AE1–AE10; privacy page; form a11y keyboard path |
| Regression | Magic-link send still works on plus-service; no Plus→list side effect |

**Execution direction:** characterization not required (greenfield). Smoke-first on Pages preview after U5 before heavy promotion of the form (KD8).

---

## Definition of Done

- [ ] U1–U7 complete
- [ ] Product Contract R1–R20b satisfied on live or preview
- [ ] Privacy marketing section live with form
- [ ] Resend Segment populated only via signup endpoint
- [ ] Welcome + Broadcast path include unsubscribe + postal address
- [ ] Runbook published; first Broadcast draft ready
- [ ] Issue claimed; draft PR with `Closes #`; QA screenshots linked
- [ ] No CSP widen unless explicitly decided and tests updated

---

## Multiplayer / claim

Before code: GitHub Issue (e.g. “tryatoms Atoms Notes mailing list”), STATUS row, draft PR. Hot files: `www/**`, `.github/workflows/tryatoms-pages.yml`, `docs/runbooks/*`. No plugin `main.js` / version bump required unless a later “See notes” link is added (out of v1).
