# QA Playbook

This folder is the project-specific adapter for the shared `world-class-qa` and `adversarial-qa` skills. The global skills define the method; this folder defines how Atoms is launched, which fixtures are valid, where evidence lives, and which surfaces matter.

## Required Preflight

Before a QA pass, read:

1. `docs/qa/testing-fixtures.md` for deterministic data, live-data constraints, and cleanup rules.
2. `docs/qa/app-navigation-map.md` for surface and command anchors. When a drive path is wrong, heal the row in the same change (world-class-qa gate 31).
3. `docs/qa/learnings.md` for hard-won traps. Read before driving; append after a pass that taught something the next one would otherwise repeat.
4. The changed files, plan (if any), and adjacent tests for the feature under QA.
5. **Acceptance authority** for product/UI claims: active plan under `docs/plans/`, product contract / architecture rules it cites (e.g. entity orbits Open contract R14), and on-screen copy next to CTAs. `world-class-qa` stories must use those acceptances — not handler bodies. **Shipped surfaces stay in scope** even if a plan slice deferred that tier.

## Run Commands

| Layer | Command |
|---|---|
| Unit | `npm test` |
| Typecheck + bundle | `npm run build` |
| Seed throwaway vault | `npm run seed:vault` |
| Install plugin (agent QA) | `./scripts/install-to-vault.sh` → throwaway test vault |
| Seed demo dogfood | `node scripts/seed-demo-vault.mjs` then install into `docs/media/demo-vault` |
| Human desktop/phone install | **BRAT** → `taihartman/obsidian-atoms` after GitHub Release (CLAUDE.md) |
| Full agent verify | `./scripts/verify.sh` (Obsidian open + CLI on **test** vault) |
| Live CLI smoke | `obsidian command id=atoms:…` from **test/demo** vault cwd |

## Vault lock (one writer at a time)

There is **one** throwaway vault on this machine, it lives in the main checkout, and every session
drives it through the same running Obsidian. `install-to-vault.sh` replaces `main.js` in it, so two
sessions installing at once means one of them is screenshotting the other's build.

That is not hypothetical: on 2026-08-15 an install landed `0.8.0` at 09:19, a probe confirmed it at
09:21, and by 09:23 another worktree had overwritten it with `0.7.12`. Both builds named a
plausible version in `manifest.json`, so reading the version back does not catch it.

```bash
./scripts/qa-vault-lock.sh status                     # free / yours / who has it
./scripts/qa-vault-lock.sh acquire --note "QA #512"   # take it
./scripts/qa-vault-lock.sh acquire --wait 600         # queue behind a peer
./scripts/qa-vault-lock.sh release                    # give it back when your pass ends
```

**`install-to-vault.sh` takes the lock itself** when it is free and refuses with exit 3 when
another worktree holds it, naming that worktree and its branch. So an existing agent prompt that
just runs the install script is already covered; you only reach for the lock directly to hold the
vault across a longer pass, or to check who has it.

- The holder is a **worktree**, not a process, so a session's subagents share its claim.
- The lock file lives outside both the repo and the vault, keyed by the vault's real path.
- It goes stale after 45 minutes (`--ttl`), so an abandoned session cannot block the machine.
- `release --force` takes someone else's, and is for a session that is definitely gone.
- Reads are deliberately unguarded: `obsidian eval` resolves by vault name with no isolation, so a
  probe from another session is noise. The **write** is what corrupts a pass.
- `ATOMS_SKIP_VAULT_LOCK=1` is for a human alone with their own vault, not for passing a peer.

## Vault lanes

| Who | Vault | Purpose |
|---|---|---|
| **Agent dogfood / QA** | `test_vault/test vault/`, `docs/media/demo-vault/` | Process, Update notes, fixtures, screenshots — **all write experiments** |
| **Phone / personal product** | Remote Vault or any live vault | Human live data; plugin via **BRAT** / Release — agents do not install or rewrite |
| **Never by default** | Remote Vault atoms/dailies | Unattended Update / fixture rewrite / bulk classify |

## Product dogfood honesty (mandatory)

**Bug this kills:** agent plants hubs + perfect atoms, screenshots a green feature, claims “product works” — users never get that setup.

| Kind of proof | Allowed | Not allowed as product proof |
|---|---|---|
| **Real product loop** | Append **capture bullets** only → Process / force Process today → observe | Pre-create hub notes, hand-write atom link-prose, plant ≥3 linked atoms just to light Also about / hubs / etc. |
| **Plumbing / unit** | `npm test`, `seed:vault`, `seed:demo`, fixture Process, pure index fixtures | Calling that “day-one dogfood” in the PR verdict |
| **UI chrome only** | After a real loop (or explicit “UI-only with labeled fixture”) | Unlabeled seeded screenshots as merge evidence for product magic |

**Default dogfood steps (agents):**

1. Install plugin to throwaway vault.  
2. Write captures the way a user would (`- pack …` on past dailies; force today if needed).  
3. Run **Process** / **Process include today** — not hand-authored atoms.  
4. Report what actually happened (including noise, silence, missing Also about).  
5. If a feature needs an existing hub to shine, say so — do not invent the hub to fake the aha unless the product itself creates it.

**Scripts:** `npm run seed:vault` / `seed:demo` remain valid for parse/process plumbing and README chrome. They are **not** a substitute for step 2–4 when claiming a product surface works.

## Viewports / Devices

| Surface | Target |
|---|---|
| **Primary (phone product)** | Obsidian mobile (iOS) on **Remote Vault** via Sync — install id `atoms`, check Settings version |
| **Agent automation / dogfood** | Desktop Obsidian **1.12.x** + CLI on `test_vault/` or **demo-vault** (not Remote Vault notes) |
| Home UI | Mobile-first `atoms-home` leaf (~phone width); desktop left sidebar leaf OK for smoke |

Visual fidelity mocks (when UI change): `docs/design-handoff/atoms-view/`.

## Evidence Paths

- QA reports: `docs/qa/YYYY-MM-DD-<branch>-world-class-qa.md`
- Screenshots: attached to the PR via `gh pr create --attach` (not committed). `docs/qa/screenshots/<branch-or-feature>/<frame>.png` is for **baselines** only — references a later session must re-locate.
- CLI transcript: paste into report Evidence section (no secrets / no raw API keys)

### PR body evidence (required)

For any PR that changes **user-visible UI** (Atoms home, For you, cards, pair-open, library chrome, settings product copy):

1. Install to the throwaway vault (`./scripts/install-to-vault.sh`).
2. Drive the happy path (CLI `atoms:open-home` + clicks via `obsidian eval`, or human).
3. Capture frames with `obsidian vault="test vault" dev:screenshot path=docs/qa/screenshots/<feature>/0N-name.png`.
4. **Attach** the PNGs to the PR — don't commit them:

   ```bash
   gh pr create --attach '01-home.png#Home after Process' \
                --attach '02-inbox.png#Inbox drained'
   ```

   Repeatable (50 files max per command), needs `gh` ≥ 2.99.0, and works the same on `gh pr edit` and `gh pr comment`. Uploads go to GitHub's asset CDN, so review evidence stays out of git history and the link survives branch deletion.

   To put a frame in the Evidence table rather than appended at the end, reference it relatively in the body — `![Home after Process](./01-home.png)` — and gh rewrites that reference to the uploaded asset. Alt text already in the body wins over the `#` suffix; video renders as a player and takes no alt text.

   If some uploads fail, the PR is **still created** with the ones that succeeded and the URL is still printed, but `gh` exits non-zero. Check stdout for the URL before retrying, or you'll open a duplicate.

   Only **baselines** (a golden frame a later session must re-locate) get committed under `docs/qa/screenshots/<feature>/`, linked with an **absolute** URL pinned to `master` or a sha — never a feature branch, and never a repo-relative `![…](docs/…)` path, which renders as a broken image icon:

   `![label](https://raw.githubusercontent.com/<owner>/<repo>/master/docs/qa/screenshots/<feature>/01-….png)`

5. **Check** the matching Test plan boxes — never leave `- [ ]` after claiming the step ran.

Pure logic / docs-only PRs: write `N/A — no UI` in Evidence. Skipping screenshots on a UI PR is a process failure, not optional polish.

## Auth Reality

- Anthropic API key: **SecretStorage** (or device-local fallback). Never commit keys.
- Auto-run flags: **device-local** (`loadLocalStorage`) — phone ≠ desktop.
- Live classify needs a key on the device under test. Dry-run / fixture commands avoid spend when possible.

## Merge gate (project)

Non-trivial PRs must run **`world-class-qa`** (and its required **`adversarial-qa`** half) or record a **Blocked / checklist handoff** with named gaps. Unit tests alone are not QA.
