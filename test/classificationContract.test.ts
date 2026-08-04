import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  CLASSIFICATION_PARITY_PHRASES,
  CLASSIFICATION_SCHEMA,
  CLASSIFY_LIVE_ENRICH_ORDER,
  CLASSIFY_OFFLINE_QUALITY_ORDER,
  SYSTEM_PROMPT,
} from "../src/pipeline/classify";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("classification dual-surface parity", () => {
  it("imports plus-service template and matches schema keys + required", async () => {
    const snapshot = (await import(
      "../plus-service/src/classifyTemplate.mjs"
    )) as {
      SYSTEM_PROMPT: string;
      CLASSIFICATION_SCHEMA: typeof CLASSIFICATION_SCHEMA;
    };

    expect(Object.keys(snapshot.CLASSIFICATION_SCHEMA.properties).sort()).toEqual(
      Object.keys(CLASSIFICATION_SCHEMA.properties).sort(),
    );
    expect(snapshot.CLASSIFICATION_SCHEMA.required).toEqual(
      CLASSIFICATION_SCHEMA.required,
    );
    expect(
      snapshot.CLASSIFICATION_SCHEMA.properties.people.items.properties.role.enum,
    ).toEqual(
      CLASSIFICATION_SCHEMA.properties.people.items.properties.role.enum,
    );
    expect(snapshot.CLASSIFICATION_SCHEMA.additionalProperties).toBe(false);
  });

  it("locks load-bearing prompt phrases on both surfaces", async () => {
    const snapshot = (await import(
      "../plus-service/src/classifyTemplate.mjs"
    )) as { SYSTEM_PROMPT: string };

    for (const phrase of CLASSIFICATION_PARITY_PHRASES) {
      expect(SYSTEM_PROMPT, `plugin missing: ${phrase}`).toContain(phrase);
      expect(snapshot.SYSTEM_PROMPT, `plus missing: ${phrase}`).toContain(phrase);
    }
  });

  it("keeps people on the hard-rules output-surface line", () => {
    expect(SYSTEM_PROMPT).toContain(
      "You output ONLY: verdict, title, tags, proposed_tags, links, people, and optional hub_section.",
    );
    // Regression: plugin once omitted people while schema required it.
    expect(SYSTEM_PROMPT).not.toMatch(
      /You output ONLY: verdict, title, tags, proposed_tags, links, and optional hub_section\./,
    );
  });
});

describe("enrich stage order (named lists)", () => {
  it("documents intentional live vs offline order difference", () => {
    expect([...CLASSIFY_LIVE_ENRICH_ORDER]).toEqual([
      "rescueKeepableIdea",
      "normalizePeople",
      "normalizeHubSection",
      "enrichPersonLinks",
      "enrichMediaLinks",
      "maybeLinkPeopleIndex",
      "enrichEntityLinks",
      "improveClassificationLinks",
      "stripSelfReferentialLinks",
      "repairHubSection",
    ]);
    expect([...CLASSIFY_OFFLINE_QUALITY_ORDER]).toEqual([
      "normalizePeople",
      "rescueKeepableIdea",
      "enrichPersonLinks",
      "enrichMediaLinks",
      "maybeLinkPeopleIndex",
      "enrichEntityLinks",
      "improveClassificationLinks",
      "stripSelfReferentialLinks",
      "repairHubSection",
    ]);
    // Live rescues before people normalize; offline normalizes first.
    expect(CLASSIFY_LIVE_ENRICH_ORDER[0]).toBe("rescueKeepableIdea");
    expect(CLASSIFY_OFFLINE_QUALITY_ORDER[0]).toBe("normalizePeople");
  });

  it("keeps order lists aligned with classify.ts call sites", () => {
    const src = readFileSync(join(root, "src/pipeline/classify.ts"), "utf8");
    // Strip // comments so a dead `// stage(` cannot false-pass the scan.
    const stripLineComments = (s: string) =>
      s
        .split("\n")
        .map((line) => line.replace(/\/\/.*$/, ""))
        .join("\n");

    const liveStart = src.indexOf("export async function classifyCapture");
    const offlineStart = src.indexOf("export function applyClassificationQuality");
    expect(liveStart).toBeGreaterThanOrEqual(0);
    expect(offlineStart).toBeGreaterThan(liveStart);

    const liveFn = stripLineComments(src.slice(liveStart, offlineStart));
    // End offline at the next top-level export after applyClassificationQuality body,
    // or EOF — avoid later helpers poisoning the scan.
    const afterOffline = src.slice(offlineStart + 1);
    const nextExportRel = afterOffline.search(/\nexport /);
    const offlineEnd =
      nextExportRel >= 0 ? offlineStart + 1 + nextExportRel : src.length;
    const offlineFn = stripLineComments(src.slice(offlineStart, offlineEnd));

    // Real calls look like `= stage(` or bare `stage(` after assignment, not defs.
    const callRe = (stage: string) =>
      new RegExp(String.raw`(?:=\s*|^\s*)${stage}\s*\(`, "m");

    let liveCursor = 0;
    for (const stage of CLASSIFY_LIVE_ENRICH_ORDER) {
      const slice = liveFn.slice(liveCursor);
      const m = callRe(stage).exec(slice);
      expect(m, `live missing or out of order: ${stage}`).not.toBeNull();
      liveCursor += (m?.index ?? 0) + stage.length;
    }

    let offlineCursor = 0;
    for (const stage of CLASSIFY_OFFLINE_QUALITY_ORDER) {
      const slice = offlineFn.slice(offlineCursor);
      const m = callRe(stage).exec(slice);
      expect(m, `offline missing or out of order: ${stage}`).not.toBeNull();
      offlineCursor += (m?.index ?? 0) + stage.length;
    }

    // Offline repairHubSection is gated — keep the intentional conditional visible.
    expect(offlineFn).toMatch(/if\s*\(\s*details\?\.length\s*\)/);
    expect(offlineFn).toMatch(/repairHubSection\s*\(/);
  });
});
