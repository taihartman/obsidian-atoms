import { describe, expect, it } from "vitest";
import {
  collectHubAssociationInvites,
  hubAssociationInviteCopy,
  pickHomeHubInvite,
  isNamedListHubTitle,
  pairingId,
  pickListNamedHub,
  seedHubListMarkdown,
} from "../src/pipeline/hubInvite";
import { collectEntityInvites } from "../src/pipeline/entityInvite";
import { shouldWriteNonPersonHub } from "../src/pipeline/hubQualify";
import { applyHardLinkToAtomContent } from "../src/pipeline/personInvite";

const atom = (path: string, title: string, body: string, extraFm = "") => ({
  path,
  title,
  content: `---
generated-by: linker
${extraFm}---
${body}
`,
});

describe("isNamedListHubTitle", () => {
  it("matches Show list, Movie list, Watch list spellings", () => {
    expect(isNamedListHubTitle("Show list")).toBe(true);
    expect(isNamedListHubTitle("shows")).toBe(true);
    expect(isNamedListHubTitle("Movie list")).toBe(true);
    expect(isNamedListHubTitle("Watch list")).toBe(true);
    expect(isNamedListHubTitle("Nichita")).toBe(false);
    expect(isNamedListHubTitle("Camping")).toBe(false);
  });
});

describe("pickListNamedHub", () => {
  it("picks headingless Show list for anime", () => {
    expect(
      pickListNamedHub("I want to watch the anime psycho pass", [
        "Movie list",
        "Show list",
      ]),
    ).toBe("Show list");
  });

  it("trims trailing-space titles", () => {
    expect(
      pickListNamedHub("I want to watch the anime psycho pass", [
        "Show list ",
      ]),
    ).toBe("Show list ");
  });

  it("picks Movie list for movie cues when both exist", () => {
    expect(
      pickListNamedHub("want to watch the new Dune movie", [
        "Movie list",
        "Show list",
      ]),
    ).toBe("Movie list");
  });

  it("fails closed when two list notes and no cue", () => {
    expect(
      pickListNamedHub("remember to file this later", [
        "Movie list",
        "Show list",
      ]),
    ).toBeNull();
  });

  it("does not dump every list-shaped capture onto the only Show list", () => {
    expect(pickListNamedHub("want to watch Dune", ["Show list"])).toBeNull();
    expect(
      pickListNamedHub("pack bug spray for Yosemite packing", ["Show list"]),
    ).toBeNull();
  });

  it("still matches a lone Show list when the capture is a show", () => {
    expect(
      pickListNamedHub("I want to watch the anime psycho pass", ["Show list"]),
    ).toBe("Show list");
  });

  it("matches a lone Movies note for a movie cue", () => {
    expect(pickListNamedHub("want to watch the new Dune movie", ["Movies"])).toBe(
      "Movies",
    );
  });

  it("does not invite leftover Dune onto Movies", () => {
    expect(pickListNamedHub("want to watch Dune", ["Movies"])).toBeNull();
    expect(
      pickListNamedHub("want to watch Dune", ["Movie list", "Show list"]),
    ).toBeNull();
  });

  it("does not put apricot or Demon Slayer-before-the-movie on Movie list", () => {
    expect(
      pickListNamedHub(
        "Andrew wants some dried apricot for the movie",
        ["Movie list", "Show list"],
      ),
    ).toBeNull();
    expect(
      pickListNamedHub(
        "I need to watch Demon slayer to watch the movie with Christian and Luke",
        ["Movie list", "Show list"],
      ),
    ).not.toBe("Movie list");
  });
});

describe("collectHubAssociationInvites", () => {
  it("invites Add to Show list for a headingless existing note", () => {
    const invites = collectHubAssociationInvites({
      atoms: [
        atom(
          "Atoms/Want to watch anime Psycho-Pass.md",
          "Want to watch anime Psycho-Pass",
          "I want to watch the anime psycho pass",
        ),
      ],
      vaultTitles: ["Show list", "Movie list", "Nichita"],
      personHubTitles: ["Nichita"],
    });
    const list = invites.find((i) => i.kind === "list");
    expect(list?.label).toBe("Show list");
    expect(list?.existingNote).toBe(true);
    expect(list?.memberPaths).toEqual([
      "Atoms/Want to watch anime Psycho-Pass.md",
    ]);
  });

  it("does not invite a list pairing once hard-linked", () => {
    const invites = collectHubAssociationInvites({
      atoms: [
        atom(
          "Atoms/Want to watch anime Psycho-Pass.md",
          "Want to watch anime Psycho-Pass",
          "I want to watch the anime psycho pass\n\n- belongs with [[Show list]]",
        ),
      ],
      vaultTitles: ["Show list"],
      personHubTitles: [],
    });
    expect(invites.filter((i) => i.kind === "list")).toHaveLength(0);
  });

  it("create-beat when no list note exists", () => {
    const invites = collectHubAssociationInvites({
      atoms: [
        atom(
          "Atoms/a.md",
          "Bug spray",
          "pack bug spray for Yosemite packing",
        ),
      ],
      vaultTitles: ["Camping"],
      personHubTitles: [],
    });
    const list = invites.find((i) => i.kind === "list");
    expect(list?.existingNote).toBe(false);
    expect(list?.label.toLowerCase()).toContain("yosemite");
  });

  it("add-beat when vault already has the packing title", () => {
    const invites = collectHubAssociationInvites({
      atoms: [
        atom(
          "Atoms/a.md",
          "Bug spray",
          "pack bug spray for Yosemite packing",
        ),
      ],
      vaultTitles: ["Yosemite packing"],
      personHubTitles: [],
    });
    const list = invites.find((i) => i.kind === "list");
    expect(list?.existingNote).toBe(true);
    expect(list?.label.toLowerCase()).toBe("yosemite packing");
  });

  it("ranks person before list", () => {
    const invites = collectHubAssociationInvites({
      atoms: [
        atom(
          "Atoms/a.md",
          "Nichita loves Gingerale",
          "Nichita loves Gingerale",
        ),
        atom(
          "Atoms/b.md",
          "Want to watch anime Psycho-Pass",
          "I want to watch the anime psycho pass",
        ),
      ],
      vaultTitles: ["Show list"],
      personHubTitles: [],
    });
    expect(invites[0]?.kind).toBe("person");
  });

  it("omits a snoozed pairing", () => {
    const invites = collectHubAssociationInvites({
      atoms: [
        atom(
          "Atoms/b.md",
          "Want to watch anime Psycho-Pass",
          "I want to watch the anime psycho pass",
        ),
      ],
      vaultTitles: ["Show list"],
      personHubTitles: [],
      snoozedIds: [pairingId("list", "Show list")],
    });
    expect(invites.filter((i) => i.kind === "list")).toHaveLength(0);
  });

  it("does not invite from a soft key alone", () => {
    const invites = collectHubAssociationInvites({
      atoms: [
        atom("Atoms/a.md", "Want to watch Dune", "want to watch Dune"),
      ],
      vaultTitles: [],
      personHubTitles: [],
    });
    expect(invites.filter((i) => i.kind === "list")).toHaveLength(0);
  });

  it("invites existing Movies.md even though movies is a soft key", () => {
    const invites = collectHubAssociationInvites({
      atoms: [
        atom("Atoms/a.md", "Want to watch Dune", "want to watch the Dune movie"),
      ],
      vaultTitles: ["Movies"],
      personHubTitles: [],
    });
    const list = invites.find((i) => i.kind === "list");
    expect(list?.label).toBe("Movies");
    expect(list?.existingNote).toBe(true);
  });

  it("omits list-kind invites when hub projection is off", () => {
    const invites = collectHubAssociationInvites({
      atoms: [
        atom(
          "Atoms/Want to watch anime Psycho-Pass.md",
          "Want to watch anime Psycho-Pass",
          "I want to watch the anime psycho pass",
        ),
        atom(
          "Atoms/a.md",
          "Bug spray",
          "pack bug spray for Yosemite packing",
        ),
        atom(
          "Atoms/n.md",
          "Nichita loves Gingerale",
          "Nichita loves Gingerale",
        ),
      ],
      vaultTitles: ["Show list", "Camping"],
      personHubTitles: [],
      enableHubProjection: false,
    });
    expect(invites.filter((i) => i.kind === "list")).toHaveLength(0);
    expect(invites.filter((i) => i.kind === "person")).toHaveLength(1);
  });
});

describe("hubAssociationInviteCopy", () => {
  it("names the existing list note", () => {
    const c = hubAssociationInviteCopy({
      kind: "list",
      label: "Show list",
      memberCount: 1,
      existingNote: true,
    });
    expect(c.title).toBe("Add to Show list?");
    expect(c.createLabel).toBe("Add to Show list");
    expect(c.alreadyLabel).toBe("Choose different note…");
    expect(c.dismissLabel).toBe("Not now");
    expect(`${c.title}${c.body}${c.createLabel}`).not.toMatch(
      /projection|regen|managed block|qualifying/i,
    );
    expect(c.body).not.toMatch(/—/);
  });

  it("create-beat names the new hub", () => {
    const c = hubAssociationInviteCopy({
      kind: "list",
      label: "Yosemite packing",
      memberCount: 2,
      existingNote: false,
    });
    expect(c.title).toBe("Make Yosemite packing?");
  });
});

describe("seedHubListMarkdown", () => {
  it("writes a marked block on a headingless one-member list", () => {
    const hub = "- [ ] High school of the dead\n- [ ] Gurren Lagann\n";
    const next = seedHubListMarkdown(hub, ["Want to watch anime Psycho-Pass"]);
    expect(next).toContain("<!-- atoms:generated v=1 -->");
    expect(next).toContain("- [[Want to watch anime Psycho-Pass]]");
    expect(next).toMatch(/^- \[ \] High school of the dead/m);
    expect(shouldWriteNonPersonHub({
      memberCount: 1,
      hasMatchingHubSection: false,
      hubHasGeneratedDelimiters: false,
    })).toBe(false);
  });

  it("hard-link plus seed is the accept write", () => {
    const before = `---
generated-by: linker
---
I want to watch the anime psycho pass
`;
    const linked = applyHardLinkToAtomContent(
      before,
      "Show list",
      "belongs with [[Show list]]",
    );
    expect(linked).toContain("Show list");
    const listed = seedHubListMarkdown("- [ ] Gurren Lagann\n", [
      "Want to watch anime Psycho-Pass",
    ]);
    expect(listed).toContain("<!-- atoms:generated v=1 -->");
    expect(listed).toContain("- [[Want to watch anime Psycho-Pass]]");
    expect(listed).toContain("- [ ] Gurren Lagann");
  });
});

describe("collectEntityInvites still create-only", () => {
  it("skips when the title already exists (add-beat lives on collectHubAssociationInvites)", () => {
    const invites = collectEntityInvites(
      [
        atom(
          "Atoms/a.md",
          "Bug spray",
          "pack bug spray for Yosemite packing",
        ),
      ],
      ["Yosemite packing"],
      { minMembers: 1 },
    );
    expect(invites).toHaveLength(0);
  });
});

describe("measured-thing invites (#589)", () => {
  const reading1 = atom(
    "Atoms/Car at 73042 miles, needs a return to QGS automotive.md",
    "Car at 73042 miles, needs a return to QGS automotive",
    "My miles in my car at 73042 I need to drive 60 to 70 miles and come back into QGS automotive",
  );
  const reading2 = atom(
    "Atoms/Car odometer reads 73089 miles.md",
    "Car odometer reads 73089 miles",
    "My car is at 73089 miles",
  );

  it("one reading alone never invites (series proves itself at two)", () => {
    const invites = collectHubAssociationInvites({
      atoms: [reading1],
      vaultTitles: [],
      personHubTitles: [],
    });
    expect(invites).toEqual([]);
  });

  it("two readings of the same thing invite Track My car", () => {
    const invites = collectHubAssociationInvites({
      atoms: [reading1, reading2],
      vaultTitles: [],
      personHubTitles: [],
    });
    const m = invites.find((i) => i.measured);
    expect(m?.label).toBe("My car");
    expect(m?.existingNote).toBe(false);
    expect(m?.memberPaths).toEqual([reading1.path, reading2.path]);
    const copy = hubAssociationInviteCopy({
      kind: "list",
      label: m!.label,
      memberCount: m!.memberPaths.length,
      existingNote: false,
      measured: true,
    });
    expect(copy.title).toBe("Track My car?");
    expect(copy.kicker).toBe("Series");
  });

  it("Keep it open prefers measured overlap over Show list", () => {
    const anime = atom(
      "Atoms/Want to watch anime Psycho-Pass.md",
      "Want to watch anime Psycho-Pass",
      "I want to watch the anime psycho pass",
    );
    const invites = collectHubAssociationInvites({
      atoms: [reading1, reading2, anime],
      vaultTitles: ["Show list"],
      personHubTitles: [],
    });
    expect(invites[0]?.label).toBe("Show list");
    expect(
      pickHomeHubInvite(invites, {
        loopPath: reading1.path,
        readingPath: reading2.path,
      })?.label,
    ).toBe("My car");
    expect(
      pickHomeHubInvite(invites, null, [
        `${reading1.path}::${reading2.path}`.toLowerCase(),
      ])?.label,
    ).toBe("My car");
    expect(pickHomeHubInvite(invites, null)?.label).toBe("Show list");
  });

  it("an existing My car note pairs from a single unlinked reading", () => {
    const invites = collectHubAssociationInvites({
      atoms: [reading2],
      vaultTitles: ["My car"],
      personHubTitles: [],
    });
    const m = invites.find((i) => i.measured);
    expect(m?.label).toBe("My car");
    expect(m?.existingNote).toBe(true);
  });

  it("a hard-linked reading never re-invites", () => {
    const linked = atom(
      "Atoms/Car odometer reads 73089 miles.md",
      "Car odometer reads 73089 miles",
      "My car is at 73089 miles\n\n- new reading in the [[My car]] series",
    );
    const invites = collectHubAssociationInvites({
      atoms: [linked],
      vaultTitles: ["My car"],
      personHubTitles: [],
    });
    expect(invites.find((i) => i.measured)).toBeUndefined();
  });

  it("a snoozed label stays quiet", () => {
    const invites = collectHubAssociationInvites({
      atoms: [reading1, reading2],
      vaultTitles: [],
      personHubTitles: [],
      snoozedIds: [pairingId("list", "My car")],
    });
    expect(invites.find((i) => i.measured)).toBeUndefined();
  });

  it("different things never share a series invite", () => {
    const weight = atom(
      "Atoms/Weighed in at 178.md",
      "Weighed in at 178",
      "Weighed in at 178 this morning",
    );
    const invites = collectHubAssociationInvites({
      atoms: [reading1, weight],
      vaultTitles: [],
      personHubTitles: [],
    });
    expect(invites.find((i) => i.measured)).toBeUndefined();
  });
});
