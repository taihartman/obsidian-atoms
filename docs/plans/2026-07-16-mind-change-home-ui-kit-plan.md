# mind-change-home-ui-kit - Work Plan

## TL;DR (For humans)

**What you'll get:** A small shared UI kit for the Atoms home screen, every home surface rebuilt on it, and a clear mind-change experience: flat hero with a serif-quoted old claim, then an Open view that shows both the old and new claims side by side with simple exits.

**Why this approach:** The product design is already settled (editorial tokens). The live Open flow drops the Then/Now story. Building the kit while shipping mind-change avoids painting the same DOM twice and gives you and other agents a place to contribute components.

**What it will NOT do:** Touch settings, the classify pipeline, or invent a new visual brand. Purple stays text-only. User capture bodies stay verbatim. No extra guilt queue.

**Effort:** Large  
**Risk:** Medium - wide home DOM rewrite plus a product UX flip; pure resurface scoring stays stable.  
**Decisions locked:** Pair Open in vault defaults to the old note; generic single-atom open stays for library; **full home migration kept** (not mind-change-only) — status/library refactors stay behavior-identical except flat/token rules; mind-change pair-open is the product P0 for merge.

**ce-doc-review (2026-07-16):** day-delta needs `laterMatchDate`; durable plan path under `docs/plans/`; no Open stub to single-atom; citator lines replace chips API; CE process only.

Your next move: **`/ce-work`** against the durable plan path below (claim Issue + STATUS + draft PR first). Do not use Prometheus/ulw-plan.

---

> TL;DR (machine): Large/Med — claim + promote plan to docs/plans → src/ui kit + styles tokens → migrate home/preview → mind-change hero+pair-open (v2) → tests + docs/components.md + architecture note.

**Durable plan path (collab):** `docs/plans/2026-07-16-mind-change-home-ui-kit-plan.md`  
**Scratch copy (optional):** `.omo/plans/mind-change-home-ui-kit.md`

## Scope

### Must have

1. **Process claim before product code:** GitHub Issue (assigned), `STATUS.md` row, draft PR on a feature branch. Body must use `Closes #<n>` when shipping. Hot files must not conflict with #25 (CI workflow only — safe). **Promote this plan** into `docs/plans/2026-07-16-mind-change-home-ui-kit-plan.md` (or keep that path in sync) and set STATUS `Plan` column to that path — never only `.omo/plans/`.

2. **Shared UI kit (`src/ui/`):** thin TypeScript DOM factories using Obsidian `HTMLElement` / parent.createEl patterns (no React, no new npm deps). Public surface:

   | Factory | Role |
   |---|---|
   | `button(parent, { grade: primary\|secondary\|quiet, label, onClick, attrs? })` | Button grades per tokens |
   | `flatCard(parent, { className?, children builder })` | Neutral grouped card, hairline, radius 14–16 |
   | `statusCard(parent, { tone: wait\|progress\|done\|error, ... })` | Soft-fill transient only |
   | `claimQuote(parent, { text, maxLines? })` | Serif + quote chrome outside text node; body sacred |
   | `kicker(parent, { text, variant: mind\|default })` | Caps eyebrow; mind = purple text only, no fill |
   | `citatorLine(parent, { relationLabel, peerTitle, onPeerClick? })` | Typographic ribbon row; no pill chips |
   | `linkChip(parent, { label, kind: person\|work\|neutral })` | Soft-fill person/work only |
   | `listGroup` / `listRow` | Grouped list bones |
   | `sectionLabel(parent, text)` | Section headers |
   | `backLink(parent, { label, onClick })` | Plain `‹ For you` style |
   | `actionRow(parent, buttons)` | Flex row of button grades |
   | `filterTabs(parent, { modes, active, onChange })` | Library filters |

   Barrel: `src/ui/index.ts` re-exports. Optional pure helpers live next to factories if tiny; prefer `resurface/` for domain copy.

3. **CSS tokens + components in `styles.css`:**
   - Token section: map semantic accents to `var(--color-purple, #bf5af2)`, `var(--interactive-accent)`, person orange, work cyan; soft-fill recipe documented for chips/status only.
   - Remove purple **fill/border** from mind-change kicker and citator (typographic only).
   - Hero + claim cards: flat `var(--background-secondary)` + neutral border; **no** accent gradients on mind-change or claim cards. Other For-you cues may keep or flatten to match quiet default — **default: flatten all resurface cards to flat grouped** so one hero language (tokens rule 3 quiet by default). Status wait/progress keep soft-fill.
   - Claim serif: `font-family: "New York", ui-serif, Georgia, serif`; quote marks via CSS `::before`/`::after` on claim quote wrapper, never injected into capture text.
   - Light theme contrast rules from tokens README for accent text on light paper.
   - Preserve existing class names where possible during migration OR map old classes to new kit classes in one pass; do not leave dual styling systems for the same component.

4. **Migrate ALL home + preview surfaces** in `src/home/atomsHomeView.ts` onto the kit:
   - Header icon buttons (may stay minimal native if kit has no icon-btn — add `iconButton` if needed)
   - Wait card, progress card, setup card, shortcut banner
   - For you: mind-change + other resurface cues
   - Library list, filters, link chips, peek queue
   - Generic home-open
   - Preview modal (`atoms-preview-*` if in this file or sibling)

   Settings tab (`src/settings/`) out of scope.

5. **Mind-change product (v2):**

   **Hero (`renderMindChangeCard`):**
   - Flat card + kicker "Mind change" (uppercase purple text, no pill fill)
   - Primary: `claimQuote(card.bodySnippet)` — old fossil; clamp ~4 lines CSS
   - Later line (replace `mindChangeLaterLine`): app-authored copy without em dash; title is interactive-accent colored text (not purple fill). Shape:
    - Prefer relative-day phrasing when `dayDelta` from `matchDate` + `laterMatchDate` is known: `Twelve days later you revised this: {laterTitle}` / `…you contradicted this: {laterTitle}`
      - Fallback if delta unknown: `Later you revised this: {laterTitle}` / `Later you contradicted this: {laterTitle}`
      - Colon + space before title; no `·` middle-dot required; no em dash
      - Later title is **display-only** blue text on hero (not required tappable)
    - Actions: Open (primary) · Next (secondary) · Not a mind-change (quiet full width)
    - Throttle unchanged: 1/day + pair key on Open/Next/Not a mind-change
    - **Open must never finally call only `openAtomInHome(card.path)`.** No stub that ships single-atom open for mind-change. Pair state + pair render land in the same PR as the hero Open wire (todos 6–7). Acceptance: grep/show Open handler sets pair state or calls `openMindChangePair(card)`.

    **Open = pair view (new state, not generic `renderHomeOpen`):**
    - Discriminated state e.g. `homeOpen: null | { kind: "atom"; ... } | { kind: "mind-change-pair"; thenPath; thenBody; thenDate?; nowPath; nowTitle; nowBody; relation; }`
    - Mind-change Open loads then body from `card.path` and now body from `card.laterPath` via vault/index (full body after frontmatter; clamp display ~8 lines or 1200 chars consistent with open view — pair uses 8-line clamp per tokens)
    - Layout: back `‹ For you` → Then flat card (date + claimQuote, no title) → connector small-caps purple text `revised by` / `contradicted by` on hairline → Now flat card (date + sans title + claimQuote)
    - Exits: **Open in vault** (primary — opens Then path in vault leaf; **stay on pair** so user can still Done) · **Done** (secondary — clear pair state → home; do not double-throttle if Open from hero already called `noteMindChangeInteraction`) · **Not a mind-change** (quiet — ensure pair key throttled + skip path like hero reject, then home). If user reached pair without prior note (defensive), Done still notes shown/throttle once.
    - Must NOT show Earlier/Later dual nav or per-claim vault links (v2 settled)
    - Generic library open keeps single-atom path with **typographic** `citatorLine` rows from `citatorLinesForAtom` (no purple soft-fill chips)

6. **Pure copy/helpers (TDD):**
    - Rewrite/replace `mindChangeLaterLine` → e.g. `mindChangeHeroLaterLine({ laterTitle, relation, dayDelta? })`
    - Add `mindChangeConnectorLabel(relation)` → `revised by` | `contradicted by` (lowercase small-caps via CSS)
    - Add pure `calendarDayDelta(fromYmd, toYmd): number | null` (whole local calendar days; null if unparseable). Do not invent "Twelve" without a real delta.
    - **Day-delta data (required):** Live `ResurfaceCandidate` only stores older `matchDate`. In `listMindChangeCandidates`, also set `laterMatchDate?: string` from `newer.matchDate` (YYYY-MM-DD). Hero computes `dayDelta = calendarDayDelta(card.matchDate, card.laterMatchDate)` only when both non-empty; otherwise omit relative-day phrasing and use fallback `Later you revised/contradicted this: {title}`. **Do not** derive calendar days from mtime alone.
    - **Citator data (required):** Replace purple-chip path with pure `citatorLinesForAtom(atom, indexed): { relationLabel: string; peerTitle: string; peerPath: string; direction: "out" | "in" }[]` (hard edges only; labels like `revises` / `revised by` / `contradicts` / `contradicted by` for typographic `citatorLine` UI). Deprecate view usage of chip buttons; may keep a thin adapter that maps lines → old chip shape only if tests need it mid-migration, but final home-open must not render chip fills.
    - Keep hard edges only revises|contradicts; never "relates"
    - Extend `test/resurface.test.ts` (or `test/mindChangeCopy.test.ts`)

7. **Docs:**
   - `docs/components.md` — how to add a factory, grades, tokens pointer, "do not invent purple fills", contribution checklist
   - Update `docs/architecture.md` module map: `ui/*` shared presentation; dependency: `home`/`resurface` may import `ui`; `pipeline` must not; `ui` must not import `home`/`pipeline`/`plugin`

8. **Verification:** `npm test`, `npm run typecheck`, `npm run build`; agent smoke via existing test vault/CLI patterns if available (`docs/dev-obsidian-cli.md`).

### Must NOT have (guardrails)

- Settings tab redesign; pipeline/classify/write changes; editor chrome
- Foreign brand (Fraunces, parchment, book-spine, cool-slate mock palette as product)
- Purple as fill, border, gradient, or chip background
- Em dashes in app-authored copy (user body still verbatim)
- Rewriting capture bodies; inserting quotes into stored text
- Soft "relates" in mind-change or citator
- Multiple mind-change heroes per day
- New npm UI framework
- Implementing without Issue + STATUS + draft PR
- Nesting worktrees inside the repo

## Verification strategy

> Prefer agent-executed verification; residual vault smoke may use `docs/dev-obsidian-cli.md` when available.

- Test decision: **TDD** for pure copy helpers; **tests-after** for UI factory pure-ish helpers if any; DOM migration verified by typecheck + build + targeted vitest on data/copy; no full browser harness required unless CLI leaf smoke exists
- Framework: vitest (`npm test`), tsc (`npm run typecheck`)
- Evidence: capture command output in PR notes / commit messages; no ULW evidence dirs required
- Manual-shaped agent checks: open design authority `docs/design-handoff/tokens/README.md` and confirm shipped class rules match (grep styles for `#bf5af2` fill patterns must be gone on kicker/chips)
- **Merge priority:** mind-change hero + pair-open correctness is product P0; full home kit migration is in scope but behavior-identical refactor (flat/token rules only) — do not redesign library/status beyond kit + tokens

## Execution strategy

### Parallel execution waves

- **Wave 0 (serial):** Claim Issue + branch + STATUS + draft PR; ensure durable plan at `docs/plans/2026-07-16-mind-change-home-ui-kit-plan.md`  
- **Wave 1 (serial after 0):** Copy helpers TDD (`laterMatchDate`, dayDelta, citatorLines) + CSS token foundation + `src/ui/` skeleton factories  
- **Wave 2 (serial):** Migrate non-mind-change home surfaces onto kit (header, wait, progress, setup, library, filters, chips, preview) — behavior-identical + flat/token only  
- **Wave 3 (serial):** Mind-change hero + pair-open state + generic open citator typography (same PR; no Open stub)  
- **Wave 4 (serial):** docs/components.md + architecture.md + full test/typecheck/build + STATUS notes  

### Dependency matrix

| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 Claim | — | 2–9 | — |
| 2 Copy helpers TDD | 1 | 6,7 | 3 |
| 3 CSS tokens + kit skeleton | 1 | 4–7 | 2 |
| 4 Migrate status/setup/header | 3 | 5 | — |
| 5 Migrate library/filters/preview | 3,4 | 6 | — |
| 6 Mind-change hero | 2,3,5 | 7 | — |
| 7 Pair-open + generic citator | 2,3,6 | 8 | — |
| 8 Docs architecture + components | 3,7 | 9 | — |
| 9 Full verify + PR ready | 2–8 | — | — |

## Todos

> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->

- [ ] 1. Claim work (Issue, branch, STATUS, draft PR, durable plan)
  What to do / Must NOT do: Create GitHub Issue titled for mind-change home UI kit + pair-open; assign human owner; `git checkout master && git pull && git checkout -b feat/mind-change-home-ui-kit` (or similar); ensure plan exists at `docs/plans/2026-07-16-mind-change-home-ui-kit-plan.md` (copy from this file if needed); add STATUS.md In progress row (owner, branch, plan path **`docs/plans/2026-07-16-mind-change-home-ui-kit-plan.md`**, hot files: `src/ui/**`, `src/home/atomsHomeView.ts`, `src/resurface/resurface.ts`, `styles.css`, `docs/components.md`, `docs/architecture.md`); open **draft** PR with body including `Closes #<issue>`. Must NOT start `src/` edits before claim complete. Must NOT touch #25 hot files. Must NOT point STATUS only at `.omo/plans/`.
  Parallelization: Wave 0 | Blocked by: — | Blocks: 2–9
  References: `STATUS.md`; `docs/collab.md`; `docs/workflow-lanes.md` (full lane); `AGENTS.md` claim rules
  Acceptance criteria (agent-executable): `gh issue view <n>` shows assignee; `gh pr view` draft true; STATUS row present with docs/plans path; `test -f docs/plans/2026-07-16-mind-change-home-ui-kit-plan.md`; `git branch --show-current` is feature branch not master
  QA scenarios: happy: claim exists and PR draft; failure: if STATUS hot-file overlap with In progress ≠ #25, stop and re-scope.
  Commit: Y | `chore(status): claim mind-change home UI kit #<n>`

- [ ] 2. Pure mind-change copy helpers (TDD)
  What to do / Must NOT do: Replace/extend `mindChangeLaterLine` in `src/resurface/resurface.ts` with hero later-line helper matching v2 (no em dash; revised/contradicted wording; optional day delta). Add `mindChangeConnectorLabel(relation): "revised by" | "contradicted by"`. Add `calendarDayDelta(fromYmd, toYmd)`. Extend `ResurfaceCandidate` with `laterMatchDate?: string`; set it in `listMindChangeCandidates` from `newer.matchDate`. Add `citatorLinesForAtom` (hard edges only) for typographic rows; stop final UI dependence on purple chip rendering. Keep `SupersessionRelation` only revises|contradicts. Update all call sites. Tests in `test/resurface.test.ts` or new `test/mindChangeCopy.test.ts`: revises, contradicts, missing delta fallback, laterMatchDate present on candidates, never emits em dash or "relates". Must NOT invent day numbers without both YMD strings. Must NOT change edge extraction regex behavior except if tests already pin it.
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 6,7 | parallel with 3
  References: `src/resurface/resurface.ts:40-54`, `:199-243`, `:612-618`; `docs/design-handoff/tokens/README.md` copy rules + hero later line; `test/resurface.test.ts`
  Acceptance criteria: `npm test -- test/resurface.test.ts` (or new file) passes; grep app-authored strings in helper for `—` fails (zero matches); candidates from mind-change list include laterMatchDate when newer has matchDate
  QA scenarios: happy: dayDelta 12 → contains "Twelve days later" and "revised this:"; failure: relation contradicts → "contradicted"; unknown delta → "Later you revised this:"; missing laterMatchDate → fallback path.
  Commit: Y | `feat(resurface): v2 mind-change later-line and connector copy`

- [ ] 3. CSS tokens + `src/ui/` skeleton factories
  What to do / Must NOT do: Add `src/ui/` modules + `index.ts` for factories listed in Scope. Implement using parent `createEl`/`createDiv` compatible with Obsidian HTMLElement helpers (mirror patterns in `atomsHomeView.ts`). Add styles.css sections: design tokens (purple via `var(--color-purple, #bf5af2)`), claim-serif, button grades, flat-card, status soft-fill, kicker mind text-only, citator line typographic, link chips person/work. Remove purple fill/border from `.atoms-home-mind-change-kicker` and `.atoms-home-citator-chip` (chips either deleted or replaced by citator line styles). Flatten resurface card gradients to flat grouped. Must NOT add npm deps. Must NOT import home/pipeline into ui.
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 4–7 | parallel with 2
  References: `styles.css:311-518`; `docs/design-handoff/tokens/README.md` color/type/component grades; `src/home/atomsHomeView.ts` createEl patterns; `docs/architecture.md` module map
  Acceptance criteria: `npm run typecheck` clean; `src/ui/index.ts` exports all factories; grep `styles.css` for mind kicker `background:` purple mix returns no product violation (kicker text-only)
  QA scenarios: happy: import kit from a throwaway typecheck path; failure: ui importing home fails lint/architecture review.
  Commit: Y | `feat(ui): add home component kit and token styles`

- [ ] 4. Migrate header, wait, progress, setup, shortcut banner to kit
  What to do / Must NOT do: Refactor corresponding render methods in `atomsHomeView.ts` to use Button/StatusCard/FlatCard/SectionLabel/ActionRow. Preserve behavior: wait Preview/Process, progress phases, setup steps, shortcut CTA. Must NOT change pipeline APIs.
  Parallelization: Wave 2 | Blocked by: 3 | Blocks: 5
  References: `src/home/atomsHomeView.ts` render() ~641+; wait/setup/progress sections; `src/home/runProgress.ts`; `styles.css` wait/setup blocks
  Acceptance criteria: `npm run typecheck` && `npm test` pass; no remaining raw primary/secondary button createEl for those surfaces (kit used)
  QA scenarios: happy: typecheck; failure: disabled buttons still disabled attribute.
  Commit: Y | `refactor(home): migrate status and setup surfaces to ui kit`

- [ ] 5. Migrate library list, filters, link chips, peek queue, preview modal to kit
  What to do / Must NOT do: ListGroup/ListRow/FilterTabs/LinkChip for library; preview modal buttons/cards via kit. Preserve filter all|linked, chip kinds person/work, peek behavior. Cap 2 chips/row already if present — keep. Must NOT invent new chip categories.
  Parallelization: Wave 2 | Blocked by: 3,4 | Blocks: 6
  References: `atomsHomeView.ts` library/filter/cell render; `atomsHomeData.ts` extractLinkChips; preview modal classes `atoms-preview-*` in styles.css
  Acceptance criteria: `npm test` including `test/atomsHomeData.test.ts` pass; typecheck pass
  QA scenarios: happy: linked filter still pure data path; failure: chip kind unknown → neutral.
  Commit: Y | `refactor(home): migrate library and preview to ui kit`

- [ ] 6. Mind-change hero on kit + v2 visual/copy
  What to do / Must NOT do: Rewrite `renderMindChangeCard` to FlatCard + Kicker(mind) + ClaimQuote(bodySnippet) + later line helper + ActionRow Open/Next/Not a mind-change. Wire Open to **pair-open only** (`openMindChangePair(card)` or set `{ kind: "mind-change-pair", ... }`). **Hard ban:** Open must not call `openAtomInHome` as the mind-change path (no temporary stub that ships). Land with todo 7 in the same PR. Preserve noteMindChangeInteraction + throttle on Next/reject. Must NOT show title of old atom as hero primary; fossil body remains primary.
  Parallelization: Wave 3 | Blocked by: 2,3,5 | Blocks: 7
  References: `atomsHomeView.ts:489-548`; `resurface.ts` listMindChangeCandidates; tokens README hero grade
  Acceptance criteria: Open handler sets pair state or calls `openMindChangePair(card)`; repo search shows mind-change Open does not use `openAtomInHome` alone; kicker has no purple background in CSS; `npm run typecheck` pass
  QA scenarios: happy: laterTitle present renders later line; failure: missing laterTitle omits later line without crash.
  Commit: Y | `feat(home): v2 mind-change hero card`

- [ ] 7. Pair-open view + generic open citator typography
  What to do / Must NOT do: Implement mind-change pair state and `renderMindChangePair` (or equivalent): load then/now bodies from paths; Then card / connector / Now card; exits Open in vault (then path, stay on pair) / Done / Not a mind-change. Back clears to home. Update `homeOpen` type and render() branch. Generic `renderHomeOpen`: use `citatorLinesForAtom` + `citatorLine` UI (no purple chip fills); claim body via ClaimQuote; keep Open in vault. `onOpenResurface` mind-change path uses pair-open. Must NOT open vault automatically; must NOT use per-claim vault links. If laterPath missing/unreadable: show Now title + empty body without crashing; still show Then.
  Parallelization: Wave 3 | Blocked by: 2,3,6 | Blocks: 8
  References: `atomsHomeView.ts:550-639`; tokens README open pair; citatorLinesForAtom (todo 2)
  Acceptance criteria: typecheck; tests for any pure pair-key helpers; mind-change Open does not solely call openAtomInHome; purple citator chip background removed from styles used by home-open
  QA scenarios: happy: pair with both bodies; failure: missing later file shows then + degraded now; reject from pair throttles pair key.
  Commit: Y | `feat(home): mind-change pair-open and typographic citator`

- [ ] 8. docs/components.md + architecture.md ui module
  What to do / Must NOT do: Write contribute guide; update architecture module map and dependency rule (home/resurface → ui; ui ↛ home/pipeline; pipeline ↛ ui). Point to tokens README as visual authority. Must NOT rewrite constitution non-negotiables.
  Parallelization: Wave 4 | Blocked by: 3,7 | Blocks: 9
  References: `docs/architecture.md:61-86`; tokens README; this plan Scope kit table
  Acceptance criteria: files exist; architecture lists `ui/*`; components.md has add-component checklist
  QA scenarios: happy: docs reference real paths; failure: no absolute machine paths.
  Commit: Y | `docs: home UI kit contribute guide and architecture map`

- [ ] 9. Full verify, STATUS note, ready for review
  What to do / Must NOT do: Run `npm test && npm run typecheck && npm run build`. Fix failures. Mark draft PR ready when green (or leave draft if collab prefers human ready). Update STATUS notes. Do not merge without human. Phone dogfood (`npm run phone`) only after master merge per CLAUDE.md — note in PR, do not require pre-merge unless human asks.
  Parallelization: Wave 4 | Blocked by: 2–8 | Blocks: —
  References: `package.json` scripts; `CLAUDE.md` shipping tail; `docs/collab.md` PR → Closes
  Acceptance criteria: all three commands exit 0; PR body has `Closes #`; no purple fill on mind kicker in styles
  QA scenarios: happy: green CI local; failure: type error blocks ready.
  Commit: Y | `chore: verify mind-change home ui kit` only if fixes needed; else no empty commit

## Final verification wave

> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.

- [ ] F1. Plan compliance audit — every Scope must-have present in diff; pair-open exists; kit used on migrated surfaces; claim process followed
- [ ] F2. Code quality review — architecture imports; no pipeline→ui; body sacred; no em dash in app copy helpers
- [ ] F3. Real manual QA — agent-driven: seed vault with revises pair if needed; exercise hero Open/Next/Not a mind-change; pair exits; library open citator; or document CLI limitation + vitest coverage substitute with explicit residual risk
- [ ] F4. Scope fidelity — no settings/pipeline scope creep; no foreign brand; purple text-only

## Commit strategy

- Atomic commits per todo above (Y lines)
- PR title: `feat: mind-change pair-open + home UI kit`
- PR body: summary, screenshots optional from design-handoff, `Closes #<n>`, test plan checklist
- Do not force-push shared branch after review starts

## Success criteria

1. Mind-change hero matches v2: flat, purple text kicker, serif-quoted fossil, later line without em dash, three actions  
2. Open shows Then + connector + Now with both bodies when available; exits Open in vault / Done / Not a mind-change  
3. Generic library open uses typographic citator, not purple soft-fill chips  
4. `src/ui/` exists with documented factories; home/preview use them  
5. `docs/components.md` + architecture `ui/*` dependency rule  
6. `npm test`, `typecheck`, `build` green  
7. Issue claimed, STATUS accurate, PR has `Closes #`  

---

## Product copy & visual quick-reference (executor)

**Authority:** `docs/design-handoff/tokens/README.md` (v2). Mocks under `docs/design-handoff/belief-rehearsal/` are structural only; do not ship Fraunces/slate from exploration mocks.

**Data (unchanged):** hero `path`/`bodySnippet` = old; `laterTitle`/`laterPath`/`relation` = new.

**Hard product locks:** fossil primary; revises|contradicts only; 1 hero/day; body sacred; Open then path as vault primary.
