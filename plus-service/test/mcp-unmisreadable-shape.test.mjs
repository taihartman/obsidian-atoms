/**
 * MCP response shapes that block misreading (revision status, snippet authority, scope).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.mjs";
import {
  absenceMeta,
  buildInboundIndex,
  buildSearchHits,
  revisionStatusFor,
  shapeFetchAtom,
  SEARCHED_FIELDS,
} from "../src/store/askHelpers.mjs";
import { ASK_MCP_INSTRUCTIONS } from "../src/mcp/instructions.mjs";

const RESOURCE = "https://plus.tryatoms.app/mcp";

async function withStore(mode, fn) {
  const opts =
    mode === "sqlite"
      ? { mode: "sqlite", path: ":memory:" }
      : { mode: "memory" };
  const store = await createStore(opts);
  try {
    await fn(store);
  } finally {
    if (store.close) store.close();
  }
}

function seedAccount(store, email) {
  return store.grantPeriod(email, { remaining: 150, status: "active", plan: "monthly" });
}

/** Andrew HSM parent + joke reviser (handoff fixture pair). */
async function seedAndrewPair(store, email) {
  await store.mirrorUpsert(email, [
    {
      path: "Atoms/Andrew HSM.md",
      title: "Andrew loves High School Musical",
      body: "Andrew said he loves High School Musical.",
      links: [],
    },
    {
      path: "Atoms/Andrew HSM joke.md",
      title: "Andrew's High School Musical love was actually a joke",
      body: "It was a bit.\n\nrevises [[Andrew loves High School Musical]]",
      links: [
        {
          note: "Andrew loves High School Musical",
          reason: "revises [[Andrew loves High School Musical]]",
        },
      ],
    },
  ]);
}

/** Nichita Penfield wait + position closed. */
async function seedNichitaPair(store, email) {
  await store.mirrorUpsert(email, [
    {
      path: "Atoms/Nichita Penfield wait.md",
      title: "Nichita still waiting on Penfield hospital interview response",
      body: "Still waiting.",
      links: [{ note: "Nichita", reason: "about [[Nichita]]" }],
    },
    {
      path: "Atoms/Penfield closed.md",
      title: "Penfield hospital closed the position Nichita interviewed for",
      body: "Position filled/closed.\n\nrevises [[Nichita still waiting on Penfield hospital interview response]]",
      links: [
        {
          note: "Nichita still waiting on Penfield hospital interview response",
          reason: "revises [[Nichita still waiting on Penfield hospital interview response]]",
        },
        { note: "Nichita", reason: "about [[Nichita]]" },
      ],
    },
    {
      path: "Social/People/Nichita.md",
      title: "Nichita",
      body: "Friend. Hand-maintained hub prose.",
      kind: "hub",
      links: [],
    },
  ]);
}

describe("mcp unmisreadable shape helpers", () => {
  it("absenceMeta always exposes scope + searched_fields + scope_note", () => {
    const m = absenceMeta();
    assert.equal(m.scope_complete, false);
    assert.ok(Array.isArray(m.mirror_scope));
    assert.ok(m.mirror_scope.includes("Atoms/"));
    assert.deepEqual(m.searched_fields, SEARCHED_FIELDS);
    assert.ok(typeof m.scope_note === "string");
    assert.match(m.scope_note, /not mean missing from the vault/i);
  });

  it("revisionStatusFor: revises → superseded + revised_by", () => {
    const pubs = [
      {
        title: "Parent claim",
        path: "Atoms/P.md",
        links: [],
      },
      {
        title: "Child correction",
        path: "Atoms/C.md",
        links: [{ note: "Parent claim", reason: "revises [[Parent claim]]" }],
      },
    ];
    const idx = buildInboundIndex(pubs);
    const rev = revisionStatusFor("Parent claim", idx);
    assert.equal(rev.status, "superseded");
    assert.equal(rev.superseded_by.length, 1);
    assert.equal(rev.superseded_by[0].title, "Child correction");
    assert.equal(rev.superseded_by[0].relation, "revised_by");
    assert.equal(revisionStatusFor("Child correction", idx).status, "live");
  });

  it("revisionStatusFor: contradicts beats revises", () => {
    const pubs = [
      { title: "P", path: "Atoms/P.md", links: [] },
      {
        title: "R",
        path: "Atoms/R.md",
        links: [{ note: "P", reason: "revises [[P]]" }],
      },
      {
        title: "X",
        path: "Atoms/X.md",
        links: [{ note: "P", reason: "contradicts [[P]]" }],
      },
    ];
    const rev = revisionStatusFor("P", buildInboundIndex(pubs));
    assert.equal(rev.status, "contradicted");
    assert.equal(rev.contradicted_by[0].relation, "contradicted_by");
  });

  it("live atom always has status live (never omitted)", () => {
    const pubs = [{ title: "Solo", path: "Atoms/S.md", body: "x", links: [] }];
    const hits = buildSearchHits(pubs, "Solo", 8);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].status, "live");
    assert.equal(hits[0].authoritative, false);
    assert.equal(hits[0].snippet_truncated, true);
    assert.ok("status" in hits[0]);
  });

  it("snippets:false omits snippet fields", () => {
    const pubs = [{ title: "Solo", path: "Atoms/S.md", text: "body here", links: [] }];
    const hits = buildSearchHits(pubs, "Solo", 8, { snippets: false });
    assert.equal(hits[0].snippet, undefined);
    assert.equal(hits[0].snippet_truncated, undefined);
    assert.equal(hits[0].authoritative, false);
  });

  it("instructions warn on snippets and status", () => {
    assert.match(ASK_MCP_INSTRUCTIONS, /non-authoritative/);
    assert.match(ASK_MCP_INSTRUCTIONS, /superseded/);
    assert.match(ASK_MCP_INSTRUCTIONS, /mirror_scope/);
    assert.match(ASK_MCP_INSTRUCTIONS, /revision_participant/);
    assert.match(ASK_MCP_INSTRUCTIONS, /confidence/);
    assert.match(ASK_MCP_INSTRUCTIONS, /no confident match/);
    assert.match(ASK_MCP_INSTRUCTIONS, /expand_coverage/);
  });

  it("search hits expose confidence high|medium", () => {
    const pubs = [{ title: "Solo", path: "Atoms/S.md", text: "x", links: [] }];
    const hits = buildSearchHits(pubs, "Solo", 8);
    assert.equal(hits[0].confidence, "high");
  });
});

describe("mcp unmisreadable shape store", () => {
  for (const mode of ["memory", "sqlite"]) {
    describe(mode, () => {
      it("fetch parent: status superseded + superseded_by (Andrew HSM)", async () => {
        await withStore(mode, async (store) => {
          await seedAccount(store, "a@ex.co");
          await seedAndrewPair(store, "a@ex.co");
          const parent = await store.mirrorFetch(
            "a@ex.co",
            "Andrew loves High School Musical",
          );
          assert.ok(parent);
          const graph = await store.mirrorNeighbors("a@ex.co", parent.title);
          const shaped = shapeFetchAtom(parent, graph);
          assert.equal(shaped.status, "superseded");
          assert.equal(shaped.revision_participant, true);
          assert.equal(shaped.authoritative, true);
          assert.ok(
            shaped.synced_at,
            "fetch_atom must expose synced_at for staleness",
          );
          const page = await store.mirrorList("a@ex.co", { limit: 10, offset: 0 });
          assert.ok(page.items.length >= 1);
          assert.ok(
            page.items.every((i) => i.synced_at),
            "list_atoms items need synced_at",
          );
          const st = await store.mirrorStatus("a@ex.co");
          assert.ok(st.updatedAt, "feeds list_atoms last_synced_at");
          assert.equal(st.count, page.total);
          assert.ok(
            shaped.superseded_by.some(
              (s) =>
                s.title ===
                  "Andrew's High School Musical love was actually a joke" &&
                s.relation === "revised_by",
            ),
          );
          const child = await store.mirrorFetch(
            "a@ex.co",
            "Andrew's High School Musical love was actually a joke",
          );
          const childShaped = shapeFetchAtom(
            child,
            await store.mirrorNeighbors("a@ex.co", child.title),
          );
          assert.equal(childShaped.status, "live");
          assert.deepEqual(childShaped.superseded_by, []);
        });
      });

      it("search carries status on superseded row", async () => {
        await withStore(mode, async (store) => {
          await seedAccount(store, "s@ex.co");
          await seedAndrewPair(store, "s@ex.co");
          const { hits } = await store.mirrorSearch("s@ex.co", "Andrew", 10);
          const parent = hits.find(
            (h) => h.title === "Andrew loves High School Musical",
          );
          assert.ok(parent);
          assert.equal(parent.status, "superseded");
          assert.equal(parent.authoritative, false);
          assert.equal(parent.snippet_truncated, true);
          assert.ok(parent.superseded_by?.length >= 1);
        });
      });

      it("fetch Nichita Penfield wait → superseded", async () => {
        await withStore(mode, async (store) => {
          await seedAccount(store, "n@ex.co");
          await seedNichitaPair(store, "n@ex.co");
          const wait = await store.mirrorFetch(
            "n@ex.co",
            "Nichita still waiting on Penfield hospital interview response",
          );
          const shaped = shapeFetchAtom(
            wait,
            await store.mirrorNeighbors("n@ex.co", wait.title),
          );
          assert.equal(shaped.status, "superseded");
          assert.ok(
            shaped.superseded_by.some((s) =>
              s.title.includes("Penfield hospital closed"),
            ),
          );
        });
      });

      it("fetch hub: revision_participant false + related_atoms with status", async () => {
        await withStore(mode, async (store) => {
          await seedAccount(store, "h@ex.co");
          await seedNichitaPair(store, "h@ex.co");
          const hub = await store.mirrorFetch("h@ex.co", "Nichita");
          assert.equal(hub.kind, "hub");
          const shaped = shapeFetchAtom(
            hub,
            await store.mirrorNeighbors("h@ex.co", "Nichita"),
          );
          assert.equal(shaped.kind, "hub");
          assert.equal(shaped.revision_participant, false);
          assert.equal(shaped.status, "live");
          assert.ok(Array.isArray(shaped.related_atoms));
          assert.ok(shaped.related_atoms.length >= 2);
          const wait = shaped.related_atoms.find((a) =>
            a.title.includes("still waiting"),
          );
          assert.ok(wait);
          assert.equal(wait.status, "superseded");
          assert.equal(wait.direction, "in");
        });
      });

      it("neighbors backlinks include status", async () => {
        await withStore(mode, async (store) => {
          await seedAccount(store, "g@ex.co");
          await seedAndrewPair(store, "g@ex.co");
          const n = await store.mirrorNeighbors(
            "g@ex.co",
            "Andrew loves High School Musical",
          );
          assert.equal(n.found, true);
          assert.equal(n.status, "superseded");
          assert.ok(n.backlinks.length >= 1);
          assert.equal(n.backlinks[0].status, "live");
          assert.equal(n.scope_complete, false);
          assert.ok(n.mirror_scope);
        });
      });

      it("live atom with no children always has status live", async () => {
        await withStore(mode, async (store) => {
          await seedAccount(store, "l@ex.co");
          await store.mirrorUpsert("l@ex.co", [
            {
              path: "Atoms/Solo.md",
              title: "Solo live fact",
              body: "untouched",
            },
          ]);
          const atom = await store.mirrorFetch("l@ex.co", "Solo live fact");
          const shaped = shapeFetchAtom(
            atom,
            await store.mirrorNeighbors("l@ex.co", atom.title),
          );
          assert.equal(shaped.status, "live");
          assert.ok(Array.isArray(shaped.superseded_by));
          assert.equal(shaped.superseded_by.length, 0);
        });
      });

      it("RESOURCE constant uses tryatoms.app", () => {
        assert.match(RESOURCE, /plus\.tryatoms\.app/);
        assert.doesNotMatch(RESOURCE, /taihartman\.com/);
      });
    });
  }
});
