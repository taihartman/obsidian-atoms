import { describe, expect, it } from "vitest";
import {
  enrichMeasurementLinks,
  isMeasurementReading,
  measuredThingKey,
  measuredThingHubTitle,
  rescueMeasurementReading,
  seriesLinkReason,
} from "../src/pipeline/enrich/measurement";
import { applyClassificationQuality } from "../src/pipeline/classify";
import { forceKeepAtomResult } from "../src/pipeline/reconsider";
import type { ClassificationResult } from "../src/shared/types";

/** The live pair that spawned #589, verbatim. */
const READING_73042 =
  "My miles in my car at 73042 I need to drive 60 to 70 miles and come back into QGS automotive";
const READING_73089 = "My car is at 73089 miles";

const noiseResult = (over: Partial<ClassificationResult> = {}): ClassificationResult => ({
  verdict: "noise",
  title: "",
  tags: [],
  proposed_tags: [],
  links: [],
  ...over,
});

describe("isMeasurementReading", () => {
  it("recognizes the live pair verbatim", () => {
    expect(isMeasurementReading(READING_73042)).toBe(true);
    expect(isMeasurementReading(READING_73089)).toBe(true);
  });

  it("generalizes to weight, rent, and bare odometer captures", () => {
    expect(isMeasurementReading("Weighed in at 178 this morning")).toBe(true);
    expect(isMeasurementReading("Rent is $1450 now")).toBe(true);
    expect(isMeasurementReading("73150 miles")).toBe(true);
  });

  it("never promotes chores that carry a quantity", () => {
    expect(isMeasurementReading("buy milk")).toBe(false);
    expect(isMeasurementReading("buy 2 gallons of milk")).toBe(false);
    expect(isMeasurementReading("call dentist at 3")).toBe(false);
    expect(isMeasurementReading("pay $1200 rent tomorrow")).toBe(false);
    expect(isMeasurementReading("pick up the car at 5")).toBe(false);
  });

  it("an activity distance is not a thing's reading", () => {
    expect(isMeasurementReading("Ran 6 miles")).toBe(false);
    expect(isMeasurementReading("Drove 300 miles today")).toBe(false);
    expect(isMeasurementReading("Rode 20 miles on the trainer")).toBe(false);
    expect(isMeasurementReading("Flew 2800 miles to Tokyo")).toBe(false);
  });

  it("a distance or weight fact about something else is not a reading", () => {
    expect(isMeasurementReading("Half marathon is 13.1 miles")).toBe(false);
    expect(isMeasurementReading("The lake trail is 5 miles")).toBe(false);
    expect(isMeasurementReading("My commute is 18 miles each way")).toBe(false);
    expect(isMeasurementReading("The bag weighs 40 lbs")).toBe(false);
  });

  it("times and places never read as values", () => {
    expect(isMeasurementReading("car wash at 230pm")).toBe(false);
    expect(isMeasurementReading("parked the car at 5th street")).toBe(false);
    expect(isMeasurementReading("10:30")).toBe(false);
    expect(isMeasurementReading("")).toBe(false);
  });

  it("long captures are not the seatbelt's job", () => {
    const long = `My car is at 73089 miles. ${"More prose. ".repeat(30)}`;
    expect(isMeasurementReading(long)).toBe(false);
  });
});

describe("measuredThingKey", () => {
  it("keys both live captures to the same series", () => {
    expect(measuredThingKey(READING_73042)).toBe("car");
    expect(measuredThingKey(READING_73089)).toBe("car");
  });

  it("concrete nouns win over generic units", () => {
    expect(measuredThingKey("73150 miles")).toBe("car");
    expect(measuredThingKey("Weighed in at 178 this morning")).toBe("weight");
    expect(measuredThingKey("Rent is $1450 now")).toBe("rent");
  });

  it("is null for non-readings", () => {
    expect(measuredThingKey("Ran 6 miles")).toBe(null);
    expect(measuredThingKey("buy 2 gallons of milk")).toBe(null);
  });

  it("hub titles read as ownership", () => {
    expect(measuredThingHubTitle("car")).toBe("My car");
    expect(measuredThingHubTitle("weight")).toBe("My weight");
  });
});

describe("enrichMeasurementLinks", () => {
  const atomResult = (over: Partial<ClassificationResult> = {}): ClassificationResult =>
    noiseResult({ verdict: "atom", title: "Car odometer reads 73089 miles", ...over });

  it("hard-links the thing hub when the title exists", () => {
    const r = enrichMeasurementLinks(READING_73089, atomResult(), ["My car", "Alex"]);
    expect(r.links).toEqual([
      { note: "My car", reason: seriesLinkReason("My car") },
    ]);
  });

  it("matches the hub title case-insensitively and keeps vault casing", () => {
    const r = enrichMeasurementLinks(READING_73089, atomResult(), ["my Car"]);
    expect(r.links?.[0]?.note).toBe("my Car");
  });

  it("never duplicates an existing hub link", () => {
    const withLink = atomResult({
      links: [{ note: "My car", reason: "model already linked it" }],
    });
    const r = enrichMeasurementLinks(READING_73089, withLink, ["My car"]);
    expect(r).toBe(withLink);
  });

  it("no hub in titles means no invented link", () => {
    const base = atomResult();
    expect(enrichMeasurementLinks(READING_73089, base, ["Alex"])).toBe(base);
  });

  it("leaves non-readings and non-atoms alone", () => {
    const base = atomResult();
    expect(enrichMeasurementLinks("watch Past Lives", base, ["My car"])).toBe(base);
    const noise = noiseResult();
    expect(enrichMeasurementLinks(READING_73089, noise, ["My car"])).toBe(noise);
  });
});

describe("rescueMeasurementReading", () => {
  it("promotes a noise reading to atom with a non-empty title", () => {
    const r = rescueMeasurementReading(READING_73089, noiseResult());
    expect(r.verdict).toBe("atom");
    expect(r.title.trim().length).toBeGreaterThan(0);
    expect(r.title.length).toBeLessThanOrEqual(90);
  });

  it("promotes a task reading too (soft-retired verdict)", () => {
    const r = rescueMeasurementReading(
      "Weighed in at 178 this morning",
      noiseResult({ verdict: "task" }),
    );
    expect(r.verdict).toBe("atom");
  });

  it("leaves an atom verdict untouched", () => {
    const atom = noiseResult({ verdict: "atom", title: "Car odometer reads 73089 miles" });
    expect(rescueMeasurementReading(READING_73089, atom)).toBe(atom);
  });

  it("leaves non-reading noise as noise", () => {
    const noise = noiseResult();
    expect(rescueMeasurementReading("buy 2 gallons of milk", noise)).toBe(noise);
  });

  it("rescue then hub enrich files a linked atom, never an island", () => {
    const promoted = rescueMeasurementReading(READING_73089, noiseResult());
    const linked = enrichMeasurementLinks(READING_73089, promoted, ["My car"]);
    expect(linked.verdict).toBe("atom");
    expect(linked.links).toEqual([
      { note: "My car", reason: seriesLinkReason("My car") },
    ]);
  });

  it("carries existing tags and links through the promotion", () => {
    const r = rescueMeasurementReading(
      READING_73089,
      noiseResult({ tags: ["list"], links: [{ note: "My car", reason: "series" }] }),
    );
    expect(r.tags).toEqual(["list"]);
    expect(r.links).toEqual([{ note: "My car", reason: "series" }]);
  });
});

describe("Keep as note runs the enrichment chain (#589 KD6 / AE8)", () => {
  it("a forced keep with a same-thread hub in context is never an island", () => {
    const kept = applyClassificationQuality(
      READING_73089,
      forceKeepAtomResult(READING_73089),
      { titles: ["My car", "Alex"] },
    );
    expect(kept.verdict).toBe("atom");
    expect(kept.links?.some((l) => l.note === "My car")).toBe(true);
  });

  it("a forced keep with no matching titles stays a clean atom", () => {
    const kept = applyClassificationQuality(
      "some stray thought worth keeping",
      forceKeepAtomResult("some stray thought worth keeping"),
      { titles: ["My car"] },
    );
    expect(kept.verdict).toBe("atom");
    expect(kept.links ?? []).toEqual([]);
  });
});
