/**
 * Ask mirror push planner — Atoms/ paths only, hash skip.
 * Hash is mobile-safe (no Node crypto).
 */
import {
  extractLinkProseRegion,
  parseLinkProse,
} from "../pipeline/parseLinkProse";

export type AskMirrorAtomPayload = {
  path: string;
  title: string;
  body: string;
  tags: string[];
  links: { note: string; reason?: string }[];
};

export type VaultFileRead = {
  path: string;
  basename: string;
  content: string;
};

/** Parse simple frontmatter tags list and body after ---. */
export function splitAtomMarkdown(content: string): {
  body: string;
  tags: string[];
  parent?: string;
  relation?: string;
} {
  if (!content.startsWith("---")) {
    return { body: content, tags: [] };
  }
  const end = content.indexOf("\n---", 3);
  if (end < 0) return { body: content, tags: [] };
  const fm = content.slice(3, end);
  const body = content.slice(end + 4).replace(/^\n/, "");
  const tags: string[] = [];
  const list = fm.match(/^tags:\s*\n((?:\s*-\s+.+\n?)*)/m);
  if (list?.[1]) {
    for (const line of list[1].split("\n")) {
      const m = line.match(/^\s*-\s+(.+)/);
      if (m?.[1]) tags.push(m[1].trim().replace(/^["']|["']$/g, ""));
    }
  } else {
    const one = fm.match(/^tags:\s*\[([^\]]*)\]/m);
    if (one?.[1]) {
      for (const p of one[1].split(",")) {
        const t = p.trim().replace(/^["']|["']$/g, "");
        if (t) tags.push(t);
      }
    }
  }
  const parentM = fm.match(/^parent:\s*["']?(.+?)["']?\s*$/m);
  const relationM = fm.match(/^relation:\s*["']?(\w+)["']?\s*$/m);
  const parent = parentM?.[1]?.trim().replace(/^\[\[|\]\]$/g, "");
  const relation = relationM?.[1]?.trim();
  return {
    body,
    tags,
    ...(parent ? { parent } : {}),
    ...(relation ? { relation } : {}),
  };
}

/** Fast stable content fingerprint (not cryptographic). */
export function contentHash(parts: string[]): string {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p ?? "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0xff;
  }
  return (h >>> 0).toString(16);
}

/** Extract unique [[wikilink]] targets from markdown (display alias stripped). */
export function extractWikilinks(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || "")) !== null) {
    const note = (m[1] ?? "").trim();
    if (!note) continue;
    const key = note.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(note);
  }
  return out;
}

/**
 * Structured links: reasons only from link-prose region (after blank line),
 * not capture text. Bare wikilinks elsewhere → note only.
 */
export function linksFromAtomBody(
  body: string,
): { note: string; reason?: string }[] {
  const byNote = new Map<string, { note: string; reason?: string }>();
  // Body-only: extractLinkProseRegion needs FM or blank-line split
  let region = "";
  if (body.startsWith("---")) {
    region = extractLinkProseRegion(body);
  } else {
    const text = (body || "").replace(/\s+$/, "");
    const m = text.match(/^([\s\S]*?)\n\n([\s\S]+)$/);
    region = m ? m[2]!.replace(/\s+$/, "") : "";
  }
  for (const l of parseLinkProse(region)) {
    const note = (l.note || "").trim();
    if (!note) continue;
    const reason = (l.reason || "").trim();
    if (reason.length > 280) {
      byNote.set(note.toLowerCase(), { note });
    } else {
      byNote.set(note.toLowerCase(), reason ? { note, reason } : { note });
    }
  }
  for (const note of extractWikilinks(body)) {
    const key = note.toLowerCase();
    if (!byNote.has(key)) byNote.set(key, { note });
  }
  return [...byNote.values()];
}

/**
 * Build upsert payloads from vault files under atom folder.
 * @param lastHashes path → content hash from previous push
 */
export function planAskMirrorUpsert(
  files: VaultFileRead[],
  atomFolder: string,
  lastHashes: Record<string, string> = {},
): { atoms: AskMirrorAtomPayload[]; nextHashes: Record<string, string> } {
  const folder = atomFolder.replace(/\/$/, "");
  const atoms: AskMirrorAtomPayload[] = [];
  const nextHashes = { ...lastHashes };
  for (const f of files) {
    if (!f.path.startsWith(folder + "/") && f.path !== folder) continue;
    if (!f.path.endsWith(".md")) continue;
    const { body, tags, parent, relation } = splitAtomMarkdown(f.content);
    const title = f.basename.replace(/\.md$/i, "");
    const links = linksFromAtomBody(body);
    if (parent) {
      const key = parent.toLowerCase();
      const reason =
        relation === "revises"
          ? `revises [[${parent}]]`
          : relation === "contradicts"
            ? `contradicts [[${parent}]]`
            : relation === "adds_detail"
              ? `adds detail to [[${parent}]]`
              : relation === "continues"
                ? `continues [[${parent}]]`
                : undefined;
      const prev = links.find((l) => l.note.toLowerCase() === key);
      if (prev) {
        if (reason && !prev.reason) prev.reason = reason;
      } else {
        links.push(reason ? { note: parent, reason } : { note: parent });
      }
    }
    const hash = contentHash([
      title,
      body,
      JSON.stringify(tags),
      JSON.stringify(links),
    ]);
    if (lastHashes[f.path] === hash) continue;
    nextHashes[f.path] = hash;
    atoms.push({
      path: f.path,
      title,
      body,
      tags,
      links,
    });
  }
  return { atoms, nextHashes };
}
