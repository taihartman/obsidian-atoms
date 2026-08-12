# World-Class QA: set_loop conversational mark (#467 / #468)

Date: 2026-08-12  
Branch: `feat/467-set-loop` · commits `1d0cdd2` + `2bdbf5a`  
PR: [#468](https://github.com/taihartman/obsidian-atoms/pull/468) · Issue #467 · Version **0.7.6**

## Verdict

**Ready for merge of plumbing** — ship bar SC1–SC6 proven by automated tests + throwaway vault install.  

**Not Ready for “feature done” / Part 2 start on live dogfood** until Fly deploys plus-service and a human runs SC7 (Claude/ChatGPT conversation → `set_loop` → Obsidian apply → `fetch_atom`).

## Charter

- **Change:** MCP `set_loop` + outbox FM-only modify; fix create/continue apply dropping `open_loop` / `relation` / `close_answer`.
- **Workflows:** Agent marks existing mirrored atom loop state after user confirms; vault FM updates without body rewrite.
- **Risks:** Body corruption; silent marks; kind collapsed to create; R15 strip regression; live path needs service deploy.
- **Platforms:** Agent QA vault + unit/plus-service tests. No Home UI chrome. No phone.
- **Product loop vs fixture:** Fixture/plumbing for apply path; live MCP user-loop **Not tested** (Fly not deployed this pass).
- **Authority:** `docs/plans/2026-08-12-001-feat-set-loop-conversational-plan.md` (R1–R15, SC1–SC8).

## Preflight

| Check | Status |
|---|---|
| Product dogfood honesty | ✅ `docs/qa/README.md` |
| Authority paths | ✅ plan 2026-08-12-001 |
| Nav map | N/A — no new Home chrome |
| Dev/run | ✅ `npm test`, `npm run build`, `./scripts/install-to-vault.sh` |
| Viewport | N/A — MCP/outbox, not UI |
| Auth | N/A for unit; live MCP needs Plus + Ask + Allow filing |
| Fixtures | ✅ pure vault markdown in tests |
| Deploy reality | ⚠️ **plus-service must deploy to Fly** before live tools/list shows `set_loop` |

## Authority & promises

Paths read: plan Product Contract R1–R15, SC1–SC8; open loops R5b terminals.

| Surface | Promise | Acceptance | Story |
|---|---|---|---|
| `set_loop` tool | Ask-then-act mark, source user | Outbox pending → vault FM only | US1 |
| Body sacred | Never rewrite body | Body after FM identical pre/post | US2 |
| Terminals | not_a_loop / resolved_elsewhere / abandoned | open_now false, source user | US3 |
| R15 integrity | create open_loop + redeems fields land | apply receives full payload | US4 |
| Missing/hub | Fail closed | no vault write | US5 |
| Live conversation | SC7 dogfood | Claude mark lands without YAML | US6 **Not tested** |

## Product loop vs fixture

| Primary story | Proof kind | Notes |
|---|---|---|
| US1–US5 apply/plan/server | fixture-plumbing | hermetic tests |
| Plugin 0.7.6 on throwaway vault | ui-chrome-only / install | CLI eval version |
| US6 conversational mark | user-loop | **Blocked** — Fly + live host |

## User Stories

**US1** As a vault owner talking to Claude, I want an existing note marked active after I say yes, so I don’t edit YAML.  
Acceptance: set_loop enqueue → apply → FM `atoms-loop: active` + `source: user`.  
Evidence: `test/catchUp` set_loop patches FM; `mcp-ask-write` set_loop enqueue. **Passed** (plumbing).

**US2** Body stays verbatim.  
Acceptance: body after FM identical.  
Evidence: `planSetLoopApply marks active user and keeps body`; catchUp set_loop body split. **Passed**.

**US3** Terminals work without child.  
Acceptance: state enum validated; apply writes terminal.  
Evidence: validate set_loop; planSetLoopApply idempotent not_a_loop. **Passed**.

**US4** create_atom open_loop survives apply (R15).  
Acceptance: applyToVault receives open_loop; vault FM user source.  
Evidence: `forwards open_loop through to applyToVault`; `create open_loop flag reaches vault FM`. **Passed**.

**US5** Missing atom / missing state fail closed.  
Evidence: set_loop rejects missing; rejects missing state; invalid state validate. **Passed**.

**US6** Live conversation dogfood (SC7).  
**Not tested** — needs Fly deploy + Plus session. Blocker for “feature done,” not for plumbing merge.

## Risk Matrix

| Type | Scenario | Expected | Evidence | Result |
|---|---|---|---|---|
| Positive | set_loop active | FM user active | catchUp + askOutbox | Passed |
| Positive | create open_loop R15 | FM user active | catchUp | Passed |
| Negative | missing file | reject missing | catchUp | Passed |
| Negative | no state | invalid_payload | catchUp | Passed |
| Negative | invalid state | validate fail | mcp-ask-write | Passed |
| Edge | already matching FM | idempotent (no useless rewrite) | planSetLoop | Passed |
| Edge | modify throws | modify_failed reject | code + catchUp harden | Passed (code path) |
| Edge | store kind whitelist | pull kind set_loop not create | mcp-ask-write enqueue | Passed |
| Regression | create/continue still work | tests green | full npm test | Passed |
| Adversarial | double set_loop same state | idempotent | planSetLoop | Passed |
| Adversarial | redeemed + active still open_now false | openNow derivation | openLoop unit (prior) | Passed (unit) |
| Product | live Claude set_loop | lands in vault | — | **Not tested** |

## Adversarial ledger

| Scenario | Tag | Proof |
|---|---|---|
| Edit after mark (body hand-edit) | solid (by design) | apply only touches loop keys |
| Delete atom then set_loop | solid | reject missing |
| Double set_loop | solid | idempotent when match |
| set_loop without body | solid | accepted when state present |
| Enqueue kind collapsed to create | solid | fixed three stores; test asserts kind |
| Payload strip R15 | solid | forwards open_loop test |
| Live host silent-mark | blocked | instructions only; needs dogfood SC7 |
| Hub set_loop | solid (server) | target_is_hub in tool (not live-driven) |
| Outbox full / offline Obsidian | blocked | same as create/continue residual |

No new proven code holes this pass. Residual: live honesty of agent ask-then-act.

## Evidence

### Commands

```bash
npm test                                          # 1752 passed
npm run build                                     # green
npm run lint                                      # green
cd plus-service && node --test test/mcp-ask-write.test.mjs test/mcp-write-scope.test.mjs test/store-ask-outbox.test.mjs  # 36 pass
./scripts/install-to-vault.sh                     # Atoms v0.7.6 → test vault
obsidian eval '…manifest.version…'                # {"version":"0.7.6","hasPlugin":true}
```

### Screenshots

N/A — no UI chrome. Install proof is CLI JSON version.

### Devices

Desktop Obsidian on `test_vault/test vault` only.

## Findings

### Blocking (for feature-done / Part 2 live)

1. **Live MCP path unproven** — plus-service not deployed this session; Claude/ChatGPT cannot call `set_loop` on production until Fly ships the tool.

### Polish / residual

- http-dogfood env flakes (publicBase / filing count) pre-exist; unrelated to this PR.
- Agent ask-then-act is instruction-only (cannot enforce).

## Not Tested

- Human conversation SC7–SC8 on personal or Plus-connected vault  
- End-to-end: MCP enqueue → outbox pull → real vault.modify → mirror push → fetch open_now  
- ChatGPT connector  
- Multi-device Sync race on concurrent set_loop  

## Merge Decision

| Question | Answer |
|---|---|
| Merge plumbing PR #468? | **Yes** — ship bar automated + vault install 0.7.6 |
| Call feature done / start Part 2? | **No** — deploy Fly, dogfood SC7 first |
| world-class-qa Ready? | **Ready pending live MCP dogfood** (not full Ready) |

## PR body distill (for #468)

### Core user stories
1. Mark an existing atom’s loop state from the agent without YAML — ✅ plumbing (US1–US3); ⚠️ live SC7 pending Fly  
2. Body never rewritten on mark — ✅ tests  
3. create open_loop / redeems fields actually land — ✅ R15 regression tests  

### Edge cases & testing
- 1752 unit tests green; plus-service ask-write/outbox green; install 0.7.6 on throwaway vault  
- Full report: this file  
