---
title: "Field notes public archive"
date: 2026-08-06
type: feat
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-brainstorm
origin: ce-brainstorm 2026-08-06
related:
  - docs/plans/2026-08-05-001-feat-tryatoms-mailing-list-plan.md
  - docs/plans/2026-08-04-005-docs-setup-guide-plan.md
  - docs/voice.md
  - docs/field-notes-email.md
  - docs/runbooks/atoms-notes-list.md
  - docs/runbooks/tryatoms-pages-deploy.md
issue: null
lane: light
---

# Field notes public archive - Plan

## Goal Capsule

**Objective:** Let curious tryatoms.app visitors read full past Field notes on the web before (or instead of) joining the email list, with stable per-note URLs and the same site look as the rest of tryatoms.

**Product authority:** This Product Contract. Surfaces: tryatoms.app `www/`. Content source of truth: published note JSON = draft core fields plus `slug`, `date`, optional `tease` (KTD1). Voice: `docs/voice.md`. Parent list: mailing-list plan (archive was deferred there).

**Authority hierarchy**
1. This plan (implementation)
2. Product Contract below
3. Live constraints: `www/src/_headers` CSP, `build:www`, Pages deploy (`docs/runbooks/tryatoms-pages-deploy.md`)

**Open blockers (human / ops — not code-blocked for PR scaffolding):**
- GitHub Issue + STATUS claim before code per `docs/collab.md`.
- Sibling worktree for the feature branch (KD10 / R14) — not the main checkout alone.
- First real Field note content for production launch (tests use a fixture; empty multi-issue history is OK at ship).

**Stop when:** U1–U4 done; `npm run build:www` + www archive tests green; top nav → `/notes/` with archive machinery green (fixture OK for CI); broadcast path promotes to `published/`; draft PR `Closes #<issue>`; worktree used. **Launch** (public promotion): at least one real Field note live on tryatoms.app (KD3) — fixture-only master is not a successful product launch.

**Product Contract preservation:** Unchanged intent from requirements-only. Clarified R6/AE2/F2/SC3/Summary for send→SSOT vs live deploy lag (doc-review). No R-ID scope drop.

---

## Product Contract

### Summary

Add a lean **Field notes** archive on tryatoms.app: top nav opens an index of past notes; each note has a full public URL with the same substance as the email. Signup stays available on the archive (and homepage `#notes`). A successful broadcast writes the note into the published SSOT (send = publish); the live site updates after commit + master Pages deploy. No blog platform features in v1.

### Problem Frame

The live list asks for an email with almost no sample of the notes. Visitors who want to know “what would I get?” have nowhere to look. The mailing-list plan deferred a public archive/blog; drafts and issue inventory are empty until the first real note. Shareable permanent links and a quiet back-catalog are missing too.

### Key Decisions

- **KD1 — Primary job is pre-signup sample.** Secondary jobs (subscriber reread, shareable links, light SEO) come free when notes are full and public. `(session-settled: user-directed — chosen over back-catalog-only or SEO-first: “pre-sign-up sample” as #1 while accepting the rest when cheap)`
- **KD2 — Full note on the web.** Same substance as the email; subscribe for delivery and cadence, not a content gate. `(session-settled: user-approved — chosen over tease-only and single-sample-only)`
- **KD3 — Ship with the first real note.** Build and publish the archive path when the first Field note goes out; a one-item index is success, not a failure. `(session-settled: user-directed — chosen over shell-now or wait-for-2+: “ship the first real note and use that there”)`
- **KD4 — Send is publish.** One artifact; email and web stay aligned. No email-only Field notes in v1. `(session-settled: user-directed — chosen over optional web publish or web-first-then-email)`
- **KD5 — Index + per-issue URLs (shape A).** Not a single long-scroll-only page. `(session-settled: user-directed — chosen over long-scroll B after wanting full note URLs)`
- **KD6 — Top nav primary entry.** Header “Field notes” goes to the archive. Homepage `#notes` signup band may remain for mid-page capture. `(session-settled: user-directed — chosen over #notes-only or both-as-equal-primary)`
- **KD7 — Lean surface.** No comments, tags, search, RSS, CMS, or drafts UI. `(session-settled: user-approved — chosen over RSS-only add-on and richer hub)`
- **KD8 — Keep the name Field notes for v1.** Nav and page titles stay Field notes; rename is a later product pass if the name still feels off after real issues. `(session-settled: user-approved — chosen over Notes / Atoms notes / rename-first)`
- **KD9 — Match existing tryatoms design tokens and layout language.** Archive is not a separate visual system; planning owns CSS/token fidelity, not a new brand.
- **KD10 — Implementation isolation.** Code lands on a feature branch in a **sibling git worktree**, not the main checkout on `master`/`main`.

### Actors

| ID | Actor |
|---|---|
| A1 | Curious website visitor (pre-signup) |
| A2 | List subscriber catching up or rereading on the web |
| A3 | Operator writing/sending Field notes (publish path) |
| A4 | Sharer / linker using a per-note URL outside the site |

### Key Flows

- F1. Pre-signup sample
  - **Trigger:** A1 opens Field notes from top nav (or lands on a shared note URL).
  - **Steps:** Sees index and/or full note; may subscribe from archive CTA; may leave without subscribing.
  - **Outcome:** Enough real content to judge the list; signup optional.
- F2. Send publishes
  - **Trigger:** A3 sends a Field note (approved broadcast path).
  - **Steps:** (1) Resend accepts broadcast; (2) draft is written to published JSON SSOT; (3) operator commits and merges so Pages deploy rebuilds `/notes/`.
  - **Outcome:** Email and published SSOT match; live tryatoms.app matches after deploy (named lag, not silent).
- F3. Share one note
  - **Trigger:** A4 copies a per-note URL.
  - **Steps:** Recipient opens full note without needing list membership.
  - **Outcome:** Note stands alone with site chrome and a quiet path to subscribe or home.

### Requirements

**Discovery and IA**

- R1. Top nav label **Field notes** navigates to the archive index (not only `#notes`).
- R2. Archive index lists published notes newest-first with title, date, and optional one-line tease.
- R3. Each published note has a stable public URL that renders the full note body.
- R4. Homepage may keep a `#notes` signup section; it must not be the only way to discover the archive once nav points at the archive.

**Content and trust**

- R5. Web full note matches the email substance for that issue (no teaser paywall).
- R6. Every successful Field notes broadcast writes that issue into the published archive SSOT (send = publish). Live tryatoms.app shows it after the normal commit + master Pages deploy.
- R7. With exactly one published note, index + that note URL are valid launch states.

**Signup and product boundaries**

- R8. Archive pages include a clear Field notes email signup path consistent with existing list consent/privacy rules.
- R9. Archive does not replace email delivery as the primary ongoing channel; copy may say notes also arrive by email.
- R10. Marketing vs transactional separation from the mailing-list plan still holds (no Plus/session coupling).

**Lean scope and craft**

- R11. v1 has no comments, tags/categories, site search, RSS/Atom feed, CMS admin, or public drafts browser.
- R12. Visual design uses existing tryatoms tokens, type, and layout patterns so the archive feels like the same site.
- R13. Voice matches `docs/voice.md` (quiet confidence; no hype; no em dash habit in product copy).

**Process**

- R14. Implementation work uses a claimed Issue/STATUS row and a sibling worktree off the integration branch, not uncommitted work on the main working tree alone.

### Acceptance Examples

- AE1. Covers R1, R2, R3, R7
  - **Given:** One published Field note exists.
  - **When:** A visitor clicks Field notes in the top nav.
  - **Then:** They reach an index that lists that note and can open its full public URL.
- AE2. Covers R5, R6
  - **Given:** Operator broadcasts a new Field note through the normal path and merges the promoted published JSON to master with Pages deploy.
  - **When:** Broadcast succeeds and deploy finishes.
  - **Then:** Published JSON and live `/notes/<slug>/` carry the same operator-visible substance as the email (paragraphs and optional diagram/figure/cta; not email footer chrome).
- AE3. Covers R8, R11
  - **Given:** A visitor on a full note page who is not subscribed.
  - **When:** They look for next steps.
  - **Then:** They can subscribe with existing consent clarity, and they do not see comments, tags, search, or RSS chrome.

### Success Criteria

- SC1. A cold visitor can answer “what is Field notes?” from the archive without joining the list.
- SC2. A single note is shareable via URL outside the homepage.
- SC3. Operator mental model stays one artifact: one broadcast promotes published JSON; email is live at send; web is live after the documented merge/deploy step (skill checklist includes live URL verify).
- SC4. Design review: archive pages read as tryatoms, not a bolted-on blog theme.

### Scope Boundaries

**In v1**

- Archive index + full issue pages + nav entry + signup CTA + publish-on-send.

**Deferred**

- RSS/Atom feed.
- Rename away from “Field notes.”
- Pagination or year archives if the list grows large.
- Email-only or web-only issues.
- Search, tags, comments, CMS, author bios, related-posts machinery.

**Outside this product’s identity**

- A general Atoms docs site or product changelog blog.
- Gated “members only” note content.
- Community / comments product.

### Dependencies / Assumptions

- Parent list (signup, Resend segment, welcome, privacy, unsubscribe) remains live.
- First real Field note content will exist at or before public promotion of the archive.
- CAN-SPAM / privacy rules for the list still apply to signup CTAs on archive pages.
- `www/` build and Cloudflare Pages deploy path remain the shipping vehicle.

### Outstanding Questions

**Resolved in Planning Contract (see KTDs).** No remaining Resolve-Before-Planning items.

### Sources / Research

- Deferred archive in mailing-list plan: `docs/plans/2026-08-05-001-feat-tryatoms-mailing-list-plan.md`.
- Setup page recipe (new www page + PAGES + CSP tests): `docs/plans/2026-08-04-005-docs-setup-guide-plan.md`.
- Build: `www/build.mjs` (`PAGES`, fingerprint, `render`).
- Nav today: `www/src/index.html.tmpl` Field notes → `#notes`.
- Authoring/send: `docs/field-notes-email.md`, `.agents/skills/field-notes/SKILL.md`, `scripts/field-notes-send.mjs`, `www/functions/_lib/fieldNotesEmail.mjs`.
- Tests: `test/wwwPricing.test.ts` (CSP, scriptless pages, nav), `test/fieldNotesEmail.test.ts`.
- Deploy: `docs/runbooks/tryatoms-pages-deploy.md`; CI paths `www/**` in `.github/workflows/tryatoms-pages.yml`.
- Learnings: setup docs + CSP (`docs/solutions/documentation-gaps/setup-docs-written-from-a-configured-machine.md`); stamp side-effects after delivered send (`docs/solutions/architecture-patterns/a-signal-nobody-receives-is-not-a-signal.md`).

---

## Planning Contract

### Key Technical Decisions

- **KTD1 — Published JSON is web SSOT.** Canonical shipped notes: `docs/field-notes/published/YYYY-MM-DD-<slug>.json`. Public field allowlist only: `subject`, `title`, `preheader?`, `paragraphs[]`, `diagram?`, `figure?`, `cta?`, `secondaryHref?`, `slug`, `date`, `tease?`. Never unsub URLs, postal, API keys, or Resend bodies. Drafts stay in `docs/field-notes/drafts/`. No CMS.
- **KTD2 — Build generates archive HTML from published JSON.** `www/build.mjs` globs **only** `docs/field-notes/published/*.json` (not test fixtures), emits `dist/notes/index.html` and `dist/notes/<slug>/index.html` (`/notes/`, `/notes/<slug>/`). Notes stay **outside** flat `PAGES` (nested pretty URLs). Archive tests assert nested `dist/notes/**` (tokens, no inline style, fingerprinted css/js, em-dash, intentional `app.js`).
- **KTD3 — Web HTML ≠ email HTML.** Email stays in `fieldNotesEmail.mjs` (inline styles). Web helpers live only in `www/lib/fieldNotesContent.mjs` (Node/build-safe; **not** under `www/functions/`). Class-based markup; CSP-safe. Do not port email `figureHtml` raw-src behavior.
- **KTD4 — Filename + slug guards.** Draft basename must match `^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.json$` or promote fails closed (exit non-zero after send if write cannot proceed, with loud recovery text). Slug = capture group 2; reject `..` / path escape; resolve output under `dist/notes/` and assert containment. Slug immutable after first publish.
- **KTD5 — Archive topbar link map + app.js guard.** Archive pages use marketing topbar with **absolute** hrefs: mark → `/`; How/Ask/Catch up/Pricing → `/#how`, `/#ask`, `/#backfill`, `/#pricing`; Field notes → `/notes/` with `aria-current="page"`; Get Atoms → `/#pricing`. Issue pages also have in-body back link to `/notes/` (mobile hides `.topbar-links` under 720px). **Required** `app.js` change: scroll-spy only `querySelector`s hrefs that `startsWith("#")` so `/notes/` does not throw and kill signup binding.
- **KTD6 — Publish after successful broadcast; live after deploy.** After Resend create+send HTTP OK: write published JSON (idempotent). Never on `test` mode. On fs write failure after send OK: exit non-zero + print commit/retry instructions. Skill/runbook checklist: broadcast incomplete for **live** web until merge + Pages deploy + curl/open `https://tryatoms.app/notes/<slug>/`.
- **KTD7 — Homepage discovery.** Topbar Field notes → `/notes/` (R1). Keep `#notes` signup band unchanged (no required mid-page “Read past notes” link in v1; R4 satisfied by topbar).
- **KTD8 — Empty prod vs CI fixtures.** `docs/field-notes/published/` on master holds **only real notes** (or empty + honest empty-state). CI fixtures live under `test/fixtures/field-notes/published/` and are passed into loaders/generator in tests — **not** globbed by production `build:www`. Empty index copy (locked): H1 “Field notes”; body “No notes published yet. Join the list and the first one lands in your inbox.” Signup still present; no fake cards.
- **KTD9 — Deploy CI covers archive.** Workflow `paths` include `docs/field-notes/**` and archive/promote tests. Vitest step runs `test/wwwFieldNotesArchive.test.ts`, content helper tests, and promote/send unit tests (not only wwwPricing + subscribe).
- **KTD10 — Worktree first.** Before U1 code: Issue + STATUS + sibling worktree `../obsidian_plugin-<branch>/`.

### Technical Design

**Content flow**

```
draft JSON (docs/field-notes/drafts/)
    │  field-notes:test  → Resend only (no publish)
    │  field-notes:broadcast --confirm → Resend OK → published JSON
    ▼
published JSON (docs/field-notes/published/)  ← real notes only on master
    │  npm run build:www
    ▼
dist/notes/index.html + dist/notes/<slug>/index.html
    │  commit + master Pages deploy
    ▼
tryatoms.app/notes/ …   (live)
```

**URL map**

| URL | Artifact |
|---|---|
| `/notes/` | Index, newest-first |
| `/notes/<slug>/` | Full note |
| unknown slug | Site `404` (v1); ensure 404 or notes chrome can reach `/notes/` |
| `/#notes` | Homepage signup band |

**Page content order**

- Index: eyebrow/H1 Field notes → short lede → list or empty line → quiet signup (below content).
- Issue: back to `/notes/` → title → date → full body → quiet signup.

**Titles:** index `Field notes · Atoms`; issue `{title} · Field notes · Atoms`; meta description from tease or first paragraph (truncated); canonical paths as above.

**Signup:** Full index form parity: `data-notes-form`, email, hidden `website` honeypot, privacy link, `app.js` → `/api/subscribe` only.

**Figures/diagrams:** `diagram` allowlist (`loop` only → fixed accessible markup with alt/title); else omit. `figure.src` root-relative or `https://tryatoms.app/…` rewritten to path; reject other hosts/schemes. `escapeHtml` text + `escapeAttr` attributes; require figure `alt` or skip figure.

**R5 parity:** Web must include every operator-visible content field present in published JSON (paragraphs, diagram if known, figure, cta/secondaryHref). Not pixel-identical to email.

**Lean chrome:** AE3-shaped check — signup present; no comments/RSS chrome (no large negative matrix).

### Assumptions

- Cloudflare Pages serves nested `index.html` pretty URLs.
- No auto-commit from the send script; human (or agent under explicit ask) commits published JSON.
- Sort key: filename date prefix; if JSON `date` disagrees, filename wins (document in loader).

### Dependencies and sequencing

1. Claim + worktree (KTD10) before code.
2. U1 content helpers + security guards + unit tests.
3. U2 build + styles + empty/real content paths.
4. U3 nav + app.js hash guard + signup parity + R9 copy.
5. U4 promote + skill/runbook + workflow tests/paths.
6. Human launch: first real note on master + live verify (KD3).

### Risks

| Risk | Mitigation |
|---|---|
| app.js throws on `/notes/` href | KTD5 hash-only scroll-spy |
| Email HTML / raw figure.src on web | KTD3 allowlists + escapeAttr tests |
| Publish without deploy | KTD6 checklist + AE2 includes deploy |
| CI fixture pollutes prod sample | KTD8 test fixtures path only |
| docs/ misses Pages CI | KTD9 paths + archive vitest |
| Hostile slug path write | KTD4 regex + path containment |

**doc-review 2026-08-06:** safe_auto + best-judgment gated fixes applied (P0 app.js; send vs live; fixture rule; topbar map; www/lib; slug/escape/figure; promote rules; CI tests; cut optional footer/bridge; R9/meta/empty copy).

---

## Implementation Units

### U1. Published note model + web body helpers

**Goal:** Node-safe pure module: load, validate, escape, render web body fragments.

**Requirements:** R3, R5

**Files:**
- Create: `www/lib/fieldNotesContent.mjs`
- Create: `docs/field-notes/published/.gitkeep` + README drafts vs published
- Create: `test/fixtures/field-notes/published/` sample JSON for tests
- Test: `test/fieldNotesContent.test.ts`

**Approach:**
- `loadPublishedNotes(dir)`, sort by filename date desc; skip invalid.
- `renderNoteBodyHtml(note)` class-based; include cta/secondaryHref when present.
- escapeHtml + escapeAttr; diagram/figure rules per KTD3; slug validate per KTD4.
- No fs APIs under `www/functions/`.

**Test scenarios:**
- Sort two fixtures newest-first.
- Escape poison in title, paragraphs, tease, figure.alt, figure.src (quote breakout).
- Reject slug with `..`; reject external figure host; omit unknown diagram.
- Parity: fixture with paragraphs+diagram+figure+cta appears in web body; no unsub/postal.
- Published field allowlist helper rejects secret-like keys if used by promote.

**Verify:** `npx vitest run test/fieldNotesContent.test.ts`

---

### U2. Build pipeline: `/notes/` index + issue pages + styles

**Goal:** Production build emits archive from real published dir; empty-state honest.

**Requirements:** R2, R3, R7, R11, R12, R13

**Files:**
- Modify: `www/build.mjs` — generate notes after static pages from `docs/field-notes/published/` only
- Create: `www/src/notes.html.tmpl` (+ issue shell as needed)
- Modify: `www/src/styles.css` — `.notes-*` under existing tokens
- Test: `test/wwwFieldNotesArchive.test.ts` (invoke generator with fixture dir and/or temp published)

**Approach:**
- Content order and titles per Technical Design.
- Empty published: locked empty copy (KTD8); still builds.
- Topbar partial uses KTD5 href map; issue has back link to `/notes/`.
- Missing slug: no page emitted; site 404 handles unknown URLs.

**Test scenarios:**
- Generator + fixture dir → index lists note; issue has full substance.
- Production glob with empty published → empty-state string present; no fake cards.
- Nested dist: no leftover `{{tokens}}`; no inline `style=`; fingerprinted cssPath/jsPath; em-dash ban.
- AE3-shaped: signup marker present; no comments/RSS chrome strings.

**Verify:** `npm run build:www` && vitest archive tests

---

### U3. Nav, app.js guard, archive signup

**Goal:** Top nav, scroll-spy safe on archive, signup parity, R9 email-primary copy.

**Requirements:** R1, R4, R8, R9, R10

**Files:**
- Modify: `www/src/index.html.tmpl` — topbar Field notes → `/notes/` only (no required mid-page bridge)
- Modify: notes templates — topbar map + full form parity + `{{jsPath}}`
- Modify: `www/src/app.js` — hash-only section querySelector for topbar scroll-spy
- Modify: `test/wwwPricing.test.ts` — nav href `/notes/`

**Approach:**
- Quiet R9 line on archive (notes also arrive by email).
- Honeypot + privacy link required.

**Test scenarios:**
- Index topbar `href="/notes/"` + Field notes label.
- app.js: non-hash href does not throw (unit or small harness).
- Archive HTML: form marker, honeypot `website`, fingerprinted script, R9 phrase.
- Homepage still has `#notes`.
- Form still posts to `/api/subscribe` only.

**Verify:** vitest www + app-related tests green

---

### U4. Send = publish + operator docs + deploy CI

**Goal:** Broadcast promotes SSOT; operators finish with live verify; CI covers archive.

**Requirements:** R6, AE2

**Files:**
- Modify: `scripts/field-notes-send.mjs` — promote after send OK; filename rules; fail-closed write
- Modify: `.agents/skills/field-notes/SKILL.md` — publish + commit + deploy + live URL check
- Modify: `docs/runbooks/atoms-notes-list.md` — archive URLs + two-step live path
- Modify: `.github/workflows/tryatoms-pages.yml` — paths + vitest archive/content/promote tests
- Test: promote unit tests (test mode no write; broadcast writes allowlisted fields; bad basename fails)

**Approach:**
- Same basename under `published/`; field allowlist only.
- No auto git commit.
- Skill checklist must not mark complete on Resend-only.

**Test scenarios:**
- `test` mode never writes `published/`.
- Happy path writes expected file + allowlisted keys only.
- Bad filename after send → non-zero + message (mock fs).
- Workflow file references archive test paths.

**Verify:** vitest promote tests; workflow YAML grep

---

## Verification Contract

| Gate | Command / check |
|---|---|
| Unit + www | `npm test` (pretest builds www) or targeted vitest files above |
| Build | `npm run build:www` — `dist/notes/**` present |
| CSP / structure | Existing `wwwPricing` assertions still pass; archive covered |
| Manual smoke | Open `www/dist/notes/index.html` via local static server (not `file://`); click through to issue; confirm topbar + form present |
| Deploy | After merge: runbook curl fingerprint; hit `https://tryatoms.app/notes/` |
| Collab | Issue claimed, STATUS row, sibling worktree, PR `Closes #N` |

**Execution direction:** Characterization-style asserts on `dist/` HTML (pattern from setup/pricing tests). No browser e2e required for v1 if dist assertions cover AE1/AE3; optional Playwright later.

---

## Definition of Done

**Global**
- [ ] R1–R14 addressed or explicitly deferred in PR
- [ ] AE1–AE3 evidenced by tests and/or screenshots under `docs/qa/screenshots/` if UI PR policy requires
- [ ] Product Contract preservation note still accurate
- [ ] No email-only notes path left undocumented
- [ ] Worktree + claim + PR link Issue

**Per unit**
- [ ] U1: helpers + tests green
- [ ] U2: build emits index + issue; styles on-token
- [ ] U3: nav + signup wired; pricing/nav tests updated
- [ ] U4: broadcast publishes; skill/runbook/workflow updated
