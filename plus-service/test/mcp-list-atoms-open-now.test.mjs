/**
 * list_atoms open_now filter (#573).
 * Derived only: active loop AND no redeeming child. No new state.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.mjs";
import { McpServer } from "@modelcontextprotocol/server";
import { registerAskTools } from "../src/mcp/tools.mjs";
import { ASK_MCP_INSTRUCTIONS } from "../src/mcp/instructions.mjs";
import { paginateMirrorList } from "../src/store/askHelpers.mjs";
import { SCOPE_READ } from "../src/oauth/constants.mjs";
import { askStoreModes, withStore } from "./helpers/askStore.mjs";

function parseToolJson(result) {
  const text = result?.content?.[0]?.text;
  assert.ok(typeof text === "string", "tool result text");
  return JSON.parse(text);
}

function makeMcp(store, email) {
  const mcp = new McpServer(
    { name: "t", version: "0" },
    { instructions: ASK_MCP_INSTRUCTIONS },
  );
  registerAskTools(mcp, { email, store, scopes: [SCOPE_READ] });
  return mcp;
}

function titles(page) {
  return page.items.map((i) => i.title);
}

/** Shared fixture: two open loops, one redeemed-but-still-marked-active, terminals, unmarked. */
function loopPubs() {
  return [
    {
      id: "open",
      title: "Share cowork routine",
      path: "Atoms/Share cowork routine.md",
      kind: "atom",
      tags: ["idea"],
      text: "I will share later",
      links: [],
      loop: { state: "active", source: "inferred" },
      created: "2026-08-01",
      updatedAt: "2026-08-11T00:00:00.000Z",
    },
    {
      id: "redeemed",
      title: "Newsletter idea",
      path: "Atoms/Newsletter idea.md",
      kind: "atom",
      tags: ["idea"],
      text: "I will write the newsletter",
      links: [],
      loop: { state: "active", source: "user" },
      created: "2026-08-02",
      updatedAt: "2026-08-11T00:00:00.000Z",
    },
    {
      id: "child",
      title: "Full routine",
      path: "Atoms/Full routine.md",
      kind: "atom",
      tags: ["writeup"],
      text: "the routine",
      links: [
        { note: "Newsletter idea", reason: "redeems [[Newsletter idea]]" },
      ],
      created: "2026-08-11",
      updatedAt: "2026-08-11T00:00:00.000Z",
    },
    {
      id: "notloop",
      title: "Just a note",
      path: "Atoms/Just a note.md",
      kind: "atom",
      tags: ["idea"],
      text: "substance already",
      links: [],
      loop: { state: "not_a_loop", source: "user" },
      created: "2026-08-03",
      updatedAt: "2026-08-11T00:00:00.000Z",
    },
    {
      id: "resolved",
      title: "Talked it out",
      path: "Atoms/Talked it out.md",
      kind: "atom",
      tags: [],
      text: "resolved in conversation",
      links: [],
      loop: { state: "resolved_elsewhere", source: "user" },
      created: "2026-08-04",
      updatedAt: "2026-08-11T00:00:00.000Z",
    },
    {
      id: "abandoned",
      title: "Dropped idea",
      path: "Atoms/Dropped idea.md",
      kind: "atom",
      tags: [],
      text: "not doing this",
      links: [],
      loop: { state: "abandoned", source: "user" },
      created: "2026-08-05",
      updatedAt: "2026-08-11T00:00:00.000Z",
    },
    {
      id: "unmarked",
      title: "Ordinary atom",
      path: "Atoms/Ordinary atom.md",
      kind: "atom",
      tags: ["idea"],
      text: "just a capture",
      links: [],
      created: "2026-08-06",
      updatedAt: "2026-08-11T00:00:00.000Z",
    },
    {
      id: "continued",
      title: "Still open after continue",
      path: "Atoms/Still open after continue.md",
      kind: "atom",
      tags: ["idea"],
      text: "intention",
      links: [],
      loop: { state: "active", source: "inferred" },
      created: "2026-07-20",
      updatedAt: "2026-08-11T00:00:00.000Z",
    },
    {
      id: "cont-child",
      title: "More thoughts",
      path: "Atoms/More thoughts.md",
      kind: "atom",
      tags: [],
      text: "continues",
      links: [
        {
          note: "Still open after continue",
          reason: "continues [[Still open after continue]]",
        },
      ],
      created: "2026-08-12",
      updatedAt: "2026-08-11T00:00:00.000Z",
    },
  ];
}

const OPEN_TITLES = ["Share cowork routine", "Still open after continue"];

function upsertLoopMirror(store, email) {
  return store.mirrorUpsert(
    email,
    loopPubs().map((p) => ({
      path: p.path,
      title: p.title,
      body: p.text,
      tags: p.tags,
      created: p.created,
      ...(p.loop ? { loop: p.loop } : {}),
      ...(p.links?.length ? { links: p.links } : {}),
    })),
  );
}

describe("paginateMirrorList open_now filter", () => {
  it("open_now=true excludes a redeemed loop whose FM is still active", () => {
    const page = paginateMirrorList(loopPubs(), { open_now: true, limit: 50 });
    assert.deepEqual(titles(page), [...OPEN_TITLES].sort());
    assert.equal(page.total, 2);
    const redeemed = page.items.find((i) => i.title === "Newsletter idea");
    assert.equal(redeemed, undefined);
  });

  it("open_now=true excludes terminals and unmarked atoms", () => {
    const page = paginateMirrorList(loopPubs(), { open_now: true, limit: 50 });
    const set = new Set(titles(page));
    for (const closed of [
      "Just a note",
      "Talked it out",
      "Dropped idea",
      "Ordinary atom",
      "Full routine",
      "More thoughts",
    ]) {
      assert.equal(set.has(closed), false, closed);
    }
    for (const item of page.items) {
      assert.equal(item.open_now, true);
    }
  });

  it("open_now=false returns the complement", () => {
    const pubs = loopPubs();
    const all = paginateMirrorList(pubs, { limit: 50 });
    const open = paginateMirrorList(pubs, { open_now: true, limit: 50 });
    const closed = paginateMirrorList(pubs, { open_now: false, limit: 50 });
    assert.equal(open.total + closed.total, all.total);
    const openSet = new Set(titles(open));
    for (const title of titles(closed)) {
      assert.equal(openSet.has(title), false, title);
    }
    assert.ok(titles(closed).includes("Newsletter idea"));
    assert.ok(titles(closed).includes("Just a note"));
    assert.ok(titles(closed).includes("Talked it out"));
    assert.ok(titles(closed).includes("Dropped idea"));
    assert.ok(titles(closed).includes("Ordinary atom"));
    for (const item of closed.items) {
      assert.equal(item.open_now, false);
    }
  });

  it("composes with tags and created filters", () => {
    const pubs = loopPubs();
    const tagged = paginateMirrorList(pubs, {
      open_now: true,
      tags: ["idea"],
      limit: 50,
    });
    assert.deepEqual(titles(tagged), [...OPEN_TITLES].sort());

    const ranged = paginateMirrorList(pubs, {
      open_now: true,
      created_after: "2026-08-01",
      limit: 50,
    });
    assert.deepEqual(titles(ranged), ["Share cowork routine"]);

    const closedTagged = paginateMirrorList(pubs, {
      open_now: false,
      tags: ["idea"],
      limit: 50,
    });
    assert.deepEqual(titles(closedTagged), ["Just a note", "Newsletter idea", "Ordinary atom"]);
  });

  it("param absent equals today's unfiltered list byte-for-byte", () => {
    const pubs = loopPubs();
    const absent = paginateMirrorList(pubs, { limit: 50, sort_by: "title" });
    const explicitUndef = paginateMirrorList(pubs, {
      limit: 50,
      sort_by: "title",
      open_now: undefined,
    });
    assert.deepEqual(absent, explicitUndef);
    assert.equal(absent.total, pubs.length);
    assert.deepEqual(
      titles(absent),
      [...pubs.map((p) => p.title)].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      ),
    );
    const redeemed = absent.items.find((i) => i.title === "Newsletter idea");
    assert.equal(redeemed.open_now, false);
    const open = absent.items.find((i) => i.title === "Share cowork routine");
    assert.equal(open.open_now, true);
  });

  it("continues child does not close; redeeming child does even if child fails other filters", () => {
    const pubs = loopPubs();
    const open = paginateMirrorList(pubs, { open_now: true, limit: 50 });
    assert.ok(titles(open).includes("Still open after continue"));
    const ideaOnly = paginateMirrorList(pubs, {
      open_now: true,
      tags: ["idea"],
      limit: 50,
    });
    assert.equal(
      titles(ideaOnly).includes("Newsletter idea"),
      false,
      "redeeming child has tag writeup, not idea — parent must still be excluded",
    );
  });
});

describe("list_atoms open_now MCP + stores", () => {
  it("tool description advertises list-open-loops without paging", () => {
    const store = { mirrorList() {}, mirrorStatus() {} };
    const mcp = makeMcp(store, "d@example.com");
    const desc = mcp._registeredTools.list_atoms.description;
    assert.match(desc, /list open loops/i);
    assert.match(desc, /open_now/);
    assert.match(ASK_MCP_INSTRUCTIONS, /open_now=true/);
  });

  it("MCP handler passes the filter and omits it when absent", async () => {
    const store = await createStore({ mode: "memory" });
    const email = "u@example.com";
    await store.grantPeriod(email, {
      remaining: 100,
      status: "active",
      plan: "monthly",
    });
    await upsertLoopMirror(store, email);
    const mcp = makeMcp(store, email);

    const open = parseToolJson(
      await mcp._registeredTools.list_atoms.handler(
        { open_now: true, limit: 50 },
        {},
      ),
    );
    assert.deepEqual(titles(open), [...OPEN_TITLES].sort());
    assert.equal(open.total, 2);

    const closed = parseToolJson(
      await mcp._registeredTools.list_atoms.handler(
        { open_now: false, limit: 50 },
        {},
      ),
    );
    assert.equal(closed.total, 7);
    assert.ok(titles(closed).includes("Newsletter idea"));

    const absent = parseToolJson(
      await mcp._registeredTools.list_atoms.handler({ limit: 50 }, {}),
    );
    const unfiltered = await store.mirrorList(email, { limit: 50 });
    assert.deepEqual(titles(absent), titles(unfiltered));
    assert.equal(absent.total, unfiltered.total);
    assert.equal(absent.total, 9);
  });

  for (const mode of askStoreModes()) {
    it(`${mode} mirrorList applies the same derived filter`, async () => {
      await withStore(mode, async (store) => {
        const email = `loop-${mode}@example.com`;
        await store.grantPeriod(email, {
          remaining: 50,
          status: "active",
          plan: "monthly",
        });
        await upsertLoopMirror(store, email);
        const open = await store.mirrorList(email, {
          open_now: true,
          limit: 50,
        });
        assert.deepEqual(titles(open), [...OPEN_TITLES].sort());
        const closed = await store.mirrorList(email, {
          open_now: false,
          limit: 50,
        });
        assert.equal(open.total + closed.total, 9);
        assert.ok(titles(closed).includes("Newsletter idea"));
        const all = await store.mirrorList(email, { limit: 50 });
        assert.equal(all.total, 9);
      });
    });
  }
});
