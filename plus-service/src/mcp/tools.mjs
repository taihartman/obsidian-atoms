/**
 * Register Ask tools on an McpServer (read + write-via-outbox).
 */
import { z } from "zod";
import { checkRateLimit } from "../ratelimit.mjs";
import {
  validateOutboxPayload,
  OUTBOX_RELATIONS,
} from "../store/askHelpers.mjs";

const EMPTY_HINT =
  "mirror empty—sync from Obsidian (Settings → Atoms → Ask → Sync now)";
const MISSING_HINT =
  "no atom with that title/path in the mirror (hub notes outside Atoms/ are not synced; use neighbors to find atoms that link to this name)";
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
        "Search mirrored atoms by title, tags, and body. Higher score = better match. Optional tags filter (all must match).",
      inputSchema: {
        query: z.string().describe("Search query"),
        limit: z.number().int().min(1).max(25).optional(),
        tags: z
          .array(z.string())
          .optional()
          .describe("Only atoms that have all of these tags"),
      },
    },
    async ({ query, limit, tags }) => {
      const st = await store.mirrorStatus(email);
      const hits = await store.mirrorSearch(email, query, limit ?? 8, {
        tags,
      });
      if (!hits.length) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                results: [],
                mirror_count: st.count,
                hint: st.count === 0 ? EMPTY_HINT : "no matches for this query",
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
        "Fetch one atom by title or path. Returns verbatim body, tags, and links (wikilinks from body). Notes outside Atoms/ are not in the mirror.",
      inputSchema: {
        id_or_title: z
          .string()
          .describe("Atom title, path (Atoms/….md), or id"),
      },
    },
    async ({ id_or_title }) => {
      const atom = await store.mirrorFetch(email, id_or_title);
      if (!atom) {
        const st = await store.mirrorStatus(email);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "not_found",
                id_or_title,
                mirror_count: st.count,
                hint: st.count === 0 ? EMPTY_HINT : MISSING_HINT,
              }),
            },
          ],
          isError: true,
        };
      }
      let text = atom.text || "";
      const softCap = 100_000;
      if (text.length > softCap) {
        text = text.slice(0, softCap) + "\n…[truncated]";
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                id: atom.id,
                title: atom.title,
                path: atom.path,
                text,
                tags: atom.tags,
                links: atom.links,
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
    "neighbors",
    {
      description:
        "Graph around a title: outgoing [[links]] from that atom (if mirrored) plus backlinks (other mirrored atoms that link to this name). Works even when the hub note is not in Atoms/ — backlinks still list atoms that mention [[Name]].",
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
      if (!parent) {
        const st = await store.mirrorStatus(email);
        return jsonTool(
          {
            error: "parent_not_found",
            parent_title: parentTitle,
            mirror_count: st.count,
            hint:
              "Parent must be in the Ask mirror—fetch_atom or search first; user may need Settings → Ask → Sync now after Process.",
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
        parent_title: parent.title || parentTitle,
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
        duplicate: Boolean(enq.duplicate),
        hint: PENDING_HINT,
      });
    },
  );
}
