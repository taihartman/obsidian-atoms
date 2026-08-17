/**
 * #240 U9 + U10 — the deep-link handoff peeks before it spends anything, every
 * outcome says something the user can act on, and the exchange happens only
 * after a deliberate approval.
 *
 * The refusal path is first on purpose: it is the one a user actually hits when
 * mobile routing sends the link to the wrong vault.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("../src/platform/plusClient", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/platform/plusClient")>();
  return {
    ...actual,
    peekMagicToken: vi.fn(),
    exchangeMagicToken: vi.fn(),
  };
});

import {
  exchangeMagicToken,
  peekMagicToken,
  MAGIC_LINK_EXPIRED_MESSAGE,
  MAGIC_LINK_INVALID_MESSAGE,
  MAGIC_LINK_REFUSED_MESSAGE,
} from "../src/platform/plusClient";
import {
  readPendingSignIns,
  readPlusSession,
  recordPendingSignIn,
  writePlusSession,
  type LocalStorageLike,
} from "../src/platform/filingAuth";
import type { ConfirmVerdict, SignInConfirmRequest } from "../src/shared/confirm";
import {
  createSignInHandoffQueue,
  sanitizeVaultLabel,
  MAGIC_LINK_NETWORK_MESSAGE,
  MAGIC_LINK_RATE_LIMITED_MESSAGE,
  SIGN_IN_AWAITING_CONFIRMATION_MESSAGE,
  SIGN_IN_DECLINED_MESSAGE,
  SIGNING_IN_APPROVED_MESSAGE,
  SIGNING_IN_MESSAGE,
  signedInMessage,
  type PlusSignInHost,
  type SignInStatusSurface,
} from "../src/platform/plusSignIn";

const peek = peekMagicToken as unknown as Mock;
const exchange = exchangeMagicToken as unknown as Mock;

function fakeApp(): LocalStorageLike {
  const store = new Map<string, string>();
  return {
    loadLocalStorage: (key) => store.get(key) ?? null,
    saveLocalStorage: (key, value) => {
      store.set(key, String(value ?? ""));
    },
  };
}

/**
 * `failed` is recorded separately from `messages` so a test can assert *which
 * channel* an outcome took: a refusal has to reach the acknowledge-only surface,
 * not the progress line (U10 step 7 / R5).
 */
type Surface = SignInStatusSurface & {
  messages: string[];
  failed: string[];
  hidden: boolean;
};

const NOW = Date.now();

function harness(opts?: {
  pending?: { verifier: string; vault: string; requestedAt: number }[];
  /** What the human answers. Declining is the default, so no test approves by accident. */
  verdict?: ConfirmVerdict;
  /** Runs while the confirmation is open — e.g. a second link request. */
  whileConfirming?: (app: LocalStorageLike) => void;
}) {
  const app = fakeApp();
  for (const entry of [...(opts?.pending ?? [])].sort(
    (a, b) => a.requestedAt - b.requestedAt,
  )) {
    // oldest first so the newest ends up at the head, as U7's writer does.
    // `requestedAt` is a relative ordering knob: records older than
    // PENDING_SIGNIN_MAX_AGE_MS read as absent, so they are anchored to now.
    recordPendingSignIn(app, {
      ...entry,
      requestedAt: NOW - 60_000 + entry.requestedAt,
    });
  }
  const surfaces: Surface[] = [];
  const confirms: SignInConfirmRequest[] = [];
  const host: PlusSignInHost = {
    app: app as PlusSignInHost["app"],
    settings: { plusBaseUrl: "https://plus.test" },
    confirmSignIn: async (request) => {
      confirms.push(request);
      opts?.whileConfirming?.(app);
      return opts?.verdict ?? "declined";
    },
    installSession: async (session, issuedBase) => {
      writePlusSession(app, { ...session, issuedBase, verifiedBase: issuedBase });
    },
  };
  const queue = createSignInHandoffQueue({
    openStatus: () => {
      const surface: Surface = {
        messages: [],
        failed: [],
        hidden: false,
        update(message: string) {
          surface.messages.push(message);
        },
        fail(message: string) {
          surface.failed.push(message);
          surface.messages.push(message);
        },
        hide() {
          surface.hidden = true;
        },
      };
      surfaces.push(surface);
      return surface;
    },
  });
  return { app, host, queue, surfaces, confirms };
}

const session = {
  ok: true as const,
  session: {
    sessionToken: "sess_secret_value",
    email: "a@b.co",
    status: "active" as const,
    refreshedAt: NOW,
  },
};

const usable = {
  ok: true as const,
  verdict: "usable" as const,
  email: "a@b.co",
  vault: "Notes",
};

/** Text a user actually saw, across every surface. */
function shown(surfaces: Surface[]): string {
  return surfaces.flatMap((s) => s.messages).join("\n");
}

beforeEach(() => {
  peek.mockReset();
  exchange.mockReset();
});

describe("plusSignIn — refusal paths", () => {
  it("names no vault when there is no local pending record, and never peeks", async () => {
    const h = harness();
    h.queue.ready(h.host);
    await h.queue.accept({
      action: "atoms-signin",
      token: "tok_1",
      vault: "Notes",
    });

    expect(peek).not.toHaveBeenCalled();
    expect(exchange).not.toHaveBeenCalled();
    expect(h.confirms).toEqual([]);
    expect(h.surfaces[0].failed).toEqual([MAGIC_LINK_REFUSED_MESSAGE]);
    // No attested name exists, so none is printed — not even the param's.
    expect(shown(h.surfaces)).not.toContain("Notes");
  });

  it("names the server-attested vault when the peek is refused", async () => {
    const h = harness({
      pending: [{ verifier: "v1", vault: "Local", requestedAt: 1000 }],
    });
    peek.mockResolvedValue({
      ok: false,
      status: 403,
      code: "refused",
      verdict: "refused",
      message: MAGIC_LINK_REFUSED_MESSAGE,
      vault: "Work vault",
    });
    h.queue.ready(h.host);
    await h.queue.accept({
      action: "atoms-signin",
      token: "tok_1",
      vault: "<b>Attacker</b>",
    });

    const text = shown(h.surfaces);
    expect(text).toContain("Work vault");
    expect(text).not.toContain("Attacker");
    expect(exchange).not.toHaveBeenCalled();
    expect(h.confirms).toEqual([]);
    // A refusal has to be acknowledged, not swept away on a timer (R5).
    expect(h.surfaces[0].failed).toHaveLength(1);
  });

  it("tries the older verifier when the newest is refused, and exchanges with the one that worked", async () => {
    const h = harness({
      verdict: "confirmed",
      pending: [
        { verifier: "v_old", vault: "Notes", requestedAt: 1000 },
        { verifier: "v_new", vault: "Notes", requestedAt: 2000 },
      ],
    });
    peek.mockImplementation(
      async (_cfg: unknown, opts: { verifier?: string }) =>
        opts.verifier === "v_old"
          ? usable
          : {
              ok: false,
              status: 403,
              code: "refused",
              verdict: "refused",
              message: MAGIC_LINK_REFUSED_MESSAGE,
              vault: "Notes",
            },
    );
    h.queue.ready(h.host);
    await h.queue.accept({ action: "atoms-signin", token: "tok_1" });

    expect(peek).toHaveBeenCalledTimes(2);
    expect(h.confirms).toHaveLength(1);
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(exchange.mock.calls[0][2]).toMatchObject({ verifier: "v_old" });
  });

  it("refuses with the attested vault when every pending verifier is refused", async () => {
    const h = harness({
      pending: [
        { verifier: "v_old", vault: "Notes", requestedAt: 1000 },
        { verifier: "v_new", vault: "Notes", requestedAt: 2000 },
      ],
    });
    peek.mockResolvedValue({
      ok: false,
      status: 403,
      code: "refused",
      verdict: "refused",
      message: MAGIC_LINK_REFUSED_MESSAGE,
      vault: "Work vault",
    });
    h.queue.ready(h.host);
    await h.queue.accept({ action: "atoms-signin", token: "tok_1" });

    expect(peek).toHaveBeenCalledTimes(2);
    expect(shown(h.surfaces)).toContain("Work vault");
    expect(h.confirms).toEqual([]);
  });

  it("stops at the first non-refused verdict rather than burning the rest of the list", async () => {
    const h = harness({
      pending: [
        { verifier: "v_old", vault: "Notes", requestedAt: 1000 },
        { verifier: "v_new", vault: "Notes", requestedAt: 2000 },
      ],
    });
    peek.mockResolvedValue({
      ok: false,
      status: 410,
      code: "expired",
      verdict: "expired",
      message: MAGIC_LINK_EXPIRED_MESSAGE,
    });
    h.queue.ready(h.host);
    await h.queue.accept({ action: "atoms-signin", token: "tok_1" });

    expect(peek).toHaveBeenCalledTimes(1);
    expect(shown(h.surfaces)).toContain(MAGIC_LINK_EXPIRED_MESSAGE);
  });
});

describe("plusSignIn — every outcome says something", () => {
  const pending = [{ verifier: "v1", vault: "Notes", requestedAt: 1000 }];

  it("asks the human before it spends anything, naming the server-verified email", async () => {
    const h = harness({ pending });
    peek.mockResolvedValue(usable);
    h.queue.ready(h.host);
    await h.queue.accept({ action: "atoms-signin", token: "tok_1" });

    expect(h.confirms).toEqual([{ kind: "plus-signin", email: "a@b.co" }]);
    // Declined by default in the harness, so the peek stands alone here.
    expect(exchange).not.toHaveBeenCalled();
    // Nothing is running while the question is open, and the surface says so.
    expect(h.surfaces[0].messages).toContain(
      SIGN_IN_AWAITING_CONFIRMATION_MESSAGE,
    );
  });

  it("surfaces the request-a-new-link message for an expired token", async () => {
    const h = harness({ pending });
    peek.mockResolvedValue({
      ok: false,
      status: 410,
      code: "expired",
      verdict: "expired",
      message: MAGIC_LINK_EXPIRED_MESSAGE,
    });
    h.queue.ready(h.host);
    await h.queue.accept({ action: "atoms-signin", token: "tok_1" });
    expect(shown(h.surfaces)).toContain(MAGIC_LINK_EXPIRED_MESSAGE);
  });

  it("surfaces the request-a-new-link message for an invalid token", async () => {
    const h = harness({ pending });
    peek.mockResolvedValue({
      ok: false,
      status: 400,
      code: "invalid",
      verdict: "invalid",
      message: MAGIC_LINK_INVALID_MESSAGE,
    });
    h.queue.ready(h.host);
    await h.queue.accept({ action: "atoms-signin", token: "tok_1" });
    expect(shown(h.surfaces)).toContain(MAGIC_LINK_INVALID_MESSAGE);
  });

  it("surfaces an actionable retry message on a network failure", async () => {
    const h = harness({ pending });
    peek.mockResolvedValue({
      ok: false,
      status: 0,
      code: "network",
      message: "Plus network error (TypeError: failed)",
    });
    h.queue.ready(h.host);
    await h.queue.accept({ action: "atoms-signin", token: "tok_1" });

    const text = shown(h.surfaces);
    expect(text).toContain(MAGIC_LINK_NETWORK_MESSAGE);
    expect(text).not.toContain(MAGIC_LINK_REFUSED_MESSAGE);
  });

  it("surfaces a distinct too-many-attempts message on a 429", async () => {
    const h = harness({ pending });
    peek.mockResolvedValue({
      ok: false,
      status: 429,
      code: "unknown",
      message: "Too many requests",
    });
    h.queue.ready(h.host);
    await h.queue.accept({ action: "atoms-signin", token: "tok_1" });

    const text = shown(h.surfaces);
    expect(text).toContain(MAGIC_LINK_RATE_LIMITED_MESSAGE);
    expect(text).not.toContain(MAGIC_LINK_REFUSED_MESSAGE);
  });

  it("surfaces something rather than throwing when the peek itself throws", async () => {
    const h = harness({ pending });
    peek.mockRejectedValue(new Error("boom"));
    h.queue.ready(h.host);
    await expect(
      h.queue.accept({ action: "atoms-signin", token: "tok_1" }),
    ).resolves.toBeUndefined();
    expect(shown(h.surfaces).trim()).not.toBe(SIGNING_IN_MESSAGE);
    expect(h.surfaces[0].messages.length).toBeGreaterThan(1);
  });

  it("replaces the in-progress state on one surface instead of stacking a second", async () => {
    const h = harness({ pending });
    let resolvePeek: (v: unknown) => void = () => {};
    peek.mockImplementation(
      () => new Promise((resolve) => (resolvePeek = resolve)),
    );
    h.queue.ready(h.host);
    const done = h.queue.accept({ action: "atoms-signin", token: "tok_1" });

    expect(h.surfaces).toHaveLength(1);
    expect(h.surfaces[0].messages).toEqual([SIGNING_IN_MESSAGE]);

    resolvePeek({
      ok: false,
      status: 410,
      code: "expired",
      verdict: "expired",
      message: MAGIC_LINK_EXPIRED_MESSAGE,
    });
    await done;

    expect(h.surfaces).toHaveLength(1);
    expect(h.surfaces[0].messages).toEqual([
      SIGNING_IN_MESSAGE,
      MAGIC_LINK_EXPIRED_MESSAGE,
    ]);
  });
});

describe("plusSignIn — the exchange runs only on approval (U10)", () => {
  const pending = [{ verifier: "v1", vault: "Notes", requestedAt: 1000 }];

  it("exchanges once, stores the session, and retires the pending verifier", async () => {
    const h = harness({ pending, verdict: "confirmed" });
    peek.mockResolvedValue(usable);
    exchange.mockResolvedValue(session);
    h.queue.ready(h.host);
    await h.queue.accept({ action: "atoms-signin", token: "tok_1" });

    expect(exchange).toHaveBeenCalledTimes(1);
    expect(exchange.mock.calls[0][1]).toBe("tok_1");
    expect(exchange.mock.calls[0][2]).toMatchObject({ verifier: "v1" });
    expect(readPlusSession(h.app)?.email).toBe("a@b.co");
    expect(readPendingSignIns(h.app)).toEqual([]);
    expect(shown(h.surfaces)).toContain(signedInMessage("a@b.co"));
  });

  for (const verdict of ["declined", "dismissed"] as const) {
    it(`makes no server call at all when the user ${verdict} it, and the link still works`, async () => {
      const h = harness({ pending, verdict });
      peek.mockResolvedValue(usable);
      h.queue.ready(h.host);
      await h.queue.accept({ action: "atoms-signin", token: "tok_1" });

      // Zero calls, not merely "no session written" — cancel must not revoke
      // the account's other sessions, which an exchange would (AE2).
      expect(exchange).not.toHaveBeenCalled();
      expect(readPlusSession(h.app)).toBeNull();
      expect(shown(h.surfaces)).toContain(SIGN_IN_DECLINED_MESSAGE);

      // The peek consumed nothing and the verifier survived, so a second tap
      // reaches the same question rather than a dead link.
      expect(readPendingSignIns(h.app)).toHaveLength(1);
      await h.queue.accept({ action: "atoms-signin", token: "tok_1" });
      expect(h.confirms).toHaveLength(2);
    });
  }

  it("shows progress between the approval and the session landing (R19)", async () => {
    const h = harness({ pending, verdict: "confirmed" });
    peek.mockResolvedValue(usable);
    let settleExchange: (v: unknown) => void = () => {};
    exchange.mockImplementation(
      () => new Promise((resolve) => (settleExchange = resolve)),
    );
    h.queue.ready(h.host);
    const done = h.queue.accept({ action: "atoms-signin", token: "tok_1" });
    await Promise.resolve();
    await Promise.resolve();

    expect(h.surfaces[0].messages.at(-1)).toBe(SIGNING_IN_APPROVED_MESSAGE);
    expect(readPlusSession(h.app)).toBeNull();

    settleExchange(session);
    await done;
    expect(h.surfaces[0].messages).toEqual([
      SIGNING_IN_MESSAGE,
      // The peek is done, so "Checking…" is retired before the question lands.
      SIGN_IN_AWAITING_CONFIRMATION_MESSAGE,
      SIGNING_IN_APPROVED_MESSAGE,
      signedInMessage("a@b.co"),
    ]);
  });

  it("leaves the device signed out and says so when the exchange fails after approval", async () => {
    const h = harness({ pending, verdict: "confirmed" });
    peek.mockResolvedValue(usable);
    exchange.mockResolvedValue({
      ok: false,
      status: 410,
      code: "expired",
      verdict: "expired",
      message: MAGIC_LINK_EXPIRED_MESSAGE,
    });
    h.queue.ready(h.host);
    await h.queue.accept({ action: "atoms-signin", token: "tok_1" });

    expect(readPlusSession(h.app)).toBeNull();
    expect(h.surfaces[0].failed).toEqual([MAGIC_LINK_EXPIRED_MESSAGE]);
    // The verifier outlives a failed exchange so the next tap can still work.
    expect(readPendingSignIns(h.app)).toHaveLength(1);
  });

  it("exchanges with this flow's verifier, not one minted while the question was open", async () => {
    // The user taps **Send sign-in link** again with the confirmation on screen.
    let headAtConfirm = "";
    const h = harness({
      pending,
      verdict: "confirmed",
      whileConfirming: (app) => {
        recordPendingSignIn(app, { verifier: "v_newer", vault: "Notes" });
        headAtConfirm = readPendingSignIns(app)[0]?.verifier ?? "";
      },
    });
    peek.mockResolvedValue(usable);
    exchange.mockResolvedValue(session);
    h.queue.ready(h.host);
    await h.queue.accept({ action: "atoms-signin", token: "tok_1" });

    // A fresh read at approve time would have handed over the newer verifier,
    // which this link's row does not know — so the carried one is used instead.
    expect(headAtConfirm).toBe("v_newer");
    expect(exchange.mock.calls[0][2]).toMatchObject({ verifier: "v1" });
    expect(h.confirms).toEqual([{ kind: "plus-signin", email: "a@b.co" }]);
  });

  it("never surfaces the session token it just stored", async () => {
    const h = harness({ pending, verdict: "confirmed" });
    peek.mockResolvedValue(usable);
    exchange.mockResolvedValue(session);
    h.queue.ready(h.host);
    await h.queue.accept({ action: "atoms-signin", token: "tok_1" });

    expect(readPlusSession(h.app)?.sessionToken).toBe("sess_secret_value");
    expect(shown(h.surfaces)).not.toContain("sess_secret_value");
  });
});

describe("plusSignIn — hostile input and secrets", () => {
  it("never presents the vault param as the requesting vault, however hostile", async () => {
    const hostile = `<img src=x onerror=alert(1)> \u001B[31m${"A".repeat(10000)}`;
    const h = harness();
    h.queue.ready(h.host);
    await h.queue.accept({
      action: "atoms-signin",
      token: "tok_1",
      vault: hostile,
    });

    const text = shown(h.surfaces);
    expect(h.surfaces[0].messages.at(-1)).toBe(MAGIC_LINK_REFUSED_MESSAGE);
    expect(text).not.toContain("onerror");
    expect(text).not.toContain("AAAA");
  });

  it("caps and strips the vault param anywhere it is rendered at all", () => {
    const cleaned = sanitizeVaultLabel(
      `Note\u0007s\u001B[31m\n\n${"B".repeat(500)}`,
    );
    expect(cleaned.length).toBeLessThanOrEqual(80);
    expect(cleaned).not.toContain("\u0007");
    expect(cleaned).not.toContain("\u001B");
    expect(cleaned).not.toContain("\n");
  });

  it("strips invisible bidi and zero-width characters from a vault name", () => {
    // These render as nothing but reorder the text around them, so a hostile
    // name can *look* like the vault the user trusts in the one sentence they
    // read before approving. RLO is the classic spoof; the isolates and the
    // zero-width joiners do the same job more quietly.
    const spoofed = sanitizeVaultLabel(
      "Work" + "\u202E" + "krow" + "\u200B" + "Vault" + "\u2066" + "!",
    );
    for (const invisible of ["\u202E", "\u200B", "\u2066"]) {
      expect(spoofed).not.toContain(invisible);
    }
    // A legitimate non-Latin name survives untouched — this strips, never rejects.
    expect(sanitizeVaultLabel("研究ノート")).toBe("研究ノート");
    expect(sanitizeVaultLabel("Café Notes")).toBe("Café Notes");
  });

  it("ignores a malformed or token-less deep link without throwing", async () => {
    const h = harness({
      pending: [{ verifier: "v1", vault: "Notes", requestedAt: 1000 }],
    });
    h.queue.ready(h.host);
    await expect(
      h.queue.accept({ action: "atoms-signin" }),
    ).resolves.toBeUndefined();
    await expect(
      h.queue.accept({ action: "atoms-signin", token: "   " }),
    ).resolves.toBeUndefined();

    expect(peek).not.toHaveBeenCalled();
    expect(h.surfaces).toEqual([]);
  });

  it("surfaces neither the token nor the verifier in any outcome", async () => {
    const h = harness({
      pending: [
        {
          verifier: "verifier_secret",
          vault: "Notes",
          requestedAt: 1000,
        },
      ],
    });
    for (const result of [
      usable,
      {
        ok: false,
        status: 403,
        code: "refused",
        verdict: "refused",
        message: MAGIC_LINK_REFUSED_MESSAGE,
        vault: "Notes",
      },
      {
        ok: false,
        status: 410,
        code: "expired",
        verdict: "expired",
        message: MAGIC_LINK_EXPIRED_MESSAGE,
      },
      {
        ok: false,
        status: 429,
        code: "unknown",
        message: "Too many requests",
      },
      {
        ok: false,
        status: 0,
        code: "network",
        message: "Plus network error",
      },
    ]) {
      peek.mockResolvedValue(result);
      h.queue.ready(h.host);
      await h.queue.accept({
        action: "atoms-signin",
        token: "tok_secret_value",
      });
    }
    const text = shown(h.surfaces);
    expect(text).not.toContain("tok_secret_value");
    expect(text).not.toContain("verifier_secret");
  });
});

describe("plusSignIn — cold-open queue", () => {
  it("queues a handoff that arrives before settings load and drains it after", async () => {
    const h = harness({
      pending: [{ verifier: "v1", vault: "Notes", requestedAt: 1000 }],
    });
    peek.mockResolvedValue(usable);

    // Fired before `ready` — the vault was closed and the link opened it (AE10).
    await h.queue.accept({ action: "atoms-signin", token: "tok_1" });
    expect(peek).not.toHaveBeenCalled();
    // The user still sees something from the tap, not from the drain.
    expect(h.surfaces[0].messages).toEqual([SIGNING_IN_MESSAGE]);

    await h.queue.ready(h.host);
    expect(peek).toHaveBeenCalledTimes(1);
    expect(h.confirms).toHaveLength(1);
  });

  it("supersedes rather than queues a second handoff during a cold open", async () => {
    const h = harness({
      pending: [{ verifier: "v1", vault: "Notes", requestedAt: 1000 }],
    });
    peek.mockResolvedValue(usable);

    await h.queue.accept({ action: "atoms-signin", token: "tok_1" });
    await h.queue.accept({ action: "atoms-signin", token: "tok_2" });
    await h.queue.ready(h.host);

    expect(peek).toHaveBeenCalledTimes(1);
    expect(peek.mock.calls[0][1]).toMatchObject({ token: "tok_2" });
    expect(h.surfaces[0].hidden).toBe(true);
  });

  it("retires the previous tap's surface, even one that already finished", async () => {
    const h = harness({
      pending: [{ verifier: "v1", vault: "Notes", requestedAt: 1000 }],
    });
    peek.mockResolvedValue(usable);
    h.queue.ready(h.host);

    await h.queue.accept({ action: "atoms-signin", token: "tok_1" });
    expect(h.surfaces[0].messages).toContain(SIGN_IN_DECLINED_MESSAGE);
    expect(h.surfaces[0].hidden).toBe(false);

    // Second tap: the finished outcome must not sit beside the new question.
    await h.queue.accept({ action: "atoms-signin", token: "tok_1" });
    expect(h.surfaces).toHaveLength(2);
    expect(h.surfaces[0].hidden).toBe(true);
    expect(h.surfaces[1].hidden).toBe(false);
  });
});

/**
 * The cold-open tests above each await one tap before firing the next, so none
 * of them ever has two handoffs alive at once. The real protocol handler is
 * `void`-dispatched, and a confirmation parks for as long as the user takes to
 * answer — which is exactly the window a second tap arrives in.
 */
describe("plusSignIn — a superseded handoff must not spend its token", () => {
  /** A confirmation that stays open until the test answers it. */
  function deferredConfirms() {
    const opened: ((verdict: ConfirmVerdict) => void)[] = [];
    const confirmSignIn = () =>
      new Promise<ConfirmVerdict>((resolve) => opened.push(resolve));
    return { opened, confirmSignIn };
  }

  function raceHarness() {
    const app = fakeApp();
    recordPendingSignIn(app, {
      verifier: "v1",
      vault: "Notes",
      requestedAt: NOW - 60_000,
    });
    const { opened, confirmSignIn } = deferredConfirms();
    const surfaces: Surface[] = [];
    const host: PlusSignInHost = {
      app: app as PlusSignInHost["app"],
      settings: { plusBaseUrl: "https://plus.test" },
      confirmSignIn,
      installSession: async (session, issuedBase) => {
        writePlusSession(app, { ...session, issuedBase, verifiedBase: issuedBase });
      },
    };
    const queue = createSignInHandoffQueue({
      openStatus: () => {
        const surface: Surface = {
          messages: [],
          failed: [],
          hidden: false,
          update: (m: string) => surface.messages.push(m),
          fail: (m: string) => {
            surface.failed.push(m);
            surface.messages.push(m);
          },
          hide: () => {
            surface.hidden = true;
          },
        };
        surfaces.push(surface);
        return surface;
      },
    });
    return { app, host, queue, surfaces, opened };
  }

  it("exchanges only the newest tap when both confirmations are approved", async () => {
    const h = raceHarness();
    peek.mockResolvedValue(usable);
    exchange.mockResolvedValue(session);
    await h.queue.ready(h.host);

    // Two taps, neither awaited: the first parks on its confirmation while the
    // second arrives — the window the OS actually delivers a re-tap in.
    const first = h.queue.accept({ action: "atoms-signin", token: "tok_1" });
    await Promise.resolve();
    const second = h.queue.accept({ action: "atoms-signin", token: "tok_2" });
    await Promise.resolve();
    expect(h.opened).toHaveLength(2);

    // The user approves the stale dialog too — the dangerous case.
    h.opened[0]("confirmed");
    h.opened[1]("confirmed");
    await Promise.all([first, second]);

    // One spend, and it is the token the user last tapped. Two exchanges would
    // revoke each other and strand this device on a dead session.
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(exchange.mock.calls[0][1]).toBe("tok_2");
    // The superseded run says nothing: its surface was already retired.
    expect(h.surfaces[0].failed).toEqual([]);
    expect(h.surfaces[0].messages).not.toContain(SIGN_IN_DECLINED_MESSAGE);
    expect(readPlusSession(h.app)?.sessionToken).toBe("sess_secret_value");
  });

  it("does not spend a superseded token even when the stale answer is a decline", async () => {
    const h = raceHarness();
    peek.mockResolvedValue(usable);
    exchange.mockResolvedValue(session);
    await h.queue.ready(h.host);

    const first = h.queue.accept({ action: "atoms-signin", token: "tok_1" });
    await Promise.resolve();
    const second = h.queue.accept({ action: "atoms-signin", token: "tok_2" });
    await Promise.resolve();

    h.opened[0]("declined");
    h.opened[1]("confirmed");
    await Promise.all([first, second]);

    expect(exchange).toHaveBeenCalledTimes(1);
    expect(exchange.mock.calls[0][1]).toBe("tok_2");
    // A stale decline must not overwrite the live run's outcome.
    expect(h.surfaces[0].messages).not.toContain(SIGN_IN_DECLINED_MESSAGE);
  });
});

describe("plusSignIn — registration site", () => {
  it("registers the protocol handler above onload's first await", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../src/plugin/main.ts"),
      "utf8",
    );
    const onload = source.indexOf("async onload()");
    expect(onload).toBeGreaterThan(-1);
    const body = source.slice(onload);
    const registration = body.indexOf("registerObsidianProtocolHandler");
    const firstAwait = body.indexOf("await ");
    expect(registration).toBeGreaterThan(-1);
    expect(registration).toBeLessThan(firstAwait);
  });
});
