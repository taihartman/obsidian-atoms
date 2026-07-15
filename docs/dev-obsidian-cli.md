# Dev: Obsidian CLI (official)

Primary way agents and scripts drive the **throwaway vault** during AI Linker development.

Docs: [obsidian.md/cli](https://obsidian.md/cli) · Help: [obsidian.md/help/cli](https://obsidian.md/help/cli)

## Requirements

- **Installer** Obsidian **1.12+** (installer version, not only in-app auto-update).
- Obsidian app **running**.
- CLI registered on PATH (`obsidian` command).

> Auto-update can leave you on an old **installer** even if features look new. If Settings → General has no “Command line interface”, re-download from [obsidian.md/download](https://obsidian.md/download) and replace the app.

## One-time setup (macOS)

1. Install / replace Obsidian with a **1.12+ installer**  
   (Homebrew: `brew install --cask obsidian` → links `obsidian` to `/opt/homebrew/bin/obsidian`).
2. Open Obsidian → **Settings → General → Advanced → Command line interface** → **enable**.
3. If prompted to register a symlink under `/usr/local/bin`, accept (admin password). Homebrew users often already have `/opt/homebrew/bin/obsidian`.
4. Restart the terminal (or your IDE) if PATH was just updated.

```bash
which obsidian    # expect /opt/homebrew/bin/obsidian (or /usr/local/bin/obsidian)
obsidian help
obsidian version
```

If you see `Command line interface is not enabled`, flip the toggle in step 2 — the binary can exist while the app still refuses commands.

## Target the throwaway vault

Vault path:

```text
/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault
```

Either:

```bash
cd "/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault"
obsidian files
```

Or (first arg form from docs):

```bash
obsidian vault="test vault" files
# or exact name as shown in Obsidian’s vault switcher
```

**Never** point agent automation at your personal vault.

## AI Linker dev loop

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin
npm run build
./scripts/install-to-vault.sh          # copies main.js + reloads if CLI available
```

Manual equivalents:

```bash
obsidian plugin:reload id=ai-linker
obsidian commands filter=ai-linker
obsidian command id=ai-linker:spike-classify-hardcoded
obsidian command id=ai-linker:spike-cache-and-batch-fork
obsidian command id=ai-linker:spike-secret-storage-probe
```

List exact IDs if filter differs:

```bash
obsidian commands filter=linker
# or
obsidian commands | grep -i linker
```

## Useful developer commands

| Command | Purpose |
|---|---|
| `obsidian plugin:reload id=ai-linker` | Hot-reload after build |
| `obsidian plugins versions` | Confirm install |
| `obsidian command id=…` | Run palette commands (spikes) |
| `obsidian eval code="…"` | Run JS in app (debug) |
| `obsidian devtools` | Open DevTools |
| `obsidian dev:errors` | Recent JS errors |
| `obsidian reload` | Reload app window |
| `obsidian create path=… content=…` | Seed fixtures |
| `obsidian read path=…` | Inspect notes / markers |
| `obsidian search query=…` | Find text in vault |

## Seed fake dailies (example)

Adjust folder to match your Daily Notes settings (often root or `Daily/`):

```bash
VAULT="/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault"
cd "$VAULT"

obsidian create path="2026-07-14.md" content="# 2026-07-14\n\n- 14:32 sleep debt seems to plateau, not accumulate forever\n- buy oat milk\n- reminded me of [[something]] today\n" overwrite
```

## CLI vs Local REST API MCP

| | **Obsidian CLI** | **Local REST API MCP** |
|---|---|---|
| Source | Official | Community plugin |
| Best for | Scripts, agents in shell, plugin reload | Grok HTTP tools without shell |
| Project default | **Preferred** | Optional fallback |

Both require Obsidian open. Prefer CLI when `obsidian` is on PATH.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `obsidian: command not found` | Enable CLI in Settings → General; re-register; restart terminal |
| No “Command line interface” toggle | Installer too old → re-download 1.12+ installer |
| Wrong vault | `cd` into test vault or `vault=…` |
| Plugin not listed | `./scripts/install-to-vault.sh` then `plugin:reload` |
| Command id unknown | `obsidian commands filter=ai-linker` |
