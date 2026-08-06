---
artifact_contract: "ce-handoff/v1"
created_at: "2026-08-05T15:23:33Z"
title: "#240 — doc-review folded in, desktop probe done, planning unblocked"
summary: "The magic-link plan has been reviewed and corrected and its blocking platform question is answered by probe; nothing is claimed yet and no implementation has started."
keywords: ["plus", "magic-link", "240", "obsidian-uri", "doc-review", "probe-done", "planning-unblocked"]
cwd: "/Users/a515138832/StudioProjects/obsidian_plugin-240-magic-link"
resume_focus: "Merge master, hard-claim #240, then run ce-plan on the requirements plan"
repository: "taihartman/obsidian-atoms"
repo_root_sha: "3d86cfc2a74e2da69f3d4784751b3dbf211b9493"
branch: "feat/240-magic-link-handoff"
head: "fb4a36496b7d0476d46f08ffb0856844837b0226"
worktree_path: "/Users/a515138832/StudioProjects/obsidian_plugin-240-magic-link"
---

# #240 — doc-review folded in, desktop probe done, planning unblocked

The requirements plan has been through a doc-review and a platform probe. It is corrected, its
blocking question is answered, and **no code has been written and nothing is claimed.**

## Where everything is

| Item | Path / ref |
|---|---|
| Worktree | `/Users/a515138832/StudioProjects/obsidian_plugin-240-magic-link` (proper sibling) |
| Branch | `feat/240-magic-link-handoff`, pushed, tracking origin, HEAD `fb4a364` |
| The plan | `docs/plans/2026-08-05-240-feat-magic-link-plugin-handoff-plan.md` |
| Issue | [#240](https://github.com/taihartman/obsidian-atoms/issues/240) — **still unassigned, no STATUS row, no draft PR** |
| Prior handoff | `docs/handoffs/2026-08-05-240-doc-review-handoff.md` (its "next step" is now done) |

Two commits landed this session, both pushed:

- `8870961` — folded the doc-review findings into the plan
- `fb4a364` — recorded the desktop probe results and reframed what it settled

## State of the work

**Complete.** The doc-review (light: coherence, feasibility, security-lens, product-lens) and the
desktop probe. Both are committed; there is nothing half-applied in the working tree.

**Not started.** The hard claim, `ce-plan`, and all implementation.

### What the doc-review changed

20 findings; 12 proposed fixes plus one decision were applied. The plan gained four requirements —
R12 device-held verifier binding the exchange, R13 the requesting vault being closed, R14 the
landing page's post-handoff state, R15 the stale Settings copy — and four corrections, of which the
substantive one is **R9**: the plan had claimed the store backends disagree on expired-token
behavior. They do not. All three delete the token unconditionally including on the expired path; the
real defect is that nothing can check a token without consuming it. R9 now says that instead.

All 15 requirements trace to a flow or acceptance example. That was verified mechanically after the
edits, not assumed.

### What the probe settled

A throwaway `registerObsidianProtocolHandler` spike was installed in the `test vault`, `demo-vault`,
and `new vault` lanes on Obsidian 1.12.7, exercised, then reverted. Personal vaults untouched. Full
results are in the plan's **Probe results** section; the load-bearing ones:

- **Desktop Obsidian takes the deep link**, including from a real Chrome tab. This resolved the P0
  contradiction in feasibility's favour: F2 and AE4 were mislabelling desktop as a dead end, and no
  desktop-only user is stranded by deleting the paste field. Both were reframed.
- `vault=` routes a custom action to a *named* vault even when another vault is frontmost
  (control-tested). A registered-but-closed vault is opened by the link.
- `app.saveLocalStorage` is vault-scoped, so R3's premise holds.

Two results that sharpen requirements rather than adding new ones: a vault whose plugin lacks the
action **swallows the link with no signal at all** (R13's case, and invisible to the landing page
too, because the OS did accept the URI); and detection works only via `document.hasFocus()` —
`visibilityState` stays `visible`, so the obvious `visibilitychange` implementation reports failure
on the success path (R14).

## Traps worth not rediscovering

- **The branch is 6 commits behind master, and its `STATUS.md` still carries a stale `#280` row.**
  Master's in-flight table is empty. Merge master *before* adding a STATUS row, or the stale row
  comes back with the claim.
- **`app.saveLocalStorage` is vault-scoped; raw `window.localStorage` is not.** The spike used the
  raw API and its state appeared shared across vaults, which briefly looked like a threat to R3. It
  is not — but an implementation that reaches for `window.localStorage` would leak state across
  vaults for real.
- **The test vault lives in the main repo**, at `obsidian_plugin/test_vault/test vault`, not in this
  worktree. `install-to-vault.sh` writes to the worktree copy while the Obsidian CLI drives whichever
  vault Obsidian actually has open. Confirm the live version via `obsidian eval` before trusting any
  vault evidence.
- **Chrome's `execute_javascript` automation is blocked on this machine** (it needs "Allow JavaScript
  from Apple Events"). The probe worked around it by having the page encode its verdict in
  `document.title` and reading that back via tab listing.
- **Port 8791 is another session's landing-page server.** Check a port is free before binding; the
  probe used 8795.
- `.compound-engineering/config.local.yaml` (`cross_model_peer: grok`) was created in this worktree
  this session. It is gitignored, so it exists on this machine only.
- The grok cross-model peer was **not** run — the previous session's attempt returned unusable
  output and the one-strike rule applied. Nothing in the doc-review has different-model corroboration.

## The remaining release gate is human-only

Everything the probe verified is **macOS desktop only**. Whether `obsidian://` fires from a mail
client's in-app browser on iOS or Android is untested and is the release gate — it needs a physical
device and a BRAT install, which agents do not do. One smaller unknown: this Mac may already have
granted Chrome permission for `obsidian://`, so a fresh browser profile may show a one-time
"Open Obsidian?" prompt that the probe could not observe.

Success Criteria in the plan now requires both iOS and Android through an in-app browser.

## Also open, unclaimed

- [#241](https://github.com/taihartman/obsidian-atoms/issues/241) post-checkout polling window — must land on top of #281's atomic announce
- [#284](https://github.com/taihartman/obsidian-atoms/issues/284) sign-out teardown · [#285](https://github.com/taihartman/obsidian-atoms/issues/285) cloud-copy wipe re-upload · [#286](https://github.com/taihartman/obsidian-atoms/issues/286) typable claim code (depends on #240) · [#242](https://github.com/taihartman/obsidian-atoms/issues/242) obsidian typings pin

One residual the doc-review raised and this session did not act on: moving consumption off the page
load widens the magic token's live window, and the plan does not record that as an accepted
consequence in Scope Boundaries.

## Plausible next step

Merge master, make the hard claim on #240 (assign, STATUS row, draft PR), then run `ce-plan` on
`docs/plans/2026-08-05-240-feat-magic-link-plugin-handoff-plan.md` to take it from requirements-only
to implementation-ready. The project's plan quality gate is already satisfied — the plan has had its
doc-review.
