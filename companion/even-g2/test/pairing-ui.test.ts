import { webcrypto } from "node:crypto";
import { IDBDatabase, IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { G2CredentialVault } from "../src/auth/credentials";
import { renderPhone } from "../src/ui/phone";

describe("G2 pairing", () => {
  it("replaces a legacy proof key that WebKit can reload but cannot use for signing", async () => {
    const indexedDB = new IDBFactory();
    const crypto = webcrypto as unknown as Crypto;
    const legacy = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"],
    );
    const legacyJwk = await crypto.subtle.exportKey("jwk", legacy.publicKey);
    const opening = indexedDB.open("pairing-legacy-webkit", 1);
    opening.onupgradeneeded = () => {
      opening.result.createObjectStore("keys");
      opening.result.createObjectStore("tokens");
    };
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const write = database.transaction("keys", "readwrite");
    write.objectStore("keys").put(legacy, "proof");
    await new Promise<void>((resolve, reject) => {
      write.oncomplete = () => resolve();
      write.onerror = () => reject(write.error);
      write.onabort = () => reject(write.error);
    });
    database.close();

    let rejectNextSign = true;
    const subtle = new Proxy(crypto.subtle, {
      get(target, property) {
        if (property === "sign") {
          return async (algorithm: AlgorithmIdentifier | EcdsaParams, key: CryptoKey, data: BufferSource) => {
            if (rejectNextSign) {
              rejectNextSign = false;
              throw new DOMException("legacy key unavailable", "OperationError");
            }
            return target.sign(algorithm, key, data);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const webkitCrypto = {
      subtle,
      getRandomValues: crypto.getRandomValues.bind(crypto),
      randomUUID: crypto.randomUUID.bind(crypto),
    } as Crypto;
    const vault = new G2CredentialVault({ indexedDB, crypto: webkitCrypto, databaseName: "pairing-legacy-webkit" });

    const replacementJwk = await vault.createOrLoadProofKey();

    expect(replacementJwk).not.toEqual(legacyJwk);
    expect(new Uint8Array(await vault.sign(new TextEncoder().encode("pair")))).toHaveLength(64);
  });

  it("reuses the live proof key while pairing instead of reloading it through WebKit", async () => {
    const vault = new G2CredentialVault({
      indexedDB: new IDBFactory(),
      crypto: webcrypto as unknown as Crypto,
      databaseName: "pairing-live-key",
    });
    const publicJwk = await vault.createOrLoadProofKey();
    const originalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function() {
      throw new DOMException("stored key unavailable", "InvalidStateError");
    } as typeof IDBDatabase.prototype.transaction;

    try {
      expect(await vault.createOrLoadProofKey()).toEqual(publicJwk);
      expect(new Uint8Array(await vault.sign(new TextEncoder().encode("pair")))).toHaveLength(64);
    } finally {
      IDBDatabase.prototype.transaction = originalTransaction;
    }
  });

  it("persists proof keys without cloning the CryptoKeyPair wrapper", async () => {
    const indexedDB = new IDBFactory();
    const crypto = webcrypto as unknown as Crypto;
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
      if (value && typeof value === "object" && "privateKey" in value && "publicKey" in value) {
        throw new DOMException("CryptoKeyPair cannot be cloned", "DataCloneError");
      }
      return originalPut.call(this, value, key);
    };

    try {
      const first = new G2CredentialVault({ indexedDB, crypto, databaseName: "pairing-ios-webkit" });
      const publicJwk = await first.createOrLoadProofKey();
      first.close();

      const cold = new G2CredentialVault({ indexedDB, crypto, databaseName: "pairing-ios-webkit" });
      expect(await cold.createOrLoadProofKey()).toEqual(publicJwk);
      expect(new Uint8Array(await cold.sign(new TextEncoder().encode("pair")))).toHaveLength(64);
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
  });

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
      { screen: "unpaired" as const, origin: "evenhub://app.tryatoms.g2" },
      { screen: "pairing" as const, code: "ABC123" },
      { screen: "disclosure" as const },
      { screen: "setup-required" as const },
      { screen: "loading" as const, operation: "pairing" as const },
      { screen: "pairing-error" as const, reason: "expired" as const, origin: "evenhub://app.tryatoms.g2" },
      { screen: "pairing-error" as const, reason: "connection" as const, origin: "evenhub://app.tryatoms.g2" },
      { screen: "ready" as const },
      { screen: "review" as const, title: "Blue flowers", transcript: "Remember the blue flowers by the east trail." },
    ]) {
      const root = { textContent: "", replaceChildren() {} } as unknown as HTMLElement;
      renderPhone(root, state);
      expect(root.textContent?.trim()).toBeTruthy();
    }
  });

  it("shows the full local transcript on the phone before save", () => {
    const root = { textContent: "", replaceChildren() {} } as unknown as HTMLElement;
    renderPhone(root, {
      screen: "review",
      title: "Blue flowers",
      transcript: "Remember the blue flowers by the east trail.",
    });
    expect(root.textContent).toContain("Remember the blue flowers by the east trail.");
  });

  it("shows the exact private test origin with the Even G2 pairing instruction", () => {
    const root = { textContent: "", replaceChildren() {} } as unknown as HTMLElement;

    renderPhone(root, { screen: "unpaired", origin: "evenhub://app.tryatoms.g2" });

    expect(root.textContent).toBe([
      "Enter the code from the Even G2 row in Atoms settings.",
      "Private test origin: evenhub://app.tryatoms.g2",
    ].join("\n"));
  });

  it("keeps the private test origin visible after a rejected pairing code", () => {
    const root = { textContent: "", replaceChildren() {} } as unknown as HTMLElement;

    renderPhone(root, {
      screen: "pairing-error",
      reason: "invalid",
      origin: "evenhub://app.tryatoms.g2",
    });

    expect(root.textContent).toContain("Private test origin: evenhub://app.tryatoms.g2");
  });

  it("does not blame the code when secure pairing could not start", () => {
    const root = { textContent: "", replaceChildren() {} } as unknown as HTMLElement;

    renderPhone(root, {
      screen: "pairing-error",
      reason: "connection",
      origin: "http://127.0.0.1:54400",
    });

    expect(root.textContent).toContain("Could not start a secure connection");
    expect(root.textContent).not.toContain("code is not valid");
  });
});
