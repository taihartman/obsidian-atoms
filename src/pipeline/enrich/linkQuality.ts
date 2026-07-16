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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function titlesMatch(a: string, b: string): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

/** Normalize a self-identity string for matching. */
export function normalizeSelfKey(s: string): string {
  return (s ?? "").trim().toLowerCase();
}

/**
 * Self set for an atom: current title + prior title + frontmatter aliases.
 * Deduped, non-empty.
 */
export function collectSelfTitles(
  primaryTitle: string,
  alsoSelf: string[] = [],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [primaryTitle, ...alsoSelf]) {
    const t = (raw ?? "").trim();
    if (!t) continue;
    const k = normalizeSelfKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export function isNoteSelf(note: string, selves: string[]): boolean {
  const n = normalizeSelfKey(note);
  if (!n) return false;
  return selves.some((s) => normalizeSelfKey(s) === n);
}

/** Remove [[self]] wikilinks for every identity in selves. */
export function stripSelfWikilinks(reason: string, selfTitle: string): string {
  return stripSelfWikilinksMany(reason, [selfTitle]);
}

export function stripSelfWikilinksMany(
  reason: string,
  selves: string[],
): string {
  let r = (reason ?? "").trim();
  if (!r) return "";
  // Longer titles first so nested/overlapping names strip cleanly
  const ordered = [...selves]
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const self of ordered) {
    const re = new RegExp(`\\[\\[${escapeRegExp(self)}\\]\\]`, "gi");
    r = r.replace(re, "");
  }
  r = r
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/([.,;:!?]){2,}/g, "$1")
    .replace(/^(?:and|or|of|,|;|\s)+/i, "")
    .replace(/(?:and|or|,|;|\s)+$/i, "")
    .trim();
  return r;
}

/**
 * True when reason is mainly “this note already exists / duplicate of myself”.
 * Checks against any self identity (title, alias, prior basename).
 */
export function isSelfDuplicateReason(
  reason: string,
  selfTitle: string,
  alsoSelf: string[] = [],
): boolean {
  const r = (reason ?? "").trim();
  if (!r) return false;
  const selves = collectSelfTitles(selfTitle, alsoSelf);
  const lower = r.toLowerCase();

  if (
    /\b(duplicate|already logged|already exists|exact preference|this exact preference|this same|restates|reaffirms|reinforces this|revision adding)\b/i.test(
      r,
    ) &&
    (/\b(existing note|this note|own note|same note|this exact|same recommendation|same career|same identifying|prior note)\b/i.test(
      r,
    ) ||
      selves.some((s) => lower.includes(s.toLowerCase())))
  ) {
    return true;
  }

  for (const self of selves) {
    const selfLink = new RegExp(`\\[\\[${escapeRegExp(self)}\\]\\]`, "i");
    if (
      selfLink.test(r) &&
      /\b(revises|reinforces|duplicate|confirms|same|restates|reaffirms|repeats)\b/i.test(
        r,
      )
    ) {
      const without = stripSelfWikilinksMany(r, selves);
      if (!/\[\[.+\]\]/.test(without)) return true;
    }
  }
  return false;
}

export type StripSelfOpts = {
  /** Prior basename, frontmatter aliases, other known self titles. */
  alsoSelf?: string[];
};

/**
 * Model garbage that must never land in atom reason prose.
 * e.g. "unrelated placeholder — remove if not applicable ([[Nichita]])"
 */
export function isJunkLinkReason(reason: string): boolean {
  const r = (reason ?? "").trim();
  if (!r) return true;
  if (
    /\b(placeholder|lorem ipsum|sample reason|example reason|dummy reason)\b/i.test(
      r,
    )
  ) {
    return true;
  }
  if (
    /\b(remove if|delete if|ignore if|not applicable|n\/a|tbd|todo)\b/i.test(r)
  ) {
    return true;
  }
  if (/\bunrelated placeholder\b/i.test(r)) return true;
  if (/\bunrelated\b/i.test(r) && /\b(placeholder|remove|delete|ignore)\b/i.test(r)) {
    return true;
  }
  // Meta-instruction voice (“if not relevant…”)
  if (/\bif not (applicable|relevant|needed)\b/i.test(r)) return true;
  // Bare “related to [[X]]” with nothing else is weak but allowed as fallback;
  // pure “[[X]]” only is junk
  if (/^\[\[.+\]\]\.?$/.test(r)) return true;
  return false;
}

/**
 * Drop links that target this atom (current title, aliases, prior titles);
 * strip those wikilinks from remaining reasons; drop pure self-duplicate noise
 * and model placeholder/junk reasons.
 * Run after improveClassificationLinks (Process + Update).
 */
export function stripSelfReferentialLinks(
  result: ClassificationResult,
  opts: StripSelfOpts = {},
): ClassificationResult {
  if (result.verdict !== "atom") return result;
  const primary = (result.title ?? "").trim();
  const also = opts.alsoSelf ?? [];
  // Even without a title, still filter junk reasons
  const selves = collectSelfTitles(primary, also);

  const links = result.links ?? [];
  if (!links.length) return result;

  const next: ClassificationLink[] = [];
  for (const l of links) {
    const note = (l.note ?? "").trim();
    if (!note) continue;
    // Never link an atom to its own title / alias / prior basename
    if (selves.length && isNoteSelf(note, selves)) continue;

    let reason = (l.reason ?? "").trim();
    if (isJunkLinkReason(reason)) continue;

    if (primary && isSelfDuplicateReason(reason, primary, also)) {
      reason = stripSelfWikilinksMany(reason, selves);
      if (
        !reason ||
        isJunkLinkReason(reason) ||
        isSelfDuplicateReason(reason, primary, also) ||
        reason.length < 12
      ) {
        continue;
      }
    } else if (selves.length) {
      reason = stripSelfWikilinksMany(reason, selves);
    }

    if (!reason || isJunkLinkReason(reason)) {
      // Prefer no link over inventing weak prose for junk/empty
      continue;
    }
    if (selves.length && isNoteSelf(note, selves)) continue;
    // Drop if after strip the only remaining wikilinks are still self (paranoia)
    const remainingLinks = [...reason.matchAll(/\[\[([^\]]+)\]\]/g)].map(
      (m) => m[1]!.trim(),
    );
    if (
      remainingLinks.length > 0 &&
      selves.length > 0 &&
      remainingLinks.every((t) => isNoteSelf(t, selves))
    ) {
      continue;
    }
    next.push({ note, reason });
  }

  if (
    next.length === links.length &&
    next.every(
      (l, i) =>
        l.note === links[i]!.note && l.reason === (links[i]!.reason ?? "").trim(),
    )
  ) {
    return result;
  }
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
