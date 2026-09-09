export const PCM_SAMPLE_RATE_HZ = 16_000;
export const PCM_BYTES_PER_SAMPLE = 2;
export const MAX_RECORDING_SECONDS = 120;
export const MAX_RECORDING_BYTES =
  PCM_SAMPLE_RATE_HZ * PCM_BYTES_PER_SAMPLE * MAX_RECORDING_SECONDS;
export const RECOVERY_RESERVATION_BYTES = MAX_RECORDING_BYTES * 2;

type CapabilityBlockReason =
  | "indexeddb-unavailable"
  | "webcrypto-unavailable"
  | "storage-estimate-unavailable"
  | "capacity-insufficient"
  | "persistence-denied"
  | "storage-evicted"
  | "key-extractable"
  | "decrypt-failed"
  | "hash-mismatch"
  | "purge-failed"
  | "probe-failed";

export type RecoveryCapabilityResult =
  | {
      state: "ready";
      blobPersistence: "encrypted";
      keyPersistence: "non-extractable";
      reservedBytes: number;
      purged: true;
    }
  | {
      state: "blocked";
      reason: CapabilityBlockReason;
      bearerFallback: false;
    };

type StorageCapability = {
  estimate(): Promise<{ quota?: number; usage?: number }>;
  persist(): Promise<boolean>;
};

type ProbeDependencies = {
  indexedDB?: IDBFactory;
  crypto?: Crypto;
  storage?: StorageCapability;
  bytesPerRecording?: number;
  databaseName?: string;
  afterPersist?: (databaseName: string) => Promise<void> | void;
};

type EncryptedProbeRecord = {
  iv: Uint8Array;
  ciphertext: Blob;
  hash: string;
};

const DATABASE_VERSION = 1;
const KEY_STORE = "keys";
const BLOB_STORE = "blobs";
const PROBE_KEY = "recovery";

function blocked(reason: CapabilityBlockReason): RecoveryCapabilityResult {
  return { state: "blocked", reason, bearerFallback: false };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openDatabase(indexedDB: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(KEY_STORE)) {
        database.createObjectStore(KEY_STORE);
      }
      if (!database.objectStoreNames.contains(BLOB_STORE)) {
        database.createObjectStore(BLOB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function deleteDatabase(indexedDB: IDBFactory, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("capability probe database is blocked"));
  });
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function plaintextHash(crypto: Crypto, plaintext: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", plaintext));
}

async function encryptProbeRecord(
  crypto: Crypto,
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<EncryptedProbeRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );
  return {
    iv,
    ciphertext: new Blob([ciphertext]),
    hash: await plaintextHash(crypto, plaintext),
  };
}

async function persistProbe(
  database: IDBDatabase,
  crypto: Crypto,
  key: CryptoKey,
  bytesPerRecording: number,
): Promise<void> {
  const completed = new Uint8Array(bytesPerRecording);
  completed[0] = 1;
  const encryptedCompleted = await encryptProbeRecord(crypto, key, completed);

  const active = new Uint8Array(bytesPerRecording);
  active[0] = 2;
  const encryptedActive = await encryptProbeRecord(crypto, key, active);

  const transaction = database.transaction([KEY_STORE, BLOB_STORE], "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(KEY_STORE).put(key, PROBE_KEY);

  // Write a completed item first, then prove room remains for one active item.
  transaction.objectStore(BLOB_STORE).put(encryptedCompleted, "completed");
  transaction.objectStore(BLOB_STORE).put(encryptedActive, "active");
  await done;
}

async function verifyProbe(
  database: IDBDatabase,
  crypto: Crypto,
): Promise<CapabilityBlockReason | null> {
  const transaction = database.transaction([KEY_STORE, BLOB_STORE], "readonly");
  const done = transactionDone(transaction);
  const keyRequest = requestResult(transaction.objectStore(KEY_STORE).get(PROBE_KEY));
  const blobStore = transaction.objectStore(BLOB_STORE);
  const recordRequests = ["completed", "active"].map((id) =>
    requestResult(blobStore.get(id)),
  );
  const [key, records] = await Promise.all([
    keyRequest as Promise<CryptoKey | undefined>,
    Promise.all(recordRequests) as Promise<Array<EncryptedProbeRecord | undefined>>,
  ]);
  await done;

  if (!key || records.some((record) => !record)) {
    return "storage-evicted";
  }

  try {
    await crypto.subtle.exportKey("raw", key);
    return "key-extractable";
  } catch {
    // A persisted credential key must remain non-extractable after cold reload.
  }

  for (const record of records as EncryptedProbeRecord[]) {
    let plaintext: ArrayBuffer;
    try {
      plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: record.iv },
        key,
        await record.ciphertext.arrayBuffer(),
      );
    } catch {
      return "decrypt-failed";
    }
    if ((await plaintextHash(crypto, new Uint8Array(plaintext))) !== record.hash) {
      return "hash-mismatch";
    }
  }

  return null;
}

export async function probeRecoveryCapabilities(
  dependencies: ProbeDependencies = {},
): Promise<RecoveryCapabilityResult> {
  const indexedDB = Object.hasOwn(dependencies, "indexedDB")
    ? dependencies.indexedDB
    : globalThis.indexedDB;
  const crypto = Object.hasOwn(dependencies, "crypto")
    ? dependencies.crypto
    : globalThis.crypto;
  const storage = Object.hasOwn(dependencies, "storage")
    ? dependencies.storage
    : globalThis.navigator?.storage;
  const bytesPerRecording = dependencies.bytesPerRecording ?? MAX_RECORDING_BYTES;
  const reservedBytes = bytesPerRecording * 2;
  const databaseName =
    dependencies.databaseName ?? `atoms-g2-capability-${crypto?.randomUUID?.() ?? "probe"}`;

  if (!indexedDB) return blocked("indexeddb-unavailable");
  if (!crypto?.subtle) return blocked("webcrypto-unavailable");
  if (!storage?.estimate || !storage.persist) {
    return blocked("storage-estimate-unavailable");
  }

  const estimate = await storage.estimate();
  if (
    estimate.quota === undefined ||
    estimate.usage === undefined ||
    estimate.quota - estimate.usage < reservedBytes
  ) {
    return blocked("capacity-insufficient");
  }
  if (!(await storage.persist())) return blocked("persistence-denied");

  let database: IDBDatabase | undefined;
  let needsPurge = false;
  try {
    database = await openDatabase(indexedDB, databaseName);
    needsPurge = true;
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    await persistProbe(database, crypto, key, bytesPerRecording);
    database.close();
    database = undefined;

    await dependencies.afterPersist?.(databaseName);

    database = await openDatabase(indexedDB, databaseName);
    const failure = await verifyProbe(database, crypto);
    if (failure) return blocked(failure);
    database.close();
    database = undefined;
    await deleteDatabase(indexedDB, databaseName);
    needsPurge = false;

    return {
      state: "ready",
      blobPersistence: "encrypted",
      keyPersistence: "non-extractable",
      reservedBytes,
      purged: true,
    };
  } catch {
    return blocked("probe-failed");
  } finally {
    database?.close();
    if (needsPurge) {
      try {
        await deleteDatabase(indexedDB, databaseName);
      } catch {
        // A failed purge leaves the capability blocked; no recovery content is used.
      }
    }
  }
}
