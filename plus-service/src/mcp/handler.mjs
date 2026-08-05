/**
 * Streamable HTTP /mcp — dual-era:
 * - Legacy (initialize / no modern envelope): WebStandardStreamableHTTP +
 *   enableJsonResponse, Accept widened so Claude's application/json-only works.
 * - Modern 2026-07-28: createMcpHandler(legacy: 'reject', responseMode: 'json').
 */
import {
  createMcpHandler,
  isLegacyRequest,
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import { toNodeHandler, toWebRequest } from "@modelcontextprotocol/node";
import { SCOPE_READ, SCOPE_WRITE } from "../oauth/constants.mjs";
import { ASK_MCP_INSTRUCTIONS } from "./instructions.mjs";
import { registerAskTools } from "./tools.mjs";

const PRM_PATH = "/.well-known/oauth-protected-resource";

const CACHE_HINTS = {
  "tools/list": { ttlMs: 300_000, cacheScope: "public" },
  "server/discover": { ttlMs: 300_000, cacheScope: "public" },
};

/** @type {import('@modelcontextprotocol/server').McpHttpHandler | null} */
let modernHttp = null;
/** @type {ReturnType<typeof toNodeHandler> | null} */
let modernNode = null;
/** @type {object | null} */
let boundStore = null;

/**
 * @param {object} store
 * @param {string} email
 * @param {string[]} scopes
 */
function buildServer(store, email, scopes = [SCOPE_READ]) {
  const mcp = new McpServer(
    { name: "atoms-ask", version: "0.2.0" },
    {
      instructions: ASK_MCP_INSTRUCTIONS,
      cacheHints: CACHE_HINTS,
    },
  );
  if (email) {
    registerAskTools(mcp, { email, store, scopes });
    injectToolSecuritySchemes(mcp);
  }
  return mcp;
}

/**
 * @param {object} store
 */
function ensureModern(store) {
  if (modernHttp && boundStore === store && modernNode) return;
  boundStore = store;
  modernHttp = createMcpHandler(
    (ctx) => {
      const email =
        ctx.authInfo?.extra && typeof ctx.authInfo.extra.email === "string"
          ? ctx.authInfo.extra.email
          : "";
      const scopes = Array.isArray(ctx.authInfo?.scopes)
        ? ctx.authInfo.scopes
        : [SCOPE_READ];
      return buildServer(store, email, scopes);
    },
    {
      legacy: "reject",
      responseMode: "json",
    },
  );
  modernNode = toNodeHandler(modernHttp);
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
    writeUnauthorized(res, publicBaseUrl);
    return;
  }

  const account = await store.accountFromMcpToken(token);
  if (!account) {
    writeUnauthorized(res, publicBaseUrl);
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

  const scopes = Array.isArray(account.mcpScopes)
    ? account.mcpScopes
    : [SCOPE_READ];

  /** @type {import('@modelcontextprotocol/server').AuthInfo} */
  const authInfo = {
    token,
    clientId: "atoms-mcp",
    scopes,
    resource: new URL(resource),
    extra: { email: account.email, scopes },
  };

  /** @type {any} */
  const reqAny = req;
  reqAny.auth = authInfo;

  res.setHeader("cache-control", "private, no-store");

  const webReq = await toWebRequest(req, parsedBody);
  const legacy = await isLegacyRequest(webReq, parsedBody);

  if (legacy) {
    await handleLegacyJson(
      req,
      res,
      parsedBody,
      store,
      account.email,
      authInfo,
      scopes,
    );
    return;
  }

  ensureModern(store);
  await modernNode(req, res, parsedBody);
}

/**
 * Legacy Claude/ChatGPT path: pure JSON even when Accept is application/json only.
 * Node adapter's getRequestListener ignores Accept mutations — use Web Standard
 * transport with an explicit Request that includes text/event-stream.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {unknown} parsedBody
 * @param {object} store
 * @param {string} email
 * @param {import('@modelcontextprotocol/server').AuthInfo} authInfo
 * @param {string[]} scopes
 */
async function handleLegacyJson(
  req,
  res,
  parsedBody,
  store,
  email,
  authInfo,
  scopes,
) {
  const mcp = buildServer(store, email, scopes);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await mcp.connect(transport);

  const host = req.headers.host || "localhost";
  const url = `http://${host}${req.url || "/mcp"}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null || k === "host") continue;
    if (Array.isArray(v)) {
      for (const item of v) headers.append(k, item);
    } else {
      headers.set(k, v);
    }
  }
  // SDK requires both media types in Accept even when enableJsonResponse is true.
  const accept = headers.get("accept") || "";
  if (!accept.includes("text/event-stream")) {
    headers.set(
      "accept",
      accept
        ? `${accept}, application/json, text/event-stream`
        : "application/json, text/event-stream",
    );
  }
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const webReq = new Request(url, {
    method: "POST",
    headers,
    // body unused when parsedBody is provided
  });

  const webRes = await transport.handleRequest(webReq, {
    authInfo,
    parsedBody,
  });
  await writeWebResponse(res, webRes);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {Response} webRes
 */
async function writeWebResponse(res, webRes) {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => {
    // skip hop-by-hop / content-length (set by end)
    if (key.toLowerCase() === "transfer-encoding") return;
    res.setHeader(key, value);
  });
  if (!res.getHeader("cache-control")) {
    res.setHeader("cache-control", "private, no-store");
  }
  const buf = Buffer.from(await webRes.arrayBuffer());
  res.end(buf);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {string} publicBaseUrl
 */
function writeUnauthorized(res, publicBaseUrl) {
  const prm = `${publicBaseUrl.replace(/\/$/, "")}${PRM_PATH}`;
  res.writeHead(401, {
    "content-type": "application/json",
    "www-authenticate": `Bearer resource_metadata="${prm}", scope="atoms:read atoms:write"`,
    "access-control-allow-origin": "*",
    "cache-control": "private, no-store",
  });
  res.end(JSON.stringify({ message: "Unauthorized" }));
}

const WRITE_TOOL_NAMES = new Set([
  "create_atom",
  "continue_atom",
  "cancel_pending",
  "list_pending",
]);

/**
 * ChatGPT / directory: per-tool OAuth schemes (read vs write).
 * @param {import('@modelcontextprotocol/server').McpServer} mcp
 */
function injectToolSecuritySchemes(mcp) {
  const server = mcp.server;
  if (!server) return;
  const handlers = server._requestHandlers;
  if (!handlers || typeof handlers.get !== "function") return;
  const method = "tools/list";
  const prev = handlers.get(method);
  if (!prev) return;
  handlers.set(method, async (request, extra) => {
    const result = await prev(request, extra);
    if (result && Array.isArray(result.tools)) {
      result.tools = result.tools.map((t) => {
        const scopes = WRITE_TOOL_NAMES.has(t.name)
          ? [SCOPE_WRITE]
          : [SCOPE_READ];
        const schemes = [{ type: "oauth2", scopes }];
        return {
          ...t,
          securitySchemes: schemes,
          _meta: {
            ...(t._meta && typeof t._meta === "object" ? t._meta : {}),
            securitySchemes: schemes,
          },
        };
      });
    }
    return result;
  });
}
