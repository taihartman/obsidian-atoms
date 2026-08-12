---
title: "A session write is not a settings redraw"
date: 2026-08-12
category: logic-errors
module: plus-settings
problem_type: logic_error
component: authentication
symptoms:
  - "After a magic-link sign-in, Settings → Account still shows Send sign-in link"
  - "Tapping Back is the first time the screen looks signed in"
  - "A Notice already said Signed in to Atoms Plus as …"
root_cause: missing_workflow_step
resolution_type: code_fix
severity: high
tags:
  - plus
  - magic-link
  - settings
  - session
  - redisplay
---

# A session write is not a settings redraw

## Problem

Signing in with an existing Plus account wrote the device-local session and toasted success. The open Account destination kept the signed-out form until the user tapped Back.

## Symptoms

- Account still offered **Send sign-in link** / **Start free trial** / **Save session** after a confirmed magic-link.
- Back to the main list showed **Plus · N filings left** — the first `display()` after the write.
- Paste-session and Start trial already looked signed-in, because those buttons live on the tab and call `redisplay()` themselves.

## What Didn't Work

- Blaming `resolveFilingAuth()`. It re-reads `readPlusSession` on every call (`src/plugin/main.ts`). The derivation was current. The DOM was not.
- Seeding a signed-in tab in the suite. That proves the signed-in render, not the transition from an already-painted signed-out Account.
- Completing the emailed `obsidian://atoms-signin` tap from an agent session by reading `plus.sqlite`. The token store is a credential. Do not open it for QA.

## Solution

`plugin.installPlusSession` is the host the protocol-handler uses. After the write, notify the open tab the same way Sync already does:

```ts
await installPlusSession(/* host */, session);
this.settingTab?.refreshFromExternalSettings();
```

Closed Settings is `settingTab === null`. The `hiding` latch still drops a redraw of a tab the user already left.

Pending as of this writing: the same notify is not on the post-checkout resume poller. That is a sibling hole, not this fix.

## Why This Works

The Plus session lives in device-local storage. The Account screen is a snapshot taken at `display()`. A writer that is not a Settings button never reaches `redisplay()` unless something tells the tab. Back worked because `openRoute("main")` calls `display()`.

Paste and trial already knew this. Magic-link did not, because it enters through the protocol handler.

[#323](https://github.com/taihartman/obsidian-atoms/issues/323) built `refreshFromExternalSettings` for a consent file that changed underneath the tab. A session that landed from another surface is the same shape.

## Prevention

- Any new session writer that is not a Settings `onClick` must call `settingTab?.refreshFromExternalSettings()` (or go through `plugin.installPlusSession`). Bare `writePlusSession` is already forbidden for identity changes — see [session-install-must-disarm-on-identity-change](../security/session-install-must-disarm-on-identity-change.md).
- A regression must start on the signed-out Account destination, install, and assert **Sign out** without a Back tap. `test/plusSignInAccountRefresh.test.ts` is that test. Two separately constructed tabs (signed-out vs signed-in) will not catch this again.
- Live QA: read `plugin.settingTab.containerEl`, not `document`. After a wait, `app.setting.modalEl.ownerDocument` can be the main window. Traps live in `docs/qa/learnings.md`; driving notes in `docs/qa/app-navigation-map.md` (Settings → Atoms).

## Related Issues

- [#473](https://github.com/taihartman/obsidian-atoms/issues/473) — this bug.
- [#240](https://github.com/taihartman/obsidian-atoms/issues/240) — magic-link handoff (paste and trial already redrew; the protocol path did not).
- [#323](https://github.com/taihartman/obsidian-atoms/issues/323) — `refreshFromExternalSettings` for a file that changed under an open tab.
- [#393](https://github.com/taihartman/obsidian-atoms/issues/393) — `installPlusSession` as the one identity-aware write.
- [A signal nobody receives is not a signal](../architecture-patterns/a-signal-nobody-receives-is-not-a-signal.md) — same class on the billing side: a write with no listener.
