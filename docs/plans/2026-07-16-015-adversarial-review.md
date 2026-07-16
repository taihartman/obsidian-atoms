# Adversarial review — Update notes (plan 015)

**Target:** `docs/plans/2026-07-16-015-feat-atoms-quality-stamp-and-improve-plan.md`  
**Grounded in:** live code after hybrid layout + 0.6.6 (not the plan’s flat `src/*` paths)  
**Lane if we proceed:** **Full** (workflow-lanes already says so)  
**Verdict:** Plan direction is right. **Do not implement as written without tightening 6 landmines** — two of them are ship-blockers for trust.

---

## One-line product read

You want a **second Process door** that re-classifies existing atom *bodies* so old notes match new filing quality, without becoming a review product or an auto-rewrite daemon.

That product bar is correct. The plan’s biggest risk is not “will the AI work?” — it’s **quietly violating constitution shape** (append-only dailies, protect-existing atoms, body sacred) via edge cases the plan under-specifies.

---

## What’s strong (keep)

| Strength | Why it matters |
|---|---|
| **Process parity, not local polish** | Local reason rewrite cannot match 0.6.6 titles/hubs/tags. You already killed the offline lie. |
| **R12 — not `planWrite`** | Live code: same title → `skip_existing_atom` only (no modify). Reusing Process write path would make “Update notes” a no-op. |
| **R13 keep-as-atom** | Re-triage to noise must not delete intelligence. Process would *create nothing*; refresh must *preserve file*. |
| **R8 no auto-refresh** | Auto-run only walks unmarked captures. Don’t invent a “on version bump, rewrite library” path. |
| **Two clocks** (`created`/`source` vs quality stamp) | Memory identity ≠ pipeline generation. Correct. |
| **Light confirm, not review sheet** | Matches home philosophy (calm, not homework). |
| **U1 alone is forward-compatible** | Stamp new writes even if refresh UI slips. |

---

## Ship-blockers (fix before code)

### B1. Body/reason split is the body-sacred bomb

**Plan assumes:** blank line → capture above, reason below; else whole body is capture.

**Code reality:** Writer emits `capture\n\n<link prose>` *only when links exist*. No extractor exists. No invariant enforces “capture never contains blank lines.”

**Adversarial cases that corrupt “verbatim capture”:**

1. **Hand-edited multi-paragraph capture** with blank lines → first blank line splits mid-thought; trailing paragraphs treated as “old reason” and **dropped** on rebuild.
2. **User appended notes under the reason** → absorbed into capture or lost depending on split rule.
3. **No-link atoms** that user later hand-linked with free prose → whole body reclassified as capture including old prose → model surfaces rebuild, but “body” now includes stale reason text (double prose after refresh).
4. **Multi-line captures** that were never blank-line-free in the wild (imports, manual atoms).

**Required plan amendment (v1):**

- Prefer **fingerprint from `source` daily**: resolve capture bullet via existing `resolveCaptureEndLine` / body match against the daily that `source` points at. That is the true sacred text when locatable.
- Fall back to blank-line split **only if** daily match fails.
- If neither is trustworthy: **skip atom** (count as skipped), do not guess. Better leave stale than rewrite “capture” incorrectly.
- Tests must include: multi-paragraph hand-edit, no-link atom, daily-match success, daily-match fail → skip.

Without this, R2 is marketing, not a guarantee.

### B2. Title rename + marker rewrite is a constitution exception — under-armored

**Constitution today:** two write types — new atom files + **append-only** markers. No daily *rewrite*.

**Plan R11:** replace plugin marker wikilink when title changes.

That’s the right exception, but adversarial edges:

| Edge | Failure mode |
|---|---|
| Capture match ambiguous (duplicate bullets / same first line) | Wrong marker line rewritten → silent daily corruption |
| Marker already points at different title (user edited marker) | Plan only rewrites if wikilink matches **old** title — good; document |
| Two atoms claim same source capture after past collisions | Ambiguous which marker to update |
| Rename target path already exists | Plan says keep path + aliases — good; must not overwrite target |
| Obsidian Sync race mid-rename | Partial state: file at new path, marker still old, or reverse |
| Wikilinks **elsewhere** (`[[Old Title]]` in other notes) | Not repaired — only aliases on the atom help; **expect broken inbound links** |

**Required:**

- Marker repair is **best-effort, single-line, exact old-title match only**; never invent markers; never rewrite capture bullets.
- On any ambiguity → **aliases only**, leave daily alone, log/count `markerRepairSkipped`.
- Confirm copy should not over-promise “links stay intact” for whole vault — only plugin marker + alias.

Also: **architecture.md principle #2** (“append-only marker lines”) needs an explicit amendment in the same PR as R11, or agents will “helpfully” refuse / re-litigate.

### B3. `buildAtomMarkdown` must not be the refresh writer

Live `buildAtomMarkdown` always rebuilds `created`/`source` from process-time capture/daily. Refresh calling it naively can **mutate identity fields**.

Plan says preserve them — good — but U2/U3 must specify **parse FM → overlay model surfaces → never recompute `created`/`source` from classify**. Separate pure function (`buildRefreshedAtomMarkdown`), not a flag soup on `buildAtomMarkdown` that Process can misuse.

---

## High-severity product / trust risks

### H1. “All old notes are eligible” stamp cliff

First ship sets `CURRENT = 2`; unstamped = 0 → **entire library** is eligible.

If a dogfood vault has 200 atoms and batch is 20:

- Strip says “200 older notes”
- User taps Update expecting “fix my library”
- Gets 20, still “180 older notes”
- Feels broken / endless chore

**Mitigations to lock in plan:**

- Confirm: “Update **up to N** of M this run (batch N).”
- Done: “Updated K · L still older · run again anytime.”
- Optional: sort eligible by **mtime ascending** (oldest first) or **quality missing first** — pick one and document.
- Do **not** auto-chain batches without another confirm (cost + surprise).

### H2. Cost / rate limit under-specified vs Process

Process hard-caps **15** per run (`maxCaptures: 15`), classify retries **2** on process path. Plan wants **20** (and floated 50).

Adversarial: phone Sync vault + slow network + 20× full classify = long progress, 429s, partial library half-stamped.

**Align with Process:** default batch **15**, same retry policy, same progress plumbing. “20 phone / 50 desktop” is premature settings surface.

### H3. Hand-edits are silently destroyed on model surfaces

KTD-10 admits it. Confirm copy helps once.

Still adversarial:

- User spent care on a title → Update rewrites it to model declarative style → trust crash.
- User deleted a bad link → model puts it back.
- Power users will treat Update as vandalism after one bad run.

**v1 minimum beyond copy:**

- Prefer stamp + eligibility only (as planned).
- Strongly consider **skip if mtime of atom file is newer than `quality-updated` and quality already set** — no, first ship has no quality-updated.
- Better v1: **`atoms-quality-locked: true`** is out — but add **skip if frontmatter has non-plugin fields beyond known set?** too clever.

Pragmatic v1: confirm copy is honest + batch small + **no auto**. Accept overwrite of model surfaces. Track “lock” as first amend after dogfood pain — don’t pretent v1 is safe for hand-curators.

### H4. Model non-determinism vs “parity”

AE2 says refreshed note should look like a fresh Process of the same body. Reality: two classifies of same body can differ (title wording, link set).

Don’t over-test “identical to Process dry-run.” Test: same choke points (`classifyCapture`), body identity, stamp, keep-as-atom, rename safety. Quality is “same pipeline,” not “byte-identical output.”

### H5. Home strip vs Process hero

Plan + mock say secondary strip — good. Adversarial UI failure: strip competes when **both** unprocessed captures and 200 eligible atoms exist.

**Rule to lock:** If wait/Process hero is showing, Update strip is **below** it (or collapsed one-liner). Never two primary CTAs of equal weight. Progress card for Update must not look like Process failed.

### H6. Protect-existing vs intentional modify

Security story after pre-community harden: **Process never overwrites atoms**. Update notes is the **first intentional mass-modify**.

Risk: future agent/refactor funnels “reprocess” through refresh, or refresh reuses create path and accidentally `vault.create` on collision.

**Hard separation:**

- Process path: create + skip only (unchanged).
- Refresh path: modify/rename only; never `planWrite`.
- Code review checklist item; maybe assert in tests that refresh never calls `planWrite`.

---

## Medium issues (fix in plan, not blockers if defaulted)

| ID | Issue | Default I’d take |
|---|---|---|
| M1 | Plan file paths pre-hybrid (`src/render.ts`, `src/main.ts`) | Rewrite units to `pipeline/`, `plugin/`, `home/`, `shared/` |
| M2 | Definition of Done says R1–R11; omits R12–R13 | Done = R1–R13 |
| M3 | When to bump CURRENT is soft | Add: any change to prompt/schema/enrich that changes titles/links **must** bump in same PR or notes stay “current” while worse |
| M4 | `quality-updated` date only (no time) | Fine for v1; multi-run same day OK |
| M5 | Eligibility: only `generated-by: linker` | Correct — don’t touch hand-written notes in Atoms/ |
| M6 | Backfill / Batch API path | Out of scope — don’t wire refresh into backfill |
| M7 | Seed demo: one legacy + one stamped | Required so dogfood strip appears without real history |
| M8 | Phone dogfood after master | Full shipping tail + `npm run phone` — this is user-visible |
| M9 | Optional cost estimate | Stay out of v1 (Open Q already) |
| M10 | “Review changes” | Stay out — if you add it mid-impl, scope explodes |

---

## Adversarial user stories (must not ship if any fail)

1. **Sacred body:** hand-edited multi-paragraph atom with blank lines → Update either preserves full original capture text or **skips**; never drops a paragraph.
2. **Identity:** `created` / `source` unchanged after refresh.
3. **Noise re-triage:** model returns noise → file still exists, still in library, stamped.
4. **Rename collision:** new title filename already taken → old path kept, aliases include new display title if needed; **no overwrite**.
5. **Marker ambiguity:** can’t find unique capture/marker → daily untouched; aliases for old title.
6. **No key:** zero API calls; calm settings path; no partial stamps.
7. **Auto-run:** enable automatic filing, relaunch — zero refresh modifies.
8. **Partial batch:** 15 of 100 updated; strip still shows remaining; second run continues; no double-charge on already CURRENT.
9. **Process still protect-existing:** Process same title still skips; Update is only modify path.
10. **Progress isolation:** Update progress doesn’t clear / steal Process wait card semantics incorrectly.

---

## Architecture tension (name it)

| Principle today | Update notes |
|---|---|
| Two write types: create atom + append marker | Adds **modify atom** + **rewrite one marker line** |
| Protect existing atoms | Intentional exception for linker-generated + stale quality |
| Body sacred | Only if extract is correct (B1) |
| Never lossy | Keep-as-atom helps; bad extract is lossy |

This is not a reason to kill the feature. It **is** a reason to treat it as constitution-adjacent: same PR should update `architecture.md` + non-negotiable footnotes so the exception is explicit, narrow, and testable.

---

## What I would cut or stage

| Slice | Ship? | Why |
|---|---|---|
| **U1 stamp only** | Yes, can land first | Forward-compatible; zero rewrite risk |
| U2 extract + pure reassemble | Yes | Hardest correctness; TDD here |
| U3 apply + rename + marker | Yes but **thin** | Marker = best-effort; rename collision = aliases |
| U4 home strip + confirm | Yes | Product surface |
| Cost estimate, review sheet, lock flag, 50-batch desktop | **No** | Scope creep |
| Daily-match extract as primary | **Yes, add** | Missing from plan; needed for B1 |

**Recommended sequence amendment:** U1 → U2 (with daily-fingerprint extract) → U3 → U4 → U5. Do not ship U4 without U2 tests for adversarial body cases.

---

## Light doc-review already happened — still escalate?

Plan had light headless doc-review. Workflow-lanes example: this feature is **Full**.

My call:

- Product bar and KTDs are settled enough to implement.
- **Before `ce-work`:** amend plan for B1–B3 + H1 batch messaging + path updates + DoD R12–R13. That’s a **material plan edit** → at least another **light** doc-review on the delta (or treat this adversarial doc as the review artifact and human-approve).

Not blocked on full multi-persona swarm unless you want design crit on the mock again — mock v3 is already AI-honest.

---

## Bottom line

| Question | Answer |
|---|---|
| Is the product right? | **Yes** — Process parity refresh is the only honest bar after 0.6.6. |
| Is the plan implementable? | **Mostly** — after hybrid path fix + extract strategy fix. |
| Biggest way we ship a trust bug? | **Wrong capture extract** (body not sacred) and **sloppy marker rewrite**. |
| Biggest way we ship a UX bug? | **Silent mass eligibility** without batch/remaining copy. |
| Ready to code as-is? | **No.** Ready after short plan amend on B1–B3 + H1 + paths. |

---

## Proposed plan deltas (for human approve)

1. **Extract order:** daily capture match via `source` → blank-line fallback → else skip.  
2. **Marker repair:** exact old-title only; ambiguity → aliases only.  
3. **Writer:** `buildRefreshedAtomMarkdown` separate; never recompute `created`/`source`.  
4. **Batch:** 15, aligned with Process; confirm/done copy for “up to N of M.”  
5. **Paths:** hybrid layout.  
6. **DoD:** R1–R13; architecture exception for modify + marker rewrite.  
7. **Tests:** adversarial body + noise keep + rename collision + no-key + auto-run untouched.

---

## Next decision

Human picks one:

- **A)** Amend plan 015 with the deltas above, then claim Issue + implement full feature  
- **B)** Ship **U1 only** (stamp on new Process writes) as light lane; refresh later  
- **C)** Kill/delay Update notes; live with “only new Process gets 0.6.6 quality”
