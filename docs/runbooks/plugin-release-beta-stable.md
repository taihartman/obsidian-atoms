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

## When to cut which

| User says (approx.) | Channel |
|---|---|
| “release it” / “ship for BRAT” / “prod” | **Stable** |
| “beta” / “dogfood only” / “pre-release” | **Beta** |
| Merge only, no release language | **No tag** — master lands; no GitHub Release |

Never cut a Release unless the user asked (or LFG shipping explicitly includes release).

## Stable recipe

Preconditions: feature merged to `master` (or tag the merge commit); version already bumped on that commit (or bump in a follow-up PR first).

```bash
git fetch origin master
git checkout master && git pull origin master   # or worktree on master
# Confirm version is X.Y.Z with no -beta/-rc suffix:
node -p "require('./package.json').version"
node -p "require('./manifest.json').version"
# Tag and push (tag name = version):
git tag X.Y.Z
git push origin X.Y.Z
# Watch: gh run list --workflow=release.yml --limit 1
# Confirm: gh release view X.Y.Z --json isPrerelease,url
# Expect isPrerelease=false
```

Tell humans: BRAT → **Check for updates** (betas **off**). Settings → Atoms → Version should show `X.Y.Z`.

## Beta recipe

```bash
# On a branch/PR (or master if intentional):
# 1. Bump package.json + manifest.json + versions.json to X.Y.Z-beta.N
#    (same string in all three places that carry version)
# 2. Merge to master if not already there
git fetch origin master && git checkout master && git pull
node -p "require('./package.json').version"   # must print X.Y.Z-beta.N
git tag X.Y.Z-beta.N
git push origin X.Y.Z-beta.N
# Expect isPrerelease=true on the GitHub Release
```

Tell dogfooders: BRAT → **Enable betas** → Check for updates.

## After release

1. Clear `STATUS.md` claim row (PR if master is protected).
2. Do **not** install into personal/Remote Vault.
3. Optional: note version in PR/issue comment with release URL.
4. Community directory listing is a **separate** human/ops step (obsidian-releases) — not automatic from this tag.

## Common failures

| Failure | Fix |
|---|---|
| Tag ≠ package/manifest | Delete remote tag if needed; retag after fixing version files |
| Wanted beta but cut `0.6.x` | That is stable; cut a new `-beta.N` if dogfood-only |
| Wanted stable but used `-beta` | BRAT default users won’t see it; cut clean `X.Y.Z` for prod |
| Laptop-built `main.js` uploaded by hand | Don’t — CI owns assets |

## Human BRAT checklist (copy into chat)

**Stable phones/desktop:** betas off → Check for updates → confirm Version.  
**Beta dogfood:** Enable betas → Check for updates → confirm Version includes `-beta` / matches tag.
