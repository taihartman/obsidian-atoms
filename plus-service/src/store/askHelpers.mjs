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
  const links = Array.isArray(atom.links) ? atom.links : [];
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

export function rowToPublicAtom(row, { includeBody = true } = {}) {
  if (!row) return null;
  const tags = safeJson(row.tags_json ?? row.tagsJson, []);
  const links = safeJson(row.links_json ?? row.linksJson, []);
  const out = {
    id: row.atom_id ?? row.atomId,
    title: row.title,
    path: row.path,
    tags,
    links,
    contentHash: row.content_hash ?? row.contentHash,
    updatedAt: iso(row.updated_at ?? row.updatedAt),
  };
  if (includeBody) {
    const enc = row.body_enc ?? row.bodyEnc ?? row.body_text ?? row.bodyText ?? "";
    out.text = decryptMirrorField(enc);
  }
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
 * Score candidate for search (higher = better). Title hits beat body.
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
  if (title === q) score += 100;
  else if (title.includes(q)) score += 50;
  if (path.includes(q)) score += 20;
  for (const t of tags) {
    if (t === q) score += 40;
    else if (t.includes(q)) score += 15;
  }
  if (body.includes(q)) score += 10;
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    let allInBody = true;
    for (const w of words) {
      if (!body.includes(w) && !title.includes(w)) allInBody = false;
    }
    if (allInBody) score += 5;
  }
  return score;
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
