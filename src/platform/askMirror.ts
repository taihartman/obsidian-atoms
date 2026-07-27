/**
 * Ask mirror push planner — Atoms/ paths only, hash skip.
 * Hash is mobile-safe (no Node crypto).
 */

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
  return { body, tags };
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
    const { body, tags } = splitAtomMarkdown(f.content);
    const title = f.basename.replace(/\.md$/i, "");
    const links = extractWikilinks(body).map((note) => ({ note }));
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
