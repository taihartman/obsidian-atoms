import { describe, expect, it } from "vitest";
import {
  atomFolderGraphQuery,
  buildClosedNeighborhood,
  collectAtomSeedPaths,
  filterSourceOnlyOutbound,
  parseSourceNoteName,
  toGraphSearchQuery,
} from "../src/graph/atomGraphSet";

const ATOM_FM = (extra = "") =>
  `---\ncreated: 2026-07-01\nsource: "[[2026-07-01]]"\ngenerated-by: linker\ntags: []\n${extra}---\n\nbody\n`;

describe("parseSourceNoteName", () => {
  it("reads source wikilink from frontmatter", () => {
    expect(parseSourceNoteName(ATOM_FM())).toBe("2026-07-01");
  });

  it("returns null without source", () => {
    expect(
      parseSourceNoteName("---\ngenerated-by: linker\n---\n\nx\n"),
    ).toBeNull();
  });
});

describe("filterSourceOnlyOutbound", () => {
  it("drops source target when not in body outbound", () => {
    expect(
      filterSourceOnlyOutbound(
        ["Daily/2026-07-01.md", "People/Alex.md"],
        "Daily/2026-07-01.md",
        ["People/Alex.md"],
      ),
    ).toEqual(["People/Alex.md"]);
  });

  it("keeps source target when also a body link", () => {
    expect(
      filterSourceOnlyOutbound(
        ["Daily/2026-07-01.md"],
        "Daily/2026-07-01.md",
        ["Daily/2026-07-01.md"],
      ),
    ).toEqual(["Daily/2026-07-01.md"]);
  });
});

describe("collectAtomSeedPaths", () => {
  it("keeps generated atoms under folder only", () => {
    const seeds = collectAtomSeedPaths(
      [
        { path: "Atoms/a.md", content: ATOM_FM() },
        { path: "Atoms/manual.md", content: "# no stamp\n" },
        { path: "Other/x.md", content: ATOM_FM() },
      ],
      "Atoms",
    );
    expect(seeds).toEqual(["Atoms/a.md"]);
  });
});

describe("buildClosedNeighborhood", () => {
  it("includes mutual seeds only when linked", () => {
    const S = buildClosedNeighborhood({
      seedPaths: ["Atoms/a.md", "Atoms/b.md"],
      outboundBySeed: {
        "Atoms/a.md": ["Atoms/b.md"],
        "Atoms/b.md": ["Atoms/a.md"],
      },
      bodyOutboundBySeed: {
        "Atoms/a.md": ["Atoms/b.md"],
        "Atoms/b.md": ["Atoms/a.md"],
      },
      sourceTargetBySeed: {},
      inboundBySeed: {},
    });
    expect(S).toEqual(["Atoms/a.md", "Atoms/b.md"]);
  });

  it("includes external hub outbound", () => {
    const S = buildClosedNeighborhood({
      seedPaths: ["Atoms/a.md"],
      outboundBySeed: { "Atoms/a.md": ["People/Alex.md"] },
      bodyOutboundBySeed: { "Atoms/a.md": ["People/Alex.md"] },
      sourceTargetBySeed: {},
      inboundBySeed: {},
    });
    expect(S).toContain("People/Alex.md");
  });

  it("excludes junk-only graph (no seed edge)", () => {
    const S = buildClosedNeighborhood({
      seedPaths: ["Atoms/a.md"],
      outboundBySeed: { "Atoms/a.md": [] },
      bodyOutboundBySeed: { "Atoms/a.md": [] },
      sourceTargetBySeed: {},
      inboundBySeed: { "Atoms/a.md": [] },
    });
    expect(S).toEqual(["Atoms/a.md"]);
    expect(S).not.toContain("Junk/A.md");
  });

  it("demotes source-only daily; keeps body-linked daily", () => {
    const demoted = buildClosedNeighborhood({
      seedPaths: ["Atoms/a.md"],
      outboundBySeed: {
        "Atoms/a.md": ["Daily/2026-07-01.md"],
      },
      bodyOutboundBySeed: { "Atoms/a.md": [] },
      sourceTargetBySeed: { "Atoms/a.md": "Daily/2026-07-01.md" },
      inboundBySeed: {},
    });
    expect(demoted).toEqual(["Atoms/a.md"]);

    const kept = buildClosedNeighborhood({
      seedPaths: ["Atoms/a.md"],
      outboundBySeed: {
        "Atoms/a.md": ["Daily/2026-07-01.md"],
      },
      bodyOutboundBySeed: { "Atoms/a.md": ["Daily/2026-07-01.md"] },
      sourceTargetBySeed: { "Atoms/a.md": "Daily/2026-07-01.md" },
      inboundBySeed: {},
    });
    expect(kept).toContain("Daily/2026-07-01.md");
  });

  it("includes inbound backlinks to seeds", () => {
    const S = buildClosedNeighborhood({
      seedPaths: ["Atoms/a.md"],
      outboundBySeed: { "Atoms/a.md": [] },
      bodyOutboundBySeed: { "Atoms/a.md": [] },
      sourceTargetBySeed: {},
      inboundBySeed: { "Atoms/a.md": ["Notes/hub.md"] },
    });
    expect(S).toContain("Notes/hub.md");
  });
});

describe("toGraphSearchQuery", () => {
  it("exact OR of all paths when small", () => {
    const r = toGraphSearchQuery(
      ["Atoms/a.md", "People/Alex.md"],
      "Atoms",
    );
    expect(r.mode).toBe("exact");
    expect(r.query).toContain('path:"Atoms/a.md"');
    expect(r.query).toContain('path:"People/Alex.md"');
    expect(r.omittedExternal).toBe(0);
  });

  it("caps to folder + some external", () => {
    const paths = [
      "Atoms/a.md",
      ...Array.from({ length: 5 }, (_, i) => `People/n${i}.md`),
    ];
    const r = toGraphSearchQuery(paths, "Atoms", {
      maxChars: 80,
      maxTerms: 3,
    });
    expect(r.mode).toBe("capped");
    expect(r.query).toContain('path:"Atoms"');
    expect(r.omittedExternal).toBeGreaterThan(0);
  });
});

describe("atomFolderGraphQuery", () => {
  it("returns path term for folder", () => {
    expect(atomFolderGraphQuery("Atoms")).toBe('path:"Atoms"');
  });
});
