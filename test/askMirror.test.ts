import { describe, expect, it } from "vitest";
import {
  contentHash,
  extractWikilinks,
  planAskMirrorUpsert,
  splitAtomMarkdown,
} from "../src/platform/askMirror";

describe("askMirror", () => {
  it("splits frontmatter tags and body", () => {
    const { body, tags } = splitAtomMarkdown(
      "---\ntags:\n  - drink\n  - habit\n---\nI prefer tea.\n",
    );
    expect(tags).toEqual(["drink", "habit"]);
    expect(body).toContain("I prefer tea");
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
});
