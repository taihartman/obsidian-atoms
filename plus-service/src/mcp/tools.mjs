/**
 * Register read-only Ask tools on an McpServer.
 */
import { z } from "zod";

const EMPTY_HINT =
  "mirror empty—sync from Obsidian (Settings → Atoms Plus → Ask → Sync now)";

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
        "Search the user's mirrored atoms by title, tags, and body. Returns snippets for citation.",
      inputSchema: {
        query: z.string().describe("Search query"),
        limit: z.number().int().min(1).max(25).optional(),
      },
    },
    async ({ query, limit }) => {
      const hits = await store.mirrorSearch(email, query, limit ?? 8);
      if (!hits.length) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                results: [],
                hint: EMPTY_HINT,
              }),
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ results: hits }, null, 2),
          },
        ],
      };
    },
  );

  mcp.registerTool(
    "fetch_atom",
    {
      description:
        "Fetch one atom by title or path. Returns verbatim body, tags, and link reasons.",
      inputSchema: {
        id_or_title: z
          .string()
          .describe("Atom title, path (Atoms/….md), or id"),
      },
    },
    async ({ id_or_title }) => {
      const atom = await store.mirrorFetch(email, id_or_title);
      if (!atom) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "not_found",
                id_or_title,
                hint: EMPTY_HINT,
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
}
