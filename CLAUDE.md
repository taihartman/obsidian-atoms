# CLAUDE.md — Obsidian Atoms

Project rules for any coding agent (Grok, Claude Code, Cursor, Codex, etc.). Deeper docs win when they conflict with this file only if they are the **implementation plan** or **spec amendments**.

> **STOP — multiplayer repo.** Before any implementation: read [`docs/collab.md`](docs/collab.md) + [`STATUS.md`](STATUS.md). Hard claim required (assigned Issue + STATUS row + draft PR). Humans may not remind you; compliance is on the agent. Entry point for all tools: [`AGENTS.md`](AGENTS.md).

## Product in one sentence

Turn **past** daily captures into a trusted second brain: classify → flat atoms (declarative title, reason-bearing links, **verbatim** body) + sentinels → **Atoms home** library → gentle **resurface** (stream, not guilt queue). Capture UI is **out of scope** (external capture; iOS Shortcut today, Android-capable later). Desktop, iOS, and Android are first-class vault/plugin consumers.

## Authority (read before coding)

| Doc | Role |
|---|---|
| `docs/collab.md` + `STATUS.md` | Multiplayer + agent process; **hard claim before code** |
| `docs/architecture.md` | Long-lived system map + north star (constitution) |
| Active plan under `docs/plans/` | Implementation authority for the claimed feature |
| `docs/plans/2026-07-15-001-feat-obsidian-atoms-plugin-plan.md` | Historical core pipeline (U1–U10); not the live roadmap |
| `docs/spec-amendments.md` | Corrected design + *why* (markers, append cut, rot) |
| `docs/u1-spike-findings.md` | Spike-verified API/SecretStorage notes |
| `docs/solutions/` | Documented solutions to past problems (bugs, patterns, workflows), by category with YAML frontmatter (`module`, `tags`, `problem_type`) — relevant when implementing or debugging in those areas |
| `CONCEPTS.md` | Shared domain vocabulary (entities, named processes, status concepts) — relevant when orienting or discussing domain terms |

Where an **active feature plan** and amendments conflict, **that plan wins**. Amendments explain rationale for plan KTDs.  
**Constitution** (`CLAUDE.md` non-negotiables + `architecture.md` north star) changes **only via PR** — never silent mid-feature edits.

## Non-negotiables (bugs if violated)

1. **Body is sacred** — capture text lands in the atom **verbatim** (whitespace / obvious typo only). Model output surface = title, tags, links only.
2. **Never move files or choose folders** — atoms land flat in one configured folder (default `Atoms/`).
3. **Default: do not process today's daily.** Pipeline excludes today so mid-day capture stays quiet. Explicit user force (Preview/Process today) is allowed; never rewrite existing daily lines — only *create* atom files and *append* markers.
4. **Sentinel is the processed marker** for **all three** verdicts:
   - atom: `↳ [[title]] <!--linker-->`
   - task/noise: `<!--linker:task-->` / `<!--linker:noise-->`
   - Wikilinks *inside* capture text are **not** markers.
5. **API key in SecretStorage** (or device-local fallback) — never `data.json`.
6. **Nothing destroyed** — idempotent, re-runnable; bad classifications are never lossy.
7. **Untrusted classify/write paths need dry-run evidence** before relying on them. Gated **auto-run** may write without a per-run human dry-run once privacy + device gates pass.
8. **Write experiments against throwaway vault** (`test_vault/`) until the path is trusted. Read-only / explicit user-OK checks on a real vault are fine; never point unattended automation at a personal vault.
9. **Second brain, not a task app** — no due-date/checklist gravity; `task` verdict is soft-retired.
10. **No platform-only product** without an explicit plan note (desktop/iOS/Android consumers).

## Versioning

- Bump **`manifest.json`** + **`package.json`** (+ `versions.json`) on any user-visible change so desktop/phone builds are identifiable.
- Show version in **Settings → Atoms**.
- After install, user checks Settings for `Version x.y.z` (phone Sync lag is obvious if stale).

## Stack + tests

- Stack: sample-plugin template, TypeScript + esbuild, `obsidian-daily-notes-interface`, `isDesktopOnly: false`, network via `requestUrl` (not `fetch` — CORS).
- **Test-first** on correctness cores: `parseCaptures`, `render`, and other pure logic touched by the claim.
- Historical core pipeline units: U1–U10 in the 2026-07-15 plan (done/superseded for roadmap purposes).

## Commands

```bash
npm install
npm run dev          # watch main.js
npm run build        # typecheck + production bundle
npm run spike:api    # offline classify+cache (needs ANTHROPIC_API_KEY env)
```

## Dev vault + Obsidian CLI (preferred)

Full detail: `docs/dev-obsidian-cli.md`. Prefer CLI over Local REST API MCP for agent automation.

### Verified setup (2026-07-15)

| Item | Value |
|---|---|
| Obsidian | **1.12.7** installer (Homebrew cask) |
| CLI binary | `/opt/homebrew/bin/obsidian` (or `/usr/local/bin/obsidian`) |
| CLI toggle | Settings → **General → Advanced → Command line interface** ON |
| Throwaway vault | `test_vault/test vault/` (gitignored) |
| **Personal / phone vault** | `~/Documents/Remote Vault` (Obsidian Sync → phone) |
| Plugin id | `atoms` |
| Anthropic key | SecretStorage (settings store secret **name** only; never `data.json`) |

Without the Advanced toggle, `obsidian` prints “Command line interface is not enabled” even if the binary exists.

**Phone / Sync (two lanes):**

| Lane | When | Action |
|---|---|---|
| **Phone dogfood** | After anything lands on **`master`** that you want on device (default: always for user-visible plugin code) | Agent or human runs `npm run phone` on a machine with Remote Vault |
| **Release / market** | Intentional ship only (“release it” / Community list) | Tag + GitHub Release assets — **not** every master merge |

Merging to GitHub alone does **not** update the phone. Plugin files must land in **Remote Vault**’s `.obsidian/plugins/atoms/`, then Sync.

```bash
npm run phone   # build + install → $HOME/Documents/Remote Vault
# same as: ./scripts/install-to-vault.sh "$HOME/Documents/Remote Vault"
```

Then wait for Sync; fully **quit & reopen** Obsidian on phone; confirm **Settings → Atoms → Version x.y.z**. Stale version = Sync lag or wrong vault path.

**Agent rule:** After a PR merges to `master` (or you update local `master` with plugin code), **run `npm run phone` before ending the session** unless the change is docs-only or the user says skip. Do **not** cut a GitHub Release unless asked.

### Everyday loop

```bash
# From repo root — Obsidian must be open on the target vault
./scripts/install-to-vault.sh   # build + copy main.js + plugin:reload (test vault only)
npm run phone                   # phone / Remote Vault (after master)
./scripts/spike-via-cli.sh      # U1 spikes via CLI
```

### Handy CLI (cwd = vault or `vault="test vault"` first)

```bash
cd "test_vault/test vault"

obsidian version
obsidian plugins:enabled
obsidian plugin:reload id=atoms

obsidian commands filter=atoms
obsidian command id=atoms:spike-secret-storage-probe
obsidian command id=atoms:spike-classify-hardcoded
obsidian command id=atoms:spike-cache-and-batch-fork
obsidian command id=atoms:list-unprocessed-captures   # U3 read-only
obsidian command id=atoms:dry-run-preview             # U7 — no vault writes
obsidian command id=atoms:process-unprocessed         # U8 — live API write
obsidian command id=atoms:process-fixture-sample      # U8 — fixture write (no API)
obsidian command id=atoms:auto-run-status             # U9 — device-local gates
obsidian command id=atoms:auto-run-now                # U9 — try (respects gates)
obsidian command id=atoms:test-connection             # HTTPS + Anthropic probe (no secrets)
obsidian command id=atoms:backfill-estimate-confirm   # U10 — estimate gate (batch only after confirm)

# Safe key presence check (no raw key in output)
obsidian eval 'code=(()=>{const p=app.plugins.plugins["atoms"];const k=p?.getApiKey?.();return JSON.stringify({hasKey:!!k,keyLen:k?.length??0,model:p?.settings?.model})})()'
```

```bash
npm test                 # vitest (parse tests)
npm run seed:vault       # ~20 Daily/ fixtures in test vault
./scripts/verify.sh      # tests + seed + install + CLI live checks (agents: run this)
```

**Agents must verify with CLI**, not only unit tests: after each unit that touches the plugin, run `./scripts/verify.sh` (or the relevant `obsidian command` / `obsidian eval`) while Obsidian is open on the throwaway vault, and report the CLI output as evidence.

Spike results land in **Notices** + DevTools console (`[atoms] …`). CLI cannot scrape the renderer console; `fetch` from `eval` hits CORS — plugin code must use `requestUrl`.

### Optional MCP

Local REST API MCP is optional (`docs/dev-obsidian-mcp.md`). Never point automation at a real personal vault for write experiments.

## Log safety

Never log request headers/bodies, full error objects, or raw API keys. Redact keys to fingerprints. Gate capture-content console dumps behind dev-only paths.

## Architecture seams (do not collapse)

Hybrid layout — see `docs/architecture.md` module map. Paths:

- `pipeline/parse.ts` — capture extent + marker detection (KTD1)
- `pipeline/context.ts` — `ContextProvider` seam (all-titles v1; shortlist later)
- `pipeline/classify.ts` — request build, cache breakpoint, schema, invariants, retry
- `pipeline/render.ts` — atom file + markers; collision policy KTD8
- `pipeline/preview.ts` — dry-run only
- `pipeline/write.ts` — write path
- `pipeline/backfill.ts` — Batch API + cost gate
- `pipeline/enrich/*` — post-classify repair (people, media, links, idea rescue)
- `plugin/main.ts` — thin shell (lifecycle + wire); not a dumping ground for product logic

Intelligence lives in **links + titles**, not folders.

## Workflow

**Lanes (pick one first):** **[docs/workflow-lanes.md](docs/workflow-lanes.md)** — full · light · amend · debug · mechanical. Ambiguity → heavier lane. Agents state `Lane` / `Why` / `Doc-review` on non-trivial work before planning or coding.

**Multiplayer:** follow [`docs/collab.md`](docs/collab.md). Hard claim = GitHub Issue (assigned) + [`STATUS.md`](STATUS.md) row + draft PR **before** implementation. Session start: read constitution → `STATUS.md` → open PRs → only then plan/code.

Default: plan → implement claim → verify. Full ce-* loop for net-new / high-risk work. Light plan + light doc-review for small clear features. Amend for tiny post-ship tweaks. `ce-debug` for broken behavior.

**Plan quality gate:** After writing or **materially updating** a plan in `docs/plans/` (product bar, KTDs, units, parity/scope flips), run at least a **light `ce-doc-review`** (`mode:headless` coherence + feasibility; add design/product lenses when UI or product claims move) **before** `ce-work` / implementation. Do not implement from an unreviewed plan rewrite mid-session. Full multi-persona doc-review for large or high-risk plans. See lane card for sizing.

### Mandatory shipping tail (do not skip)

After **implementation** on any non-trivial change (feature or fix), **always** finish the loop before calling the work done or opening a PR:

1. **`ce-simplify-code`** — tighten the freshly written code (reuse, clarity, efficiency) without changing behavior  
2. **`ce-code-review`** — multi-agent review of the branch/diff; fix P0/P1  
3. **`ce-compound`** — write the durable learning to `docs/solutions/` (and CONCEPTS if needed) so the next session inherits *why*  
4. **`world-class-qa`** — pre-merge product QA (project adapter: `docs/qa/`). Proves changed behavior with evidence; not unit tests alone. Ends with **`adversarial-qa`** (break-it pass) per that skill’s hard gate.  
5. **PR** — body must include **`Closes #<issue>`** (auto-close the hard-claim Issue; “Issue #N” alone is not enough) + distilled **Core user stories** + **Edge cases & testing** (link full report under `docs/qa/YYYY-MM-DD-*-world-class-qa.md`)
6. **PR evidence (non-negotiable):** mark every **Test plan** checkbox only after it ran; for **UI / product-facing** changes, attach **screenshots** (or a short clip) of the live vault smoke — commit under `docs/qa/screenshots/<branch-or-feature>/` and link them in the PR body Evidence table. Capture via `obsidian vault="test vault" dev:screenshot path=…` after `./scripts/install-to-vault.sh`. Docs-only / pure logic: write `N/A — no UI` instead of fake images. Leaving the template boxes unchecked after “done” is a shipping-tail bug.
7. **After merge to `master` (plugin code):** run **`npm run phone`** so Remote Vault → phone Sync gets the build ASAP. Not a GitHub Release (release only when asked).

**Done means:** simplify + code-review + compound + world-class-qa (incl. adversarial half) ran, or an explicit, recorded skip for pure mechanical churn (renames, version-only bumps with no logic, docs-only); PR Test plan boxes match real evidence; UI PRs include vault screenshots in the body.  
**Not done:** “tests green + committed” alone, or a PR whose Test plan is still all `- [ ]` after the agent claimed verify.  
**QA not merge-ready:** checklist handoff or BLOCKED when Obsidian/phone/CLI prereqs missing — state gaps in the report; do not label code-read as world-class QA.  
LFG / `ce-work` / agent sessions must not stop at implement — the shipping tail is part of the work, not optional polish.  
**Master landed:** plugin bits on phone via `npm run phone` (or recorded skip: docs-only / no Remote Vault on this machine).

## Out of scope (unless constitution/plan explicitly opens it)

Capture UI (any OS) · AI folder placement · `append` into user notes · always-on 3am headless · embeddings · competing with task managers/calendars.

**Partially shipped — extend only via plans:** Atoms home, resurfacing stream, people hubs, belief rehearsal, auto-run/automatic filing.
