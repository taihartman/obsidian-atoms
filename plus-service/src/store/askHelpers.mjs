/**
 * Shared Ask / mirror helpers (search scoring, row shape).
 */
import { createHash } from "node:crypto";
import { contentHash, decryptMirrorField, encryptMirrorField } from "../mirror/crypto.mjs";

export function verifyPkce(codeVerifier, challenge, method = "S256") {
  if (method !== "S256") return challenge === codeVerifier;
  const dig = createHash("sha256").update(codeVerifier).digest("base64url");
  return dig === challenge;
}

/** S256 code_challenge for tests / authorize. */
export function pkceChallengeS256(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function normEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

/**
 * @param {{ path: string, title?: string, body?: string, tags?: string[], links?: {note:string,reason?:string}[], atomId?: string }} atom
 */
export function prepareMirrorRow(email, atom) {
  const path = String(atom.path || "").trim();
  if (!path) throw new Error("path required");
  const title = String(atom.title || path.replace(/\.md$/i, "")).trim();
  const body = String(atom.body ?? "");
  const tags = Array.isArray(atom.tags) ? atom.tags.map(String) : [];
  const links = mergeLinksFromBody(
    Array.isArray(atom.links) ? atom.links : [],
    body,
  );
  const tagsJson = JSON.stringify(tags);
  const linksJson = JSON.stringify(links);
  const hash = contentHash([title, body, tagsJson, linksJson]);
  return {
    email: normEmail(email),
    atomId: atom.atomId || path,
    title,
    path,
    bodyEnc: encryptMirrorField(body),
    tagsJson,
    linksJson,
    contentHash: hash,
    updatedAt: new Date().toISOString(),
  };
}

/** Unique [[wikilink]] targets; alias/heading stripped. */
export function extractWikilinks(text) {
  const out = [];
  const seen = new Set();
  const re = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
  let m;
  while ((m = re.exec(text || "")) !== null) {
    const note = String(m[1] || "").trim();
    if (!note) continue;
    const key = note.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(note);
  }
  return out;
}

/**
 * Merge stored links with wikilinks parsed from body (fills empty links[]).
 * @param {{ note: string, reason?: string }[]} links
 * @param {string} body
 */
export function mergeLinksFromBody(links, body) {
  const base = Array.isArray(links) ? [...links] : [];
  const have = new Set(
    base.map((l) => String(l?.note || "").trim().toLowerCase()).filter(Boolean),
  );
  for (const note of extractWikilinks(body)) {
    const k = note.toLowerCase();
    if (have.has(k)) continue;
    have.add(k);
    base.push({ note });
  }
  return base;
}

export function rowToPublicAtom(row, { includeBody = true } = {}) {
  if (!row) return null;
  const tags = safeJson(row.tags_json ?? row.tagsJson, []);
  let links = safeJson(row.links_json ?? row.linksJson, []);
  const enc = row.body_enc ?? row.bodyEnc ?? row.body_text ?? row.bodyText ?? "";
  let text;
  if (includeBody) {
    text = decryptMirrorField(enc);
    links = mergeLinksFromBody(links, text);
  }
  const out = {
    id: row.atom_id ?? row.atomId,
    title: row.title,
    path: row.path,
    tags,
    links,
    contentHash: row.content_hash ?? row.contentHash,
    updatedAt: iso(row.updated_at ?? row.updatedAt),
  };
  if (includeBody) out.text = text;
  return out;
}

function safeJson(s, fallback) {
  if (Array.isArray(s)) return s;
  if (typeof s !== "string" || !s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function iso(v) {
  if (v instanceof Date) return v.toISOString();
  return v ? String(v) : new Date().toISOString();
}

/**
 * Score candidate for search (higher = better).
 * Exact title > title prefix > title contains (earlier better) > tags > body TF.
 * @param {{ title: string, path: string, tags: string[], body: string }} doc
 * @param {string} query
 */
export function scoreSearch(doc, query) {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const title = (doc.title || "").toLowerCase();
  const path = (doc.path || "").toLowerCase();
  const tags = (doc.tags || []).map((t) => String(t).toLowerCase());
  const body = (doc.body || "").toLowerCase();
  let score = 0;

  if (title === q) score += 1000;
  else if (title.startsWith(q)) score += 400;
  else {
    const ti = title.indexOf(q);
    if (ti >= 0) score += 200 - Math.min(ti, 100);
  }

  if (path.includes(q)) score += 30;

  for (const t of tags) {
    if (t === q) score += 150;
    else if (t.includes(q)) score += 40;
  }

  // Body: occurrence count (capped) + early position bonus
  if (body.includes(q)) {
    let count = 0;
    let from = 0;
    let first = -1;
    while (count < 20) {
      const i = body.indexOf(q, from);
      if (i < 0) break;
      if (first < 0) first = i;
      count += 1;
      from = i + q.length;
    }
    score += 20 + count * 8;
    if (first >= 0 && first < 200) score += 15;
  }

  const words = q.split(/\s+/).filter((w) => w.length > 1);
  if (words.length > 1) {
    let hit = 0;
    for (const w of words) {
      if (title.includes(w)) hit += 2;
      else if (body.includes(w)) hit += 1;
    }
    score += hit * 12;
  }

  return score;
}

/**
 * @param {string[]} tags
 * @param {string[] | undefined} filterTags
 */
export function matchesTagFilter(tags, filterTags) {
  if (!filterTags?.length) return true;
  const have = new Set((tags || []).map((t) => String(t).toLowerCase()));
  return filterTags.every((t) => have.has(String(t).toLowerCase()));
}

/**
 * @param {string} body
 * @param {string} query
 * @param {number} max
 */
export function makeSnippet(body, query, max = 240) {
  const text = body || "";
  const q = query.trim().toLowerCase();
  let start = 0;
  if (q) {
    const idx = text.toLowerCase().indexOf(q);
    if (idx >= 0) start = Math.max(0, idx - 40);
  }
  let snip = text.slice(start, start + max);
  if (start > 0) snip = "…" + snip;
  if (start + max < text.length) snip = snip + "…";
  return snip.replace(/\s+/g, " ").trim();
}
