# Workflow lanes — pick one, run its gates

**Audience: coding agents** (humans can skim).  
**When:** start of any non-mechanical task. Say the lane out loud before planning or coding.

Ambiguity → pick the **heavier** lane. Do not shop for the lightest story that fits.

---

## Forced pick (first reply on non-trivial work)

```
Lane:  full | light | amend | debug | mechanical
Why:   <one sentence>
Doc-review: full | light | n/a
Done when: <evidence>
```

---

## The four lanes (+ mechanical)

| Lane | When | Minimum loop | Doc-review |
|---|---|---|---|
| **Full feature** | Net-new capability; product-bar flip; multi-file / multi-surface; model/auth/write integrity; “how should this work?” still open | `ce-brainstorm` *(if WHAT unclear)* → `ce-plan` → **doc-review** → `ce-work` → simplify → code-review → compound → world-class-qa | **Full** multi-persona (or light then full if first pass is messy) |
| **Light feature** | WHAT is clear; small surface (rule of thumb: ≤~2 real logic files); no model-cardinality / security / auth widening; no new primary user story | Short plan in `docs/plans/` (or deepen existing) → **light doc-review** → scoped work → tests → shipping tail as needed → compound if learned | **Light** headless (coherence + feasibility; + design/product if UI/product copy moves) |
| **Amend** | Tweak to a feature **already shipped** through a full loop | 3 bullets: understanding · approach · blast radius **or** `ce-debug` if it’s a bug → scoped work → **one** regression test → **scoped** QA → compound optional | n/a unless the amend rewrites a plan |
| **Debug** | Broken behavior vs existing contract; stack; failed test | `ce-debug` → fix → simplify → code-review → compound (**why** it broke) | n/a |
| **Mechanical** | Rename, version-only bump with no logic, pure docs typo | Direct edit + verify if needed | n/a |

Shipping tail detail: [CLAUDE.md](../CLAUDE.md) (simplify → code-review → compound → world-class-qa).  
Multiplayer claim before implement: [collab.md](./collab.md) + [STATUS.md](../STATUS.md).

---

## Doc-review sizing

| Change | Gate |
|---|---|
| New big plan; product bar; KTDs; multi-unit; vault write integrity | **Full** `ce-doc-review` |
| Material plan update mid-feature (e.g. local polish → AI parity) | **At least light**; prefer full if UI + API + integrity all move |
| Tiny plan tweak (one open-question default, copy) | Light or skip if truly one sentence |
| Amend / debug / mechanical | n/a |

**Floor:** material plan write/update → light doc-review **before** `ce-work`.  
Do not implement from an unreviewed mid-session plan rewrite.

---

## Auto-escalate (amend / light → full)

Escalate immediately if work:

- Touches **security / auth / API keys / secret storage**  
- Widens **model surface** or classification contract in a user-visible way  
- Adds a **new primary user story** or home/Process behavior  
- Grows past ~2 logic files or “just one more unit”  
- Needs a **product choice** humans haven’t settled  

**Amend laundering is a bug:** calling a product flip “just a quality tweak” to skip plan + doc-review is out of bounds.

---

## Anti-patterns

| Don’t | Do |
|---|---|
| Debate lane for 20 minutes | Heavier lane wins |
| Full CE theater (skills named, no plan/review/evidence) | Honest light pass with artifacts |
| `ce-debug` for “users want a new capability” | Full or light **feature** lane |
| Implement then “doc-review later” | Gate before code |
| One mega-session for full loop | Hand off at plan→work or work→review (cache/cost) |

---

## Examples (this product)

| Work | Lane |
|---|---|
| Update notes = Process parity (AI refresh, stamps, home, rename/markers) | **Full** |
| Stamp `atoms-quality` on new writes only, no refresh UI | **Light** |
| Change Update strip copy after ship | **Amend** |
| Marker double-appended / wrong sentinel | **Debug** |
| Black screen in a design-handoff HTML mock | **Mechanical** |
| Reprocess all noise markers into atoms | **Full** |

---

## Related

- [CLAUDE.md](../CLAUDE.md) — non-negotiables, shipping tail, plan quality floor  
- [AGENTS.md](../AGENTS.md) — session start + claim  
- [collab.md](./collab.md) — multiplayer  
- Compound Engineering `ce-*` skills — execute the named steps in each lane  
