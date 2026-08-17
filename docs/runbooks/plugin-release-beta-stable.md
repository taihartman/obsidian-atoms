# Runbook: plugin release — stable vs beta

Agent-facing. Humans install via BRAT or Community plugins; agents never copy builds into personal/Remote Vault.

**CI:** `.github/workflows/release.yml`  
**Install prose:** `README.md` § Install  
**Constitution:** `CLAUDE.md` § Desktop + mobile

## Channels

| Channel | Version / tag (must match package + manifest) | GitHub Release | Who gets it | Where the version lives |
|---|---|---|---|---|
| **Stable** | `0.6.77` (semver only) | **not** prerelease | BRAT default · Community directory (when listed) · manual “Latest” | `master` `package.json` + `manifest.json` |
| **Beta** | `0.6.78-beta.1` or `0.6.78-rc.1` | **prerelease** (CI sets this) | BRAT only if **Enable betas** is on | **Feature branch only.** Tag that commit. Never merge the `-beta` bump to `master`. |

Tag string **must equal** `package.json` `version` and `manifest.json` `version` or the release job fails.

**Why betas stay off master:** Community reads default-branch `manifest.json` and looks for a matching non-prerelease GitHub Release. A `-beta.N` on `master` is a published prerelease; Latest stays on the last stable; the directory delists the plugin (“No release matches your manifest version”). That happened on 2026-08-17 with `0.8.3-beta.2`. CI refuses the merge (`scripts/community-manifest-version.mjs` on the required `test` check).

## Auto-release (default)

**Every master commit whose `package.json` + `manifest.json` version has no GitHub Release yet gets one automatically** (`.github/workflows/release.yml` on `push` to `master`). That version must be a plain `X.Y.Z`. CI builds assets, creates tag `X.Y.Z`, and publishes a stable Release. A `-beta` / `-rc` on master fails the job instead of publishing.

Why: Obsidian Community reads **default-branch** `manifest.json` and requires a Release tagged with that exact version. Bumping without a matching Release delists the plugin (“No release matches your manifest version”).

| Merge to master | What CI does |
|---|---|
| Version bumped (new `X.Y.Z`) | Build + Release `X.Y.Z` (stable) |
| Version is `X.Y.Z-beta.N` / `-rc.N` | **Fail.** Do not merge. Tag the beta from the feature branch, then land the PR at the last stable or the next plain `X.Y.Z`. |
| Version unchanged (docs/www/already-released) | Skip — Release already exists |

Agents do **not** hand-tag after a normal version-bump merge. Watch: `gh run list --workflow=release.yml --limit 1`.

## Manual tag (still works)

Use only to re-cut, recover a missed auto-run, or release a non-master commit.

```bash
git fetch origin master
git checkout master && git pull origin master
node -p "require('./package.json').version"   # must equal manifest
node -p "require('./manifest.json').version"
git tag X.Y.Z && git push origin X.Y.Z
# Watch: gh run list --workflow=release.yml --limit 1
# Confirm: gh release view X.Y.Z --json isPrerelease,url
```

**Stable:** version is plain `X.Y.Z` on `master` → `isPrerelease=false`.  
**Beta:** on the **feature branch**, bump package+manifest+versions to `X.Y.Z-beta.N` (or `-rc.N`), then `git tag X.Y.Z-beta.N && git push origin X.Y.Z-beta.N`. Do not merge that bump. Before the PR to `master`, set the three files back to the last stable or to the next plain `X.Y.Z`.

Tell humans: BRAT → **Check for updates** (betas **off** for stable; **Enable betas** for dogfood). Settings → Atoms → Version should match the tag.

## After release

1. Clear `STATUS.md` claim row (PR if master is protected).
2. Do **not** install into personal/Remote Vault.
3. Optional: note version in PR/issue comment with release URL.
4. Community directory listing is a **separate** human/ops step (obsidian-releases) — not automatic from this tag.

## Common failures

| Failure | Fix |
|---|---|
| “No release matches your manifest version” | Default-branch manifest is a `-beta`/`-rc` or a stable that has no Release yet. Revert master to the last stable, or bump to a plain `X.Y.Z` and let CI cut that Release. Never “fix” it by landing another beta. |
| Tag ≠ package/manifest | Delete remote tag if needed; retag after fixing version files |
| Wanted beta but cut `0.6.x` | That is stable; cut a new `-beta.N` if dogfood-only |
| Wanted stable but used `-beta` | BRAT default users won’t see it; cut clean `X.Y.Z` for prod |
| Laptop-built `main.js` uploaded by hand | Don’t — CI owns assets |
| Master merge did not release | `gh run list --workflow=release.yml`; if skipped, version already had a Release; if failed, fix and re-run or manual tag |

## Human BRAT checklist (copy into chat)

**Stable phones/desktop:** betas off → Check for updates → confirm Version.  
**Beta dogfood:** Enable betas → Check for updates → confirm Version includes `-beta` / matches tag.
