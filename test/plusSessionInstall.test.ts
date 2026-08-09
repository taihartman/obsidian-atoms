import { describe, expect, it } from "vitest";
import {
  LS_PLUS_SESSION,
  readPlusSession,
  serializePlusSession,
  type PlusSession,
} from "../src/platform/filingAuth";
import {
  LS_ASK_MIRROR_EMAIL,
  LS_ASK_MIRROR_HASHES,
  plusSessionIdentityChanged,
  readAskMirrorEmail,
} from "../src/platform/askMirror";
import { installPlusSession } from "../src/platform/plusSessionInstall";
import { askMirrorPermitted } from "../src/shared/askAck";
import { DEFAULT_SETTINGS, type LinkerSettings } from "../src/shared/types";

const A: PlusSession = {
  sessionToken: "sess_a",
  email: "a@tryatoms.test",
  status: "active",
  periodEnd: "2026-09-01T00:00:00.000Z",
};

const B: PlusSession = {
  sessionToken: "sess_b",
  email: "b@tryatoms.test",
  status: "active",
  periodEnd: "2026-09-01T00:00:00.000Z",
};

function host(seed?: {
  session?: PlusSession | null;
  mirrorEmail?: string;
  hashes?: string;
  askEnabled?: boolean;
}) {
  const local = new Map<string, unknown>();
  if (seed?.session) {
    local.set(LS_PLUS_SESSION, serializePlusSession(seed.session));
  }
  if (seed?.mirrorEmail != null) {
    local.set(LS_ASK_MIRROR_EMAIL, seed.mirrorEmail);
  }
  if (seed?.hashes != null) {
    local.set(LS_ASK_MIRROR_HASHES, seed.hashes);
  }
  const settings: LinkerSettings = {
    ...DEFAULT_SETTINGS,
    askEnabled: seed?.askEnabled ?? true,
    askPrivacyAckAt: "2026-08-07T10:00:00.000Z",
    askPrivacyAckVersion: "2026-08-07",
  };
  const cancels: string[] = [];
  return {
    settings,
    cancels,
    local,
    host: {
      settings,
      saveSettings: async () => {},
      mirrorPermitted: () => askMirrorPermitted(settings),
      cancelPendingSync: () => {
        cancels.push("cancel");
      },
      saveLocalStorage: (k: string, v: string) => {
        local.set(k, v);
      },
      loadLocalStorage: (k: string) => local.get(k) ?? null,
    },
  };
}

describe("plusSessionIdentityChanged", () => {
  it("is true when the prior session email differs", () => {
    expect(plusSessionIdentityChanged("a@x.test", "", "b@x.test")).toBe(true);
  });

  it("is true when only the residual mirror email differs (lapsed session)", () => {
    expect(plusSessionIdentityChanged(null, "a@x.test", "b@x.test")).toBe(true);
  });

  it("is false for same-account re-auth", () => {
    expect(
      plusSessionIdentityChanged("a@x.test", "a@x.test", "A@x.test"),
    ).toBe(false);
  });

  it("is false when there is no prior identity", () => {
    expect(plusSessionIdentityChanged(null, "", "fresh@x.test")).toBe(false);
  });
});

describe("#393 installPlusSession", () => {
  it("disarms and clears baseline when a different account signs in without Sign out", async () => {
    const made = host({
      session: A,
      mirrorEmail: "a@tryatoms.test",
      hashes: JSON.stringify({ "Atoms/a.md": "h1" }),
      askEnabled: true,
    });

    const outcome = await installPlusSession(made.host, B);

    expect(outcome).toBe("disarmed");
    expect(made.settings.askEnabled).toBe(false);
    expect(made.local.get(LS_ASK_MIRROR_HASHES)).toBe("{}");
    expect(readAskMirrorEmail((k) => made.local.get(k) ?? null)).toBe("");
    expect(readPlusSession(made.host)?.email).toBe("b@tryatoms.test");
    expect(made.cancels).toEqual(["cancel"]);
  });

  it("disarms from residual mirror email alone when the prior session has lapsed", async () => {
    const made = host({
      session: null,
      mirrorEmail: "a@tryatoms.test",
      hashes: JSON.stringify({ "Atoms/a.md": "h1" }),
      askEnabled: true,
    });

    const outcome = await installPlusSession(made.host, B);

    expect(outcome).toBe("disarmed");
    expect(made.settings.askEnabled).toBe(false);
    expect(made.local.get(LS_ASK_MIRROR_HASHES)).toBe("{}");
    expect(readPlusSession(made.host)?.email).toBe("b@tryatoms.test");
  });

  it("keeps the baseline on same-account re-auth", async () => {
    const hashes = JSON.stringify({ "Atoms/a.md": "h1" });
    const made = host({
      session: A,
      mirrorEmail: "a@tryatoms.test",
      hashes,
      askEnabled: true,
    });

    const outcome = await installPlusSession(made.host, {
      ...A,
      sessionToken: "sess_a_new",
    });

    expect(outcome).toBe("kept");
    expect(made.settings.askEnabled).toBe(true);
    expect(made.local.get(LS_ASK_MIRROR_HASHES)).toBe(hashes);
    expect(readPlusSession(made.host)?.sessionToken).toBe("sess_a_new");
    expect(made.cancels).toEqual([]);
  });

  it("writes a first session without tearing down an empty device", async () => {
    const made = host({ askEnabled: false });

    const outcome = await installPlusSession(made.host, A);

    expect(outcome).toBe("kept");
    expect(made.settings.askEnabled).toBe(false);
    expect(readPlusSession(made.host)?.email).toBe("a@tryatoms.test");
  });
});
