/**
 * Vault smoke for #287 — list Skipped population from test_vault dailies.
 * Product gesture is Reconsider (try filing), not strip-to-queue.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { collectSkippedCaptures } from "../src/home/skippedLibrary";
import { parseCaptures } from "../src/pipeline/parse";
import { resolveSkippedCapture } from "../src/pipeline/unlabel";
import { gateReconsiderTarget } from "../src/pipeline/reconsider";

const VAULT = join(__dirname, "../test_vault/test vault");
const PAST = join(VAULT, "Daily/2026-07-28.md");
const TODAY = join(VAULT, "Daily/2026-08-05.md");

function ensureSeeds(): void {
  if (!existsSync(PAST)) return;
  let past = readFileSync(PAST, "utf8");
  // Always ensure a known noise+task pair for list/gate smoke
  if (!past.includes("QA287 smoke noise")) {
    past +=
      "\n- QA287 smoke noise keepable thought about calm libraries\n\t<!--linker:noise-->\n- QA287 smoke task buy oat milk for dogfood\n\t<!--linker:task-->\n";
    writeFileSync(PAST, past);
  }
  if (existsSync(TODAY)) {
    let today = readFileSync(TODAY, "utf8");
    if (!today.includes("QA287 smoke today")) {
      today +=
        "\n- QA287 smoke today same-day row\n\t<!--linker:noise-->\n";
      writeFileSync(TODAY, today);
    }
  }
}

describe("vault smoke #287 Skipped list + reconsider gate", () => {
  it("lists QA287 smoke noise/task from test_vault dailies", () => {
    if (!existsSync(PAST)) {
      console.warn("skip: test_vault missing");
      return;
    }
    ensureSeeds();
    const past = readFileSync(PAST, "utf8");
    const today = existsSync(TODAY) ? readFileSync(TODAY, "utf8") : "";
    const notes = [
      { path: "Daily/2026-07-28.md", date: "2026-07-28", content: past },
    ];
    if (today) {
      notes.push({
        path: "Daily/2026-08-05.md",
        date: "2026-08-05",
        content: today,
      });
    }
    const qa = collectSkippedCaptures(notes).filter((e) =>
      e.snippet.includes("QA287 smoke"),
    );
    expect(qa.length).toBeGreaterThanOrEqual(2);
    expect(qa.some((e) => e.markerKind === "noise")).toBe(true);
    expect(qa.some((e) => e.markerKind === "task")).toBe(true);
  });

  it("resolve + gate accepts smoke noise for Reconsider promote path", () => {
    if (!existsSync(PAST)) return;
    ensureSeeds();
    const past = readFileSync(PAST, "utf8");
    const entry = collectSkippedCaptures([
      { path: "Daily/2026-07-28.md", date: "2026-07-28", content: past },
    ]).find((e) => e.snippet.includes("QA287 smoke noise"));
    expect(entry).toBeTruthy();
    const cap = resolveSkippedCapture(past, {
      startLine: entry!.startLine,
      snippet: entry!.snippet,
    });
    const gate = gateReconsiderTarget(cap);
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    expect(gate.capture.markerKind).toBe("noise");
    // Body still present for classify
    expect(gate.capture.text).toContain("QA287 smoke noise");
    // Atom markers must not appear as skipped rows
    const atoms = parseCaptures(past).filter((c) => c.markerKind === "atom");
    for (const a of atoms) {
      expect(
        collectSkippedCaptures([
          { path: "x", date: "2026-07-28", content: past },
        ]).some((e) => e.startLine === a.startLine),
      ).toBe(false);
    }
  });
});
