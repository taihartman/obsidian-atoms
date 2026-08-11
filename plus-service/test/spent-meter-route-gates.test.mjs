/**
 * #441 — the route-level half of the entitlement split.
 *
 * `spent-meter-keeps-ask.test.mjs` proves `subscriptionLive` and the three
 * `accountFromMcpToken` copies. That leaves the larger half of the change —
 * `entitled()` guarding eight Plus-session routes and seven OAuth connect
 * gates — verified only by a source-parity check that the files *mention*
 * `subscriptionLive`. A file can mention it and still call it with the wrong
 * polarity, so these drive the real handlers and assert the status code.
 *
 * Both handlers take an injected `store`, so this needs no spawned server, no
 * network, and no API key: it is a small test, at the level that owns the
 * question. Two independent reviewers named this exact gap.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleMirrorRoutes } from "../src/mirror/http.mjs";
import { handleOauthRoutes } from "../src/oauth/routes.mjs";

const DAY = 86_400_000;
const future = () => new Date(Date.now() + 5 * DAY).toISOString();
const past = () => new Date(Date.now() - 5 * DAY).toISOString();

/** The two meanings of `exhausted`, plus the stale-status case. */
const SPENT_METER = { status: "exhausted", periodEnd: future() };
const ENDED_PERIOD = { status: "exhausted", periodEnd: past() };
const STALE_ACTIVE = { status: "active", periodEnd: past() };
const HEALTHY = { status: "active", periodEnd: future() };

/** Captures what the handler wrote, without a socket. */
function recorder() {
  const out = { status: 0, body: "" };
  return {
    res: {
      writeHead(status) {
        out.status = status;
      },
      end(data) {
        out.body = String(data ?? "");
      },
      setHeader() {},
    },
    out,
  };
}

let seq = 0;
/** A distinct email per case — the mirror routes are rate-limited per email. */
const nextEmail = () => `gate-${++seq}@ex.co`;

function mirrorStore(account, email) {
  return {
    accountFromSession: async () => (account ? { ...account, email } : null),
    mirrorStatus: async () => ({ count: 7, lastPushedAt: null }),
  };
}

async function getMirrorStatus(account) {
  const email = nextEmail();
  const { res, out } = recorder();
  const handled = await handleMirrorRoutes({
    req: { method: "GET", headers: {}, socket: {} },
    res,
    path: "/v1/ask/mirror/status",
    store: mirrorStore(account, email),
    bearer: () => "sess_test",
    json: (r, status, body) => {
      r.writeHead(status);
      r.end(JSON.stringify(body));
    },
    readBody: async () => ({}),
  });
  assert.equal(handled, true, "the route must claim the request");
  return out;
}

async function getConsent(account) {
  const email = nextEmail();
  const { res, out } = recorder();
  const handled = await handleOauthRoutes({
    req: { method: "GET", headers: {}, socket: {} },
    res,
    path: "/oauth/consent",
    url: new URL("https://example.test/oauth/consent?pending=pnd_1"),
    store: {
      mcpGetPending: async () => ({
        email,
        clientId: "cli_1",
        redirectUri: "https://claude.ai/api/mcp/auth_callback",
        scopes: ["atoms:read"],
        scope: "atoms:read",
      }),
      mcpGetBrowserSession: async () => null,
      getAccount: async () => (account ? { ...account, email } : null),
    },
    readRawBody: async () => "",
    readBody: async () => ({}),
  });
  assert.equal(handled, true, "the route must claim the request");
  return out;
}

describe("#441 mirror routes — entitled() polarity", () => {
  it("a spent meter reaches mirror status", async () => {
    const out = await getMirrorStatus(SPENT_METER);
    assert.equal(out.status, 200, out.body);
  });

  it("an ended period is still refused", async () => {
    const out = await getMirrorStatus(ENDED_PERIOD);
    assert.equal(out.status, 403);
    assert.match(out.body, /Plus entitlement required/);
  });

  it("a stale 'active' with a past period is refused", async () => {
    // These routes resolve the account through `accountFromSession`, so this
    // is the belt to the MCP path's braces.
    const out = await getMirrorStatus(STALE_ACTIVE);
    assert.equal(out.status, 403);
  });

  it("a healthy account is unaffected", async () => {
    const out = await getMirrorStatus(HEALTHY);
    assert.equal(out.status, 200, out.body);
  });
});

describe("#441 OAuth connect — a spent meter may still connect an AI app", () => {
  it("a spent meter reaches the consent screen", async () => {
    const out = await getConsent(SPENT_METER);
    assert.equal(out.status, 200, out.body.slice(0, 200));
    assert.doesNotMatch(out.body, /Plus required/);
  });

  it("an ended period is told Plus is required", async () => {
    const out = await getConsent(ENDED_PERIOD);
    assert.equal(out.status, 403);
    assert.match(out.body, /Plus required/);
  });

  it("a stale 'active' with a past period cannot connect", async () => {
    // The OAuth gates call `getAccount()` without `refreshAccountStatus`, so
    // before #441 this un-normalized row passed on `status === "active"`
    // alone. Checking the period first is what closes it.
    const out = await getConsent(STALE_ACTIVE);
    assert.equal(out.status, 403);
    assert.match(out.body, /Plus required/);
  });

  it("no account at all is refused", async () => {
    const out = await getConsent(null);
    assert.equal(out.status, 403);
  });
});
