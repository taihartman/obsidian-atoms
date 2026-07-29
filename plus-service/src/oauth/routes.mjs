/**
 * OAuth AS routes for Claude custom connectors (KTD5–KTD9, KTD8b/c, KTD17).
 */
import { config } from "../config.mjs";
import { sendMagicLinkEmail } from "../email.mjs";
import { checkRateLimit, clientIp } from "../ratelimit.mjs";
import {
  isAllowedRedirectUri,
  issuerUrl,
  oauthClientLabel,
  mcpResourceUrl,
  SCOPE_DEFAULT,
} from "./constants.mjs";
import {
  getBrowserSessionId,
  setBrowserSessionCookie,
} from "./cookies.mjs";
import {
  authorizeEmailForm,
  consentForm,
  simpleMessage,
} from "./html.mjs";
import {
  authorizationServerMetadata,
  protectedResourceMetadata,
} from "./metadata.mjs";

/**
 * RFC 9207: append iss on every 302 back to the client redirect_uri.
 * @param {URL} u
 */
function appendIss(u) {
  u.searchParams.set("iss", issuerUrl(config.publicBaseUrl));
  return u;
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {string} redirectUri
 * @param {Record<string, string>} params
 */
function redirectToClient(res, redirectUri, params) {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") u.searchParams.set(k, v);
  }
  appendIss(u);
  res.writeHead(302, { location: u.toString() });
  res.end();
}

function writeHtml(res, status, html) {
  const data = html;
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}

function writeJson(res, status, body, extraHeaders = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    ...extraHeaders,
  });
  res.end(data);
}

function parseForm(raw) {
  const params = new URLSearchParams(raw || "");
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of params) out[k] = v;
  return out;
}

/**
 * @returns {Promise<boolean>} true if handled
 */
export async function handleOauthRoutes({
  req,
  res,
  path,
  url,
  store,
  readRawBody,
  readBody,
}) {
  const base = config.publicBaseUrl;

  // --- discovery ---
  if (
    req.method === "GET" &&
    (path === "/.well-known/oauth-protected-resource" ||
      path === "/.well-known/oauth-protected-resource/mcp")
  ) {
    writeJson(res, 200, protectedResourceMetadata(base));
    return true;
  }

  if (
    req.method === "GET" &&
    (path === "/.well-known/oauth-authorization-server" ||
      path === "/.well-known/openid-configuration")
  ) {
    writeJson(res, 200, authorizationServerMetadata(base));
    return true;
  }

  // --- DCR ---
  if (req.method === "POST" && path === "/oauth/register") {
    const rl = checkRateLimit(`oauth-reg:${clientIp(req)}`);
    if (!rl.ok) {
      writeJson(res, 429, { error: "temporarily_unavailable" });
      return true;
    }
    let body;
    try {
      body = await readBody(req);
    } catch {
      writeJson(res, 400, { error: "invalid_client_metadata" });
      return true;
    }
    const redirects = Array.isArray(body.redirect_uris)
      ? body.redirect_uris.map(String)
      : [];
    if (!redirects.length || !redirects.every(isAllowedRedirectUri)) {
      writeJson(res, 400, { error: "invalid_redirect_uri" });
      return true;
    }
    // application_type (native|web) accepted and ignored — never widens redirects.
    void body.application_type;
    const reg = await store.mcpRegisterClient({
      redirect_uris: redirects,
      client_name: body.client_name,
      token_endpoint_auth_method: "none",
    });
    writeJson(res, 201, reg);
    return true;
  }

  // --- authorize GET ---
  if (req.method === "GET" && path === "/oauth/authorize") {
    const rl = checkRateLimit(`oauth-auth:${clientIp(req)}`);
    if (!rl.ok) {
      writeHtml(res, 429, simpleMessage("Slow down", "Too many requests."));
      return true;
    }
    const clientId = url.searchParams.get("client_id") || "";
    const redirectUri = url.searchParams.get("redirect_uri") || "";
    const responseType = url.searchParams.get("response_type") || "";
    const state = url.searchParams.get("state") || "";
    const codeChallenge = url.searchParams.get("code_challenge") || "";
    const codeChallengeMethod =
      url.searchParams.get("code_challenge_method") || "S256";
    const resource =
      url.searchParams.get("resource") || mcpResourceUrl(base);
    const scope = url.searchParams.get("scope") || SCOPE_DEFAULT;

    if (responseType !== "code") {
      writeHtml(res, 400, simpleMessage("Error", "response_type must be code"));
      return true;
    }
    if (!clientId || !redirectUri || !state || !codeChallenge) {
      writeHtml(
        res,
        400,
        simpleMessage("Error", "Missing OAuth parameters"),
      );
      return true;
    }
    if (codeChallengeMethod !== "S256") {
      writeHtml(res, 400, simpleMessage("Error", "PKCE S256 required"));
      return true;
    }
    if (!isAllowedRedirectUri(redirectUri)) {
      writeHtml(res, 400, simpleMessage("Error", "redirect_uri not allowed"));
      return true;
    }
    const expectedResource = mcpResourceUrl(base);
    if (resource !== expectedResource) {
      writeHtml(
        res,
        400,
        simpleMessage("Error", `resource must be ${expectedResource}`),
      );
      return true;
    }

    // Ensure client exists (DCR or pre-register on the fly for allowlisted redirects)
    let client = await store.mcpGetClient(clientId);
    if (!client) {
      // CIMD / dynamic client_id URL or opaque id — register allowlisted redirect
      await store.mcpRegisterClient({
        client_id: clientId,
        redirect_uris: [redirectUri],
        client_name: oauthClientLabel(clientId, redirectUri),
        token_endpoint_auth_method: "none",
      });
      client = await store.mcpGetClient(clientId);
    }

    const pendingId = await store.mcpCreatePending({
      clientId,
      redirectUri,
      state,
      codeChallenge,
      codeChallengeMethod,
      resource,
      scope,
    });

    const bsId = getBrowserSessionId(req);
    const bs = bsId ? await store.mcpGetBrowserSession(bsId) : null;
    if (bs?.email) {
      const a = await store.getAccount(bs.email);
      if (a && (a.status === "active" || a.status === "trialing")) {
        // Attach email to pending and show consent
        await store.mcpUpdatePending(pendingId, { email: bs.email });
        writeHtml(
          res,
          200,
          consentForm(pendingId, bs.email, client?.clientName || clientId),
        );
        return true;
      }
    }

    writeHtml(res, 200, authorizeEmailForm(pendingId));
    return true;
  }

  // --- authorize POST (email) ---
  if (req.method === "POST" && path === "/oauth/authorize") {
    const raw = await readRawBody(req);
    const form = parseForm(raw);
    const pendingId = form.pending_id || "";
    const email = String(form.email || "")
      .trim()
      .toLowerCase();
    const pending = await store.mcpGetPending(pendingId);
    if (!pending) {
      writeHtml(
        res,
        400,
        simpleMessage("Expired", "Start connect again from your AI app."),
      );
      return true;
    }
    if (!email || !email.includes("@")) {
      writeHtml(res, 400, authorizeEmailForm(pendingId, "Valid email required"));
      return true;
    }
    const rl = checkRateLimit(`oauth-ml:${clientIp(req)}:${email}`);
    if (!rl.ok) {
      writeHtml(res, 429, simpleMessage("Slow down", "Too many requests."));
      return true;
    }
    const token = await store.createMagicToken(email);
    const link = `${base}/v1/auth/exchange?token=${encodeURIComponent(token)}&pending=${encodeURIComponent(pendingId)}`;
    const sent = await sendMagicLinkEmail({ to: email, link });
    if (!sent.ok) {
      writeHtml(
        res,
        503,
        simpleMessage("Email failed", sent.message || "Try again later"),
      );
      return true;
    }
    writeHtml(
      res,
      200,
      simpleMessage(
        "Check your email",
        "Open the sign-in link in this same browser, then allow Atoms Ask.",
      ),
    );
    return true;
  }

  // --- consent GET (after magic link) ---
  if (req.method === "GET" && path === "/oauth/consent") {
    const pendingId = url.searchParams.get("pending") || "";
    const pending = await store.mcpGetPending(pendingId);
    if (!pending) {
      writeHtml(
        res,
        400,
        simpleMessage("Expired", "Start connect again from your AI app."),
      );
      return true;
    }
    const bsId = getBrowserSessionId(req);
    const bs = bsId ? await store.mcpGetBrowserSession(bsId) : null;
    const email = pending.email || bs?.email;
    if (!email) {
      writeHtml(res, 200, authorizeEmailForm(pendingId));
      return true;
    }
    const a = await store.getAccount(email);
    if (!a || (a.status !== "active" && a.status !== "trialing")) {
      writeHtml(
        res,
        403,
        simpleMessage(
          "Plus required",
          "Atoms Ask needs an active or trialing Plus account.",
        ),
      );
      return true;
    }
    writeHtml(
      res,
      200,
      consentForm(
        pendingId,
        email,
        oauthClientLabel(pending.clientId || "", pending.redirectUri || ""),
      ),
    );
    return true;
  }

  // --- consent POST ---
  if (req.method === "POST" && path === "/oauth/consent") {
    const raw = await readRawBody(req);
    const form = parseForm(raw);
    const pendingId = form.pending_id || "";
    const decision = form.decision || "";
    const pending = await store.mcpGetPending(pendingId);
    if (!pending) {
      writeHtml(
        res,
        400,
        simpleMessage("Expired", "Start connect again from your AI app."),
      );
      return true;
    }
    const bsId = getBrowserSessionId(req);
    const bs = bsId ? await store.mcpGetBrowserSession(bsId) : null;
    const email = pending.email || bs?.email;
    if (!email || (bs && pending.email && bs.email !== pending.email)) {
      writeHtml(
        res,
        400,
        simpleMessage("Session mismatch", "Restart connect from your AI app."),
      );
      return true;
    }
    if (decision !== "allow") {
      await store.mcpDeletePending(pendingId);
      redirectToClient(res, pending.redirectUri, {
        error: "access_denied",
        state: pending.state || "",
      });
      return true;
    }
    const a = await store.getAccount(email);
    if (!a || (a.status !== "active" && a.status !== "trialing")) {
      writeHtml(res, 403, simpleMessage("Plus required", "Active Plus needed."));
      return true;
    }
    const code = await store.mcpCreateAuthCode({
      email,
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      resource: pending.resource,
      codeChallenge: pending.codeChallenge,
      codeChallengeMethod: pending.codeChallengeMethod || "S256",
      scopes: [SCOPE_DEFAULT],
    });
    await store.mcpDeletePending(pendingId);
    redirectToClient(res, pending.redirectUri, {
      code,
      state: pending.state || "",
    });
    return true;
  }

  // --- token ---
  if (req.method === "POST" && path === "/oauth/token") {
    const rl = checkRateLimit(`oauth-token:${clientIp(req)}`);
    if (!rl.ok) {
      writeJson(res, 429, { error: "temporarily_unavailable" });
      return true;
    }
    const raw = await readRawBody(req);
    const ct = String(req.headers["content-type"] || "");
    let form;
    if (ct.includes("application/json")) {
      try {
        form = JSON.parse(raw || "{}");
      } catch {
        writeJson(res, 400, { error: "invalid_request" });
        return true;
      }
    } else {
      form = parseForm(raw);
    }
    const grantType = form.grant_type || "";
    const clientId = form.client_id || "";
    const resource = form.resource || mcpResourceUrl(base);

    if (grantType === "authorization_code") {
      const tokens = await store.mcpExchangeCode({
        code: form.code || "",
        codeVerifier: form.code_verifier || "",
        clientId,
        redirectUri: form.redirect_uri || "",
        resource,
      });
      if (!tokens) {
        writeJson(res, 400, { error: "invalid_grant" });
        return true;
      }
      writeJson(res, 200, {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_type: "Bearer",
        expires_in: tokens.expiresIn,
        scope: tokens.scope || SCOPE_DEFAULT,
      });
      return true;
    }

    if (grantType === "refresh_token") {
      const tokens = await store.mcpRefreshTokens(form.refresh_token || "", {
        clientId,
        resource,
      });
      if (!tokens) {
        writeJson(res, 400, { error: "invalid_grant" });
        return true;
      }
      writeJson(res, 200, {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_type: "Bearer",
        expires_in: tokens.expiresIn,
        scope: tokens.scope || SCOPE_DEFAULT,
      });
      return true;
    }

    writeJson(res, 400, { error: "unsupported_grant_type" });
    return true;
  }

  return false;
}

/**
 * After magic-link exchange succeeds: set browser cookie + redirect to consent if pending.
 * @returns {Promise<boolean>} true if response already sent
 */
export async function maybeFinishOauthAfterExchange(res, store, out, pendingId) {
  if (!out || !pendingId) return false;
  const pending = await store.mcpGetPending(pendingId);
  if (!pending) return false;
  const a = out.account;
  if (!a || (a.status !== "active" && a.status !== "trialing")) {
    writeHtml(
      res,
      403,
      simpleMessage(
        "Plus required",
        "Atoms Ask needs an active or trialing Plus account.",
      ),
    );
    return true;
  }
  await store.mcpUpdatePending(pendingId, { email: a.email });
  const bsId = await store.mcpCreateBrowserSession(a.email);
  const loc = `${config.publicBaseUrl.replace(/\/$/, "")}/oauth/consent?pending=${encodeURIComponent(pendingId)}`;
  const secure =
    (process.env.ATOMS_PLUS_ENV || "").toLowerCase() === "production"
      ? "; Secure"
      : "";
  res.writeHead(302, {
    location: loc,
    "set-cookie": [
      `atoms_oauth_bs=${encodeURIComponent(bsId)}; Path=/; Max-Age=900; HttpOnly; SameSite=Lax${secure}`,
    ],
  });
  res.end();
  return true;
}
