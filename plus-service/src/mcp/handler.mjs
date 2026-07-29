/**
 * Streamable HTTP /mcp — dual-era (legacy + 2026-07-28) via createMcpHandler.
 */
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { ASK_MCP_INSTRUCTIONS } from "./instructions.mjs";
import { registerAskTools } from "./tools.mjs";

const PRM_PATH = "/.well-known/oauth-protected-resource";

const CACHE_HINTS = {
  "tools/list": { ttlMs: 300_000, cacheScope: "public" },
  "server/discover": { ttlMs: 300_000, cacheScope: "public" },
};

/** @type {import('@modelcontextprotocol/server').McpHttpHandler | null} */
let mcpHttp = null;
/** @type {ReturnType<typeof toNodeHandler> | null} */
let nodeHandler = null;
/** @type {object | null} */
let boundStore = null;

/**
 * @param {object} store
 */
function ensureHandlers(store) {
  if (mcpHttp && boundStore === store && nodeHandler) return;
  boundStore = store;
  mcpHttp = createMcpHandler(
    (ctx) => {
      const email =
        ctx.authInfo?.extra && typeof ctx.authInfo.extra.email === "string"
          ? ctx.authInfo.extra.email
          : "";
      const mcp = new McpServer(
        { name: "atoms-ask", version: "0.2.0" },
        {
          instructions: ASK_MCP_INSTRUCTIONS,
          cacheHints: CACHE_HINTS,
        },
      );
      if (!email) {
        return mcp;
      }
      registerAskTools(mcp, { email, store });
      injectToolSecuritySchemes(mcp);
      return mcp;
    },
    {
      legacy: "stateless",
      responseMode: "json",
    },
  );
  nodeHandler = toNodeHandler(mcpHttp);
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ store: object, publicBaseUrl: string, readRawBody: Function }} opts
 */
export async function handleMcpRequest(req, res, opts) {
  const { store, publicBaseUrl, readRawBody } = opts;
  const resource = `${publicBaseUrl.replace(/\/$/, "")}/mcp`;

  if (req.method === "GET" || req.method === "DELETE") {
    res.writeHead(405, {
      allow: "POST, OPTIONS",
      "content-type": "application/json",
      "cache-control": "private, no-store",
    });
    res.end(JSON.stringify({ message: "Method not allowed" }));
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, {
      "content-type": "application/json",
      "cache-control": "private, no-store",
    });
    res.end(JSON.stringify({ message: "Method not allowed" }));
    return;
  }

  const auth = req.headers.authorization || "";
  const m = /^Bearer\s+(\S+)/i.exec(auth);
  const token = m ? m[1] : "";

  if (!token || token.startsWith("sess_")) {
    const prm = `${publicBaseUrl.replace(/\/$/, "")}${PRM_PATH}`;
    res.writeHead(401, {
      "content-type": "application/json",
      "www-authenticate": `Bearer resource_metadata="${prm}", scope="atoms:read"`,
      "access-control-allow-origin": "*",
      "cache-control": "private, no-store",
    });
    res.end(JSON.stringify({ message: "Unauthorized" }));
    return;
  }

  const account = await store.accountFromMcpToken(token);
  if (!account) {
    const prm = `${publicBaseUrl.replace(/\/$/, "")}${PRM_PATH}`;
    res.writeHead(401, {
      "content-type": "application/json",
      "www-authenticate": `Bearer resource_metadata="${prm}", scope="atoms:read"`,
      "access-control-allow-origin": "*",
      "cache-control": "private, no-store",
    });
    res.end(JSON.stringify({ message: "Unauthorized" }));
    return;
  }

  let parsedBody;
  try {
    const raw = await readRawBody(req);
    parsedBody = raw ? JSON.parse(raw) : {};
  } catch {
    res.writeHead(400, {
      "content-type": "application/json",
      "cache-control": "private, no-store",
    });
    res.end(JSON.stringify({ message: "invalid json" }));
    return;
  }

  ensureHandlers(store);

  /** @type {import('@modelcontextprotocol/server').AuthInfo} */
  const authInfo = {
    token,
    clientId: "atoms-mcp",
    scopes: ["atoms:read"],
    resource: new URL(resource),
    extra: { email: account.email },
  };

  // toNodeHandler forwards req.auth as authInfo
  /** @type {any} */
  const reqAny = req;
  reqAny.auth = authInfo;

  res.setHeader("cache-control", "private, no-store");
  await nodeHandler(req, res, parsedBody);
}

const OAUTH2_SCHEMES = [{ type: "oauth2", scopes: ["atoms:read"] }];

/**
 * ChatGPT OAuth UI: securitySchemes on tools/list.
 * @param {import('@modelcontextprotocol/server').McpServer} mcp
 */
function injectToolSecuritySchemes(mcp) {
  const server = mcp.server;
  if (!server) return;
  const handlers = server._requestHandlers;
  if (!handlers || typeof handlers.get !== "function") {
    // Fallback: annotate tools via list wrap if private map missing
    return;
  }
  const method = "tools/list";
  const prev = handlers.get(method);
  if (!prev) return;
  handlers.set(method, async (request, extra) => {
    const result = await prev(request, extra);
    if (result && Array.isArray(result.tools)) {
      result.tools = result.tools.map((t) => ({
        ...t,
        securitySchemes: OAUTH2_SCHEMES,
        _meta: {
          ...(t._meta && typeof t._meta === "object" ? t._meta : {}),
          securitySchemes: OAUTH2_SCHEMES,
        },
      }));
    }
    return result;
  });
}
