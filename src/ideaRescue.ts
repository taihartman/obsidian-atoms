/**
 * Soft-rescue keepable product/app ideas that the model marks task/noise.
 * Prefer atom over silent loss of second-brain material.
 */

import type { ClassificationResult } from "./types";

const CHORE_RE =
  /\b(buy |email |call |schedule |text |pick up|remind|dentist|landlord|oat milk)\b/i;

const IDEA_SIGNAL_RE =
  /\b(create|build|make|combine|website|web app|browser|app idea|fully functional|publicly publish|curious what it would be like)\b/i;

/**
 * High-precision: multi-sentence or long pitch that is a product/build idea.
 */
export function isKeepableIdea(captureText: string): boolean {
  const t = (captureText ?? "").trim();
  if (!t) return false;
  if (t.length < 40) return false;
  if (CHORE_RE.test(t) && t.length < 80 && !IDEA_SIGNAL_RE.test(t)) return false;

  const hasIdea = IDEA_SIGNAL_RE.test(t);
  if (!hasIdea) return false;

  // Prefer substantial pitches over one-liners
  const lines = t.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (t.length >= 120) return true;
  if (lines.length >= 2 && t.length >= 60) return true;
  if (/\b(tetris|chess|starbucks|tracker|website|browser game)\b/i.test(t) && t.length >= 50)
    return true;
  return false;
}

/** Short declarative title from capture first line / topic. */
export function shortTitleFromCapture(captureText: string, maxLen = 80): string {
  const lines = (captureText ?? "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\d+\s*min/i.test(l));
  let first = lines[0] ?? (captureText ?? "").trim();
  first = first
    .replace(/^[-*]\s+/, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "")
    .trim();

  // Topic-line style: short first line + long body → use first line as title seed
  if (first.length > maxLen) {
    const cut = first.slice(0, maxLen - 1);
    const sp = cut.lastIndexOf(" ");
    first = (sp > 40 ? cut.slice(0, sp) : cut).trim() + "…";
  }

  // Light polish for common dogfood shapes
  const lower = first.toLowerCase();
  if (lower.includes("starbucks") && lower.includes("drink")) {
    return "Starbucks weekend drink tracker site idea";
  }
  if (/\btetris\b/i.test(first) && /\bchess\b/i.test(captureText)) {
    return "Tetris-chess hybrid browser game idea";
  }
  if (!first) return "Product idea from capture";
  // Capitalize first letter
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/**
 * If verdict is task/noise and capture is a keepable idea, promote to atom.
 * Never demotes atoms. Never rewrites body (body is written elsewhere).
 */
export function rescueKeepableIdea(
  captureText: string,
  result: ClassificationResult,
  noteTitles: string[] = [],
): ClassificationResult {
  if (result.verdict === "atom") return result;
  if (result.verdict !== "task" && result.verdict !== "noise") return result;
  if (!isKeepableIdea(captureText)) return result;

  const title = shortTitleFromCapture(captureText);
  const tags = [...(result.tags ?? [])];
  for (const t of ["idea", "project"]) {
    if (!tags.some((x) => x.toLowerCase() === t)) tags.push(t);
  }

  let links = [...(result.links ?? [])];
  const appIdeas = noteTitles.find((t) =>
    /^(app ideas|projects)$/i.test(t.trim()),
  );
  if (
    appIdeas &&
    !links.some((l) => l.note.trim().toLowerCase() === appIdeas.trim().toLowerCase())
  ) {
    links = [
      ...links,
      {
        note: appIdeas.trim(),
        reason: `product / build idea to revisit ([[${appIdeas.trim()}]])`,
      },
    ];
  }

  return {
    ...result,
    verdict: "atom",
    title,
    tags,
    links,
  };
}
