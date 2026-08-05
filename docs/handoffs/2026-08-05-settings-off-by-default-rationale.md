# Why each off-by-default setting is off

Investigated 2026-08-04. Reasons below are **stated in the repo** (doc, comment, plan, or commit) unless marked inference.

| key | label | what ON does | stated reason | class |
|---|---|---|---|---|
| `useDeviceLocalKeyFallback` | Device-local key fallback (`settings.ts:761`) | Non-synced localStorage slot for the raw Anthropic key | `types.ts:152-155` KTD5 contingency, key never in data.json; `docs/security/pre-community-publish-review.md:169-179` "not OS keychain… acceptable as contingency", fix direction = hide behind Advanced; CLAUDE.md non-negotiable 5 | **hard gate** |
| `enableReconsiderCapture` | Reconsider capture (`:959`) | Registers `reconsider-capture`: reclassify a noise/task marker at the cursor, Apply creates the atom | `types.ts:167-171` "Off by default **until dogfood-ready**"; plan `2026-07-22-001` KTD1 rejected always-on, why: "Dogfood gate"; commit `61ef332`; setDesc still says "Experimental" | **incidental** |
| `enableHubProjection` | Hub projection (`:973`) | Regenerates an `atoms:generated` block on person hub notes | `types.ts:173-176` "Off by default; discloses vault write"; plan `2026-07-28-001` KTD9 (no privacy ack needed — local write, not egress); `architecture.md:187` hard-stop list; `spec-amendments.md:330` narrow carve-out from never-append-into-user-notes | **hard gate** (write-safety, not privacy) |
| `askEnabled` | Enable Ask mirror (`:1152`) | Keeps a cloud copy of `Atoms/` current on Plus servers for MCP search | `types.ts:177-178` opt-in cloud mirror; plan `2026-07-27-001` R4 opt-in + privacy ack, `:102` "host **can decrypt** at rest in v1 — not zero-knowledge"; refused without ack at `askCoordinator.ts:110,138,212`; also Plus-tier gated | **hard gate** |
| `askPrivacyAckAt` | Privacy acknowledgment (`:1136`) | Unlocks the Ask mirror toggle | `types.ts:179-180` required before first Ask push; plan KTD19 6-clause checklist, "gate first upsert on ack timestamp"; disable ≠ wipe | **hard gate** |
| `askWriteAckAt` | Allow filing from Claude or ChatGPT (`:1178`) | Vault applies create/continue outbox items (new files only) | `types.ts:181-185` "separate from read mirror ack; empty = off"; gate `askCoordinator.ts:138-140` | **hard gate** |
| `atoms-auto-run-egress-ack` | Data egress acknowledgment (`:817`, device-local) | Unlocks Auto-run; permits unattended sends to Anthropic | `autorun.ts:6` one-time egress ack before first unattended send; `settings.ts:807-810` "Default off… unattended runs send titles + captures to Anthropic"; `architecture.md:187`; CLAUDE.md non-negotiable 7 | **hard gate** |
| `atoms-auto-run-enabled` | Auto-run on open (`:832`, device-local) | Once/day unattended processing of past dailies — paid API calls | `settings.ts:807-810` "Default off"; `autorun.ts:9` per-launch cap so a month away doesn't fire ~150 (H7); `shouldRunAutoProcess` false unless enabled **and** acked (`autorun.ts:33-34`) | **hard gate** (money + egress) |
| `atoms-egress-notice-v1` | no toggle — acknowledged from Atoms home | Unblocks paid resume/catch-up stages | `resume.ts:266` defaults false, gate `:186`; plan `2026-07-31-001:1689` "every unattended-or-newly-widened paid path is refused until acknowledged"; `:2189` "a widened trigger set spends before its disclosure is seen" | **hard gate** |
| `atoms-backlog-gate-v1` | no toggle — first-run banner | Clears the ≥50-stranded-capture banner | `resume.ts:23` threshold 50, gate `:194-195`. Not a user setting; listed for completeness | **caution** |

## Conclusions

1. **Only one genuine flip candidate: `enableReconsiderCapture`.** The sole stated reason is a July 2026 "dogfood gate"; `STATUS.md:61` still marks it "(flagged)" and no doc states graduation criteria. *Inference (not stated):* residual risk is one API call + one atom write per invocation, both user-initiated at the cursor, and the command is inert unless invoked.
2. **`enableHubProjection` cannot be flipped without a constitution PR** — it is enshrined default-off in `architecture.md:187` and framed as a narrow carve-out in `spec-amendments.md:330`. Write-safety, not privacy.
3. **Premise correction:** "Sync automatically on resume" (`atoms-resume-enabled-v1`, `settings.ts:854`) defaults **ON** — `readResumeEnabled` (`resume.ts:253-256`) returns true unless explicitly false; plan `:1572` says "default on". It is a kill switch, not an opt-in. `expandLinkedNotes` is also on by default.
4. **No `docs/solutions/` incident** underlies any of these defaults.

## Product consequence

There is no population of "recommended but arbitrarily off" settings. Every off-by-default setting except one is off because turning it on has a real cost the user must consent to: cloud egress, money, or a vault write. A "we recommend you turn these on" section would be misrepresenting a consent gate as a recommendation.
