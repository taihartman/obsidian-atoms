---
module: pipeline/home
tags: [person-hub, invite, second-brain, graph]
problem_type: feature
date: 2026-07-23
---

# Person hub invite: Add {Name}? not silent create

## Problem

Without a person note, classify dumps identity to soft `[[People]]`. Users will not hand-author hubs before every capture. Silent auto-create pollutes Sync and invents false people.

## Solution

1. High-confidence name resolve + invite candidates (`personInvite.ts`)
2. Calm Atoms home card **Add {Name}?** (outranks packing Make)
3. Human accept creates minimal note under Social/People family
4. `applyHardLinkToAtomContent` upgrades plugin link-prose only (body sacred)
5. Atom titles excluded from orbit keys so peers never fake Also about

## Do not

- Silent create on Process/auto-run
- Treat places (CRG) or media recommenders as people
- Plant hubs in QA to force green graph screenshots

## Related

- Plan: `docs/plans/2026-07-23-001-feat-person-hub-invite-plan.md`
- Issue #60 / PR #110
- Follow-ups: #108 markers, #109 Aploma project invite
