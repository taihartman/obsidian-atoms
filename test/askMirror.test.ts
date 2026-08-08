import { describe, expect, it } from "vitest";
import type {
  ConfirmRequest,
  ConfirmVerdict,
  DeletionConfirmation,
} from "../src/shared/confirm";
import type {
  AskMirrorHost,
  AskMirrorSyncResult,
} from "../src/platform/askMirror";
import {
  ASK_MIRROR_COUNT_UNKNOWN,
  ASK_MIRROR_REFUSAL_ESCALATION_NOTICE,
  MIRROR_HIGHWATER_DECAY_DAYS,
  clearAskMirrorDeviceState,
  formatAskMirrorRefusalLine,
  formatAskMirrorStatusLine,
  mirrorRefusalBody,
  mirrorRefusalTitle,
  mirrorServerTripwireFloor,
  readAskMirrorRefusal,
  readAskMirrorServerCount,
  readMirrorHighWater,
  LS_ASK_MIRROR_HASHES,
  LS_ASK_MIRROR_REFUSAL,
  LS_ASK_MIRROR_SCAN_HIGHWATER,
  LS_ASK_MIRROR_SERVER_COUNT,
  runAskMirrorSync,
  contentHash,
  extractWikilinks,
  isFlatAtomPath,
  planAskMirrorDeletes,
  planAskMirrorUpsert,
  readAskMirrorHashes,
  splitAtomMarkdown,
  stripLegacyAskMirrorHashes,
  writeAskMirrorHashes,
} from "../src/platform/askMirror";

/**
 * Narrow a sync result to its `ok` arm before asserting on counts.
 *
 * `uploaded` and `refusalReason` live only on `ok`; a `failed` result carries a
 * message instead. Reaching for them on the bare union used to be invisible
 * because `tsconfig.json` excluded `test/` — see tsconfig.test.json. Throwing
 * here also turns "the run failed for an unrelated reason" into a legible test
 * failure rather than an `undefined` compared against an expected value.
 */
function okResult(
  r: AskMirrorSyncResult,
): Extract<AskMirrorSyncResult, { kind: "ok" }> {
  if (r.kind !== "ok") {
    throw new Error(`expected an ok sync result, got: ${JSON.stringify(r)}`);
  }
  return r;
}


describe("askMirror", () => {
  it("splits frontmatter tags and body", () => {
    const { body, tags } = splitAtomMarkdown(
      "---\ntags:\n  - drink\n  - habit\n---\nI prefer tea.\n",
    );
    expect(tags).toEqual(["drink", "habit"]);
    expect(body).toContain("I prefer tea");
  });

  it("parses created into mirror payload and hash", () => {
    const { created, body } = splitAtomMarkdown(
      "---\ncreated: 2026-08-01\ntags:\n  - x\n---\nhello\n",
    );
    expect(created).toBe("2026-08-01");
    expect(body).toContain("hello");
    const files = [
      {
        path: "Atoms/Hello.md",
        basename: "Hello.md",
        content: "---\ncreated: 2026-08-01T09:30\ntags:\n  - x\n---\nhello\n",
      },
    ];
    const first = planAskMirrorUpsert(files, "Atoms", {});
    expect(first.atoms).toHaveLength(1);
    expect(first.atoms[0]?.created).toBe("2026-08-01T09:30");
    const again = planAskMirrorUpsert(files, "Atoms", first.nextHashes);
    expect(again.atoms).toHaveLength(0);
  });

  it("recovers reasons from Process-style link prose without atom-links", () => {
    const files = [
      {
        path: "Atoms/Shop.md",
        basename: "Shop",
        content: `---
tags:
  - person
---
We went shopping together.

shopping trip with Nichita ([[Nichita]]). the planned trip happened ([[Plan to shop]]).
`,
      },
    ];
    const { atoms } = planAskMirrorUpsert(files, "Atoms", {});
    const shop = atoms.find((a) => a.title === "Shop");
    expect(shop?.links.find((l) => l.note === "Nichita")?.reason).toMatch(
      /shopping trip with Nichita/,
    );
    expect(shop?.links.find((l) => l.note === "Plan to shop")?.reason).toMatch(
      /planned trip happened/,
    );
  });

  it("Ask outbox markdown mirrors with structured reasons", async () => {
    const { buildAskAtomMarkdown } = await import("../src/platform/askOutbox");
    const { content, title } = buildAskAtomMarkdown({
      title: "Went shopping",
      body: "We went shopping at Aaron's Alley together.",
      links: [
        { note: "Nichita", reason: "shopping trip with Nichita" },
        {
          note: "Plan to shop for rave outfits",
          reason: "the planned trip happened",
        },
      ],
      created: "2026-07-27T10:29:05",
    });
    expect(content).not.toContain("atom-links:");
    const { atoms } = planAskMirrorUpsert(
      [{ path: `Atoms/${title}.md`, basename: title, content }],
      "Atoms",
      {},
    );
    const a = atoms[0]!;
    expect(a.links.find((l) => l.note === "Nichita")?.reason).toMatch(
      /shopping trip/,
    );
    expect(
      a.links.find((l) => l.note === "Plan to shop for rave outfits")?.reason,
    ).toMatch(/planned trip/);
  });

  it("prefers FM atom-links; does not swallow capture as reason", () => {
    expect(extractWikilinks("see ([[Nichita]]) and [[Foo|bar]]")).toEqual([
      "Nichita",
      "Foo",
    ]);
    const files = [
      {
        path: "Atoms/Child.md",
        basename: "Child",
        content: `---
tags: []
parent: "Parent claim"
relation: contradicts
atom-links:
  - note: "Parent claim"
    reason: "contradicts [[Parent claim]]"
---
It was a joke.

[[Parent claim]]
`,
      },
      {
        path: "Atoms/Coco.md",
        basename: "Coco",
        content: `---
tags: []
atom-links:
  - note: "Nichita"
    reason: "shared favorite seasoning (chipotle) for chicken thighs"
---
I love the spice project Coco chipotle seasoning it's delicious
it's mine and Nichita's favorite seasoning for chicken thighs

[[Nichita]]
`,
      },
      {
        path: "Atoms/HSM.md",
        basename: "HSM",
        content: `---
tags: []
---
Andrew loves High School Musical named work Andrew is a fan of.

durable taste fact about [[Andrew]] from this capture.
`,
      },
    ];
    const { atoms } = planAskMirrorUpsert(files, "Atoms", {});
    const child = atoms.find((a) => a.title === "Child");
    expect(child?.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          note: "Parent claim",
          reason: expect.stringContaining("contradicts"),
        }),
      ]),
    );
    const coco = atoms.find((a) => a.title === "Coco");
    const nich = coco?.links.find((l) => l.note === "Nichita");
    expect(nich?.reason).toBe(
      "shared favorite seasoning (chipotle) for chicken thighs",
    );
    expect(nich?.reason).not.toMatch(/I love the spice/);
    const hsm = atoms.find((a) => a.title === "HSM");
    const andrew = hsm?.links.find((l) => l.note === "Andrew");
    // Process-style short one-liner OK; capture paragraph is not the reason
    expect(andrew?.reason ?? "").not.toMatch(/named work Andrew is a fan/);
  });

  it("watch path covers flat atoms and mirrored hubs only", async () => {
    const { isAskMirrorWatchPath } = await import("../src/platform/askMirror");
    expect(isAskMirrorWatchPath("Atoms/Tea.md")).toBe(true);
    expect(isAskMirrorWatchPath("Atoms/sub/nested.md")).toBe(false);
    // Without evidence map: hub-shaped paths allowed (unit allowlist)
    expect(isAskMirrorWatchPath("Personal notes/Social/Nichita.md")).toBe(true);
    expect(isAskMirrorWatchPath("Social/People/Nichita.md")).toBe(true);
    // With evidence map: only hubs this device has mirrored
    const hashes = { "Social/People/Nichita.md": "abc" };
    expect(
      isAskMirrorWatchPath("Social/People/Nichita.md", "Atoms", hashes),
    ).toBe(true);
    expect(isAskMirrorWatchPath("Daily/2026-07-28.md", "Atoms", hashes)).toBe(
      false,
    );
    expect(
      isAskMirrorWatchPath("Personal notes/Social/Other.md", "Atoms", hashes),
    ).toBe(false);
    expect(isAskMirrorWatchPath("not-md.txt")).toBe(false);
    expect(isAskMirrorWatchPath("Atoms/../secret.md")).toBe(false);
    expect(isAskMirrorWatchPath("Social\\evil.md")).toBe(false);
    expect(isAskMirrorWatchPath("a/b/c/d/e.md")).toBe(false); // >4 segments
  });

  it("plans hub notes with kind hub", async () => {
    const { planAskMirrorUpsert, isHubMirrorPath, collectHubLinkTitles } =
      await import("../src/platform/askMirror");
    expect(isHubMirrorPath("Social/People/Nichita.md")).toBe(true);
    expect(isHubMirrorPath("Atoms/Nichita.md")).toBe(false);
    const { atoms } = planAskMirrorUpsert(
      [
        {
          path: "Social/People/Nichita.md",
          basename: "Nichita",
          content: "---\ntags: [person]\n---\n# Nichita\n",
        },
      ],
      "Atoms",
      {},
      { kind: "hub" },
    );
    expect(atoms).toHaveLength(1);
    expect(atoms[0]!.kind).toBe("hub");
    expect(atoms[0]!.title).toBe("Nichita");
    expect(
      collectHubLinkTitles([
        {
          path: "Atoms/A.md",
          title: "A",
          body: "",
          tags: [],
          links: [{ note: "Nichita" }],
        },
      ]),
    ).toEqual(["Nichita"]);
  });

  it("plans only Atoms/ and skips unchanged hash", () => {
    const files = [
      {
        path: "Atoms/Tea.md",
        basename: "Tea",
        content: "---\ntags: [drink]\n---\nbody\n",
      },
      {
        path: "Daily/x.md",
        basename: "x",
        content: "not an atom",
      },
      {
        path: "Atoms/sub/nested.md",
        basename: "nested",
        content: "nested",
      },
    ];
    const first = planAskMirrorUpsert(files, "Atoms", {});
    expect(first.atoms).toHaveLength(1);
    expect(first.atoms[0]?.title).toBe("Tea");
    const h = first.nextHashes["Atoms/Tea.md"];
    expect(h).toBeTruthy();
    const second = planAskMirrorUpsert(files, "Atoms", first.nextHashes);
    expect(second.atoms).toHaveLength(0);
    expect(contentHash(["a", "b"])).not.toBe(contentHash(["a", "c"]));
  });

  it("isFlatAtomPath rejects nested", () => {
    expect(isFlatAtomPath("Atoms", "Atoms/Tea.md")).toBe(true);
    expect(isFlatAtomPath("Atoms", "Atoms/sub/x.md")).toBe(false);
    expect(isFlatAtomPath("Atoms", "Daily/x.md")).toBe(false);
  });

  it("planAskMirrorDeletes prunes missing vault paths", () => {
    const vault = new Set(["Atoms/A.md"]);
    const hashes = { "Atoms/A.md": "h1", "Atoms/B.md": "h2" };
    const { deletePaths, nextHashes } = planAskMirrorDeletes(vault, hashes);
    expect(deletePaths).toEqual(["Atoms/B.md"]);
    expect(nextHashes).toEqual({ "Atoms/A.md": "h1" });
  });

  it("readAskMirrorHashes reads device-local evidence", () => {
    const store: Record<string, string> = {};
    writeAskMirrorHashes((k, v) => {
      store[k] = v;
    }, { "Atoms/A.md": "ls" });
    const hashes = readAskMirrorHashes((k) => store[k]);
    expect(hashes).toEqual({ "Atoms/A.md": "ls" });
  });

  it("readAskMirrorHashes takes device-local storage and nothing else", () => {
    // The data.json route is closed at the source. Omitting a second argument
    // proves nothing — the retired parameter was optional, so a one-argument
    // call compiled and passed against the old module too. Arity is the claim
    // that can actually fail.
    expect(readAskMirrorHashes.length).toBe(1);
    // The same guarantee stated at the type level. NOTE: tsconfig.json
    // excludes test/, so this line is only checked when the test tree is
    // typechecked; the arity assertion above is what `vitest run` enforces.
    // @ts-expect-error — readAskMirrorHashes takes exactly one argument.
    readAskMirrorHashes(() => null, { "Atoms/A.md": "seeded-from-data-json" });
    expect(readAskMirrorHashes(() => null)).toEqual({});
  });

  it("loading settings strips the retired data.json hash map", () => {
    const raw: Record<string, unknown> = {
      askEnabled: true,
      askMirrorHashes: { "Atoms/A.md": "h1" },
    };
    expect(stripLegacyAskMirrorHashes(raw)).toBe(true);
    expect(raw).toEqual({ askEnabled: true });
    // Deletion, not migration: nothing reads the stripped value back as
    // evidence, and a second load has nothing left to strip.
    expect(stripLegacyAskMirrorHashes(raw)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// U1 — mirror deletion is gated on scan completeness (R8)
// ---------------------------------------------------------------------------

type FakeHostOpts = {
  /** How many `Atoms/A{i}.md` paths this device has hash evidence for. */
  evidence: number;
  /** How many of those the vault scan finds. */
  scanned: number;
  serverCount?: number | null;
  verdict?: ConfirmVerdict;
  highWater?: { count: number; setAt: string; lastRefusalAt?: string } | null;
  now?: number;
  /** Fail every delete chunk after this many successful calls. */
  deleteFailsAt?: number;
  /** What the server reports, independent of what this device has stored. */
  statusCount?: number;
  /** `status()` is unreachable — the offline / captive-portal device. */
  statusFails?: boolean;
  /** The user opened the modal and walked away: no verdict, ever. */
  confirmNeverAnswers?: boolean;
  /** How long the gate waits on the modal before treating it as dismissed. */
  confirmTimeoutMs?: number;
};

const NOW = Date.parse("2026-08-01T12:00:00Z");

function atomPath(i: number): string {
  return `Atoms/A${i}.md`;
}

function makeFakeHost(opts: FakeHostOpts) {
  const store: Record<string, string> = {};
  const evidence: Record<string, string> = {};
  for (let i = 0; i < opts.evidence; i++) evidence[atomPath(i)] = `h${i}`;
  store[LS_ASK_MIRROR_HASHES] = JSON.stringify(evidence);
  if (opts.serverCount !== null && opts.serverCount !== undefined) {
    store[LS_ASK_MIRROR_SERVER_COUNT] = String(opts.serverCount);
  }
  if (opts.highWater) {
    store[LS_ASK_MIRROR_SCAN_HIGHWATER] = JSON.stringify(opts.highWater);
  }

  let scanned = opts.scanned;
  let serverCount = opts.serverCount === undefined ? 0 : opts.serverCount;
  const deleted: string[] = [];
  const reconciles: {
    keepPaths: string[];
    done: boolean;
    confirmEmpty: boolean;
    reconcileSessionId?: string;
  }[] = [];
  const confirmRequests: ConfirmRequest[] = [];
  const notices: string[] = [];
  let deleteCalls = 0;
  let statusCalls = 0;

  const host: AskMirrorHost = {
    async scanAtoms() {
      const out = [];
      for (let i = 0; i < scanned; i++) {
        out.push({
          path: atomPath(i),
          basename: `A${i}`,
          content: `---\ntags: []\n---\nbody ${i}\n`,
        });
      }
      return out;
    },
    async resolveHubs() {
      return [];
    },
    load: (k) => store[k],
    save: (k, v) => {
      store[k] = v;
    },
    async upsert(atoms) {
      return { ok: true, upserted: atoms.length };
    },
    async deletePaths(paths) {
      deleteCalls++;
      if (opts.deleteFailsAt != null && deleteCalls > opts.deleteFailsAt) {
        return { ok: false, message: "boom" };
      }
      deleted.push(...paths);
      return { ok: true };
    },
    async reconcile(o) {
      reconciles.push({
        keepPaths: o.keepPaths,
        done: o.done,
        confirmEmpty: o.confirmEmpty,
        ...(o.reconcileSessionId
          ? { reconcileSessionId: o.reconcileSessionId }
          : {}),
      });
      return { ok: true };
    },
    async status() {
      statusCalls++;
      if (opts.statusFails) return { ok: false, message: "offline" };
      return { ok: true, count: opts.statusCount ?? serverCount ?? 0 };
    },
    async confirm(request) {
      confirmRequests.push(request);
      if (opts.confirmNeverAnswers) return new Promise<ConfirmVerdict>(() => {});
      return opts.verdict ?? "dismissed";
    },
    notice: (m) => notices.push(m),
    now: () => opts.now ?? NOW,
    ...(opts.confirmTimeoutMs != null
      ? { confirmTimeoutMs: opts.confirmTimeoutMs }
      : {}),
  };

  return {
    host,
    store,
    deleted,
    reconciles,
    confirmRequests,
    notices,
    statusCalls: () => statusCalls,
    setScanned: (n: number) => {
      scanned = n;
    },
    setServerCount: (n: number | null) => {
      serverCount = n;
    },
    evidencePaths: () =>
      Object.keys(
        JSON.parse(store[LS_ASK_MIRROR_HASHES] || "{}") as Record<
          string,
          string
        >,
      ),
  };
}

describe("askMirror deletion gate (U1)", () => {
  it("3 of 400 atoms present on a delta sync issues zero deletes", async () => {
    const f = makeFakeHost({ evidence: 400, scanned: 3, serverCount: 400 });
    const r = await runAskMirrorSync(f.host, { force: false });
    expect(f.deleted.length).toBe(0);
    expect(r.deleted).toBe(0);
    expect(r.refused).toBe(true);
  });

  it("400 in evidence, 300 in scan, no prior high-water mark → refused", async () => {
    const f = makeFakeHost({
      evidence: 400,
      scanned: 300,
      serverCount: 400,
      highWater: null,
    });
    const r = await runAskMirrorSync(f.host, { force: false });
    expect(f.deleted.length).toBe(0);
    expect(r.refused).toBe(true);
    // The high-water mark must never be seeded from the scan being judged.
    expect(f.store[LS_ASK_MIRROR_SCAN_HIGHWATER]).toBeUndefined();
  });

  it("empty local evidence plans zero deletes and upserts only", async () => {
    const f = makeFakeHost({ evidence: 0, scanned: 300, serverCount: 400 });
    const r = await runAskMirrorSync(f.host, { force: false });
    expect(f.deleted.length).toBe(0);
    expect(r.refused).toBe(false);
    expect(okResult(r).uploaded).toBe(300);
  });

  it("a fresh device with 10 of 400 atoms downloaded cannot force away the other 390", async () => {
    const f = makeFakeHost({
      evidence: 0,
      scanned: 10,
      serverCount: null,
      statusCount: 400,
      verdict: "dismissed",
    });
    // Startup delta pass. Empty evidence plans zero deletes, so the gate is
    // never consulted; the success tail records high-water 10 and server 400.
    const startup = await runAskMirrorSync(f.host, { force: false });
    expect(startup.refused).toBe(false);
    expect(f.store[LS_ASK_MIRROR_SERVER_COUNT]).toBe("400");

    // The user then taps "Sync now". The evidence floor is satisfied —
    // 10 scanned ≥ max(5, ceil(10 × 0.8)) = 8 — so only the server tripwire
    // stands between this half-synced phone and a keepPaths-of-10 reconcile
    // against 400 rows: 390 hard deletes of atoms it had not downloaded yet.
    const forced = await runAskMirrorSync(f.host, { force: true });
    expect(f.reconciles.map((r) => r.keepPaths.length)).toEqual([]);
    expect(forced.refused).toBe(true);
    expect(f.deleted.length).toBe(0);
    // The refusal is routed through the modal, not made silently.
    expect(f.confirmRequests).toEqual([
      {
        kind: "ask-mirror-deletion",
        evidenceCount: 10,
        scannedCount: 10,
        lastKnownServerCount: 400,
        // The dialog must name which threshold refused: here the vault holds
        // far fewer atoms than the cloud, not "fewer than we synced before".
        reason: "server-count-tripwire",
      },
    ]);
  });

  it("the tripwire's release valve: a confirmed prune still reconciles", async () => {
    const f = makeFakeHost({
      evidence: 0,
      scanned: 10,
      serverCount: null,
      statusCount: 400,
      verdict: "confirmed",
    });
    await runAskMirrorSync(f.host, { force: false });
    const forced = await runAskMirrorSync(f.host, { force: true });
    expect(forced.refused).toBe(false);
    expect(f.reconciles).toHaveLength(1);
    expect(f.reconciles[0]!.keepPaths).toHaveLength(10);
    expect(f.reconciles[0]!.confirmEmpty).toBe(false);
  });

  it("a fully-scanned 3-atom vault is not wedged by the absolute floor", async () => {
    const f = makeFakeHost({
      evidence: 3,
      scanned: 3,
      serverCount: 3,
      verdict: "dismissed",
    });
    const r = await runAskMirrorSync(f.host, { force: true });
    // A complete scan of a tiny vault must not need a modal that calls the
    // deletion irreversible: the absolute-5 arm exists to stop rounding from
    // making the floor vacuous, not to demand atoms the vault does not have.
    expect(r.refused).toBe(false);
    expect(f.confirmRequests).toEqual([]);
    expect(f.notices).toEqual([]);
    expect(f.reconciles).toHaveLength(1);
    expect(f.reconciles[0]!.keepPaths).toHaveLength(3);
    expect(f.reconciles[0]!.confirmEmpty).toBe(false);
  });

  it("the clamp does not neuter the floor on a tiny vault that shrank", async () => {
    const f = makeFakeHost({ evidence: 3, scanned: 2, serverCount: 3 });
    const r = await runAskMirrorSync(f.host, { force: false });
    expect(r.refused).toBe(true);
    expect(f.deleted.length).toBe(0);
  });

  it("400 in evidence, 399 in scan → the delete proceeds", async () => {
    const f = makeFakeHost({ evidence: 400, scanned: 399, serverCount: 400 });
    const r = await runAskMirrorSync(f.host, { force: false });
    expect(f.deleted).toEqual([atomPath(399)]);
    expect(r.refused).toBe(false);
  });

  it("empty scan + force + no confirmation → reconcile does not run", async () => {
    const f = makeFakeHost({
      evidence: 400,
      scanned: 0,
      serverCount: 400,
      verdict: "dismissed",
    });
    const r = await runAskMirrorSync(f.host, { force: true });
    expect(f.reconciles).toEqual([]);
    expect(f.deleted.length).toBe(0);
    expect(r.refused).toBe(true);
  });

  it("empty scan + explicit confirmation → reconcile runs with confirmEmpty", async () => {
    const f = makeFakeHost({
      evidence: 400,
      scanned: 0,
      serverCount: 400,
      verdict: "confirmed",
    });
    const r = await runAskMirrorSync(f.host, { force: true });
    expect(r.refused).toBe(false);
    expect(f.reconciles).toHaveLength(1);
    expect(f.reconciles[0]!.keepPaths).toEqual([]);
    expect(f.reconciles[0]!.confirmEmpty).toBe(true);
  });

  it("non-empty scan past the floor + force is refused without confirmation", async () => {
    const f = makeFakeHost({
      evidence: 400,
      scanned: 100,
      serverCount: 400,
      verdict: "declined",
    });
    const r = await runAskMirrorSync(f.host, { force: true });
    expect(r.refused).toBe(true);
    expect(f.reconciles).toEqual([]);
    expect(f.deleted.length).toBe(0);
    // Upserts still ran — a refusal blocks deletion, not the whole pass.
    expect(okResult(r).uploaded).toBe(100);
  });

  it("chunked reconcile stages with confirmEmpty false until the final chunk", async () => {
    const f = makeFakeHost({ evidence: 600, scanned: 600, serverCount: 600 });
    await runAskMirrorSync(f.host, { force: true });
    expect(f.reconciles).toHaveLength(2);
    // Service defers every delete to the commit chunk (10-min sliding TTL),
    // so only the final chunk's confirmEmpty is ever read.
    expect(f.reconciles[0]!.done).toBe(false);
    expect(f.reconciles[0]!.confirmEmpty).toBe(false);
    expect(f.reconciles[1]!.done).toBe(true);
    expect(f.reconciles[1]!.confirmEmpty).toBe(false);
    expect(f.reconciles[0]!.reconcileSessionId).toBe(
      f.reconciles[1]!.reconcileSessionId,
    );
  });

  it("no prior server count refuses, then records the count and recovers", async () => {
    const f = makeFakeHost({
      evidence: 400,
      scanned: 399,
      serverCount: null,
      statusCount: 400,
    });
    const first = await runAskMirrorSync(f.host, { force: false });
    expect(first.refused).toBe(true);
    expect(f.deleted.length).toBe(0);
    // The refused pass still refreshes the count, so the device is not stuck
    // refusing forever after a first sync it could not evaluate.
    expect(f.store[LS_ASK_MIRROR_SERVER_COUNT]).toBe("400");
    const second = await runAskMirrorSync(f.host, { force: false });
    expect(second.refused).toBe(false);
    expect(f.deleted).toEqual([atomPath(399)]);
  });

  it("ratchet: shrinking passes are refused once cumulative shrinkage crosses the floor", async () => {
    const f = makeFakeHost({ evidence: 400, scanned: 350, serverCount: 400 });
    const p1 = await runAskMirrorSync(f.host, { force: false });
    expect(p1.refused).toBe(false);
    expect(p1.deleted).toBe(50);

    f.setScanned(330);
    const p2 = await runAskMirrorSync(f.host, { force: false });
    expect(p2.refused).toBe(false);
    expect(p2.deleted).toBe(20);

    f.setScanned(300);
    const p3 = await runAskMirrorSync(f.host, { force: false });
    // Measured against the pre-shrinkage baseline, not the freshly lowered one.
    expect(p3.refused).toBe(true);
    expect(f.evidencePaths()).toHaveLength(330);
  });

  it("a delete failing mid-loop leaves the rest in evidence for the next pass", async () => {
    const f = makeFakeHost({
      evidence: 1000,
      scanned: 850,
      serverCount: 1000,
      deleteFailsAt: 1,
    });
    const r = await runAskMirrorSync(f.host, { force: false });
    expect(r.kind).toBe("failed");
    const evidence = f.evidencePaths();
    expect(evidence).not.toContain(atomPath(850));
    expect(evidence).toContain(atomPath(950));
  });

  it("the guard refuses without a token, and the module exports no way to mint one", async () => {
    const mod = await import("../src/platform/askMirror");
    expect(
      mod.decideMirrorDeletion({
        scannedCount: 3,
        survivingEvidenceCount: 3,
        evidenceCount: 400,
        highWaterCount: 0,
        lastKnownServerCount: 400,
      }),
    ).toEqual({ allowed: false, reason: "scan-incomplete", floor: 320 });
    // The token is nominal (a `unique symbol` brand declared in
    // shared/confirm.ts), so TypeScript forbids forging one. Stated at the
    // type level rather than implied — same caveat as the arity assertion
    // above: tsconfig.json excludes test/, so this line only bites when the
    // test tree is typechecked.
    // @ts-expect-error — an object literal cannot supply the unique-symbol brand.
    const forged: DeletionConfirmation = {
      confirmEmpty: true,
      scannedCount: 400,
      evidenceCount: 400,
    };
    void forged;
    // At runtime the module exports nothing that could construct or return one.
    expect(
      Object.keys(mod).filter((k) => /confirm(ation)?$/i.test(k)),
    ).toEqual([]);
    expect(
      Object.entries(mod).filter(
        ([k, v]) => typeof v === "function" && /confirm/i.test(k),
      ),
    ).toEqual([]);
  });

  it("status line includes Plus email on happy and error paths", () => {
    expect(
      formatAskMirrorStatusLine({
        serverCount: "56",
        email: "a@ex.co",
        relativeLastOk: "1h ago",
      }),
    ).toBe("Ask mirror: 56 · as a@ex.co · last pushed 1h ago");
    expect(
      formatAskMirrorStatusLine({
        serverCount: "56",
        email: "a@ex.co",
        relativeLastOk: "never",
        lastErr: "network",
      }),
    ).toBe(
      "Ask mirror: 56 · as a@ex.co · push failed — network · Sync now to retry",
    );
    expect(
      formatAskMirrorStatusLine({
        serverCount: "10",
        email: "a@ex.co",
        relativeLastOk: "never",
        refused: true,
      }),
    ).toBe(
      "Ask mirror: 10 · as a@ex.co · sync refused — vault scan incomplete · Sync now to retry",
    );
  });

  /**
   * #374 — the line is read on the consent surface itself, so a mirror the gate has closed may
   * not describe itself as one that pushed, failed, or wants retrying. Each case asserts the
   * whole string: the defect was never a missing word, it was three true-looking clauses about
   * a mirror that is not running.
   */
  it("says the mirror is off, and why, once the gate has closed it", () => {
    const gated = {
      serverCount: "407",
      email: "a@ex.co",
      relativeLastOk: "1h ago",
      lastErr: "Plus network error",
    };
    expect(formatAskMirrorStatusLine({ ...gated, off: "no-ack" })).toBe(
      "Ask mirror: off · no current privacy acknowledgment · 407 in the cloud at last check, Wipe cloud copy to delete",
    );
    expect(formatAskMirrorStatusLine({ ...gated, off: "stale-ack" })).toBe(
      "Ask mirror: off · privacy acknowledgment out of date, Review to resume · 407 in the cloud at last check, Wipe cloud copy to delete",
    );
    expect(formatAskMirrorStatusLine({ ...gated, off: "disabled" })).toBe(
      "Ask mirror: off · 407 in the cloud at last check, Wipe cloud copy to delete",
    );
  });

  /**
   * A refusal outranks a push error, and the closed gate outranks both: consent withdrawn after
   * a sync refusal is a reachable state, and it may not surface `Sync now to retry` either.
   */
  it("outranks a refusal, not just a push error", () => {
    expect(
      formatAskMirrorStatusLine({
        serverCount: "10",
        email: "a@ex.co",
        relativeLastOk: "never",
        refused: true,
        off: "no-ack",
      }),
    ).toBe(
      "Ask mirror: off · no current privacy acknowledgment · 10 in the cloud at last check, Wipe cloud copy to delete",
    );
  });

  /**
   * A wipe clears the count rather than zeroing it, so the off line must not turn that absence
   * into a claim about a cloud copy that is gone.
   */
  it("omits the cloud clause when there is no cloud copy to point at", () => {
    const off = { email: "a@ex.co", relativeLastOk: "never", off: "disabled" } as const;
    // No count on record at all.
    expect(
      formatAskMirrorStatusLine({ ...off, serverCount: ASK_MIRROR_COUNT_UNKNOWN }),
    ).toBe("Ask mirror: off");
    // A recorded zero is an empty cloud, so a Wipe call to action would be an instruction to
    // delete nothing.
    expect(formatAskMirrorStatusLine({ ...off, serverCount: "0" })).toBe(
      "Ask mirror: off",
    );
    // A value `data.json` should not have held degrades to silence, never to a sentence.
    expect(formatAskMirrorStatusLine({ ...off, serverCount: "lots" })).toBe(
      "Ask mirror: off",
    );
  });

  it("a refusal renders the literal status line and clears on the next clean pass", async () => {
    expect(formatAskMirrorRefusalLine("400")).toBe(
      "Ask mirror: 400 · sync refused — vault scan incomplete · Sync now to retry",
    );
    const f = makeFakeHost({ evidence: 400, scanned: 3, serverCount: 400 });
    await runAskMirrorSync(f.host, { force: false });
    expect(readAskMirrorRefusal((k) => f.store[k]).count).toBe(1);
    f.setScanned(400);
    await runAskMirrorSync(f.host, { force: false });
    expect(readAskMirrorRefusal((k) => f.store[k]).count).toBe(0);
  });

  it("three consecutive refusals raise the escalation notice exactly once", async () => {
    const f = makeFakeHost({ evidence: 400, scanned: 3, serverCount: 400 });
    await runAskMirrorSync(f.host, { force: false });
    await runAskMirrorSync(f.host, { force: false });
    expect(f.notices).toEqual([]);
    await runAskMirrorSync(f.host, { force: false });
    expect(f.notices).toEqual([ASK_MIRROR_REFUSAL_ESCALATION_NOTICE]);
    await runAskMirrorSync(f.host, { force: false });
    expect(f.notices).toHaveLength(1);
    // A pass that clears the floor resets the streak.
    f.setScanned(400);
    await runAskMirrorSync(f.host, { force: false });
    expect(readAskMirrorRefusal((k) => f.store[k])).toEqual({
      count: 0,
      noticed: false,
    });
  });

  it("a refused reconcile asks the host with the concrete counts", async () => {
    const declined = makeFakeHost({
      evidence: 400,
      scanned: 3,
      serverCount: 412,
      verdict: "declined",
    });
    await runAskMirrorSync(declined.host, { force: true });
    expect(declined.confirmRequests).toEqual([
      {
        kind: "ask-mirror-deletion",
        evidenceCount: 400,
        scannedCount: 3,
        lastKnownServerCount: 412,
        reason: "scan-incomplete",
      },
    ]);
    expect(declined.reconciles).toEqual([]);
    expect(declined.deleted.length).toBe(0);

    const dismissed = makeFakeHost({
      evidence: 400,
      scanned: 3,
      serverCount: 412,
      verdict: "dismissed",
    });
    await runAskMirrorSync(dismissed.host, { force: true });
    expect(dismissed.reconciles).toEqual([]);
    expect(dismissed.deleted.length).toBe(0);

    const confirmed = makeFakeHost({
      evidence: 400,
      scanned: 3,
      serverCount: 412,
      verdict: "confirmed",
    });
    const r = await runAskMirrorSync(confirmed.host, { force: true });
    expect(r.refused).toBe(false);
    expect(confirmed.reconciles).toHaveLength(1);
    expect(confirmed.reconciles[0]!.confirmEmpty).toBe(false);
  });

  it("only a confirmed reconcile lowers the high-water mark", async () => {
    const refused = makeFakeHost({
      evidence: 400,
      scanned: 3,
      serverCount: 400,
      highWater: { count: 400, setAt: new Date(NOW).toISOString() },
      verdict: "declined",
    });
    await runAskMirrorSync(refused.host, { force: true });
    expect(
      readMirrorHighWater((k) => refused.store[k])?.count,
    ).toBe(400);

    const confirmed = makeFakeHost({
      evidence: 400,
      scanned: 3,
      serverCount: 400,
      highWater: { count: 400, setAt: new Date(NOW).toISOString() },
      verdict: "confirmed",
    });
    await runAskMirrorSync(confirmed.host, { force: true });
    expect(readMirrorHighWater((k) => confirmed.store[k])?.count).toBe(3);
  });

  it("the high-water mark decays after 30 refusal-free days", async () => {
    const stale = new Date(
      NOW - (MIRROR_HIGHWATER_DECAY_DAYS + 1) * 86400000,
    ).toISOString();
    const f = makeFakeHost({
      evidence: 300,
      scanned: 300,
      serverCount: 300,
      highWater: { count: 400, setAt: stale },
    });
    const r = await runAskMirrorSync(f.host, { force: true });
    expect(r.refused).toBe(false);
    expect(f.reconciles).toHaveLength(1);

    // Same shape, mark still fresh → the floor of 320 still refuses 300.
    const fresh = makeFakeHost({
      evidence: 300,
      scanned: 300,
      serverCount: 300,
      highWater: { count: 400, setAt: new Date(NOW).toISOString() },
      verdict: "dismissed",
    });
    expect((await runAskMirrorSync(fresh.host, { force: true })).refused).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Four-lens review — the fail-open paths that delete user data.
// ---------------------------------------------------------------------------

describe("askMirror gate — fail-open paths (review)", () => {
  it("a stored server count of 0, negative, or fractional is not a known count", () => {
    const read = (v: unknown) => readAskMirrorServerCount(() => v);
    // A count is a cardinality of rows. Zero is what the Wipe button and a
    // 2xx-with-no-body both write, and it silently zeroed *both* arms of the
    // gate; a negative one made the tripwire `-0`, which nothing is below.
    expect(read("0")).toBeNull();
    expect(read("-1")).toBeNull();
    expect(read("3.5")).toBeNull();
    expect(read("not a number")).toBeNull();
    expect(read("")).toBeNull();
    expect(read(null)).toBeNull();
    expect(read("400")).toBe(400);
  });

  it("the tripwire floor never returns -0, which no scan is below", () => {
    expect(mirrorServerTripwireFloor(-1)).toBe(0);
    expect(mirrorServerTripwireFloor(400)).toBe(320);
  });

  it('a stored server count of "0" cannot collapse both arms of the gate', async () => {
    // The Wipe button wrote "0" literally while clearing hashes and the mark,
    // so every threshold in the gate evaluated to 0 and a half-synced vault
    // reconciled the cloud away with no modal at all.
    const f = makeFakeHost({
      evidence: 0,
      scanned: 3,
      serverCount: 0,
      statusCount: 400,
      verdict: "dismissed",
    });
    const r = await runAskMirrorSync(f.host, { force: true });
    expect(f.reconciles).toEqual([]);
    expect(f.deleted.length).toBe(0);
    expect(r.refused).toBe(true);
  });

  it("clearing device state leaves no count behind that reads as authoritative", () => {
    const store: Record<string, string> = {};
    clearAskMirrorDeviceState((k, v) => {
      store[k] = v;
    });
    expect(readAskMirrorServerCount((k) => store[k])).toBeNull();
    expect(readAskMirrorRefusal((k) => store[k])).toEqual({
      count: 0,
      noticed: false,
    });
    expect(store[LS_ASK_MIRROR_HASHES]).toBe("{}");
    expect(store[LS_ASK_MIRROR_SCAN_HIGHWATER]).toBe("");
    expect(store[LS_ASK_MIRROR_REFUSAL]).toBe("");
  });

  it("the modal decides against a fresh server count, never the stale one", async () => {
    // This device last synced when the cloud held 5 rows. Another device has
    // since pushed 395 more. Deciding — and asking — against the stored 5 lets
    // the user read "5 rows, I have 3, fine" and authorise 397 hard deletes.
    const f = makeFakeHost({
      evidence: 5,
      scanned: 3,
      serverCount: 5,
      highWater: { count: 5, setAt: new Date(NOW).toISOString() },
      statusCount: 400,
      verdict: "declined",
    });
    const r = await runAskMirrorSync(f.host, { force: true });
    expect(f.confirmRequests).toHaveLength(1);
    expect(f.confirmRequests[0]!.lastKnownServerCount).toBe(400);
    expect(r.refused).toBe(true);
    expect(f.reconciles).toEqual([]);
  });

  it("a status() that cannot be reached fails closed without asking", async () => {
    // Never fall back to the stale value, and never pose an irreversible
    // question the answer to which cannot be informed.
    const f = makeFakeHost({
      evidence: 400,
      scanned: 3,
      serverCount: 400,
      statusFails: true,
      verdict: "confirmed",
    });
    const r = await runAskMirrorSync(f.host, { force: true });
    expect(f.confirmRequests).toEqual([]);
    expect(f.reconciles).toEqual([]);
    expect(r.refused).toBe(true);
    expect(okResult(r).refusalReason).toBe("no-server-count");
  });

  it("a corrupt high-water mark fails closed instead of disabling the ratchet", async () => {
    // Losing the mark drops the baseline to the already-shrunken evidence, so
    // each pass re-bases on the last one and the ratchet the test above proves
    // simply stops existing.
    const f = makeFakeHost({ evidence: 400, scanned: 350, serverCount: 400 });
    f.store[LS_ASK_MIRROR_SCAN_HIGHWATER] = "{not json";
    const r = await runAskMirrorSync(f.host, { force: false });
    expect(r.refused).toBe(true);
    expect(okResult(r).refusalReason).toBe("baseline-unreadable");
    expect(f.deleted.length).toBe(0);
  });

  it("an absent high-water mark is still absence, not corruption", async () => {
    const f = makeFakeHost({
      evidence: 400,
      scanned: 350,
      serverCount: 400,
      highWater: null,
    });
    const r = await runAskMirrorSync(f.host, { force: false });
    expect(r.refused).toBe(false);
    expect(r.deleted).toBe(50);
  });
});

describe("askMirror confirmation (review)", () => {
  it("the request names which threshold refused", async () => {
    const f = makeFakeHost({
      evidence: 0,
      scanned: 10,
      serverCount: null,
      statusCount: 400,
      verdict: "declined",
    });
    await runAskMirrorSync(f.host, { force: true });
    expect(f.confirmRequests[0]!.reason).toBe("server-count-tripwire");
  });

  it("the modal's copy is true for every refusal reason", () => {
    // The dialog authorising an irreversible delete hard-coded "vault scan
    // looks incomplete" for all three reasons — untrue for two of them.
    expect(mirrorRefusalTitle("scan-incomplete")).toMatch(/scan/i);
    expect(mirrorRefusalBody("scan-incomplete")).toMatch(/fewer atoms than/i);

    expect(mirrorRefusalTitle("no-server-count")).not.toMatch(/scan/i);
    expect(mirrorRefusalBody("no-server-count")).toMatch(/cloud count/i);
    expect(mirrorRefusalBody("no-server-count")).not.toMatch(/synced before/i);

    expect(mirrorRefusalTitle("server-count-tripwire")).not.toMatch(/scan/i);
    expect(mirrorRefusalBody("server-count-tripwire")).toMatch(
      /far fewer atoms than the cloud/i,
    );

    expect(mirrorRefusalBody("baseline-unreadable")).toMatch(/baseline/i);
  });

  it("a first forced sync against an empty cloud raises no delete modal", async () => {
    // Enable Ask, tap "Sync now" before any background pass stored a count.
    // Nothing can be deleted from an empty cloud, so an irreversible-delete
    // dialog plus a red refusal banner is pure misinformation.
    const f = makeFakeHost({
      evidence: 0,
      scanned: 50,
      serverCount: null,
      statusCount: 0,
      verdict: "dismissed",
    });
    const r = await runAskMirrorSync(f.host, { force: true });
    expect(f.confirmRequests).toEqual([]);
    expect(r.refused).toBe(false);
    expect(f.reconciles).toHaveLength(1);
    expect(f.reconciles[0]!.keepPaths).toHaveLength(50);
  });

  it(
    "a modal left open does not park the sync forever",
    async () => {
      // Backgrounding the app on mobile is the ordinary case. Awaiting a
      // verdict that never comes holds the single-flight lock for the app's
      // lifetime: every later sync returns `joined`, every Ask write stalls.
      const f = makeFakeHost({
        evidence: 400,
        scanned: 3,
        serverCount: 400,
        confirmNeverAnswers: true,
        confirmTimeoutMs: 5,
      });
      const r = await runAskMirrorSync(f.host, { force: true });
      expect(r.refused).toBe(true);
      expect(f.reconciles).toEqual([]);
      expect(f.deleted.length).toBe(0);
    },
    2000,
  );

  it("two devices reconciling in the same millisecond do not share a session", async () => {
    // The server keys staging sets per account, not per device: a collision
    // lets whichever commits first delete what the other had not yet staged.
    const opts = { evidence: 600, scanned: 600, serverCount: 600, now: NOW };
    const a = makeFakeHost(opts);
    const b = makeFakeHost(opts);
    await runAskMirrorSync(a.host, { force: true });
    await runAskMirrorSync(b.host, { force: true });
    const idA = a.reconciles[0]!.reconcileSessionId!;
    const idB = b.reconciles[0]!.reconcileSessionId!;
    expect(idA).not.toBe(idB);
    expect(idA.length).toBeLessThanOrEqual(80);
    // Still one session across the chunks of a single run.
    expect(a.reconciles[1]!.reconcileSessionId).toBe(idA);
  });

  it("a pass that proves nothing does not reset the refusal streak", async () => {
    const f = makeFakeHost({
      evidence: 400,
      scanned: 3,
      serverCount: 400,
      highWater: { count: 400, setAt: new Date(NOW).toISOString() },
    });
    await runAskMirrorSync(f.host, { force: false });
    await runAskMirrorSync(f.host, { force: false });
    expect(readAskMirrorRefusal((k) => f.store[k]).count).toBe(2);
    // Evidence gone, so this pass plans no deletes and never consults the
    // gate. It is still the same 3-of-400 vault; it has cleared nothing.
    f.store[LS_ASK_MIRROR_HASHES] = "{}";
    await runAskMirrorSync(f.host, { force: false });
    expect(readAskMirrorRefusal((k) => f.store[k]).count).toBe(2);
  });
});
