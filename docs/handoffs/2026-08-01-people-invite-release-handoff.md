# Handoff — person invites (#224 / #227), release 0.6.61 pending

**Date:** 2026-08-01
**Master at handoff:** `9ba08b6`
**Version on master:** 0.6.61 (`package.json`, `manifest.json`, `versions.json` all agree)
**Latest published release:** **0.6.59** — 0.6.61 is *not* tagged, so nothing has shipped to any user
**Branches:** all merged; nothing in flight. `STATUS.md` is clear.

---

## What you asked for

A People card on Atoms home read **"Add Likes?"** for the atom `Likes Annie's fruit tape snack`.
`Likes` is a verb; the capture had dropped its subject.

## What shipped to master

### 0.6.60 — containment (#224, PR #228)

`resolvePersonInviteName` took the first capitalised token of the title as the person's name, gated on
`isPersonShapedCapture` — which is satisfied by `PREFERENCE_OR_RELATION_RE` matching *the same word*.
`Likes` qualified itself. A non-name word set (verbs, determiners, weekday/time words) now runs inside
`isDeniedPersonName`, the one choke point every name branch already routes through.

This also stopped bogus `same person — related claim` peer links: `write.ts` grouped atoms by that same
bad label, so two unrelated `Likes …` atoms were being cross-linked as one person.

### 0.6.61 — the durable fix (#227, PR #228)

The word list only covers words someone typed into it. Measured against the shipped `0.6.60`:

| Title | 0.6.60 still resolved |
|---|---|
| `Skipped the gym because Nichita likes it` | `Skipped` |
| `Swapped Annie's snack, likes it better` | `Swapped` |
| `Ordered the boots Nichita likes` | `Ordered` |
| `Craving Annie's fruit tape always` | `Craving` |

So the question moved to the layer that can answer it. `classify` now emits
`people[{name, role}]` with `role ∈ subject | mentioned | recommender`; the invite fires on a **sole
subject**. `Annie` is a possessive owner → `mentioned` → never invites. Persisted to `atoms-people`
frontmatter, so the home card, `write.ts:392` peer grouping and `atomsHomeView.upgradePathSet` read one
field instead of re-parsing rendered prose.

Model output stays untrusted: a name must appear **verbatim** in the capture (R4), and the 0.6.60 deny
list remains as a backstop (R5). Legacy atoms keep 0.6.60 behaviour until `atoms:update-notes`
refreshes them (`CURRENT_ATOMS_QUALITY` 7 → 8).

Plan: `docs/plans/2026-08-01-001-feat-classifier-named-people-plan.md`.

### Two defects found *after* the merge, both fixed

1. **Guarded parser ≠ guarded pipeline.** `normalizePeople` was wired only into the live classify
   parser. `backfill.ts:600` parses Batch API output on its own path, and smart refresh reaches
   frontmatter the same way — both via `applyClassificationQuality`. Model output had three doors and
   the guard was on one. Guard now sits in the shared quality pass.
2. **`plus-service` was unparseable JavaScript on master** (PR #233). The `people[]` prompt guidance
   went into the server's `SYSTEM_PROMPT` with raw backticks around `` `subject` `` — that prompt is a
   JS template literal, so the first backtick closed it. plus-service could not import its own classify
   template. The plugin's copy in `classify.ts` escapes them, so **plugin assets were never affected**.
   plus-service went **15 passing → 45** with the fix. The 12 remaining failures are HTTP/OAuth suites
   that spawn servers; they fail identically without the change (environmental, pre-existing).

   The parity test missed it because it read the snapshot as *text*. It now **imports** the module.

---

## Three commands left, and they must be yours

### 1. Gate — settles both remaining unknowns

```bash
ANTHROPIC_API_KEY=sk-... npm run trial:people
```

Six captures through the live API: the reported bug, a plain subject, an unlisted verb, a media
recommender, a no-person capture, kinship. Asserts roles, applies the same guard `normalizePeople`
does, exits non-zero on failure. `--dry` runs it offline (schema contract only, no key).

This is the only thing that proves (a) the live API accepts `CLASSIFICATION_SCHEMA` with `people`
required, and (b) the model returns `mentioned` for Annie rather than `subject`.

### 2. Ship

```bash
git tag -a 0.6.61 -m "0.6.61 — person invites name model-identified people, not the leading verb"
git push origin 0.6.61
```

`release.yml` fires on the tag: version check, tests, production build, SLSA attestation, and publishes
`main.js` / `manifest.json` / `styles.css` / `SHA256SUMS.txt` for BRAT.

### 3. Confirm on device

BRAT update → Settings → Atoms shows **0.6.61**. Append `likes annie's fruit tape snack` to a
`test_vault` daily, run **Process**, expect an atom with **no** "Add Likes?" card. Only step that
exercises the real UI.

**Rollback:** release `0.6.59`. Nothing between it and 0.6.61 was ever published.

---

## Why the agent could not finish it

- **Tag push → HTTP 403.** The session's git credential is scoped to `refs/heads/*`; five branch pushes
  succeeded, every `refs/tags/*` push returned 403 from `git-receive-pack` (git renders this as
  "unexpected disconnect"). The GitHub tool surface available is read-only for tags and releases — no
  `create_tag`, `create_ref`, or `create_release` — and `release.yml` has no `workflow_dispatch`.
- **No `ANTHROPIC_API_KEY`** in the remote container, so the live classify path was never exercised.
- **No Obsidian binary and no `test_vault`**, so no CLI, no Process dogfood, no screenshots.

---

## Verified vs unverified

| | |
|---|---|
| Plugin unit + invariants | **753 pass**, 52 files |
| Typecheck + production bundle | clean |
| plus-service | 45 pass (12 pre-existing env failures) |
| Demo-vault smoke on real files | pass — `test/personInvite.vault-smoke.test.ts` |
| Schema contract offline | pass — `npm run trial:people -- --dry` |
| **Live API accepts the schema** | **not run** — step 1 |
| **Model's role judgement** | **not run** — step 1 |
| **Atoms home renders the card** | **not run** — step 3 |

The demo-vault smoke is **plumbing, not product dogfood** (non-negotiable 9): its classify step is
fixture-fed, so it proves the pipeline, not the model.

**Shipping tail is half-done.** `ce-plan`, `ce-doc-review`, `ce-code-review`, `ce-simplify-code`,
`world-class-qa` and `adversarial-qa` never loaded — they live in private `taihartman/claude-skills`,
which could not be attached from the container (MCP approval gate). Simplify and review passes were done
by hand; that is how both post-merge defects above were found, which is also a warning about what a hand
pass misses silently.

---

## Open, not filed

1. **Verb-led titles are their own defect.** `Likes Annie's fruit tape snack` is not a declarative claim
   about anything identifiable. With `people: []` the pipeline can now *detect* a subject-less capture
   and route it to `reconsider` instead of filing a headless atom.
2. **Retire `PERSON_INVITE_NON_NAME_WORDS` from the hot path** once `update-notes` has converged the
   library; keep it as the R5 backstop only.
3. **Regenerate the plan with the real `ce-plan`.** The committed plan conforms to the
   `ce-unified-plan/v1` shape reverse-engineered from the 54 artifacts in `docs/plans/`, but the method
   did not run. It is labelled `product_contract_source: reverse-engineered-contract` and is written to
   be overwritten.
4. **Deploy plus-service to Fly** when convenient. What is live now is pre-#228 and healthy — Plus users
   simply classify without `people` and fall back to the legacy path. Not blocking.

## Map

| Thing | Where |
|---|---|
| Schema, prompt, `normalizePeople` | `src/pipeline/classify.ts` |
| Frontmatter write / parse | `src/pipeline/render.ts`, `src/pipeline/atomQuality.ts` |
| Invite resolution | `src/pipeline/personInvite.ts` (`resolveAtomPersonName`) |
| Other consumers | `src/pipeline/write.ts:392`, `src/home/atomsHomeView.ts` |
| Server snapshot | `plus-service/src/classifyTemplate.mjs` |
| Trial harness | `scripts/trial-people.mjs` — `npm run trial:people` |
| Tests | `test/classifierPeople.test.ts`, `test/personInvite.test.ts`, `test/personInvite.vault-smoke.test.ts` |
| Learnings | `docs/solutions/logic-errors/person-invite-verb-as-name.md` |
