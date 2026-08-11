/**
 * U8 — the backfill entry point, branched on filing auth.
 *
 * The headline regression: `runBackfillFlow` opened with `requireApiKey()`, so a Plus or trial
 * device was told to set an API key it does not have and could not reach backfill at all — on the
 * same screen that reads "Plus · Trial · 150 filings left".
 *
 * Everything here drives the real prototype against a real vault double, because every claim the
 * unit makes is about what the *flow* passes on: which bounds reach the scan, which order reaches
 * the write, and which meter the offer was priced against.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Modal } from "obsidian";
import AtomsPlugin from "../src/plugin/main";
import {
  LS_PLUS_SESSION,
  serializePlusSession,
  type PlusSession,
} from "../src/platform/filingAuth";
import {
  EGRESS_ACK_VERSION,
  LS_AUTO_RUN_EGRESS_ACK,
  LS_AUTO_RUN_ENABLED,
  LS_AUTO_RUN_START_DAY,
  localDateString,
} from "../src/platform/autorun";
import {
  atomResult,
  contextProviderFor,
  fakeVault,
  stubDailyNotes,
  type VaultDouble,
} from "./helpers/pipelineVault";
import type { ClassificationResult } from "../src/shared/types";

const DAY_MS = 86_400_000;
const dayBack = (n: number): string =>
  localDateString(new Date(Date.now() - n * DAY_MS));

/* ----------------------------------------------------------------- *
 * Plus service double — one `window.fetch` for /v1/me, /v1/classify
 * and /v1/billing/checkout, so the flow talks to the same seam it
 * talks to in production.
 * ----------------------------------------------------------------- */

interface PlusService {
  /** What GET /v1/me answers with next. `null` = the read fails (network). */
  entitlement: { status: string; remaining: number; periodEnd?: string } | null;
  /**
   * Classify replies, consumed in order; the last one repeats. Empty means "one atom per
   * capture, titled after it" — distinct titles, so 20 filed captures are 20 atoms rather than
   * 19 collisions with the first.
   */
  results: ClassificationResult[];
  /** Every /v1/classify attempt, including the one that came back 402. */
  attempts: number;
  /** Filings left as the classify route sees it — 0 answers 402. */
  meter: number;
  /** Every URL the flow reached, in order. */
  calls: string[];
  /** Capture texts the proxy was asked to classify, in order. */
  classified: string[];
}

function installPlusService(svc: PlusService): void {
  let next = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    svc.calls.push(url);
    const body = (json: unknown, status = 200) =>
      ({
        ok: status < 400,
        status,
        // `plusFetchRequest` walks `headers` to build its requestUrl-shaped answer. A double
        // without them fails as a network error, and every assertion below then reads as a
        // product bug rather than a broken stub.
        headers: new Headers(),
        text: async () => JSON.stringify(json),
      }) as unknown as Response;

    if (url.endsWith("/v1/me")) {
      if (!svc.entitlement) throw new Error("offline");
      return body(svc.entitlement);
    }
    if (url.endsWith("/v1/billing/checkout")) {
      return body({ url: "https://checkout.example/session" });
    }
    if (url.endsWith("/v1/classify")) {
      svc.attempts += 1;
      if (svc.meter <= 0) {
        return body({ message: "Included filings used up this period." }, 402);
      }
      svc.meter -= 1;
      const parsed = JSON.parse(String(init?.body ?? "{}")) as {
        capture?: string;
      };
      const capture = parsed.capture ?? "";
      svc.classified.push(capture);
      const result = svc.results.length
        ? svc.results[Math.min(next, svc.results.length - 1)]!
        : atomResult(`Atom for ${capture}`);
      next += 1;
      return body({
        result: {
          content: [{ type: "text", text: JSON.stringify(result) }],
          usage: {},
        },
        remaining: svc.meter,
      });
    }
    throw new Error(`unexpected Plus call: ${url}`);
  });
}

/* ----------------------------------------------------------------- *
 * The plugin under test
 * ----------------------------------------------------------------- */

interface Harness {
  plugin: AtomsPlugin;
  vault: VaultDouble;
  store: Record<string, unknown>;
  notices: string[];
  opened: string[];
  svc: PlusService;
}

/**
 * `Notice` and `requestUrl` have to be replaced where production reaches them: the BYOK
 * estimate's `count_tokens` call goes through `requestUrl`, and the Plus routes go through
 * `window.fetch`, so the two engines are told apart by which seam they touch.
 */
const seam = vi.hoisted(() => ({
  notices: [] as string[],
  countTokens: 0,
}));
const notices = seam.notices;
vi.mock("obsidian", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Notice: class {
      constructor(message: string) {
        seam.notices.push(message);
      }
    },
    requestUrl: (opts: { url: string }) => {
      if (opts.url.includes("count_tokens")) {
        seam.countTokens += 1;
        return Promise.resolve({ status: 200, json: { input_tokens: 900 } });
      }
      return Promise.reject(new Error(`unexpected requestUrl: ${opts.url}`));
    },
  };
});

function harness(opts: {
  files: Record<string, string>;
  dailies: Array<{ path: string; date: string }>;
  session?: PlusSession | null;
  apiKey?: string | null;
  entitlement?: PlusService["entitlement"];
  meter?: number;
  results?: ClassificationResult[];
  /** Auto-filing toggle + its stored window start. */
  filing?: { enabled: boolean; startDay?: string };
}): Harness {
  const vault = fakeVault(opts.files);
  stubDailyNotes(opts.dailies);
  const store: Record<string, unknown> = {
    [LS_AUTO_RUN_EGRESS_ACK]: EGRESS_ACK_VERSION,
  };
  const filing = opts.filing ?? { enabled: true, startDay: dayBack(10) };
  store[LS_AUTO_RUN_ENABLED] = filing.enabled;
  if (filing.startDay) store[LS_AUTO_RUN_START_DAY] = filing.startDay;
  if (opts.session) {
    store[LS_PLUS_SESSION] = serializePlusSession(opts.session);
  }

  const svc: PlusService = {
    entitlement:
      opts.entitlement === undefined
        ? { status: "active", remaining: 150, periodEnd: dayBack(-20) }
        : opts.entitlement,
    results: opts.results ?? [],
    meter: opts.meter ?? 150,
    calls: [],
    classified: [],
    attempts: 0,
  };
  installPlusService(svc);

  const opened: string[] = [];
  vi.stubGlobal("open", (url: string) => {
    opened.push(url);
    return null;
  });

  const app = {
    ...(vault.app as unknown as Record<string, unknown>),
    loadLocalStorage: (k: string) => store[k] ?? null,
    saveLocalStorage: (k: string, v: unknown) => {
      store[k] = v;
    },
  };

  const plugin = Object.create(AtomsPlugin.prototype) as AtomsPlugin;
  Object.assign(plugin, {
    app,
    contextProvider: contextProviderFor(app as never),
    settings: {
      model: "claude-sonnet-5",
      activeVocabulary: ["idea"],
      atomFolder: "Atoms",
      enableHubProjection: false,
      proposedTags: [],
      plusBaseUrl: "https://plus.example",
    },
    autoRunInFlight: false,
    backfillInFlight: false,
    filingStartedAt: null,
    vaultIndexReady: true,
    lastWriteReport: null,
    getApiKey: () => opts.apiKey ?? null,
    saveSettings: async () => {},
    refreshAtomsHomeLeaves: async () => {},
    scheduleAskMirrorSync: () => {},
    hasOpenAtomsHome: () => false,
    landPeakFromWrite: () => null,
    finishHomeRun: () => {},
    // The checkout poll runs for real; a test must not sit through it.
    backfillTopUpPoll: { intervalMs: 0, attempts: 2 },
  });

  return { plugin, vault, store, notices, opened, svc };
}

const plusSession = (over: Partial<PlusSession> = {}): PlusSession => ({
  sessionToken: "sess_live",
  email: "a@b.co",
  status: "active",
  remaining: 150,
  periodEnd: dayBack(-20),
  ...over,
});

/** The modal currently on screen, or null. */
const openModal = (): Modal | null => Modal.open.at(-1) ?? null;

/**
 * Every gate the flow opened, in order, snapshotted while it was still on screen — `onClose`
 * empties `contentEl`, so a dismissed modal has nothing left to read.
 */
let gates: string[] = [];
const gate = (n = 0): string => gates[n] ?? "";
const lastGate = (): string => gates.at(-1) ?? "";

/** Click the CTA (confirm) or the plain (cancel) button of the open modal. */
function clickModal(which: "confirm" | "cancel"): void {
  const modal = openModal();
  if (!modal) throw new Error("no modal open");
  gates.push(modal.contentEl.textContent ?? "");
  const buttons = [...modal.contentEl.querySelectorAll("button")];
  const btn =
    which === "confirm"
      ? buttons.find((b) => b.classList.contains("mod-cta"))
      : buttons.find((b) => !b.classList.contains("mod-cta"));
  if (!btn) throw new Error(`no ${which} button`);
  btn.click();
}

/** Run the flow, driving each modal it opens with the queued verdicts. */
async function runFlow(
  plugin: AtomsPlugin,
  verdicts: Array<"confirm" | "cancel"> = [],
  source: "card" | "command" = "card",
): Promise<void> {
  const queue = [...verdicts];
  const done = plugin.runBackfillFlow(source);
  let settled = false;
  void done.then(() => {
    settled = true;
  });
  // Each turn: let the flow reach its next await, then answer whatever it opened. `Modal.open`
  // holds only what is on screen, so an answered gate leaves it before the next one arrives.
  for (let turn = 0; turn < 400 && !settled; turn += 1) {
    await new Promise((r) => setTimeout(r, 0));
    if (settled) break;
    if (openModal()) clickModal(queue.shift() ?? "cancel");
  }
  await done;
  // The BYOK branch opens its gate and returns — the batch runs from the confirm callback — so
  // a gate can still be on screen after the flow settles.
  if (openModal()) clickModal(queue.shift() ?? "cancel");
}

beforeEach(() => {
  notices.length = 0;
  gates = [];
  seam.countTokens = 0;
  Modal.open.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/* ================================================================= *
 * 1. The regression: a keyless Plus device reaches the flow at all
 * ================================================================= */

describe("the auth branch", () => {
  it("a Plus device with no API key reaches the gate instead of a key nag", async () => {
    const h = harness({
      files: { [`Daily/${dayBack(20)}.md`]: "- an old thought\n" },
      dailies: [{ path: `Daily/${dayBack(20)}.md`, date: dayBack(20) }],
      session: plusSession(),
      apiKey: null,
    });

    await runFlow(h.plugin, ["cancel"]);

    expect(notices.join(" ")).not.toContain("set your API key");
    // The gate opened, and it named filings rather than dollars.
    expect(lastGate()).toContain("filings");
  });

  it("a device with neither credential still gets the key nag", async () => {
    const h = harness({
      files: { [`Daily/${dayBack(20)}.md`]: "- an old thought\n" },
      dailies: [{ path: `Daily/${dayBack(20)}.md`, date: dayBack(20) }],
      session: null,
      apiKey: null,
    });

    await runFlow(h.plugin);

    expect(notices.join(" ")).toContain("set your API key");
  });
});

/* ================================================================= *
 * 2 + 3. The Plus run: budgeted range, no in-window capture
 * ================================================================= */

describe("the Plus engine", () => {
  /** 30 days of history, one capture a day, filing window opens 10 days back. */
  const history = () => {
    const files: Record<string, string> = {};
    const dailies: Array<{ path: string; date: string }> = [];
    for (let n = 1; n <= 30; n += 1) {
      const path = `Daily/${dayBack(n)}.md`;
      files[path] = `- thought from ${dayBack(n)}\n`;
      dailies.push({ path, date: dayBack(n) });
    }
    return { files, dailies };
  };

  it("files the budgeted range and never a capture inside the filing window", async () => {
    const h = harness({
      ...history(),
      session: plusSession(),
      // 150 left, 20 days of period → reserve 100 → budget 50, capped by the 20 dailies
      // outside the window.
      entitlement: { status: "active", remaining: 150, periodEnd: dayBack(-20) },
    });

    await runFlow(h.plugin, ["confirm"]);

    // 20 dailies sit strictly before the window start (10 days back); the 9 inside it belong
    // to auto-run and must not be touched.
    expect(h.svc.classified).toHaveLength(20);
    for (let n = 1; n <= 9; n += 1) {
      expect(h.vault.read(`Daily/${dayBack(n)}.md`)).not.toContain("<!--linker");
    }
    expect(h.vault.read(`Daily/${dayBack(11)}.md`)).toContain("<!--linker");
  });

  it("quotes the budgeted range, not the whole complement", async () => {
    const h = harness({
      ...history(),
      session: plusSession({ remaining: 60 }),
      // 60 left, 20 days → reserve 100 → budget 0 → nothing fits.
      entitlement: { status: "active", remaining: 160, periodEnd: dayBack(-2) },
    });

    await runFlow(h.plugin, ["cancel"]);

    // reserve = 2 days × 5 = 10 → budget = min(50, 150) = 50 → 20 dailies, 20 captures.
    expect(lastGate()).toContain("Files 20 captures");
    expect(lastGate()).not.toContain("Files 30 captures");
  });

  it("prices the offer with a meter read, never with a classify call", async () => {
    const h = harness({
      ...history(),
      session: plusSession(),
    });

    await runFlow(h.plugin, ["cancel"]);

    expect(h.svc.calls.some((u) => u.endsWith("/v1/me"))).toBe(true);
    expect(h.svc.classified).toHaveLength(0);
  });

  it("falls back to the baseline reserve when the refresh fails, and blocks no run", async () => {
    const h = harness({
      ...history(),
      // Cached session says 150 with a period end 20 days out; the read never lands.
      session: plusSession(),
      entitlement: null,
    });

    await runFlow(h.plugin, ["confirm"]);

    // Baseline reserve 100 → budget 50 → the same 20 dailies, and the run went ahead.
    expect(gate(0)).toContain("Files 20 captures");
    expect(h.svc.classified).toHaveLength(20);
  });

  it("halts on exhaustion, reports what filed, and resumes without double-filing", async () => {
    const h = harness({
      ...history(),
      session: plusSession(),
      meter: 3,
    });

    await runFlow(h.plugin, ["confirm"]);

    expect(h.svc.classified).toHaveLength(3);
    // A fourth capture was attempted, came back 402, and stopped the run instead of walking
    // the remaining 16 into doomed round-trips.
    expect(h.svc.attempts).toBe(4);
    expect(notices.join(" ")).toContain("filed 3 of 20");

    // Refill and re-run: the markers already on disk make the resume idempotent.
    h.svc.meter = 150;
    h.svc.classified.length = 0;
    Modal.open.length = 0;
    await runFlow(h.plugin, ["confirm"]);

    expect(h.svc.classified).toHaveLength(17);
  });
});

/* ================================================================= *
 * 4. KTD3 — the toggle decides what the complement is
 * ================================================================= */

describe("the complement bound (KTD3)", () => {
  it("covers all past captures when auto-filing is off", async () => {
    const h = harness({
      files: {
        [`Daily/${dayBack(2)}.md`]: "- a recent thought\n",
        [`Daily/${dayBack(20)}.md`]: "- an old thought\n",
      },
      dailies: [
        { path: `Daily/${dayBack(2)}.md`, date: dayBack(2) },
        { path: `Daily/${dayBack(20)}.md`, date: dayBack(20) },
      ],
      session: plusSession(),
      // Disabling preserves the start day (KTD6); with the toggle off it is ignored.
      filing: { enabled: false, startDay: dayBack(10) },
    });

    await runFlow(h.plugin, ["confirm"]);

    expect(h.svc.classified).toHaveLength(2);
    expect(h.vault.read(`Daily/${dayBack(2)}.md`)).toContain("<!--linker");
  });

  it("stops at the window start when auto-filing is on", async () => {
    const h = harness({
      files: {
        [`Daily/${dayBack(2)}.md`]: "- a recent thought\n",
        [`Daily/${dayBack(20)}.md`]: "- an old thought\n",
      },
      dailies: [
        { path: `Daily/${dayBack(2)}.md`, date: dayBack(2) },
        { path: `Daily/${dayBack(20)}.md`, date: dayBack(20) },
      ],
      session: plusSession(),
      filing: { enabled: true, startDay: dayBack(10) },
    });

    await runFlow(h.plugin, ["confirm"]);

    expect(h.svc.classified).toHaveLength(1);
    expect(h.vault.read(`Daily/${dayBack(2)}.md`)).not.toContain("<!--linker");
  });
});

/* ================================================================= *
 * 5. In-flight, both directions
 * ================================================================= */

describe("in-flight guards", () => {
  const oneDay = () => ({
    files: { [`Daily/${dayBack(20)}.md`]: "- an old thought\n" },
    dailies: [{ path: `Daily/${dayBack(20)}.md`, date: dayBack(20) }],
  });

  it("the Plus backfill refuses to start while auto-run holds its flag", async () => {
    const h = harness({ ...oneDay(), session: plusSession() });
    (h.plugin as unknown as { autoRunInFlight: boolean }).autoRunInFlight = true;

    await runFlow(h.plugin, ["confirm"]);

    expect(h.svc.classified).toHaveLength(0);
    expect(openModal()).toBeNull();
  });

  it("refuses a second tap while the first flow is parked at the gate", async () => {
    const h = harness({ ...oneDay(), session: plusSession() });
    // The scan is the expensive half of the offer, so it is what a duplicate flow must not repeat.
    const scan = vi.spyOn(
      h.plugin as unknown as { backfillComplement: () => Promise<unknown> },
      "backfillComplement",
    );

    const first = h.plugin.runBackfillFlow("card");
    for (let turn = 0; turn < 50 && !openModal(); turn += 1) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(openModal()).not.toBeNull();

    const meterReads = () =>
      h.svc.calls.filter((u) => u.endsWith("/v1/me")).length;
    const metersBefore = meterReads();
    const scansBefore = scan.mock.calls.length;

    // The second tap — home's card is still on screen and still tappable.
    let secondSettled = false;
    const second = h.plugin.runBackfillFlow("card");
    void second.then(() => {
      secondSettled = true;
    });
    for (let turn = 0; turn < 20; turn += 1) {
      await new Promise((r) => setTimeout(r, 0));
    }

    // It was refused, not queued: no second scan, no second meter read, no second gate.
    expect(secondSettled).toBe(true);
    expect(notices.join(" ")).toContain("backfill already in progress");
    expect(scan.mock.calls.length).toBe(scansBefore);
    expect(meterReads()).toBe(metersBefore);
    expect(Modal.open).toHaveLength(1);

    clickModal("cancel");
    await Promise.all([first, second]);
  });

  it("auto-run refuses to start while the backfill holds its flag", async () => {
    const h = harness({ ...oneDay(), session: plusSession() });
    (h.plugin as unknown as { backfillInFlight: boolean }).backfillInFlight =
      true;

    const outcome = await h.plugin.maybeAutoRun("interval");

    expect(outcome).toEqual({ ran: false, reason: "in_flight" });
  });
});

/* ================================================================= *
 * 6. Top-up re-derives rather than re-showing
 * ================================================================= */

describe("the over-budget top-up", () => {
  /** One daily far bigger than any budget — the worst version of the dead end. */
  const oversized = () => {
    const lines = Array.from({ length: 80 }, (_, i) => `- thought ${i}`).join(
      "\n",
    );
    return {
      files: { [`Daily/${dayBack(20)}.md`]: `${lines}\n` },
      dailies: [{ path: `Daily/${dayBack(20)}.md`, date: dayBack(20) }],
    };
  };

  it("offers filings instead of an empty offer when nothing fits", async () => {
    const h = harness({
      ...oversized(),
      session: plusSession({ remaining: 120 }),
      entitlement: { status: "active", remaining: 120, periodEnd: dayBack(-20) },
    });

    await runFlow(h.plugin, ["cancel"]);

    expect(lastGate()).toContain("nothing files right now");
  });

  it("re-derives the offer after the top-up lands, never re-shows the stale one", async () => {
    const h = harness({
      ...oversized(),
      // 120 left, reserve 100 → budget 20 → the 80-capture daily does not fit.
      session: plusSession({ remaining: 120 }),
      entitlement: { status: "active", remaining: 120, periodEnd: dayBack(-20) },
    });
    // The top-up lands between the checkout call and the next meter read.
    let meCalls = 0;
    const original = h.svc.entitlement;
    Object.defineProperty(h.svc, "entitlement", {
      get: () => {
        meCalls += 1;
        return meCalls > 1
          ? { status: "active", remaining: 200, periodEnd: dayBack(-20) }
          : original;
      },
    });

    // Round one: "Get more filings". Round two must be the re-derived, affordable offer.
    await runFlow(h.plugin, ["confirm", "cancel"]);

    expect(h.opened).toContain("https://checkout.example/session");
    // 200 left, reserve 100 → budget 50, so the 80-capture daily still does not fit —
    // but the numbers on screen came from the *new* meter, not the old one.
    expect(meCalls).toBeGreaterThan(1);
  });
});

/* ================================================================= *
 * 7. BYOK keeps its engine, and takes the same cap
 * ================================================================= */

describe("the BYOK branch", () => {
  /** 30 dailies × 3 captures = 90 outside the window; the per-run cap is 50. */
  const bigHistory = () => {
    const files: Record<string, string> = {};
    const dailies: Array<{ path: string; date: string }> = [];
    for (let n = 11; n <= 40; n += 1) {
      const path = `Daily/${dayBack(n)}.md`;
      files[path] = "- one\n- two\n- three\n";
      dailies.push({ path, date: dayBack(n) });
    }
    return { files, dailies };
  };

  /** BYOK prices through `count_tokens`; nothing on this branch may reach the Plus service. */
  const refusePlus = () =>
    vi.stubGlobal("fetch", async () => {
      throw new Error("BYOK must not touch the Plus service");
    });

  it("caps the card's range and takes it recent-first", async () => {
    const h = harness({ ...bigHistory(), session: null, apiKey: "sk-test" });
    refusePlus();

    await runFlow(h.plugin, ["cancel"], "card");

    // 50 / 3 = 16 whole dailies = 48 captures, newest first (day 11 back is the newest).
    expect(lastGate()).toContain("Captures: 48");
    expect(seam.countTokens).toBeGreaterThan(0);
  });

  it("leaves the command unbounded — the escape hatch past the cap", async () => {
    const h = harness({ ...bigHistory(), session: null, apiKey: "sk-test" });
    refusePlus();

    await runFlow(h.plugin, ["cancel"], "command");

    // The whole complement, not the card's 48. Capping this is a capability regression:
    // it is the only path a BYOK user has to file a history bigger than one run.
    expect(lastGate()).toContain("Captures: 90");
    expect(lastGate()).not.toContain("Captures: 48");
  });

  it("does not let the command unbind Plus", async () => {
    const files: Record<string, string> = {};
    const dailies: Array<{ path: string; date: string }> = [];
    for (let n = 11; n <= 40; n += 1) {
      const path = `Daily/${dayBack(n)}.md`;
      files[path] = "- one\n- two\n- three\n";
      dailies.push({ path, date: dayBack(n) });
    }
    const h = harness({ files, dailies, session: plusSession() });

    // Same command entry, but a metered device: spending a whole period's allowance on
    // years-old notes is exactly what the budget exists to prevent, so the source buys nothing.
    await runFlow(h.plugin, ["confirm"], "command");

    // 150 left, 20 days → reserve 100 → budget 50 → 16 dailies × 3 = 48 captures.
    expect(lastGate()).toContain("Files 48 captures");
    expect(h.svc.classified).toHaveLength(48);
  });
});
