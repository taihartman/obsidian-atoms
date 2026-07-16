/**
 * Post-classify link-reason quality.
 * Rewrites boilerplate reasons into substantive prose without an API retry.
 */

import type { ClassificationLink, ClassificationResult } from "../../shared/types";

/** Boilerplate patterns from model + older person/media repair defaults. */
const WEAK_REASON_RE =
  /^(preference about|preference or claim about|update about|relates to|relates because|media work to watch|about)\b/i;

/**
 * True when a reason is a category sticker, not graph intelligence.
 * Strong supersession phrases always pass.
 */
export function isWeakLinkReason(reason: string): boolean {
  const r = (reason ?? "").trim();
  if (!r) return true;
  if (/\b(revises|contradicts|supersedes)\b/i.test(r)) return false;
  // "preference about [[X]]." / "media work to watch ([[X]])"
  if (WEAK_REASON_RE.test(r)) return true;
  // Bare "about [[X]]" with almost nothing else
  if (/^about\s+\[\[/i.test(r) && r.length < 40) return true;
  // Only a wikilink / note name restatement
  if (/^\[\[.+\]\]\.?$/.test(r)) return true;
  return false;
}

/**
 * Build a substantive reason from capture cues + target note.
 * Always includes a readable relationship; may embed [[note]].
 */
export function rewriteWeakLinkReason(
  captureText: string,
  note: string,
  previousReason = "",
): string {
  const c = (captureText ?? "").replace(/\s+/g, " ").trim();
  const n = (note ?? "").trim() || "note";
  const lower = c.toLowerCase();
  const prev = previousReason.trim();

  // Media / watchlist
  if (
    /\b(?:re)?watch(?:ing)?\b/i.test(c) ||
    /\b(told me to watch|recommended|should watch)\b/i.test(c) ||
    /media work to watch/i.test(prev)
  ) {
    const rec =
      c.match(
        /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:told me to|recommended|said)\b/i,
      )?.[1] ??
      c.match(/\b([A-Z][a-z]+)\s+told me\b/i)?.[1];
    if (rec && rec.toLowerCase() !== n.toLowerCase()) {
      return `watchlist: ${n}, recommended by ${rec}`;
    }
    return `watchlist item — ${n} from this capture`;
  }

  // Career / interview status
  if (/\b(interview|waiting|hear back|job|hospital|offer)\b/i.test(c)) {
    return `career status follow-up about [[${n}]] — not a settled fact yet`;
  }

  // Games
  if (/\b(game|playing|played|detective|rpg)\b/i.test(c)) {
    return `adds a game preference for [[${n}]] — why they like it lives in the body`;
  }

  // Aesthetic / gift-usable prefs
  if (
    /\b(color|colour|periwinkle|teal|pajamas|pyjamas|likes|loves|prefers)\b/i.test(
      c,
    )
  ) {
    if (/\b(color|colour|periwinkle|teal)\b/i.test(c)) {
      return `concrete aesthetic preference for gifts / clothes ([[${n}]])`;
    }
    if (/\b(pajama|pyjama)\b/i.test(c)) {
      return `comfort / home-aesthetic preference ([[${n}]])`;
    }
    return `durable taste fact about [[${n}]] from this capture`;
  }

  // Workplace / index
  if (/\b(crg|coworker|colleague|hospital|works at)\b/i.test(c)) {
    if (/^people$/i.test(n)) {
      return `workplace / social index — identity cue from this capture ([[${n}]])`;
    }
    return `workplace social map involving [[${n}]]`;
  }

  // Product / project hubs
  if (/\b(app ideas|projects?)\b/i.test(n) || /\b(website|app|game|build)\b/i.test(c)) {
    return `product / build idea to revisit ([[${n}]])`;
  }

  // Prefer previous if it already has extra substance beyond weak stem
  if (prev && !isWeakLinkReason(prev) && prev.includes(n)) {
    return prev.endsWith(".") ? prev.slice(0, -1) : prev;
  }

  // Generic but better than "preference about"
  if (lower.includes(n.toLowerCase()) || c.length > 0) {
    return `durable fact about [[${n}]] worth meeting again in the graph`;
  }
  return `relates to [[${n}]]`;
}

export function improveClassificationLinks(
  captureText: string,
  result: ClassificationResult,
): ClassificationResult {
  if (result.verdict !== "atom") return result;
  const links = result.links ?? [];
  if (!links.length) return result;

  let changed = false;
  const next: ClassificationLink[] = links.map((l) => {
    const note = (l.note ?? "").trim();
    const reason = (l.reason ?? "").trim();
    if (!note) return l;
    if (!isWeakLinkReason(reason)) return l;
    changed = true;
    return {
      note,
      reason: rewriteWeakLinkReason(captureText, note, reason),
    };
  });

  if (!changed) return result;
  return { ...result, links: next };
}

/**
 * Optional People index link when person-shaped, no hub matched, exact "People" title exists.
 */
export function maybeLinkPeopleIndex(
  captureText: string,
  result: ClassificationResult,
  noteTitles: string[],
  hubTitles: string[],
): ClassificationResult {
  if (result.verdict !== "atom") return result;
  const peopleTitle = noteTitles.find((t) => t.trim().toLowerCase() === "people");
  if (!peopleTitle) return result;

  const hubs = new Set(hubTitles.map((h) => h.trim().toLowerCase()).filter(Boolean));
  const hasHub = (result.links ?? []).some((l) =>
    hubs.has((l.note ?? "").trim().toLowerCase()),
  );
  if (hasHub) return result;

  // Only when capture looks like workplace identity, not pure logistics
  if (!/\b(crg|coworker|colleague|works at|hospital|friend from)\b/i.test(captureText)) {
    return result;
  }
  if ((result.links ?? []).some((l) => l.note.trim().toLowerCase() === "people")) {
    return result;
  }

  return {
    ...result,
    links: [
      ...(result.links ?? []),
      {
        note: peopleTitle.trim(),
        reason: rewriteWeakLinkReason(captureText, peopleTitle.trim()),
      },
    ],
  };
}
