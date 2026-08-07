# Runbook: plugin release — stable vs beta

Agent-facing. Humans install via BRAT or Community plugins; agents never copy builds into personal/Remote Vault.

**CI:** `.github/workflows/release.yml`  
**Install prose:** `README.md` § Install  
**Constitution:** `CLAUDE.md` § Desktop + mobile

## Channels

| Channel | Version / tag (must match package + manifest) | GitHub Release | Who gets it |
|---|---|---|---|
| **Stable** | `0.6.77` (semver only) | **not** prerelease | BRAT default · Community directory (when listed) · manual “Latest” |
| **Beta** | `0.6.78-beta.1` or `0.6.78-rc.1` | **prerelease** (CI sets this) | BRAT only if **Enable betas** is on |

Tag string **must equal** `package.json` `version` and `manifest.json` `version` or the release job fails.

## Auto-release (default)

**Every master commit whose `package.json` + `manifest.json` version has no GitHub Release yet gets one automatically** (`.github/workflows/release.yml` on `push` to `master`). CI builds assets, creates tag `X.Y.Z` (or `X.Y.Z-beta.N`), and publishes the Release. Stable vs prerelease still follows the version suffix.

Why: Obsidian Community reads **default-branch** `manifest.json` and requires a Release tagged with that exact version. Bumping without a matching Release delists the plugin (“No release matches your manifest version”).

| Merge to master | What CI does |
|---|---|
| Version bumped (new `X.Y.Z`) | Build + Release `X.Y.Z` (stable) |
| Version bumped to `X.Y.Z-beta.N` | Build + **prerelease** `X.Y.Z-beta.N` |
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

**Stable:** version is plain `X.Y.Z` → `isPrerelease=false`.  
**Beta:** bump package+manifest+versions to `X.Y.Z-beta.N` (or `-rc.N`) before merge/tag → `isPrerelease=true`.

Tell humans: BRAT → **Check for updates** (betas **off** for stable; **Enable betas** for dogfood). Settings → Atoms → Version should match the tag.

## After release

1. Clear `STATUS.md` claim row (PR if master is protected).
2. Do **not** install into personal/Remote Vault.
3. Optional: note version in PR/issue comment with release URL.
4. Community directory listing is a **separate** human/ops step (obsidian-releases) — not automatic from this tag.

## Common failures

| Failure | Fix |
|---|---|
| “No release matches your manifest version” | Default-branch manifest ahead of Latest Release — tag that version (or merge this workflow and re-push) |
| Tag ≠ package/manifest | Delete remote tag if needed; retag after fixing version files |
| Wanted beta but cut `0.6.x` | That is stable; cut a new `-beta.N` if dogfood-only |
| Wanted stable but used `-beta` | BRAT default users won’t see it; cut clean `X.Y.Z` for prod |
| Laptop-built `main.js` uploaded by hand | Don’t — CI owns assets |
| Master merge did not release | `gh run list --workflow=release.yml`; if skipped, version already had a Release; if failed, fix and re-run or manual tag |

## Human BRAT checklist (copy into chat)

**Stable phones/desktop:** betas off → Check for updates → confirm Version.  
**Beta dogfood:** Enable betas → Check for updates → confirm Version includes `-beta` / matches tag.
