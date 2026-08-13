# Ask Grok connector dogfood (#476)

Throwaway vault + Plus test account only. Do not use Remote Vault.

## Pin (blocks U1 allowlist)

1. Open grok.com/connectors → New Connector → Custom.
2. Paste `https://plus.tryatoms.app/mcp` (or the dogfood Plus override).
3. Start OAuth. On the first authorize URL, copy `redirect_uri` from the query (browser address bar, not a production log).
4. Pin captured 2026-08-12 from grok.com/rest/oauth/auth-url: `https://grok.com/connectors-oauth-exchange-code/` (exact; DCR failed with `invalid_redirect_uri` until allowlisted).

If the hop has no PKCE S256, no `state`, or `resource` ≠ `{plusBase}/mcp`, stop. File a follow-up. Do not weaken the AS.

## After the pin ships (AE7)

1. Finish OAuth (pairing code or magic link → Allow).
2. In a new Grok chat, ask something only this vault’s mirror knows.
3. Expect a `tools/list` / `search_atoms` hit and a cited atom body.
4. Claude and ChatGPT reconnect still work.

## Honesty (Claude-only user)

Settings Ask heading is **Ask**. Intro says “the assistant you connect.” Privacy has no xAI parenthetical. Write toggle still says **Allow filing from Claude or ChatGPT**.
