/**
 * Register read-only Ask tools on an McpServer.
 */
import { z } from "zod";

const EMPTY_HINT =
  "mirror empty—sync from Obsidian (Settings → Atoms → Ask → Sync now)";
const MISSING_HINT =
  "no atom with that title/path in the mirror (hub notes outside Atoms/ are not synced; use neighbors to find atoms that link to this name)";

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} mcp
 * @param {{ email: string, store: object }} ctx
 */
export function registerAskTools(mcp, ctx) {
  const { email, store } = ctx;

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
}
