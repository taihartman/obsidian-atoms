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
    const { tags, total_distinct, truncated } = aggregateMirrorTags([
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
    assert.equal(total_distinct, 3);
    assert.equal(truncated, false);
  });

  it("caps at limit and sets truncated + total_distinct", () => {
    const lists = [
      ["keep-a"],
      ["keep-a"],
      ["keep-b"],
      ["keep-b"],
      ["keep-c"],
      ["drop-z"],
    ];
    const { tags, total_distinct, truncated } = aggregateMirrorTags(lists, {
      limit: 3,
    });
    assert.equal(total_distinct, 4);
    assert.equal(truncated, true);
    // equal count=1: alpha puts drop-z before keep-c; keep-c is the dropped tail
    assert.deepEqual(tags, [
      { tag: "keep-a", count: 2 },
      { tag: "keep-b", count: 2 },
      { tag: "drop-z", count: 1 },
    ]);
    assert.ok(!tags.some((t) => t.tag === "keep-c"));
    assert.equal(MIRROR_TAGS_LIMIT, 500);
  });

  it("skips non-string tag values and empty strings", () => {
    const { tags, total_distinct } = aggregateMirrorTags([
      ["ok", "", { x: 1 }, null, 42],
    ]);
    assert.deepEqual(tags, [
      { tag: "42", count: 1 },
      { tag: "ok", count: 1 },
    ]);
    assert.equal(total_distinct, 2);
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
    assert.equal(body.truncated, false);
    assert.equal(body.total_distinct, 0);
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
    assert.equal(body.truncated, false);
    assert.equal(body.total_distinct, 2);
    assert.equal(body.hint, undefined);
    assert.deepEqual(body.tags, [
      { tag: "app", count: 2 },
      { tag: "bug", count: 2 },
    ]);
  });

  it("untagged atoms → empty tags with no-tags hint", async () => {
    const store = await createStore({ mode: "memory" });
    await store.grantPeriod("bare@t.co", { status: "active", remaining: 10 });
    await store.mirrorUpsert("bare@t.co", [
      { path: "Atoms/Bare.md", title: "Bare", body: "x", tags: [] },
    ]);
    const mcp = makeMcp(store, "bare@t.co");
    const body = parseToolJson(
      await mcp._registeredTools.list_tags.handler({}, {}),
    );
    assert.equal(body.mirror_count, 1);
    assert.deepEqual(body.tags, []);
    assert.match(String(body.hint || ""), /no tags on mirrored atoms/i);
  });

  it("does not leak tags across tenants", async () => {
    const store = await createStore({ mode: "memory" });
    await store.grantPeriod("a@t.co", { status: "active", remaining: 10 });
    await store.grantPeriod("b@t.co", { status: "active", remaining: 10 });
    await store.mirrorUpsert("a@t.co", [
      {
        path: "Atoms/Secret.md",
        title: "Secret",
        body: "s",
        tags: ["tenant-a-only"],
      },
    ]);
    const mcpB = makeMcp(store, "b@t.co");
    const body = parseToolJson(
      await mcpB._registeredTools.list_tags.handler({}, {}),
    );
    assert.equal(body.account, "b@t.co");
    assert.equal(body.mirror_count, 0);
    assert.deepEqual(body.tags, []);
    assert.ok(!body.tags.some((t) => t.tag === "tenant-a-only"));
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
    assert.equal(listed.truncated, false);
    assert.deepEqual(listed.tags, [
      { tag: "beta", count: 2 },
      { tag: "alpha", count: 1 },
    ]);
    const mcp = makeMcp(store, "sql@t.co");
    const body = parseToolJson(
      await mcp._registeredTools.list_tags.handler({}, {}),
    );
    assert.deepEqual(body.tags, listed.tags);
  });

  it("search_atoms empty with tags filter points at list_tags", async () => {
    const store = await createStore({ mode: "memory" });
    await store.grantPeriod("s@t.co", { status: "active", remaining: 10 });
    await store.mirrorUpsert("s@t.co", [
      {
        path: "Atoms/Has.md",
        title: "Has",
        body: "body",
        tags: ["real"],
      },
    ]);
    const mcp = makeMcp(store, "s@t.co");
    const body = parseToolJson(
      await mcp._registeredTools.search_atoms.handler(
        { query: "zzz", tags: ["missing-tag"] },
        {},
      ),
    );
    assert.deepEqual(body.results, []);
    assert.match(String(body.hint || ""), /list_tags/);
  });
});

describe("list_tags instructions", () => {
  it("names list_tags and tag-filter guidance", () => {
    assert.match(ASK_MCP_INSTRUCTIONS, /list_tags/);
    assert.match(ASK_MCP_INSTRUCTIONS, /tags:\s*filter|tag filter|tags filter/i);
    assert.match(ASK_MCP_INSTRUCTIONS, /truncated/i);
  });
});
