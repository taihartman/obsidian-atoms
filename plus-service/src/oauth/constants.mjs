/** Claude hosted connector callback (exact). */
export const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";

/** ChatGPT legacy connector redirect (exact). */
export const CHATGPT_LEGACY_CALLBACK =
  "https://chatgpt.com/connector_platform_oauth_redirect";

/** Allowed loopback path for Claude Code (port varies). */
export const LOOPBACK_PATH = "/callback";

/** Single path segment under /connector/oauth/{id} */
const CHATGPT_CALLBACK_ID = /^[A-Za-z0-9_-]+$/;

export const COOKIE_NAME = "atoms_oauth_bs";
export const SCOPE_DEFAULT = "atoms:read";

/**
 * @param {string} uri
 * @returns {boolean}
 */
export function isAllowedRedirectUri(uri) {
  if (!uri || typeof uri !== "string") return false;
  if (uri === CLAUDE_CALLBACK) return true;
  if (uri === CHATGPT_LEGACY_CALLBACK) return true;
  try {
    const u = new URL(uri);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    // Reject userinfo / credentials in authority
    if (u.username || u.password) return false;
    const host = u.hostname;
    const loopback =
      host === "127.0.0.1" || host === "localhost" || host === "[::1]";
    if (loopback) {
      return u.pathname === LOOPBACK_PATH || u.pathname === "/callback/";
    }
    // ChatGPT production: https://chatgpt.com/connector/oauth/{callback_id}
    if (u.protocol === "https:" && host === "chatgpt.com") {
      const parts = u.pathname.split("/").filter(Boolean);
      if (
        parts.length === 3 &&
        parts[0] === "connector" &&
        parts[1] === "oauth" &&
        CHATGPT_CALLBACK_ID.test(parts[2])
      ) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Label for OAuth consent from client_id / redirect host.
 * @param {string} clientId
 * @param {string} [redirectUri]
 */
export function oauthClientLabel(clientId, redirectUri = "") {
  const id = String(clientId || "");
  const redir = String(redirectUri || "");
  if (
    id.includes("chatgpt.com") ||
    redir.includes("chatgpt.com") ||
    id.toLowerCase().includes("openai")
  ) {
    return "ChatGPT";
  }
  if (id.includes("claude.ai") || redir.includes("claude.ai")) {
    return "Claude";
  }
  if (id.startsWith("http")) return "AI app";
  return id || "AI app";
}

/**
 * @param {string} publicBaseUrl
 */
export function mcpResourceUrl(publicBaseUrl) {
  return `${String(publicBaseUrl || "").replace(/\/$/, "")}/mcp`;
}

/**
 * @param {string} publicBaseUrl
 */
export function issuerUrl(publicBaseUrl) {
  return String(publicBaseUrl || "").replace(/\/$/, "");
}
