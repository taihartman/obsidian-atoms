# World-Class QA: hub-association-invite

## Verdict

**Ready after fixes** — two live holes found and patched in-session. Live Process (classify silent landing) is **Not tested** (test vault has no API key and no Plus session).

## Charter

Prove the Home invite for an existing handwritten Show list: notice Psycho-Pass, accept writes the marked block, checkboxes stay. Adjacent risk: packing/gift atoms dumping onto that list; wait card hiding the invite.

**Product loop vs fixture:** handwritten Show list (user-like prior note) + generated atoms written as Process would (`generated-by: linker`). No live classify. Accept and Not now ran on the live plugin.

**Authority:** `docs/plans/2026-08-17-1540-feat-hub-association-invite-plan.md` R1–R12, AE1–AE7.

## Preflight

- Product dogfood honesty ✅
- Authority paths ✅ plan
- Learnings ✅ read; ➕ three rows this pass
- Navigation map 🔧 added Hub association invite
- Dev/run ✅ `./scripts/install-to-vault.sh` on test vault
- Viewport N/A desktop CLI
- Auth N/A for this surface
- Fixtures: no catalog fixture for headingless Show list; created in-session
- Vault lock ✅ held
- Deploy N/A plugin local

Installed **0.8.7** to `test_vault/test vault`. Fingerprint: bundle contains `Add to ${t}?`. Live `manifest.version` 0.8.7.

## Authority & promises

| Surface / CTA | Promise | Acceptance | Story |
|---|---|---|---|
| Add to Show list? | R3, AE1 | Card names the existing note | US-notice |
| Add to Show list (accept) | R6, R8, R12 | Marked block `- [[atom]]`; handwritten `- [ ]` unchanged | US-accept |
| Not now | R4, AE5 | No write, no hard link | US-dismiss |
| Later atom | R9 | Lands without ask after hub accepted | US-silent (Not tested — no Process) |

## Product loop vs fixture

| Story | Kind |
|---|---|
| US-notice / US-accept / US-dismiss | fixture-plumbing for the atom file; live plugin collect + accept |
| US-silent | Not tested |
| Wait-card hide | live observation |

## User stories

**US-notice.** As someone who already keeps Show list, I want Home to offer **Add to Show list?** for a new anime capture.
Acceptance: invite label Show list, members = that atom only.
Authority: R3, R5.
Evidence: live eval after fix — `titles: ["Want to watch anime Psycho-Pass"]`. First collect (pre-fix) piled 13 atoms including packing. **Passed after fix.**

**US-accept.** Accept writes the marked block and keeps checkboxes.
Acceptance: AE1.
Evidence: Show list after accept:

```
- [ ] High school of the dead
- [ ] Gurren Lagann

<!-- atoms:generated v=1 -->
## Unsorted
- [[Want to watch anime Psycho-Pass]]
<!-- /atoms:generated -->
```

Atom gained `belongs with [[Show list]].` **Passed.**

**US-dismiss.** Not now on Cowboy Bebop leaves Show list as above and does not hard-link Cowboy. **Passed.**

**US-silent.** Second show lands via Process with no card. **Not tested** — `hasKey:false`, no Plus. Home would invite an unlinked second show (Cowboy) once accept snooze was removed.

**US-wait.** Invite is collected while 36 unprocessed keep the wait card in the hero. Card text only appeared after `unprocessedCount = 0` for a chrome shot. **Failed as UX** (residual): backlog hides the invite.

**US-card-copy.** Live innerText: `Lists` / `Add to Show list?` / `Add this memory to Show list. Your writing on that note stays yours.` Screenshot: `docs/qa/screenshots/hub-association-invite/home-add-to-show-list.png` (forced wait-card aside; labeled UI-chrome).

## Risk matrix

| Risk | Result |
|---|---|
| Happy accept | Passed live |
| Greedy lone Show list | Failed live, fixed, unit tests added |
| Accept snooze blocks next show | Failed live, fixed |
| Not now | Passed |
| Wait card hides invite | Failed, residual |
| Process silent landing | Not tested |
| Person still outranks | Unit only |

## Findings

1. **P1 fixed.** Lone Show list absorbed every list-shaped atom. `pickListNamedHub` now needs a show/movie family cue or an exact title mention.
2. **P1 fixed.** Accept wrote `list:show list` into the 14-day snooze map, so Cowboy Bebop never invited. Snooze is Not now only.
3. **P2 residual.** `unprocessedCount > 0` hides the invite hero. A vault with a backlog never sees the card. Not fixed this pass.

## Adversarial

- Greedy matcher: proven live (13 members), fixed.
- Accept-then-second-atom: proven live (snooze), fixed.
- Not now: no write.
- Did not try lists-off accept, pick-different-note modal, or live Process.

## Not tested

- Live Process / classify linking after the hub exists (no key).
- Pick a different note modal.
- Lists-off hard-link without block.
- Phone / Remote Vault.
- Adversarial-qa skill as a separate dispatch (compact live break-it only).

## Learnings

Consulted `docs/qa/learnings.md`. Appended three hub-invite rows.

## Merge decision

Ship the matcher + snooze fixes. Do not call merge-ready until live Process is walked or explicitly deferred, and until the wait-card hide is accepted or fixed.

## Evidence commands

- `npx vitest run test/hubInvite.test.ts` — 20 passed after the matcher tests
- `./scripts/install-to-vault.sh` — 0.8.7 on test vault
- Live eval accept / dismiss as above
