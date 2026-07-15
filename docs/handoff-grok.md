# Implementation handoff — Obsidian Atoms (for Grok or any coding agent)

This is a paste-ready kickoff prompt. **How to use it:** paste the prompt below into
Grok, then paste the full contents of the two source documents where indicated. Grok has
no access to this filesystem, so the documents must travel with the prompt.

Source documents (both live in this repo):
- `docs/plans/2026-07-15-001-feat-obsidian-atoms-plugin-plan.md` — the implementation plan (authority)
- `docs/spec-amendments.md` — the corrected design + rationale the plan builds on

---

## Kickoff prompt (paste this, then paste the two docs)

You are implementing an Obsidian plugin from a finished, reviewed implementation plan. Two
documents are the authority — **read both fully before writing any code**:

1. THE PLAN (implementation authority):
   ```
   <paste 2026-07-15-001-feat-obsidian-atoms-plugin-plan.md here>
   ```
2. THE CORRECTED-DESIGN SOURCE it builds on (rationale for the plan's decisions):
   ```
   <paste spec-amendments.md here>
   ```

Where the two conflict, the plan wins. Where the plan cites the amendments (§A, §B, §H1…),
the amendments explain *why*.

**What you're building:** an Obsidian plugin that reads *past* daily notes, splits each into
individual captures, classifies every capture as atom / task / noise via the Anthropic API,
writes one atomic note per atom (declarative-claim title + reason-bearing wikilinks, verbatim
body), and marks every capture in place with a sentinel comment so nothing is reprocessed.
Capture itself already exists (a native iOS Shortcut) — do not build capture UI.

**How to work:**
- Build strictly in unit order **U1 → U10** (the plan's Implementation Units). Each unit is
  one atomic commit's worth of work. Implement its `Files`, satisfy every `Test scenario`,
  meet its `Verification`, then move on. Do not skip test scenarios.
- **U1 is a spike — do it first**, and resolve its two open forks empirically before
  committing the affected KTDs: (a) per-day batching vs per-capture prompt-caching (KTD3);
  (b) whether iOS SecretStorage works in the plugin sandbox, else the device-local fallback
  (KTD5). The plan tells you exactly what to measure.
- **Dry-run (U7) ships before the write path (U8).** Never build the write path first.
- **Test-first on the two correctness cores:** `parseCaptures` + marker detection (U3), and
  `render` + marker writing (U8).
- Develop against a **throwaway vault with ~20 fake daily notes**. Never the real vault.
- After each unit, show me the file diffs and the evidence its Verification calls for
  (test output, or console output for the spike) before continuing.

**Non-negotiables — violating any of these is a bug, not a style choice:**
- The atom body is the user's capture text **verbatim** (whitespace / obvious-typo cleanup is
  the ceiling). The model's entire output surface is title, tags, links — nothing else.
- Never move files or choose folders. Atoms land **flat** in the one configured folder.
- **Never read or modify today's daily note.** Only *create files* and *append* to daily
  notes; never rewrite a daily note's existing lines.
- The **sentinel HTML comment is the processed-marker**, and it covers **all three** verdicts
  (`<!--linker-->` for atoms, `<!--linker:task-->` / `<!--linker:noise-->` for the rest) —
  see KTD1. A capture's own inline wikilinks are NOT a marker.
- API key lives in **SecretStorage**, never in `data.json`.
- Nothing is ever destroyed; every run is idempotent and re-runnable.

**Verify against live docs before relying on them** (the plan flags these as spike-verified):
- Anthropic structured outputs — `output_config.format` with `type: json_schema`, and whether
  a beta header is required.
- Anthropic prompt caching — `cache_control` breakpoint, `cache_read_input_tokens` in `usage`,
  `5m`/`1h` TTL.
- iOS SecretStorage / `SecretComponent` availability in the Obsidian plugin sandbox.

**Stack:** `obsidianmd/obsidian-sample-plugin` template · TypeScript + esbuild · dependency
`obsidian-daily-notes-interface` · `manifest.json` `isDesktopOnly: false` · network via
Obsidian's `requestUrl` (not `fetch` — CORS). Log-safety: never log request headers/bodies or
full error objects; redact the key.

**Start with U1.** Read both documents, then build the spike and show me it working.

---

## Reviewer's note (context, not part of the prompt)

The plan has already been through a multi-persona review; the known-hard spots are all
addressed in the plan text: the collision policy (KTD8), the cold-`metadataCache` gate (U9),
the schema invariant check (KTD4), batch cost estimation (U10), and the multi-line capture
boundary (U3). If Grok proposes deviating from a non-negotiable "to simplify," that's the
signal to push back and re-read the amendments — each one is load-bearing.
