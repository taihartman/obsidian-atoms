# Draft: tryatoms.app page, "What leaves your machine"

Status: draft copy for a future www-only PR (own claim; this file is not the page). Purpose: the single link we drop in every skeptical thread instead of a paragraph of defense. Every claim below must stay true against the tripwires in `docs/plans/2026-07-28-002-audit-tryatoms-page-vs-product.md`: never "zero-knowledge", never "whole vault", never unqualified "files itself". Facts verified against README, architecture.md, and the Ask mirror shape as of 0.8.14. Re-verify at ship time.

---

## What leaves your machine

Atoms is a plugin inside your Obsidian vault. Your notes are markdown files on your device. This page says exactly what leaves, when, and what never does.

### When Atoms files your captures

Each filing run sends, over TLS: your vault's note titles, your tags, the titles of your person hubs, and the text of the captures being filed.

- With your own Anthropic key, it goes to the Anthropic API and Anthropic bills you for usage. Your key lives in Obsidian's SecretStorage or a device-local fallback, never in the plugin's settings file.
- With Atoms Plus, it goes through the Atoms service to the model. That is the product: you pay so there is no key to hold.

Nothing is sent until you run filing, or until you have explicitly turned on automatic filing and acknowledged its disclosure. Automatic filing never touches today's daily note and never reaches back before the day you enabled it.

### When you ask Claude or ChatGPT about your atoms

Ask works from a mirror: a copy of your flat atoms folder, plus hub notes linked from atoms. Only that. The mirror never contains the rest of your vault. Sync goes one way, vault to mirror. Chat can queue new atoms for your vault, but nothing ever edits an atom body from the cloud side.

You can wipe the cloud copy from Settings at any time. You can also skip our hosting entirely and run the mirror service yourself; the guide is public.

### What never leaves

- Your vault. Atoms reads it locally; filing sends the fields listed above and nothing else.
- Your atom bodies are never rewritten, by us or by the model. Titles, tags, and links are the model's only output surface.
- Your API key. It is stored by the OS, sent only to Anthropic, and never logged.

### If you leave

Cancel Plus, or uninstall the plugin, and every atom is still a plain markdown file in your vault. There is no export step because there was never an import step.

### This website

The plugin contains no analytics or telemetry. This website counts visits with Cloudflare Web Analytics: no cookies, no cross-site tracking.

Questions we did not answer here: [contact / GitHub link]. If we ever change what is sent, the plugin re-asks for your acknowledgment before sending it.

---

Voice check notes: plain verbs, no "zero-knowledge" or absolute security claims, states the Plus trade honestly (you pay so there is no key to hold), no em dashes.
