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
    const liveFn = src.slice(
      src.indexOf("export async function classifyCapture"),
      src.indexOf("export function applyClassificationQuality"),
    );
    const offlineFn = src.slice(
      src.indexOf("export function applyClassificationQuality"),
    );

    let liveCursor = 0;
    for (const stage of CLASSIFY_LIVE_ENRICH_ORDER) {
      const at = liveFn.indexOf(`${stage}(`, liveCursor);
      expect(at, `live missing or out of order: ${stage}`).toBeGreaterThanOrEqual(0);
      liveCursor = at + stage.length;
    }

    let offlineCursor = 0;
    for (const stage of CLASSIFY_OFFLINE_QUALITY_ORDER) {
      const at = offlineFn.indexOf(`${stage}(`, offlineCursor);
      expect(
        at,
        `offline missing or out of order: ${stage}`,
      ).toBeGreaterThanOrEqual(0);
      offlineCursor = at + stage.length;
    }
  });
});
