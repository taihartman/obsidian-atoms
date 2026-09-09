import { webcrypto } from "node:crypto";

import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import {
  MAX_RECORDING_BYTES,
  probeRecoveryCapabilities,
} from "../src/storage/capabilities";
import { normalizeEvenAction } from "../src/platform/even";

const crypto = webcrypto as unknown as Crypto;

function storageWith(remainingBytes: number, persistent = true): StorageManager {
  return {
    estimate: async () => ({ quota: remainingBytes, usage: 0 }),
    persist: async () => persistent,
  } as StorageManager;
}

function deleteRecord(
  indexedDB: IDBFactory,
  databaseName: string,
  storeName: string,
  key: IDBValidKey,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(databaseName);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).delete(key);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

function mutateRecord(
  indexedDB: IDBFactory,
  databaseName: string,
  key: IDBValidKey,
  mutate: (record: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(databaseName);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction("blobs", "readwrite");
      const store = transaction.objectStore("blobs");
      const get = store.get(key);
      get.onsuccess = () => store.put(mutate(get.result as Record<string, unknown>), key);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

describe("recovery capability probe", () => {
  it("proves durable recovery across launches when WKWebView omits the storage persistence API", async () => {
    const indexedDB = new IDBFactory();
    const dependencies = {
      indexedDB,
      crypto,
      storage: undefined,
      bytesPerRecording: 128,
      databaseName: "wkwebview-probe",
    };

    await expect(probeRecoveryCapabilities(dependencies)).resolves.toEqual({
      state: "reload-required",
      bearerFallback: false,
    });
    await expect(probeRecoveryCapabilities(dependencies)).resolves.toEqual({
      state: "ready",
      blobPersistence: "encrypted",
      keyPersistence: "non-extractable",
      reservedBytes: 256,
      purged: true,
    });
    await expect(probeRecoveryCapabilities(dependencies)).resolves.toMatchObject({
      state: "ready",
      purged: true,
    });
  });

  it("cold-reloads encrypted maximum-bound blobs with a persisted non-extractable key and purges the probe", async () => {
    const indexedDB = new IDBFactory();
    const dependencies = {
      indexedDB,
      crypto,
      storage: storageWith(MAX_RECORDING_BYTES * 3),
      databaseName: "ready-probe",
    };

    await expect(probeRecoveryCapabilities(dependencies)).resolves.toEqual({
      state: "reload-required",
      bearerFallback: false,
    });
    const result = await probeRecoveryCapabilities(dependencies);

    expect(result).toEqual({
      state: "ready",
      blobPersistence: "encrypted",
      keyPersistence: "non-extractable",
      reservedBytes: 7_680_000,
      purged: true,
    });
    expect(Object.keys(result)).not.toContain("key");
    expect(Object.keys(result)).not.toContain("ciphertext");
  });

  it("fails closed near quota before persisting content", async () => {
    let persisted = false;
    const result = await probeRecoveryCapabilities({
      indexedDB: new IDBFactory(),
      crypto,
      storage: storageWith(255),
      bytesPerRecording: 128,
      afterPersist: async () => {
        persisted = true;
      },
    });

    expect(result).toEqual({
      state: "blocked",
      reason: "capacity-insufficient",
      bearerFallback: false,
    });
    expect(persisted).toBe(false);
  });

  it("uses the cold-reload proof instead of trusting a denied persistence hint", async () => {
    const dependencies = {
      indexedDB: new IDBFactory(),
      crypto,
      storage: storageWith(1024, false),
      bytesPerRecording: 128,
      databaseName: "persistence-hint-probe",
    };

    await expect(probeRecoveryCapabilities(dependencies)).resolves.toEqual({
      state: "reload-required",
      bearerFallback: false,
    });
    await expect(probeRecoveryCapabilities(dependencies)).resolves.toMatchObject({
      state: "ready",
      keyPersistence: "non-extractable",
      blobPersistence: "encrypted",
    });
  });

  it("fails closed when IndexedDB or WebCrypto key persistence is unavailable", async () => {
    await expect(
      probeRecoveryCapabilities({
        indexedDB: undefined,
        crypto,
        storage: storageWith(1024),
        bytesPerRecording: 128,
      }),
    ).resolves.toEqual({
      state: "blocked",
      reason: "indexeddb-unavailable",
      bearerFallback: false,
    });

    await expect(
      probeRecoveryCapabilities({
        indexedDB: new IDBFactory(),
        crypto: undefined,
        storage: storageWith(1024),
        bytesPerRecording: 128,
      }),
    ).resolves.toEqual({
      state: "blocked",
      reason: "webcrypto-unavailable",
      bearerFallback: false,
    });
  });

  it("treats an evicted encrypted blob as a blocked capability", async () => {
    const indexedDB = new IDBFactory();
    const databaseName = "evicted-probe";
    const dependencies = {
      indexedDB,
      crypto,
      storage: storageWith(1024),
      bytesPerRecording: 128,
      databaseName,
      afterPersist: () => deleteRecord(indexedDB, databaseName, "blobs", "active"),
    };

    await expect(probeRecoveryCapabilities(dependencies)).resolves.toEqual({
      state: "reload-required",
      bearerFallback: false,
    });
    await expect(probeRecoveryCapabilities({ ...dependencies, afterPersist: undefined })).resolves.toEqual({
      state: "blocked",
      reason: "storage-evicted",
      bearerFallback: false,
    });
  });

  it("blocks decrypt and hash mismatches", async () => {
    const decryptDatabase = new IDBFactory();
    const decryptDependencies = {
      indexedDB: decryptDatabase,
      crypto,
      storage: storageWith(1024),
      bytesPerRecording: 128,
      databaseName: "decrypt-probe",
      afterPersist: () =>
        mutateRecord(decryptDatabase, "decrypt-probe", "active", (record) => ({
          ...record,
          iv: new Uint8Array(12),
        })),
    };
    await expect(
      probeRecoveryCapabilities(decryptDependencies),
    ).resolves.toEqual({ state: "reload-required", bearerFallback: false });
    await expect(
      probeRecoveryCapabilities({ ...decryptDependencies, afterPersist: undefined }),
    ).resolves.toEqual({
      state: "blocked",
      reason: "decrypt-failed",
      bearerFallback: false,
    });

    const hashDatabase = new IDBFactory();
    const hashDependencies = {
      indexedDB: hashDatabase,
      crypto,
      storage: storageWith(1024),
      bytesPerRecording: 128,
      databaseName: "hash-probe",
      afterPersist: () =>
        mutateRecord(hashDatabase, "hash-probe", "active", (record) => ({
          ...record,
          hash: "not-the-plaintext-hash",
        })),
    };
    await expect(
      probeRecoveryCapabilities(hashDependencies),
    ).resolves.toEqual({ state: "reload-required", bearerFallback: false });
    await expect(
      probeRecoveryCapabilities({ ...hashDependencies, afterPersist: undefined }),
    ).resolves.toEqual({
      state: "blocked",
      reason: "hash-mismatch",
      bearerFallback: false,
    });
  });
});

describe("Even event normalization", () => {
  it("treats the simulator's omitted protobuf list eventType as the default click", () => {
    expect(normalizeEvenAction({
      listEvent: { containerID: 2, containerName: "atoms-actions" },
    })).toEqual({
      kind: "click",
      envelope: "list",
      containerId: 2,
      selectedIndex: undefined,
    });
  });

  it("treats an omitted text eventType as click but still ignores explicit unknown values", () => {
    expect(normalizeEvenAction({ textEvent: { containerID: 1 } })).toEqual({
      kind: "click",
      envelope: "text",
      containerId: 1,
    });
    expect(normalizeEvenAction({ listEvent: { eventType: "NOT_A_REAL_EVENT", containerID: 2 } })).toBeNull();
  });

  it("treats the simulator's sourced protobuf system default as click", () => {
    expect(normalizeEvenAction({ sysEvent: { eventSource: 1 } })).toEqual({
      kind: "click",
      envelope: "system",
      source: 1,
    });
    expect(normalizeEvenAction({ sysEvent: {} })).toBeNull();
    expect(normalizeEvenAction({
      sysEvent: { eventType: "NOT_A_REAL_EVENT", eventSource: 1 },
    })).toBeNull();
  });

  it.each([
    [{ textEvent: { eventType: 0, containerID: 1 } }, "text"],
    [
      {
        listEvent: {
          eventType: "CLICK_EVENT",
          containerID: 2,
          currentSelectItemIndex: 3,
        },
      },
      "list",
    ],
    [{ sysEvent: { eventType: "CLICK", eventSource: 1 } }, "system"],
  ] as const)("normalizes click envelope %#", (event, envelope) => {
    expect(normalizeEvenAction(event)).toMatchObject({ kind: "click", envelope });
  });

  it("preserves gesture source and ignores unknown events", () => {
    expect(
      normalizeEvenAction({
        sysEvent: { eventType: "LONG_PRESS_RELEASE", eventSource: 3 },
      }),
    ).toEqual({
      kind: "long-press-release",
      envelope: "system",
      source: 3,
    });
    expect(normalizeEvenAction({ sysEvent: { eventType: "IMU_DATA_REPORT" } })).toBeNull();
    expect(normalizeEvenAction({ jsonData: { unexpected: true } })).toBeNull();
  });
});
