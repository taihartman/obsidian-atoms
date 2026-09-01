import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/server";
import { createStore } from "../src/store.mjs";
import { registerAskTools } from "../src/mcp/tools.mjs";
import { ASK_MCP_INSTRUCTIONS } from "../src/mcp/instructions.mjs";
import {
  validateOutboxPayload,
  relationReason,
  linksFromAtomBody,
  mergeLinksFromBody,
} from "../src/store/askHelpers.mjs";

function registeredWriteTools() {
  const mcp = new McpServer(
    { name: "t", version: "0" },
    { instructions: ASK_MCP_INSTRUCTIONS },
  );
  registerAskTools(mcp, {
    email: "t@t.co",
    store: {},
    scopes: ["atoms:read", "atoms:write"],
  });
  return mcp;
}

function writeToolSurface(mcp, name) {
  const tool = mcp._registeredTools[name];
  assert.ok(tool, `${name} must be registered`);
  const schema = mcp.toolInputSchemaJson(name);
  assert.ok(schema, `${name} must expose JSON Schema`);
  return { tool, schema };
}

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
    assert.match(ASK_MCP_INSTRUCTIONS, /Do not retry search_atoms/);
    assert.match(ASK_MCP_INSTRUCTIONS, /list_atoms, and mirror_status still apply/);
    assert.match(ASK_MCP_INSTRUCTIONS, /tag_scope/);
    assert.match(ASK_MCP_INSTRUCTIONS, /omitted_by_limit/);
    assert.match(ASK_MCP_INSTRUCTIONS, /omitted_below_threshold/);
    assert.match(ASK_MCP_INSTRUCTIONS, /thinking out loud/i);
    assert.match(ASK_MCP_INSTRUCTIONS, /generic advice/);
    assert.match(ASK_MCP_INSTRUCTIONS, /didn't I write/);
    assert.match(ASK_MCP_INSTRUCTIONS, /I thought I captured/);
    assert.match(ASK_MCP_INSTRUCTIONS, /I know I have something/);
    assert.match(ASK_MCP_INSTRUCTIONS, /new query/);
    assert.match(ASK_MCP_INSTRUCTIONS, /Never unprompted/);
    assert.match(ASK_MCP_INSTRUCTIONS, /Stance first/);
    assert.doesNotMatch(ASK_MCP_INSTRUCTIONS, /Do not keep calling tools/);
    assert.doesNotMatch(ASK_MCP_INSTRUCTIONS, /tools cannot write/i);
    assert.match(
      ASK_MCP_INSTRUCTIONS,
      /Body is a record: do not invent facts/,
    );
    assert.match(ASK_MCP_INSTRUCTIONS, /Links are retrieval hints/);
    assert.match(ASK_MCP_INSTRUCTIONS, /Christian's wedding/);
  });

  it("create and continue split body record from inferred links", () => {
    const mcp = registeredWriteTools();
    const create = writeToolSurface(mcp, "create_atom");
    const cont = writeToolSurface(mcp, "continue_atom");
    const setLoop = mcp._registeredTools.set_loop;

    assert.match(setLoop.description, /do not invent marks/);

    for (const { name, surface } of [
      { name: "create_atom", surface: create },
      { name: "continue_atom", surface: cont },
    ]) {
      const { tool, schema } = surface;
      const body = schema.properties?.body?.description ?? "";
      const links = schema.properties?.links?.description ?? "";
      const reason =
        schema.properties?.links?.items?.properties?.reason?.description ?? "";
      const linkRequired = schema.properties?.links?.items?.required ?? [];

      assert.match(tool.description, /record/, `${name} tool`);
      assert.match(tool.description, /retrieval/, `${name} tool`);
      assert.match(tool.description, /inferred/, `${name} tool`);
      assert.match(body, /Do not infer/, `${name} body`);
      assert.match(links, /retrieval/i, `${name} links`);
      assert.match(links, /inferred/i, `${name} links`);
      assert.match(reason, /Christian's wedding/, `${name} reason`);
      assert.ok(!linkRequired.includes("reason"), `${name} reason optional`);
      assert.equal(
        schema.properties?.links?.items?.properties?.inferred,
        undefined,
        `${name} has no inferred field`,
      );
    }

    assert.deepEqual(
      create.schema.properties.links,
      cont.schema.properties.links,
    );
    assert.equal(
      create.schema.properties.title.description,
      cont.schema.properties.title.description,
    );
    assert.equal(
      create.schema.properties.body.description,
      cont.schema.properties.body.description,
    );
  });

  it("instructions: a reminder or calendar entry is not a close", () => {
    assert.match(ASK_MCP_INSTRUCTIONS, /reminder or calendar/i);
    assert.match(ASK_MCP_INSTRUCTIONS, /not closing/);
    assert.match(ASK_MCP_INSTRUCTIONS, /ordinary continue child/);
    assert.match(ASK_MCP_INSTRUCTIONS, /never redeems/);
    assert.match(ASK_MCP_INSTRUCTIONS, /never set_loop resolved_elsewhere/);
    assert.match(ASK_MCP_INSTRUCTIONS, /continued_by/);
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
