import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.mjs";
import { ASK_MCP_INSTRUCTIONS } from "../src/mcp/instructions.mjs";
import {
  validateOutboxPayload,
  relationReason,
  linksFromAtomBody,
  mergeLinksFromBody,
} from "../src/store/askHelpers.mjs";

describe("MCP ask write helpers + store path", () => {
  it("instructions cover pending and compose rules", () => {
    assert.match(ASK_MCP_INSTRUCTIONS, /pending/i);
    assert.match(ASK_MCP_INSTRUCTIONS, /create_atom/);
    assert.match(ASK_MCP_INSTRUCTIONS, /continue_atom/);
    assert.match(ASK_MCP_INSTRUCTIONS, /set_loop/);
    assert.match(ASK_MCP_INSTRUCTIONS, /ask the user before/i);
    assert.match(ASK_MCP_INSTRUCTIONS, /invent/i);
    assert.match(ASK_MCP_INSTRUCTIONS, /Do not recite outbox_id/);
    assert.match(ASK_MCP_INSTRUCTIONS, /check my atoms/);
    assert.match(ASK_MCP_INSTRUCTIONS, /One look/);
    assert.match(ASK_MCP_INSTRUCTIONS, /generic advice/);
    assert.match(ASK_MCP_INSTRUCTIONS, /didn't I write/);
    assert.match(ASK_MCP_INSTRUCTIONS, /Never unprompted/);
    assert.doesNotMatch(ASK_MCP_INSTRUCTIONS, /tools cannot write/i);
  });

  it("validate create and continue payloads", () => {
    const bad = validateOutboxPayload("create", { title: "", body: "x" });
    assert.equal(bad.ok, false);
    const ok = validateOutboxPayload("create", {
      title: "Tea",
      body: "I like tea",
      tags: ["drink"],
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.payload.title, "Tea");

    const cont = validateOutboxPayload("continue", {
      parent_title: "Old claim",
      title: "New claim",
      body: "Actually a joke",
      relation: "revises",
    });
    assert.equal(cont.ok, true);
    assert.equal(cont.payload.relation, "revises");
    assert.ok(
      cont.payload.links.some((l) => l.note === "Old claim"),
    );
    assert.equal(
      relationReason("revises", "Old claim"),
      "revises [[Old claim]]",
    );
  });

  it("create_atom path via store enqueue", async () => {
    const store = await createStore({ mode: "memory" });
    await store.grantPeriod("w@t.co", { status: "active", remaining: 10 });
    const v = validateOutboxPayload("create", {
      title: "From Claude",
      body: "user said this",
    });
    const enq = await store.outboxEnqueue("w@t.co", {
      kind: "create",
      payload: v.payload,
    });
    assert.equal(enq.ok, true);
    assert.equal(enq.status, "pending");
    const pull = await store.outboxPull("w@t.co");
    assert.equal(pull.items[0].payload.body, "user said this");
  });

  it("continue requires parent in mirror", async () => {
    const store = await createStore({ mode: "memory" });
    await store.grantPeriod("w@t.co", { status: "active", remaining: 10 });
    const missing = await store.mirrorFetch("w@t.co", "NoParent");
    assert.equal(missing, null);

    await store.mirrorUpsert("w@t.co", [
      {
        path: "Atoms/Parent.md",
        title: "Parent claim",
        body: "original",
      },
    ]);
    const parent = await store.mirrorFetch("w@t.co", "Parent claim");
    assert.ok(parent);
    const v = validateOutboxPayload("continue", {
      parent_title: "Parent claim",
      title: "Child claim",
      body: "follow up",
      relation: "continues",
    });
    const enq = await store.outboxEnqueue("w@t.co", {
      kind: "continue",
      payload: v.payload,
    });
    assert.equal(enq.ok, true);
    assert.equal(enq.payload.parent_title, "Parent claim");
  });

  it("empty body rejected", () => {
    const v = validateOutboxPayload("create", {
      title: "T",
      body: "   ",
    });
    assert.equal(v.ok, false);
  });

  it("validate set_loop payload", () => {
    const bad = validateOutboxPayload("set_loop", {
      title: "Note",
      state: "maybe",
    });
    assert.equal(bad.ok, false);
    const ok = validateOutboxPayload("set_loop", {
      title: "Note",
      state: "active",
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.payload.state, "active");
    assert.equal(ok.payload.body, undefined);
  });

  it("set_loop enqueue via store", async () => {
    const store = await createStore({ mode: "memory" });
    await store.grantPeriod("w@t.co", { status: "active", remaining: 10 });
    await store.mirrorUpsert("w@t.co", [
      {
        path: "Atoms/Old intention.md",
        title: "Old intention",
        body: "I will write later",
      },
    ]);
    const v = validateOutboxPayload("set_loop", {
      title: "Old intention",
      state: "active",
    });
    const enq = await store.outboxEnqueue("w@t.co", {
      kind: "set_loop",
      payload: v.payload,
    });
    assert.equal(enq.ok, true);
    const pull = await store.outboxPull("w@t.co");
    assert.equal(pull.items[0].kind, "set_loop");
    assert.equal(pull.items[0].payload.state, "active");
    assert.equal(pull.items[0].payload.body, undefined);
  });

  it("parses reason only from link-prose region (not capture)", () => {
    const body =
      "It was a joke.\n\ncontradicts [[Parent claim]].\n";
    const links = linksFromAtomBody(body);
    const hit = links.find((l) => l.note === "Parent claim");
    assert.ok(hit?.reason?.includes("contradicts"));
    // Capture text must not become reason for media/person links
    const hsm = linksFromAtomBody(
      "Andrew loves High School Musical named work.\n\ndurable taste fact about [[Andrew]] from this capture.\n",
    );
    const andrew = hsm.find((l) => l.note === "Andrew");
    assert.ok(andrew?.reason?.includes("durable taste"));
    assert.ok(!andrew?.reason?.includes("High School Musical named work"));
    const merged = mergeLinksFromBody([{ note: "Parent claim" }], body);
    assert.ok(
      merged.find((l) => l.note === "Parent claim")?.reason?.includes(
        "contradicts",
      ),
    );
  });

  it("continue allowed when parent only in outbox", async () => {
    const store = await createStore({ mode: "memory" });
    await store.grantPeriod("w@t.co", { status: "active", remaining: 10 });
    await store.outboxEnqueue("w@t.co", {
      kind: "create",
      payload: { title: "New parent", body: "base" },
    });
    assert.equal(
      await store.outboxHasOpenTitle("w@t.co", "New parent"),
      true,
    );
    assert.equal(await store.mirrorFetch("w@t.co", "New parent"), null);
  });
});
