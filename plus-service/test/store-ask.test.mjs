import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.mjs";
import { pkceChallengeS256 } from "../src/store/askHelpers.mjs";
import {
  decryptMirrorField,
  encryptMirrorField,
} from "../src/mirror/crypto.mjs";

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

function seedAccount(store, email, status = "active") {
  return store.grantPeriod(email, { remaining: 150, status, plan: "monthly" });
}

describe("ask mirror + mcp store", () => {
  for (const mode of ["memory", "sqlite"]) {
    describe(mode, () => {
      it("upsert then fetch verbatim body", async () => {
        await withStore(mode, async (store) => {
          await seedAccount(store, "a@ex.co");
          const body = "I might prefer tea  \n  over coffee.";
          await store.mirrorUpsert("a@ex.co", [
            {
              path: "Atoms/Tea.md",
              title: "Tea preference",
              body,
              tags: ["drink"],
              links: [{ note: "Kitchen", reason: "related to [[Kitchen]]" }],
            },
          ]);
          const got = await store.mirrorFetch("a@ex.co", "Tea preference");
          assert.ok(got);
          assert.equal(got.text, body);
          assert.deepEqual(got.tags, ["drink"]);
          assert.equal(got.links[0].note, "Kitchen");
        });
      });

      it("user A cannot fetch user B path", async () => {
        await withStore(mode, async (store) => {
          await seedAccount(store, "a@ex.co");
          await seedAccount(store, "b@ex.co");
          await store.mirrorUpsert("a@ex.co", [
            { path: "Atoms/Secret.md", title: "Secret", body: "A only" },
          ]);
          assert.equal(await store.mirrorFetch("b@ex.co", "Secret"), null);
          assert.equal(await store.mirrorFetch("b@ex.co", "Atoms/Secret.md"), null);
        });
      });

      it("search ranks title above body-only", async () => {
        await withStore(mode, async (store) => {
          await seedAccount(store, "s@ex.co");
          await store.mirrorUpsert("s@ex.co", [
            {
              path: "Atoms/Other.md",
              title: "Other note",
              body: "mentions zebra in body only",
            },
            {
              path: "Atoms/Zebra.md",
              title: "Zebra habitat",
              body: "something else",
            },
          ]);
          const hits = await store.mirrorSearch("s@ex.co", "zebra", 8);
          assert.ok(hits.length >= 2);
          assert.equal(hits[0].title, "Zebra habitat");
          assert.ok(hits[0].score > hits[1].score);
        });
      });

      it("parses wikilinks into links and neighbors backlinks", async () => {
        await withStore(mode, async (store) => {
          await seedAccount(store, "g@ex.co");
          await store.mirrorUpsert("g@ex.co", [
            {
              path: "Atoms/Peri.md",
              title: "Nichita likes periwinkle",
              body: "Nichita likes the color ([[Nichita]]).",
              links: [],
            },
            {
              path: "Atoms/Other.md",
              title: "Other Nichita note",
              body: "Also about [[Nichita]].",
            },
          ]);
          const atom = await store.mirrorFetch("g@ex.co", "Nichita likes periwinkle");
          assert.ok(atom.links.some((l) => l.note === "Nichita"));
          const n = await store.mirrorNeighbors("g@ex.co", "Nichita");
          assert.equal(n.found, false);
          assert.ok(n.backlinks.length >= 2);
          assert.ok(n.backlinks.every((b) => b.direction === "in"));
        });
      });

      it("tag filter on search", async () => {
        await withStore(mode, async (store) => {
          await seedAccount(store, "t@ex.co");
          await store.mirrorUpsert("t@ex.co", [
            {
              path: "Atoms/A.md",
              title: "Alpha decision",
              body: "x",
              tags: ["decision"],
            },
            {
              path: "Atoms/B.md",
              title: "Alpha person",
              body: "x",
              tags: ["person"],
            },
          ]);
          const hits = await store.mirrorSearch("t@ex.co", "Alpha", 8, {
            tags: ["person"],
          });
          assert.equal(hits.length, 1);
          assert.equal(hits[0].title, "Alpha person");
        });
      });

      it("wipe clears mirror and revokes mcp tokens", async () => {
        await withStore(mode, async (store) => {
          await seedAccount(store, "w@ex.co");
          await store.mirrorUpsert("w@ex.co", [
            { path: "Atoms/X.md", title: "X", body: "gone" },
          ]);
          const tokens = await store.mintMcpTokensForTest(
            "w@ex.co",
            "cli_test",
            RESOURCE,
          );
          assert.ok(await store.accountFromMcpToken(tokens.accessToken));
          await store.mirrorWipe("w@ex.co");
          assert.equal((await store.mirrorStatus("w@ex.co")).count, 0);
          assert.equal(await store.mirrorFetch("w@ex.co", "X"), null);
          assert.equal(await store.accountFromMcpToken(tokens.accessToken), null);
        });
      });

      it("auth code one-time and binds client/redirect", async () => {
        await withStore(mode, async (store) => {
          await seedAccount(store, "o@ex.co");
          const verifier = "verifier-abcdefghijklmnopqrstuvwxyz012345";
          const challenge = pkceChallengeS256(verifier);
          const code = await store.mcpCreateAuthCode({
            email: "o@ex.co",
            clientId: "cli_a",
            redirectUri: "https://claude.ai/api/mcp/auth_callback",
            resource: RESOURCE,
            codeChallenge: challenge,
            codeChallengeMethod: "S256",
            scopes: ["atoms:read"],
          });
          const bad = await store.mcpExchangeCode({
            code,
            codeVerifier: verifier,
            clientId: "cli_wrong",
            redirectUri: "https://claude.ai/api/mcp/auth_callback",
            resource: RESOURCE,
          });
          assert.equal(bad, null);
          const ok = await store.mcpExchangeCode({
            code,
            codeVerifier: verifier,
            clientId: "cli_a",
            redirectUri: "https://claude.ai/api/mcp/auth_callback",
            resource: RESOURCE,
          });
          assert.ok(ok?.accessToken);
          const reuse = await store.mcpExchangeCode({
            code,
            codeVerifier: verifier,
            clientId: "cli_a",
            redirectUri: "https://claude.ai/api/mcp/auth_callback",
            resource: RESOURCE,
          });
          assert.equal(reuse, null);
        });
      });

      it("refresh rotates and invalidates old", async () => {
        await withStore(mode, async (store) => {
          await seedAccount(store, "r@ex.co");
          const t1 = await store.mintMcpTokensForTest("r@ex.co", "c", RESOURCE);
          const t2 = await store.mcpRefreshTokens(t1.refreshToken, {
            clientId: "c",
            resource: RESOURCE,
          });
          assert.ok(t2?.accessToken);
          assert.notEqual(t2.refreshToken, t1.refreshToken);
          assert.equal(
            await store.mcpRefreshTokens(t1.refreshToken, {
              clientId: "c",
              resource: RESOURCE,
            }),
            null,
          );
        });
      });

      it("inactive entitlement cannot use mcp token", async () => {
        await withStore(mode, async (store) => {
          await seedAccount(store, "i@ex.co", "active");
          const t = await store.mintMcpTokensForTest("i@ex.co", "c", RESOURCE);
          const a = await store.getAccount("i@ex.co");
          a.status = "inactive";
          a.remaining = 0;
          if (store.kind === "sqlite") {
            // force persist if sqlite has save
            await store.grantPeriod("i@ex.co", {
              remaining: 0,
              status: "inactive",
              days: 1,
            });
          }
          // memory: mutate in place already; sqlite grantPeriod may set inactive
          const acct = await store.accountFromMcpToken(t.accessToken);
          // after grantPeriod inactive — should be null
          if (store.kind === "memory") {
            assert.equal(acct, null);
          } else {
            assert.equal(
              await store.accountFromMcpToken(t.accessToken),
              null,
            );
          }
        });
      });
    });
  }

  it("crypto roundtrip with key", () => {
    const prev = process.env.ATOMS_ASK_MIRROR_KEY;
    process.env.ATOMS_ASK_MIRROR_KEY = "a".repeat(64);
    try {
      const enc = encryptMirrorField("hello body");
      assert.ok(enc.startsWith("v1:"));
      assert.equal(decryptMirrorField(enc), "hello body");
    } finally {
      if (prev === undefined) delete process.env.ATOMS_ASK_MIRROR_KEY;
      else process.env.ATOMS_ASK_MIRROR_KEY = prev;
    }
  });
});
