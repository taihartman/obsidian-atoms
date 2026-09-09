# Obsidian Atoms — Codex instructions

This is the Codex-specific project policy. Do not read `CLAUDE.md`, `.claude/**`,
or another host's workflow files during normal work. Use this file and open only
the host-neutral project documents relevant to the requested change.

## Product and scope

Atoms turns past daily captures into a trusted second brain: classify captures,
create flat atom notes with verbatim bodies, add reason-bearing links and
sentinels, surface them in Atoms Home, and gently resurface them later. It is not
a task manager. Capture UI, folder intelligence, embeddings, and unattended
personal-vault automation are out of scope unless the user explicitly opens that
scope.

Implement only what the user requests. For feature work, inspect the relevant
active plan or specification under `docs/` rather than loading the entire project
history. Use `docs/architecture.md` for architectural decisions and
`docs/obsidian-api-conventions.md` for changes under `src/**`.

## Non-negotiable product and data rules

- Preserve capture bodies verbatim except for whitespace or obvious typo fixes.
  Model-controlled output is limited to titles, tags, and links.
- Atoms stay flat in the configured atom folder. Never move atom files or infer
  folders. Plugin-owned non-atom files live under `Atoms System/`.
- Do not process today's daily note by default. Forced processing may create atom
  files and append markers, but must not rewrite existing daily-note lines.
- A processed capture uses the documented linker sentinel. Wikilinks inside the
  original capture are not processing markers.
- Keep API keys in Obsidian SecretStorage or the device-local fallback, never in
  `data.json`, logs, request dumps, or committed files.
- Keep writes idempotent and non-lossy. Require dry-run evidence before relying on
  a new untrusted classify or write path.
- Never write experiments, fixtures, rewrites, or unattended QA into a personal
  or Remote Vault. Use `test_vault/` or `docs/media/demo-vault/` only.
- Desktop, iOS, and Android are first-class consumers. Platform-limited behavior
  requires explicit scope.
- Plus-owned configuration must not be pushed back onto paying users. Keep any
  advanced override optional.

## Architecture and implementation

- Keep `plugin/main.ts` a thin lifecycle and wiring shell.
- Preserve the pipeline boundaries in `pipeline/{parse,context,classify,render,
  preview,write,backfill}.ts` and `pipeline/enrich/`.
- Intelligence lives in titles and links, not folders.
- For Obsidian APIs, prefer `requestUrl`, `Platform.*`, `window.setTimeout`,
  `createEl` / `createSpan`, `instanceof TFile`, and CSS classes or
  `setCssStyles`. Avoid bare `fetch`, `navigator`, and direct `el.style.*` unless
  an existing documented exception applies.
- Route user-facing text through the locale catalog.
- Add or update focused tests when changing correctness-critical pure logic such
  as parsing or rendering.
- For a user-visible version change, update `manifest.json`, `package.json`, and
  `versions.json` together.

## Coordination and workflow

Do not read all of `STATUS.md`, inspect every open issue or pull request, claim an
issue, or create a draft pull request at routine session start. When the user asks
for issue, pull-request, shipping, or concurrent-work coordination, inspect only
the relevant status row and remote item, then follow the applicable collaboration
or release runbook. External GitHub changes still require the authority described
in the global Codex policy.

Do not automatically run a Compound Engineering lifecycle or a stacked shipping
tail. Use the global workflow rules. Shipping-specific checks, release steps, PR
evidence, and screenshots apply when the user asks to ship, open or update a PR,
merge, or prepare release evidence.

## Verification

Run the narrowest meaningful check for the change. Common commands are:

```bash
npm test
npm run build
npm run lint
```

For behavior that requires live Obsidian proof, use the throwaway vault and the
relevant CLI command or `./scripts/verify.sh` when Obsidian is available. Do not
block an unrelated or documentation-only change on live-vault QA.
