/**
 * Display-only wikilink unwrap for HTML surfaces (Home sidebar).
 * Atom files keep `[[Title]]`; this never rewrites the vault.
 */

export type WikiDisplaySegment = {
  kind: "text" | "link";
  text: string;
};

/**
 * `[[Title]]`, `[[Title|alias]]`, optional `#heading`. Display text is alias, else title.
 */
const WIKILINK_DISPLAY_RE =
  /\[\[([^\]|#]+)(?:#[^|\]]+)?(?:\|([^\]]+))?\]\]/g;

export function wikiDisplaySegments(source: string): WikiDisplaySegment[] {
  const text = source ?? "";
  const out: WikiDisplaySegment[] = [];
  WIKILINK_DISPLAY_RE.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_DISPLAY_RE.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ kind: "text", text: text.slice(last, m.index) });
    }
    const shown = (m[2] ?? m[1] ?? "").trim();
    if (shown) out.push({ kind: "link", text: shown });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    out.push({ kind: "text", text: text.slice(last) });
  }
  return out;
}

export function unwrapWikilinksForDisplay(source: string): string {
  return wikiDisplaySegments(source)
    .map((s) => s.text)
    .join("");
}
