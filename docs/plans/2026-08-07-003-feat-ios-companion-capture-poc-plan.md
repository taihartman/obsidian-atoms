---
title: "iOS companion Capture POC - Plan"
date: 2026-08-07
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
status: active
issue: 379
pr: 380
branch: feat/379-ios-companion-capture
module: companion/ios
tags:
  - companion
  - ios
  - capture
  - live-activity
  - inbox
---

# iOS companion Capture POC - Plan

## Goal Capsule

**Objective.** Ship an iOS **Atoms Capture** companion that matches the Android POC (#166 / #362): one-second capture into `Atoms System/Inbox.md` with the same wire contract, without opening Obsidian for write. Live Activities / Dynamic Island carry **status and actions**, not typing.

**Product authority.** Constitution (body sacred, second brain not task app, desktop+iOS+Android consumers). Research: `docs/research/2026-08-07-companion-capture-app.md`. Android shipped surface set is the UX north star, not a pixel clone.

**Open blockers.** None product-side. Technical: Files-visible vault dogfood path must be proven on a real device; Sync-sandbox users rely on Shortcut fallback until Plus relay.

## Product Contract

### Summary

A free iOS companion app (hub for setup + one-second surfaces) appends stamped capture lines to the vault inbox. Primary write is a security-scoped Files bookmark when the vault is writable. Fallback is the existing Capture Shortcut with the same body. Day-to-day capture never requires opening the hub. Live Activity shows listening/delivery state and Stop/Save; the capture sheet owns type + live voice partials.

### Problem Frame

iOS already has a working Shortcut path, but it is fragile to install and weak for “one second from lock screen / island.” Android now has hub + overlay + widget + shade + live voice. iOS needs a first-class companion without lying about Sync-sandbox filesystem limits.

### Users

- Atoms users on iPhone who already capture via Shortcut or want Android-class one-second capture.
- Setup happens once (vault link or Shortcut mode); daily path is widget / Intent / Action Button.

### Requirements

| ID | Requirement |
|----|-------------|
| R1 | Capture body is never rewritten beyond the shared multiline whitespace rule (body sacred). |
| R2 | Every successful write produces a line the plugin drain accepts: `- YYYY-MM-DDTHH:mm:ss±HH:MM text` with tab continuations for newlines (same as Android / `src/pipeline/inbox.ts`). |
| R3 | Path target is `Atoms System/Inbox.md` under the linked vault (create folder/file if missing, same template spirit as Android). |
| R4 | **Primary delivery:** security-scoped bookmark to a Files-visible vault; append when writable. |
| R5 | **Fallback delivery:** when vault is not writable or user chose Shortcut mode, hand the capture body to the Capture Shortcut / App Intent path; never silent no-op. |
| R6 | **Honest status** after each attempt: *In vault* · *Handed to Shortcut* · *Failed* (with reason). No fake success. |
| R7 | Hub is **setup only**: link vault or Shortcut mode, permissions, checklist for widget / Intent / Live Activity, one test capture. |
| R8 | Day-to-day entry does not require opening the hub. |
| R9 | Capture sheet supports type + **live voice partials** into the field; stop keeps what is already shown (Android parity). |
| R10 | **Live Activity / Dynamic Island** shows capture-in-progress (Listening, last partial preview read-only) and short post-save delivery state; Stop/Save via App Intents. Not a typing surface. |
| R11 | **POC floor surfaces:** Home Screen widget, App Intent (Shortcuts / Action Button), capture sheet, Live Activity. |
| R12 | **Stretch in same ship if cheap:** Lock Screen widget, Share extension, Control Center control — not merge blockers. |
| R13 | Brand mark is the ↵ sentinel (tryatoms.com / Android), used for app icon and primary chrome. |
| R14 | Companion never classifies, never files atoms, never becomes a task app. |
| R15 | Plus/self-host capture relay is **out of POC**; document as follow-up for Sync-sandbox closed-app parity. |

### Key Decisions

| ID | Decision | Notes |
|----|----------|--------|
| K1 | Files-first + Shortcut fallback | session-settled: user-approved (2026-08-07). Plus relay later. |
| K2 | Live Activity = status + actions only | session-settled: user-approved. Sheet owns input. |
| K3 | POC floor = widget + Intent + sheet + LA | session-settled: user-approved. Full surface list is end-state. |
| K4 | Live voice partials required | session-settled: user-approved. |
| K5 | Hub = setup, not daily home | session-settled: user-approved. Android checklist pattern. |
| K6 | Same inbox wire as Android/plugin | No iOS-only stamp shape. |

### Non-goals

- App Store listing polish / ASO.
- Plus capture queue / cloud enqueue in this POC.
- Classify, Library, Home, Ask on phone.
- Pixel-perfect Android overlay clone (iOS has no pass-through overlay strip).
- Replacing the existing Shortcut for users who prefer it.

### Success Criteria

- [ ] Dogfood: from Home widget or App Intent, type or speak a capture, get *In vault* or *Handed to Shortcut* with a real Inbox line Obsidian Process can drain.
- [ ] Live Activity appears while listening/saving and clears after success or user dismiss.
- [ ] Fresh install checklist teaches widget + Intent + LA the way Android teaches shade + widget.
- [ ] Unit tests pin stamp/multiline/path constants against the same fixtures spirit as Android `CaptureLineTest`.
- [ ] Screenshots under `docs/qa/screenshots/ios-capture-poc/`.

### Acceptance Signals (UX)

- User never wonders if the note was lost (status is explicit).
- Voice feels like a live feed, not “press stop then dump.”
- Island glance answers “am I still listening / did it save?”

### Outstanding Questions (for ce-plan)

- Exact Shortcut handoff mechanism (x-callback / App Intent URL / shared app group with Shortcut recipe update).
- Minimum iOS version (Live Activities need 16.1+; Controls need 18 — floor vs stretch).
- On-device vs server speech recognition defaults and offline behavior.
- Whether security-scoped bookmark refresh UX lives only in hub or also on write failure.

### References

- Issue #379 · Draft PR #380 · Branch `feat/379-ios-companion-capture`
- Android: #166 #369 · PR #362 · `companion/android/**`
- Research: `docs/research/2026-08-07-companion-capture-app.md`
- Wire: `src/pipeline/inbox.ts`, `docs/solutions/documentation-gaps/ios-shortcut-capture-wire-format-traps.md`
- FGS/mic learning (Android analogue discipline): `docs/solutions/logic-errors/android-overlay-fgs-must-declare-microphone-for-speech.md`
