import { describe, expect, it } from "vitest";
import {
  ALSO_ABOUT_BODY_NOTE,
  alsoAboutStripLabel,
  buildAlsoAboutStripModel,
  classifyLinkRole,
  countEligibleUpdateNotes,
  extractDisplayLinkChips,
  extractLinkChips,
  extractSourceDay,
  atomsPlusOfferCopy,
  atomsPlusTopUpCopy,
  backfillDismissUntil,
  backfillOfferCopy,
  countUnprocessedSince,
  filingHeroCopy,
  filingPathFromAuth,
  filterLinkedOnly,
  formatRelativeTime,
  inboxStuckSummary,
  isAutomaticFilingReady,
  isGeneratedAtomContent,
  isDayOnlyCreated,
  libraryTimeMs,
  listAtomLibraryEntries,
  parseAtomLibraryEntry,
  parseCreatedMs,
  personNameFromClaimTitle,
  planCreatedOrderBackfill,
  shouldShowBackfillOffer,
  shouldShowWaitCard,
  titleFromAtomPath,
  updateNotesConfirmCopy,
  updateNotesStripCopy,
  waitingSubtitle,
} from "../src/home/atomsHomeData";
import { inboxCounts } from "../src/pipeline/inbox";
import { shouldShowBookmarkSetupNotice } from "../src/plugin/inboxBootstrap";

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

  it("plus_exhausted after Not Now — quieter card, still Get More", () => {
    const c = filingHeroCopy({
      pastUnprocessed: 4,
      hasKey: false,
      autoEnabled: true,
      egressAcked: true,
      filingPath: "plus_exhausted",
      plusLimitDismissedToday: true,
    });
    expect(c?.mode).toBe("plus_limit");
    expect(c?.title).toBe("4 Captures Waiting");
    expect(c?.primaryAction).toBe("get_more");
    expect(c?.secondaryAction).toBeNull();
    expect(c?.title).not.toBe("Monthly Limit Reached");
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

  it("enable_auto never promises the waiting captures will file on their own", () => {
    // The vault QA saw: 56 past captures, none of which enabling can ever reach,
    // because the window it creates starts today.
    const c = filingHeroCopy({
      pastUnprocessed: 56,
      windowUnprocessed: 0,
      hasKey: true,
      autoEnabled: false,
      egressAcked: true,
    });
    expect(c?.mode).toBe("enable_auto");
    expect(c?.title).toBe("56 Captures Waiting");
    expect(c?.body.toLowerCase()).not.toMatch(/past days file/);
    expect(c?.body.toLowerCase()).not.toMatch(/when you open obsidian/);
    // What is already waiting is Process work, and the copy has to say so.
    expect(c?.body).toMatch(/Process/);
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

  it("auto_on counts the filing window, not all history", () => {
    const c = filingHeroCopy({
      pastUnprocessed: 9,
      windowUnprocessed: 2,
      hasKey: true,
      autoEnabled: true,
      egressAcked: true,
    });
    expect(c?.mode).toBe("auto_on");
    expect(c?.title).toBe("2 Captures Waiting");
    expect(c?.body.toLowerCase()).toMatch(/automatic filing/);
  });

  it("automatic filing on but nothing in the window — no promise it cannot keep", () => {
    const c = filingHeroCopy({
      pastUnprocessed: 9,
      windowUnprocessed: 0,
      hasKey: true,
      autoEnabled: true,
      egressAcked: true,
    });
    expect(c?.title).toBe("9 Captures Waiting");
    expect(c?.body.toLowerCase()).not.toMatch(/automatic filing/);
    expect(c?.body.toLowerCase()).not.toMatch(/file when you open/);
    expect(c?.primaryAction).toBe("process");
  });
});

describe("countUnprocessedSince", () => {
  const notes = [
    { date: "2026-08-01", unprocessed: [1, 2, 3] },
    { date: "2026-08-05", unprocessed: [1] },
    { date: "2026-08-07", unprocessed: [1, 2] },
  ];

  it("counts only days inside the window, boundary day included", () => {
    expect(countUnprocessedSince(notes, "2026-08-05")).toBe(3);
  });

  it("pre-window captures alone count zero", () => {
    expect(countUnprocessedSince(notes, "2026-08-10")).toBe(0);
  });

  it("a window older than every daily counts them all", () => {
    expect(countUnprocessedSince(notes, "2026-07-01")).toBe(6);
  });
});

describe("waitingSubtitle", () => {
  it("promises automatic filing for the window count only", () => {
    expect(
      waitingSubtitle({
        pastUnprocessed: 9,
        windowUnprocessed: 2,
        automaticFilingReady: true,
      }),
    ).toBe("2 past thoughts will file automatically");
  });

  it("pre-window captures alone never claim automatic filing", () => {
    expect(
      waitingSubtitle({
        pastUnprocessed: 9,
        windowUnprocessed: 0,
        automaticFilingReady: true,
      }),
    ).toBe("9 thoughts ready to file");
  });

  it("automatic filing off reports what Process would file", () => {
    expect(
      waitingSubtitle({
        pastUnprocessed: 1,
        windowUnprocessed: 1,
        automaticFilingReady: false,
      }),
    ).toBe("1 thought ready to file");
  });

  it("singular window copy", () => {
    expect(
      waitingSubtitle({
        pastUnprocessed: 4,
        windowUnprocessed: 1,
        automaticFilingReady: true,
      }),
    ).toBe("1 past thought will file automatically");
  });
});

describe("filingPathFromAuth", () => {
  const T0 = Date.parse("2026-08-11T13:49:00.000Z");
  const plus = (over: Record<string, unknown> = {}) =>
    ({
      mode: "plus",
      sessionToken: "sess",
      email: "u@example.com",
      status: "exhausted",
      ...over,
    }) as Parameters<typeof filingPathFromAuth>[0];

  it("maps plus exhausted", () => {
    expect(filingPathFromAuth(plus(), T0)).toBe("plus_exhausted");
    expect(filingPathFromAuth({ mode: "byok", apiKey: "sk" }, T0)).toBe("byok");
    expect(filingPathFromAuth({ mode: "none" }, T0)).toBe("none");
  });

  // #442 — the limit card's offer (buy more, or wait for the next billing date) is addressed
  // to a subscriber. An ended period gets its own path so it can say something true.
  it("takes its own path once the period has ended", () => {
    expect(
      filingPathFromAuth(
        plus({ plan: "trial", periodEnd: "2026-08-10T14:52:03.632Z" }),
        T0,
      ),
    ).toBe("plus_lapsed");
    expect(
      filingPathFromAuth(
        plus({ plan: "monthly", periodEnd: "2026-09-10T00:00:00.000Z" }),
        T0,
      ),
    ).toBe("plus_exhausted");
  });
});

describe("filingHeroCopy on an ended period (#442)", () => {
  const base = {
    pastUnprocessed: 3,
    hasKey: false,
    autoEnabled: false,
    egressAcked: false,
    filingPath: "plus_lapsed" as const,
  };

  it("names the trial, offers Subscribe, and promises no billing date", () => {
    const hero = filingHeroCopy({ ...base, plusLapseKind: "trial" });
    expect(hero?.title).toBe("Your trial has ended");
    expect(hero?.primaryLabel).toBe("Subscribe");
    expect(hero?.primaryAction).toBe("subscribe");
    expect(hero?.body).not.toMatch(/billing date|allotment/i);
  });

  it("has no Not Now, because waiting does not fix an ended period", () => {
    const hero = filingHeroCopy({
      ...base,
      plusLapseKind: "trial",
      plusLimitDismissedToday: true,
    });
    expect(hero?.secondaryAction).toBeNull();
    // A dismissed card must not quietly become the limit card's quieter variant.
    expect(hero?.title).toBe("Your trial has ended");
  });

  it("says subscription for a lapsed paid period", () => {
    expect(
      filingHeroCopy({ ...base, plusLapseKind: "subscription" })?.title,
    ).toBe("Your subscription has ended");
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
  it("locks product copy when the whole set fits one pass", () => {
    const c = updateNotesStripCopy(3);
    expect(c.title).toBe("Filing got smarter");
    expect(c.button).toBe("Update");
    expect(c.body).toContain("3 older notes this pass");
    expect(c.body).not.toMatch(/\bmodel\b/i);
    expect(c.body).not.toMatch(/Up to 15 per Update/i);
  });

  it("names the 15-cap when more remain than one pass", () => {
    const c = updateNotesStripCopy(30);
    expect(c.body).toContain("30 older notes");
    expect(c.body).toMatch(/Up to 15 per Update/i);
    expect(c.body).toMatch(/short and cost stays predictable/i);
    expect(c.body).toMatch(/tap again/i);
  });

  it("uses calm large-N body without guilt count, still names the batch", () => {
    const c = updateNotesStripCopy(800);
    expect(c.body).toMatch(/matter most/i);
    expect(c.body).not.toContain("800");
    expect(c.body).toMatch(/Up to 15 per Update/i);
  });
});

describe("alsoAbout strip copy", () => {
  it("builds strip when others exist", () => {
    const m = buildAlsoAboutStripModel("Yosemite packing", 2);
    expect(m?.stripText).toBe("Also about Yosemite packing · 2");
    expect(alsoAboutStripLabel("X", 3)).toBe("Also about X · 3");
    expect(ALSO_ABOUT_BODY_NOTE).toMatch(/own body/i);
    expect(ALSO_ABOUT_BODY_NOTE).not.toMatch(/—/);
  });

  it("null when no others", () => {
    expect(buildAlsoAboutStripModel("Yosemite packing", 0)).toBeNull();
  });
});

describe("updateNotesConfirmCopy", () => {
  it("polish-only does not mention Anthropic key or Plus", () => {
    const t = updateNotesConfirmCopy({ refileBatch: 0, polishable: 12 });
    expect(t.toLowerCase()).toMatch(/free/);
    expect(t).not.toMatch(/Anthropic/i);
    expect(t).not.toMatch(/Plus/i);
  });

  it("refile on Plus names monthly filings, not a personal key", () => {
    const t = updateNotesConfirmCopy({
      refileBatch: 15,
      polishable: 0,
      billing: "plus",
    });
    expect(t).toMatch(/Atoms Plus/i);
    expect(t).toMatch(/monthly filings/i);
    expect(t).not.toMatch(/Anthropic/i);
    expect(t).toMatch(/Up to 15 per Update/i);
    expect(t).toMatch(/this pass/i);
  });

  it("refile on BYOK names the Anthropic key", () => {
    const t = updateNotesConfirmCopy({
      refileBatch: 15,
      polishable: 0,
      billing: "byok",
    });
    expect(t).toMatch(/Anthropic/i);
    expect(t).not.toMatch(/Atoms Plus/i);
  });

  it("refile with no auth does not claim a key", () => {
    const t = updateNotesConfirmCopy({
      refileBatch: 3,
      polishable: 2,
      billing: "none",
    });
    expect(t).toMatch(/Sign in to Atoms Plus or add an API key/i);
    expect(t).not.toMatch(/Uses your Anthropic/i);
  });
});

describe("inbox stuck-drain indicator", () => {
  // Fixed clock so future-dated captures classify deterministically.
  const now = new Date(2026, 6, 28, 12, 0, 0); // 2026-07-28 local

  it("surfaces nothing when the inbox is clear", () => {
    const filed = "- 2026-07-20T09:14-04:00 already gone\n\t<!--atoms:filed-->\n";
    expect(inboxCounts(filed, now)).toEqual({
      pending: 0,
      held: 0,
      inferredDates: 0,
    });
    expect(inboxStuckSummary(inboxCounts("", now))).toBeNull();
    expect(inboxStuckSummary(inboxCounts(filed, now))).toBeNull();
  });

  it("shows a pending count when captures only wait to file", () => {
    const counts = inboxCounts("- 2026-07-20T09:14-04:00 buy milk\n", now);
    expect(counts).toEqual({
      pending: 1,
      held: 0,
      inferredDates: 0,
    });
    const s = inboxStuckSummary(counts);
    expect(s?.text).toBe("1 waiting to file");
  });

  it("carries no unparseable count at all — that state healed away", () => {
    const content = ["- no stamp here", "- 2026-07-20T09:14-04:00 buy milk", ""].join(
      "\n",
    );
    // A stampless capture heals into a pending one; there is no third bucket.
    const counts = inboxCounts(content, now);
    expect(counts).toEqual({ pending: 2, held: 0, inferredDates: 0 });
    expect("unparseable" in counts).toBe(false);
  });

  it("stays silent on inferred dates alone — missing times are normal", () => {
    // Drain may still write inferred-date markers for audit; Home must not
    // treat them as stuck or blame the capture shortcut.
    expect(
      inboxStuckSummary({ pending: 0, held: 0, inferredDates: 3 }),
    ).toBeNull();
    expect(
      inboxStuckSummary({ pending: 0, held: 0, inferredDates: 1 }),
    ).toBeNull();
  });

  it("names held and pending only — never inferred dates", () => {
    const s = inboxStuckSummary({ pending: 2, held: 1, inferredDates: 3 });
    expect(s?.text).toBe("1 held for a future day · 2 waiting to file");
    expect(s?.text).not.toMatch(/without a? ?times?/);
  });

  it("names future-dated held captures without mentioning missing times", () => {
    const content = ["- no stamp here", "- 2026-08-01T08:00-04:00 next month", ""].join(
      "\n",
    );
    // The stampless line inherits the future stamp's date, clamped to today,
    // so it files rather than stranding; only the future capture is held.
    expect(inboxCounts(content, now)).toEqual({
      pending: 1,
      held: 1,
      inferredDates: 0,
    });
    const s = inboxStuckSummary({ pending: 0, held: 1, inferredDates: 1 });
    expect(s?.text).toBe("1 held for a future day");
    expect(s?.text).not.toContain("waiting to file");
    expect(s?.text).not.toMatch(/without a? ?times?/);
  });

  it("stays silent when pending and held are zero", () => {
    expect(
      inboxStuckSummary({ pending: 0, held: 0, inferredDates: 0 }),
    ).toBeNull();
  });

  it("clears the indicator once a pending capture is filed", () => {
    const before = "- 2026-07-20T09:14-04:00 buy milk\n";
    expect(inboxStuckSummary(inboxCounts(before, now))?.text).toBe(
      "1 waiting to file",
    );
    // The drain appends a filed marker; the count recomputes to zero from
    // content alone, no cache to invalidate.
    const after = "- 2026-07-20T09:14-04:00 buy milk\n\t<!--atoms:filed-->\n";
    expect(inboxCounts(after, now)).toEqual({
      pending: 0,
      held: 0,
      inferredDates: 0,
    });
    expect(inboxStuckSummary(inboxCounts(after, now))).toBeNull();
  });
});

describe("shouldShowBookmarkSetupNotice", () => {
  it("fires once when the bookmark is unavailable and not yet acked", () => {
    expect(shouldShowBookmarkSetupNotice("unavailable", false)).toBe(true);
  });

  it("stays silent once the notice has been acked (no nag every load)", () => {
    expect(shouldShowBookmarkSetupNotice("unavailable", true)).toBe(false);
  });

  it("never fires when the bookmark was created or already present", () => {
    expect(shouldShowBookmarkSetupNotice("created", false)).toBe(false);
    expect(shouldShowBookmarkSetupNotice("already-present", false)).toBe(false);
  });
});

/**
 * U5 — the backfill offer card on home.
 *
 * Two bounds decide whether it renders, and the headline is the budgeted range rather than the
 * complement total. Both rules exist because the failure they prevent is the common case on a
 * real vault, not an edge: a card that offers a flow filing nothing, and a card promising 1,847
 * captures above a run that files 100.
 */
describe("shouldShowBackfillOffer", () => {
  const base = {
    total: 1847,
    budget: 50,
    dismissedUntil: null,
    today: "2026-08-10",
  };

  it("shows when there is a complement and a budget to spend on it", () => {
    expect(shouldShowBackfillOffer(base)).toBe(true);
  });

  it("stays away when nothing sits outside the filing window", () => {
    expect(shouldShowBackfillOffer({ ...base, total: 0 })).toBe(false);
  });

  it("stays away at zero budget even with a large complement", () => {
    // The last third of a paid period at normal burn, and permanently for a heavy capturer:
    // inviting a tap into a flow that files nothing is a dead end, not an edge case. Nothing
    // to spend and nothing buyable that helps this period, so there is nowhere for a tap to go.
    expect(shouldShowBackfillOffer({ ...base, budget: 0 })).toBe(false);
  });

  it("still shows when the budget cannot cover even the newest daily", () => {
    // deriveRecentFirstRange takes whole dailies only, so a budget can be positive while the
    // range is empty. That tap leads somewhere real: the modal's top-up branch (KTD11, "over
    // budget offers a top-up, never a dead end"). Suppressing here would make that branch
    // unreachable from the only discoverable surface. The empty *offer* is prevented in the
    // copy, which names the situation instead of a count it cannot honor.
    expect(shouldShowBackfillOffer({ ...base, budget: 5 })).toBe(true);
  });

  it("is suppressed for the period it was dismissed in", () => {
    expect(
      shouldShowBackfillOffer({ ...base, dismissedUntil: "2026-09-01" }),
    ).toBe(false);
  });

  it("returns once the dismissed-through day arrives", () => {
    expect(
      shouldShowBackfillOffer({
        ...base,
        dismissedUntil: "2026-09-01",
        today: "2026-09-01",
      }),
    ).toBe(true);
    expect(
      shouldShowBackfillOffer({
        ...base,
        dismissedUntil: "2026-09-01",
        today: "2026-09-14",
      }),
    ).toBe(true);
  });
});

describe("backfillDismissUntil", () => {
  it("scopes a Plus dismissal to the end of the current period", () => {
    expect(
      backfillDismissUntil({ today: "2026-08-10", periodEnd: "2026-09-01" }),
    ).toBe("2026-09-01");
  });

  it("accepts a full ISO period end and keeps only the day", () => {
    expect(
      backfillDismissUntil({
        today: "2026-08-10",
        periodEnd: "2026-09-01T04:00:00.000Z",
      }),
    ).toBe("2026-09-01");
  });

  it("falls back to 30 days for BYOK, which has no period at all", () => {
    expect(backfillDismissUntil({ today: "2026-08-10" })).toBe("2026-09-09");
  });

  it("falls back to 30 days when the stored period end has already passed", () => {
    expect(
      backfillDismissUntil({ today: "2026-08-10", periodEnd: "2026-07-01" }),
    ).toBe("2026-09-09");
  });
});

describe("backfillOfferCopy", () => {
  const plus = {
    budgeted: 100,
    total: 1847,
    migrated: false,
    currency: "filings" as const,
    filingsRemaining: 150,
  };

  it("leads with the budgeted range and keeps the total subordinate", () => {
    const copy = backfillOfferCopy(plus);
    expect(copy.body).toContain("100");
    // The total may appear, but never as the promise.
    expect(copy.body.indexOf("100")).toBeLessThan(copy.body.indexOf("1,847"));
  });

  it("names filings on Plus and cost on BYOK", () => {
    expect(backfillOfferCopy(plus).meter).toBe(
      "Uses 100 of the 150 filings left this period.",
    );
    expect(
      backfillOfferCopy({ ...plus, currency: "cost", filingsRemaining: undefined })
        .meter,
    ).toBe("Runs on your own API key. You see the cost before anything starts.");
  });

  it("names the pause on a migrated device instead of reading as a new offer", () => {
    const fresh = backfillOfferCopy(plus);
    const migrated = backfillOfferCopy({ ...plus, migrated: true });
    expect(migrated.title).not.toBe(fresh.title);
    expect(migrated.body).not.toBe(fresh.body);
    expect(migrated.body).toContain("switched it on");
  });

  it("names the situation, never a count, when nothing fits the budget", () => {
    // The over-budget variant routes to the modal's top-up branch. It must not promise a
    // number, and a user who never tops up sees it every period, so it cannot read as a pitch.
    const copy = backfillOfferCopy({ ...plus, budgeted: 0 });
    expect(copy.body).not.toMatch(/\d/);
    expect(copy.body).not.toContain("most recent");
    expect(copy.meter).toBe("More than the 150 filings left this period.");
    expect(copy.body).toBe(
      "The next day back holds more captures than this period's filings cover.",
    );
  });

  it("names the over-budget situation in the currency the device spends", () => {
    expect(
      backfillOfferCopy({
        ...plus,
        budgeted: 0,
        currency: "cost",
        filingsRemaining: undefined,
      }).body,
    ).toBe("The next day back holds more captures than one run covers.");
  });

  it("keeps every string clear of guilt language and em dashes", () => {
    for (const migrated of [false, true]) {
      for (const budgeted of [100, 0]) {
        const copy = backfillOfferCopy({ ...plus, migrated, budgeted });
        const all = Object.values(copy).join(" ");
        expect(all).not.toMatch(/—/);
        expect(all.toLowerCase()).not.toMatch(
          /backlog|overdue|still need to|you haven't|catch up on|upgrade now|don't miss/,
        );
      }
    }
  });

  it("keeps the ranged variants clear of guilt language and em dashes", () => {
    for (const migrated of [false, true]) {
      const copy = backfillOfferCopy({ ...plus, migrated });
      const all = Object.values(copy).join(" ");
      expect(all).not.toMatch(/—/);
      expect(all.toLowerCase()).not.toMatch(
        /backlog|overdue|still need to|you haven't|catch up on/,
      );
    }
  });
});
