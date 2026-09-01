# MCP create/continue: per-field write rules

Lane: light  
Why: already-shipped Ask write path; the miss is instruction-scope bleed, not a new write surface.  
Doc-review: light (coherence + product; this is agent-facing copy, not plugin UI).  
Done when: a forwarded pickup text plus prior wedding context yields a faithful body and a `[[Christian]]` link with a date-match reason, unprompted.

Authority: this plan. Live tool text is `plus-service/src/mcp/tools.mjs` + `plus-service/src/mcp/instructions.mjs`. Plugin apply is `src/platform/askOutbox.ts` (Process-parity link prose; no `atom-links` FM).

---

## What broke

`create_atom`'s tool description is one sentence that applies to every field:

> Queue a new atom for the user's vault (outbox). Does NOT write instantly—status stays pending until Obsidian applies it. Prefer user-dictated body text; do not invent facts. Set open_loop when the note is an intention/IOU, not finished substance.

Field schemas today:

- `title`: "Declarative atom title"
- `body`: "Atom body / capture text"
- `tags`: no description
- `links[]`: `{ note, reason? }` with no field text
- `reason`: optional, undescribed

The anti-hallucination rule is right for the body and wrong for links. Models treat a tool-level "do not invent facts" as a blanket ban, so they stay literal on every argument. A missing link is invisible; a wrong link is one click to delete. Links should run at a much lower confidence threshold.

`ASK_MCP_INSTRUCTIONS` already scopes the rule to bodies ("Do not invent facts in atom bodies"). The tool description is the one that bleeds.

`continue_atom` takes the same `links[]` shape and currently has **no** per-field write rules at all — only parent/pending/hub constraints. The same split belongs there.

---

## Recommendation: no storage distinction

**Write inferred links as ordinary `[[links]]`. Put the distinction in `reason` prose, which already lands in the note.**

Do not add `inferred: true` on the edge. Do not add a review queue. Do not change how the vault stores or renders the link.

### Why this, given the four options

**Reason already renders inline.** Ask apply and Process both write link prose after a blank line (`formatLinkProse`): the body stays verbatim, then `event date matches Christian's wedding ([[Christian]]).` Opening the note *is* the glance. Building "render reason near the link" as a new feature would duplicate shipped behavior. The miss in the pickup case was that the assistant never sent a link, so there was nothing to render.

**A frontmatter flag (`inferred: true`) raises the cost of the cheap error.** It needs a schema field, outbox payload, and storage the Ask path deliberately does not have (`buildAskAtomMarkdown` writes no `atom-links` FM — Process parity). Obsidian's graph still cannot filter on it. Any later "review inferred edges" UI would treat a retrieval hint as homework. That inverts the asymmetry: under-linking is the failure we're fixing; a review queue trains writers (model and human) to under-link again. Open-loop Review is the wrong analog. Loops are intentions the user asked to track; inferred links are edges we *want* in the graph. Loop `source: inferred | user` is a property of the note's classification, not of each edge.

**No distinction at all, with hedged `reason`, is the product.** A wrong `[[Christian]]` is visible and cheap. A hedged reason ("event date matches Christian's wedding") is the review, in place, greppable later if we ever want a flag. Do not require an `inferred:` prefix in v1 — it becomes a sticker and fights classify's "reason must teach if wikilinks were stripped."

Revisit a flag only if wrong inferred links become a real volume problem. The current pain is missing links.

---

## Proposed wording

Keep tool-level descriptions short. Put the split on the fields the model is filling. Repeat a one-line split in `ASK_MCP_INSTRUCTIONS` so it survives turn 12, when schema text is farther away.

Cap stays as-is: 10 links, 20 tags (`OUTBOX_MAX_LINKS` / `OUTBOX_MAX_TAGS`).

### `create_atom` tool description

```
Queue a new atom (outbox). Pending until Obsidian applies it. Body is a record — only what the user stated or supplied. Title may sharpen the body; it must not add claims. Links and tags are retrieval hints: propose them, including inferred connections to existing notes, and put the basis in reason. Set open_loop for an intention/IOU, not finished substance.
```

### Field describes (share with `continue_atom`)

**title**

```
Declarative atom title. May summarize or sharpen the body. Must not assert anything the body does not support. Keep inferred connections on links, not in the title.
```

**body**

```
Atom body / capture text. Only what the user stated or supplied (forwarded text, dictated wording). Do not infer, embellish, or add facts. Light clarity (whitespace, obvious typo) is OK.
```

**tags** (optional array)

```
Retrieval labels. Propose tags that will help this note surface later, including inferred ones. Prefer tags already in this mirror (list_tags). Do not use a person's name as a tag when a [[link]] works. Do not invent a flood of new labels.
```

**links** (optional array)

```
Retrieval hints, not assertions of fact. Propose connections proactively, including inferred ones from this conversation or from notes already fetched. A plausible link to an existing note is worth surfacing; a missing link is invisible. Do not invent a note title that is not already in this conversation or the mirror. Always fill reason.
```

**links[].note**

```
Existing atom or hub title (exact vault title when known).
```

**links[].reason** — keep optional in the JSON schema so a missing reason does not reject the whole write; describe it as required when a link is present.

```
Why this link exists. If you include a link, fill this. If the connection is inferred rather than stated in the body, say so and give the basis — "event date matches Christian's wedding" rather than "about Christian". Hedge when uncertain. The sentence must still teach the relationship if wikilinks were stripped.
```

**open_loop** — unchanged. It is a classification of the note, not a retrieval hint. Do not fold it into the permissive links posture.

```
True when this note is an open loop (intention only). Marks atoms-loop active with source user.
```

### `continue_atom` tool description

```
Queue a NEW child atom that continues/revises/contradicts a parent (parent body never modified). Parent must exist in the Ask mirror. Pending until Obsidian applies. Same field jobs as create_atom: child body is a record; title may sharpen without extra claims; extra links and tags are retrieval hints — propose inferred connections to existing notes and put the basis in reason.
```

Reuse the same title / body / tags / links / note / reason describes. Leave `parent_title`, `relation`, and `close_answer` as they are. The auto-injected parent edge (relation prose) stays server-side; extra links still follow the split.

### `ASK_MCP_INSTRUCTIONS` write-rules replacement

Replace the single "Do not invent facts in atom bodies…" bullet with:

```
- Body is a record: do not invent facts. Prefer the user's dictated wording when they give exact text; light clarity is OK for new atoms only.
- Title may sharpen the body; it must not add claims the body does not support. Keep inferred connections on links, not in the title.
- Links are retrieval hints, not claims. Propose them from this conversation and from notes already fetched, even when the body never names the target. A plausible link to an existing note is worth surfacing. Always fill reason with the basis; hedge when the connection is inferred ("event date matches Christian's wedding", not "about Christian"). Do not invent a note title that is not already in this conversation or the mirror.
- Tags: same retrieval posture as links. Prefer tags already in this mirror (list_tags). Do not use a person's name as a tag when a link works.
```

Keep `set_loop`'s "do not invent marks." That rule is about classifying an existing note, not about retrieval.

---

## Schema / apply: what not to change

- Do not add `inferred` (or any new link field) to the outbox payload.
- Do not make `reason` required in Zod / JSON Schema. A required `reason` does not cause linking; it only rejects a tool call (or teaches the model to omit `links[]` entirely — today's failure). Server already stores empty reason as `""`; apply already falls back to `Related to [[note]].`
- Do not run Process `linkQuality` / `stripSelfReferentialLinks` on Ask apply. Those drop empty and junk reasons ("prefer no link over inventing weak prose"). Running them here would silently eat the inferred edges this change is trying to land.
- No plugin bump. plus-service copy only; Fly deploy for live MCP.

Extract shared `linkObject` + field describes in `tools.mjs` so create and continue cannot drift.

---

## Conflicts with existing behavior

1. **Title vs inference.** A title like "Suit pickup for Christian's wedding" asserts the inference in the title. The split forbids that. Title stays "Men's Wearhouse pickup" (or similar); `[[Christian]]` lives on links. This is the load-bearing half of "body is sacred, links are hints."

2. **Classify `people[]` (Process, not MCP).** Classify says "Only ever use a name written in the capture; never infer one from surrounding notes." Process would still miss Christian on the same pickup bullet. Out of scope. Opening that rule is a product change to filing, not to Ask write.

3. **Classify "never invent titles" / hollow hubs.** Keep that on MCP: infer *edges* to notes that already exist in the conversation or mirror; do not mint a new person title. A dangling `[[Christian]]` that was never a note is a different (worse) error than a missing edge.

4. **Tags vs Active vocabulary.** Classify tags are allowlisted. MCP has no Active list unless the model called `list_tags`. "Same permissive posture as links" without that hedge becomes tag sprawl (and people-names-as-tags). The wording above is permissive on *assignment*, conservative on *invention*. Slightly less open than links; that is intentional.

5. **`open_loop` stays conservative.** Pickup text is not an intention. Do not treat `open_loop` like tags/links.

6. **Instructions vs tool description today.** Instructions already body-scope "do not invent facts." This plan makes the tool match them. Tests in `plus-service/test/mcp-ask-write.test.mjs` match `/invent/i` — keep that word on the body bullet.

7. **Weak-reason polish is Process-only.** `isWeakLinkReason` already treats "about [[Christian]]" as junk. The new reason example is chosen to pass that bar *if* Update notes ever sees Ask atoms. Ask apply does not run it now; leave that alone.

8. **Graph / neighbors.** All wikilinks are equal. That is the point of no storage distinction.

---

## Eval (named failure mode)

The pickup case is the golden. After Fly deploy, in a new Ask chat that already has Christian's wedding in context (or after `fetch_atom` on Christian), paste the Men's Wearhouse text and ask for an atom.

Pass:

- Body is the forwarded text (no "for Christian's wedding" invented into the body).
- Title does not name Christian unless the body did.
- `links` includes `{ note: "Christian", reason: … }` with the date/event basis, without the user asking to link him.

Fail: faithful body, no Christian link (today). Fail: Christian asserted in title or body. Fail: reason is "about Christian" / "related to Christian."

Adversarial: a pickup with no matching person in context must not mint a hollow person title.

---

## Implementation sketch (after approval)

1. Issue + STATUS + draft PR (plus-service).
2. Shared link object + field describes in `tools.mjs`; rewrite both tool descriptions; rewrite the instructions write-rule bullets.
3. Tests: freeze the split (body "do not invent" + links "retrieval" / "inferred" + reason example) on create and continue; keep existing `/invent/i` on instructions.
4. Fly deploy. No plugin bump. Dogfood the pickup case live.

No `ce-brainstorm`. Light doc-review on this file before code.
