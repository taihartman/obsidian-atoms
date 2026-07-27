import { describe, expect, it } from "vitest";
import {
  buildOrbits,
  membershipKeysForAtom,
} from "../src/pipeline/entityOrbitIndex";
import {
  pickPrimaryOrbit,
  siblingsForAtom,
  sortSiblingRows,
} from "../src/pipeline/entityOrbitPolicy";

const atomMd = (title: string, body: string, links: string) => `---
created: 2026-07-10
source: "[[2026-07-10]]"
generated-by: linker
tags: []
---
${body}

${links}
`;

describe("membershipKeysForAtom", () => {
  it("reads link-prose only, not capture body", () => {
    const content = atomMd(
      "Bug spray",
      "Remember [[Camping]] gear",
      "belongs with [[Yosemite packing]].",
    );
    const keys = membershipKeysForAtom(content);
    expect(keys.map((k) => k.toLowerCase())).toContain("yosemite packing");
    expect(keys.map((k) => k.toLowerCase())).not.toContain("camping");
  });

  it("drops junk-reason edges", () => {
    const content = atomMd(
      "X",
      "body",
      "unrelated placeholder ([[Yosemite packing]]).",
    );
    expect(membershipKeysForAtom(content)).toEqual([]);
  });
});

describe("buildOrbits + policy", () => {
  const vault = ["Yosemite packing", "Camping", "Alex", "2026-07-01"];

  const threeYosemite = [
    {
      path: "Atoms/a.md",
      title: "Bug spray",
      content: atomMd("Bug spray", "spray", "belongs with [[Yosemite packing]]."),
      sourceDate: "2026-07-10",
    },
    {
      path: "Atoms/b.md",
      title: "Hat",
      content: atomMd("Hat", "hat", "belongs with [[Yosemite packing]]."),
      sourceDate: "2026-07-11",
    },
    {
      path: "Atoms/c.md",
      title: "Pants",
      content: atomMd("Pants", "pants", "belongs with [[Yosemite packing]]."),
      sourceDate: "2026-07-12",
    },
  ];

  it("surfaces hard hub with ≥3 members", () => {
    const orbits = buildOrbits(threeYosemite, { vaultTitles: vault });
    const y = orbits.find((o) => o.id === "yosemite packing");
    expect(y?.members).toHaveLength(3);
    const primary = pickPrimaryOrbit("Atoms/a.md", orbits);
    expect(primary?.orbit.label).toBe("Yosemite packing");
    expect(primary?.others).toHaveLength(2);
  });

  it("soft Camping only never surfaces", () => {
    const atoms = threeYosemite.map((a, i) => ({
      ...a,
      path: `Atoms/s${i}.md`,
      content: atomMd(a.title, "x", "soft ([[Camping]])."),
    }));
    const orbits = buildOrbits(atoms, { vaultTitles: vault });
    expect(siblingsForAtom(atoms[0]!.path, orbits)).toHaveLength(0);
  });

  it("missing hub title never surfaces", () => {
    const atoms = threeYosemite.map((a) => ({
      ...a,
      content: atomMd(a.title, "x", "belongs with [[Ghost trip]]."),
    }));
    const orbits = buildOrbits(atoms, { vaultTitles: vault });
    expect(orbits.find((o) => o.id === "ghost trip")).toBeUndefined();
  });

  it("peer links between atom titles never form orbits", () => {
    const vault2 = [...vault, "Bug spray", "Hat", "Pants"];
    const peers = [
      {
        path: "Atoms/a.md",
        title: "Bug spray",
        content: atomMd(
          "Bug spray",
          "spray",
          "same person (no person note yet) ([[Hat]]).",
        ),
        sourceDate: "2026-07-10",
      },
      {
        path: "Atoms/b.md",
        title: "Hat",
        content: atomMd(
          "Hat",
          "hat",
          "same person (no person note yet) ([[Bug spray]]).",
        ),
        sourceDate: "2026-07-11",
      },
      {
        path: "Atoms/c.md",
        title: "Pants",
        content: atomMd(
          "Pants",
          "pants",
          "same person (no person note yet) ([[Hat]]).",
        ),
        sourceDate: "2026-07-12",
      },
    ];
    const orbits = buildOrbits(peers, { vaultTitles: vault2 });
    expect(orbits.find((o) => o.id === "hat")).toBeUndefined();
    expect(orbits.find((o) => o.id === "bug spray")).toBeUndefined();
  });

  it("daily basename never surfaces", () => {
    const atoms = threeYosemite.map((a) => ({
      ...a,
      content: atomMd(a.title, "x", "from ([[2026-07-01]])."),
    }));
    const orbits = buildOrbits(atoms, { vaultTitles: vault });
    expect(orbits.find((o) => o.id === "2026-07-01")).toBeUndefined();
  });

  it("person-only orbits suppress Also about", () => {
    const atoms = threeYosemite.map((a) => ({
      ...a,
      content: atomMd(a.title, "x", "about ([[Alex]])."),
    }));
    const orbits = buildOrbits(atoms, { vaultTitles: vault });
    expect(
      siblingsForAtom(atoms[0]!.path, orbits, {
        personHubTitles: ["Alex"],
      }),
    ).toHaveLength(0);
  });

  it("sortSiblingRows by sourceDate desc", () => {
    const rows = sortSiblingRows([
      { path: "a", title: "A", sourceDate: "2026-07-10" },
      { path: "b", title: "B", sourceDate: "2026-07-12" },
    ]);
    expect(rows[0]!.title).toBe("B");
  });
});
