import { beforeEach, describe, expect, it, vi } from "vitest";
import { AskCoordinator, fireAndForgetAsk } from "../src/plugin/askCoordinator";
import { DEFAULT_SETTINGS } from "../src/shared/types";
import { stripLegacyAskMirrorHashes } from "../src/platform/askMirror";
import type {
  AskMirrorHost,
  ConfirmRequest,
} from "../src/platform/askMirror";

/** Modals the coordinator opened, newest last. */
const openedModals: FakeConfirmModal[] = [];

class FakeConfirmModal {
  opened = false;
  closed = false;
  constructor(
    readonly app: unknown,
    readonly request: ConfirmRequest,
    private readonly onVerdict: (verdict: string) => void,
  ) {
    openedModals.push(this);
  }
  open(): void {
    this.opened = true;
  }
  close(): void {
    // Mirrors the real modal: closing without choosing is a dismissal.
    this.closed = true;
    this.onVerdict("dismissed");
  }
}

/** The host object the coordinator handed to runAskMirrorSync. */
let capturedHost: AskMirrorHost | null = null;

vi.mock("../src/platform/filingAuth", () => ({
  readPlusSession: () => ({ sessionToken: "test-token" }),
}));

vi.mock("../src/platform/plusClient", () => ({
  DEFAULT_PLUS_BASE_URL: "https://plus.example",
  plusFetchRequest: async () => ({ ok: true }),
  askMirrorUpsert: async () => ({ ok: true }),
  askMirrorDelete: async () => ({ ok: true }),
  askMirrorReconcile: async () => ({ ok: true }),
  askMirrorStatus: async () => ({ ok: true, count: 0 }),
  askOutboxPull: async () => ({ ok: true, items: [] }),
  askOutboxAck: async () => ({ ok: true }),
}));

vi.mock("../src/settings/settings", () => ({
  AskMirrorDeleteConfirmModal: FakeConfirmModal,
}));

vi.mock("../src/platform/askMirror", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/platform/askMirror")>();
  return {
    ...actual,
    runAskMirrorSync: async (host: AskMirrorHost) => {
      capturedHost = host;
      return { kind: "ok", uploaded: 0, deleted: 0, scanned: 0 };
    },
  };
});

function makeCoordinator(): AskCoordinator {
  const plugin = {
    app: {
      vault: { getMarkdownFiles: () => [], read: async () => "" },
      metadataCache: { getFirstLinkpathDest: () => null },
      loadLocalStorage: () => null,
      saveLocalStorage: () => undefined,
    },
    settings: {
      ...DEFAULT_SETTINGS,
      askEnabled: true,
      askPrivacyAckAt: "2026-08-04T00:00:00.000Z",
      plusBaseUrl: "",
    },
    refreshAtomsHomeLeaves: async () => undefined,
  };
  return new AskCoordinator(plugin as never);
}

describe("askCoordinator glue (post-#226 residual peel)", () => {
  it("fireAndForgetAsk never rejects to Process caller", async () => {
    let callerFailed = false;
    try {
      fireAndForgetAsk(Promise.reject(new Error("mirror down")));
      await new Promise((r) => setTimeout(r, 0));
    } catch {
      callerFailed = true;
    }
    expect(callerFailed).toBe(false);
  });

  it("U6 already landed: DEFAULT_SETTINGS has no askMirrorHashes", () => {
    expect(DEFAULT_SETTINGS).not.toHaveProperty("askMirrorHashes");
  });

  it("U6 strip still clears legacy key from raw settings blob", () => {
    const raw: Record<string, unknown> = {
      askEnabled: true,
      askMirrorHashes: { "Atoms/A.md": "h1" },
    };
    expect(stripLegacyAskMirrorHashes(raw)).toBe(true);
    expect(raw).not.toHaveProperty("askMirrorHashes");
  });
});

// The gate's confirm-withdrawal fix (#248) is inert unless the *real* host
// implements cancelConfirm — the fake host in askMirrorGate.adversarial.test.ts
// cannot catch a peel that drops the wiring. This locks the production object.
describe("askCoordinator mirror host: confirm dialog withdrawal", () => {
  beforeEach(() => {
    openedModals.length = 0;
    capturedHost = null;
  });

  it("exposes cancelConfirm on the host it hands to runAskMirrorSync", async () => {
    await makeCoordinator().sync({ force: true });
    expect(capturedHost).not.toBeNull();
    expect(typeof capturedHost?.cancelConfirm).toBe("function");
  });

  it("cancelConfirm closes the modal that confirm opened", async () => {
    await makeCoordinator().sync({ force: true });
    const host = capturedHost!;
    const request: ConfirmRequest = {
      kind: "ask-mirror-deletion",
      evidenceCount: 400,
      scannedCount: 400,
      lastKnownServerCount: 400,
      reason: "scan-incomplete",
    };

    const verdict = host.confirm(request);
    expect(openedModals).toHaveLength(1);
    expect(openedModals[0]!.opened).toBe(true);

    host.cancelConfirm!();

    expect(openedModals[0]!.closed).toBe(true);
    // A withdrawn dialog must settle as "leave the mirror untouched".
    await expect(verdict).resolves.toBe("dismissed");
  });

  it("cancelConfirm is a no-op when no dialog is open", async () => {
    await makeCoordinator().sync({ force: true });
    expect(() => capturedHost!.cancelConfirm!()).not.toThrow();
    expect(openedModals).toHaveLength(0);
  });
});
