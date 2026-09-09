import { webcrypto } from "node:crypto";

import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import {
  requireLoopbackHttpBaseUrl,
  simulatorRecoveryDependencies,
} from "../src/simulatorConfig";
import { MAX_RECORDING_BYTES, probeRecoveryCapabilities } from "../src/storage/capabilities";
import { autoDriveSimulatorSetup, requireSimulatorPairingCode } from "../src/simulatorSetup";

describe("simulator Plus base URL", () => {
  it.each([
    ["http://127.0.0.1:8787", "http://127.0.0.1:8787"],
    ["http://localhost:8787/", "http://localhost:8787"],
  ])("accepts an explicit loopback HTTP origin", (raw, expected) => {
    expect(requireLoopbackHttpBaseUrl(raw)).toBe(expected);
  });

  it.each([
    "",
    "https://127.0.0.1:8787",
    "http://0.0.0.0:8787",
    "http://127.0.0.2:8787",
    "http://localhost.evil.test:8787",
    "http://user@localhost:8787",
    "http://localhost:8787/path",
    "http://localhost:8787/?redirect=https://evil.test",
    "http://localhost:8787/#fragment",
  ])("fails closed for %s", (raw) => {
    expect(() => requireLoopbackHttpBaseUrl(raw)).toThrow("simulator_base_url_refused");
  });
});

describe("simulator recovery capability adapter", () => {
  it("keeps IndexedDB and Web Crypto real while replacing only unsupported quota APIs", async () => {
    const dependencies = simulatorRecoveryDependencies();
    expect(dependencies).not.toHaveProperty("indexedDB");
    expect(dependencies).not.toHaveProperty("crypto");
    expect(dependencies).not.toHaveProperty("bytesPerRecording");
    await expect(dependencies.storage.estimate()).resolves.toEqual({ quota: 64 * 1024 * 1024, usage: 0 });
    await expect(dependencies.storage.persist()).resolves.toBe(true);
    await expect(probeRecoveryCapabilities({
      ...dependencies,
      indexedDB: new IDBFactory(),
      crypto: webcrypto as unknown as Crypto,
      databaseName: "simulator-production-size-probe",
    })).resolves.toMatchObject({ state: "ready", reservedBytes: MAX_RECORDING_BYTES * 2 });
  });
});

describe("simulator-only phone setup driver", () => {
  it("submits the real pairing form and then the real disclosure button", async () => {
    const input = { value: "" };
    let screen: "pairing" | "disclosure" = "pairing";
    const accepted: string[] = [];
    const connect = { textContent: "Connect", click: () => { accepted.push(`pair:${input.value}`); } };
    const disclosure = { textContent: "Accept and continue", click: () => { accepted.push("disclosure"); } };
    const root = {
      querySelector(selector: string) {
        if (selector === "input" && screen === "pairing") return input;
        if (selector === "button") return screen === "pairing" ? connect : disclosure;
        return null;
      },
    } as unknown as HTMLElement;

    let waits = 0;
    await autoDriveSimulatorSetup(root, "A1B2C3D4", { wait: async () => {
      waits += 1;
      screen = "disclosure";
    } });

    expect(accepted).toEqual(["pair:A1B2C3D4", "disclosure"]);
    expect(waits).toBe(1);
  });

  it("fails deterministically when disclosure never appears", async () => {
    const input = { value: "" };
    const root = {
      querySelector(selector: string) {
        if (selector === "input") return input;
        if (selector === "button") return { textContent: "Connect", click() {} };
        return null;
      },
    } as unknown as HTMLElement;

    await expect(autoDriveSimulatorSetup(root, "A1B2C3D4", {
      attempts: 2,
      wait: async () => undefined,
    })).rejects.toThrow("simulator_disclosure_form_unavailable");
  });

  it.each(["", "abcd1234", "TOO-LONG-1", "ABCDEFG!"])("refuses invalid pairing code %s", (raw) => {
    expect(() => requireSimulatorPairingCode(raw)).toThrow("simulator_pairing_code_refused");
  });
});
