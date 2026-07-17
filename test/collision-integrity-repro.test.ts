import { describe, it, expect } from "vitest";
import { parseCaptures, unprocessedCaptures } from "../src/pipeline/parse";
import {
  applyWrite,
  captureTextsMatch,
  insertMarkerAfterCapture,
  markerLineForDecision,
  planWrite,
  atomPathForTitle,
} from "../src/pipeline/render";
import { extractCaptureBody } from "../src/pipeline/refreshAtoms";
import type { App, TFile } from "obsidian";

function atomMd(capture: string, title = "T"): string {
  return [
    "---",
    `created: 2026-07-16`,
    'source: "[[2026-07-16]]"',
    "generated-by: linker",
    "tags: []",
    "---",
    "",
    capture,
    "",
  ].join("\n");
}

describe("captureTextsMatch", () => {
  it("normalizes whitespace", () => {
    expect(captureTextsMatch("a  b\n c", "a b c")).toBe(true);
    expect(captureTextsMatch("a", "b")).toBe(false);
  });
});

describe("collision integrity — body gate", () => {
  it("plans skip_existing_atom when title path exists", () => {
    const daily = [
      "- Grok seems like it has really good usage limits",
      "- Nichita is waiting back to hear about her interview at the Penfield hospital",
      "",
    ].join("\n");
    const caps = unprocessedCaptures(parseCaptures(daily));
    const grok = caps[0]!;
    const penfieldTitle =
      "Nichita still waiting on Penfield hospital interview response";
    const penfieldPath = atomPathForTitle("Atoms", penfieldTitle);

    const plan = planWrite({
      result: {
        verdict: "atom",
        title: penfieldTitle,
        tags: [],
        proposed_tags: [],
        links: [],
      },
      capture: grok,
      dailyPath: "Quick Notes/2026-07-16.md",
      dailyDate: "2026-07-16",
      atomFolder: "Atoms",
      existingAtomPaths: new Set([penfieldPath]),
    });
    expect(plan.action.kind).toBe("skip_existing_atom");
  });

  it("applyWrite does not append foreign marker when body mismatches", async () => {
    const daily = [
      "- Grok seems like it has really good usage limits",
      "- other",
      "",
    ].join("\n");
    const caps = unprocessedCaptures(parseCaptures(daily));
    const grok = caps[0]!;
    const penfieldTitle =
      "Nichita still waiting on Penfield hospital interview response";
    const penfieldPath = atomPathForTitle("Atoms", penfieldTitle);
    const existingBody = atomMd(
      "Nichita is waiting back to hear about her interview at the Penfield hospital",
    );

    const plan = planWrite({
      result: {
        verdict: "atom",
        title: penfieldTitle,
        tags: [],
        proposed_tags: [],
        links: [],
      },
      capture: grok,
      dailyPath: "Quick Notes/2026-07-16.md",
      dailyDate: "2026-07-16",
      atomFolder: "Atoms",
      existingAtomPaths: new Set([penfieldPath]),
    });

    const { result, newDailyContent } = await applyWrite(
      {} as App,
      plan,
      daily,
      {
        existingAtomContent: existingBody,
        extractCaptureBody,
      },
    );

    expect(result.collisionBodyMismatch).toBe(true);
    expect(result.markerAppended).toBe(false);
    expect(newDailyContent).toBe(daily);
    // Still unprocessed after gate
    const after = parseCaptures(newDailyContent);
    expect(after[0]!.processed).toBe(false);
  });

  it("applyWrite appends marker when collision body matches", async () => {
    const captureText = "Grok seems like it has really good usage limits";
    const daily = [`- ${captureText}`, "- other", ""].join("\n");
    const caps = unprocessedCaptures(parseCaptures(daily));
    const grok = caps[0]!;
    const title = "Grok has strong usage limits but UI generation lags Claude";
    const path = atomPathForTitle("Atoms", title);
    const existingBody = atomMd(captureText, title);

    const plan = planWrite({
      result: {
        verdict: "atom",
        title,
        tags: [],
        proposed_tags: [],
        links: [],
      },
      capture: grok,
      dailyPath: "Quick Notes/2026-07-16.md",
      dailyDate: "2026-07-16",
      atomFolder: "Atoms",
      existingAtomPaths: new Set([path]),
    });

    const modified: string[] = [];
    const mockApp = {
      vault: {
        getAbstractFileByPath: (p: string) => {
          if (p === plan.dailyPath) {
            return { path: p } as TFile;
          }
          return null;
        },
        modify: async (_f: TFile, content: string) => {
          modified.push(content);
        },
        read: async () => existingBody,
        createFolder: async () => {},
        create: async () => {},
      },
    } as unknown as App;

    const { result, newDailyContent } = await applyWrite(mockApp, plan, daily, {
      existingAtomContent: existingBody,
      extractCaptureBody,
    });

    expect(result.collisionBodyMismatch).toBe(false);
    expect(result.markerAppended).toBe(true);
    expect(result.atomSkippedCollision).toBe(path);
    expect(newDailyContent).toContain(markerLineForDecision("atom", title));
    const after = parseCaptures(newDailyContent);
    expect(after[0]!.processed).toBe(true);
  });

  it("reprocess after wrong marker still blocked by already-has-marker (legacy poison)", () => {
    const daily = [
      "- Grok seems like it has really good usage limits",
      "\t↳ [[Nichita still waiting on Penfield hospital interview response]] <!--linker-->",
      "- other",
      "",
    ].join("\n");
    const caps = parseCaptures(daily);
    const grok = caps[0]!;
    expect(grok.processed).toBe(true);
    expect(unprocessedCaptures(caps).map((c) => c.text)).not.toContain(
      grok.text,
    );
    // insert is idempotent — cannot auto-heal without stripping marker
    const again = insertMarkerAfterCapture(
      daily,
      { ...grok, processed: false },
      markerLineForDecision("atom", "Correct Grok title"),
    );
    expect(again.changed).toBe(false);
  });
});
