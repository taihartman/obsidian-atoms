/** Claude hosted connector callback (exact). */
export const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";

/** ChatGPT legacy connector redirect (exact). */
export const CHATGPT_LEGACY_CALLBACK =
  "https://chatgpt.com/connector_platform_oauth_redirect";

/** Allowed loopback path for Claude Code (port varies). */
export const LOOPBACK_PATH = "/callback";

/** Single path segment under /connector/oauth/{id} */
const CHATGPT_CALLBACK_ID = /^[A-Za-z0-9_-]+$/;

/**
 * @param {string} uri
 * @returns {boolean}
 */
function isCanonicalChatGptCallback(uri) {
  const prefix = "https://chatgpt.com/connector/oauth/";
  return (
    uri.startsWith(prefix) &&
    CHATGPT_CALLBACK_ID.test(uri.slice(prefix.length))
  );
}

export const COOKIE_NAME = "atoms_oauth_bs";
/** Read tools: search, fetch, neighbors, list */
export const SCOPE_READ = "atoms:read";
/** Write tools: create_atom, continue_atom, cancel_pending, list_pending (outbox queue) */
export const SCOPE_WRITE = "atoms:write";
/** @deprecated use SCOPE_READ — kept for call sites */
export const SCOPE_DEFAULT = SCOPE_READ;
/** Full Ask grant on consent Allow (directory + custom connector honesty) */
export const SCOPES_ASK_FULL = [SCOPE_READ, SCOPE_WRITE];

/**
 * Normalize OAuth scope query into recognized Ask scopes.
 * Empty / unknown → full Ask (read + write) so connectors that omit scope still get write tools.
 * @param {string} [scopeParam]
 * @returns {string[]}
 */
export function parseRequestedScopes(scopeParam) {
  const parts = String(scopeParam || "")
    .split(/[\s+]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = new Set();
  for (const p of parts) {
    if (p === SCOPE_READ || p === SCOPE_WRITE) out.add(p);
  }
  if (out.size === 0) return [...SCOPES_ASK_FULL];
  if (out.has(SCOPE_WRITE)) out.add(SCOPE_READ);
  return [...out];
}

/**
 * Scopes minted after user clicks Allow on consent.
 * Always full Ask grant so listing/write tools match consent copy (KTD15).
 * @param {string[]} [_requested]
 */
export function scopesOnConsentAllow(_requested) {
  return [...SCOPES_ASK_FULL];
}

/**
 * @param {string[]|undefined|null} scopes
 */
export function hasWriteScope(scopes) {
  return Array.isArray(scopes) && scopes.includes(SCOPE_WRITE);
}

/**
 * @param {string} uri
 * @returns {boolean}
 */
export function isAllowedRedirectUri(uri) {
  if (!uri || typeof uri !== "string") return false;
  if (uri === CLAUDE_CALLBACK) return true;
  if (uri === CHATGPT_LEGACY_CALLBACK) return true;
  if (isCanonicalChatGptCallback(uri)) return true;
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
    return false;
  } catch {
    return false;
  }
}

/**
 * Trusted label for OAuth consent. Client IDs are attacker-controlled, so only
 * an already-allowlisted hosted redirect URI may identify the AI provider.
 * @param {string} _clientId
 * @param {string} [redirectUri]
 */
export function oauthClientLabel(_clientId, redirectUri = "") {
  const redir = String(redirectUri || "");
  if (redir === CLAUDE_CALLBACK) return "Claude";
  if (redir === CHATGPT_LEGACY_CALLBACK) return "ChatGPT";
  if (isCanonicalChatGptCallback(redir)) return "ChatGPT";
  if (!isAllowedRedirectUri(redir)) return "AI app";
  return "AI app";
}

/**
 * User-facing OAuth client name. Keep every page and message on this helper so
 * unknown, opaque, and loopback clients cannot display a provider identity.
 * @param {string} clientId
 * @param {string} [redirectUri]
 */
export function oauthClientDisplayName(clientId, redirectUri = "") {
  const label = oauthClientLabel(clientId, redirectUri);
  return label === "ChatGPT" || label === "Claude" ? label : "your AI app";
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
