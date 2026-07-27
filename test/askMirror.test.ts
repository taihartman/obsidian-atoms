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

  it("extracts wikilinks into links on plan", () => {
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
    ];
    const { atoms } = planAskMirrorUpsert(files, "Atoms", {});
    expect(atoms[0].links).toEqual([{ note: "Nichita" }]);
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
