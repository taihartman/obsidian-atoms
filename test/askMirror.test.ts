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

  it("extracts wikilinks and reason prose into links on plan", () => {
    expect(extractWikilinks("see ([[Nichita]]) and [[Foo|bar]]")).toEqual([
      "Nichita",
      "Foo",
    ]);
    const files = [
      {
        path: "Atoms/Peri.md",
        basename: "Peri",
        content: "Nichita likes ( [[Nichita]] ).\n",
      },
      {
        path: "Atoms/Child.md",
        basename: "Child",
        content:
          "---\ntags: []\nparent: \"Parent claim\"\nrelation: contradicts\n---\nIt was a joke.\n\ncontradicts [[Parent claim]].\n",
      },
      {
        path: "Atoms/HSM.md",
        basename: "HSM",
        content:
          "---\ntags: []\n---\nAndrew loves High School Musical named work Andrew is a fan of.\n\ndurable taste fact about [[Andrew]] from this capture.\n",
      },
    ];
    const { atoms } = planAskMirrorUpsert(files, "Atoms", {});
    const peri = atoms.find((a) => a.title === "Peri");
    expect(peri?.links.some((l) => l.note === "Nichita")).toBe(true);
    const child = atoms.find((a) => a.title === "Child");
    expect(child?.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          note: "Parent claim",
          reason: expect.stringContaining("contradicts"),
        }),
      ]),
    );
    const hsm = atoms.find((a) => a.title === "HSM");
    const andrew = hsm?.links.find((l) => l.note === "Andrew");
    expect(andrew?.reason).toMatch(/durable taste/);
    expect(andrew?.reason).not.toMatch(/named work Andrew is a fan/);
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
