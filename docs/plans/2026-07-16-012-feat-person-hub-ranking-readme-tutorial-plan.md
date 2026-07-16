---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
title: "feat: Person hub ranking + README tutorial screenshots"
date: 2026-07-16
---

# feat: Person hub ranking + README tutorial screenshots

## Goal Capsule

Ship smarter person-hub discovery (path is a **boost**, not a free-pass gate; cap top-N; kill `Personal notes/` free pass) and land the README how-to-use walkthrough with synthetic dogfood screenshots already captured under `docs/media/readme/`.

**Success:** Real people under `Social/` / `People/` and tight person-shaped notes still repair-link; topic pages under `Personal notes/` (Book list, Movie list, …) stop being hubs; README tutorial images are committed and linked; version bump for user-visible ship.

---

## Problem Frame

1. **Hub discovery** (`discoverPersonHubs`) uses KTD-P3 path **allowlist as a gate**. On Remote Vault that both (a) promotes ~16 non-people under `Personal notes/` and (b) cannot promote person notes outside those paths for **repair** (model may still link via full titles).
2. **README** has a How-to-use walkthrough and screenshots in the working tree; they must land on the remote with synthetic dogfood only (no personal vault content).

---

## Product Contract

### Requirements

| ID | Requirement |
|---|---|
| R1 | Path segments `Social/` and `People/` **boost** hub score; they are not the only way to become a hub. |
| R2 | Whole-tree `Personal notes/` is **not** a free pass (amend KTD-P3). Mild boost only if we keep the segment at all; default recommendation: no free pass. |
| R3 | Hard **denylist** folders unchanged (`Atoms`, `Daily`, `Projects`, …). |
| R4 | Person-like basename heuristic remains; multi-word topic titles rank lower than 1-word proper names. |
| R5 | Discovery returns **top N** hubs by score (default N=40) for prompt + repair. |
| R6 | Optional signals when cheap: frontmatter/tag `#person` boost; otherwise skip inbound-link count if expensive. |
| R7 | `enrichPersonLinks` gates unchanged (atom + person-shaped + mention). No auto-create hubs. |
| R8 | Unit tests: Social/People people in; Book list / Cooking out; root tight person-like can enter if score high enough (or with `#person` tag). |
| R9 | README How-to-use section + `docs/media/readme/*.png` + `scripts/seed-demo-vault.mjs`; `docs/media/demo-vault/` gitignored. |
| R10 | Version bump (manifest + package + versions.json) for user-visible ship. |

### Scope boundaries

**In:** `people.ts` discovery scoring, tests, README/media/seed, version.

**Out:** Auto-create person notes; settings UI for paths; embeddings; changing repair aboutness; processing personal vault data into screenshots.

### Deferred to follow-up

- Dry-run/Notice “no person hub matched” copy (nice UX; not blocking this ship).
- Inbound backlink count as rank signal (needs metadataCache graph walk).

---

## Key Technical Decisions

| # | Decision | Rationale |
|---|---|---|
| KTD1 | **Score → filter → top N** replaces allowlist-only gate | (session-settled: user-approved — chosen over pure allowlist gate: false hubs under Personal notes + Apple zero-config) |
| KTD2 | **High boost:** `Social/`, `People/`. **No free pass** for entire `Personal notes/` | (session-settled: user-approved — chosen over keep Personal notes free pass: Remote Vault measurement 18 hubs ~2 real people) |
| KTD3 | **Cap N=40** (constant) for hubs sent to model/repair | (session-settled: user-approved — chosen over uncapped list: prompt noise) |
| KTD4 | Repair API + person-shaped gates **unchanged** | (session-settled: user-approved — chosen over expanding repair to all name mentions: KTD-P1/P4 safety) |
| KTD5 | **No auto-create** person hubs | (session-settled: user-approved — chosen over stub creation: KTD-P2) |
| KTD6 | Ship **README tutorial screenshots** + seed script with synthetic dogfood only | (session-settled: user-directed — chosen over omitting media / using personal vault: privacy + docs completeness) |
| KTD7 | Amend mental model of plan KTD-P3 in architecture/people comments; full re-doc of 002 plan not required | Implementation is source of truth for discovery width |

### Alternatives considered

| Approach | Why not |
|---|---|
| Drop allowlist, person-like only | 65 false hubs on Remote Vault |
| Keep allowlist as-is | 16 false hubs under Personal notes |
| Full rank + backlinks + setup UI | Scope creep for LFG ship |

---

## Implementation Units

### U1. Person hub scoring discovery

**Goal:** Replace allowlist gate with scored candidates + top-N.

**Requirements:** R1–R7, KTD1–KTD5

**Dependencies:** none

**Files:**

- `src/people.ts` (modify)
- `test/people.test.ts` (modify)
- `docs/architecture.md` (one-line people discovery note if present)

**Approach:**

1. Keep `PERSON_HUB_PATH_SEGMENTS` but rename role to **boost segments**; remove hard `if (!pathHasAllowlistSegment) continue`.
2. Score each candidate after denylist + person-like basename:
   - base 1
   - +10 if path under `/Social/`
   - +8 if under `/People/`
   - +1 if under `/Personal notes/` (mild only — not required)
   - +5 if frontmatter tags include `person` (string or array)
   - +2 if basename is single word (proper-name shape)
   - −2 if basename is 3+ words (topic-ish)
3. Require **minimum score threshold** so random root multi-word topics stay out: e.g. score ≥ 3 **or** Social/People path **or** `#person` tag. (Tune so root `Alex.md` with person-like 1-word: base+single-word = 3 → in; `Cooking.md` in Cooking/: denylisted Projects? Cooking not denylisted — person-like “Cooking” 1-word gets 1+2=3 → might enter. **Cooking is a false friend.** Fix: minimum score **4** unless path boost Social/People or `#person`. Then Alex root: 1+2=3 fails; Alex + #person: 1+2+5=8 in; Social/Alex: 1+10+2=13 in; Book list under Personal notes: 1+1−2=0 out.)
4. Sort by score desc, then title; take top `PERSON_HUB_TOP_N = 40`.
5. Export score helpers pure for tests if useful; keep `pathHasAllowlistSegment` for boost checks (or rename to `pathHasBoostSegment`).

**Test scenarios:**

- Social/People person notes discovered
- `Personal notes/Book list.md` **not** a hub
- `Projects/…` still denied
- `Cooking/Cooking.md` **not** a hub (min score)
- Root `Alex.md` person-like alone **not** hub; with `#person` tag **is** hub
- Empty vault → `[]`
- Cap: if >40 candidates, length ≤ 40 and highest scores win
- Aliases still on matchKeys for allowlisted/boosted hubs
- `enrichPersonLinks` still injects when hub present; still skips task/noise

**Verification:** `npm test` green; typecheck green.

---

### U2. README tutorial media + seed + version

**Goal:** Commit tutorial screenshots, seed script, README walkthrough, gitignore demo vault; bump version.

**Requirements:** R9–R10, KTD6

**Dependencies:** U1 preferred first so ship is one version; can parallelize if needed.

**Files:**

- `README.md` (already has walkthrough — ensure paths work)
- `docs/media/readme/*.png` (add)
- `scripts/seed-demo-vault.mjs` (add)
- `.gitignore` (demo-vault)
- `package.json`, `manifest.json`, `versions.json` → **0.6.3**
- Optional: `package.json` script `seed:demo`

**Approach:**

- Confirm README links `docs/media/readme/0N-*.png`
- Ensure no personal names in seed (Jordan/Riley/Arrival dogfood)
- Version 0.6.3 (user-visible docs + behavior)

**Test expectation:** none — docs/media packaging; smoke via `npm test` regression only.

**Verification:** files present; `git check-ignore docs/media/demo-vault` true; README relative image paths resolve.

---

## Verification Contract

1. `npm test`
2. `npm run typecheck` or `npm run build`
3. Spot-check discovery mentally against Remote Vault shapes (unit tests cover)
4. README images load from relative paths

## Definition of Done

- [ ] U1 + U2 landed
- [ ] Tests green
- [ ] Branch pushed, PR open with tutorial + ranking summary
- [ ] No personal vault content in committed media

## Assumptions

- Pipeline mode: skip interactive “no hub matched” Notice for this PR (deferred).
- Mild `Personal notes/` +1 is optional; min-score rules dominate false-hub rejection.
- Frontmatter tags available on `PersonHubFile.cache` same as today (tests pass cache objects).
