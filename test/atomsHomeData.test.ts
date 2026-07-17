import { describe, expect, it } from "vitest";
import {
  classifyLinkRole,
  countEligibleUpdateNotes,
  extractDisplayLinkChips,
  extractLinkChips,
  extractSourceDay,
  atomsPlusOfferCopy,
  atomsPlusTopUpCopy,
  filingHeroCopy,
  filingPathFromAuth,
  filterLinkedOnly,
  formatRelativeTime,
  isAutomaticFilingReady,
  isGeneratedAtomContent,
  isDayOnlyCreated,
  libraryTimeMs,
  listAtomLibraryEntries,
  parseAtomLibraryEntry,
  parseCreatedMs,
  personNameFromClaimTitle,
  planCreatedOrderBackfill,
  shouldShowWaitCard,
  titleFromAtomPath,
  updateNotesConfirmCopy,
  updateNotesStripCopy,
} from "../src/home/atomsHomeData";

const atomMd = (opts: {
  title?: string;
  source?: string;
  created?: string;
  body: string;
  links?: string;
}) => {
  const title = opts.title ?? "Claim title";
  const created = opts.created ?? "2026-07-14";
  return `---
created: ${created}
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
    expect(titleFromAtomPath("Atoms/Alex prefers.md")).toBe(
      "Alex prefers",
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
      "Alex likes teal\n\npreference about [[Alex]]. Also [[Tin]].";
    expect(extractLinkChips(body, "Alex prefers teal")).toEqual([
      "Alex",
      "Tin",
    ]);
    expect(extractLinkChips("see [[Claim title]]", "Claim title")).toEqual([]);
  });

  it("types and caps display chips (person/work, max 2)", () => {
    const body = `Christian told me to watch my hero academia

media work to watch ([[My Hero Academia]]). preference about [[Christian]].
relates because [[Sleep debt plateaus is a very long claim title here]].`;
    const chips = extractDisplayLinkChips(body, "Christian recommended…", [
      "watch",
      "show",
      "person",
    ]);
    expect(chips).toHaveLength(2);
    expect(chips.map((c) => c.label)).toEqual([
      "My Hero Academia",
      "Christian",
    ]);
    expect(chips[0]!.role).toBe("work");
    expect(chips[1]!.role).toBe("person");
  });

  it("classifies roles and demotes junk/long claims", () => {
    expect(classifyLinkRole("Christian", "preference about ", ["person"])).toBe(
      "person",
    );
    expect(
      classifyLinkRole("My Hero Academia", "media work to watch ", ["watch"]),
    ).toBe("work");
    expect(classifyLinkRole("user link", "related ", [])).toBeNull();
    expect(
      classifyLinkRole(
        "Sleep debt plateaus is a very long claim title",
        "relates ",
        [],
      ),
    ).toBeNull();
  });

  it("shortens long person-claim links (Sherry → Ning)", () => {
    expect(
      personNameFromClaimTitle(
        "Ning is the strong Asian guy at CRG who wears a white collared shirt",
      ),
    ).toBe("Ning");
    const body = `Sherry is Ning's friend

relates to this note about Ning ([[Ning is the strong Asian guy at CRG who wears a white collared shirt]])`;
    const chips = extractDisplayLinkChips(
      body,
      "Sherry is Ning's friend from CRG who works at a hospital",
      ["person"],
    );
    expect(chips).toEqual([{ label: "Ning", role: "person" }]);
  });
});

describe("parseCreatedMs / libraryTimeMs", () => {
  it("prefers created over file mtime so Update does not reshuffle Recents", () => {
    const content = atomMd({
      created: "2026-07-10T09:00:00",
      body: "old capture",
    });
    const fileMtime = Date.now(); // “just updated”
    const t = libraryTimeMs(content, fileMtime);
    expect(t).toBe(parseCreatedMs(content));
    expect(t).toBeLessThan(fileMtime - 86_400_000);
  });

  it("parses day-only created as local noon", () => {
    const ms = parseCreatedMs(atomMd({ created: "2026-07-14", body: "x" }));
    expect(ms).not.toBeNull();
    const d = new Date(ms!);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(14);
    expect(d.getHours()).toBe(12);
  });

  it("detects day-only created", () => {
    expect(isDayOnlyCreated(atomMd({ created: "2026-07-14", body: "x" }))).toBe(
      true,
    );
    expect(
      isDayOnlyCreated(atomMd({ created: "2026-07-14T12:00:03", body: "x" })),
    ).toBe(false);
  });
});

describe("planCreatedOrderBackfill", () => {
  it("re-stamps day-only created from daily line order via body match", () => {
    const daily = `- Andrew loves high school musical
\t↳ [[Andrew loves High School Musical]] <!--linker-->
- other note
- Andrew doesn't actually like high school musical well he kinda does
\t↳ [[Andrew's High School Musical love was actually a joke]] <!--linker-->
`;
    const loves = atomMd({
      created: "2026-07-16",
      source: "2026-07-16",
      body: "Andrew loves high school musical",
      links: "named work ([[High School Musical]])",
    });
    const joke = atomMd({
      created: "2026-07-16",
      source: "2026-07-16",
      body: "Andrew doesn't actually like high school musical well he kinda does",
      links: "revises ([[Andrew loves High School Musical]])",
    });
    const lovesPlan = planCreatedOrderBackfill(loves, daily, "2026-07-16");
    const jokePlan = planCreatedOrderBackfill(joke, daily, "2026-07-16");
    expect(lovesPlan?.created).toBe("2026-07-16T12:00:00");
    // joke is third top-level bullet (line index 3 with marker lines in between)
    expect(jokePlan?.created).toBe("2026-07-16T12:00:03");
    expect(lovesPlan!.created < jokePlan!.created).toBe(true);
    expect(lovesPlan!.content).toContain("Andrew loves high school musical");
    expect(lovesPlan!.content).toContain("named work");
    // library order: joke newer than loves
    const entries = listAtomLibraryEntries(
      [
        {
          path: "Atoms/Andrew loves High School Musical.md",
          mtime: 1,
          content: lovesPlan!.content,
        },
        {
          path: "Atoms/Andrew's joke.md",
          mtime: 2,
          content: jokePlan!.content,
        },
      ],
      "Atoms",
    );
    expect(entries.map((e) => e.title)).toEqual([
      "Andrew's joke",
      "Andrew loves High School Musical",
    ]);
  });

  it("skips when created already has time", () => {
    const daily = `- thought one\n`;
    const atom = atomMd({
      created: "2026-07-16T14:32:00",
      body: "thought one",
    });
    expect(planCreatedOrderBackfill(atom, daily, "2026-07-16")).toBeNull();
  });

  it("skips ambiguous body match", () => {
    const daily = `- same text\n- same text\n`;
    const atom = atomMd({ created: "2026-07-16", body: "same text" });
    expect(planCreatedOrderBackfill(atom, daily, "2026-07-16")).toBeNull();
  });
});

describe("listAtomLibraryEntries", () => {
  it("filters folder, generated-by, sorts by created (not file mtime)", () => {
    const entries = listAtomLibraryEntries(
      [
        {
          path: "Atoms/Older.md",
          mtime: 9_999_999, // newer file mtime must not win
          content: atomMd({
            title: "Older",
            created: "2026-07-01",
            body: "a",
          }),
        },
        {
          path: "Atoms/Newer.md",
          mtime: 100, // older file mtime
          content: atomMd({
            created: "2026-07-20",
            body: "b",
            links: "about [[Alex]].",
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
    expect(entries[0]!.linkChips).toContain("Alex");
    expect(entries[0]!.displayChips.some((c) => c.label === "Alex")).toBe(
      true,
    );
  });

  it("Linked filter keeps only displayable person/work chips", () => {
    const a = parseAtomLibraryEntry(
      "Atoms/A.md",
      atomMd({ body: "x", links: "preference about [[Alex]]." }),
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

describe("filingHeroCopy", () => {
  it("returns null when no past unprocessed", () => {
    expect(
      filingHeroCopy({
        pastUnprocessed: 0,
        hasKey: true,
        autoEnabled: true,
        egressAcked: true,
      }),
    ).toBeNull();
  });

  it("need_key when no API key — Try Plus + own key (mock v3)", () => {
    const c = filingHeroCopy({
      pastUnprocessed: 3,
      hasKey: false,
      autoEnabled: false,
      egressAcked: false,
    });
    expect(c?.mode).toBe("need_key");
    expect(c?.primaryAction).toBe("open_plus");
    expect(c?.primaryLabel).toBe("Try Atoms Plus");
    expect(c?.secondaryAction).toBe("open_byok_settings");
    expect(c?.secondaryLabel).toBe("Use My Own Key");
    expect(c?.title).toBe("3 Captures Waiting");
  });

  it("plus_exhausted — Monthly Limit Reached, no BYOK pitch", () => {
    const c = filingHeroCopy({
      pastUnprocessed: 4,
      hasKey: false,
      autoEnabled: true,
      egressAcked: true,
      filingPath: "plus_exhausted",
    });
    expect(c?.mode).toBe("plus_limit");
    expect(c?.title).toBe("Monthly Limit Reached");
    expect(c?.primaryAction).toBe("get_more");
    expect(c?.secondaryAction).toBe("dismiss_limit");
    expect(c?.body.toLowerCase()).not.toMatch(/paste|your own api key|sk-ant/);
    expect(c?.body).toMatch(/allotment starts over/i);
  });

  it("enable_auto when key but auto off", () => {
    const c = filingHeroCopy({
      pastUnprocessed: 2,
      hasKey: true,
      autoEnabled: false,
      egressAcked: true,
    });
    expect(c?.mode).toBe("enable_auto");
    expect(c?.primaryAction).toBe("enable_auto");
    expect(c?.secondaryAction).toBe("process");
  });

  it("auto_on when automatic filing on — not Process-only homework", () => {
    const c = filingHeroCopy({
      pastUnprocessed: 4,
      hasKey: true,
      autoEnabled: true,
      egressAcked: true,
    });
    expect(c?.mode).toBe("auto_on");
    expect(c?.body.toLowerCase()).toMatch(/automatic filing/);
    expect(c?.eyebrow).toBe("Automatic");
  });
});

describe("filingPathFromAuth", () => {
  it("maps plus exhausted", () => {
    expect(
      filingPathFromAuth({ mode: "plus", status: "exhausted" }),
    ).toBe("plus_exhausted");
    expect(filingPathFromAuth({ mode: "byok" })).toBe("byok");
    expect(filingPathFromAuth({ mode: "none" })).toBe("none");
  });
});

describe("atomsPlus offer copy", () => {
  it("includes 150, no rollover, cost reason, free path", () => {
    const o = atomsPlusOfferCopy();
    expect(o.bullets.join(" ")).toMatch(/150/);
    expect(o.bullets.join(" ").toLowerCase()).toMatch(/don.t roll over|don’t roll over/);
    expect(o.costReason.toLowerCase()).toMatch(/cost/);
    expect(o.freePath.toLowerCase()).toMatch(/own.*key|api key/);
  });

  it("top-up is one-time not auto-renew", () => {
    const t = atomsPlusTopUpCopy();
    expect(t.body.toLowerCase()).toMatch(/one-time|does not.*renew automatically/);
    expect(t.detail).toMatch(/50/);
  });
});

describe("isAutomaticFilingReady", () => {
  it("requires enabled, ack, and key", () => {
    expect(
      isAutomaticFilingReady({
        enabled: true,
        egressAcked: true,
        hasKey: true,
      }),
    ).toBe(true);
    expect(
      isAutomaticFilingReady({
        enabled: true,
        egressAcked: true,
        hasKey: false,
      }),
    ).toBe(false);
  });
});

describe("countEligibleUpdateNotes", () => {
  it("counts unstamped linker atoms", () => {
    const legacy = atomMd({ body: "old" });
    const stamped = `---
created: 2026-07-14
source: "[[2026-07-14]]"
generated-by: linker
atoms-quality: 99
quality-updated: 2026-07-16
tags: []
---
new
`;
    expect(countEligibleUpdateNotes([legacy, stamped, "# hand"])).toBe(1);
  });
});

describe("updateNotesStripCopy", () => {
  it("locks product copy for small N", () => {
    const c = updateNotesStripCopy(3);
    expect(c.title).toBe("Filing got smarter");
    expect(c.button).toBe("Update");
    expect(c.body).toContain("3 older notes to match");
    expect(c.body).not.toMatch(/\bmodel\b/i);
  });

  it("uses calm large-N body without guilt count", () => {
    const c = updateNotesStripCopy(800);
    expect(c.body).toMatch(/matter most/i);
    expect(c.body).not.toContain("800");
  });
});

describe("updateNotesConfirmCopy", () => {
  it("polish-only does not mention Anthropic key", () => {
    const t = updateNotesConfirmCopy({ refileBatch: 0, polishable: 12 });
    expect(t.toLowerCase()).toMatch(/free/);
    expect(t).not.toMatch(/Anthropic/i);
  });

  it("refile mentions key", () => {
    const t = updateNotesConfirmCopy({ refileBatch: 15, polishable: 0 });
    expect(t).toMatch(/Anthropic/i);
  });
});
