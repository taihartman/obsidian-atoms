# QA — Inbox self-healing, the stuck card, and home spacing

**Date:** 2026-07-29
**Branch:** `claude/inbox-stuck-card-home-spacing-d5557d` · **PR:** #192 · **Issue:** #191
**Build under test:** Atoms **v0.6.52**, installed and reloaded via Obsidian CLI
**Vault:** `test_vault/test vault` (throwaway QA lane). Remote Vault never touched or read.
**Passes:** happy-path (8 user stories) → adversarial break-it (30 attacks)

---

## Automated gates

| Gate | Result |
|---|---|
| `npx vitest run` | 45 files / **597 tests** passed |
| `npm run build` | clean (`tsc -noEmit -skipLibCheck` + esbuild production) |
| `./scripts/verify.sh` | **exit 0**, `=== verify.sh OK ===` |

`verify.sh` was broken on `master` before this branch and had to be repaired to run at
all — see *Harness repair* below. Unit tests alone are not the evidence bar here; the
CLI output below is.

```
atoms, daily-notes enabled · v0.6.52 installed and reloaded via CLI
Executed: atoms:list-unprocessed-captures
=> {"stable":true,"titles":151,"tags":13,"vocab":13}
ground-truth OK
=> {"live":true,"today":"2026-07-29","dailyFiles":36,"pastDaysWithUnprocessed":20,
    "totalUnprocessed":29,"todayUnmarkedCount":1,"plugin":true}
```

---

## Core user stories

All eight run live through `obsidian command` / `obsidian eval`. All **PASS**.

| # | Story | Evidence |
|---|---|---|
| 1 | Baseline recorded | `Atoms System/Inbox.md` 40 lines, 11 filed markers, 1 inferred-date marker |
| 2 | **A capture with an unreadable stamp is healed, not stranded** | `- 7/28/26, 12:00 PM buy milk` after a `2026-07-26` anchor → `Daily/2026-07-26.md` gains `- buy milk`. No time prefix, junk stamp stripped, date inherited from the anchor and **not** from today. Inbox line carries `<!--atoms:inferred-date:2026-07-26-->` + `<!--atoms:filed-->` |
| 3 | **Re-draining never duplicates** | 2nd drain: `buy milk` bullets still 1, filed count unchanged. Deleting only the filed marker and re-draining **re-marks** rather than re-filing — still 1 bullet |
| 4 | **Body is sacred** | `- 12/25/26 10:00 dentist appointment` reaches the daily byte-identical; nothing stripped |
| 5 | Content-free lines are not work | A bare stamp and a lone `- ` produce no daily bullet and no "waiting to file" count; `Daily/2026-07-27.md` byte-identical across the drain |
| 6 | **Home names the repair, not the button** | Rendered: `Inbox / 3 filed without times · 1 held for a future day / Your capture shortcut is sending a timestamp Atoms can't read… / Set Format String on the Format Date action — not on the Current Date variable. / Open capture settings · Dismiss`. No `is-repair` token anywhere in `src/` or `styles.css`. Singular verified separately |
| 7 | Dismiss clears the whole signal | One click → `Inbox / 1 held for a future day`. Cause, fix and action row gone; held fragment survives; no reload. Persisted across detach + reopen |
| 8 | Spacing measured, not eyeballed | Icon row bottom 106 → title top 114 (`margin-top: 8px`). Inbox card bottom 883 → next card top 899 (`margin-bottom: 16px`), matching the neighbouring cards |

**Clamp check (extra):** a `2099-06-01` anchor followed by a junk-stamped capture → the
junk capture inherited 2099, was clamped, and landed in today's daily. Confirms the fix
for the review defect where the marker-restored path skipped the clamp.

### Screenshots
`docs/qa/screenshots/inbox-stuck-card-home-spacing/` — `01-home-before-dismiss.png`,
`02-inbox-card-and-card-below.png`, `04-home-after-dismiss.png`.

---

## Edge cases & adversarial testing

30 attacks. **27 held.** Everything most likely to break under a real sync — the drain
mutex, the mid-drain re-read window, marker deletion / duplication / mispositioning, the
date clamp, the version-keyed ack — survived direct attack.

**Held up:** deleting either marker or both · duplicated and conflicting markers ·
markers at column 0 · an orphan marker with no bullet · far-future stamps · stampless
captures first / last / alone in the file · empty inbox · CRLF · missing EOF newline ·
column-0 orphan continuations · marker text appearing *inline* in a body · unicode /
emoji / CJK / RTL · **four concurrent drains joining one pass** · a Shortcut append
landing mid-drain · a mid-drain reflow shifting every line index · ack version re-arming.

### Fixed during this pass

| Found | Fix |
|---|---|
| A corrupt inferred-date marker (`2026-02-30`) created and filed into a literal `Daily/Invalid date.md` — the marker regex is shape-only and `isRealCalendarDate` was never called on it | Validate the recorded date; fall through to fresh neighbour inheritance on failure |
| A bare `-` line was absorbed into the preceding capture, producing a `- -` bullet | Degenerate bullet lines are no longer absorbed |
| Sync-conflict markers (`<<<<<<<` / `=======` / `>>>>>>>`) were absorbed into a capture body and written to the daily. The inbox is the file most likely in the vault to receive a conflict, since several devices append to it | Conflict-marker shapes are no longer absorbed |
| The cause line read "so **these** took the date…" next to a `1 filed without a time` count | Singular variant |
| The card's `Update Capture Atom` button sat 16px above the standalone shortcut-update banner firing the same action | The card defers to the banner when the banner is showing |

### Found and deferred, with reasons

| Finding | Why not here |
|---|---|
| [#204](https://github.com/taihartman/obsidian-atoms/issues/204) — a capture whose *continuation line* is exactly `<!--atoms:filed-->` reads as already-filed and strands with **zero** signal | **Pre-existing on `master`**, not introduced here. It is an in-band sentinel collision the parser cannot resolve; the fix is a design change |
| [#205](https://github.com/taihartman/obsidian-atoms/issues/205) — a stampless capture can duplicate across two dailies | Introduced here, but requires **both** markers lost *and* a new stamped capture inserted above changing its anchor. The common single-marker-loss case is correctly mitigated by the surviving inferred-date marker. Closing it needs a cross-daily dedupe scan |
| [#202](https://github.com/taihartman/obsidian-atoms/issues/202) — marker order inverts on the re-mark path | Cosmetic; both region scans skip past either marker kind, so counts and idempotency are unaffected |
| [#203](https://github.com/taihartman/obsidian-atoms/issues/203) — content-free lines are never marked at all | New sentinel; a product decision, not a defect |
| Duplicated template prose after a capture is absorbed into its body | Indistinguishable from a genuine continuation. No mechanical fix |
| Stamped captures write seconds (`- 09:14:03 …`) | Pre-existing, outside this change |

### Not exercised — stated rather than assumed

- Daily Notes plugin disabled (read in source only: `DailyNotesDisabledError` falls into `stillPending`, so the capture survives)
- A genuinely CRLF *daily note* receiving LF bullets
- Draining while the inbox is open in an editor with unsaved changes

---

## Harness repair (separate from the feature)

`scripts/verify.sh` was failing on `master` for two stale reasons, both unrelated to this
work and both making the mandated agent evidence gate unrunnable:

1. It asserted `atoms:log-context-prefix`, which is gated behind `ATOMS_DEV_COMMANDS` and
   therefore absent from the **production** build the script itself installs three lines
   earlier. The `obsidian eval` immediately below already checks the same thing.
2. It imported `./src/parse.ts`, which moved to `src/pipeline/parse.ts` in the
   architecture-seam split, dying with `MODULE_NOT_FOUND`.

Both repaired in `34ac61e`. `git diff master -- scripts/verify.sh` was empty before that
commit, confirming the breakage predates this branch.

---

## Verdict

**Merge-ready.** One merge-blocking bug was found by the adversarial pass and fixed
(`Daily/Invalid date.md`); the two remaining bugs are filed with reasons, one of which is
pre-existing.

**Before anyone installs 0.6.52**, see the upgrade hazard in the PR body — the first drain
after upgrade files everything currently stuck in the inbox, irreversibly.
