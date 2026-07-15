import { describe, expect, it } from "vitest";
import {
  extractLinkChips,
  extractSourceDay,
  filterLinkedOnly,
  formatRelativeTime,
  isGeneratedAtomContent,
  listAtomLibraryEntries,
  parseAtomLibraryEntry,
  shouldShowWaitCard,
  titleFromAtomPath,
} from "../src/atomsHomeData";

const atomMd = (opts: {
  title?: string;
  source?: string;
  body: string;
  links?: string;
}) => {
  const title = opts.title ?? "Claim title";
  return `---
created: 2026-07-14
source: "[[${opts.source ?? "2026-07-14"}]]"
generated-by: linker
tags:
  - person
---
${opts.body}${opts.links ? `\n\n${opts.links}` : ""}
`;
};

describe("titleFromAtomPath", () => {
  it("strips folder and extension", () => {
    expect(titleFromAtomPath("Atoms/Nichita prefers.md")).toBe(
      "Nichita prefers",
    );
  });
});

describe("isGeneratedAtomContent", () => {
  it("requires generated-by linker stamp", () => {
    expect(isGeneratedAtomContent(atomMd({ body: "hi" }))).toBe(true);
    expect(
      isGeneratedAtomContent("---\ntags: []\n---\nmanual note\n"),
    ).toBe(false);
  });
});

describe("extractSourceDay / chips", () => {
  it("reads source day from frontmatter", () => {
    expect(extractSourceDay(atomMd({ body: "x", source: "2026-07-14" }))).toBe(
      "2026-07-14",
    );
  });

  it("extracts wikilinks excluding self title", () => {
    const body =
      "Nichita likes teal\n\npreference about [[Nichita]]. Also [[Tin]].";
    expect(extractLinkChips(body, "Nichita prefers teal")).toEqual([
      "Nichita",
      "Tin",
    ]);
    expect(extractLinkChips("see [[Claim title]]", "Claim title")).toEqual([]);
  });
});

describe("listAtomLibraryEntries", () => {
  it("filters folder, generated-by, sorts mtime desc", () => {
    const entries = listAtomLibraryEntries(
      [
        {
          path: "Atoms/Older.md",
          mtime: 100,
          content: atomMd({ title: "Older", body: "a" }),
        },
        {
          path: "Atoms/Newer.md",
          mtime: 200,
          content: atomMd({
            body: "b",
            links: "about [[Nichita]].",
          }),
        },
        {
          path: "Other/Nope.md",
          mtime: 300,
          content: atomMd({ body: "c" }),
        },
        {
          path: "Atoms/Manual.md",
          mtime: 400,
          content: "---\ntags: []\n---\nnot ours\n",
        },
      ],
      "Atoms",
    );
    expect(entries.map((e) => e.title)).toEqual(["Newer", "Older"]);
    expect(entries[0]!.linkChips).toContain("Nichita");
  });

  it("Linked filter keeps only chips", () => {
    const a = parseAtomLibraryEntry(
      "Atoms/A.md",
      atomMd({ body: "x", links: "[[Nichita]]" }),
      1,
    );
    const b = parseAtomLibraryEntry(
      "Atoms/B.md",
      atomMd({ body: "y" }),
      2,
    );
    expect(filterLinkedOnly([a, b]).map((e) => e.title)).toEqual([
      titleFromAtomPath("Atoms/A.md"),
    ]);
  });
});

describe("shouldShowWaitCard / relative time", () => {
  it("wait card only when count > 0", () => {
    expect(shouldShowWaitCard(0)).toBe(false);
    expect(shouldShowWaitCard(3)).toBe(true);
  });

  it("formats relative times", () => {
    const now = 1_000_000_000_000;
    expect(formatRelativeTime(now - 30_000, now)).toBe("now");
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5m");
    expect(formatRelativeTime(now - 3 * 3600_000, now)).toBe("3h");
  });
});
