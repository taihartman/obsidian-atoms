/**
 * list_atoms created + sort/filter (#257) and list_pending (#258).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.mjs";
import { McpServer } from "@modelcontextprotocol/server";
import { registerAskTools } from "../src/mcp/tools.mjs";
import { ASK_MCP_INSTRUCTIONS } from "../src/mcp/instructions.mjs";
import {
  normalizeMirrorCreated,
  paginateMirrorList,
} from "../src/store/askHelpers.mjs";
import { SCOPE_READ, SCOPE_WRITE } from "../src/oauth/constants.mjs";

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

describe("normalizeMirrorCreated + paginateMirrorList", () => {
  it("normalizes day and datetime", () => {
    assert.equal(normalizeMirrorCreated("2026-08-01"), "2026-08-01");
    assert.equal(normalizeMirrorCreated("2026-08-01T9:05"), "2026-08-01T09:05:00");
    assert.equal(normalizeMirrorCreated("nope"), null);
  });

  it("sorts by created desc with nulls last", () => {
    const page = paginateMirrorList(
      [
        { id: "a", title: "A", path: "Atoms/A.md", tags: [], kind: "atom", created: "2026-01-01", updatedAt: "t1" },
        { id: "b", title: "B", path: "Atoms/B.md", tags: ["bug"], kind: "atom", created: "2026-08-01", updatedAt: "t2" },
        { id: "c", title: "C", path: "Atoms/C.md", tags: [], kind: "atom", created: null, updatedAt: "t3" },
      ],
      { sort_by: "created", order: "desc", limit: 10 },
    );
    assert.deepEqual(
      page.items.map((i) => i.title),
      ["B", "A", "C"],
    );
    assert.equal(page.items[0].created, "2026-08-01");
  });

  it("filters tags and date range; default title order", () => {
    const pubs = [
      { id: "a", title: "Zebra", path: "Atoms/Z.md", tags: ["bug"], kind: "atom", created: "2026-07-01", updatedAt: "t" },
      { id: "b", title: "Alpha", path: "Atoms/A.md", tags: ["bug", "app"], kind: "atom", created: "2026-08-01", updatedAt: "t" },
      { id: "c", title: "Mid", path: "Atoms/M.md", tags: ["app"], kind: "atom", created: "2026-07-15", updatedAt: "t" },
    ];
    const def = paginateMirrorList(pubs, { limit: 10 });
    assert.deepEqual(
      def.items.map((i) => i.title),
      ["Alpha", "Mid", "Zebra"],
    );
    const tagged = paginateMirrorList(pubs, { tags: ["bug"], limit: 10 });
    assert.deepEqual(
      tagged.items.map((i) => i.title),
      ["Alpha", "Zebra"],
    );
    const ranged = paginateMirrorList(pubs, {
      created_after: "2026-07-10",
      created_before: "2026-07-20",
      limit: 10,
    });
    assert.deepEqual(
      ranged.items.map((i) => i.title),
      ["Mid"],
    );
  });
});

describe("list_atoms created field + sort", () => {
  it("exposes created on list/search/fetch and sorts", async () => {
    const store = await createStore({ mode: "memory" });
    const email = "u@example.com";
    await store.grantPeriod(email, {
      remaining: 100,
      status: "active",
      plan: "monthly",
    });
    await store.mirrorUpsert(email, [
      {
        path: "Atoms/Old.md",
        title: "Old",
        body: "old",
        tags: ["a"],
        created: "2026-01-01",
      },
      {
        path: "Atoms/New.md",
        title: "New",
        body: "new body",
        tags: ["a", "bug"],
        created: "2026-08-01",
      },
    ]);
    const mcp = makeMcp(store, email, [SCOPE_READ]);
    const list = parseToolJson(
      await mcp._registeredTools.list_atoms.handler(
        { sort_by: "created", order: "desc" },
        {},
      ),
    );
    assert.equal(list.items[0].title, "New");
    assert.equal(list.items[0].created, "2026-08-01");
    assert.equal(list.items[1].created, "2026-01-01");

    const filtered = parseToolJson(
      await mcp._registeredTools.list_atoms.handler(
        { tags: ["bug"], sort_by: "created" },
        {},
      ),
    );
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0].title, "New");

    const search = parseToolJson(
      await mcp._registeredTools.search_atoms.handler(
        { query: "new", snippets: false },
        {},
      ),
    );
    assert.ok(search.results?.length >= 1);
    assert.equal(search.results[0].created, "2026-08-01");

    const fetch = parseToolJson(
      await mcp._registeredTools.fetch_atom.handler(
        { id_or_title: "New" },
        {},
      ),
    );
    assert.equal(fetch.created, "2026-08-01");
    assert.ok(fetch.synced_at);
  });
});

describe("list_pending", () => {
  it("lists open rows and excludes terminal; requires write scope", async () => {
    const store = await createStore({ mode: "memory" });
    const email = "w@example.com";
    await store.grantPeriod(email, {
      remaining: 100,
      status: "active",
      plan: "monthly",
    });
    const enq = await store.outboxEnqueue(email, {
      kind: "create",
      client_request_id: "cr-1",
      payload: {
        title: "Queued note",
        body: "body text here",
        tags: [],
        links: [],
      },
    });
    assert.equal(enq.ok, true);
    const id = enq.id;

    const readOnly = makeMcp(store, email, [SCOPE_READ]);
    const denied = parseToolJson(
      await readOnly._registeredTools.list_pending.handler({}, {}),
    );
    assert.equal(denied.error, "insufficient_scope");

    const mcp = makeMcp(store, email, [SCOPE_READ, SCOPE_WRITE]);
    const open = parseToolJson(
      await mcp._registeredTools.list_pending.handler({}, {}),
    );
    assert.equal(open.count, 1);
    assert.equal(open.pending[0].outbox_id, id);
    assert.equal(open.pending[0].kind, "create_atom");
    assert.equal(open.pending[0].title, "Queued note");
    assert.equal(open.pending[0].status, "pending");
    assert.equal(open.pending[0].client_request_id, "cr-1");

    await store.outboxCancel(email, id);
    const after = parseToolJson(
      await mcp._registeredTools.list_pending.handler({}, {}),
    );
    assert.equal(after.count, 0);
  });
});

describe("instructions", () => {
  it("mentions created sort and list_pending", () => {
    assert.match(ASK_MCP_INSTRUCTIONS, /sort_by=created/);
    assert.match(ASK_MCP_INSTRUCTIONS, /list_pending/);
  });
});
