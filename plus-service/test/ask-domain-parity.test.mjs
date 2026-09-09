import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.mjs";
import { createAskDomain } from "../src/ask/domain.mjs";
import { McpServer } from "@modelcontextprotocol/server";
import { registerAskTools } from "../src/mcp/tools.mjs";

async function fixture() {
  const store = await createStore({ mode: "memory" });
  const email = "ask-domain@example.com";
  await store.grantPeriod(email, { remaining: 50, status: "active", plan: "monthly" });
  await store.mirrorUpsert(email, [
    { path: "Atoms/New.md", title: "New", body: "The launch is Friday.\n", tags: ["work"], created: "2026-09-08" },
    { path: "People/Tai.md", title: "Tai", body: "A hub", kind: "hub", created: "2026-09-09" },
    { path: "Atoms/Old.md", title: "Old", body: "Earlier launch notes", tags: ["work"], created: "2026-01-01" },
    { path: "Atoms/Unknown date.md", title: "Unknown date", body: "No date", tags: [] },
  ]);
  return { store, email, domain: createAskDomain({ store, email }) };
}

describe("protocol-neutral Ask domain", () => {
  it("preserves search scope, freshness, revision and coverage semantics", async () => {
    const { domain, store, email } = await fixture();
    const result = await domain.search({ query: "launch", limit: 8, snippets: false });
    assert.equal(result.account, undefined, "protocol-neutral/G2 domain must not disclose account identity");
    assert.equal(result.mirror_scope[0], "Atoms/");
    assert.equal(result.scope_complete, false);
    assert.ok(result.last_synced_at);
    assert.equal(result.results[0].status, "live");
    assert.equal(result.created_coverage.total, 4);
    const mcp = new McpServer({ name: "parity", version: "0" });
    registerAskTools(mcp, { store, email, scopes: ["atoms:read"] });
    const wire = JSON.parse((await mcp._registeredTools.search_atoms.handler({ query: "launch", limit: 8, snippets: false }, {})).content[0].text);
    assert.deepEqual(wire.results, result.results);
    assert.equal(wire.last_synced_at, result.last_synced_at);
    assert.deepEqual(wire.created_coverage, result.created_coverage);
    assert.equal(wire.retrieval, result.retrieval);
    assert.equal(wire.account, email, "MCP keeps its documented account field");
  });

  it("filters hubs before recent pagination and sorts covered dates with nulls last", async () => {
    const { domain } = await fixture();
    const page = await domain.recent({ limit: 2, offset: 0 });
    assert.deepEqual(page.items.map((row) => row.title), ["New", "Old"]);
    assert.equal(page.total, 3);
    assert.deepEqual(page.created_coverage, { with_created: 2, total: 3 });
    assert.equal(page.coverage_complete, false);
    assert.equal(page.next_offset, 2);
  });

  it("fetches only an opaque tenant ID with bounded verbatim byte pagination", async () => {
    const { domain } = await fixture();
    const recent = await domain.recent({ limit: 1 });
    const id = recent.items[0].id;
    const first = await domain.fetch({ id, offset: 0, maxBytes: 8 });
    assert.equal(first.text, "The laun");
    assert.equal(first.position.offset, 0);
    assert.equal(first.position.next_offset, 8);
    const second = await domain.fetch({ id, offset: 8, maxBytes: 64 });
    assert.equal(first.text + second.text, "The launch is Friday.\n");
    assert.equal((await domain.fetch({ id: "New" })).error, "not_found");
    assert.equal((await createAskDomain({ store: (await fixture()).store, email: "foreign@example.com" }).fetch({ id })).error, "not_found");
  });
});
