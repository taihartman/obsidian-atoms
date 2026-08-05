import { describe, expect, it } from "vitest";
import {
  collectSkippedCaptures,
  snippetFromCaptureText,
} from "../src/home/skippedLibrary";

describe("collectSkippedCaptures", () => {
  it("includes noise and task; excludes atom and unprocessed", () => {
    const content = [
      "- keepable idea",
      "\t<!--linker:noise-->",
      "- buy milk",
      "\t<!--linker:task-->",
      "- filed atom",
      "\t↳ [[Filed atom]] <!--linker-->",
      "- still open",
      "",
    ].join("\n");
    const rows = collectSkippedCaptures([
      { path: "Daily/2026-08-01.md", date: "2026-08-01", content },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.markerKind).sort()).toEqual(["noise", "task"]);
    expect(rows.every((r) => r.path === "Daily/2026-08-01.md")).toBe(true);
  });

  it("skips empty bullets", () => {
    const content = ["-   ", "\t<!--linker:noise-->", ""].join("\n");
    expect(
      collectSkippedCaptures([
        { path: "d.md", date: "2026-08-01", content },
      ]),
    ).toHaveLength(0);
  });

  it("sorts newer dates first", () => {
    const rows = collectSkippedCaptures([
      {
        path: "a.md",
        date: "2026-07-01",
        content: ["- old", "\t<!--linker:noise-->", ""].join("\n"),
      },
      {
        path: "b.md",
        date: "2026-08-01",
        content: ["- new", "\t<!--linker:noise-->", ""].join("\n"),
      },
    ]);
    expect(rows[0]!.date).toBe("2026-08-01");
    expect(rows[1]!.date).toBe("2026-07-01");
  });

  it("snippet clamps long text", () => {
    const long = "x".repeat(200);
    expect(snippetFromCaptureText(long).endsWith("…")).toBe(true);
    expect(snippetFromCaptureText(long).length).toBeLessThanOrEqual(120);
  });
});
