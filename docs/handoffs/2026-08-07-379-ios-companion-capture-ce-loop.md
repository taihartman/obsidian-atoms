---
artifact_contract: "ce-handoff/v1"
created_at: "2026-08-07T20:30:00Z"
title: "iOS companion Capture POC — full CE loop after brainstorm"
summary: "Requirements-only plan locked for #379; next is ce-plan then ce-work. Live Activities = status chrome."
keywords: ["ios", "companion", "capture", "live-activity", "379", "380", "ce-plan"]
cwd: "/Users/a515138832/StudioProjects/obsidian_plugin-379-ios-companion-capture"
resume_focus: "Run full CE from ce-plan on docs/plans/2026-08-07-003-feat-ios-companion-capture-poc-plan.md through ce-work, review, compound, ship PR #380"
repository: "taihartman/obsidian-atoms"
branch: "feat/379-ios-companion-capture"
head: "fc634bab23fd036d827a50e9d9907577ae6dba1b"
worktree_path: "/Users/a515138832/StudioProjects/obsidian_plugin-379-ios-companion-capture"
---

# Handoff: iOS companion Capture (#379)

## Resume focus

**Full compound-engineering loop from planning forward** for the iOS Capture companion:

`ce-plan` → `ce-doc-review` (if plan warrants) → `ce-work` → `ce-simplify-code` → `ce-code-review` → `ce-compound` → ship PR #380.

Do **not** re-brainstorm product decisions below unless the user reopens them.

## Objective

Ship iOS **Atoms Capture** companion parity with Android (#166 / #362): one-second capture into `Atoms System/Inbox.md`, same wire contract, hub = setup only.

## Hard claim (already done)

| Item | Value |
|------|--------|
| Issue | [#379](https://github.com/taihartman/obsidian-atoms/issues/379) assigned taihartman |
| Draft PR | [#380](https://github.com/taihartman/obsidian-atoms/pull/380) `Closes #379` |
| Branch | `feat/379-ios-companion-capture` |
| Worktree | `../obsidian_plugin-379-ios-companion-capture` (sibling of main repo) |
| STATUS.md | In progress row for #379 |
| Plan (requirements-only) | `docs/plans/2026-08-07-003-feat-ios-companion-capture-poc-plan.md` |

## Session-settled product decisions (do not re-ask)

1. **Delivery:** Files-first (security-scoped bookmark to Files-visible vault) + **Shortcut fallback** when not writable / user prefers Shortcut. Honest status: *In vault* · *Handed to Shortcut* · *Failed*. Plus relay **out of POC**.
2. **Live Activities / Dynamic Island:** **Yes** — status + Stop/Save actions only. **Not** a typing surface. Capture sheet owns type + live voice.
3. **POC floor:** Home Screen widget · App Intent (Shortcuts / Action Button) · capture sheet + live voice partials · Live Activity.
4. **Stretch (same ship if cheap):** Lock Screen widget · Share extension · Control Center control.
5. **Hub = setup only** (vault/Shortcut mode, checklist, test capture) — not daily home.
6. **Wire format:** identical to Android/plugin (`CaptureLine` / `src/pipeline/inbox.ts`).
7. **Brand:** ↵ mark (tryatoms.com / Android).

## Why Live Activities

iOS has no Android-style pass-through overlay strip. LA/Island is the right **glance** surface for Listening / last partial preview / delivery. Input stays on the sheet.

## Completed this session

- Android companion merged: PR **#362** → master (`24237f9`), closes #166 #369.
- Android CE compound learning: `docs/solutions/logic-errors/android-overlay-fgs-must-declare-microphone-for-speech.md`.
- iOS claim + worktree + draft PR + requirements-only plan committed (`fc634ba`).

## Authoritative references

- Plan: `docs/plans/2026-08-07-003-feat-ios-companion-capture-poc-plan.md`
- Research: `docs/research/2026-08-07-companion-capture-app.md`
- Android reference impl: `companion/android/**` (merged on master)
- Wire SSOT: `src/pipeline/inbox.ts`
- iOS Shortcut traps: `docs/solutions/documentation-gaps/ios-shortcut-capture-wire-format-traps.md`
- Collab: `AGENTS.md`, `docs/collab.md`, `STATUS.md`

## Unfinished / next steps (ordered)

1. **`ce-plan`** — enrich the same plan file to `artifact_readiness: implementation-ready` (units, iOS version floor 16.1+ for LA vs 18 for Controls, Shortcut handoff mechanism, Xcode project layout under `companion/ios/`).
2. Optional **`ce-doc-review`** on the implementation-ready plan.
3. **`ce-work`** — implement POC in worktree; dogfood on device.
4. **`ce-simplify-code` → `ce-code-review` → `ce-compound`**.
5. Screenshots → `docs/qa/screenshots/ios-capture-poc/`; mark PR ready; merge when green.

## Plan open questions (for ce-plan)

- Shortcut handoff: x-callback vs App Intent vs App Group recipe update.
- Min iOS version (LA 16.1+; Controls 18 stretch).
- SFSpeechRecognizer on-device vs network defaults.
- Bookmark refresh UX on write failure.

## Constraints

- No agent install into personal Remote Vault; dogfood demo/test vault only.
- Body sacred; companion is capture-only.
- Constitution changes only via PR.
- Never AI-attribution trailers on commits/PRs.

## Lane

**Full** feature loop (not amend). Process: `docs/workflow-lanes.md`.

## Fresh session bootstrap

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-379-ios-companion-capture
# or: git worktree add ../obsidian_plugin-379-ios-companion-capture feat/379-ios-companion-capture
git pull
```

Read: `AGENTS.md` → `STATUS.md` → plan path above → this handoff.
Then invoke **ce-plan** on the plan file.
