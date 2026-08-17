---
title: "A -beta version on master delists the Community plugin"
date: 2026-08-17
category: workflow-issues
module: release
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - "Bumping package.json / manifest.json on a PR to master"
  - "Cutting a plugin release or choosing stable vs beta"
  - "Community listing says no release matches the manifest"
tags:
  - release
  - community-plugins
  - versioning
  - ci
---

# A -beta version on master delists the Community plugin

## Context

On 2026-08-17, #543 merged a user-visible fix with `package.json` and `manifest.json` at `0.8.3-beta.2`. CI did what the runbook asked: it published a GitHub Release tagged `0.8.3-beta.2` and marked it prerelease. Latest stable stayed `0.8.2`. Obsidian Community reads default-branch `manifest.json` and looks for a matching **non-prerelease** Release. Those two did not match, so the directory showed:

> No release matches your manifest version

#550 promoted the same tree to `0.8.3` and restored the listing. The next feature PR that rides a `-beta.N` bump onto master will do it again unless the merge itself refuses.

## Guidance

`master`'s `manifest.json` is the Community listing. It must be a plain `X.Y.Z` that a stable GitHub Release already has, or will have the moment CI finishes the auto-release.

Betas are a **tag on the feature branch**, not a version that lands on master:

1. Bump to `X.Y.Z-beta.N` on the branch.
2. `git tag X.Y.Z-beta.N && git push origin X.Y.Z-beta.N` — `release.yml` on tag push cuts the prerelease for BRAT **Enable betas**.
3. Before merging, set package / manifest / `versions.json` back to the last stable, or forward to the next plain `X.Y.Z` if this PR *is* the community release.

CI enforces (3). `scripts/community-manifest-version.mjs` fails a PR to master whose version is not `^[0-9]+\.[0-9]+\.[0-9]+$`. The required `test` job runs it, so admins cannot click past. `release.yml` fails a master push that somehow still carries a `-beta` / `-rc` rather than publishing another prerelease.

Do not "fix" a delist by landing another beta. Revert master to the last stable, or cut the next plain `X.Y.Z`.

## Why the old runbook was wrong

The runbook treated master as both the community source of truth *and* the BRAT beta channel. Those cannot share a `manifest.json`. Community reads the default branch; GitHub's Latest ignores prereleases. Putting a `-beta` on master satisfies BRAT Enable-betas and breaks the directory at the same time. The two channels have to live in different places: stable on master, beta on a tagged commit that is not the default-branch tip.

## Evidence

- `0.8.3-beta.2` Release existed, `isPrerelease=true`, Latest = `0.8.2`, master manifest = `0.8.3-beta.2`.
- Community error is the exact string in the runbook's failure table.
- Gate: `scripts/community-manifest-version.mjs`, required check step in `.github/workflows/plus-service-tests.yml`.
