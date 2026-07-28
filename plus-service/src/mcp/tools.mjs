/**
 * Register Ask tools on an McpServer (read + write-via-outbox).
 */
import { z } from "zod";
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
  "no note with that title/path in the mirror (not the whole vault—see mirror_scope)";
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

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} mcp
 * @param {{ email: string, store: object }} ctx
 */
export function registerAskTools(mcp, ctx) {
  const { email, store } = ctx;

  function writeRateOk() {
    return checkRateLimit(`ask-write:${email}`, 30);
  }

  mcp.registerTool(
    "search_atoms",
    {
      description:
        "Search mirrored atoms by title, tags, and body. Higher score = better match. Optional tags filter (all must match). Snippets are truncated and non-authoritative—use fetch_atom before claiming what a note contains. Results include status (live|superseded|contradicted).",
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
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                results: [],
                mirror_count: st.count,
                ...scope,
                hint: st.count === 0 ? EMPTY_HINT : "no matches for this query in mirror_scope",
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
        const hubNotSynced = Boolean(graph?.exists_outside_mirror);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "not_found",
                id_or_title,
                mirror_count: st.count,
                exists_outside_mirror: hubNotSynced,
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
      description:
        "Cancel a pending or claimed outbox write before Obsidian applies it. Cannot undo applied atoms.",
      inputSchema: {
        outbox_id: z.string().describe("outbox_id from create_atom/continue_atom"),
      },
    },
    async ({ outbox_id }) => {
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
    "list_atoms",
    {
      description:
        "List mirrored atoms (title, path, tags, synced_at) with offset pagination. Includes server_count and last_synced_at for staleness. Use to enumerate the full mirror beyond search_atoms limit 25.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async ({ limit, offset }) => {
      const page = await store.mirrorList(email, {
        limit: limit ?? 25,
        offset: offset ?? 0,
      });
      const st = await store.mirrorStatus(email);
      let lastSynced = null;
      if (st?.updatedAt != null) {
        lastSynced =
          st.updatedAt instanceof Date
            ? st.updatedAt.toISOString()
            : String(st.updatedAt);
        // Normalize non-ISO sqlite/pg strings when parseable
        const t = Date.parse(lastSynced);
        if (Number.isFinite(t)) lastSynced = new Date(t).toISOString();
      }
      return jsonTool({
        ...page,
        server_count: st?.count ?? page.total,
        last_synced_at: lastSynced,
        ...absenceMeta({ searched_fields: ["title", "path", "tags"] }),
        hint:
          page.next_offset != null
            ? `More results: call list_atoms with offset=${page.next_offset}`
            : page.total === 0
              ? EMPTY_HINT
              : undefined,
      });
    },
  );
}
