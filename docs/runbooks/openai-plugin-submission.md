# OpenAI plugin submission (Atoms Plus)

**Plugin portal:** `https://platform.openai.com/plugins`

**MCP URL:** `https://plus.tryatoms.app/mcp`

**Website:** `https://tryatoms.app`
**Plan:** `docs/plans/2026-09-09-624-openai-plugin-submission.md`

## Public listing

| Field    | Value                                                 |
| -------- | ----------------------------------------------------- |
| Name     | Atoms Plus                                            |
| Version  | 1.0.0                                                 |
| Subtitle | Search your Obsidian atoms                            |
| Category | Productivity                                          |
| Website  | `https://tryatoms.app`                                |
| Support  | `https://github.com/taihartman/obsidian-atoms/issues` |
| Privacy  | `https://tryatoms.app/privacy`                        |
| Terms    | `https://tryatoms.app/terms`                          |

**Description**

> Search, retrieve, and continue ideas from the private Atoms mirror you enable in Obsidian. Atoms Plus works only with your flat Atoms folder and linked hubs, not daily notes or the rest of your vault, and can queue new atoms for Obsidian to apply.

**Release notes**

> Initial OpenAI plugin submission for the Atoms Plus remote MCP. It provides scoped search and retrieval over the user's opt-in Atoms mirror and queues capture operations for Obsidian to review and apply.

The integration is remote-MCP-only. Do not provide UI screenshots because there is no OpenAI component UI in v1.

## Domain verification

Use the parent-domain challenge base URL `https://tryatoms.app`. After the website deployment, this URL must return only the token, with no HTML or surrounding whitespace:

`https://tryatoms.app/.well-known/openai-apps-challenge`

If OpenAI rotates the token, update `www/src/.well-known/openai-apps-challenge`, rebuild, deploy, and verify again.

## Reviewer account

Use dedicated active Plus tenants whose addresses identify their role and end with `@review.tryatoms.app`. Seed only the synthetic fixtures below. Never use a customer account or the owner's personal vault.

Give OpenAI one current dedicated reviewer credential and at least one backup reviewer account/credential in the private Testing instructions. A reviewer credential is a secret. It is high-entropy, reusable until its bounded expiry, and intended for OpenAI's later reviewers and ongoing testing. Do not commit it, put it in an issue or PR, paste it into public documentation, or allow it into CI or service logs. The reviewer flow is:

1. Start the Atoms Plus connection in ChatGPT.
2. On the Atoms authorization page, choose **I have a code from Obsidian**.
3. Enter the supplied reviewer credential.
4. Confirm the displayed reviewer account and the `atoms:read` and `atoms:write` scopes.
5. Select **Allow**.

If a credential expires or must be rotated, remint it for that reviewer tenant, replace it in the portal Testing instructions, and submit the updated draft. Reminting invalidates the prior credential. Ordinary user-generated pairing codes remain eight-character, ten-minute, and one-time.

Reviewer identities are operator-owned. Normal authenticated Plus mirror and pairing endpoints reject them, so an Obsidian session cannot overwrite the reusable credential or replace the synthetic fixtures. Reprovisioning revokes the target reviewer's access tokens, refresh tokens, browser sessions, and unexchanged authorization codes. Provision only after every Fly machine runs the new reviewer-aware code; validate the replacement tenant before changing the credential stored in OpenAI's private Testing instructions.

## Synthetic fixtures

Seed these atoms in every reviewer tenant:

| Path                                       | Title                           | Tags                   | Body                                                                                              |
| ------------------------------------------ | ------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------- |
| `Atoms/Blue notebook ritual.md`            | Blue notebook ritual            | `ritual`, `writing`    | Writing three lines in a blue notebook before breakfast makes it easier to start the first draft. |
| `Atoms/Library window idea.md`             | Library window idea             | `place`, `writing`     | The quiet table by the east library window is a good place to revise long drafts.                 |
| `Atoms/Call Mira about the field guide.md` | Call Mira about the field guide | `project`, `follow-up` | Ask Mira whether the field guide should include the notebook ritual and the library window.       |

Add links from `Call Mira about the field guide` to both other fixture titles. Mark it as an active loop. The unusual phrase `violet submarine checksum` must not appear anywhere; it is the negative-search fixture.

## Positive review tests

Paste exactly these five cases into the portal. Expected results describe the contract, not exact prose.

### P1. Account and mirror status

**Prompt:** `Check the status of my Atoms mirror. Tell me which account is connected, how many notes are available, and when it last synced.`

**Expected:** Calls `mirror_status`; names only the synthetic reviewer account; returns a nonzero count and a timestamp; does not claim whole-vault access.

### P2. Browse tags and newest atoms

**Prompt:** `What tags are present in my Atoms mirror and how many atoms use each one? Then list the newest atoms without doing a relevance search.`

**Expected:** Calls `list_tags`, then `list_atoms` with created-date descending ordering; includes `writing`, `ritual`, `place`, `project`, and `follow-up` with counts; does not substitute repeated keyword searches.

### P3. Search, then fetch authoritative content

**Prompt:** `Find my note about the blue notebook and tell me exactly what habit it records.`

**Expected:** Calls `search_atoms`, then `fetch_atom` before quoting or making a body claim; reports the three-lines-before-breakfast habit.

### P4. Inspect graph neighbors

**Prompt:** `What notes are connected to “Call Mira about the field guide”?`

**Expected:** Calls `neighbors` or fetches the atom; identifies both synthetic linked notes; does not invent links.

### P5. Exercise the queued-write lifecycle

**Prompt:** `Save “Try outlining the field guide beside the library window” as a new writing/project atom. Continue “Blue notebook ritual” with “Test the ritual for seven mornings.” Mark “Library window idea” as an active loop, show all pending writes, and cancel only that loop-state change.`

**Expected:** After any client-required confirmations, calls `create_atom`, `continue_atom`, `set_loop`, `list_pending`, and `cancel_pending`. New and continued atoms are queued without editing an existing body; the loop change is queued and then only that selected pending operation is canceled; the response never claims an instant vault write.

## Negative review tests

Paste exactly these three cases into the portal. Atoms Plus should not trigger for any of them.

### N1. Current weather

**Prompt:** `What is the weather in Chicago today?`

**Expected:** Atoms Plus does not trigger; use a weather or web source if available.

### N2. Summarize supplied text

**Prompt:** `Summarize this sentence: Small habits become easier when the cue is visible.`

**Expected:** Atoms Plus does not trigger; answer only from the text supplied in the prompt.

### N3. Calendar action

**Prompt:** `Schedule a calendar event tomorrow at 3 PM called Project check-in.`

**Expected:** Atoms Plus does not trigger; use a calendar integration if available or explain that one is required.

## Tool annotation justification

| Tools                                                                                                 | `readOnlyHint` | `openWorldHint` | `destructiveHint` | Justification                                                                                                                         |
| ----------------------------------------------------------------------------------------------------- | -------------: | --------------: | ----------------: | ------------------------------------------------------------------------------------------------------------------------------------- |
| `mirror_status`, `list_tags`, `search_atoms`, `fetch_atom`, `neighbors`, `list_pending`, `list_atoms` |           true |           false |             false | Strictly retrieve data from one bounded private Atoms tenant.                                                                         |
| `create_atom`, `continue_atom`                                                                        |          false |           false |             false | Add reversible pending work inside one bounded private tenant. They do not overwrite existing note bodies or contact outside parties. |
| `set_loop`, `cancel_pending`                                                                          |          false |           false |              true | `set_loop` can overwrite loop state, and `cancel_pending` cannot restore the same queued operation. Both remain bounded to one tenant. |

## Pre-submit verification

- [ ] Policy, terms, website, and support URLs return HTTP 200.
- [ ] Domain challenge returns the exact current token.
- [ ] Production OAuth discovery resolves from the MCP resource.
- [ ] Portal Scan Tools lists all eleven tools.
- [ ] Every tool shows all three expected annotations.
- [ ] Reviewer account is active and contains only synthetic fixtures.
- [ ] CI validates the security contract and the Pages deploy checks the live challenge byte-for-byte.
- [ ] Primary and backup reviewer credentials each work for two independent OAuth authorizations, remain private, and show the correct synthetic account and scopes.
- [ ] Positive and negative tests match production behavior.
- [ ] Listing copy and icons render correctly in light and dark mode.
- [ ] Owner confirms verified developer identity, public author name, OAuth Allow action, and country availability.
- [ ] Owner confirms policy declarations and selects Submit for Review.

## Rollback and cleanup

If the deployment regresses MCP behavior, roll Fly back to the prior release. If the challenge is wrong, deploy the prior website asset or rotate the portal token. If reviewer access is compromised, reprovision that synthetic reviewer tenant, validate its fresh credential, and then update the private portal instructions; the old OAuth authorization state is revoked during reprovisioning. After review, keep the synthetic tenant for regression checks or revoke and remove only that tenant.
