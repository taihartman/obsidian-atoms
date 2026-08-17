import { describe, expect, it } from "vitest";
import {
  collectHubAssociationInvites,
  hubAssociationInviteCopy,
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

  it("returns the only list-named note", () => {
    expect(pickListNamedHub("want to watch Dune", ["Show list"])).toBe(
      "Show list",
    );
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
        atom("Atoms/a.md", "Want to watch Dune", "want to watch Dune"),
      ],
      vaultTitles: ["Movies"],
      personHubTitles: [],
    });
    const list = invites.find((i) => i.kind === "list");
    expect(list?.label).toBe("Movies");
    expect(list?.existingNote).toBe(true);
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
