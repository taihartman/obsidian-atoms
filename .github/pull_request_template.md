<!-- Agents: keep Closes on its own line. GitHub only auto-closes with Closes/Fixes/Resolves #N.
     No CI enforces this — you must verify before mark-ready. Docs/chore with no Issue: delete the line or write N/A — no Issue. -->

Closes #

## Summary

-

## Test plan

<!-- Check boxes only after evidence exists (command output and/or screenshots). Never leave unchecked after claiming done. -->

- [ ] `npm test`
- [ ] `npm run typecheck` / `npm run build` (as applicable)
- [ ] Live smoke (CLI and/or vault) for the changed surface

## Evidence (required for UI / product-facing PRs)

<!-- For any change a human can see (home, For you, settings chrome, cards, copy): -->
<!-- 1. Capture screenshots (or short clip) of the happy path after install to the throwaway vault. -->
<!-- 2. Attach them with `gh pr create --attach 'shot.png#Alt text'` (gh >= 2.99.0). Do not commit them. -->
<!-- 3. Mark every Test plan box that you actually ran. -->
<!-- Pure logic / docs-only: write "N/A — no UI" and skip images. -->

| Flow | Result | Evidence |
|---|---|---|
| | Pass / Fail / N/A | attached screenshot, or link |

Screenshots:

<!-- Attach, don't commit. The flag is repeatable and also works on `gh pr edit` / `gh pr comment`:
     gh pr create --attach '01-home.png#Home after Process' --attach '02-inbox.png#Inbox drained'
     Uploads go to GitHub's asset CDN, so evidence stays out of git history.
     Reference a file relatively — ![Home after Process](./01-home.png) — and gh rewrites that
     reference to the uploaded asset, so it lands here instead of appended at the end.
     Baselines a later session must re-locate DO get committed under docs/qa/screenshots/ — link
     those with an absolute URL pinned to master or a sha (a repo-relative ![…](docs/…) path renders
     as a broken icon, and a feature-branch URL dies when the branch is deleted):
     ![label](https://raw.githubusercontent.com/<owner>/<repo>/master/docs/qa/screenshots/<feature>/01-….png) -->

## Plan / STATUS

- Plan:
- Claim Issue: #
