import { describe, expect, it } from "vitest";
import {
  consumeTogetherNews,
  joinId,
  pickTogetherNews,
  seedToldForAllCurrent,
  stampToldJoins,
  togetherNewsCopy,
  type AcceptedHub,
  type TogetherNewsAtom,
  type ToldStore,
} from "../src/pipeline/togetherNews";
import { decideFirstFill } from "../src/pipeline/firstCatalogFill";

const atomMd = (body: string, links: string, source = "2026-08-10") => `---
created: ${source}
source: "[[${source}]]"
generated-by: linker
tags: []
---
${body}

${links}
`;

function atom(
  title: string,
  hub: string,
  sourceDate: string,
  path = `Atoms/${title}.md`,
): TogetherNewsAtom {
  return {
    path,
    title,
    content: atomMd("body", `belongs with [[${hub}]].`, sourceDate),
    sourceDate,
  };
}

function memoryTold(initial?: string[] | null): ToldStore & { raw: string | null } {
  const store = {
    raw: initial === undefined ? null : JSON.stringify(initial),
    load(): string | null {
      return store.raw;
    },
    save(raw: string): void {
      store.raw = raw;
    },
  };
  return store;
}

const showList: AcceptedHub = {
  title: "Show list",
  path: "Show list.md",
  kind: "list",
};
const nichita: AcceptedHub = {
  title: "Nichita",
  path: "People/Nichita.md",
  kind: "person",
};

const fourShows = [
  atom("Psycho-Pass", "Show list", "2026-08-01"),
  atom("Frieren", "Show list", "2026-08-02"),
  atom("Demon Slayer", "Show list", "2026-08-03"),
  atom("Dune show", "Show list", "2026-08-04"),
];

describe("pickTogetherNews", () => {
  it("returns none when four Show list members are already told", () => {
    const told = memoryTold(fourShows.map((a) => joinId("Show list", a.path)));
    expect(
      pickTogetherNews({
        listingOn: true,
        atoms: fourShows,
        acceptedHubs: [showList],
        told,
        excludedHubTitles: [],
      }),
    ).toBeNull();
  });

  it("returns the new Show list member that is not in the told-set", () => {
    const told = memoryTold(fourShows.map((a) => joinId("Show list", a.path)));
    const next = atom("Blue Eye Samurai", "Show list", "2026-08-20");
    const card = pickTogetherNews({
      listingOn: true,
      atoms: [...fourShows, next],
      acceptedHubs: [showList],
      told,
      excludedHubTitles: [],
    });
    expect(card).toEqual({
      hubTitle: "Show list",
      hubPath: "Show list.md",
      newestTitle: "Blue Eye Samurai",
      newestPath: next.path,
      newestSourceDate: "2026-08-20",
    });
    expect(card).not.toHaveProperty("members");
    expect(card).not.toHaveProperty("peekTitles");
  });

  it("returns a person-hub join with no sibling roster", () => {
    const existing = atom("Old Nichita note", "Nichita", "2026-07-01");
    const next = atom("Walked with Nichita", "Nichita", "2026-08-18");
    const told = memoryTold([joinId("Nichita", existing.path)]);
    const card = pickTogetherNews({
      listingOn: true,
      atoms: [existing, next],
      acceptedHubs: [nichita],
      told,
      excludedHubTitles: [],
    });
    expect(card?.hubTitle).toBe("Nichita");
    expect(card?.newestTitle).toBe("Walked with Nichita");
    expect(card).not.toHaveProperty("members");
  });

  it("picks the hub whose unseen member has the newest source date", () => {
    const showNew = atom("New show", "Show list", "2026-08-10");
    const personNew = atom("New Nichita", "Nichita", "2026-08-19");
    const told = memoryTold([]);
    const card = pickTogetherNews({
      listingOn: true,
      atoms: [...fourShows, showNew, personNew],
      acceptedHubs: [showList, nichita],
      told,
      excludedHubTitles: [],
    });
    expect(card?.hubTitle).toBe("Nichita");
    expect(card?.newestTitle).toBe("New Nichita");
  });

  it("seeds a missing told-set with current members and returns none", () => {
    const told = memoryTold();
    expect(
      pickTogetherNews({
        listingOn: true,
        atoms: fourShows,
        acceptedHubs: [showList],
        told,
        excludedHubTitles: [],
      }),
    ).toBeNull();
    const seeded = JSON.parse(told.raw ?? "[]") as string[];
    expect(seeded.sort()).toEqual(
      fourShows.map((a) => joinId("Show list", a.path)).sort(),
    );
  });

  it("does not fire for a snoozed Show list invite; another hub may still ping", () => {
    const showNew = atom("New show", "Show list", "2026-08-20");
    const personNew = atom("New Nichita", "Nichita", "2026-08-01");
    const told = memoryTold([]);
    const card = pickTogetherNews({
      listingOn: true,
      atoms: [...fourShows, showNew, personNew],
      acceptedHubs: [showList, nichita],
      told,
      excludedHubTitles: ["Show list"],
    });
    expect(card?.hubTitle).toBe("Nichita");
  });

  it("ignores a soft-key-only link", () => {
    const soft: TogetherNewsAtom = {
      path: "Atoms/Bug spray.md",
      title: "Bug spray",
      content: atomMd("body", "belongs with [[Camping]]."),
      sourceDate: "2026-08-20",
    };
    const told = memoryTold([]);
    expect(
      pickTogetherNews({
        listingOn: true,
        atoms: [soft],
        acceptedHubs: [showList],
        told,
        excludedHubTitles: [],
      }),
    ).toBeNull();
  });

  it("returns none when listing is off", () => {
    const told = memoryTold([]);
    expect(
      pickTogetherNews({
        listingOn: false,
        atoms: [atom("Blue Eye Samurai", "Show list", "2026-08-20")],
        acceptedHubs: [showList],
        told,
        excludedHubTitles: [],
      }),
    ).toBeNull();
  });
});

describe("consumeTogetherNews", () => {
  it("stamps every currently unseen member of that hub so a later pick is none", () => {
    const a = atom("New A", "Show list", "2026-08-18");
    const b = atom("New B", "Show list", "2026-08-19");
    const told = memoryTold(fourShows.map((x) => joinId("Show list", x.path)));
    const atoms = [...fourShows, a, b];
    expect(
      pickTogetherNews({
        listingOn: true,
        atoms,
        acceptedHubs: [showList],
        told,
        excludedHubTitles: [],
      })?.newestTitle,
    ).toBe("New B");
    consumeTogetherNews({
      hubTitle: "Show list",
      atoms,
      acceptedHubs: [showList],
      told,
    });
    expect(
      pickTogetherNews({
        listingOn: true,
        atoms,
        acceptedHubs: [showList],
        told,
        excludedHubTitles: [],
      }),
    ).toBeNull();
  });
});

describe("togetherNewsCopy", () => {
  it("names the newest atom and the hub only", () => {
    const copy = togetherNewsCopy({
      newestTitle: "Psycho-Pass",
      hubTitle: "Show list",
    });
    expect(copy.kicker).toBe("Together");
    expect(copy.title).toBe("Psycho-Pass");
    expect(copy.supporting).toBe("Show list");
    expect(copy.openLabel).toBe("Open");
    expect(copy.notNowLabel).toBe("Not now");
    expect(JSON.stringify(copy)).not.toMatch(/\d+ notes/);
    expect(JSON.stringify(copy)).not.toMatch(/see them all/i);
  });
});

describe("decideFirstFill", () => {
  it("offers when listing is off, stamp is missing, and the preview has rows", () => {
    expect(
      decideFirstFill({
        firstFillDone: false,
        listingOn: false,
        acceptedHubCount: 1,
        previewHasRows: true,
      }),
    ).toBe("offer");
  });

  it("stamps empty when accepted hubs exist but nothing would write", () => {
    expect(
      decideFirstFill({
        firstFillDone: false,
        listingOn: false,
        acceptedHubCount: 1,
        previewHasRows: false,
      }),
    ).toBe("stamp-empty");
  });

  it("waits when there are no accepted hubs yet", () => {
    expect(
      decideFirstFill({
        firstFillDone: false,
        listingOn: false,
        acceptedHubCount: 0,
        previewHasRows: false,
      }),
    ).toBe("noop");
  });
});

describe("seedToldForAllCurrent", () => {
  it("after Not now, picker returns none for the four Show list paths", () => {
    const told = memoryTold();
    seedToldForAllCurrent({
      atoms: fourShows,
      acceptedHubs: [showList],
      told,
    });
    expect(
      pickTogetherNews({
        listingOn: true,
        atoms: fourShows,
        acceptedHubs: [showList],
        told,
        excludedHubTitles: [],
      }),
    ).toBeNull();
  });
});

describe("stampToldJoins", () => {
  it("after invite accept, picker returns none for those member paths", () => {
    const a = atom("Invited show", "Show list", "2026-08-20");
    const told = memoryTold(fourShows.map((x) => joinId("Show list", x.path)));
    stampToldJoins(told, "Show list", [a.path]);
    expect(
      pickTogetherNews({
        listingOn: true,
        atoms: [...fourShows, a],
        acceptedHubs: [showList],
        told,
        excludedHubTitles: [],
      }),
    ).toBeNull();
  });
});
