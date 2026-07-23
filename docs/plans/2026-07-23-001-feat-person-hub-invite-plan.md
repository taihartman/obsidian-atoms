---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
title: "Person hub invite - Plan"
date: 2026-07-23
github_issue: 60
---

# Person hub invite - Plan

## Goal Capsule

**Objective.** After filing, when a high-confidence person has no vault person note, Atoms home offers one calm **Add {Name}?** card. One tap creates a minimal person note and upgrades recent same-name atoms onto hard `[[Name]]` links. Same-name atoms may peer-link before the hub exists. Never silent auto-create.

**Product authority.** Product Contract below (enriched from ce-brainstorm). Cousin briefs (do not re-litigate auto-create):

- Issue [#60](https://github.com/taihartman/obsidian-atoms/issues/60) — implementation claim target
- `docs/plans/2026-07-16-person-hub-creation-adversarial-and-apple-brief.md`
- Mock: `docs/design-handoff/atoms-view/person-hub-invite.html`
- Entity orbits contract (soft keys, Also about): `docs/plans/2026-07-17-006-spec-entity-orbits-product-contract.md`
- Packing sibling pattern: `src/pipeline/entityInvite.ts` + home card

**Open blockers.** None. Before code: assign #60 + STATUS row + draft PR.

**Product Contract preservation.** Unchanged after ce-plan enrichment except planning defaults filled in Planning Contract (snooze 14d, recent window 14d). R-IDs stable.

---

## Product Contract

### Summary

Ship the person-note invite path that design already approved: suggest missing people on Atoms home after Process/Update, human accept only, body sacred. Extend the brief with same-name **peer links** while the hub is missing and **upgrade-on-accept** across a short recent window. Project/app invites (Aploma) and place hubs (CRG) reuse this card family later — not this claim. Daily marker integrity is a separate follow-up issue.

### Problem Frame

Live Remote Vault dogfood (2026-07-23 audit): Nichita-linked atoms feel like a second brain; Mom birthday climb dumps to soft `[[People]]`; Dom/Ning/Sherry often soft-bucket only. Soft buckets look like structure and are not. Users will not hand-author hubs before every capture; the product must invite at the moment of meaning. (Project/app gaps such as Aploma are motivation for the later card family only — not acceptance criteria for this claim; see #109.)

### Users

Primary: single vault owner on desktop and phone (Obsidian Sync), using capture → Process / auto-run → Atoms home.

### Requirements

**Invite surface**

- R1. When a high-confidence person miss is pending, Atoms home shows at most **one** calm **Add {Name}?** card (not a modal wall, not a multi-select people sheet). Triggers that may create or refresh pending misses: Process, Update notes, and auto-run (same candidate rules).
- R1a. **Pending queue.** Eligible misses persist (recompute from vault and/or device-local pending) until Add, Not now (name snooze), a matching person note appears, or TTL. Next calm home open still offers the top pending invite even if home was closed at write time.
- R1b. **Home stack.** Invite renders only in calm idle (no land peak, no wait/process hero). After the user dismisses Done/land peak, person invite outranks Together and resurface when a pending miss exists. Versus packing `Make {label}?`: person invite wins when both qualify (one identity invite at a time). Update-notes strip may stack above the invite; never three invite-class cards.
- R1c. **Which name.** When multiple high-confidence misses compete, pick deterministically: (1) most recent source-day among candidate atoms, (2) higher same-label count in the R11 window, (3) kinship-head boost, (4) stable localeCompare on display name. Lower ranks wait for a later calm open after the top name is accepted or snoozed — no carousel, no “+N more people.”
- R2. Card copy matches the mock tone: name the person, say there is no person note yet, primary **Add {Name}**, secondary **Not now**. No CRM language. Interaction: idle → creating (both actions disabled) → success (in-home done state + short Notice backup) → idle. Create failure keeps the card with one-line error; do not roll back a successful note if link upgrade partially fails.
- R3. User-facing language is **person note** (or just the name). “Hub” stays internal/docs.

**Confidence gate**

- R4. Invite only when all hold: verdict atom; capture/title is person-shaped; a clear display name resolves; no existing person hub matches that name (discovery empty); not a denylisted soft title (`People`, `Social`, …); not a place/org/show token treated as person (e.g. CRG, High School Musical).
- R5. Kinship heads (**Mom**, **Dad**, and clear equivalents) may qualify without prior vault history only when the person is the clear sole subject of the claim (not multi-person dumps). Collision: if any vault title already matches the display name (any folder), do not invite create — run upgrade-only toward that existing note when safe, or suppress create.
- R6. Pure media tips where the person is only a recommender (“Christian told me to watch …”) do not earn a person invite unless the person is clearly the claim subject.
- R7. Prefer under-invite: a missed invite beats a wrong person note.
- R7a. **Negative dogfood table (ship-blocker):** CRG, High School Musical, one-shot media recommender, and brand/place tokens must not produce an invite card. Kinship sole-subject and clear named identity captures must.

**Create on accept**

- R8. **Add {Name}** creates exactly one minimal person note under the user’s people folder family (prefer existing Social/People discovery paths; configurable later if needed). Content: title heading and optional `#person` — no fake bio.
- R9. Never silent auto-create on classify, auto-run, Update, or agent paths.
- R10. On accept, rewrite **plugin-owned link-prose only** on affected atoms: soft `[[People]]` and same-name peer links upgrade to hard `[[Name]]` with a substantive reason. Capture body stays verbatim. Always upgrade the triggering atom(s) for that invite; then best-effort the short recent window (R11).
- R10a. If a matching person note appears without Add (user-created or Sync), the next Process/Update/home refresh may upgrade plugin link-prose in the same window — still never silent-create a note.
- R11. On accept, upgrade atoms in a **short recent window** (planning picks exact days; product intent ~14 days of generated atoms), not whole-vault archaeology. Limit upgrade set to atoms that share the invite’s high-confidence label (not arbitrary string collisions).
- R12. Confirmation: in-home success state is canonical; Notice is backup (“Added {Name}”). Undo = user deletes the note; no multi-step CRM undo stack required for v1.
- R12a. **Already have them:** secondary path or Not-now reason that snoozes the extracted label **without** creating a note (suppress create). Full alias merge can wait.

**Dismiss**

- R13. **Not now** snoozes that **name** device-locally (planning picks N days; packing invite snooze is a reasonable default). Do not re-ask that name in the same home leaf instance. Other names remain eligible on a later calm open per R1c. No shame copy. Re-invite after TTL only with new evidence (new atom with that label), not every home open.

**Peer links before hub**

- R14. When two or more generated atoms share the same high-confidence person label under the **same gates as invite (R4–R7)** and no hub exists yet, they **receive** peer links (plugin link-prose, substantive reason). Scope: this Process/Update batch plus the R11 recent window.
- R14a. **Orbit-safe:** peer edges must not become surfaceable Also about / Together keys. Exclude atom-folder titles from orbit membership, or encode peers so claim titles are not hard orbit keys. Identity hard key appears only after the person note exists (accept or R10a).
- R14b. **False-merge guard:** do not peer bare common first names across conflicting qualifiers; prefer kinship heads and multi-evidence labels. On Not now for a name, do not leave peers that imply a rejected identity without a defined stance (planning: drop peers for that label or leave inert without orbit surface).
- R15. Peer links never use soft buckets (`People`, `App ideas`, `Camping`, …) as identity. Soft `[[People]]` remains write-time fallback until invite accept or a real hub appears; it never surfaces as Also about / person kinship alone (R17).
- R16. Identity is the **person note**, not tags. Facet tags (`#person`, `#preferences`) stay facets. Do not invent `#Mom` / name-tags as the graph. No peer chrome on the invite card or home.

**Consistency with existing graph rules**

- R17. Soft keys never surface as Also about / Together alone (existing entity-orbit contract still wins).
- R18. Desktop, iOS, and Android consumers share the same invite behavior (home card + create path); no platform-only product.

**Success signals**

- R19. Dogfood (person outcomes only — not Aploma): sole-subject Mom-shaped and Dom-shaped captures with no prior hubs → pending invite → calm home offers Add; accept → triggering atoms hard-link the new notes (plus best-effort R11 window); Nichita path unchanged. Single-capture Mom must pass without requiring a second atom for peers.
- R19a. Auto-run writes a miss while home is closed → later calm home open still offers Add for that pending name.
- R19b. Two-miss batch → after first name accepted or snoozed, a later calm open can offer the second name (R1c).
- R20. Negative table R7a is green: no invite for CRG / show / one-shot recommender / brand-place. Almost zero accidental person notes from those classes.
- R21. User never sees a batch “create 12 people” homework UI.
- R22. Unaccepted invite-eligible miss does not surface Also about / Together on `People` or on peer claim titles (R14a, R17).

### Key Decisions

| ID | Decision | Notes |
|---|---|---|
| KTD1 | **Invite, never silent auto-create** | session-settled: over auto-create — trust + Sync safety (brief + this brainstorm) |
| KTD2 | **Ship person invite (#60) before project/app invite** | session-settled: over mega-claim — person is highest-precision class; Aploma next claim |
| KTD3 | **Surface = Atoms home after Process/Update** | session-settled: over Notice-only or atom-strip-only — matches mock + packing Make card |
| KTD4 | **Hubs not tags; CRG ≠ person** | session-settled: place/project are later card family, not person resolver |
| KTD5 | **Peer-link same missing name; upgrade on Add** | session-settled: over hub-only linking — graph alive before accept |
| KTD6 | **High confidence only; max one invite card at a time** | session-settled: over any-first-name; refined: pending queue + R1c rotation across calm opens, not permanent one-name forever |
| KTD7 | **Marker scramble out of this claim** | session-settled: separate follow-up issue so #60 stays focused |

### Scope Boundaries

**In**

- Person-note invite UI on Atoms home (Phase 1–2 of the 2026-07-16 brief)
- One-tap create + re-link/upgrade
- Same-name peer links while hub missing
- Wire existing `personHubMiss` signal into invite candidates (not only Notice counts)

**Out**

- Silent hub auto-create
- Project/app hub invite (Aploma) — **next claim** (see below)
- Place hub invite (CRG)
- Power “review all missing people” list (brief Phase 3)
- CRM fields (birthday, company, relationship type)
- Daily marker retarget integrity fix (follow-up issue)
- Changing Also about minMembers or soft denylist policy except as needed for person peers
- Agent unattended person-note creation on personal Remote Vault

### Next claim (not this implementation)

**Project/app hub invite (Aploma-class)** — same calm card family after the person-invite pattern is trusted. Details deferred to [#109](https://github.com/taihartman/obsidian-atoms/issues/109). Do not block #60 on it.

### Follow-up issue (trust)

**Daily marker integrity** — some processed dailies point markers at the wrong atom while atom bodies are correct (e.g. Grok capture → Penfield marker). Out of #60 scope. GitHub: [#108](https://github.com/taihartman/obsidian-atoms/issues/108).

### Assumptions

- A1. People-folder discovery can reuse existing person-hub discovery path boosts (Social / People family).
- A2. Exact dismiss TTL and recent-window day count are planning defaults unless dogfood forces a change.
- A3. Packing `Make {label}?` stays as-is; person invite is a sibling card, not a rewrite of entity orbits T0–T2.

### Outstanding Questions

None blocking planning. Planning may choose concrete defaults for dismiss TTL, recent-window days, people-folder path when Social/People is absent, and Not-now peer cleanup (R14b) without reopening product scope.

### Deferred from review

- Full alias picker (“link to existing note…”) beyond R12a suppress-without-create
- Accessibility implementation detail (min targets, live regions) — planning + mock parity
- Whether invite-eligible misses should stop writing soft `[[People]]` entirely (R15 keeps write-time fallback; surface rules already ban People-as-shelf)

### Risks

| Risk | Mitigation |
|---|---|
| False person notes (Jake, CRG-as-person) | High-confidence gate; under-invite; human accept only |
| Sync clutter from mass creates | Max one invite card; no batch create; no silent create |
| Body rewrite accidents | Upgrade only plugin link-prose lines |
| Scope creep into Aploma/places | Explicit next-claim boundary |
| Marker distrust confuses invite QA | Separate integrity issue; dogfood on demo/test vault |

### References

- Live pain examples (personal vault, read-only audit 2026-07-23): Mom → `[[People]]`; Dom/Ning soft-only; Nichita hub path healthy
- `docs/architecture.md` — people hubs + entity orbits
- `docs/architecture-constellations.md` — T3 non-person invite after person pattern trusted

---

## Planning Contract

### Technical approach

Mirror packing **Make {label}?** (`entityInvite` + home card), as a **sibling** person path — do not overload packing shape gates.

| Layer | Approach |
|---|---|
| Name + gates | Pure module: extract display name, kinship/media/place denylist, invite eligibility |
| Candidates | `collectPersonInvites` parallel to `collectEntityInvites` — group by label, snooze, rank R1c |
| Peer links | On classify/write enrich: same-label peers when ≥2; **orbit-safe** (atom titles never orbit keys) |
| Home | Typed invite slot: person outranks packing; calm idle only; create under Social/People family |
| Upgrade | Copy `onCreateEntityHub` prose rewrite; soft People + peers → hard `[[Name]]` |

**Planning defaults (A2):** snooze TTL = 14 days (`ENTITY_INVITE_SNOOZE_DAYS`); recent window = 14 days of generated atoms (by `created` frontmatter or file mtime fallback).

**People folder (A1):** prefer first existing folder among `Personal notes/Social/`, `Social/`, `People/`; else create `Personal notes/Social/` if parent exists, else vault-root last resort. No new setting in v1.

**Execution direction:** test-first on pure collectors, name gates, orbit-safe peer policy, and link-prose upgrade helpers. Home create path: unit where pure; vault smoke via CLI on demo/test vault only.

### Key technical decisions

| ID | Decision | Rationale |
|---|---|---|
| TKD1 | New `personInvite.ts` (+ name helpers in `people.ts` or sibling) — do not extend `isEntityShaped` | Packing regexes are wrong for people |
| TKD2 | Home invite union: person candidate preferred over packing entity invite | R1b |
| TKD3 | Peer encoding: atom↔atom wikilinks allowed in prose **only if** `entityOrbitIndex` excludes atom-folder basenames from orbit keys | R14a |
| TKD4 | Reuse packing LS snooze map shape with separate key `atoms-person-invite-snooze` | Avoid packing/person cross-snooze |
| TKD5 | `personHubMissAfterEnrich` stays boolean for Notices; invite uses name-bearing collector | Miss alone has no display name (R5 gap) |
| TKD6 | No second AI call | Piggyback classify + local enrich only |

### Patterns to follow

- Collect/snooze/copy: `src/pipeline/entityInvite.ts`
- Home card + create + prose upgrade: `src/home/atomsHomeView.ts` (`renderEntityInviteCard`, `onCreateEntityHub`, calm stack ~1562)
- Person shape/discovery: `src/pipeline/enrich/people.ts`
- Link prose: `src/pipeline/parseLinkProse.ts`, `formatLinkProse` in `render.ts`
- Soft keys: `src/pipeline/softKeys.ts`
- Orbit keys: `src/pipeline/entityOrbitIndex.ts` — extend to skip atom-folder titles
- Mock: `docs/design-handoff/atoms-view/person-hub-invite.html`
- Tests: `test/entityInvite.test.ts`, `test/people.test.ts`, `test/entityOrbitIndex.test.ts`

### Dependencies / sequencing

U1 → U2 → U3 → U4. U2 peers need U1 labels. U3 home needs U1 candidates + U2 prose rules. U4 version after behavior green.

### Assumptions

- A-plan-1. Generated atoms are identifiable via `generated-by: linker` (or existing helper `isGeneratedAtomContent`).
- A-plan-2. Classify already attaches `#person` / preference tags often enough for shape; name extractor + kinship covers Mom without tags.
- A-plan-3. Device-local snooze is sufficient; phone may re-offer after desktop snooze (documented residual).

### Risks (implementation)

| Risk | Mitigation |
|---|---|
| Orbit surfaces claim titles via peers | TKD3 + unit tests before home |
| Mom not person-shaped today | Expand shape/name for kinship sole-subject; R7a dogfood |
| Partial upgrade on multi-file Accept | Same as packing: Notice + keep note; no rollback |
| Home one-hero fights packing | Explicit person > packing in refresh |

---

## Implementation Units

### U1. Person name resolve + invite candidate collector

**Goal.** Pure functions: high-confidence display name, invite eligibility (R4–R7a), collect/rank candidates (R1c), snooze filter, people-folder path pick, hub markdown + copy.

**Files**

- Create: `src/pipeline/personInvite.ts`
- Modify: `src/pipeline/enrich/people.ts` (export shape helpers; kinship sole-subject; place/show denylist tokens)
- Test: `test/personInvite.test.ts`, extend `test/people.test.ts`

**Approach**

- `resolvePersonInviteName(capture, title, tags) → string | null` — kinship heads (Mom/Dad); capitalized name tokens with person-shape; reject soft keys, place/show denylist (CRG, High School Musical, …), media-recommender-only (R6).
- `isPersonInviteEligible(...)` — verdict atom, person-shaped or kinship sole-subject, name non-null, no hub match (discovery titles), not snoozed, not existing vault title collision for create path.
- `collectPersonInvites(atoms, vaultTitles, personHubTitles, { snoozed, now })` — group by name lower; rank R1c; return candidates with `memberPaths`, `displayName`, `sourceDays`.
- `formatPersonNoteMarkdown(name)`, `personInviteCopy(name, n)` → Add {Name}? / Not now / Already have them optional secondary later.
- `resolvePeopleFolderPrefix(folderPaths: string[]) → string` for create path.
- Defaults: `PERSON_INVITE_SNOOZE_DAYS = 14`, `PERSON_INVITE_RECENT_DAYS = 14`.

**Test scenarios**

- Mom sole-subject → name Mom; multi-person dump with Mom → under-invite or null per R5
- CRG / HSM / “Christian told me to watch X” → no invite name
- Two Dom atoms + snoozed Dom → empty; unsnoozed → one candidate with 2 members
- Rank: newer source-day beats older; tie → higher count; tie → kinship; tie → localeCompare
- People folder: prefers Personal notes/Social when present
- Existing vault title Ning → eligible for upgrade-only flag, not create-new

**Verification.** `npm test -- personInvite people`

---

### U2. Orbit-safe peer links + classify wire

**Goal.** When filing/updating, same-label missing-hub atoms get peer link-prose; atom titles never form Also about/Together keys (R14–R14b, R17).

**Files**

- Modify: `src/pipeline/entityOrbitIndex.ts` (exclude paths under atom folder / generated atoms from orbit keys)
- Modify: `src/pipeline/classify.ts` and/or post-enrich in `write.ts` / `refreshAtoms.ts` — apply peer links after person enrich
- Create or extend: peer helper in `personInvite.ts` or `enrich/people.ts`
- Test: `test/entityOrbitIndex.test.ts`, `test/personInvite.test.ts` (peer reason format)

**Approach**

- After enrichPersonLinks, if invite-eligible label L and ≥2 members in batch∪recent window with no hub: add mutual (or star) plugin links with reason like `same person (no person note yet)`.
- Never link soft People as peer target.
- Orbit index: when collecting hard keys from prose, skip notes whose path is under configured atom folder or that fail “user hub” heuristic (prefer path under Atoms/).
- Not now peer cleanup: device-local flag or strip peers for that label on snooze (prefer strip peers for L in recent window — product R14b).

**Test scenarios**

- Three atoms peer-linked on claim titles → zero surfaceable orbits until person note exists
- Soft People only → no orbit
- Hard [[Nichita]] hub → orbit/Also about unchanged for person hub path
- Peer reasons non-junk

**Verification.** `npm test -- entityOrbitIndex personInvite`

---

### U3. Home card, stack, create, upgrade

**Goal.** Calm **Add {Name}?** on Atoms home; create person note; upgrade prose; snooze; stack R1b (R1–R13, R18).

**Files**

- Modify: `src/home/atomsHomeView.ts` (person invite state, refresh, render, create, snooze; person > packing)
- Modify: `src/home/` CSS if needed (`styles.css` person invite tokens from mock)
- Optional thin wire: `src/plugin/main.ts` if home needs plugin API for folder list
- Test: pure pieces unit-tested; home behavior via CLI smoke in U4

**Approach**

- LS key `atoms-person-invite-snooze` (map name → expiry).
- `refreshPersonInvite` after `loadData`: scan generated atoms in recent window; `collectPersonInvites`; take rank-0.
- Calm stack: if person invite → render (outrank packing entity invite). Else existing packing Make → Together → resurface.
- Render: mock parity — kicker person tone, title `Add {Name}?`, body, primary Add, secondary Not now; optional tertiary “Already have them” → snooze without create (R12a).
- Add: resolve folder path; if note exists → upgrade only; else `vault.create` minimal markdown + optional `#person` frontmatter or tag line; upgrade memberPaths + recent same-label generated atoms (R10–R11); Notice + in-home success; reload.
- Creating state: disable buttons.
- Land peak / wait: unchanged suppression.

**Test scenarios (manual/CLI dogfood checklist — see Verification)**

- Single Mom atom → card; Add → Social/Mom.md; atom links [[Mom]]
- Dom + packing Make both qualify → person card only
- Not now Dom → later open can show Ning
- Auto-run miss → open home later → card still possible (recompute)

**Verification.** Demo/test vault CLI after install; unit tests for any extracted pure helpers.

---

### U4. Wire signals, version, QA evidence

**Goal.** Preview/process notices stay honest; version bump; dogfood matrix R7a/R19; ship-ready.

**Files**

- Modify: `src/pipeline/preview.ts` / `write.ts` only if needed to expose invite-eligible count (optional)
- Modify: `package.json`, `manifest.json`, `versions.json` (0.6.27 or next)
- Modify: `docs/qa/` report + screenshots under `docs/qa/screenshots/person-hub-invite/`
- STATUS / PR on claim

**Approach**

- Bump version user-visible.
- Demo vault: seed Mom/Dom captures without hubs; Process; screenshot Add card; Add; screenshot linked atom.
- Negative: CRG capture → no card.
- Do not use personal Remote Vault for agent writes.

**Test scenarios**

- R7a negative table green
- R19 / R19a / R19b checklist
- `npm test` + `npm run build` green

**Verification.** `./scripts/verify.sh` or tests + build + CLI smoke; PR evidence table with absolute raw screenshot URLs.

---

## Verification Contract

```bash
npm test
npm run build
# Obsidian open on test_vault or demo-vault:
./scripts/install-to-vault.sh
# or demo: ./scripts/install-to-vault.sh docs/media/demo-vault
obsidian vault="test vault" command id=atoms:process-fixture-sample   # or live Process after seed
# screenshot Add card + post-accept atom
```

**Gates**

- Unit: personInvite, people kinship/denylist, entityOrbitIndex atom-title exclusion
- Build/typecheck green
- Demo dogfood: Mom sole-subject invite + accept upgrade; CRG no invite; person > packing when both
- No silent person note create on Process alone
- world-class-qa + adversarial before mark-ready (shipping tail)

---

## Definition of Done

- [ ] U1–U4 complete; R1–R22 product contract satisfied or explicitly deferred with issue
- [ ] #60 claimed (STATUS + draft PR with `Closes #60`)
- [ ] Tests green; version bumped; Settings shows new version
- [ ] QA report + screenshots on demo/test vault (not personal Remote Vault)
- [ ] Follow-ups untouched: #108 markers, #109 Aploma
- [ ] Shipping tail: simplify → code-review → compound → world-class-qa
- [ ] After merge to master: `npm run phone` (plugin files only)

---

## Appendix

### Home stack (implementer cheat sheet)

```
firstDay setup → no invite
runPhase ≠ idle → progress
workPending && !landPeak → Ready
landPeak → Done (suppress invites)
calm:
  personInvite? → Add {Name}?
  else packing entityInvite? → Make {label}?
  else together?
  else resurface
Update strip: ok above invite when calm
```

### Create + upgrade (from packing)

1. Path = `{peopleFolder}/{Name}.md`
2. Create if missing (`# Name\n\n` + optional person tag)
3. For each generated atom in upgrade set: `extractLinkProseRegion` → drop soft People / peers for L → add hard Name → `formatLinkProse` → replace region only
4. Notice; clear invite; reload
