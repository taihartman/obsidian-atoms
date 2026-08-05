/**
 * Vault smoke for #287 — reads test_vault dailies (no Obsidian app).
 * Seeds expected QA287 markers if missing so CI without prior seed still passes list shape.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { collectSkippedCaptures } from "../src/home/skippedLibrary";
import { parseCaptures } from "../src/pipeline/parse";
import {
  restoreSkippedInContent,
  unlabelNoticeMessage,
  unlabelSkippedInContent,
} from "../src/pipeline/unlabel";

const VAULT = join(
  __dirname,
  "../test_vault/test vault",
);
const PAST = join(VAULT, "Daily/2026-07-28.md");
const TODAY = join(VAULT, "Daily/2026-08-05.md");

function ensureSeeds(): void {
  if (!existsSync(PAST)) return;
  let past = readFileSync(PAST, "utf8");
  if (!past.includes("QA287 past noise")) {
    past +=
      "\n- QA287 past noise keepable thought about calm libraries\n\t<!--linker:noise-->\n- QA287 past task buy oat milk for dogfood\n\t<!--linker:task-->\n";
    writeFileSync(PAST, past);
  }
  if (existsSync(TODAY)) {
    let today = readFileSync(TODAY, "utf8");
    if (!today.includes("QA287 today noise")) {
      today +=
        "\n- QA287 today noise same-day unlabel copy check\n\t<!--linker:noise-->\n";
      writeFileSync(TODAY, today);
    }
  }
}

describe("vault smoke #287 Skipped unlabel", () => {
  it("lists QA287 noise/task from test_vault dailies", () => {
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
      e.snippet.includes("QA287"),
    );
    expect(qa.length).toBeGreaterThanOrEqual(2);
    expect(qa.some((e) => e.markerKind === "noise")).toBe(true);
    expect(qa.some((e) => e.markerKind === "task")).toBe(true);
  });

  it("unlabel past noise → unprocessed; notice truth; restore round-trip", () => {
    if (!existsSync(PAST)) return;
    ensureSeeds();
    const past = readFileSync(PAST, "utf8");
    const caps = parseCaptures(past);
    const noise = caps.find(
      (c) =>
        c.markerKind === "noise" && c.text.includes("QA287 past noise"),
    );
    expect(noise).toBeTruthy();
    const r = unlabelSkippedInContent(past, {
      startLine: noise!.startLine,
      snippet: noise!.text,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe("noise");
    const after = parseCaptures(r.content).find((c) =>
      c.text.includes("QA287 past noise"),
    );
    expect(after?.processed).toBe(false);
    expect(after?.text).toContain("QA287 past noise");

    expect(unlabelNoticeMessage("2026-07-28", "2026-08-05")).toMatch(
      /next Process/,
    );
    expect(unlabelNoticeMessage("2026-08-05", "2026-08-05")).toMatch(
      /Process today/,
    );

    const back = restoreSkippedInContent(r.content, {
      startLine: noise!.startLine,
      snippet: noise!.text,
      kind: "noise",
    });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const restored = parseCaptures(back.content).find((c) =>
      c.text.includes("QA287 past noise"),
    );
    expect(restored?.markerKind).toBe("noise");

    // Leave vault with one noise unlabeled so home Skipped can show delta in dogfood
    writeFileSync(PAST, r.content);
  });
});
