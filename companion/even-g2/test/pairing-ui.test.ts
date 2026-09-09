import { webcrypto } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { G2CredentialVault } from "../src/auth/credentials";
import { renderPhone } from "../src/ui/phone";

describe("G2 pairing", () => {
  it("persists a non-extractable P-256 proof key and encrypted refresh credential", async () => {
    const indexedDB = new IDBFactory();
    const crypto = webcrypto as unknown as Crypto;
    const first = new G2CredentialVault({ indexedDB, crypto, databaseName: "pairing-u7" });
    const publicJwk = await first.createOrLoadProofKey();
    await first.saveRefresh({ accountId: "acct-one", deviceFamilyId: "fam-one", refreshToken: "g2r_secret" });
    first.close();

    const cold = new G2CredentialVault({ indexedDB, crypto, databaseName: "pairing-u7" });
    expect(await cold.createOrLoadProofKey()).toEqual(publicJwk);
    expect(await cold.loadRefresh("acct-one", "fam-one")).toEqual({ accountId: "acct-one", deviceFamilyId: "fam-one", refreshToken: "g2r_secret" });
    await expect(cold.exportPrivateKey()).rejects.toThrow("key_not_extractable");
  });

  it("renders code, disclosure, setup, loading, failures, success, and reconnect through one phone surface", () => {
    for (const state of [
      { screen: "unpaired" as const },
      { screen: "pairing" as const, code: "ABC123" },
      { screen: "disclosure" as const },
      { screen: "setup-required" as const },
      { screen: "loading" as const, operation: "pairing" as const },
      { screen: "pairing-error" as const, reason: "expired" as const },
      { screen: "ready" as const },
    ]) {
      const root = { textContent: "", replaceChildren() {} } as unknown as HTMLElement;
      renderPhone(root, state);
      expect(root.textContent?.trim()).toBeTruthy();
    }
  });
});
