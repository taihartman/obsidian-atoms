/**
 * #240 U9 — the deep-link handoff peeks before it spends anything, and every
 * outcome of that peek says something the user can act on.
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
  recordPendingSignIn,
  type LocalStorageLike,
} from "../src/platform/filingAuth";
import {
  createSignInHandoffQueue,
  sanitizeVaultLabel,
  MAGIC_LINK_NETWORK_MESSAGE,
  MAGIC_LINK_RATE_LIMITED_MESSAGE,
  SIGNING_IN_MESSAGE,
  type MagicHandoffApproval,
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

type Surface = SignInStatusSurface & { messages: string[]; hidden: boolean };

const NOW = Date.now();

function harness(opts?: {
  pending?: { verifier: string; vault: string; requestedAt: number }[];
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
  const approvals: MagicHandoffApproval[] = [];
  const host: PlusSignInHost = {
    app: app as PlusSignInHost["app"],
    settings: { plusBaseUrl: "https://plus.test" },
    onPeekUsable: (ctx) => {
      approvals.push(ctx);
    },
  };
  const queue = createSignInHandoffQueue({
    openStatus: () => {
      const surface: Surface = {
        messages: [],
        hidden: false,
        update(message: string) {
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
  return { app, host, queue, surfaces, approvals };
}

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
    expect(h.approvals).toEqual([]);
    expect(shown(h.surfaces)).toContain(MAGIC_LINK_REFUSED_MESSAGE);
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
    expect(h.approvals).toEqual([]);
  });

  it("tries the older verifier when the newest is refused, and carries the one that worked", async () => {
    const h = harness({
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
    expect(h.approvals).toHaveLength(1);
    expect(h.approvals[0].verifier).toBe("v_old");
    expect(exchange).not.toHaveBeenCalled();
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
    expect(h.approvals).toEqual([]);
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

  it("hands a usable peek to the confirmation without exchanging", async () => {
    const h = harness({ pending });
    peek.mockResolvedValue(usable);
    h.queue.ready(h.host);
    await h.queue.accept({ action: "atoms-signin", token: "tok_1" });

    expect(exchange).not.toHaveBeenCalled();
    expect(h.approvals).toHaveLength(1);
    expect(h.approvals[0]).toMatchObject({
      token: "tok_1",
      verifier: "v1",
      email: "a@b.co",
      vault: "Notes",
    });
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
    expect(h.approvals).toHaveLength(1);
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
