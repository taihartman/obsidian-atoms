# Marketing desk

Founder-facing page: **Do this** first, with copy buttons for any post/email paste.

## Open it

```bash
npm run marketing-desk
```

## How it works

| File | Role |
|---|---|
| `docs/marketing/state.json` | **SSOT** — agents edit this |
| `scripts/marketing-desk-build.mjs` | Embeds JSON into HTML |
| `docs/marketing/desk/index.html` | Generated; do not hand-edit |

Queue items can include:

```json
"paste": { "title": "...", "body": "..." },
"openUrl": "https://www.reddit.com/r/ObsidianMD/submit",
"openLabel": "Open Reddit compose",
"primary": true
```

Pending items with `paste` show at the top with **Copy title / Copy body / Open …**.

## Agent ritual

1. Put every founder action in `queue.items` with concrete `youDo`.  
2. If they must post somewhere, embed full `paste.title` + `paste.body` (not a path to another file).  
3. Never invent metrics.  
4. `npm run marketing-desk:build` (or `:marketing-desk` to open).  

## Not Umami / Metabase

This is a custom ops desk for Atoms. We did **not** install open-source marketing BI (Umami, Metabase, Appsmith). Those are for traffic/ads analytics later if needed. CF Web Analytics on tryatoms is enough for visits.

## Not public

Internal only. `noindex` on the page. Do not ship on tryatoms without auth.
