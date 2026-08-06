# Field notes content

| Path | Role |
|---|---|
| `drafts/` | WIP JSON for `npm run field-notes:test` / broadcast |
| `published/` | **Web SSOT** — real notes only on `master`. `build:www` emits `/notes/` from here |

Draft basename: `YYYY-MM-DD-<slug>.json` (safe slug: lowercase letters, digits, hyphens).

After a successful **broadcast**, `scripts/field-notes-send.mjs` writes the same basename into `published/`. Commit, merge to master (Pages deploy), then verify `https://tryatoms.app/notes/<slug>/`.

CI fixtures for helpers live under `test/fixtures/field-notes/` — not a substitute for real published notes on production.
