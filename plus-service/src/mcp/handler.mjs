/**
 * Streamable HTTP /mcp — KTD20 per-request SDK transport.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ASK_MCP_INSTRUCTIONS } from "./instructions.mjs";
import { registerAskTools } from "./tools.mjs";

const PRM_PATH = "/.well-known/oauth-protected-resource";

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
    });
    res.end(JSON.stringify({ message: "Method not allowed" }));
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "application/json" });
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
    });
    res.end(JSON.stringify({ message: "Unauthorized" }));
    return;
  }

  let parsedBody;
  try {
    const raw = await readRawBody(req);
    parsedBody = raw ? JSON.parse(raw) : {};
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "invalid json" }));
    return;
  }

  const mcp = new McpServer(
    { name: "atoms-ask", version: "0.1.0" },
    { instructions: ASK_MCP_INSTRUCTIONS },
  );
  registerAskTools(mcp, { email: account.email, store });
  // ChatGPT OAuth UI: top-level securitySchemes on tools/list (OpenAI plugin auth).
  // Stock MCP SDK only serializes _meta; wrap list handler to inject schemes.
  injectToolSecuritySchemes(mcp);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await mcp.connect(transport);
  await transport.handleRequest(req, res, parsedBody);
}

const OAUTH2_SCHEMES = [{ type: "oauth2", scopes: ["atoms:read"] }];

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} mcp
 */
function injectToolSecuritySchemes(mcp) {
  const server = mcp.server;
  const handlers = server._requestHandlers;
  if (!handlers || typeof handlers.get !== "function") return;
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
