/**
 * Measurement-series seatbelt (2026-08-21 plan, KD5/KTD1): the model is taught
 * readings of durable things generally in SYSTEM_PROMPT; this heuristic only
 * rescues the narrow, high-precision shape from a lingering noise verdict.
 * Prefer miss over promoting a chore — a quantity inside an errand is not a
 * reading. Never demotes atoms, never rewrites the body.
 */

import type { ClassificationResult } from "../../shared/types";
import { shortTitleFromCapture } from "./ideaRescue";

/** Errand openers: "pay $1200 rent tomorrow" is a chore, not a reading. */
const CHORE_LEAD_RE =
  /^\s*(?:buy|pay|call|email|text|order|schedule|book|pick\s+up|drop\s+off|get|grab|renew)\b/i;

/**
 * An activity distance ("ran 6 miles", "need to drive 60 to 70 miles") is how
 * far somebody moved, not a durable thing's number. Scrubbed before testing so
 * it can neither qualify a capture nor block one that also holds a real
 * reading ("…drive 60 to 70 miles…" still reads via "at 73042").
 */
const ACTIVITY_DISTANCE_RE =
  /\b(?:ran|run(?:ning)?|walk(?:ed|ing)?|jog(?:ged|ging)?|hik(?:ed|ing)|drove|drive|driving|cycl(?:ed|ing)|bik(?:ed|ing)|swam)\b[^.\n]{0,24}?\b\d[\d,]*(?:\.\d+)?\s*(?:miles?|mi|km|kilometers?)\b/gi;

/**
 * Durable things whose numbers form a series. Deliberately short — the model
 * carries the general concept; this list only covers shapes we have watched
 * fail (odometer) plus the obvious neighbours.
 */
const THING_RE =
  /\b(car|truck|bike|motorcycle|vehicle|odometer|mileage|miles?|scale|weight|weigh(?:ed|s|t)?|meter|rent)\b/gi;

/**
 * Reading-value shapes. The 3+ digit floor on the bare "at N" arm keeps times
 * ("at 3") and places ("at 5th") out; the lookahead drops "at 230pm".
 */
const VALUE_RES: readonly RegExp[] = [
  /\bat\s+\d[\d,]{2,}(?:\.\d+)?\b(?!\s*(?:am|pm)\b)/i,
  /\b\d[\d,]*(?:\.\d+)?\s*(?:miles?|mi|km|kilometers?|lbs?|pounds?|kg|kwh|psi)\b/i,
  /\bis\s+(?:now\s+)?\$\s?\d[\d,]*(?:\.\d+)?\b/i,
  /\bweighed(?:\s+in)?\s+at\s+\d/i,
];

function scrubbed(captureText: string): string {
  return (captureText ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(ACTIVITY_DISTANCE_RE, " ");
}

/** High-precision: a short capture reading a durable thing's number. */
export function isMeasurementReading(captureText: string): boolean {
  const t = scrubbed(captureText);
  if (!t || t.length > 200) return false;
  if (CHORE_LEAD_RE.test(t)) return false;
  THING_RE.lastIndex = 0;
  if (!THING_RE.test(t)) return false;
  return VALUE_RES.some((re) => re.test(t));
}

/**
 * The measured thing behind a reading, normalized so two captures about the
 * same series share a key. Concrete nouns win over generic units: "My miles in
 * my car" keys on the car, not the miles. Null when not a reading.
 */
export function measuredThingKey(captureText: string): string | null {
  if (!isMeasurementReading(captureText)) return null;
  const t = scrubbed(captureText);
  THING_RE.lastIndex = 0;
  const found = new Set<string>();
  for (const m of t.matchAll(THING_RE)) {
    found.add(m[1]!.toLowerCase());
  }
  for (const concrete of ["car", "truck", "bike", "motorcycle", "rent", "meter"]) {
    if (found.has(concrete)) return concrete;
  }
  for (const k of found) {
    if (/^(odometer|mileage|miles?|vehicle)$/.test(k)) return "car";
  }
  for (const k of found) {
    if (/^(weigh(?:ed|s|t)?|scale|weight)$/.test(k)) return "weight";
  }
  return null;
}

/** Hub title offered when a series proves itself (invite copy owns phrasing). */
export function measuredThingHubTitle(key: string): string {
  if (key === "weight") return "My weight";
  return `My ${key}`;
}

/**
 * If verdict is task/noise and the capture is a reading, promote to atom.
 * Mirrors rescueKeepableIdea's contract: never demotes, body written elsewhere.
 */
export function rescueMeasurementReading(
  captureText: string,
  result: ClassificationResult,
): ClassificationResult {
  if (result.verdict !== "task" && result.verdict !== "noise") return result;
  if (!isMeasurementReading(captureText)) return result;
  return {
    ...result,
    verdict: "atom",
    title: shortTitleFromCapture(captureText),
    tags: result.tags ?? [],
    links: result.links ?? [],
  };
}
