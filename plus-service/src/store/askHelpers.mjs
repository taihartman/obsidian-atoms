/**
 * Shared Ask / mirror helpers (search scoring, row shape).
 */
import { createHash, randomInt } from "node:crypto";
import { contentHash, decryptMirrorField, encryptMirrorField } from "../mirror/crypto.mjs";

export function verifyPkce(codeVerifier, challenge, method = "S256") {
  if (method !== "S256") return challenge === codeVerifier;
  const dig = createHash("sha256").update(codeVerifier).digest("base64url");
  return dig === challenge;
}

/** Pair code TTL (KTD2). */
export const PAIR_CODE_TTL_MS = 10 * 60 * 1000;

/** Crockford Base32 without I L O U (KTD1). */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * 8-char Crockford pair code (plaintext once). Display as XXXX-XXXX via formatPairCodeDisplay.
 */
export function generatePairCode() {
  let s = "";
  for (let i = 0; i < 8; i++) s += CROCKFORD[randomInt(CROCKFORD.length)];
  return s;
}

export function formatPairCodeDisplay(code) {
  const c = String(code || "")
    .replace(/-/g, "")
    .toUpperCase();
  if (c.length !== 8) return c;
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

/** Normalize user paste: strip spaces/hyphens, uppercase. */
export function normalizePairCodeInput(raw) {
  return String(raw || "")
    .replace(/[\s-]+/g, "")
    .toUpperCase();
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

/** Default atom folder (flat captures). */
export const MIRROR_ATOM_FOLDER = "Atoms";
const MIRROR_ATOM_PATH_RE = /^Atoms\/[^/\\]+\.md$/;
/** Hub notes: vault .md up to 4 segments (e.g. Social/People/Name.md). */
const MIRROR_HUB_PATH_RE = /^(?!Atoms\/)(?:[^/\\]+\/){0,3}[^/\\]+\.md$/;

/**
 * Fail-closed path allowlist for mirror upsert/delete/reconcile.
 * Atoms/*.md always; other vault notes only when kind=hub (link targets).
 * @param {string} path
 * @param {{ kind?: string }} [opts]
 * @returns {{ ok: true, path: string, kind: "atom"|"hub" } | { ok: false, error: string }}
 */
export function assertMirrorPath(path, opts = {}) {
  const p = String(path || "").trim();
  const kindRaw = String(opts.kind || "atom").toLowerCase();
  if (!p) return { ok: false, error: "path required" };
  if (p.includes("\0") || p.includes("\\") || p.startsWith("/")) {
    return { ok: false, error: "invalid path" };
  }
  if (p.includes("..")) return { ok: false, error: "invalid path" };
  if (MIRROR_ATOM_PATH_RE.test(p)) {
    return { ok: true, path: p, kind: "atom" };
  }
  if (MIRROR_HUB_PATH_RE.test(p)) {
    // Explicit kind=atom rejects non-Atoms paths
    if (opts.kind === "atom") {
      return { ok: false, error: "path must be flat Atoms/*.md" };
    }
    // kind=hub or omitted (delete/reconcile)
    return { ok: true, path: p, kind: "hub" };
  }
  return {
    ok: false,
    error:
      kindRaw === "hub"
        ? "invalid hub path"
        : "path must be flat Atoms/*.md (or kind=hub)",
  };
}

/**
 * @param {{ path: string, title?: string, body?: string, tags?: string[], links?: {note:string,reason?:string}[], atomId?: string, kind?: string }} atom
 */
export function prepareMirrorRow(email, atom) {
  const kindIn = String(atom.kind || "atom").toLowerCase() === "hub" ? "hub" : "atom";
  const checked = assertMirrorPath(atom.path, { kind: kindIn });
  if (!checked.ok) throw new Error(checked.error);
  const path = checked.path;
  const kind = checked.kind;
  const title = String(atom.title || path.replace(/\.md$/i, "").split("/").pop()).trim();
  const body = String(atom.body ?? "");
  const tags = Array.isArray(atom.tags) ? atom.tags.map(String) : [];
  const links = mergeLinksFromBody(
    Array.isArray(atom.links) ? atom.links : [],
    body,
  );
  const tagsJson = JSON.stringify(tags);
  const linksJson = JSON.stringify(links);
  const hash = contentHash([title, body, tagsJson, linksJson, kind]);
  return {
    email: normEmail(email),
    atomId: atom.atomId || path,
    title,
    path,
    kind,
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
  const path = row.path;
  const kindStored = row.kind || row.note_kind || row.noteKind;
  const kind =
    kindStored === "hub" || kindStored === "atom"
      ? kindStored
      : String(path || "").startsWith("Atoms/")
        ? "atom"
        : "hub";
  const out = {
    id: row.atom_id ?? row.atomId,
    title: row.title,
    path,
    kind,
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

/** Max distinct tags returned by list_tags / mirrorListTags. */
export const MIRROR_TAGS_LIMIT = 500;

/**
 * Prefer most-common casing for a tag key; ties → lowercased form (stable).
 * @param {Map<string, number>} forms
 */
function pickTagDisplay(forms) {
  let best = "";
  let bestN = -1;
  for (const [form, n] of forms) {
    if (n > bestN) {
      best = form;
      bestN = n;
      continue;
    }
    if (n === bestN) {
      const lower = form.toLowerCase() === form;
      const bestLower = best.toLowerCase() === best;
      if (lower && !bestLower) best = form;
      else if (lower === bestLower && form.localeCompare(best) < 0) best = form;
    }
  }
  return best;
}

/**
 * Aggregate per-atom tag lists into vocabulary with counts.
 * Case-insensitive merge. Display = most-common casing (ties → lowercase form)
 * so row scan order does not flip the label. Count = atoms that carry the tag
 * (duplicate tags on one atom count once). Sort: count desc, then tag alpha.
 * Cap at limit (default 500). Non-string/non-number values skipped.
 *
 * @param {Iterable<string[] | unknown>} tagLists
 * @param {{ limit?: number }} [opts]
 * @returns {{ tags: { tag: string, count: number }[], total_distinct: number, truncated: boolean }}
 */
export function aggregateMirrorTags(tagLists, opts = {}) {
  const limit = Math.min(
    Math.max(Number(opts.limit) || MIRROR_TAGS_LIMIT, 1),
    MIRROR_TAGS_LIMIT,
  );
  /** @type {Map<string, { forms: Map<string, number>, count: number }>} */
  const byKey = new Map();
  for (const list of tagLists) {
    if (!Array.isArray(list)) continue;
    const seen = new Set();
    for (const raw of list) {
      if (typeof raw !== "string" && typeof raw !== "number") continue;
      const tag = String(raw).trim();
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      let cur = byKey.get(key);
      if (!cur) {
        cur = { forms: new Map(), count: 0 };
        byKey.set(key, cur);
      }
      cur.count += 1;
      cur.forms.set(tag, (cur.forms.get(tag) || 0) + 1);
    }
  }
  const sorted = [...byKey.entries()]
    .map(([, v]) => ({ tag: pickTagDisplay(v.forms), count: v.count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.tag.localeCompare(b.tag, undefined, { sensitivity: "base" }),
    );
  const total_distinct = sorted.length;
  return {
    tags: sorted.slice(0, limit),
    total_distinct,
    truncated: total_distinct > limit,
  };
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

/**
 * What the Ask mirror covers. scope_complete is always false by design
 * (Atoms/ + linked hubs only — not the whole vault). Clients must not
 * hardcode paths — read these fields from responses.
 *
 * scope_note: agents must not treat absence as "not in the vault" or
 * "not on another Plus account" — only "not in this token's mirror."
 */
export const MIRROR_SCOPE_META = {
  mirror_scope: ["Atoms/", "hub notes linked from atoms"],
  scope_complete: false,
  scope_note:
    "Partial mirror for this Plus account only. Missing here does not mean missing from the vault or from another account.",
};

/** Fields mirrorSearch scores against. */
export const SEARCHED_FIELDS = ["title", "tags", "body"];

/** Forward relation → inverse label on the target. */
export const INVERSE_RELATION = {
  continues: "continued_by",
  revises: "revised_by",
  contradicts: "contradicted_by",
  adds_detail: "detailed_by",
};

/**
 * Scope + search-field metadata for any response that could be read as absence.
 * @param {{ searched_fields?: string[] }} [extra]
 */
export function absenceMeta(extra = {}) {
  return {
    ...MIRROR_SCOPE_META,
    searched_fields: extra.searched_fields ?? SEARCHED_FIELDS,
  };
}

/**
 * @param {{ title: string, path?: string, kind?: string, links?: { note: string, reason?: string }[], text?: string }[]} pubs
 * @returns {Map<string, { title: string, path: string, kind: string, reason: string|null, relation: string|null }[]>}
 */
export function buildInboundIndex(pubs) {
  /** @type {Map<string, { title: string, path: string, kind: string, reason: string|null, relation: string|null }[]>} */
  const idx = new Map();
  for (const pub of pubs || []) {
    const fromTitle = String(pub.title || "").trim();
    if (!fromTitle) continue;
    const links = mergeLinksFromBody(pub.links || [], pub.text || "");
    for (const l of links) {
      const target = String(l.note || "").trim();
      if (!target) continue;
      const key = target.toLowerCase();
      const edge = {
        title: fromTitle,
        path: pub.path || "",
        kind: pub.kind === "hub" ? "hub" : "atom",
        reason: l.reason || null,
        relation: relationFromReason(l.reason),
      };
      const list = idx.get(key);
      if (list) list.push(edge);
      else idx.set(key, [edge]);
    }
  }
  return idx;
}

/**
 * Materialize inverse revision edges + always-present status for one note.
 * Precedence: contradicted > superseded > live.
 * @param {string} centerTitle
 * @param {Map<string, { title: string, path: string, kind: string, reason: string|null, relation: string|null }[]>} inboundIndex
 */
export function revisionStatusFor(centerTitle, inboundIndex) {
  const key = String(centerTitle || "").trim().toLowerCase();
  const inbound = key && inboundIndex ? inboundIndex.get(key) || [] : [];

  /** @type {{ title: string, relation: string, path: string }[]} */
  const superseded_by = [];
  /** @type {{ title: string, relation: string, path: string }[]} */
  const contradicted_by = [];
  /** @type {{ title: string, relation: string, path: string }[]} */
  const continued_by = [];
  /** @type {{ title: string, relation: string, path: string }[]} */
  const detailed_by = [];

  for (const e of inbound) {
    if (!e.relation) continue;
    const inv = INVERSE_RELATION[e.relation];
    if (!inv) continue;
    const row = { title: e.title, relation: inv, path: e.path || "" };
    if (e.relation === "revises") superseded_by.push(row);
    else if (e.relation === "contradicts") contradicted_by.push(row);
    else if (e.relation === "continues") continued_by.push(row);
    else if (e.relation === "adds_detail") detailed_by.push(row);
  }

  /** @type {"live"|"superseded"|"contradicted"} */
  let status = "live";
  if (contradicted_by.length) status = "contradicted";
  else if (superseded_by.length) status = "superseded";

  return {
    status,
    superseded_by,
    contradicted_by,
    continued_by,
    detailed_by,
  };
}

/**
 * Score + rank public atoms into search hits with status + non-authoritative snippets.
 * @param {{ id?: string, title: string, path: string, kind?: string, tags?: string[], text?: string, links?: {note:string,reason?:string}[] }[]} pubs
 * @param {string} query
 * @param {number} limit
 * @param {{ tags?: string[], snippets?: boolean }} [opts]
 */
export function buildSearchHits(pubs, query, limit = 8, opts = {}) {
  const lim = Math.min(Math.max(Number(limit) || 8, 1), 25);
  const tagFilter = opts.tags;
  const includeSnippets = opts.snippets !== false;
  const inboundIndex = buildInboundIndex(pubs);
  const scored = [];
  for (const pub of pubs || []) {
    if (!matchesTagFilter(pub.tags, tagFilter)) continue;
    const s = scoreSearch(
      { title: pub.title, path: pub.path, tags: pub.tags, body: pub.text },
      query,
    );
    if (s <= 0) continue;
    const rev = revisionStatusFor(pub.title, inboundIndex);
    /** @type {Record<string, unknown>} */
    const hit = {
      id: pub.id,
      title: pub.title,
      path: pub.path,
      kind: pub.kind === "hub" ? "hub" : "atom",
      tags: pub.tags,
      score: s,
      status: rev.status,
      authoritative: false,
    };
    if (includeSnippets) {
      hit.snippet = makeSnippet(pub.text, query);
      hit.snippet_truncated = true;
    }
    if (rev.status === "superseded") hit.superseded_by = rev.superseded_by;
    if (rev.status === "contradicted") hit.contradicted_by = rev.contradicted_by;
    scored.push({ score: s, hit });
  }
  scored.sort(
    (a, b) => b.score - a.score || String(a.hit.title).localeCompare(String(b.hit.title)),
  );
  return scored.slice(0, lim).map((x) => x.hit);
}

/**
 * Build neighbors graph with center status + per-backlink status.
 * @param {{ title: string, path?: string, kind?: string, links?: object[], text?: string } | null} center
 * @param {string} idOrTitle
 * @param {{ title: string, path: string, kind?: string, links?: object[], text?: string }[]} pubs
 */
export function buildNeighborsGraph(center, idOrTitle, pubs) {
  const keyTitle = center?.title || String(idOrTitle || "").trim();
  if (!keyTitle) return null;
  const keyLower = keyTitle.toLowerCase();
  const inboundIndex = buildInboundIndex(pubs);

  const outgoing = center
    ? mergeLinksFromBody(center.links || [], center.text || "").map((l) => ({
        title: l.note,
        reason: l.reason || null,
        relation: relationFromReason(l.reason),
        direction: "out",
      }))
    : [];

  const backlinks = [];
  for (const pub of pubs || []) {
    if (String(pub.title || "").toLowerCase() === keyLower) continue;
    const links = mergeLinksFromBody(pub.links || [], pub.text || "");
    for (const l of links) {
      if (String(l.note || "").toLowerCase() !== keyLower) continue;
      const rev = revisionStatusFor(pub.title, inboundIndex);
      backlinks.push({
        title: pub.title,
        path: pub.path,
        reason: l.reason || null,
        relation: relationFromReason(l.reason),
        direction: "in",
        status: rev.status,
        snippet: makeSnippet(pub.text, keyTitle, 160),
        snippet_truncated: true,
        authoritative: false,
      });
      break;
    }
  }

  const found = Boolean(center);
  const hasBacklinks = backlinks.length > 0;
  const hubLinkedNotSynced = !found && hasBacklinks;
  const centerRev = revisionStatusFor(keyTitle, inboundIndex);
  /** @type {Record<string, unknown>} */
  const out = {
    title: keyTitle,
    path: center?.path || null,
    kind: center?.kind || null,
    found,
    in_this_mirror: found,
    // Back-compat name: true only when backlinks exist but center row is not mirrored (hub gap).
    // Prefer hub_linked_not_synced / in_this_mirror — false does NOT mean "absent from vault."
    exists_outside_mirror: hubLinkedNotSynced,
    hub_linked_not_synced: hubLinkedNotSynced,
    reason: found ? null : hubLinkedNotSynced ? "hub_not_synced" : "not_in_mirror",
    outgoing,
    backlinks,
    ...absenceMeta(),
  };
  if (found) {
    out.status = centerRev.status;
    if (centerRev.superseded_by.length) out.superseded_by = centerRev.superseded_by;
    if (centerRev.contradicted_by.length) out.contradicted_by = centerRev.contradicted_by;
  }
  return out;
}

/**
 * Shape fetch_atom success payload (status always present; hubs outside revision graph).
 * Uses neighbors graph backlinks for inverse edges (and per-source status on hubs).
 * @param {object} atom - public atom with body
 * @param {{ backlinks?: { title: string, path?: string, reason?: string|null, relation?: string|null, status?: string }[] } | null} neighborsGraph
 * @param {{ softCap?: number }} [opts]
 */
export function shapeFetchAtom(atom, neighborsGraph, opts = {}) {
  const softCap = opts.softCap ?? 100_000;
  let text = atom.text || "";
  if (text.length > softCap) {
    text = text.slice(0, softCap) + "\n…[truncated]";
  }
  const kind = atom.kind === "hub" ? "hub" : "atom";
  const links = (atom.links || []).map((l) => ({
    note: l.note,
    reason: l.reason || null,
    relation: relationFromReason(l.reason),
  }));
  const backlinks = neighborsGraph?.backlinks || [];
  const inboundEdges = backlinks.map((b) => ({
    title: b.title,
    path: b.path || "",
    kind: "atom",
    reason: b.reason || null,
    relation: b.relation ?? relationFromReason(b.reason),
  }));
  const inboundIndex = new Map([
    [String(atom.title || "").toLowerCase(), inboundEdges],
  ]);

  const syncedAt =
    atom.updatedAt || atom.updated_at || atom.synced_at || null;

  /** @type {Record<string, unknown>} */
  const base = {
    id: atom.id,
    title: atom.title,
    path: atom.path,
    kind,
    text,
    tags: atom.tags,
    links,
    authoritative: true,
    /** When this row was last written to the cloud mirror (ISO). */
    synced_at: syncedAt,
  };

  if (kind === "hub") {
    base.revision_participant = false;
    base.status = "live";
    base.related_atoms = backlinks.map((b) => ({
      title: b.title,
      path: b.path || "",
      reason: b.reason || null,
      relation: b.relation ?? relationFromReason(b.reason),
      status: b.status || "live",
      direction: "in",
    }));
    return base;
  }

  const rev = revisionStatusFor(atom.title, inboundIndex);
  base.revision_participant = true;
  base.status = rev.status;
  base.superseded_by = rev.superseded_by;
  base.contradicted_by = rev.contradicted_by;
  base.continued_by = rev.continued_by;
  base.detailed_by = rev.detailed_by;
  return base;
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
