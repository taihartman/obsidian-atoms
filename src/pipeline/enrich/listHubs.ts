/**
 * List-hub post-classify repair — unique vault list hub + optional hub_section.
 */

import type { ClassificationResult, ListHubDetail } from "../../shared/types";
import { isMediaShaped } from "./media";
import { isJunkLinkReason } from "./linkQuality";

const LIST_SHAPE =
  /\b(?:watch(?:list)?|movie|show|film|packing|trip|gift|wishlist|to[- ]?read|want to)\b/i;

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

  const hay = `${captureText ?? ""}\n${result.title ?? ""}`.toLowerCase();

  const hits: ListHubDetail[] = [];
  for (const h of listHubs) {
    const title = h.canonicalTitle.trim();
    if (!title) continue;
    const low = title.toLowerCase();
    if (hay.includes(low)) {
      hits.push(h);
      continue;
    }
    for (const k of h.matchKeys ?? []) {
      const m = k.trim().toLowerCase();
      if (m && hay.includes(m)) {
        hits.push(h);
        break;
      }
    }
  }

  // Soft media titles: prefer unique soft-named list hub when media-shaped
  // (do not push every soft name — Movies+Shows would kill unique match).
  if (!hits.length && isMediaShaped(captureText)) {
    const soft = new Set(["movies", "shows", "watchlist", "films"]);
    const softHubs = listHubs.filter((h) =>
      soft.has(h.canonicalTitle.trim().toLowerCase()),
    );
    if (softHubs.length === 1) {
      hits.push(softHubs[0]!);
    } else if (softHubs.length > 1) {
      const mentioned = softHubs.filter((h) =>
        hay.includes(h.canonicalTitle.trim().toLowerCase()),
      );
      if (mentioned.length === 1) hits.push(mentioned[0]!);
    }
  }

  // Dedupe by title
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
