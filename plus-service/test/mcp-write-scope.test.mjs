/**
 * atoms:write gate on outbox tools (Bar B U6).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.mjs";
import { McpServer } from "@modelcontextprotocol/server";
import { registerAskTools } from "../src/mcp/tools.mjs";
import { ASK_MCP_INSTRUCTIONS } from "../src/mcp/instructions.mjs";
import {
  parseRequestedScopes,
  scopesOnConsentAllow,
  hasWriteScope,
  SCOPE_READ,
  SCOPE_WRITE,
} from "../src/oauth/constants.mjs";
import { authorizationServerMetadata } from "../src/oauth/metadata.mjs";

describe("scope helpers", () => {
  it("parseRequestedScopes defaults to full Ask", () => {
    assert.deepEqual(parseRequestedScopes(""), [SCOPE_READ, SCOPE_WRITE]);
    assert.deepEqual(parseRequestedScopes("atoms:read"), [SCOPE_READ]);
    assert.ok(parseRequestedScopes("atoms:write").includes(SCOPE_READ));
    assert.ok(parseRequestedScopes("atoms:write").includes(SCOPE_WRITE));
  });

  it("consent Allow always grants full Ask", () => {
    assert.deepEqual(scopesOnConsentAllow([SCOPE_READ]), [
      SCOPE_READ,
      SCOPE_WRITE,
    ]);
  });

  it("metadata lists write scope", () => {
    const as = authorizationServerMetadata("https://plus.tryatoms.app");
    assert.ok(as.scopes_supported.includes(SCOPE_WRITE));
  });
});

describe("write scope tool gate", () => {
  it("create_atom rejected without atoms:write; ok with write", async () => {
    const store = await createStore({ mode: "memory" });
    await store.grantPeriod("w@t.co", { status: "active", remaining: 10 });

    const readOnly = new McpServer(
      { name: "t", version: "0" },
      { instructions: ASK_MCP_INSTRUCTIONS },
    );
    registerAskTools(readOnly, {
      email: "w@t.co",
      store,
      scopes: [SCOPE_READ],
    });
    const denied = await readOnly._registeredTools.create_atom.handler(
      { title: "X", body: "body" },
      {},
    );
    assert.match(JSON.stringify(denied), /insufficient_scope/);

    const full = new McpServer(
      { name: "t2", version: "0" },
      { instructions: ASK_MCP_INSTRUCTIONS },
    );
    registerAskTools(full, {
      email: "w@t.co",
      store,
      scopes: [SCOPE_READ, SCOPE_WRITE],
    });
    const ok = await full._registeredTools.create_atom.handler(
      { title: "Queued note", body: "hello outbox" },
      {},
    );
    const text = JSON.stringify(ok);
    assert.doesNotMatch(text, /insufficient_scope/);
    assert.match(text, /pending|outbox|status/);
  });

  it("accountFromMcpToken exposes mcpScopes", async () => {
    const store = await createStore({ mode: "memory" });
    await store.grantPeriod("s@t.co", { status: "active", remaining: 5 });
    const t = await store.mintMcpTokensForTest(
      "s@t.co",
      "c",
      "https://plus.tryatoms.app/mcp",
      [SCOPE_READ, SCOPE_WRITE],
    );
    const a = await store.accountFromMcpToken(t.accessToken);
    assert.ok(a);
    assert.equal(hasWriteScope(a.mcpScopes), true);
  });
});
