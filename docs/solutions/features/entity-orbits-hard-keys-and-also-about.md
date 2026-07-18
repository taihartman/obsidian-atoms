---
module: pipeline, home, resurface
tags: [entity-orbits, links, soft-keys, also-about, packing]
problem_type: feature
date: 2026-07-17
---

# Entity orbits: hard keys + Also about (not a packing app)

## Problem

Sporadic captures (packing items, project crumbs) file as separate atoms. Soft links like `Camping` look like structure but are not trip-specific. Users cannot see the multi-night set on phone.

## Solution

1. **Piggyback classify** with `enrichEntityLinks` — exact vault title match only (no contains-resolve).
2. **Shared soft denylist** (`softKeys.ts`) for orbits and connected resurface.
3. **Derived orbit index** from **link-prose** wikilinks (not capture body).
4. **Pull UI:** library opens in-home; **Also about {T} · N** when ≥3 members on a real hub title.

## Why not

- Second model pass (Plus cost under auto-run)
- Home Together push card first (noise; pull is safer)
- Append/checkboxes (body sacred / task gravity)

## Key files

- `src/pipeline/softKeys.ts`
- `src/pipeline/enrich/entityLinks.ts`
- `src/pipeline/entityOrbitIndex.ts` / `entityOrbitPolicy.ts`
- `src/home/atomsHomeView.ts`

## Real-user QA lesson (2026-07-18)

Do **not** seed hub notes or pre-linked atoms to “prove” Also about.
Dogfood path: user capture bullets → Process / force Process today → observe.

Observed without a pre-existing packing hub:
1. Some packing logistics → **noise** (not atom).
2. Keepable list dumps → **atoms**, may link to each other when the model sees a chain.
3. **Also about** stays silent until ≥3 generated atoms hard-link the **same existing vault hub title**.

Seeding `Yosemite packing.md` + link-prose atoms invents a product experience users do not have on day one.
