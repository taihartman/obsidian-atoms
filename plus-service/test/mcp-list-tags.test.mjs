/**
 * list_tags tool + aggregateMirrorTags (#256).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.mjs";
import { McpServer } from "@modelcontextprotocol/server";
import { registerAskTools } from "../src/mcp/tools.mjs";
import { ASK_MCP_INSTRUCTIONS } from "../src/mcp/instructions.mjs";
import {
  aggregateMirrorTags,
  MIRROR_TAGS_LIMIT,
} from "../src/store/askHelpers.mjs";
import { SCOPE_READ } from "../src/oauth/constants.mjs";

function parseToolJson(result) {
  const text = result?.content?.[0]?.text;
  assert.ok(typeof text === "string", "tool result text");
  return JSON.parse(text);
}

function makeMcp(store, email, scopes = [SCOPE_READ]) {
  const mcp = new McpServer(
    { name: "t", version: "0" },
    { instructions: ASK_MCP_INSTRUCTIONS },
  );
  registerAskTools(mcp, { email, store, scopes });
  return mcp;
}

describe("aggregateMirrorTags", () => {
  it("counts atoms per tag, merges case, sorts count desc then alpha", () => {
    const tags = aggregateMirrorTags([
      ["app", "bug"],
      ["Bug"],
      ["app"],
      ["zebra"],
      [],
      ["app", "app"],
    ]);
    assert.deepEqual(tags, [
      { tag: "app", count: 3 },
      { tag: "bug", count: 2 },
      { tag: "zebra", count: 1 },
    ]);
  });

  it("caps at limit", () => {
    const lists = Array.from({ length: 10 }, (_, i) => [`t${i}`]);
    const tags = aggregateMirrorTags(lists, { limit: 3 });
    assert.equal(tags.length, 3);
    assert.equal(MIRROR_TAGS_LIMIT, 500);
  });
});

describe("list_tags tool", () => {
  it("empty mirror → empty tags + hint + scope", async () => {
    const store = await createStore({ mode: "memory" });
    await store.grantPeriod("empty@t.co", { status: "active", remaining: 10 });
    const mcp = makeMcp(store, "empty@t.co");
    const body = parseToolJson(
      await mcp._registeredTools.list_tags.handler({}, {}),
    );
    assert.equal(body.account, "empty@t.co");
    assert.equal(body.mirror_count, 0);
    assert.deepEqual(body.tags, []);
    assert.equal(body.scope_complete, false);
    assert.ok(body.scope_note);
    assert.deepEqual(body.searched_fields, ["tags"]);
    assert.match(String(body.hint || ""), /mirror empty/i);
  });

  it("returns vocabulary with counts from seeded tags", async () => {
    const store = await createStore({ mode: "memory" });
    await store.grantPeriod("tags@t.co", { status: "active", remaining: 10 });
    await store.mirrorUpsert("tags@t.co", [
      {
        path: "Atoms/A.md",
        title: "A",
        body: "a",
        tags: ["bug", "app"],
      },
      {
        path: "Atoms/B.md",
        title: "B",
        body: "b",
        tags: ["app"],
      },
      {
        path: "Atoms/C.md",
        title: "C",
        body: "c",
        tags: ["Bug"],
      },
      {
        path: "Atoms/D.md",
        title: "D",
        body: "d",
        tags: [],
      },
    ]);
    const mcp = makeMcp(store, "tags@t.co");
    const body = parseToolJson(
      await mcp._registeredTools.list_tags.handler({}, {}),
    );
    assert.equal(body.account, "tags@t.co");
    assert.equal(body.mirror_count, 4);
    assert.equal(body.hint, undefined);
    assert.deepEqual(body.tags, [
      { tag: "app", count: 2 },
      { tag: "bug", count: 2 },
    ]);
  });

  it("sqlite store aggregates tags_json", async () => {
    const store = await createStore({ mode: "sqlite", path: ":memory:" });
    await store.grantPeriod("sql@t.co", { status: "active", remaining: 10 });
    await store.mirrorUpsert("sql@t.co", [
      {
        path: "Atoms/One.md",
        title: "One",
        body: "one",
        tags: ["alpha", "beta"],
      },
      {
        path: "Atoms/Two.md",
        title: "Two",
        body: "two",
        tags: ["beta"],
      },
    ]);
    const listed = await store.mirrorListTags("sql@t.co");
    assert.equal(listed.mirror_count, 2);
    assert.deepEqual(listed.tags, [
      { tag: "beta", count: 2 },
      { tag: "alpha", count: 1 },
    ]);
  });
});

describe("list_tags instructions", () => {
  it("names list_tags and tag-filter guidance", () => {
    assert.match(ASK_MCP_INSTRUCTIONS, /list_tags/);
    assert.match(ASK_MCP_INSTRUCTIONS, /tags:\s*filter|tag filter|tags filter/i);
  });
});
