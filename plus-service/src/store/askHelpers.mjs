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
 * Link-prose region only (after first blank line). Never treat capture body as reason.
 * @param {string} body
 */
export function extractLinkProseRegion(body) {
  const text = (body || "").replace(/\s+$/, "");
  if (!text) return "";
  const m = text.match(/^([\s\S]*?)\n\n([\s\S]+)$/);
  return m ? m[2].replace(/\s+$/, "") : "";
}

/**
 * Conservative body→links. Reasons prefer stored links_json from upsert.
 * Body only: bare wikilinks as {note}; short Process one-liner in prose region.
 * @param {string} body
 * @returns {{ note: string, reason?: string }[]}
 */
export function linksFromAtomBody(body) {
  const text = body || "";
  /** @type {Map<string, { note: string, reason?: string }>} */
  const byNote = new Map();
  const prose = extractLinkProseRegion(text);
  const re = /\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g;
  // Only short single-link Process-shaped one-liners become reasons
  if (prose && prose.length <= 200 && !prose.includes("\n\n")) {
    const titles = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(prose)) !== null) {
      const t = String(m[1] || "").trim();
      if (t) titles.push(t);
    }
    if (titles.length === 1) {
      const note = titles[0];
      const reason = prose.replace(/\s+/g, " ").replace(/\.$/, "").trim();
      const okShape =
        reason.length <= 120 ||
        /^(continues|revises|contradicts|adds detail|related|preference|durable)/i.test(
          reason,
        ) ||
        /\(\[\[/.test(reason);
      if (okShape && reason.length <= 200) {
        byNote.set(note.toLowerCase(), { note, reason });
      }
    }
  }
  for (const note of extractWikilinks(text)) {
    const key = note.toLowerCase();
    if (!byNote.has(key)) byNote.set(key, { note });
  }
  return [...byNote.values()];
}

/**
 * Stored links win. Strip over-long reasons (old parser garbage).
 * Body fills missing notes only (and short Process one-liners).
 * @param {{ note: string, reason?: string }[]} links
 * @param {string} body
 */
/** Typed relation enum from a stored reason string, or null. */
export function relationFromReason(reason) {
  const r = String(reason || "")
    .trim()
    .toLowerCase();
  if (!r) return null;
  if (r.startsWith("contradicts")) return "contradicts";
  if (r.startsWith("revises")) return "revises";
  if (r.startsWith("continues")) return "continues";
  if (r.startsWith("adds detail")) return "adds_detail";
  return null;
}

export function mergeLinksFromBody(links, body) {
  /** @type {Map<string, { note: string, reason?: string }>} */
  const byNote = new Map();
  for (const l of Array.isArray(links) ? links : []) {
    const note = String(l?.note || "").trim();
    if (!note) continue;
    const key = note.toLowerCase();
    const reason = l?.reason ? String(l.reason).trim() : undefined;
    if (reason && reason.length > 280) {
      byNote.set(key, { note });
    } else {
      byNote.set(key, reason ? { note, reason } : { note });
    }
  }
  for (const l of linksFromAtomBody(body)) {
    const key = l.note.toLowerCase();
    const prev = byNote.get(key);
    if (!prev) {
      byNote.set(key, l);
      continue;
    }
    if (!prev.reason && l.reason && l.reason.length <= 200) {
      byNote.set(key, { note: prev.note || l.note, reason: l.reason });
    }
  }
  return [...byNote.values()];
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

/** Ask outbox (write path) */
export const OUTBOX_STALE_MS = 15 * 60 * 1000;
export const OUTBOX_MAX_OPEN = 50;
export const OUTBOX_MAX_BODY = 100_000;
export const OUTBOX_TITLE_MAX = 120;
export const OUTBOX_MAX_TAGS = 20;
export const OUTBOX_MAX_LINKS = 10;
export const OUTBOX_RELATIONS = new Set([
  "continues",
  "revises",
  "contradicts",
  "adds_detail",
]);

/**
 * @param {string} relation
 * @param {string} parentTitle
 */
export function relationReason(relation, parentTitle) {
  const p = String(parentTitle || "").trim();
  switch (relation) {
    case "revises":
      return `revises [[${p}]]`;
    case "contradicts":
      return `contradicts [[${p}]]`;
    case "adds_detail":
      return `adds detail to [[${p}]]`;
    case "continues":
    default:
      return `continues [[${p}]]`;
  }
}

/**
 * @param {"create"|"continue"} kind
 * @param {object} raw
 * @returns {{ ok: true, payload: object } | { ok: false, error: string }}
 */
export function validateOutboxPayload(kind, raw) {
  const title = String(raw?.title || "")
    .trim()
    .slice(0, OUTBOX_TITLE_MAX);
  const body = String(raw?.body ?? "");
  if (!title) return { ok: false, error: "title required" };
  if (!body.trim()) return { ok: false, error: "body required" };
  if (body.length > OUTBOX_MAX_BODY) {
    return { ok: false, error: `body exceeds ${OUTBOX_MAX_BODY} chars` };
  }
  let tags = Array.isArray(raw?.tags) ? raw.tags.map(String) : [];
  tags = tags
    .map((t) => t.replace(/[\r\n#]/g, "").trim())
    .filter(Boolean)
    .slice(0, OUTBOX_MAX_TAGS);
  let links = Array.isArray(raw?.links) ? raw.links : [];
  links = links
    .slice(0, OUTBOX_MAX_LINKS)
    .map((l) => ({
      note: String(l?.note || "")
        .replace(/[\r\n\[\]]/g, "")
        .trim()
        .slice(0, OUTBOX_TITLE_MAX),
      reason: String(l?.reason || "")
        .replace(/[\r\n]/g, " ")
        .trim()
        .slice(0, 500),
    }))
    .filter((l) => l.note);
  const client_request_id = raw?.client_request_id
    ? String(raw.client_request_id).trim().slice(0, 128)
    : undefined;

  if (kind === "continue") {
    const parent_title = String(raw?.parent_title || "").trim().slice(0, OUTBOX_TITLE_MAX);
    if (!parent_title) return { ok: false, error: "parent_title required" };
    let relation = String(raw?.relation || "continues").trim();
    if (!OUTBOX_RELATIONS.has(relation)) {
      return { ok: false, error: "invalid relation" };
    }
    const reason = relationReason(relation, parent_title);
    const hasParent = links.some(
      (l) => l.note.toLowerCase() === parent_title.toLowerCase(),
    );
    if (!hasParent) {
      links = [{ note: parent_title, reason }, ...links];
    }
    return {
      ok: true,
      payload: {
        title,
        body,
        tags,
        links,
        parent_title,
        relation,
        client_request_id,
      },
    };
  }

  return {
    ok: true,
    payload: { title, body, tags, links, client_request_id },
  };
}

/**
 * @param {object} row
 */
export function publicOutboxRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    payload: row.payload,
    error: row.error || null,
    client_request_id: row.client_request_id || null,
    created_at: row.created_at,
    claimed_at: row.claimed_at || null,
    applied_at: row.applied_at || null,
  };
}

export function encryptOutboxPayload(payload) {
  return encryptMirrorField(JSON.stringify(payload));
}

export function decryptOutboxPayload(enc) {
  const text = decryptMirrorField(enc);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
