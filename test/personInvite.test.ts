import { describe, expect, it } from "vitest";
import {
  collectPersonInvites,
  formatPersonNoteMarkdown,
  isDeniedPersonName,
  personInviteCopy,
  personNotePath,
  resolvePeopleFolderPrefix,
  resolvePersonInviteName,
} from "../src/pipeline/personInvite";

const atom = (
  path: string,
  title: string,
  body: string,
  sourceDate = "2026-07-22",
) => ({
  path,
  title,
  sourceDate,
  content: `---
generated-by: linker
source: "[[${sourceDate}]]"
---
${body}
`,
});

describe("resolvePersonInviteName", () => {
  it("resolves Mom sole-subject", () => {
    expect(
      resolvePersonInviteName(
        "Mom wants to celebrate like this for her bday",
        "Plan to climb at CRG then dinner for moms birthday",
      ),
    ).toBe("Mom");
  });

  it("resolves Dom identity capture", () => {
    expect(
      resolvePersonInviteName(
        "Dom that is the name of the dude we met climbing at Crg",
        "Dom is a dark-skinned guy met climbing at CRG",
      ),
    ).toBe("Dom");
  });

  it("skips media recommender", () => {
    expect(
      resolvePersonInviteName(
        "Christian told me to watch my hero academia",
        "Christian recommended watching My Hero Academia",
      ),
    ).toBeNull();
  });

  it("skips CRG as name", () => {
    expect(isDeniedPersonName("CRG")).toBe(true);
    expect(
      resolvePersonInviteName("climb at CRG tomorrow", "Climb CRG"),
    ).toBeNull();
  });
});

describe("collectPersonInvites", () => {
  it("ranks Mom over older Dom when Mom is newer", () => {
    const invites = collectPersonInvites(
      [
        atom(
          "Atoms/dom.md",
          "Dom is a guy at CRG",
          "Dom that is the name of the dude we met climbing",
          "2026-07-20",
        ),
        atom(
          "Atoms/mom.md",
          "Plan for moms birthday",
          "Mom wants to celebrate for her bday",
          "2026-07-22",
        ),
      ],
      { personHubTitles: ["Nichita"], vaultTitles: ["Nichita"] },
    );
    expect(invites.length).toBeGreaterThanOrEqual(1);
    expect(invites[0]!.displayName).toBe("Mom");
  });

  it("groups two Dom atoms", () => {
    const invites = collectPersonInvites(
      [
        atom("Atoms/a.md", "Dom at CRG", "Dom is the dude we met climbing"),
        atom(
          "Atoms/b.md",
          "Dom wears trainers",
          "Dom was wearing the trainer shoes",
        ),
      ],
      { personHubTitles: [], vaultTitles: [] },
    );
    const dom = invites.find((i) => i.displayName === "Dom");
    expect(dom?.memberPaths.length).toBe(2);
  });

  it("skips snoozed names", () => {
    const invites = collectPersonInvites(
      [atom("Atoms/m.md", "Mom plan", "Mom wants dinner")],
      {
        personHubTitles: [],
        vaultTitles: [],
        snoozedNames: ["mom"],
      },
    );
    expect(invites.some((i) => i.displayName === "Mom")).toBe(false);
  });

  it("skips when person hub already exists", () => {
    const invites = collectPersonInvites(
      [
        atom(
          "Atoms/n.md",
          "Nichita loves pajamas",
          "Nichita loves pajamas a lot",
        ),
      ],
      { personHubTitles: ["Nichita"], vaultTitles: ["Nichita"] },
    );
    expect(invites.some((i) => i.displayName === "Nichita")).toBe(false);
  });
});

describe("personInviteCopy + markdown + folder", () => {
  it("formats Add copy", () => {
    const c = personInviteCopy("Mom", 1);
    expect(c.title).toBe("Add Mom?");
    expect(c.createLabel).toBe("Add Mom");
  });

  it("formats person note", () => {
    expect(formatPersonNoteMarkdown("Mom")).toContain("# Mom");
    expect(formatPersonNoteMarkdown("Mom")).toContain("person");
  });

  it("prefers Personal notes/Social", () => {
    expect(
      resolvePeopleFolderPrefix([
        "Personal notes/Social/Nichita.md",
        "Atoms/x.md",
      ]),
    ).toBe("Personal notes/Social");
    expect(personNotePath("Personal notes/Social", "Mom")).toBe(
      "Personal notes/Social/Mom.md",
    );
  });
});
