import { afterEach, describe, expect, it, vi } from "vitest";
import { runWritePath } from "../src/pipeline/write";
import {
  atomResult,
  contextProviderFor as provider,
  fakeClassify,
  fakeVault,
  stubDailyNotes,
} from "./helpers/pipelineVault";

afterEach(() => vi.restoreAllMocks());

describe("runWritePath — in-run visibility (R4)", () => {
  it("shows a later capture the atom an earlier capture in the same run created", async () => {
    // Bottom-up ordering means the *last* line is classified first, so the
    // tandem atom exists by the time the first line is classified.
    const daily = [
      "- the brake cable on the tandem frayed again on the same descent",
      "- rode the tandem down the long descent and the brake cable snapped",
      "",
    ].join("\n");
    const v = fakeVault({ "Daily/2026-07-01.md": daily });
    stubDailyNotes([{ path: "Daily/2026-07-01.md", date: "2026-07-01" }]);

    const classify = fakeClassify([
      atomResult("Tandem brake cable snapped on the descent"),
      atomResult("Brake cable frays on that descent"),
    ]);

    const report = await runWritePath({
      app: v.app,
      contextProvider: provider(v.app),
      apiKey: "k",
      model: "claude-sonnet-5",
      activeVocabulary: ["idea"],
      atomFolder: "Atoms",
      includeToday: true,
      classifyDeps: { request: classify.request as never },
    });

    expect(report.atomsCreated).toBe(2);
    // First request cannot see it — the atom does not exist yet.
    expect(classify.contextBlocks[0]).not.toContain(
      "Tandem brake cable snapped on the descent",
    );
    // Second request must: same run, atom already written.
    expect(classify.contextBlocks[1]).toContain(
      "Tandem brake cable snapped on the descent",
    );
  });
});

describe("runWritePath — behaviour outside context selection (R9)", () => {
  it("processes bottom-up so appended markers never shift a later capture", async () => {
    const daily = [
      "- first line about sourdough starter timing",
      "- second line about pour over grind",
      "- third line about the kayak portage",
      "",
    ].join("\n");
    const v = fakeVault({ "Daily/2026-07-02.md": daily });
    stubDailyNotes([{ path: "Daily/2026-07-02.md", date: "2026-07-02" }]);
    const classify = fakeClassify([
      atomResult("Third"),
      atomResult("Second"),
      atomResult("First"),
    ]);

    await runWritePath({
      app: v.app,
      contextProvider: provider(v.app),
      apiKey: "k",
      model: "claude-sonnet-5",
      activeVocabulary: ["idea"],
      atomFolder: "Atoms",
      classifyDeps: { request: classify.request as never },
    });

    // Last capture first: the classify calls arrive in reverse line order.
    expect(classify.captures[0]).toContain("third line about the kayak portage");
    expect(classify.captures[2]).toContain("first line about sourdough starter");

    // Every capture line survives verbatim with exactly one marker under it.
    const after = v.read("Daily/2026-07-02.md")!.split("\n");
    expect(after[0]).toBe("- first line about sourdough starter timing");
    expect(after[1]).toBe("\t↳ [[First]] <!--linker-->");
    expect(after[2]).toBe("- second line about pour over grind");
    expect(after[3]).toBe("\t↳ [[Second]] <!--linker-->");
    expect(after[4]).toBe("- third line about the kayak portage");
    expect(after[5]).toBe("\t↳ [[Third]] <!--linker-->");
  });

  it("writes the capture text into the atom body byte-for-byte", async () => {
    const text =
      "the espresso  puck   screen changed nothing, but 18.2g in / 36g out did";
    const v = fakeVault({ "Daily/2026-07-03.md": `- ${text}\n` });
    stubDailyNotes([{ path: "Daily/2026-07-03.md", date: "2026-07-03" }]);
    const classify = fakeClassify([atomResult("Ratio beat the puck screen")]);

    await runWritePath({
      app: v.app,
      contextProvider: provider(v.app),
      apiKey: "k",
      model: "claude-sonnet-5",
      activeVocabulary: ["idea"],
      atomFolder: "Atoms",
      classifyDeps: { request: classify.request as never },
    });

    const atom = v.read("Atoms/Ratio beat the puck screen.md")!;
    expect(atom).toContain(text);
  });

  it("classifies and marks a capture whose shortlist is empty", async () => {
    // k=0 forces the empty case. A capture cannot reach it by scoring alone: its own
    // daily note is in the corpus and contains the capture verbatim, so every capture
    // matches at least one candidate in a real vault.
    const v = fakeVault({
      "Daily/2026-07-04.md": "- zzzq wubbly frotz\n",
      "Notes/Unrelated.md": "Sourdough starter timing notes.\n",
    });
    stubDailyNotes([{ path: "Daily/2026-07-04.md", date: "2026-07-04" }]);
    const classify = fakeClassify([atomResult("Frotz is wubbly")]);

    const report = await runWritePath({
      app: v.app,
      contextProvider: provider(v.app),
      apiKey: "k",
      model: "claude-sonnet-5",
      activeVocabulary: ["idea"],
      atomFolder: "Atoms",
      shortlistK: 0,
      classifyDeps: { request: classify.request as never },
    });

    expect(classify.contextBlocks[0]).toContain("### Note titles\n(empty vault)");
    expect(report.atomsCreated).toBe(1);
    expect(report.markersAppended).toBe(1);
    expect(v.read("Daily/2026-07-04.md")).toContain(
      "\t↳ [[Frotz is wubbly]] <!--linker-->",
    );
  });

  it("excludes today by default and includes it on explicit force", async () => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const path = `Daily/${iso}.md`;

    const quiet = fakeVault({ [path]: "- something captured mid-day\n" });
    stubDailyNotes([{ path, date: iso }]);
    const noClassify = fakeClassify([atomResult("Never")]);
    const skipped = await runWritePath({
      app: quiet.app,
      contextProvider: provider(quiet.app),
      apiKey: "k",
      model: "claude-sonnet-5",
      activeVocabulary: ["idea"],
      atomFolder: "Atoms",
      classifyDeps: { request: noClassify.request as never },
    });
    expect(skipped.scanned).toBe(0);
    expect(noClassify.captures).toHaveLength(0);
    expect(quiet.read(path)).toBe("- something captured mid-day\n");

    const forced = fakeVault({ [path]: "- something captured mid-day\n" });
    stubDailyNotes([{ path, date: iso }]);
    const classify = fakeClassify([atomResult("Captured mid-day")]);
    const ran = await runWritePath({
      app: forced.app,
      contextProvider: provider(forced.app),
      apiKey: "k",
      model: "claude-sonnet-5",
      activeVocabulary: ["idea"],
      atomFolder: "Atoms",
      includeToday: true,
      classifyDeps: { request: classify.request as never },
    });
    expect(ran.scanned).toBe(1);
    expect(ran.atomsCreated).toBe(1);
  });
});

describe("runWritePath — filing window (KTD2)", () => {
  it("files inside the window and leaves pre-window dailies byte-identical", async () => {
    const preWindow = "- an old thought from before the window\n";
    const inWindow = "- a thought from inside the window\n";
    const v = fakeVault({
      "Daily/2026-07-01.md": preWindow,
      "Daily/2026-08-06.md": inWindow,
    });
    stubDailyNotes([
      { path: "Daily/2026-07-01.md", date: "2026-07-01" },
      { path: "Daily/2026-08-06.md", date: "2026-08-06" },
    ]);
    const classify = fakeClassify([atomResult("A thought inside the window")]);

    const report = await runWritePath({
      app: v.app,
      contextProvider: provider(v.app),
      apiKey: "k",
      model: "claude-sonnet-5",
      activeVocabulary: ["idea"],
      atomFolder: "Atoms",
      since: "2026-08-01",
      classifyDeps: { request: classify.request as never },
    });

    expect(report.scanned).toBe(1);
    expect(report.markersAppended).toBe(1);
    // The pre-window daily was never read to the model and never written to.
    expect(classify.contextBlocks).toHaveLength(1);
    expect(v.read("Daily/2026-07-01.md")).toBe(preWindow);
    expect(v.read("Daily/2026-08-06.md")).toContain("<!--linker-->");
  });
});

describe("runWritePath — backfill complement bound (KTD3)", () => {
  it("files inside [since, before) and never touches a daily on or after before", async () => {
    // `before` is the filing window's own start: the unattended auto-run owns everything
    // from there forward, so a backfill that files into it is metered double-spend.
    const older = "- a thought from the backfill range\n";
    const inWindow = "- a thought the auto-run already owns\n";
    const v = fakeVault({
      "Daily/2026-07-05.md": older,
      "Daily/2026-08-01.md": inWindow,
      "Daily/2026-08-06.md": inWindow,
    });
    stubDailyNotes([
      { path: "Daily/2026-07-05.md", date: "2026-07-05" },
      { path: "Daily/2026-08-01.md", date: "2026-08-01" },
      { path: "Daily/2026-08-06.md", date: "2026-08-06" },
    ]);
    const classify = fakeClassify([atomResult("A backfilled thought")]);

    const report = await runWritePath({
      app: v.app,
      contextProvider: provider(v.app),
      apiKey: "k",
      model: "claude-sonnet-5",
      activeVocabulary: ["idea"],
      atomFolder: "Atoms",
      since: "2026-07-01",
      before: "2026-08-01",
      classifyDeps: { request: classify.request as never },
    });

    expect(report.scanned).toBe(1);
    expect(report.markersAppended).toBe(1);
    expect(classify.contextBlocks).toHaveLength(1);
    expect(v.read("Daily/2026-07-05.md")).toContain("<!--linker-->");
    // `before` is exclusive — the boundary day itself belongs to the window.
    expect(v.read("Daily/2026-08-01.md")).toBe(inWindow);
    expect(v.read("Daily/2026-08-06.md")).toBe(inWindow);
  });
});

describe("runWritePath — newest-first ordering (backfill only)", () => {
  const threeDailies = () => {
    const v = fakeVault({
      "Daily/2026-07-01.md": "- oldest thought about the sourdough starter\n",
      "Daily/2026-07-02.md": "- middle thought about the pour over grind\n",
      "Daily/2026-07-03.md": "- newest thought about the kayak portage\n",
    });
    stubDailyNotes([
      { path: "Daily/2026-07-01.md", date: "2026-07-01" },
      { path: "Daily/2026-07-02.md", date: "2026-07-02" },
      { path: "Daily/2026-07-03.md", date: "2026-07-03" },
    ]);
    return v;
  };

  it("files the newest dailies when a run is capped", async () => {
    const v = threeDailies();
    const classify = fakeClassify([atomResult("Kayak portage")]);

    await runWritePath({
      app: v.app,
      contextProvider: provider(v.app),
      apiKey: "k",
      model: "claude-sonnet-5",
      activeVocabulary: ["idea"],
      atomFolder: "Atoms",
      maxCaptures: 1,
      order: "newest-first",
      classifyDeps: { request: classify.request as never },
    });

    expect(classify.captures).toHaveLength(1);
    expect(classify.captures[0]).toContain("newest thought about the kayak");
    expect(v.read("Daily/2026-07-03.md")).toContain("<!--linker-->");
    expect(v.read("Daily/2026-07-01.md")).not.toContain("<!--linker-->");
  });

  it("defaults to oldest-first so existing callers are unchanged", async () => {
    const v = threeDailies();
    const classify = fakeClassify([atomResult("Sourdough starter")]);

    await runWritePath({
      app: v.app,
      contextProvider: provider(v.app),
      apiKey: "k",
      model: "claude-sonnet-5",
      activeVocabulary: ["idea"],
      atomFolder: "Atoms",
      maxCaptures: 1,
      classifyDeps: { request: classify.request as never },
    });

    expect(classify.captures[0]).toContain("oldest thought about the sourdough");
    expect(v.read("Daily/2026-07-01.md")).toContain("<!--linker-->");
    expect(v.read("Daily/2026-07-03.md")).not.toContain("<!--linker-->");
  });

  it("reverses the dailies without disturbing bottom-up order inside one", async () => {
    // A flat reverse would file each daily top-down, and an appended marker would then
    // shift every line number the run has not reached yet.
    const v = fakeVault({
      "Daily/2026-07-01.md": ["- old first line", "- old second line", ""].join(
        "\n",
      ),
      "Daily/2026-07-02.md": ["- new first line", "- new second line", ""].join(
        "\n",
      ),
    });
    stubDailyNotes([
      { path: "Daily/2026-07-01.md", date: "2026-07-01" },
      { path: "Daily/2026-07-02.md", date: "2026-07-02" },
    ]);
    const classify = fakeClassify([
      atomResult("New second"),
      atomResult("New first"),
      atomResult("Old second"),
      atomResult("Old first"),
    ]);

    await runWritePath({
      app: v.app,
      contextProvider: provider(v.app),
      apiKey: "k",
      model: "claude-sonnet-5",
      activeVocabulary: ["idea"],
      atomFolder: "Atoms",
      order: "newest-first",
      classifyDeps: { request: classify.request as never },
    });

    const order = [
      "new second line",
      "new first line",
      "old second line",
      "old first line",
    ];
    expect(classify.captures).toHaveLength(order.length);
    order.forEach((line, i) => expect(classify.captures[i]).toContain(line));
    const after = v.read("Daily/2026-07-02.md")!.split("\n");
    expect(after[0]).toBe("- new first line");
    expect(after[1]).toBe("\t↳ [[New first]] <!--linker-->");
    expect(after[2]).toBe("- new second line");
    expect(after[3]).toBe("\t↳ [[New second]] <!--linker-->");
  });
});

describe("runWritePath — meter exhaustion abort", () => {
  /** Plus proxy double: Anthropic-shaped 200s until the meter runs out, then 402. */
  const plusMeter = (okCalls: number) => {
    const calls: string[] = [];
    const request = async (opts: { body?: string }) => {
      const body = JSON.parse(opts.body ?? "{}") as { capture?: string };
      calls.push(body.capture ?? "");
      if (calls.length > okCalls) {
        return {
          status: 402,
          json: { message: "Included filings used up this period." },
        };
      }
      return {
        status: 200,
        json: {
          content: [
            {
              type: "text",
              text: JSON.stringify(atomResult(`Atom ${calls.length}`)),
            },
          ],
          usage: {},
        },
      };
    };
    return { request, calls };
  };

  const threeCaptures = () => {
    const v = fakeVault({
      "Daily/2026-07-01.md": [
        "- first thought about the sourdough starter",
        "- second thought about the pour over grind",
        "- third thought about the kayak portage",
        "",
      ].join("\n"),
    });
    stubDailyNotes([{ path: "Daily/2026-07-01.md", date: "2026-07-01" }]);
    return v;
  };

  const plusDeps = (request: unknown) => ({
    request: request as never,
    plus: { baseUrl: "https://plus.example", sessionToken: "t" },
  });

  it("halts on the first exhausted response with no further classify calls", async () => {
    const v = threeCaptures();
    const meter = plusMeter(1);

    const report = await runWritePath({
      app: v.app,
      contextProvider: provider(v.app),
      apiKey: "",
      model: "claude-sonnet-5",
      activeVocabulary: ["idea"],
      atomFolder: "Atoms",
      stopOnAuthExhausted: true,
      classifyDeps: plusDeps(meter.request),
    });

    expect(meter.calls).toHaveLength(2);
    expect(report.atomsCreated).toBe(1);
    expect(report.markersAppended).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.stoppedReason).toBe("exhausted");
    expect(report.failures[0]?.reason).toBe("quota");
  });

  it("distinguishes exhaustion from an ordinary failure", async () => {
    const v = threeCaptures();
    const offline = {
      request: (async () => {
        throw new Error("network down");
      }) as never,
      plus: { baseUrl: "https://plus.example", sessionToken: "t" },
    };

    const report = await runWritePath({
      app: v.app,
      contextProvider: provider(v.app),
      apiKey: "",
      model: "claude-sonnet-5",
      activeVocabulary: ["idea"],
      atomFolder: "Atoms",
      stopOnAuthExhausted: true,
      classifyDeps: offline,
    });

    expect(report.failed).toBe(3);
    expect(report.stoppedReason).toBeUndefined();
  });

  it("keeps walking the whole slice for existing callers", async () => {
    const v = threeCaptures();
    const meter = plusMeter(1);

    const report = await runWritePath({
      app: v.app,
      contextProvider: provider(v.app),
      apiKey: "",
      model: "claude-sonnet-5",
      activeVocabulary: ["idea"],
      atomFolder: "Atoms",
      classifyDeps: plusDeps(meter.request),
    });

    expect(meter.calls).toHaveLength(3);
    expect(report.failed).toBe(2);
    expect(report.stoppedReason).toBeUndefined();
  });
});
