---
artifact_contract: ce-unified-plan/v1
artifact_readiness: draft-needs-doc-review
product_contract_source: house-format-approximation
execution: code
issue: TBD
date: 2026-08-01
origin: docs/solutions/logic-errors/person-invite-verb-as-name.md
lane: full
---

> **Method note.** `ce-plan` could not load in the session that wrote this — the method skills live
> in private `taihartman/claude-skills` and are not installed in the remote container
> (`AGENTS.md` § Shared skills). The structure below is derived from existing `docs/plans/*` and is
> an **approximation of the ce-plan artifact, not its output**. Re-run `ce-plan` locally to
> regenerate before treating this as implementation authority, and run the plan quality gate
> (light `ce-doc-review`) either way.

# feat: classifier-named people for person invites

## Product Contract

### Summary

Person invites stop being regex guesses over the rendered atom title. `classify` emits a
`people[{name, role}]` field, `render` persists it to atom frontmatter, and the three surfaces that
today re-derive a name from prose read that field instead. The `0.6.60` deny list survives as an
invariant guard on untrusted model output, not as the mechanism.

### Problem Frame

Atoms home offered **"Add Likes?"** for the atom `Likes Annie's fruit tape snack` (#224). The capture
elided its subject — "likes Annie's fruit tape snack" — so the first capitalised token of the title
was a verb, and `resolvePersonInviteName` takes that token as the person's name
(`src/pipeline/personInvite.ts:143`). The gate it checks, `isPersonShapedCapture`, is satisfied by
`PREFERENCE_OR_RELATION_RE` matching **the same word**, so `Likes` qualified itself.

`0.6.60` denied ~200 verbs, determiners and weekday words. It stops the reported card and every
phrasing anyone thought to type into the array — and nothing else. Measured against the shipped fix:

| Title | 0.6.60 resolves |
|---|---|
| `Skipped the gym because Nichita likes it` | `Skipped` |
| `Swapped Annie's snack, likes it better` | `Swapped` |
| `Ordered the boots Nichita likes` | `Ordered` |
| `Craving Annie's fruit tape always` | `Craving` |

English has more verbs than the list has entries, so the bug reopens on the next unlisted one. The
list is containment; it is not a fix.

Three structural problems sit underneath, and none is addressable by a better regex:

1. **The name and its validation come from the same text span.** Any rule where the candidate token
   produces the signal that approves it is self-confirming.
2. **Role is undecidable by pattern.** The invite must fire on the claim's *subject* (`Nichita`),
   not a possessive owner (`Annie` — who owns the snack, not the preference) and not a recommender
   (`Christian`). The existing recommender branch (`personInvite.ts:118–131`) already gave up on
   this: it computes `rec` and then falls through a comment-only `/* fall through */` arm without
   using it. That dead branch is the approach reaching its limit in the source.
3. **Three surfaces re-derive the same name independently** — the home card, `write.ts:392` peer
   grouping (which writes `same person — related claim` links between atoms), and
   `atomsHomeView.upgradePathSet` (which picks what gets hard-linked when the user taps Add). One
   bad name becomes three wrong writes, and any fix must be applied three times.

The model already reads the capture, already returns structured JSON, and already knows `Likes` is a
verb and `Annie` is not the subject. Asking it is one schema field.

### Product bar (user-visible)

| Capture | Today | After |
|---|---|---|
| `likes Annie's fruit tape snack` | **Add Likes?** | no card |
| `Nichita likes long brown boots` | Add Nichita? | Add Nichita? (unchanged) |
| `Christian told me to watch MHA` | no card | no card (unchanged) |
| `Mom wants to celebrate for her bday` | Add Mom? | Add Mom? (unchanged) |
| `Skipped the gym because Nichita likes it` | **Add Skipped?** | no card |

A card that names a non-person is the failure this plan exists to make impossible. **Under-invite
beats a fake hub** — the invite's whole premise is that hub creation stays the user's call, so a
missed invite costs one un-hubbed atom while a wrong one puts a fabricated person in the vault.

### Non-goals

- **No possessive-owner fallback.** `Annie` in the reported title owns the snack, not the
  preference; `Loves Trader Joe's` would invite `Trader`.
- **No bundled wordlist or POS tagger.** Larger, still wrong on Will / May / Rose / Grace / Art, and
  still silent on role — the actual question.
- **No subject inference from neighbouring daily bullets.** That capture almost certainly sat under
  other Nichita bullets on Jul 31, but a wrong guess writes a false fact about a real person into a
  vault whose premise is being trusted. Subject-less captures belong in `reconsider`, not in a
  confident attribution.
- **No title rewriting.** `Likes Annie's fruit tape snack` is also a title-quality defect — not a
  declarative claim about anything identifiable. Separate issue (see Follow-ups).
- Body stays verbatim throughout (non-negotiable 1). `people` is model output on the
  title/tags/links surface only.

## Key technical decisions

**KTD1 — `people` is model output, not derived.** Add to `CLASSIFICATION_SCHEMA`
(`classify.ts:59`):

```ts
people: {
  type: "array",
  items: {
    type: "object",
    properties: {
      name: { type: "string", description: "Person's name exactly as written in the capture." },
      role: { type: "string", enum: ["subject", "mentioned", "recommender"] },
    },
    required: ["name", "role"],
    additionalProperties: false,
  },
  description:
    "People in the capture. subject = the claim is about them; mentioned = named but not the "
    + "claim's subject (a possessive owner, a bystander); recommender = they suggested media. "
    + "Empty array is correct and common — captures often drop the subject entirely. Never infer "
    + "a name that is not written in the capture.",
}
```

Added to `required`. `additionalProperties: false` everywhere, per KTD4 of the original plan.

**KTD2 — invite fires on `role: "subject"` only.** `mentioned` may still receive a link to an
*existing* hub (that is `enrichPersonLinks`' job and unchanged); it never creates an invite.
`recommender` replaces `RECOMMENDER_RE` and deletes the dead branch at `personInvite.ts:118–131`.

**KTD3 — persist to frontmatter, derive nowhere.** `render` writes `atoms-people:` (name + role) into
the atom's frontmatter. All three consumers read the field. This is the half of the fix that stops
the *next* bug of this shape: prose is a rendering, and re-parsing a rendering to recover structure
the pipeline already had is the defect class, not one instance of it.

**KTD4 — model output stays untrusted.** Schema well-formedness is trusted; content is not
(`classify.ts:268`). Two invariants, both rejecting the name rather than the whole result:

- `name` must appear verbatim in the capture text (`captureMentionsKey` already does the
  possessive-aware match) — kills hallucinated subjects.
- `isDeniedPersonName` still runs — the `0.6.60` list becomes a backstop for model slips.

**KTD5 — no extra API call.** One field inside the existing request. The `cache_control` breakpoint
sits on the system prompt (`classify.ts:458–468`), so a prompt/schema change invalidates the prefix
**once**, not per capture.

**KTD6 — legacy atoms keep today's behaviour until refreshed.** Atoms with no `atoms-people` fall
back to the existing heuristic *including* the `0.6.60` deny list. No silent regression on the
existing library, and no rush to reprocess. `CURRENT_ATOMS_QUALITY` 7 → 8
(`atomQuality.ts:7`) makes `atoms:update-notes` refill the field on older atoms through the
mechanism that already exists for exactly this.

## Units

**U1 — schema + prompt + types.** `classify.ts` (schema, `SYSTEM_PROMPT` guidance incl. "empty is
correct"), `shared/types.ts` (`ClassificationResult.people`), invariants per KTD4, **and the
`plus-service/src/classifyTemplate.mjs` snapshot in the same commit** (see Risks).
*Tests:* schema shape; verbatim-name invariant drops a hallucinated subject; deny list still applies;
empty array parses. *Done when:* a fixture capture round-trips `people` with roles.

**U2 — persistence.** `render.ts` writes `atoms-people`; a parse helper reads it (alongside
`parseAtomsQuality`). *Tests:* round-trip incl. names with `'` / diacritics / spaces; absent field →
`null`, not `[]`, so U3 can tell "legacy" from "no people".

**U3 — invite consumes the field.** `personInvite.ts`: `resolvePersonInviteName` takes the parsed
people; regex path demoted to `resolvePersonInviteNameLegacy`, used only when the field is absent.
Delete the dead recommender arm. *Tests:* the five product-bar rows; legacy path still passes the
existing `Mom` / `Dom` / CRG suite.

**U4 — the other two consumers.** `write.ts:392` peer grouping and
`atomsHomeView.upgradePathSet` read the field. *Tests:* two atoms sharing a *subject* peer-link; two
atoms sharing only a verb do not.

**U5 — backfill.** `CURRENT_ATOMS_QUALITY` 7 → 8; verify `refreshAtoms` fills `atoms-people` and
that a refreshed `Likes Annie's…` atom yields no invite. *Tests:* eligibility + post-refresh assert.

**U6 — shipping tail.** `ce-simplify-code` → `ce-code-review` → `ce-compound` (extend the existing
solution doc with the durable half) → `world-class-qa` + `adversarial-qa`, then PR with
`Closes #<issue>`.

## Risks

| Risk | Mitigation |
|---|---|
| Model names a subject the capture never states | KTD4 verbatim-in-capture invariant |
| Model marks a possessive owner `subject` | Prompt example uses the reported capture; U3 test asserts `Annie` is `mentioned` |
| Nicknames / non-Latin names | Verbatim match is script-agnostic; `enrichPersonLinks` alias matching unchanged |
| Legacy atoms regress | KTD6 fallback keeps `0.6.60` behaviour until refresh |
| Prompt-cache churn | KTD5 — one invalidation, system-prompt breakpoint |
| **Plus service drift** | `plus-service/src/classifyTemplate.mjs:80` is a **hand-synced snapshot** of `SYSTEM_PROMPT` + `CLASSIFICATION_SCHEMA` ("keep in sync with" comment, `:3`), consumed at `anthropic.mjs:239`. Update both in the same PR or Plus subscribers silently classify against the old schema, never emit `people`, and land permanently on the KTD6 legacy path. This is a **U1 deliverable**, not a check. |

## Evidence plan

Unit tests are necessary and not sufficient. Live-vault proof required: append the reported capture
verbatim to a `test_vault` daily → **Process** → observe no People card, then a `Nichita likes …`
capture → card appears. `./scripts/verify.sh` + `obsidian dev:screenshot` for the home surface;
screenshots under `docs/qa/screenshots/<branch>/` linked by absolute raw URL in the PR body.

> The session that drafted this had no Obsidian and no CLI, so **none of the above has run.**

## Follow-ups (separate issues, not this plan)

1. **Verb-led titles are a quality defect.** `Likes Annie's fruit tape snack` fails the declarative-
   claim bar before any card renders. With `people: []` from U1, the pipeline can finally *detect*
   the subject-less case and route it to `reconsider` — which is the honest product answer to a
   headless preference capture.
2. **Retire `PERSON_INVITE_NON_NAME_WORDS` from the hot path** once U5 has refreshed the library;
   keep it as the KTD4 backstop only.
