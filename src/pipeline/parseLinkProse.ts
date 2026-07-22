/**
 * Inverse of formatLinkProse for common atom link-region shapes.
 * Best-effort: segments with no wikilink are dropped.
 */

import type { ClassificationLink } from "../shared/types";

const WIKILINK_RE = /\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g;

/**
 * Parse reason-bearing link prose into structured links.
 * Splits on sentence boundaries (`. ` / end), maps each segment with ≥1 wikilink.
 * Note = last wikilink title in the segment (matches formatLinkProse embedding).
 */
export function parseLinkProse(prose: string): ClassificationLink[] {
  const raw = (prose ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return [];

  // Split on ". " without lookbehind (iOS Safari <16.4 / older WKWebView).
  const segments = raw
    .split(/\.\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: ClassificationLink[] = [];
  for (const seg of segments) {
    const reason = seg.replace(/\.$/, "").trim();
    if (!reason) continue;
    const titles: string[] = [];
    WIKILINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKILINK_RE.exec(reason)) !== null) {
      const t = (m[1] ?? "").trim();
      if (t) titles.push(t);
    }
    if (!titles.length) continue;
    const note = titles[titles.length - 1]!;
    out.push({ note, reason });
  }
  return out;
}

/** Link-prose region after capture (blank-line split), or empty. */
export function extractLinkProseRegion(content: string): string {
  if (!content.startsWith("---")) {
    const body = content.replace(/\s+$/, "");
    const m = body.match(/^([\s\S]*?)\n\n([\s\S]+)$/);
    return m ? m[2]!.replace(/\s+$/, "") : "";
  }
  const end = content.indexOf("\n---", 3);
  if (end === -1) return "";
  const body = content.slice(end + 4).replace(/^\r?\n/, "").replace(/\s+$/, "");
  if (!body) return "";
  const m = body.match(/^([\s\S]*?)\n\n([\s\S]+)$/);
  return m ? m[2]!.replace(/\s+$/, "") : "";
}
