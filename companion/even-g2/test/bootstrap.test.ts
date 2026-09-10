import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bridge: {
    getLocalStorage: vi.fn(),
    setLocalStorage: vi.fn(),
    onEvenHubEvent: vi.fn(),
    shutDownPageContainer: vi.fn(),
  },
  renderGlasses: vi.fn(),
  renderPhone: vi.fn(),
  restoreSession: vi.fn(),
  httpPost: vi.fn(),
  createApi: undefined as Record<string, (...args: unknown[]) => unknown> | undefined,
  controllerStart: vi.fn(),
  controllerAudioInputFailed: vi.fn(async () => undefined),
  controllerDependencies: undefined as Record<string, unknown> | undefined,
  removeEvents: vi.fn(),
  eventHandler: undefined as ((event: unknown) => void) | undefined,
  audioAccept: vi.fn(),
}));

vi.mock("@evenrealities/even_hub_sdk", async (importOriginal) => ({
  ...await importOriginal<typeof import("@evenrealities/even_hub_sdk")>(),
  waitForEvenAppBridge: vi.fn(async () => mocks.bridge),
}));
vi.mock("../src/auth/credentials", () => ({
  G2CredentialVault: class { async createOrLoadProofKey() {} },
}));
vi.mock("../src/auth/client", () => ({
  G2AuthClient: class {
    restore = mocks.restoreSession;
    current = vi.fn();
    pair = vi.fn();
  },
  G2HttpClient: class { post = mocks.httpPost; },
}));
vi.mock("../src/auth/setup", () => ({
  G2_DISCLOSURE_VERSION: "g2-capture-relay-v1",
  readG2ServerSetup: vi.fn(async () => ({
    revision: 1,
    g2Disclosure: { granted: true, version: "g2-capture-relay-v1" },
    askMirror: { granted: true, version: "2026-08-07" },
    askWrite: { granted: true, version: "2026-09-08" },
  })),
  g2ServerSetupReady: vi.fn(() => true),
}));
vi.mock("../src/ui/render", () => ({
  EvenGlassesRenderer: class { render = mocks.renderGlasses; },
}));
vi.mock("../src/ui/phone", () => ({ renderPhone: mocks.renderPhone }));
vi.mock("../src/storage/appRecovery", () => ({
  AppRecoveryStore: class { async open() {} },
}));
vi.mock("../src/storage/recovery", () => ({
  RecoveryJournal: class { async open() {} },
}));
vi.mock("../src/platform/audio", () => ({
  ticketFromResponse: vi.fn(),
  EvenAudioSession: class {
    async restore() { return false; }
    async start() {}
    async stop() { return undefined; }
    async teardown() {}
    accept() {}
  },
}));
vi.mock("../src/audio/localTranscriber", () => ({ LocalTranscriber: class {} }));
vi.mock("../src/audio/moonshineWorker", () => ({ MoonshineWorkerClient: class {} }));
vi.mock("../src/platform/localAudio", () => ({
  EvenLocalAudioSession: class {
    async initialize() {}
    async start() {}
    async stop() { return undefined; }
    async teardown() {}
    accept = mocks.audioAccept;
  },
}));
vi.mock("../src/app/controller", () => ({
  G2AppController: class {
    constructor(dependencies: Record<string, unknown>) { mocks.controllerDependencies = dependencies; }
    start = mocks.controllerStart;
    handle = vi.fn();
    systemEvent = vi.fn();
    audioInputFailed = mocks.controllerAudioInputFailed;
  },
}));
vi.mock("../src/app/createFlow", () => ({
  CreateFlow: class {
    constructor(api: Record<string, (...args: unknown[]) => unknown>) { mocks.createApi = api; }
  },
}));
vi.mock("../src/app/queryFlow", () => ({ QueryFlow: class {} }));
vi.mock("../src/app/readFlow", () => ({ ReadFlow: class {} }));

import { markBridgeUnavailable, startG2Companion } from "../src/bootstrap";
import { waitForEvenAppBridge } from "@evenrealities/even_hub_sdk";

describe("G2 companion bootstrap", () => {
  const status = { dataset: {} as Record<string, string>, textContent: "" };

  beforeEach(() => {
    vi.clearAllMocks();
    status.dataset = {};
    status.textContent = "";
    mocks.controllerDependencies = undefined;
    mocks.createApi = undefined;
    mocks.eventHandler = undefined;
    mocks.bridge.getLocalStorage.mockImplementation(async (key: string) => key === "atoms-g2-binding" ? "" : "");
    mocks.bridge.onEvenHubEvent.mockImplementation((handler: (event: unknown) => void) => {
      mocks.eventHandler = handler;
      return mocks.removeEvents;
    });
    vi.stubGlobal("document", { querySelector: vi.fn(() => status) });
    vi.stubGlobal("location", { origin: "evenhub://app.tryatoms.g2" });
  });

  it("fails closed before acquiring the bridge when recovery is blocked", async () => {
    await startG2Companion("https://plus.tryatoms.app", async () => ({
      state: "blocked",
      reason: "capacity-insufficient",
      bearerFallback: false,
    }));

    expect(status.dataset).toEqual({ state: "blocked", reason: "capacity-insufficient" });
    expect(status.textContent).toBe("Atoms could not start on this phone.");
    expect(waitForEvenAppBridge).not.toHaveBeenCalled();
  });

  it("renders a visible failure when the capability probe throws", async () => {
    await expect(startG2Companion("https://plus.tryatoms.app", async () => {
      throw new Error("storage failure");
    })).resolves.toBeUndefined();

    expect(status.dataset).toEqual({ state: "blocked", reason: "probe-failed" });
    expect(status.textContent).toBe("Atoms could not start on this phone.");
    expect(waitForEvenAppBridge).not.toHaveBeenCalled();
  });

  it("renders the unpaired state when there is no valid binding", async () => {
    await startG2Companion("https://plus.tryatoms.app", async () => ({
      state: "ready", blobPersistence: "encrypted", keyPersistence: "non-extractable", reservedBytes: 1, purged: true,
    }));

    expect(mocks.renderGlasses).toHaveBeenCalledWith({ screen: "unpaired", selectedIndex: 0 });
    expect(mocks.renderPhone).toHaveBeenCalledWith(status, {
      screen: "unpaired",
      origin: "evenhub://app.tryatoms.g2",
    }, expect.any(Object));
  });

  it("returns to pairing when a host restart keeps the pointer but loses the credential key", async () => {
    mocks.bridge.getLocalStorage.mockImplementation(async (key: string) => key === "atoms-g2-binding"
      ? JSON.stringify({ accountId: "acct", deviceFamilyId: "g2" })
      : "");
    mocks.restoreSession.mockResolvedValue(null);

    await startG2Companion("https://plus.tryatoms.app", async () => ({
      state: "ready", blobPersistence: "encrypted", keyPersistence: "non-extractable", reservedBytes: 1, purged: true,
    }));

    expect(mocks.renderGlasses).toHaveBeenCalledWith({ screen: "unpaired", selectedIndex: 0 });
    expect(mocks.renderPhone).toHaveBeenCalledWith(status, {
      screen: "unpaired",
      origin: "evenhub://app.tryatoms.g2",
    }, expect.any(Object));
  });

  it("boots a restored session and exposes subscription cleanup to the controller", async () => {
    const session = { accountId: "acct", deviceFamilyId: "g2", accessToken: "g2a_token", expiresAt: Date.now() + 60_000, scopes: ["g2:capture"] };
    mocks.bridge.getLocalStorage.mockImplementation(async (key: string) => key === "atoms-g2-binding"
      ? JSON.stringify({ accountId: "acct", deviceFamilyId: "g2" })
      : "");
    mocks.restoreSession.mockResolvedValue(session);

    await startG2Companion("https://plus.tryatoms.app", async () => ({
      state: "ready", blobPersistence: "encrypted", keyPersistence: "non-extractable", reservedBytes: 1, purged: true,
    }));

    expect(mocks.bridge.onEvenHubEvent).toHaveBeenCalledOnce();
    expect(mocks.controllerStart).toHaveBeenCalledWith({ paired: true, setupReady: true, recoveredRecording: false });
    expect(mocks.renderPhone).toHaveBeenCalledWith(status, { screen: "ready" }, expect.any(Object));
    await mocks.createApi?.enqueue?.({ captureId: "rec_local", capturedAt: "2026-09-10T18:00:00.000Z", body: "exact local transcript" });
    expect(mocks.httpPost).toHaveBeenCalledWith("/v1/g2/captures", expect.objectContaining({
      captureId: "rec_local",
      capturedAt: "2026-09-10T18:00:00.000Z",
      body: "exact local transcript",
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    await (mocks.controllerDependencies?.render as (state: unknown) => Promise<void>)({
      screen: "confirmation",
      title: "Local thought",
      transcript: "Review these exact words",
      selectedIndex: 0,
    });
    expect(mocks.renderPhone).toHaveBeenCalledWith(status, {
      screen: "review",
      title: "Local thought",
      transcript: "Review these exact words",
    }, expect.any(Object));
    (mocks.controllerDependencies?.unsubscribe as () => void)();
    expect(mocks.removeEvents).toHaveBeenCalledOnce();
  });

  it("returns an older pairing without g2:capture scope to Connect", async () => {
    const session = { accountId: "acct", deviceFamilyId: "g2", accessToken: "g2a_token", expiresAt: Date.now() + 60_000, scopes: ["g2:status"] };
    mocks.bridge.getLocalStorage.mockImplementation(async (key: string) => key === "atoms-g2-binding"
      ? JSON.stringify({ accountId: "acct", deviceFamilyId: "g2" })
      : "");
    mocks.restoreSession.mockResolvedValue(session);

    await startG2Companion("https://plus.tryatoms.app", async () => ({
      state: "ready", blobPersistence: "encrypted", keyPersistence: "non-extractable", reservedBytes: 1, purged: true,
    }));

    expect(mocks.controllerStart).not.toHaveBeenCalled();
    expect(mocks.renderGlasses).toHaveBeenCalledWith({ screen: "unpaired", selectedIndex: 0 });
    expect(mocks.renderPhone).toHaveBeenCalledWith(status, {
      screen: "unpaired", origin: "evenhub://app.tryatoms.g2",
    }, expect.any(Object));
  });

  it("contains a synchronous PCM ingestion failure and hands it to the controller", async () => {
    const session = { accountId: "acct", deviceFamilyId: "g2", accessToken: "g2a_token", expiresAt: Date.now() + 60_000, scopes: ["g2:capture"] };
    mocks.bridge.getLocalStorage.mockImplementation(async (key: string) => key === "atoms-g2-binding"
      ? JSON.stringify({ accountId: "acct", deviceFamilyId: "g2" })
      : "");
    mocks.restoreSession.mockResolvedValue(session);
    mocks.audioAccept.mockImplementation(() => { throw new Error("worker_backpressure"); });
    await startG2Companion("https://plus.tryatoms.app", async () => ({
      state: "ready", blobPersistence: "encrypted", keyPersistence: "non-extractable", reservedBytes: 1, purged: true,
    }));

    expect(() => mocks.eventHandler?.({ audioEvent: { audioPcm: new Uint8Array([1, 0]) } })).not.toThrow();
    await vi.waitFor(() => expect(mocks.controllerAudioInputFailed).toHaveBeenCalledWith(
      expect.objectContaining({ message: "worker_backpressure" }),
    ));
  });

  it("marks the rendered status when the bridge is unavailable", () => {
    markBridgeUnavailable();
    expect(status.dataset).toEqual({ state: "blocked", reason: "bridge-unavailable" });
    expect(status.textContent).toBe("Atoms could not start on this phone.");
  });
});
