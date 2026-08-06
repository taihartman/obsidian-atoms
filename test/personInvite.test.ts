import { describe, expect, it } from "vitest";
import {
  applyHardLinkToAtomContent,
  applyPersonPeerLinksToContents,
  collectPersonInvites,
  formatPersonNoteMarkdown,
  isDeniedPersonName,
  personInviteCopy,
  personNotePath,
  resolvePeopleFolderPrefix,
  resolvePersonInviteName,
} from "../src/pipeline/personInvite";

/**
 * The fixtures below carry fixed `sourceDate`s, and `collectPersonInvites`
 * measures recency against a 14-day window. Read off the real clock they age
 * out and the suite starts failing on a date rather than on a change — which is
 * exactly what happened on 2026-08-06. Several calls in this file already pass
 * their own `now`; these anchor the rest to the same kind of fixed instant.
 * Chosen so the oldest fixture (2026-07-20) still sits inside the window.
 */
const NOW = new Date("2026-08-02T12:00:00Z");

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

  // Subject-less capture: the preference verb leading the title is not a person.
  it("skips the leading preference verb (Add Likes? bug)", () => {
    expect(
      resolvePersonInviteName(
        "likes annie's fruit tape snack",
        "Likes Annie's fruit tape snack",
      ),
    ).toBeNull();
  });

  it.each([
    ["Prefers oat milk in coffee", "prefers oat milk in coffee"],
    ["Loves pajamas a lot", "loves pajamas a lot"],
    ["Hates the new checkout flow", "hates the new checkout flow"],
    ["Always orders the same bowl", "always orders the same bowl"],
    ["The new spot Nichita likes", "the new spot nichita likes"],
    ["Got new boots that Nichita likes", "got new boots that nichita likes"],
  ])("skips subject-less title %s", (title, body) => {
    expect(resolvePersonInviteName(body, title)).toBeNull();
  });

  it("denies verbs and determiners as names", () => {
    for (const w of ["Likes", "likes", "Loves", "The", "Always", "Tomorrow"]) {
      expect(isDeniedPersonName(w)).toBe(true);
    }
  });

  it("still resolves a real name leading a preference title", () => {
    expect(
      resolvePersonInviteName(
        "nichita likes long brown boots",
        "Nichita likes long brown boots",
      ),
    ).toBe("Nichita");
    expect(isDeniedPersonName("Nichita")).toBe(false);
  });

  it("keeps Will and May usable as names", () => {
    expect(isDeniedPersonName("Will")).toBe(false);
    expect(isDeniedPersonName("May")).toBe(false);
    expect(
      resolvePersonInviteName("Will is the guy from the gym", "Will is a guy from the gym"),
    ).toBe("Will");
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
      { now: NOW, personHubTitles: ["Nichita"], vaultTitles: ["Nichita"] },
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
      { now: NOW, personHubTitles: [], vaultTitles: [] },
    );
    const dom = invites.find((i) => i.displayName === "Dom");
    expect(dom?.memberPaths.length).toBe(2);
  });

  it("skips snoozed names", () => {
    const invites = collectPersonInvites(
      [atom("Atoms/m.md", "Mom plan", "Mom wants dinner")],
      {
        now: NOW,
        personHubTitles: [],
        vaultTitles: [],
        snoozedNames: ["mom"],
      },
    );
    expect(invites.some((i) => i.displayName === "Mom")).toBe(false);
  });

  // U3 — the card itself, driven by atoms-people rather than the title regex.
  it("offers no card when the model named only a mentioned person", () => {
    const content = `---
generated-by: linker
source: "[[2026-07-31]]"
atoms-people:
  - name: "Annie"
    role: mentioned
---
likes annie's fruit tape snack
`;
    const invites = collectPersonInvites(
      [
        {
          path: "Atoms/likes-annie.md",
          title: "Likes Annie's fruit tape snack",
          sourceDate: "2026-07-31",
          content,
        },
      ],
      { personHubTitles: [], vaultTitles: [], now: new Date("2026-08-01") },
    );
    expect(invites).toEqual([]);
  });

  it("offers a card for the named subject", () => {
    const content = `---
generated-by: linker
source: "[[2026-07-31]]"
atoms-people:
  - name: "Nichita"
    role: subject
---
skipped the gym because nichita likes it
`;
    const invites = collectPersonInvites(
      [
        {
          path: "Atoms/skipped.md",
          title: "Skipped the gym because Nichita likes it",
          sourceDate: "2026-07-31",
          content,
        },
      ],
      { personHubTitles: [], vaultTitles: [], now: new Date("2026-08-01") },
    );
    expect(invites.map((i) => i.displayName)).toEqual(["Nichita"]);
  });

  it("offers no card for a subject-less preference atom", () => {
    const invites = collectPersonInvites(
      [
        atom(
          "Atoms/likes-annie.md",
          "Likes Annie's fruit tape snack",
          "likes annie's fruit tape snack",
        ),
      ],
      { personHubTitles: [], vaultTitles: [], now: new Date("2026-07-23") },
    );
    expect(invites).toEqual([]);
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
      { now: NOW, personHubTitles: ["Nichita"], vaultTitles: ["Nichita"] },
    );
    expect(invites.some((i) => i.displayName === "Nichita")).toBe(false);
  });
});

describe("personInviteCopy existing vs new", () => {
  it("uses Link to when existingNote", () => {
    const c = personInviteCopy("Ning", 1, { existingNote: true });
    expect(c.title).toContain("Link to");
    expect(c.createLabel).toContain("Link to");
    expect(c.alreadyLabel).toMatch(/Choose different/i);
  });

  it("Already have them is not the same label as Not now", () => {
    const c = personInviteCopy("Dom", 2);
    expect(c.alreadyLabel).not.toBe(c.dismissLabel);
    expect(c.alreadyLabel.toLowerCase()).toContain("already");
  });
});

describe("applyPersonPeerLinksToContents", () => {
  it("adds mutual peer links for two members", () => {
    const a = `---
generated-by: linker
---
Dom is a guy

workplace ([[People]]).
`;
    const b = `---
generated-by: linker
---
Dom wears trainers

workplace ([[People]]).
`;
    const updates = applyPersonPeerLinksToContents([
      { path: "Atoms/a.md", title: "Dom is a guy", content: a },
      { path: "Atoms/b.md", title: "Dom wears trainers", content: b },
    ]);
    expect(updates.size).toBe(2);
    expect(updates.get("Atoms/a.md")).toContain("Dom wears trainers");
    expect(updates.get("Atoms/b.md")).toContain("Dom is a guy");
  });
});

describe("applyHardLinkToAtomContent", () => {
  it("adds hard link and drops soft People", () => {
    const content = `---
generated-by: linker
---
Mom wants dinner

workplace ([[People]]).
`;
    const next = applyHardLinkToAtomContent(
      content,
      "Mom",
      "about [[Mom]]",
      { dropSoft: true },
    );
    expect(next).toBeTruthy();
    expect(next!).toContain("[[Mom]]");
    expect(next!).not.toContain("[[People]]");
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
