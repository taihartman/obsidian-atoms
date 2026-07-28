import { describe, expect, it } from "vitest";
import {
  contentHash,
  extractWikilinks,
  isFlatAtomPath,
  planAskMirrorDeletes,
  planAskMirrorUpsert,
  readAskMirrorHashes,
  splitAtomMarkdown,
  writeAskMirrorHashes,
} from "../src/platform/askMirror";

describe("askMirror", () => {
  it("splits frontmatter tags and body", () => {
    const { body, tags } = splitAtomMarkdown(
      "---\ntags:\n  - drink\n  - habit\n---\nI prefer tea.\n",
    );
    expect(tags).toEqual(["drink", "habit"]);
    expect(body).toContain("I prefer tea");
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
    expect(first.atoms[0].title).toBe("Tea");
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

  it("readAskMirrorHashes prefers localStorage over legacy settings", () => {
    const store: Record<string, string> = {};
    writeAskMirrorHashes((k, v) => {
      store[k] = v;
    }, { "Atoms/A.md": "ls" });
    const hashes = readAskMirrorHashes(
      (k) => store[k],
      { "Atoms/A.md": "settings" },
    );
    expect(hashes).toEqual({ "Atoms/A.md": "ls" });
  });

  it("readAskMirrorHashes migrates from legacy when LS empty", () => {
    const hashes = readAskMirrorHashes(() => null, {
      "Atoms/B.md": "legacy",
    });
    expect(hashes).toEqual({ "Atoms/B.md": "legacy" });
  });
});
