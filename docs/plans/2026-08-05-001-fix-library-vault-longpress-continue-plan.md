---
title: "fix: Library vault-open + long-press Continue"
date: 2026-08-05
type: fix
status: active
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
issue: 288
lane: amend
---

# Library vault-open + long-press Continue - Plan

## Goal capsule

Restore **Library / land peak → open the Obsidian note**. Start **Continue** via **press-and-hold** (mobile) / **right-click** (desktop) on a library row — not by stealing the tap into an in-home reader.

## Product authority

| Source | Role |
|---|---|
| This contract | Nav + Continue entry |
| #16 / 0.6.71 plan | Continue handoff mechanics (pending parent, classify) — **keep**; only R10/KTD10 nav is wrong |
| Mock | `docs/design-handoff/atoms-view/continue-entry-options.html` |

### Settled decisions (session)

| ID | Decision | Provenance |
|---|---|---|
| SD1 | Library / side-panel note tap → **vault leaf only**. No in-home body reader for list rows. | session-settled: user-directed (past issue + this session) |
| SD2 | Land peak row → **vault** (same rule as library). | session-settled: user-directed |
| SD3 | **Long-press** library row → **Continue** (arm pending parent + open today). Desktop: **context menu** with Continue (and Open if useful). | session-settled: user-approved recommended |
| SD4 | Short tap never starts Continue. | session-settled |
| SD5 | Keep pending chip + Process today on home; keep Continue on citator/pair home-open if already there. | session-settled |
| SD6 | Follow-up (own ticket): library filter next to All/Linked for **noise/task** items + long-press to **unlabel** (reconsider-class). | session-settled: deferred |

---

## Product contract

### Requirements

| ID | Requirement |
|---|---|
| R1 | Library row **tap** opens the atom path in the Obsidian editor (`openPathInVault`). |
| R2 | Land peak landed-row **tap** opens vault (not `openAtomInHome`). |
| R3 | Library row **long-press** (~400ms, cancel if finger moves past slop) starts Continue for that row’s title/path. |
| R4 | Desktop library row **contextmenu**: at least **Continue**; optional **Open** (same as tap). |
| R5 | Continue behavior unchanged from #16: device-local pending parent, open today, chip, today-only classify inject, create-only child. |
| R6 | No primary UI that opens library atoms into an in-home full-body reader. |
| R7 | Long-press does not fire on accidental scroll; tap remains instant open. |
| R8 | Version bump for the fix release. |

### Key flows

| ID | Flow |
|---|---|
| F1 | Tap library “Sleep debt is real” → editor opens that file |
| F2 | Long-press same row → Notice + pending chip + today opens |
| F3 | Right-click row (desktop) → Continue → same as F2 |
| F4 | Land peak title tap → vault |

### Acceptance

| ID | Example |
|---|---|
| AE1 | Fresh install after fix: library tap never shows home-open body chrome |
| AE2 | Long-press arms Continue; parent body unchanged after Process today |
| AE3 | Scroll on library list does not trigger Continue |

### Scope

**In:** Revert R10 nav; long-press + context menu Continue on library rows; land → vault; tests; mock already at handoff path; patch bump.

**Out (follow-up ticket):**

- Library segment **Noise** (or similar) beside All / Linked for noise/task-labeled captures or soft-retired items  
- Long-press **Unlabel / Reconsider** on those rows  
- Long-press on land peak (optional later)  
- Command palette Continue (nice-to-have, not required if long-press ships)

### Open questions (defaults)

| Q | Default |
|---|---|
| Long-press duration | ~400ms |
| Haptic on mobile | If Obsidian/platform allows cheaply; else none |
| Citator home-open Continue button | Keep |

---

## Follow-up product note (not this PR)

**Library: Noise / Task strip + long-press unlabel**

- Third filter tab (name TBD: “Held” / “Noise” / “Soft”) next to All · Linked  
- Lists captures or notes marked noise/task (align with existing Reconsider / sentinel model — plan later)  
- Long-press → unlabel / reconsider path so they can re-enter classify  

Track as a separate Issue after this fix ships.
