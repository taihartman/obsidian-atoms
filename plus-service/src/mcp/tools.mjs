/**
 * Register Ask tools on an McpServer (read + write-via-outbox).
 */
import { z } from "zod";
import { hasWriteScope } from "../oauth/constants.mjs";
import { checkRateLimit } from "../ratelimit.mjs";
import {
  validateOutboxPayload,
  OUTBOX_RELATIONS,
  absenceMeta,
  shapeFetchAtom,
} from "../store/askHelpers.mjs";

const EMPTY_HINT =
  "mirror empty—sync from Obsidian (Settings → Atoms → Ask → Sync now)";
const MISSING_HINT =
  "not in this Plus account's Ask mirror (Atoms/ + linked hubs only—not the whole vault, not other accounts). Call mirror_status if the user expected this note.";
const HUB_NOT_SYNCED_HINT =
  "This name has backlinks from atoms but the hub note is not in the mirror yet. Open Obsidian with Ask on and Sync now (hubs linked from Atoms/ are included). Do not create a duplicate hub.";
const PENDING_HINT =
  "Queued for your vault—open Obsidian (Ask enabled + Allow filing). Usually lands within a minute when the app is open. Do not claim it is filed until fetch_atom returns it.";

function jsonTool(obj, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(obj, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

/** Normalize mirrorStatus.updatedAt → ISO string or null. */
function formatLastSynced(updatedAt) {
  if (updatedAt == null) return null;
  let lastSynced =
    updatedAt instanceof Date ? updatedAt.toISOString() : String(updatedAt);
  const t = Date.parse(lastSynced);
  if (Number.isFinite(t)) lastSynced = new Date(t).toISOString();
  return lastSynced;
}

/**
 * @param {import('@modelcontextprotocol/server').McpServer} mcp
 * @param {{ email: string, store: object, scopes?: string[] }} ctx
 */
export function registerAskTools(mcp, ctx) {
  const { email, store, scopes = ["atoms:read"] } = ctx;

  function writeRateOk() {
    return checkRateLimit(`ask-write:${email}`, 30);
  }

  /** Full-mirror scans (list_tags / list_atoms) — cheaper than write, still bounded. */
  function listTagsRateOk() {
    return checkRateLimit(`ask-list-tags:${email}`, 60);
  }
  function listAtomsRateOk() {
    return checkRateLimit(`ask-list-atoms:${email}`, 60);
  }

  function requireWrite() {
    if (hasWriteScope(scopes)) return null;
    return jsonTool(
      {
        error: "insufficient_scope",
        required_scope: "atoms:write",
        granted_scopes: scopes,
        hint: "Reconnect Atoms Ask and Allow access (atoms:write) to queue atoms.",
      },
      true,
    );
  }

  mcp.registerTool(
    "mirror_status",
    {
      title: "Mirror status",
      description:
        "Which Plus account this connector reads, how many notes are in the Ask mirror, when the mirror last received a push, pending outbox writes, and granted scopes. Call first when counts look wrong, the user disputes absence, or you need account identity (wrong-tenant diagnosis).",
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {},
    },
    async () => {
      const st = await store.mirrorStatus(email);
      const pendingWrites = await store.outboxPendingCount(email);
      const count = st?.count ?? 0;
      return jsonTool({
        account: email,
        server_count: count,
        last_synced_at: formatLastSynced(st?.updatedAt),
        pending_writes: pendingWrites,
        granted_scopes: scopes,
        ...absenceMeta({ searched_fields: [] }),
        hint: count === 0 ? EMPTY_HINT : undefined,
      });
    },
  );

  mcp.registerTool(
    "list_tags",
    {
      title: "List tags",
      description:
        "Distinct tags on mirrored atoms with per-tag atom counts. Sorted by count descending, then tag name ascending (cap 500). When truncated is true, a missing tag is inconclusive—still try search_atoms. Call before concluding a tags: filter on search_atoms found nothing—distinguishes missing tag vs tag present but no query match. Partial mirror only.",
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {},
    },
    async () => {
      const rl = listTagsRateOk();
      if (!rl.ok) {
        return jsonTool(
          { error: "rate_limited", retryAfterSec: rl.retryAfterSec },
          true,
        );
      }
      const result = await store.mirrorListTags(email);
      const mirrorCount = result?.mirror_count ?? 0;
      const tags = result?.tags ?? [];
      const truncated = Boolean(result?.truncated);
      let hint;
      if (mirrorCount === 0) hint = EMPTY_HINT;
      else if (truncated)
        hint =
          "tag list capped (see total_distinct); missing tag here is inconclusive—try search_atoms tags filter";
      else if (tags.length === 0)
        hint =
          "no tags on mirrored atoms in this account's mirror—not proof the vault has none";
      return jsonTool({
        account: email,
        mirror_count: mirrorCount,
        tags,
        total_distinct: result?.total_distinct ?? tags.length,
        truncated,
        ...absenceMeta({ searched_fields: ["tags"] }),
        hint,
      });
    },
  );

  mcp.registerTool(
    "search_atoms",
    {
      title: "Search atoms",
      description:
        "Search mirrored atoms by title, tags, and body. Higher score = better match. Optional tags filter (all must match). Snippets are truncated and non-authoritative—use fetch_atom before claiming what a note contains. Results include status (live|superseded|contradicted).",
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        query: z.string().describe("Search query"),
        limit: z.number().int().min(1).max(25).optional(),
        tags: z
          .array(z.string())
          .optional()
          .describe("Only atoms that have all of these tags"),
        snippets: z
          .boolean()
          .optional()
          .describe(
            "If false, omit snippet fields (forces fetch_atom for content questions). Default true.",
          ),
      },
    },
    async ({ query, limit, tags, snippets }) => {
      const st = await store.mirrorStatus(email);
      const hits = await store.mirrorSearch(email, query, limit ?? 8, {
        tags,
        snippets,
      });
      const scope = absenceMeta();
      if (!hits.length) {
        const tagFilter = Array.isArray(tags) && tags.length > 0;
        let emptyHint;
        if (st.count === 0) emptyHint = EMPTY_HINT;
        else if (tagFilter)
          emptyHint =
            "no matches for this query in this account's mirror_scope—call list_tags before concluding the tag is absent; confirm account via mirror_status if unexpected";
        else
          emptyHint =
            "no matches for this query in this account's mirror_scope—confirm account via mirror_status if unexpected";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                results: [],
                account: email,
                mirror_count: st.count,
                ...scope,
                hint: emptyHint,
              }),
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                results: hits,
                account: email,
                mirror_count: st.count,
                returned: hits.length,
                limit: limit ?? 8,
                ...scope,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  mcp.registerTool(
    "fetch_atom",
    {
      title: "Fetch atom",
      annotations: { readOnlyHint: true, destructiveHint: false },
      description:
        "Fetch one mirrored note by title or path (atoms under Atoms/ and hub notes linked from atoms). Returns verbatim body (authoritative), tags, kind (atom|hub), synced_at (when this row was last pushed to the cloud mirror), status (live|superseded|contradicted), inverse revision edges, and structured links. Hubs set revision_participant:false.",
      inputSchema: {
        id_or_title: z
          .string()
          .describe("Title, path (Atoms/….md or hub path), or id"),
      },
    },
    async ({ id_or_title }) => {
      const atom = await store.mirrorFetch(email, id_or_title);
      if (!atom) {
        const st = await store.mirrorStatus(email);
        const graph =
          typeof store.mirrorNeighbors === "function"
            ? await store.mirrorNeighbors(email, id_or_title)
            : null;
        const hubNotSynced = Boolean(
          graph?.hub_linked_not_synced ?? graph?.exists_outside_mirror,
        );
        return {
          content: [
            {
              type: "text",
                text: JSON.stringify({
                error: "not_found",
                id_or_title,
                account: email,
                mirror_count: st.count,
                in_this_mirror: false,
                // Legacy: true only for hub-linked-not-synced. false ≠ vault absence.
                exists_outside_mirror: hubNotSynced,
                hub_linked_not_synced: hubNotSynced,
                reason: hubNotSynced
                  ? "hub_not_synced"
                  : st.count === 0
                    ? "mirror_empty"
                    : "not_in_mirror",
                backlink_count: graph?.backlinks?.length ?? 0,
                ...absenceMeta(),
                hint:
                  st.count === 0
                    ? EMPTY_HINT
                    : hubNotSynced
                      ? HUB_NOT_SYNCED_HINT
                      : MISSING_HINT,
              }),
            },
          ],
          isError: true,
        };
      }
      const graph =
        typeof store.mirrorNeighbors === "function"
          ? await store.mirrorNeighbors(email, atom.title)
          : null;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(shapeFetchAtom(atom, graph), null, 2),
          },
        ],
      };
    },
  );

  mcp.registerTool(
    "neighbors",
    {
      title: "Neighbors",
      annotations: { readOnlyHint: true, destructiveHint: false },
      description:
        "Graph around a title: outgoing [[links]] from that atom (if mirrored) plus backlinks (other mirrored atoms that link to this name). Includes status on the center (when found) and on each backlink. Works even when the hub note is not in Atoms/.",
      inputSchema: {
        title: z
          .string()
          .describe("Atom title or hub name, e.g. Nichita"),
      },
    },
    async ({ title }) => {
      const graph = await store.mirrorNeighbors(email, title);
      if (!graph) {
        const st = await store.mirrorStatus(email);
        return {
          content: [
            {
              type: "text",
                  text: JSON.stringify({
                error: "empty",
                account: email,
                mirror_count: st.count,
                ...absenceMeta(),
                hint: st.count === 0 ? EMPTY_HINT : "invalid title",
              }),
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(graph, null, 2),
          },
        ],
      };
    },
  );

  mcp.registerTool(
    "create_atom",
    {
      title: "Create atom",
      annotations: { readOnlyHint: false, destructiveHint: true },
      description:
        "Queue a new atom for the user's vault (outbox). Does NOT write instantly—status stays pending until Obsidian applies it. Prefer user-dictated body text; do not invent facts.",
      inputSchema: {
        title: z.string().describe("Declarative atom title"),
        body: z.string().describe("Atom body / capture text"),
        tags: z.array(z.string()).optional(),
        links: z
          .array(
            z.object({
              note: z.string(),
              reason: z.string().optional(),
            }),
          )
          .optional(),
        client_request_id: z
          .string()
          .optional()
          .describe("Idempotency key for retries"),
      },
    },
    async (args) => {
      const denied = requireWrite();
      if (denied) return denied;
      const rl = writeRateOk();
      if (!rl.ok) {
        return jsonTool(
          {
            error: "rate_limited",
            retryAfterSec: rl.retryAfterSec,
          },
          true,
        );
      }
      const v = validateOutboxPayload("create", args);
      if (!v.ok) return jsonTool({ error: v.error }, true);
      const enq = await store.outboxEnqueue(email, {
        kind: "create",
        payload: v.payload,
        client_request_id: v.payload.client_request_id,
      });
      if (!enq.ok) {
        return jsonTool(
          {
            error: enq.error || "enqueue_failed",
            hint:
              enq.error === "outbox_full"
                ? "Too many pending writes—open Obsidian to drain the queue"
                : undefined,
          },
          true,
        );
      }
      return jsonTool({
        status: enq.status,
        outbox_id: enq.id,
        title: v.payload.title,
        duplicate: Boolean(enq.duplicate),
        hint: PENDING_HINT,
      });
    },
  );

  mcp.registerTool(
    "continue_atom",
    {
      title: "Continue atom",
      annotations: { readOnlyHint: false, destructiveHint: true },
      description:
        "Queue a NEW child atom that continues/revises/contradicts a parent (parent body never modified). Parent must exist in the Ask mirror. Pending until Obsidian applies.",
      inputSchema: {
        parent_title: z.string().describe("Existing mirrored atom title"),
        title: z.string().describe("Title for the new child atom"),
        body: z.string().describe("Child atom body"),
        relation: z
          .enum(["continues", "revises", "contradicts", "adds_detail"])
          .optional()
          .describe("Graph relation to parent (default continues)"),
        tags: z.array(z.string()).optional(),
        links: z
          .array(
            z.object({
              note: z.string(),
              reason: z.string().optional(),
            }),
          )
          .optional(),
        client_request_id: z.string().optional(),
      },
    },
    async (args) => {
      const denied = requireWrite();
      if (denied) return denied;
      const rl = writeRateOk();
      if (!rl.ok) {
        return jsonTool(
          {
            error: "rate_limited",
            retryAfterSec: rl.retryAfterSec,
          },
          true,
        );
      }
      const parentTitle = String(args.parent_title || "").trim();
      const parent = await store.mirrorFetch(email, parentTitle);
      const parentPending =
        !parent &&
        typeof store.outboxHasOpenTitle === "function" &&
        (await store.outboxHasOpenTitle(email, parentTitle));
      if (!parent && !parentPending) {
        const st = await store.mirrorStatus(email);
        return jsonTool(
          {
            error: "parent_not_found",
            parent_title: parentTitle,
            mirror_count: st.count,
            ...absenceMeta(),
            hint:
              "Parent must be in the Ask mirror or still pending in the outbox (create_atom first). Otherwise Sync Ask after Process.",
          },
          true,
        );
      }
      if (parent?.kind === "hub") {
        return jsonTool(
          {
            error: "parent_is_hub",
            parent_title: parentTitle,
            path: parent.path,
            hint:
              "Hub notes are read-only in Ask. continue_atom only against atoms under Atoms/.",
          },
          true,
        );
      }
      const relation = args.relation || "continues";
      if (!OUTBOX_RELATIONS.has(relation)) {
        return jsonTool({ error: "invalid relation" }, true);
      }
      const v = validateOutboxPayload("continue", {
        ...args,
        parent_title: parent?.title || parentTitle,
        relation,
      });
      if (!v.ok) return jsonTool({ error: v.error }, true);
      const enq = await store.outboxEnqueue(email, {
        kind: "continue",
        payload: v.payload,
        client_request_id: v.payload.client_request_id,
      });
      if (!enq.ok) {
        return jsonTool(
          {
            error: enq.error || "enqueue_failed",
            hint:
              enq.error === "outbox_full"
                ? "Too many pending writes—open Obsidian to drain the queue"
                : undefined,
          },
          true,
        );
      }
      return jsonTool({
        status: enq.status,
        outbox_id: enq.id,
        title: v.payload.title,
        parent_title: v.payload.parent_title,
        relation: v.payload.relation,
        parent_pending: Boolean(parentPending),
        duplicate: Boolean(enq.duplicate),
        hint: parentPending
          ? `${PENDING_HINT} Parent is still pending—both land when Obsidian applies the outbox (parent first if ordered).`
          : PENDING_HINT,
      });
    },
  );

  mcp.registerTool(
    "cancel_pending",
    {
      title: "Cancel pending write",
      annotations: { readOnlyHint: false, destructiveHint: true },
      description:
        "Cancel a pending or claimed outbox write before Obsidian applies it. Cannot undo applied atoms. Use list_pending if you lost the outbox_id.",
      inputSchema: {
        outbox_id: z.string().describe("outbox_id from create_atom/continue_atom/list_pending"),
      },
    },
    async ({ outbox_id }) => {
      const denied = requireWrite();
      if (denied) return denied;
      const rl = writeRateOk();
      if (!rl.ok) {
        return jsonTool(
          { error: "rate_limited", retryAfterSec: rl.retryAfterSec },
          true,
        );
      }
      const r = await store.outboxCancel(email, outbox_id);
      if (!r.ok) {
        return jsonTool(
          {
            error: r.error || "cancel_failed",
            status: r.status,
            outbox_id,
          },
          true,
        );
      }
      return jsonTool({
        status: "cancelled",
        outbox_id: r.id,
        previous_status: "pending_or_claimed",
      });
    },
  );

  mcp.registerTool(
    "list_pending",
    {
      title: "List pending writes",
      annotations: { readOnlyHint: true, destructiveHint: false },
      description:
        "List this account's non-terminal outbox writes (status pending or claimed). Use outbox_id with cancel_pending. Requires atoms:write. Does not include applied/cancelled/rejected rows.",
      inputSchema: {},
    },
    async () => {
      const denied = requireWrite();
      if (denied) return denied;
      const rl = writeRateOk();
      if (!rl.ok) {
        return jsonTool(
          { error: "rate_limited", retryAfterSec: rl.retryAfterSec },
          true,
        );
      }
      const rows = (await store.outboxListOpen(email)) || [];
      const pending = rows.map((r) => ({
        outbox_id: r.id,
        kind:
          r.kind === "continue" || r.kind === "continue_atom"
            ? "continue_atom"
            : "create_atom",
        status: r.status,
        title: r.payload?.title ?? null,
        created_at: r.created_at ?? null,
        client_request_id: r.client_request_id ?? null,
      }));
      return jsonTool({
        account: email,
        pending,
        count: pending.length,
      });
    },
  );

  mcp.registerTool(
    "list_atoms",
    {
      title: "List atoms",
      annotations: { readOnlyHint: true, destructiveHint: false },
      description:
        "List mirrored atoms (title, path, tags, created, synced_at) with offset pagination. Default order is title ASC (unchanged). For newest-by-note-date use sort_by=created order=desc. Optional created_after/before (ISO or YYYY-MM-DD) and tags (all must match). Missing created sorts last on created sort.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional(),
        offset: z.number().int().min(0).optional(),
        sort_by: z.enum(["title", "created", "synced"]).optional(),
        order: z.enum(["asc", "desc"]).optional(),
        created_after: z
          .string()
          .optional()
          .describe("Inclusive lower bound on created (ISO or YYYY-MM-DD)"),
        created_before: z
          .string()
          .optional()
          .describe("Inclusive upper bound on created (ISO or YYYY-MM-DD)"),
        tags: z
          .array(z.string())
          .optional()
          .describe("All tags must match (same as search_atoms)"),
      },
    },
    async ({
      limit,
      offset,
      sort_by,
      order,
      created_after,
      created_before,
      tags,
    }) => {
      const rl = listAtomsRateOk();
      if (!rl.ok) {
        return jsonTool(
          { error: "rate_limited", retryAfterSec: rl.retryAfterSec },
          true,
        );
      }
      const page = await store.mirrorList(email, {
        limit: limit ?? 25,
        offset: offset ?? 0,
        sort_by,
        order,
        created_after,
        created_before,
        tags,
      });
      const st = await store.mirrorStatus(email);
      const cov = page.created_coverage;
      const lowCoverage =
        cov &&
        cov.total > 0 &&
        sort_by === "created" &&
        cov.with_created / cov.total < 0.5;
      return jsonTool({
        ...page,
        account: email,
        server_count: st?.count ?? page.total,
        last_synced_at: formatLastSynced(st?.updatedAt),
        ...absenceMeta({ searched_fields: ["title", "path", "tags", "created"] }),
        hint:
          page.next_offset != null
            ? `More results: call list_atoms with offset=${page.next_offset}`
            : page.total === 0
              ? EMPTY_HINT
              : lowCoverage
                ? "created_coverage is partial—many rows lack created until vault Sync now / re-push; do not claim global newest from this page alone"
                : undefined,
      });
    },
  );
}
