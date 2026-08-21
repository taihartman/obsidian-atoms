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
  /\b(?:ran|run(?:ning)?|walk(?:ed|ing)?|jog(?:ged|ging)?|hik(?:ed|ing)|drove|drive|driving|cycl(?:ed|ing)|bik(?:ed|ing)|rode|rid(?:e|ing|den)|flew|flown|fly(?:ing)?|swam)\b[^.\n]{0,24}?\b\d[\d,]*(?:\.\d+)?\s*(?:miles?|mi|km|kilometers?)\b/gi;

/**
 * Durable things whose numbers form a series. Deliberately short — the model
 * carries the general concept; this list only covers shapes we have watched
 * fail (odometer) plus the obvious neighbours. Bare distance/verb words
 * ("miles", "weighs") are NOT things: "Half marathon is 13.1 miles" and "The
 * bag weighs 40 lbs" are facts about a race and a bag, not series points.
 */
const THING_RE =
  /\b(car|truck|bike|motorcycle|vehicle|odometer|mileage|scale|weight|meter|rent)\b/gi;

/** The self weigh-in idiom is a reading even without the word "weight". */
const WEIGH_IN_RE = /\bweigh(?:ed)?\s+in\b/i;

/** A capture that is nothing but an odometer number is a car reading. */
const BARE_ODOMETER_RE = /^\d[\d,]{2,}(?:\.\d+)?\s*(?:miles|mi|km)$/i;

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

function hasThing(t: string): boolean {
  THING_RE.lastIndex = 0;
  return THING_RE.test(t) || WEIGH_IN_RE.test(t) || BARE_ODOMETER_RE.test(t);
}

/** High-precision: a short capture reading a durable thing's number. */
export function isMeasurementReading(captureText: string): boolean {
  const t = scrubbed(captureText);
  if (!t || t.length > 200) return false;
  if (CHORE_LEAD_RE.test(t)) return false;
  if (!hasThing(t)) return false;
  return VALUE_RES.some((re) => re.test(t));
}

function normalizeThing(raw: string): string {
  if (/^(odometer|mileage|vehicle)$/.test(raw)) return "car";
  if (/^(scale|weight)$/.test(raw)) return "weight";
  return raw;
}

/**
 * Every measured thing a text names, normalized, with no reading-value
 * requirement. The loop side of a close offer uses this: "come back into QGS
 * automotive" mentions the car without reading its number.
 */
export function measuredThingMentions(text: string): Set<string> {
  const out = new Set<string>();
  const t = text ?? "";
  THING_RE.lastIndex = 0;
  for (const m of t.matchAll(THING_RE)) {
    out.add(normalizeThing(m[1]!.toLowerCase()));
  }
  if (WEIGH_IN_RE.test(t)) out.add("weight");
  if (BARE_ODOMETER_RE.test(t.trim())) out.add("car");
  return out;
}

/**
 * The measured thing behind a reading, normalized so two captures about the
 * same series share a key. Concrete nouns win over generic units: "My miles in
 * my car" keys on the car, not the miles. Null when not a reading.
 */
export function measuredThingKey(captureText: string): string | null {
  if (!isMeasurementReading(captureText)) return null;
  const t = scrubbed(captureText);
  const found = measuredThingMentions(t);
  for (const concrete of ["car", "truck", "bike", "motorcycle", "rent", "meter"]) {
    if (found.has(concrete)) return concrete;
  }
  return found.has("weight") ? "weight" : null;
}

/** Hub title offered when a series proves itself (invite copy owns phrasing). */
export function measuredThingHubTitle(key: string): string {
  if (key === "weight") return "My weight";
  return `My ${key}`;
}

/** The one series-link reason, shared by enrich and the Home accept path. */
export function seriesLinkReason(label: string): string {
  return `new reading in the [[${label.trim()}]] series`;
}

/**
 * Deterministic half of series linking (KD2): when the thing's hub note
 * already exists under Note titles, hard-link it. Prior-reading chaining is
 * fuzzier and stays the model's job (prompt "Series linking (MUST)").
 */
export function enrichMeasurementLinks(
  captureText: string,
  result: ClassificationResult,
  noteTitles: string[],
): ClassificationResult {
  if (result.verdict !== "atom") return result;
  const key = measuredThingKey(captureText);
  if (!key) return result;
  const want = measuredThingHubTitle(key).toLowerCase();
  const hub = noteTitles.find((t) => t.trim().toLowerCase() === want);
  if (!hub) return result;
  const links = result.links ?? [];
  if (links.some((l) => (l.note ?? "").trim().toLowerCase() === want)) {
    return result;
  }
  return {
    ...result,
    links: [...links, { note: hub.trim(), reason: seriesLinkReason(hub) }],
  };
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
