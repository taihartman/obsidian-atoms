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
