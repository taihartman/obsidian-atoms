/**
 * Ask mirror push planner — Atoms/ paths only, hash skip.
 * Structured links prefer frontmatter `atom-links:`; body is not mined for reasons.
 */
import { parseLinkProse } from "../pipeline/parseLinkProse";

/** Device-local (not data.json) — multi-device safe evidence map. */
export const LS_ASK_MIRROR_HASHES = "atoms-ask-mirror-hashes-v1";
export const LS_ASK_MIRROR_LAST_SUCCESS = "atoms-ask-mirror-last-success-v1";
export const LS_ASK_MIRROR_LAST_ERROR = "atoms-ask-mirror-last-error-v1";
export const LS_ASK_MIRROR_SERVER_COUNT = "atoms-ask-mirror-server-count-v1";

export function readAskMirrorHashes(
  load: (k: string) => unknown,
  legacySettingsHashes?: Record<string, string>,
): Record<string, string> {
  const raw = load(LS_ASK_MIRROR_HASHES);
  if (raw && typeof raw === "string" && raw.trim()) {
    try {
      const o = JSON.parse(raw) as unknown;
      if (o && typeof o === "object" && !Array.isArray(o)) {
        return o as Record<string, string>;
      }
    } catch {
      /* fall through */
    }
  }
  if (legacySettingsHashes && typeof legacySettingsHashes === "object") {
    return { ...legacySettingsHashes };
  }
  return {};
}

export function writeAskMirrorHashes(
  save: (k: string, v: string) => void,
  hashes: Record<string, string>,
): void {
  save(LS_ASK_MIRROR_HASHES, JSON.stringify(hashes));
}

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

type FmLink = { note: string; reason?: string };

/** Parse frontmatter tags, atom-links, parent/relation, body. */
export function splitAtomMarkdown(content: string): {
  body: string;
  tags: string[];
  parent?: string;
  relation?: string;
  fmLinks: FmLink[];
} {
  if (!content.startsWith("---")) {
    return { body: content, tags: [], fmLinks: [] };
  }
  const end = content.indexOf("\n---", 3);
  if (end < 0) return { body: content, tags: [], fmLinks: [] };
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

  const fmLinks: FmLink[] = [];
  // atom-links:
  //   - note: "X"
  //     reason: "Y"
  const block = fm.match(
    /^atom-links:\s*\n((?:[ \t]+.+\n?)*)/m,
  );
  if (block?.[1]) {
    let cur: FmLink | null = null;
    for (const line of block[1].split("\n")) {
      const noteM = line.match(/^\s*-\s+note:\s*(.+)$/);
      const reasonM = line.match(/^\s+reason:\s*(.+)$/);
      if (noteM) {
        if (cur) fmLinks.push(cur);
        const note = noteM[1]!.trim().replace(/^["']|["']$/g, "");
        cur = note ? { note } : null;
      } else if (reasonM && cur) {
        cur.reason = reasonM[1]!.trim().replace(/^["']|["']$/g, "");
      }
    }
    if (cur) fmLinks.push(cur);
  }

  return {
    body,
    tags,
    fmLinks,
    ...(parent ? { parent } : {}),
    ...(relation ? { relation } : {}),
  };
}

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
 * Link-prose region only (after first blank line) — Process atoms legacy.
 * Never treat capture paragraph as reason.
 */
function linkProseRegion(body: string): string {
  const text = (body || "").replace(/\s+$/, "");
  const m = text.match(/^([\s\S]*?)\n\n([\s\S]+)$/);
  return m ? m[2]!.replace(/\s+$/, "") : "";
}

/**
 * Build structured links for mirror:
 * 1. FM atom-links (authoritative)
 * 2. parent/relation FM
 * 3. Process-style short link-prose region only (≤280 chars / segment)
 * 4. bare wikilinks → note only
 */
export function linksFromAtomFile(opts: {
  body: string;
  fmLinks?: FmLink[];
  parent?: string;
  relation?: string;
}): { note: string; reason?: string }[] {
  const byNote = new Map<string, { note: string; reason?: string }>();

  for (const l of opts.fmLinks || []) {
    const note = (l.note || "").trim();
    if (!note) continue;
    const reason = (l.reason || "").trim();
    byNote.set(
      note.toLowerCase(),
      reason ? { note, reason } : { note },
    );
  }

  if (opts.parent?.trim()) {
    const p = opts.parent.trim();
    const key = p.toLowerCase();
    const rel = (opts.relation || "").trim();
    const reason =
      rel === "revises"
        ? `revises [[${p}]]`
        : rel === "contradicts"
          ? `contradicts [[${p}]]`
          : rel === "adds_detail"
            ? `adds detail to [[${p}]]`
            : rel === "continues"
              ? `continues [[${p}]]`
              : undefined;
    const prev = byNote.get(key);
    if (!prev) {
      byNote.set(key, reason ? { note: p, reason } : { note: p });
    } else if (reason && !prev.reason) {
      byNote.set(key, { note: prev.note, reason });
    }
  }

  // Legacy Process: only parse short link-prose segments (not capture)
  if (byNote.size === 0 || ![...byNote.values()].some((l) => l.reason)) {
    const region = linkProseRegion(opts.body);
    for (const l of parseLinkProse(region)) {
      const note = (l.note || "").trim();
      if (!note) continue;
      const reason = (l.reason || "").trim();
      const key = note.toLowerCase();
      if (reason.length > 280) {
        if (!byNote.has(key)) byNote.set(key, { note });
        continue;
      }
      const prev = byNote.get(key);
      if (!prev) {
        byNote.set(key, reason ? { note, reason } : { note });
      } else if (reason && !prev.reason) {
        byNote.set(key, { note: prev.note, reason });
      }
    }
  }

  for (const note of extractWikilinks(opts.body)) {
    const key = note.toLowerCase();
    if (!byNote.has(key)) byNote.set(key, { note });
  }

  return [...byNote.values()];
}

/** @deprecated use linksFromAtomFile — kept name for tests */
export function linksFromAtomBody(
  body: string,
): { note: string; reason?: string }[] {
  return linksFromAtomFile({ body });
}

/** Flat `{folder}/{name}.md` only — no nested segments. */
export function isFlatAtomPath(folder: string, path: string): boolean {
  const f = folder.replace(/\/$/, "") || "Atoms";
  const p = String(path || "").trim();
  if (!p.endsWith(".md")) return false;
  if (p.includes("..") || p.includes("\\") || p.includes("\0")) return false;
  if (!p.startsWith(f + "/")) return false;
  const rest = p.slice(f.length + 1);
  if (!rest || rest.includes("/")) return false;
  return true;
}

/**
 * Paths in lastHashes missing from vault → candidates for mirror delete.
 */
export function planAskMirrorDeletes(
  vaultPaths: Set<string>,
  lastHashes: Record<string, string>,
): { deletePaths: string[]; nextHashes: Record<string, string> } {
  const deletePaths: string[] = [];
  const nextHashes = { ...lastHashes };
  for (const p of Object.keys(lastHashes)) {
    if (!vaultPaths.has(p)) {
      deletePaths.push(p);
      delete nextHashes[p];
    }
  }
  return { deletePaths, nextHashes };
}

export function planAskMirrorUpsert(
  files: VaultFileRead[],
  atomFolder: string,
  lastHashes: Record<string, string> = {},
): { atoms: AskMirrorAtomPayload[]; nextHashes: Record<string, string> } {
  const folder = atomFolder.replace(/\/$/, "");
  const atoms: AskMirrorAtomPayload[] = [];
  const nextHashes = { ...lastHashes };
  for (const f of files) {
    if (!isFlatAtomPath(folder, f.path)) continue;
    const { body, tags, parent, relation, fmLinks } = splitAtomMarkdown(
      f.content,
    );
    const title = f.basename.replace(/\.md$/i, "");
    const links = linksFromAtomFile({ body, fmLinks, parent, relation });
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
