/**
 * List-hub post-classify repair — unique vault list hub + optional hub_section.
 */

import type { ClassificationResult, ListHubDetail } from "../../shared/types";
import { isMediaShaped } from "./media";
import { isJunkLinkReason } from "./linkQuality";

const LIST_SHAPE =
  /\b(?:watch(?:list)?|movie|show|film|packing|trip|gift|wishlist|to[- ]?read|want to)\b/i;

/** Soft media hub basenames (orbit-soft keys that can still be real vault notes). */
export const MEDIA_LIST_HUB_SOFT_TITLES: ReadonlySet<string> = new Set([
  "movies",
  "shows",
  "watchlist",
  "films",
  "show list",
  "movie list",
  "watch list",
]);

function mediaHubFamily(
  title: string,
): "show" | "movie" | "watch" | null {
  const low = title.trim().toLowerCase();
  if (low === "shows" || low === "show list") return "show";
  if (low === "movies" || low === "films" || low === "movie list") return "movie";
  if (low === "watchlist" || low === "watch list") return "watch";
  return null;
}

export function isListHubShaped(captureText: string): boolean {
  const t = (captureText ?? "").trim();
  if (!t) return false;
  if (isMediaShaped(t)) return true;
  return LIST_SHAPE.test(t);
}

function hasLinkTo(result: ClassificationResult, title: string): boolean {
  const want = title.trim().toLowerCase();
  return (result.links ?? []).some(
    (l) => (l.note ?? "").trim().toLowerCase() === want,
  );
}

/** Word-boundary title match (same spirit as entityLinks). */
export function titleMatchesCapture(hay: string, title: string): boolean {
  const t = title.trim().toLowerCase();
  if (!t || t.length < 3) return false;
  const re = new RegExp(
    `(?:^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z0-9]|$)`,
    "i",
  );
  return re.test(hay);
}

/**
 * When several soft media hubs exist (Movies + Shows), pick by capture cues.
 * Prefer an explicit name hit; else subtype; else Movies as default watch dump.
 */
export function pickSoftMediaHub(
  hay: string,
  softHubs: ListHubDetail[],
): ListHubDetail | null {
  if (!softHubs.length) return null;

  const mentioned = softHubs.filter((h) =>
    titleMatchesCapture(hay, h.canonicalTitle),
  );
  if (mentioned.length === 1) return mentioned[0]!;
  if (mentioned.length > 1) return null;

  const showCue = /\b(show|series|anime|season|episode|tv)\b/i.test(hay);
  const movieCue = /\b(movie|film|cinema)\b/i.test(hay);
  const ofFamily = (fam: "show" | "movie" | "watch") =>
    softHubs.filter((h) => mediaHubFamily(h.canonicalTitle) === fam);

  if (showCue && !movieCue) {
    const shows = ofFamily("show");
    return shows.length === 1 ? shows[0]! : null;
  }
  if (movieCue && !showCue) {
    const movies = ofFamily("movie");
    return movies.length === 1 ? movies[0]! : null;
  }
  const movies = ofFamily("movie");
  if (movies.length === 1) return movies[0]!;
  const watch = ofFamily("watch");
  if (watch.length === 1) return watch[0]!;
  return null;
}

/**
 * When capture is list/media-shaped and exactly one list hub title is a strong
 * unique match, hard-link it. Section placement stays on repairHubSection.
 */
export function enrichListHubLinks(
  captureText: string,
  result: ClassificationResult,
  listHubs: ListHubDetail[],
): ClassificationResult {
  if (result.verdict !== "atom") return result;
  if (!isListHubShaped(captureText)) return result;
  if (!listHubs.length) return result;

  const hay = `${captureText ?? ""}\n${result.title ?? ""}`;

  const hits: ListHubDetail[] = [];
  for (const h of listHubs) {
    const title = h.canonicalTitle.trim();
    if (!title) continue;
    if (titleMatchesCapture(hay, title)) {
      hits.push(h);
      continue;
    }
    for (const k of h.matchKeys ?? []) {
      if (k && titleMatchesCapture(hay, k)) {
        hits.push(h);
        break;
      }
    }
  }

  // Soft media titles when media-shaped and no unique hard title hit
  if (!hits.length && isMediaShaped(captureText)) {
    const softHubs = listHubs.filter((h) =>
      MEDIA_LIST_HUB_SOFT_TITLES.has(h.canonicalTitle.trim().toLowerCase()),
    );
    const picked = pickSoftMediaHub(hay, softHubs);
    if (picked) hits.push(picked);
  }

  const uniq = new Map<string, ListHubDetail>();
  for (const h of hits) {
    uniq.set(h.canonicalTitle.trim().toLowerCase(), h);
  }
  if (uniq.size !== 1) return result;
  const hub = [...uniq.values()][0]!;
  const note = hub.canonicalTitle.trim();
  if (hasLinkTo(result, note)) return result;

  const links = [
    ...(result.links ?? []).filter((l) => !isJunkLinkReason(l.reason ?? "")),
    {
      note,
      reason: `belongs with [[${note}]]`,
    },
  ];
  return { ...result, links };
}
