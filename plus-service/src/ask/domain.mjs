import { retrievalModeForCoverage } from "./expandSearch.mjs";
import { absenceMeta, shapeFetchAtom } from "../store/askHelpers.mjs";

const MAX_FETCH_BYTES = 16 * 1024;

function searchResult(result) {
  if (Array.isArray(result)) return { hits: result, omitted_below_threshold: 0, omitted_by_limit: 0, tag_pool: 0 };
  return {
    hits: Array.isArray(result?.hits) ? result.hits : [],
    omitted_below_threshold: Number(result?.omitted_below_threshold) || 0,
    omitted_by_limit: Number(result?.omitted_by_limit) || 0,
    tag_pool: Number(result?.tag_pool) || 0,
  };
}

function iso(value) {
  if (value == null) return null;
  const parsed = Date.parse(value instanceof Date ? value.toISOString() : String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function utf8Page(text, offset, maxBytes) {
  const bytes = Buffer.from(String(text || ""), "utf8");
  const start = Math.max(0, Number(offset) || 0);
  const limit = Math.min(Math.max(Number(maxBytes) || MAX_FETCH_BYTES, 1), MAX_FETCH_BYTES);
  if (start > bytes.length || (start > 0 && (bytes[start] & 0xc0) === 0x80)) return null;
  let end = Math.min(bytes.length, start + limit);
  while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
  if (end === start && end < bytes.length) {
    end += 1;
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end += 1;
  }
  return {
    text: bytes.subarray(start, end).toString("utf8"),
    position: { offset: start, next_offset: end < bytes.length ? end : null, total_bytes: bytes.length },
  };
}

/** Shared read semantics for MCP, G2, and future protocol adapters. */
export function createAskDomain({ store, email }) {
  if (!store || !email) throw new Error("ask_domain_context_required");

  async function context() {
    const [status, coveragePage, expand] = await Promise.all([
      store.mirrorStatus(email),
      store.mirrorList(email, { limit: 1 }),
      typeof store.mirrorExpandCoverage === "function" ? store.mirrorExpandCoverage(email) : 0,
    ]);
    return {
      mirror_count: Number(status?.count) || 0,
      last_synced_at: iso(status?.updatedAt),
      created_coverage: coveragePage?.created_coverage || { with_created: 0, total: Number(status?.count) || 0 },
      retrieval: retrievalModeForCoverage(Number(expand) || 0),
      expand_coverage: Number(expand) || 0,
      ...absenceMeta(),
    };
  }

  return {
    async search({ query, limit = 8, tags, snippets = true } = {}) {
      const [ranked, meta] = await Promise.all([
        store.mirrorSearch(email, String(query || ""), limit, { tags, snippets }),
        context(),
      ]);
      const normalized = searchResult(ranked);
      return { results: normalized.hits, returned: normalized.hits.length, limit, ...normalized, ...meta };
    },

    async recent({ limit = 20, offset = 0 } = {}) {
      const page = await store.mirrorList(email, {
        limit: Math.min(Math.max(Number(limit) || 20, 1), 20),
        offset,
        sort_by: "created",
        order: "desc",
        kind: "atom",
      });
      const meta = await context();
      const coverage = page.created_coverage || { with_created: 0, total: page.total || 0 };
      return {
        ...page,
        ...meta,
        created_coverage: coverage,
        coverage_complete: coverage.total === 0 || coverage.with_created === coverage.total,
      };
    },

    async list(options = {}) {
      const [page, meta] = await Promise.all([store.mirrorList(email, options), context()]);
      return { ...page, ...meta, created_coverage: page.created_coverage || meta.created_coverage };
    },

    async fetch({ id, offset = 0, maxBytes = MAX_FETCH_BYTES } = {}) {
      const atom = await store.mirrorFetch(email, String(id || ""));
      if (!atom || atom.id !== id) return { error: "not_found", ...absenceMeta() };
      const page = utf8Page(atom.text, offset, maxBytes);
      if (!page) return { error: "invalid_position", ...absenceMeta() };
      return {
        id: atom.id,
        title: atom.title,
        path: atom.path,
        kind: atom.kind === "hub" ? "hub" : "atom",
        tags: atom.tags || [],
        content_hash: atom.contentHash,
        synced_at: atom.updatedAt ?? null,
        created: atom.created ?? null,
        authoritative: true,
        ...page,
      };
    },

    async fetchByReference(idOrTitle) {
      const atom = await store.mirrorFetch(email, idOrTitle);
      if (!atom) return null;
      const graph = typeof store.mirrorNeighbors === "function"
        ? await store.mirrorNeighbors(email, atom.title)
        : null;
      return shapeFetchAtom(atom, graph);
    },
  };
}
