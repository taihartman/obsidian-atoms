/** Claude hosted connector callback (exact). */
export const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";

/** Allowed loopback path for Claude Code (port varies). */
export const LOOPBACK_PATH = "/callback";

export const COOKIE_NAME = "atoms_oauth_bs";
export const SCOPE_DEFAULT = "atoms:read";

/**
 * @param {string} uri
 * @returns {boolean}
 */
export function isAllowedRedirectUri(uri) {
  if (!uri || typeof uri !== "string") return false;
  if (uri === CLAUDE_CALLBACK) return true;
  try {
    const u = new URL(uri);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname;
    const loopback =
      host === "127.0.0.1" || host === "localhost" || host === "[::1]";
    if (loopback) {
      // Port-agnostic loopback with fixed path only
      return u.pathname === LOOPBACK_PATH || u.pathname === "/callback/";
    }
    return false;
  } catch {
    return false;
  }
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
