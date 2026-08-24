import { AtomsHomeView } from "../../src/home/atomsHomeView";

/**
 * Raise Atoms home's "turn on automatic filing" consent, the way a tap on the filing card does.
 *
 * Driven off the prototype with a two-field stub rather than a standing `AtomsHomeView`. That is
 * deliberate: `confirmEnableAutomaticFiling` reads `this.app` and `this.plugin` and nothing else,
 * and the alternative is a full `ItemView` + `AtomsPlugin` harness for a claim about four lines.
 *
 * `onEnable` stands in for `enableAutomaticFilingFromHome` — the device-local ack write. Callers
 * decide what to observe through it: a marker that the accept fired, or the real writes.
 */
export function raiseHomeConsent(onEnable: () => void): void {
  const view = Object.create(AtomsHomeView.prototype) as {
    app: unknown;
    plugin: unknown;
    confirmEnableAutomaticFiling(): void;
  };
  view.app = {};
  view.plugin = {
    enableAutomaticFilingFromHome: async () => {
      onEnable();
    },
  };
  view.confirmEnableAutomaticFiling();
}

/**
 * Drive Atoms home's backfill offer card off the prototype, the way `raiseHomeConsent` above
 * drives the filing consent: the card's four methods read `this.app`, `this.plugin` and
 * `this.backfillDailies` and nothing else, and a full `ItemView` + `AtomsPlugin` harness would be
 * a lot of scaffolding for claims about what the card shows and what it writes.
 *
 * `store` is the device-local key/value space. `writes` records every key the card saves to, so a
 * test can assert that merely rendering wrote nothing.
 */
export interface BackfillHomeHarness {
  store: Record<string, unknown>;
  writes: string[];
  runs: number;
  /** Re-render requests. The card's release path has to redraw, not just poke its old button. */
  renders: number;
  model(): { title: string; body: string; meter: string; primary: string; dismiss: string } | null;
  press(): void;
  dismiss(): void;
}

export function backfillHome(opts: {
  auth: unknown;
  dailies?: Array<{ date: string; path: string; unprocessedCount: number }>;
  store?: Record<string, unknown>;
}): BackfillHomeHarness {
  const store: Record<string, unknown> = { ...(opts.store ?? {}) };
  const writes: string[] = [];
  const harness = { store, writes, runs: 0, renders: 0 } as BackfillHomeHarness;
  const view = Object.create(AtomsHomeView.prototype) as Record<string, unknown>;
  view.app = {
    loadLocalStorage: (k: string) => store[k] ?? null,
    saveLocalStorage: (k: string, v: unknown) => {
      writes.push(k);
      // Obsidian drops falsy values, and the ack's cleared shape depends on that.
      if (v) store[k] = v;
      else delete store[k];
    },
  };
  view.plugin = {
    resolveFilingAuth: () => opts.auth,
    runBackfillFromHome: async () => {
      harness.runs += 1;
    },
  };
  view.backfillDailies = opts.dailies ?? [];
  view.busy = false;
  view.render = () => {
    harness.renders += 1;
  };

  const call = <T>(name: string): T =>
    (view[name] as () => T).call(view);
  // The view resolves filing auth once per render pass and hands it down, so the harness plays
  // that part rather than letting the card read it a second time.
  harness.model = () =>
    (
      view.backfillOfferModel as (
        auth: unknown,
      ) => ReturnType<BackfillHomeHarness["model"]>
    ).call(view, opts.auth);
  harness.press = () => call("startBackfillFromCard");
  harness.dismiss = () => call("dismissBackfillOffer");
  return harness;
}

export type HomeOpenFixture =
  | {
      kind: "atom";
      path: string;
      title: string;
      body: string;
      lines: [];
      alsoAbout: null;
    }
  | {
      kind: "entity-siblings";
      backPath: string | null;
      label: string;
      siblings: Array<{ path: string; title: string; sourceDate: string | null }>;
    }
  | {
      kind: "mind-change-pair";
      thenPath: string;
      thenBody: string;
      nowPath: string;
      nowTitle: string;
      nowBody: string;
      relation: "revises";
      interactionNoted: boolean;
    };

export interface HomeOccupancyOpts {
  unprocessedCount?: number;
  windowUnprocessedCount?: number;
  loopCloseOffer?: {
    loopPath: string;
    loopTitle: string;
    loopBody: string;
    readingPath: string;
    readingBody: string;
  } | null;
  autoRun?: {
    enabled?: boolean;
    egressAcked?: boolean;
    hasKey?: boolean;
    inFlight?: boolean;
  };
  filingAuth?: { mode: string; status?: string };
}

export interface RenderedHomeHarness {
  root: HTMLElement;
  setOpen(open: HomeOpenFixture | null): void;
  setOccupancy(opts: HomeOccupancyOpts): void;
  render(): void;
  refresh(): Promise<void>;
}

/**
 * Render the real Atoms home view with only the state its DOM pass reads.
 *
 * Unlike the focused prototype-based consent and backfill harnesses above, this constructs a real
 * `AtomsHomeView`. The production `render()`, `refresh()`, atom loader, and detail Back callbacks
 * still build and redraw the DOM; only `loadData()` is replaced so refresh remains read-only.
 */
export function renderedHomeView(): RenderedHomeHarness {
  const root = document.createElement("div");
  const originPath = "Atoms/Origin atom.md";
  const originContent = `---
created: 2026-08-18
source: "[[2026-08-18]]"
generated-by: linker
tags: []
---
Origin body
`;
  let autoRun = {
    enabled: false,
    egressAcked: false,
    hasKey: false,
    inFlight: false,
  };
  let filingAuth: { mode: string; status?: string } = { mode: "none" };
  const plugin = {
    settings: {
      atomFolder: "Atoms",
      captureShortcutInstallUrl: "",
      enableHubProjection: false,
    },
    getAutoRunSnapshot: () => autoRun,
    getBacklogGatePending: () => 0,
    getLastCatchupLine: () => null,
    isEgressNoticePending: () => false,
    resolveFilingAuth: () => filingAuth,
  };
  const view = new AtomsHomeView(
    undefined as never,
    plugin as never,
  ) as unknown as Record<string, unknown>;

  Object.assign(view, {
    app: {
      loadLocalStorage: () => null,
      saveLocalStorage: () => {},
      vault: {
        getMarkdownFiles: () => [],
      },
    },
    atomFileInputs: [
      {
        path: originPath,
        content: originContent,
        mtime: 0,
      },
    ],
    rootEl: root,
  });

  const render = () => {
    (view.render as () => void).call(view);
  };
  view.loadData = async () => {};
  const refresh = async () => {
    await (view.refresh as () => Promise<void>).call(view);
  };

  return {
    root,
    setOpen: (open) => {
      view.homeOpen = open;
    },
    setOccupancy: (opts) => {
      if (opts.unprocessedCount != null) {
        view.unprocessedCount = opts.unprocessedCount;
      }
      if (opts.windowUnprocessedCount != null) {
        view.windowUnprocessedCount = opts.windowUnprocessedCount;
      }
      if (opts.loopCloseOffer !== undefined) {
        view.loopCloseOffer = opts.loopCloseOffer;
      }
      if (opts.autoRun) {
        autoRun = { ...autoRun, ...opts.autoRun };
      }
      if (opts.filingAuth) {
        filingAuth = opts.filingAuth;
      }
    },
    render,
    refresh,
  };
}
