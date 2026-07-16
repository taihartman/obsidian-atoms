# Collaboration — two humans, many agents

How Tai and cousin ship without colliding or drifting the product.

**Audience: coding agents.** Humans may never open this file. Every agent session is required to follow it anyway (see root [`AGENTS.md`](../AGENTS.md) + stop banner in [`CLAUDE.md`](../CLAUDE.md)). Live claims: [`STATUS.md`](../STATUS.md).

## Roles

| Role | Who | Does |
|---|---|---|
| **Human owner** | Either of you | Creates/claims Issues, approves product direction, merges PRs |
| **Implementer** | Human + coding agents | Plans, codes, verifies on claimed work only |
| **Staff PM (AI)** | Any agent session in PM mode | Reads constitution + board + open PRs; challenges drift; does **not** invent product alone |

Neither human is permanent boss. The **constitution** is boss.

## Constitution (product truth)

| Layer | Location | Change rule |
|---|---|---|
| Non-negotiables + product sentence | `CLAUDE.md` | PR only; both humans review when possible |
| North star + system shape | `docs/architecture.md` | PR only |
| Spec rationale | `docs/spec-amendments.md` | PR only |
| Feature plans | `docs/plans/*` | Committed plan before non-trivial code |

**Constitution changes are never silent agent edits mid-feature.** Open a PR that only (or primarily) changes the constitution, explain *why*, get a human review.

## Hard claim (before any implementation)

No implementation until all three exist:

1. **GitHub Issue** — problem/goal, acceptance hints, links to plan if any  
2. **Assignee** — human owner (you or cousin)  
3. **`STATUS.md` row** — owner, branch, plan path, hot files, state  
4. **Draft PR** — branch pushed, PR opened (empty OK) so work is visible  

If your hot files overlap an **In progress** row → **stop**. Re-scope, wait, or talk to the other owner. Do not “just be careful.”

### Claim states (`STATUS.md`)

| State | Meaning |
|---|---|
| `Queued` | Issue exists; not started |
| `In progress` | Claimed; branch + draft PR live |
| `Blocked` | Waiting on decision, review, or dependency |
| `In review` | Implementation done; shipping tail / PR review |
| `Done` | Merged; remove from In flight (optional: keep one release line) |

## Day-to-day loop

```
1. Pull master; read CLAUDE.md + STATUS.md + open Issues/PRs
2. Pick or create Issue; assign yourself
3. Branch from master: feat/<short-name> or fix/<short-name>
4. Add/update STATUS.md row + open draft PR
5. Non-trivial work → write/update plan under docs/plans/ (then light doc-review)
6. Implement only the claimed scope; keep STATUS.md hot-files honest
7. Shipping tail (CLAUDE.md): simplify → code-review → compound → world-class-qa
8. Ready for review → state In review; request the other human when product-facing
9. Merge via GitHub; delete branch; clear STATUS.md row
```

### Isolation defaults

- **One claim per human** as default (second claim only if first is Blocked).  
- **Feature branches + PRs** — no direct commits to `master` for product work.  
- **Worktrees** for parallel agent sessions: sibling path `../obsidian_plugin-<branch>/` (never nested).  
- Prefer **small PRs** over multi-day mega-branches.

### `master` branch protection (GitHub)

Enforced on `taihartman/obsidian-atoms` (includes admins):

- **PR required** to merge into `master` (no direct push)  
- **0** required approving reviews — GitHub does **not** block self-merge  
- Force-push and branch delete on `master` disabled  
- Stale reviews dismissed when new commits land  

Agents: never force-push `master`; never commit straight to `master`.

### Cross-agent review (process, not GitHub-enforced)

GitHub cannot require “the other human’s agent” as a reviewer — only user accounts. We use a **soft** second-pass instead:

1. **Author agent** finishes shipping tail (`ce-code-review`, QA, etc.) on the draft/ready PR.  
2. **Other collaborator’s agent** (when available) reviews the PR: constitution drift, claim scope, hot-file overlap, and code risk. Leave PR comments; no formal GitHub approval required.  
3. **Human owner** merges when satisfied (either human may merge; prefer the non-author for product-facing changes when practical).

If the other person is offline, author may merge after their own shipping tail — do not block forever on a second agent. Optional later: require 1 GitHub approval if you want a hard gate.

## AI staff PM checklist

At session start (or when asked to “PM” / prioritize / unstick):

1. Read `CLAUDE.md` non-negotiables + product sentence  
2. Read `docs/architecture.md` north star (and relevant sections)  
3. Read `STATUS.md` and list open draft/ready PRs  
4. Report: in flight, conflicts, drift risks, recommended next Issue  
5. If a request violates constitution → refuse scope and propose a constitution PR or a smaller compliant plan  
6. Never start coding on unclaimed work  

## Product drift rules

- Agents implement **committed plans** that cite constitution docs — not chat vibes.  
- “Sounds cool” is not a ticket. File an Issue first.  
- Disagreement on direction → two short plan options in a PR → pressure-test against architecture → humans pick.  
- Out-of-scope capture UIs, folder intelligence, rewriting bodies, task-app gravity → reject unless constitution PR lands first.

## Cross-platform stance

Desktop, iOS, and **Android** are first-class *consumers* of the vault + plugin. Capture method may differ by OS; atoms, markers, and home must not assume one platform. Platform-only work needs an explicit “desktop-only for now” (or similar) note in the plan.

## Conflict playbook

| Situation | Action |
|---|---|
| Same files claimed twice | Later claim yields; update Issue |
| Two plans contradict | Stop code; architecture + humans decide |
| Agent invents scope mid-PR | Strip scope or open new Issue; don’t smuggle |
| Merge conflict on master | Rebase/merge master into feature branch; fix; re-verify |
| Emergency hotfix | Issue + STATUS still; keep PR tiny; note supersedes if needed |

## What “done” means

Same as `CLAUDE.md` shipping tail: not “tests green + committed.”  
Claim is Done only after merge (and STATUS cleared).

## Shared agent skills (world-class-qa, etc.)

Shipping tail skills (`world-class-qa`, `adversarial-qa`, reviews, …) live in the private repo **`taihartman/claude-skills`**, not in this plugin repo.

| Piece | Where | Who updates |
|---|---|---|
| **Method** (how to QA/review) | `claude-skills` → `skills/world-class-qa/`, etc. | Tai (or either, via PR on that repo) |
| **Project adapter** (how to run Atoms QA) | this repo → `docs/qa/` | whoever claims Atoms work |

### One-time setup (cousin)

1. Get **collaborator access** on `https://github.com/taihartman/claude-skills` (private).  
2. Clone + install (symlinks into Claude/Codex/agents skill dirs):

```bash
git clone https://github.com/taihartman/claude-skills.git ~/StudioProjects/claude-skills
cd ~/StudioProjects/claude-skills && ./install.sh
```

3. Confirm: agent can load skill `world-class-qa`.

### Staying current when Tai updates skills

Symlinks point at the clone. **Pull = latest skills** — no reinstall:

```bash
cd ~/StudioProjects/claude-skills && git pull
```

Optional habit: first agent command of a session can run that pull, or a weekly `git pull`.

### What not to do

- Do **not** copy-paste `SKILL.md` into the Atoms repo (forks go stale).  
- Do **not** expect GitHub alone to ship skills — agents load from the local skill install.  
- Project QA reports stay in **this** repo under `docs/qa/`.
