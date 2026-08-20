---
handoff_date: 2026-08-20
branch: feat/together-news-hub-catalog
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-together-news-hub-catalog
base: master
tracking: none
status: in-progress
---

# Handoff — Together news and hub catalog

You are picking up this work in a fresh session. Read this file top to bottom, run **How to resume**, then start **Next steps** immediately. Do not ask what to work on. Do not re-brainstorm.

## Goal

Stop Home Together from occupying the hero as a directory of clusters the user already has. Accepted hubs become the catalog. Together occupies Home only as news that something just joined a hub. Open goes to the hub note.

## Current status

- Requirements and implementation plan are written: `docs/plans/2026-08-20-1043-feat-together-news-hub-catalog-plan.md` (`artifact_readiness: implementation-ready`).
- `CONCEPTS.md` has a **Together news** entry. Mind-change priority vs news is still U5.
- No GitHub issue, no `STATUS.md` row, no draft PR, no implementation code.
- The main checkout is still `feat/watchlist-hub-membership` (#571). Do not implement there.
- Engine: native inline/subagent. Do not edit `hubInvite.ts` until #571 merges (In progress, owns that file). Named-list match goes in `hubQualify` / a new helper file, not a `hubInvite.ts` export, unless #571 is done.

## Next steps

1. Hard claim per `docs/collab.md`: GitHub issue assigned to Tai, `STATUS.md` row, push this branch, open a **draft** PR with `Closes #<n>`.
2. Check `STATUS.md` In flight. `#571` owns `hubInvite.ts`. `#569` (in review) owns `atomsHomeView.ts`. Re-scope: do not touch `hubInvite.ts`. Copy named-list title match into `hubQualify` (or a new `namedListHubs.ts` that `hubQualify` imports). Rebase Home work when #569 merges.
3. Implement in plan order: **U2 → U1 → U3 → U4 → U5**. Keep Together directory unrendered until U4. Test-first on U1.
4. Verify with the plan’s Verification Contract (`npx vitest run` the named files, then `npm test` before merge). Throwaway vault only. Do not seed hubs to force a green card.

## Key files

- `docs/plans/2026-08-20-1043-feat-together-news-hub-catalog-plan.md` — authority. Scan headings; do not read the whole file first. Goal Capsule, then each U-ID plus cited R/KTD.
- `src/home/atomsHomeView.ts` — Together directory (~1298 fill, ~1634 render, ~2275 hero). Not now is in-memory. Open is `entity-siblings`.
- `src/pipeline/hubQualify.ts` — headingless Show list is not a candidate today (`isListHubCandidate` wants H2 or delimiters).
- `src/pipeline/hubInvite.ts` — private `LIST_NAMED`; **do not edit while #571 is in progress**.
- `src/plugin/main.ts` — `openHubListPreview` no-ops unless `enableHubProjection === true`.
- `src/pipeline/runHubProjection.ts` — `collectListHubTitles` / `runHubProjectionForHubs` / `applyHubProjectionPlan`.

## Decisions & constraints

- Together is news, not a directory. Do not snooze-only the dump. Do not delete Together.
- Every accepted hub including people. Person pings stay; sibling dump goes.
- Open goes to the hub note, not the new atom.
- Fill existing members now via the existing hub-list preview, not silent fill. Listing default stays **false**.
- First-run preview: first **calm Home**, set listing on then open preview. X/Escape = Not now. Not from onload/Process/empty plan.
- Open/Not now stamp **every currently unseen member of that hub**. This visit returns to For you. Other hubs wait until the next calm Home.
- Invite accept is not news (stamp those paths). Live invite outranks news. Snoozed invite excludes **that** hub only.
- Refresh Not now does not stamp told.
- Preview skip: catalog can stay empty for old members; they are not news; listing stays on so later joins write. Recovery is Settings Refresh.
- Card chrome: Together kicker, title = newest atom, supporting line = hub title, Open / Not now. No count, no peek list.
- Body sacred. No silent auto-create. No second list writer.
- Atoms collab: issue + assignee + STATUS + draft PR **before** implementation.

## Open questions / blockers

- `#571` overlap on `hubInvite.ts` — work around; do not wait unless the user says wait.
- `#569` overlap on `atomsHomeView.ts` — implement on this branch from master; rebase after it merges.
- Remaining review nits (not blocking): re-read-before-modify on first-fill apply vs the known lost-update learning; product `KD*` vs planning `KTD*` numbering.

## Git state

- Branch `feat/together-news-hub-catalog` (base `master`).
- Worktree `/Users/a515138832/StudioProjects/obsidian_plugin-together-news-hub-catalog`.
- Last commit: `54aac2e` docs: Together news plan and handoff
- Pushed to `origin/feat/together-news-hub-catalog`.

## How to resume

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-together-news-hub-catalog
git fetch origin && git switch feat/together-news-hub-catalog && git pull --ff-only
```

Then begin Next step 1 (hard claim). Read `docs/collab.md` and the plan Goal Capsule before creating the issue.
