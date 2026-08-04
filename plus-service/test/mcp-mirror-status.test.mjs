/**
 * mirror_status tool + absence wording (#255 / #259).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.mjs";
import { McpServer } from "@modelcontextprotocol/server";
import { registerAskTools } from "../src/mcp/tools.mjs";
import { ASK_MCP_INSTRUCTIONS } from "../src/mcp/instructions.mjs";
import {
  absenceMeta,
  MIRROR_SCOPE_META,
} from "../src/store/askHelpers.mjs";
import { SCOPE_READ, SCOPE_WRITE } from "../src/oauth/constants.mjs";
import { validateOutboxPayload } from "../src/store/askHelpers.mjs";

function parseToolJson(result) {
  const text = result?.content?.[0]?.text;
  assert.ok(typeof text === "string", "tool result text");
  return JSON.parse(text);
}

function makeMcp(store, email, scopes = [SCOPE_READ, SCOPE_WRITE]) {
  const mcp = new McpServer(
    { name: "t", version: "0" },
    { instructions: ASK_MCP_INSTRUCTIONS },
  );
  registerAskTools(mcp, { email, store, scopes });
  return mcp;
}

describe("mirror_status tool", () => {
  it("returns account, counts, scopes; empty mirror hint", async () => {
    const store = await createStore({ mode: "memory" });
    await store.grantPeriod("who@t.co", { status: "active", remaining: 10 });
    const mcp = makeMcp(store, "who@t.co", [SCOPE_READ]);
    const body = parseToolJson(
      await mcp._registeredTools.mirror_status.handler({}, {}),
    );
    assert.equal(body.account, "who@t.co");
    assert.equal(body.server_count, 0);
    assert.equal(body.last_synced_at, null);
    assert.equal(body.pending_writes, 0);
    assert.deepEqual(body.granted_scopes, [SCOPE_READ]);
    assert.equal(body.scope_complete, false);
    assert.ok(typeof body.scope_note === "string");
    assert.match(body.scope_note, /not mean missing from the vault/i);
    assert.match(String(body.hint || ""), /mirror empty/i);
  });

  it("reflects upserted count + last_synced_at + pending_writes", async () => {
    const store = await createStore({ mode: "memory" });
    await store.grantPeriod("full@t.co", { status: "active", remaining: 10 });
    await store.mirrorUpsert("full@t.co", [
      {
        path: "Atoms/Tea.md",
        title: "Tea",
        body: "tea",
        tags: ["drink"],
      },
    ]);
    const v = validateOutboxPayload("create", {
      title: "Queued",
      body: "still pending",
    });
    await store.outboxEnqueue("full@t.co", {
      kind: "create",
      payload: v.payload,
    });

    const mcp = makeMcp(store, "full@t.co");
    const body = parseToolJson(
      await mcp._registeredTools.mirror_status.handler({}, {}),
    );
    assert.equal(body.account, "full@t.co");
    assert.equal(body.server_count, 1);
    assert.ok(body.last_synced_at);
    assert.ok(Number.isFinite(Date.parse(body.last_synced_at)));
    assert.equal(body.pending_writes, 1);
    assert.equal(body.hint, undefined);
  });

  it("fetch not_found exposes in_this_mirror + hub_linked_not_synced", async () => {
    const store = await createStore({ mode: "memory" });
    await store.grantPeriod("n@t.co", { status: "active", remaining: 10 });
    await store.mirrorUpsert("n@t.co", [
      {
        path: "Atoms/About Nichita.md",
        title: "About Nichita",
        body: "friend",
        links: [{ note: "Nichita", reason: "about [[Nichita]]" }],
      },
    ]);
    const mcp = makeMcp(store, "n@t.co");
    const missing = parseToolJson(
      await mcp._registeredTools.fetch_atom.handler(
        { id_or_title: "Totally Missing Note" },
        {},
      ),
    );
    assert.equal(missing.error, "not_found");
    assert.equal(missing.in_this_mirror, false);
    assert.equal(missing.exists_outside_mirror, false);
    assert.equal(missing.hub_linked_not_synced, false);
    assert.equal(missing.reason, "not_in_mirror");
    assert.match(String(missing.hint || ""), /not in this Plus account/i);
    assert.ok(missing.scope_note);

    const hubGap = parseToolJson(
      await mcp._registeredTools.fetch_atom.handler(
        { id_or_title: "Nichita" },
        {},
      ),
    );
    assert.equal(hubGap.error, "not_found");
    assert.equal(hubGap.in_this_mirror, false);
    assert.equal(hubGap.hub_linked_not_synced, true);
    assert.equal(hubGap.exists_outside_mirror, true);
    assert.equal(hubGap.reason, "hub_not_synced");
  });
});

describe("absence meta + instructions (#259)", () => {
  it("scope_note always present on absenceMeta", () => {
    const m = absenceMeta();
    assert.equal(m.scope_complete, false);
    assert.equal(m.scope_note, MIRROR_SCOPE_META.scope_note);
    assert.match(m.scope_note, /Partial mirror/i);
  });

  it("instructions name mirror_status and forbid vault-absence claims", () => {
    assert.match(ASK_MCP_INSTRUCTIONS, /mirror_status/);
    assert.match(ASK_MCP_INSTRUCTIONS, /wrong tenant|wrong-tenant/i);
    assert.match(ASK_MCP_INSTRUCTIONS, /NEVER claim a note is "not in the vault"/i);
    assert.match(ASK_MCP_INSTRUCTIONS, /scope_complete.*always false/i);
    assert.match(ASK_MCP_INSTRUCTIONS, /hub_linked_not_synced/);
  });
});
