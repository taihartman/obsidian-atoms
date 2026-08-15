/**
 * #508 U2 — every path that acquires a Plus session stamps the base it actually
 * talked to.
 *
 * The failure this file exists to catch is not a *missing* stamp, which the
 * required argument already turns into a build error, but a *wrong* one: a
 * caller satisfying the compiler with `settings.plusBaseUrl`, which makes the
 * stamp equal the resolved base by construction and fails the U3 gate open on
 * every device.
 *
 * So each path is driven with the configured base **changing mid-flight**,
 * between the request going out and the session being installed. That is a real
 * shape — the field arrives through Obsidian Sync as well as from typing — and
 * it is the only construction where "the base contacted" and "the base
 * configured" hold different values at install time. A stamp taken from
 * settings passes every assertion below except these.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestUrlMock = vi.fn();

vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<typeof import("obsidian")>();
  return { ...actual, requestUrl: (opts: unknown) => requestUrlMock(opts) };
});

import { readPlusSession, type PlusSession } from "../src/platform/filingAuth";
import { completeSignInHandoff } from "../src/platform/plusSignIn";
import { settingTab } from "./helpers/settingsTab";

/** Where the plugin is pointed when the request goes out. */
const CONTACTED = "https://self.host.example";
/** What the field says by the time the session is installed. */
const RECONFIGURED = "https://plus.tryatoms.app";

type Fetched = { url: string; body: unknown };

/**
 * A `window.fetch` double for the Plus auth routes. `onAuth` runs after the auth
 * response is handed back, which is where a test moves the configured base.
 */
function stubFetch(opts: {
  json: Record<string, unknown>;
  onAuth?: () => void;
}): { calls: Fetched[]; restore: () => void } {
  const calls: Fetched[] = [];
  const previous = window.fetch;
  window.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body });
    const isAuth = url.includes("/v1/auth/");
    const payload = isAuth ? opts.json : {};
    if (isAuth) opts.onAuth?.();
    return {
      status: isAuth ? 200 : 500,
      text: async () => JSON.stringify(payload),
      headers: new Map(),
    };
  }) as unknown as typeof window.fetch;
  return { calls, restore: () => (window.fetch = previous) };
}

const AUTH_JSON = {
  session: "sess_from_self_host",
  sessionToken: "sess_from_self_host",
  email: "self@hoster.test",
  status: "active",
  remaining: 40,
};

/** The settings tab, its device storage, and the private method under test. */
function accountTab() {
  const made = settingTab({ settings: { plusBaseUrl: CONTACTED } });
  const app = made.tab as unknown as {
    app: Parameters<typeof readPlusSession>[0];
  };
  return {
    ...made,
    app: app.app,
    call: (name: string, arg: string) =>
      (
        made.tab as unknown as Record<
          string,
          (a: string) => Promise<void>
        >
      )[name]!(arg),
    /** Point the field somewhere else, as a Sync-delivered change would. */
    reconfigure: () => {
      made.plugin.settings.plusBaseUrl = RECONFIGURED;
    },
  };
}

describe("#508 U2 the stamp cannot be fabricated", () => {
  it("refuses a base read from settings at compile time", () => {
    const fromSettings: string = CONTACTED;
    // The whole point of the brand: this is the idiom sitting at 23 call sites,
    // and it must not be assignable where an issuer is required. This file is
    // in `tsconfig.test.json`, so the expectation is checked rather than inert.
    // @ts-expect-error — a plain string is not an IssuedBase.
    const forged: import("../src/platform/filingAuth").IssuedBase = fromSettings;
    expect(forged).toBe(CONTACTED);
  });
});

describe("#508 U2 acquisition paths stamp the base they contacted", () => {
  let fetchStub: { calls: Fetched[]; restore: () => void } | null = null;

  beforeEach(() => {
    requestUrlMock.mockReset();
  });

  afterEach(() => {
    fetchStub?.restore();
    fetchStub = null;
  });

  it("startTrial stamps the base the start call answered from", async () => {
    const tab = accountTab();
    fetchStub = stubFetch({ json: AUTH_JSON, onAuth: tab.reconfigure });

    await tab.call("startTrial", "buyer@example.com");

    expect(fetchStub.calls[0]?.url).toContain(CONTACTED);
    const stored = readPlusSession(tab.app);
    expect(stored?.issuedBase).toBe(CONTACTED);
    expect(stored?.verifiedBase).toBe(CONTACTED);
    // The negative half: the field says something else by now, and the stamp
    // did not follow it.
    expect(tab.plugin.settings.plusBaseUrl).toBe(RECONFIGURED);
    expect(stored?.issuedBase).not.toBe(RECONFIGURED);
  });

  it("startSubscribeFromEmail stamps the base the start call answered from", async () => {
    const tab = accountTab();
    fetchStub = stubFetch({ json: AUTH_JSON, onAuth: tab.reconfigure });

    await tab.call("startSubscribeFromEmail", "friend@example.com");

    expect(fetchStub.calls[0]?.url).toContain(CONTACTED);
    const stored = readPlusSession(tab.app);
    expect(stored?.issuedBase).toBe(CONTACTED);
    expect(stored?.verifiedBase).toBe(CONTACTED);
    expect(stored?.issuedBase).not.toBe(RECONFIGURED);
  });

  it("savePastedSession stamps the base its own /v1/me call answered from", async () => {
    const tab = accountTab();
    // This path hand-rolls `requestUrl` rather than going through plusRequest,
    // so it is stubbed separately — and it is the only caller that builds a
    // fresh session literal.
    requestUrlMock.mockImplementation(async (opts: { url: string }) => {
      expect(opts.url).toContain(CONTACTED);
      tab.reconfigure();
      return {
        status: 200,
        json: { email: "self@hoster.test", status: "active", remaining: 7 },
      };
    });

    await tab.call("savePastedSession", "sess_pasted_abc");

    expect(requestUrlMock).toHaveBeenCalledTimes(1);
    const stored = readPlusSession(tab.app);
    expect(stored?.issuedBase).toBe(CONTACTED);
    expect(stored?.verifiedBase).toBe(CONTACTED);
    expect(stored?.issuedBase).not.toBe(RECONFIGURED);
  });

  it("the magic-link chain carries the exchange's base through the port", async () => {
    const settings = { plusBaseUrl: CONTACTED };
    fetchStub = stubFetch({
      json: AUTH_JSON,
      onAuth: () => {
        settings.plusBaseUrl = RECONFIGURED;
      },
    });
    const installed: { session: PlusSession; issuedBase: string }[] = [];
    const local = new Map<string, unknown>();
    const app = {
      loadLocalStorage: (k: string) => local.get(k) ?? null,
      saveLocalStorage: (k: string, v: unknown) => local.set(k, v),
    };

    await completeSignInHandoff(
      {
        app: app as unknown as Parameters<
          typeof completeSignInHandoff
        >[0]["app"],
        settings,
        confirmSignIn: async () => "confirmed",
        installSession: async (session, issuedBase) => {
          installed.push({ session, issuedBase });
        },
      },
      {
        email: "self@hoster.test",
        token: "magic_token",
        verifier: "verifier",
        status: { update: () => {}, fail: () => {}, hide: () => {} },
      },
    );

    expect(fetchStub.calls[0]?.url).toContain(CONTACTED);
    // The port carries the stamp, so the host has nothing to resolve. A wrapper
    // that re-read `settings.plusBaseUrl` here would say RECONFIGURED.
    expect(installed).toHaveLength(1);
    expect(installed[0]?.issuedBase).toBe(CONTACTED);
    expect(settings.plusBaseUrl).toBe(RECONFIGURED);
  });
});
