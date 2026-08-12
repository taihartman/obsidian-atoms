/**
 * Shared Ask / mirror helpers (search scoring, row shape).
 */
import { createHash, randomInt } from "node:crypto";
import { contentHash, decryptMirrorField, encryptMirrorField } from "../mirror/crypto.mjs";

/**
 * PKCE S256 verification for the Ask OAuth authorization code.
 *
 * The digest itself lives in `pkceChallengeS256` — the single home for
 * "SHA-256, base64url" in this service. Any new verifier-style comparison
 * (e.g. the #240 magic-link device verifier) must call that helper rather
 * than re-deriving the digest, or the two encodings drift apart and a
 * security compare silently starts answering false. `hashToken` in
 * `store/shared.mjs` is sha256 **hex** and is not interchangeable with it.
 *
 * The `method !== "S256"` branch is a plaintext compare and exists only for
 * rows whose stored method is not S256. It is unreachable over HTTP today:
 * `/authorize` rejects any other method (`oauth/routes.mjs:180`) and the AS
 * metadata advertises S256 only. Do not widen it, and do not reuse this
 * function for a control that must never accept a plaintext compare.
 */
export function verifyPkce(codeVerifier, challenge, method = "S256") {
  if (method !== "S256") return challenge === codeVerifier;
  return pkceChallengeS256(codeVerifier) === challenge;
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

/**
 * The one PKCE S256 digest in this service: SHA-256 of the verifier,
 * **base64url** (RFC 7636 §4.2). Used to mint a code_challenge and, via
 * `verifyPkce`, to check one.
 *
 * The encoding is the contract, not an implementation detail — a caller that
 * hashes hex and a caller that hashes base64url never match, and the failure
 * shows up as a refused sign-in rather than as an error. `test/pkce-digest.test.mjs`
 * pins it against the RFC vector and fails if it drifts to hex.
 */
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
 * Normalize vault frontmatter `created` for mirror storage.
 * Day-only → `YYYY-MM-DD`; datetime → ISO-ish string; invalid → null.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeMirrorCreated(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/^["']|["']$/g, "");
  if (!s) return null;
  const dayOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dayOnly) return `${dayOnly[1]}-${dayOnly[2]}-${dayOnly[3]}`;
  const withTime = s.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})(?::(\d{2}))?/,
  );
  if (withTime) {
    const hh = String(withTime[4]).padStart(2, "0");
    const mm = withTime[5];
    const ss = String(withTime[6] ?? "00").padStart(2, "0");
    return `${withTime[1]}-${withTime[2]}-${withTime[3]}T${hh}:${mm}:${ss}`;
  }
  const t = Date.parse(s);
  if (Number.isFinite(t)) return new Date(t).toISOString();
  return null;
}

/** Inclusive range bound for created_after / created_before filters. */
export function normalizeCreatedBound(raw, edge /* 'start' | 'end' */) {
  const s = String(raw || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return edge === "end" ? `${s}T23:59:59.999` : `${s}T00:00:00`;
  }
  return normalizeMirrorCreated(s) || s;
}

/**
 * Comparable key for sort/filter. Day-only → noon (matches libraryTimeMs convention)
 * so day stamps are not lexicographically before every timed stamp that day.
 */
export function createdSortKey(created) {
  if (created == null || created === "") return null;
  const s = String(created);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T12:00:00`;
  return s;
}

/**
 * @param {{ path: string, title?: string, body?: string, tags?: string[], links?: {note:string,reason?:string}[], atomId?: string, kind?: string, created?: string }} atom
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
  const created = normalizeMirrorCreated(atom.created);
  const loop = normalizeLoop(atom.loop);
  const tagsJson = JSON.stringify(tags);
  const linksJson = JSON.stringify(links);
  const loopJson = loop ? JSON.stringify(loop) : null;
  const hash = contentHash([
    title,
    body,
    tagsJson,
    linksJson,
    kind,
    created || "",
    loopJson || "",
  ]);
  return {
    email: normEmail(email),
    atomId: atom.atomId || path,
    title,
    path,
    kind,
    bodyEnc: encryptMirrorField(body),
    tagsJson,
    linksJson,
    loopJson,
    contentHash: hash,
    updatedAt: new Date().toISOString(),
    created,
  };
}

/**
 * @param {unknown} raw
 * @returns {{ state: string, source: string } | null}
 */
export function normalizeLoop(raw) {
  if (!raw || typeof raw !== "object") return null;
  const state = String(/** @type {{state?:string}} */ (raw).state || "").trim();
  const source = String(/** @type {{source?:string}} */ (raw).source || "").trim();
  const states = new Set([
    "active",
    "not_a_loop",
    "resolved_elsewhere",
    "abandoned",
  ]);
  const sources = new Set(["inferred", "user"]);
  if (!states.has(state) || !sources.has(source)) return null;
  return { state, source };
}

/**
 * @param {{ state?: string } | null | undefined} loop
 * @param {boolean} hasRedeemingChild
 */
export function openNowFromLoop(loop, hasRedeemingChild) {
  return loop?.state === "active" && !hasRedeemingChild;
}

/**
 * @param {object} pub
 * @param {{ redeemed_by?: unknown[] } | null} [rev]
 */
export function attachLoopFields(pub, rev = null) {
  const loop = pub.loop ?? null;
  const hasRedeeming = Array.isArray(rev?.redeemed_by) && rev.redeemed_by.length > 0;
  return {
    open_now: openNowFromLoop(loop, hasRedeeming),
    loop: loop
      ? { state: loop.state, source: loop.source }
      : null,
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
  if (r.startsWith("redeems")) return "redeems";
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
  const createdRaw = row.created ?? row.created_at_note;
  const created =
    createdRaw != null && createdRaw !== ""
      ? normalizeMirrorCreated(createdRaw) ||
        (typeof createdRaw === "string"
          ? createdRaw
          : iso(createdRaw))
      : null;
  const loopRaw = row.loop_json ?? row.loopJson ?? row.loop;
  let loop = null;
  if (typeof loopRaw === "string" && loopRaw.trim()) {
    try {
      loop = normalizeLoop(JSON.parse(loopRaw));
    } catch {
      loop = null;
    }
  } else if (loopRaw && typeof loopRaw === "object") {
    loop = normalizeLoop(loopRaw);
  }
  const out = {
    id: row.atom_id ?? row.atomId,
    title: row.title,
    path,
    kind,
    tags,
    links,
    contentHash: row.content_hash ?? row.contentHash,
    updatedAt: iso(row.updated_at ?? row.updatedAt),
    created,
    loop,
  };
  if (includeBody) {
    out.text = text;
    const expandEnc =
      row.expand_enc ?? row.expandEnc ?? row.search_expand_enc ?? "";
    if (expandEnc) {
      try {
        const ex = decryptMirrorField(expandEnc);
        if (ex && String(ex).trim()) out.expand = String(ex);
      } catch {
        /* leave unset */
      }
    }
  }
  return out;
}

/**
 * Shape one list_atoms item from a public atom.
 * @param {object} pub
 */
export function shapeMirrorListItem(pub, rev = null) {
  return {
    id: pub.id,
    title: pub.title,
    path: pub.path,
    tags: pub.tags,
    kind: pub.kind,
    synced_at: pub.updatedAt ?? null,
    created: pub.created ?? null,
    ...attachLoopFields(pub, rev),
  };
}

/**
 * Filter/sort/paginate public mirror atoms for list_atoms.
 * Default sort: title ASC (back-compat). created/synced default order: desc.
 * Missing created sorts last on created sort.
 * @param {object[]} pubs
 * @param {object} [opts]
 */
export function paginateMirrorList(pubs, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 25, 1), 50);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  let sortBy = String(opts.sort_by || "title").toLowerCase();
  if (sortBy !== "title" && sortBy !== "created" && sortBy !== "synced") {
    sortBy = "title";
  }
  let order = String(opts.order || "").toLowerCase();
  if (order !== "asc" && order !== "desc") {
    order = sortBy === "title" ? "asc" : "desc";
  }
  const after = normalizeCreatedBound(opts.created_after, "start");
  const before = normalizeCreatedBound(opts.created_before, "end");
  const tagFilter = opts.tags;

  let missingCreated = 0;
  let filtered = (pubs || []).filter((p) => {
    if (!matchesTagFilter(p.tags, tagFilter)) return false;
    const ck = createdSortKey(p.created);
    if (after || before) {
      if (!ck) {
        missingCreated += 1;
        return false;
      }
      if (after && ck < after) return false;
      if (before && ck > before) return false;
    }
    return true;
  });

  const dir = order === "asc" ? 1 : -1;
  filtered = [...filtered].sort((a, b) => {
    if (sortBy === "created") {
      const ak = createdSortKey(a.created);
      const bk = createdSortKey(b.created);
      const aN = !ak;
      const bN = !bk;
      if (aN && bN) {
        /* fall through */
      } else if (aN) return 1;
      else if (bN) return -1;
      else {
        const c = String(ak).localeCompare(String(bk));
        if (c) return c * dir;
      }
    } else if (sortBy === "synced") {
      const as = a.updatedAt || "";
      const bs = b.updatedAt || "";
      const c = String(as).localeCompare(String(bs));
      if (c) return c * dir;
    } else {
      const c = String(a.title || "").localeCompare(String(b.title || ""), undefined, {
        sensitivity: "base",
      });
      if (c) return c * dir;
    }
    return String(a.path || "").localeCompare(String(b.path || ""));
  });

  const total = filtered.length;
  const slice = filtered.slice(offset, offset + limit);
  const inboundIndex = buildInboundIndex(pubs || []);
  const items = slice.map((pub) =>
    shapeMirrorListItem(pub, revisionStatusFor(pub.title, inboundIndex)),
  );
  const next_offset =
    offset + items.length < total ? offset + items.length : null;
  /** @type {Record<string, unknown>} */
  const out = { items, total, offset, limit, next_offset };
  if (after || before) {
    out.excluded_missing_created = missingCreated;
  }
  const withCreated = (pubs || []).filter((p) => p.created).length;
  out.created_coverage = {
    with_created: withCreated,
    total: (pubs || []).length,
  };
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

/** Function words only — names and distinctive tokens stay (R2). */
const SEARCH_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "it",
  "this",
  "that",
  "at",
  "as",
  "by",
  "from",
  "into",
  "about",
  "than",
  "then",
  "so",
  "if",
  "not",
  "no",
  "do",
  "does",
  "did",
  "can",
  "could",
  "should",
  "would",
  "will",
  "just",
  "very",
  "also",
  "too",
  "my",
  "your",
  "our",
  "their",
  "me",
  "you",
  "we",
  "they",
  "i",
]);

/**
 * Content words for coverage scoring (KTD1).
 * @param {string} query
 * @returns {string[]}
 */
export function contentWords(query) {
  return String(query || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !SEARCH_STOPWORDS.has(w));
}

/** Relative floor vs top score among confident hits (KTD3). */
export const SEARCH_REL_FLOOR = 0.5;

/**
 * Count non-overlapping occurrences of needle in hay (cap 20).
 * @param {string} hay
 * @param {string} needle
 */
function countOccurrences(hay, needle) {
  if (!needle || !hay) return { count: 0, first: -1 };
  let count = 0;
  let from = 0;
  let first = -1;
  while (count < 20) {
    const i = hay.indexOf(needle, from);
    if (i < 0) break;
    if (first < 0) first = i;
    count += 1;
    from = i + needle.length;
  }
  return { count, first };
}

/**
 * Score candidate for search (higher = better) + agent confidence.
 * Exact title > title prefix > title contains > tags > expand/body TF.
 * Multi-word: coverage-aware (no sparse hit*12 junk). Expand field optional.
 * @param {{ title: string, path: string, tags: string[], body: string, expand?: string }} doc
 * @param {string} query
 * @returns {{ score: number, confidence: 'high'|'medium'|null, expandStrong?: boolean, match_signals?: string[] }}
 */
export function scoreSearch(doc, query) {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, confidence: null };
  const title = (doc.title || "").toLowerCase();
  const path = (doc.path || "").toLowerCase();
  const tags = (doc.tags || []).map((t) => String(t).toLowerCase());
  const body = (doc.body || "").toLowerCase();
  const expand = String(doc.expand || "").toLowerCase();
  let score = 0;

  let titleExact = false;
  let titlePrefix = false;
  let titleContains = false;
  if (title === q) {
    score += 1000;
    titleExact = true;
  } else if (title.startsWith(q)) {
    score += 400;
    titlePrefix = true;
  } else {
    const ti = title.indexOf(q);
    if (ti >= 0) {
      score += 200 - Math.min(ti, 100);
      titleContains = true;
    }
  }

  if (path.includes(q)) score += 30;

  let tagExact = false;
  let tagContains = false;
  for (const t of tags) {
    if (t === q) {
      score += 150;
      tagExact = true;
    } else if (t.includes(q)) {
      score += 40;
      tagContains = true;
    }
  }

  let bodyPhrase = false;
  if (body.includes(q)) {
    bodyPhrase = true;
    const { count, first } = countOccurrences(body, q);
    score += 20 + count * 8;
    if (first >= 0 && first < 200) score += 15;
  }

  let expandPhrase = false;
  if (expand && expand.includes(q)) {
    expandPhrase = true;
    const { count } = countOccurrences(expand, q);
    score += 20 + count * 8;
  }

  const words = contentWords(q);
  let coverage = 0;
  let matched = 0;
  let titleWordHits = 0;
  let tagWordHits = 0;
  let bodyWordHits = 0;
  let expandWordHits = 0;
  let longBodyWordHits = 0;
  let longExpandWordHits = 0;
  if (words.length > 0) {
    for (const w of words) {
      let hit = false;
      if (title.includes(w)) {
        titleWordHits += 1;
        hit = true;
      }
      if (tags.some((t) => t === w || t.includes(w))) {
        tagWordHits += 1;
        hit = true;
      }
      if (body.includes(w)) {
        bodyWordHits += 1;
        if (w.length >= 4) longBodyWordHits += 1;
        hit = true;
      }
      if (expand && expand.includes(w)) {
        expandWordHits += 1;
        if (w.length >= 4) longExpandWordHits += 1;
        hit = true;
      }
      if (hit) matched += 1;
    }
    coverage = matched / words.length;
    if (words.length > 1) {
      score += Math.round(coverage * 80);
      score +=
        titleWordHits * 24 +
        tagWordHits * 18 +
        expandWordHits * 12 +
        bodyWordHits * 6;
    } else if (expandWordHits && !titleWordHits && !tagWordHits && !bodyWordHits) {
      score += expandWordHits * 12;
    }
  }

  const expandStrong =
    (expandPhrase && words.length >= 2) ||
    (expandWordHits >= 2 &&
      longExpandWordHits >= 2 &&
      coverage >= 0.5 &&
      words.length > 1);

  const allTitleWords =
    words.length > 1 && titleWordHits === words.length && words.length > 0;
  const multiHighCoverage =
    words.length > 1 && coverage >= 0.85 && titleWordHits >= 2;

  /** @type {'high'|'medium'|null} */
  let confidence = null;
  if (
    titleExact ||
    titlePrefix ||
    tagExact ||
    (titleContains && q.length >= 3) ||
    allTitleWords ||
    multiHighCoverage
  ) {
    confidence = "high";
  } else if (titleContains || tagContains) {
    confidence = "medium";
  } else if (words.length <= 1) {
    if (
      bodyPhrase ||
      expandPhrase ||
      titleWordHits ||
      tagWordHits ||
      bodyWordHits ||
      expandWordHits
    ) {
      confidence = "medium";
    }
  } else {
    const fields =
      (titleWordHits > 0 ? 1 : 0) +
      (tagWordHits > 0 ? 1 : 0) +
      (bodyWordHits > 0 ? 1 : 0) +
      (expandWordHits > 0 ? 1 : 0);
    const coverageOk = coverage >= 0.5 || (matched >= 3 && fields >= 2);
    const bodyStrong =
      coverage >= 0.67 && longBodyWordHits >= 2 && matched >= 2;
    if (coverageOk && (titleWordHits > 0 || tagWordHits > 0)) {
      confidence = "medium";
    } else if (bodyStrong || expandStrong) {
      confidence = "medium";
    }
  }

  if (confidence == null) score = 0;

  /** @type {string[]} */
  const match_signals = [];
  if (titleExact || titlePrefix || titleContains || titleWordHits > 0) {
    match_signals.push("title");
  }
  if (tagExact || tagContains || tagWordHits > 0) match_signals.push("tag");
  if (bodyPhrase || bodyWordHits > 0) match_signals.push("body");
  if (expandPhrase || expandWordHits > 0) match_signals.push("expand");

  return {
    score,
    confidence,
    expandStrong: Boolean(expandStrong || expandPhrase),
    match_signals,
  };
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
 * Prefer capture region (before first blank line) when query lives there (R12).
 * @param {string} body
 * @param {string} query
 */
function snippetSource(body, query) {
  const text = body || "";
  const blank = text.search(/\n\s*\n/);
  if (blank < 0) return text;
  const head = text.slice(0, blank);
  const q = query.trim().toLowerCase();
  if (!q) return head || text;
  if (head.toLowerCase().includes(q)) return head;
  const words = contentWords(q);
  if (
    words.length &&
    words.some((w) => head.toLowerCase().includes(w)) &&
    !words.every((w) => text.slice(blank).toLowerCase().includes(w) && !head.toLowerCase().includes(w))
  ) {
    if (words.filter((w) => head.toLowerCase().includes(w)).length >= Math.ceil(words.length / 2)) {
      return head;
    }
  }
  return text;
}

/**
 * @param {string} body
 * @param {string} query
 * @param {number} max
 */
export function makeSnippet(body, query, max = 240) {
  const text = snippetSource(body, query);
  const q = query.trim().toLowerCase();
  let start = 0;
  if (q) {
    const idx = text.toLowerCase().indexOf(q);
    if (idx >= 0) start = Math.max(0, idx - 40);
    else {
      for (const w of contentWords(q)) {
        const i = text.toLowerCase().indexOf(w);
        if (i >= 0) {
          start = Math.max(0, i - 40);
          break;
        }
      }
    }
  }
  let end = Math.min(text.length, start + max);
  if (end < text.length) {
    const sp = text.lastIndexOf(" ", end);
    if (sp > start + Math.floor(max * 0.5)) end = sp;
  }
  if (start > 0) {
    const sp = text.indexOf(" ", start);
    if (sp > start && sp < end) start = sp + 1;
  }
  let snip = text.slice(start, end);
  if (start > 0) snip = "…" + snip;
  if (end < text.length) snip = snip + "…";
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
  redeems: "redeemed_by",
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
  /** @type {{ title: string, relation: string, path: string }[]} */
  const redeemed_by = [];

  for (const e of inbound) {
    if (!e.relation) continue;
    const inv = INVERSE_RELATION[e.relation];
    if (!inv) continue;
    const row = { title: e.title, relation: inv, path: e.path || "" };
    if (e.relation === "revises") superseded_by.push(row);
    else if (e.relation === "contradicts") contradicted_by.push(row);
    else if (e.relation === "continues") continued_by.push(row);
    else if (e.relation === "adds_detail") detailed_by.push(row);
    else if (e.relation === "redeems") redeemed_by.push(row);
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
    redeemed_by,
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
  const relFloor =
    opts.relFloor == null ? SEARCH_REL_FLOOR : Number(opts.relFloor);
  const inboundIndex = buildInboundIndex(pubs);
  const scored = [];
  for (const pub of pubs || []) {
    if (!matchesTagFilter(pub.tags, tagFilter)) continue;
    const {
      score: s,
      confidence,
      expandStrong,
      match_signals,
    } = scoreSearch(
      {
        title: pub.title,
        path: pub.path,
        tags: pub.tags,
        body: pub.text,
        expand: pub.expand,
      },
      query,
    );
    if (!confidence || s <= 0) continue;
    const rev = revisionStatusFor(pub.title, inboundIndex);
    /** @type {Record<string, unknown>} */
    const hit = {
      id: pub.id,
      title: pub.title,
      path: pub.path,
      kind: pub.kind === "hub" ? "hub" : "atom",
      tags: pub.tags,
      score: s,
      confidence,
      status: rev.status,
      authoritative: false,
      created: pub.created ?? null,
      synced_at: pub.updatedAt ?? null,
      ...attachLoopFields(pub, rev),
    };
    if (match_signals?.length) hit.match_signals = match_signals;
    if (includeSnippets) {
      hit.snippet = makeSnippet(pub.text, query);
      hit.snippet_truncated = true;
    }
    if (rev.status === "superseded") hit.superseded_by = rev.superseded_by;
    if (rev.status === "contradicted") hit.contradicted_by = rev.contradicted_by;
    scored.push({ score: s, hit, expandStrong: Boolean(expandStrong) });
  }
  scored.sort(
    (a, b) => b.score - a.score || String(a.hit.title).localeCompare(String(b.hit.title)),
  );
  // Relative floor only among medium hits (vs top medium). High title/tag hits
  // always stay — otherwise a 1000 title score drops every body/expand medium.
  let filtered = scored;
  if (scored.length >= 2 && Number.isFinite(relFloor) && relFloor > 0) {
    const highs = scored.filter((x) => x.hit.confidence === "high");
    const mediums = scored.filter((x) => x.hit.confidence === "medium");
    if (mediums.length >= 2) {
      const topMed = mediums[0].score;
      const floor = relFloor * topMed;
      const keptMed = mediums.filter(
        (x) => x.expandStrong || x.score >= floor,
      );
      filtered = [...highs, ...(keptMed.length ? keptMed : [mediums[0]])];
      filtered.sort(
        (a, b) =>
          b.score - a.score ||
          String(a.hit.title).localeCompare(String(b.hit.title)),
      );
    }
  }
  return filtered.slice(0, lim).map((x) => x.hit);
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
    Object.assign(out, attachLoopFields(center, centerRev));
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
  const centerRev = revisionStatusFor(atom.title, inboundIndex);

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
    /** Note frontmatter created when known (day or ISO). */
    created: atom.created ?? null,
    ...attachLoopFields(atom, centerRev),
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

  base.revision_participant = true;
  base.status = centerRev.status;
  base.superseded_by = centerRev.superseded_by;
  base.contradicted_by = centerRev.contradicted_by;
  base.continued_by = centerRev.continued_by;
  base.detailed_by = centerRev.detailed_by;
  if (centerRev.redeemed_by?.length) base.redeemed_by = centerRev.redeemed_by;
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
  "redeems",
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
    case "redeems":
      return `redeems [[${p}]]`;
    case "continues":
    default:
      return `continues [[${p}]]`;
  }
}

export const OUTBOX_LOOP_STATES = new Set([
  "active",
  "not_a_loop",
  "resolved_elsewhere",
  "abandoned",
]);

/**
 * @param {"create"|"continue"|"set_loop"} kind
 * @param {object} raw
 * @returns {{ ok: true, payload: object } | { ok: false, error: string }}
 */
export function validateOutboxPayload(kind, raw) {
  const title = String(raw?.title || "")
    .trim()
    .slice(0, OUTBOX_TITLE_MAX);
  if (!title) return { ok: false, error: "title required" };

  const client_request_id = raw?.client_request_id
    ? String(raw.client_request_id).trim().slice(0, 128)
    : undefined;

  if (kind === "set_loop") {
    const state = String(raw?.state || "").trim();
    if (!OUTBOX_LOOP_STATES.has(state)) {
      return { ok: false, error: "invalid state" };
    }
    return {
      ok: true,
      payload: {
        title,
        state,
        client_request_id,
      },
    };
  }

  const body = String(raw?.body ?? "");
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
    const close_answer =
      raw?.close_answer != null
        ? String(raw.close_answer).replace(/[\r\n]/g, " ").trim().slice(0, 500)
        : undefined;
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
        ...(close_answer ? { close_answer } : {}),
      },
    };
  }

  const open_loop = raw?.open_loop === true ? true : undefined;
  return {
    ok: true,
    payload: {
      title,
      body,
      tags,
      links,
      client_request_id,
      ...(open_loop ? { open_loop: true } : {}),
    },
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
