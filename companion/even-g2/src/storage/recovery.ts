import { MAX_RECORDING_BYTES } from "./capabilities";

type RecoveryDependencies = {
  indexedDB?: IDBFactory;
  crypto?: Crypto;
  databaseName?: string;
  maxBytes?: number;
};

type Binding = { accountId: string; deviceFamilyId: string };
type JournalData = {
  recordingId: string;
  capturedAt: string;
  revision: number;
  nextSequence: number;
  chunks: number[][];
  transcriptionId?: string;
};
type CipherRow = { iv: Uint8Array; ciphertext: ArrayBuffer };

const DB_VERSION = 1;
const META = "meta";
const KEYS = "keys";
const JOURNALS = "journals";

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openDb(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = factory.open(name, DB_VERSION);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      for (const store of [META, KEYS, JOURNALS]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
}

function sameBinding(a: Binding | undefined, b: Binding): boolean {
  return a?.accountId === b.accountId && a.deviceFamilyId === b.deviceFamilyId;
}

export class RecoveryJournal {
  private readonly indexedDB: IDBFactory;
  private readonly crypto: Crypto;
  private readonly databaseName: string;
  private readonly maxBytes: number;
  private database: IDBDatabase | null = null;
  private binding: Binding | null = null;
  private key: CryptoKey | null = null;

  constructor(dependencies: RecoveryDependencies = {}) {
    if (!dependencies.indexedDB && !globalThis.indexedDB) throw new Error("indexeddb_unavailable");
    if (!dependencies.crypto && !globalThis.crypto) throw new Error("webcrypto_unavailable");
    this.indexedDB = dependencies.indexedDB ?? globalThis.indexedDB;
    this.crypto = dependencies.crypto ?? globalThis.crypto;
    this.databaseName = dependencies.databaseName ?? "atoms-g2-recovery";
    this.maxBytes = dependencies.maxBytes ?? MAX_RECORDING_BYTES;
  }

  async open(accountId: string, deviceFamilyId: string): Promise<void> {
    this.database = await openDb(this.indexedDB, this.databaseName);
    const requested: Binding = { accountId, deviceFamilyId };
    const read = this.database.transaction([META, KEYS], "readonly");
    const [storedBinding, storedKey] = await Promise.all([
      request(read.objectStore(META).get("binding")) as Promise<Binding | undefined>,
      request(read.objectStore(KEYS).get("content")) as Promise<CryptoKey | undefined>,
    ]);
    await done(read);
    if (!sameBinding(storedBinding, requested)) {
      const purge = this.database.transaction([META, KEYS, JOURNALS], "readwrite");
      purge.objectStore(JOURNALS).clear();
      purge.objectStore(KEYS).clear();
      purge.objectStore(META).put(requested, "binding");
      await done(purge);
      this.key = null;
    } else {
      this.key = storedKey ?? null;
    }
    if (!this.key) {
      this.key = await this.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      const write = this.database.transaction(KEYS, "readwrite");
      write.objectStore(KEYS).put(this.key, "content");
      await done(write);
    }
    this.binding = requested;
  }

  close(): void {
    this.database?.close();
    this.database = null;
    this.binding = null;
    this.key = null;
  }

  private ready(): { database: IDBDatabase; binding: Binding; key: CryptoKey } {
    if (!this.database || !this.binding || !this.key) throw new Error("journal_not_open");
    return { database: this.database, binding: this.binding, key: this.key };
  }

  private async encrypt(data: JournalData): Promise<CipherRow> {
    const { binding, key } = this.ready();
    const iv = this.crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(data));
    const additionalData = new TextEncoder().encode(`${binding.accountId}\0${binding.deviceFamilyId}`);
    return { iv, ciphertext: await this.crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, key, plaintext) };
  }

  private async decrypt(row: CipherRow): Promise<JournalData> {
    const { binding, key } = this.ready();
    const additionalData = new TextEncoder().encode(`${binding.accountId}\0${binding.deviceFamilyId}`);
    const plaintext = await this.crypto.subtle.decrypt({ name: "AES-GCM", iv: row.iv, additionalData }, key, row.ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext)) as JournalData;
  }

  private async read(recordingId: string): Promise<JournalData | null> {
    const { database } = this.ready();
    const transaction = database.transaction(JOURNALS, "readonly");
    const row = await request(transaction.objectStore(JOURNALS).get(recordingId)) as CipherRow | undefined;
    await done(transaction);
    return row ? this.decrypt(row) : null;
  }

  private async write(data: JournalData): Promise<void> {
    const { database } = this.ready();
    const encrypted = await this.encrypt(data);
    const transaction = database.transaction(JOURNALS, "readwrite");
    transaction.objectStore(JOURNALS).put(encrypted, data.recordingId);
    await done(transaction);
  }

  async start(recordingId: string, capturedAt: string): Promise<void> {
    await this.write({ recordingId, capturedAt, revision: 1, nextSequence: 0, chunks: [] });
  }

  async append(recordingId: string, sequence: number, pcm: Uint8Array): Promise<void> {
    if (pcm.byteLength % 2 !== 0) throw new Error("odd_pcm_bytes");
    const row = await this.read(recordingId);
    if (!row) throw new Error("recording_not_found");
    if (sequence !== row.nextSequence) throw new Error("sequence_gap");
    const currentBytes = row.chunks.reduce((total, chunk) => total + chunk.length, 0);
    if (currentBytes + pcm.byteLength > this.maxBytes) throw new Error("recording_limit");
    row.chunks.push(Array.from(pcm));
    row.nextSequence += 1;
    row.revision += 1;
    await this.write(row);
  }

  async completeTranscription(recordingId: string, transcriptionId: string): Promise<void> {
    const row = await this.read(recordingId);
    if (!row) throw new Error("recording_not_found");
    row.chunks = [];
    row.transcriptionId = transcriptionId;
    row.revision += 1;
    await this.write(row);
  }

  async restore(recordingId: string): Promise<(Omit<JournalData, "chunks"> & {
    pcm: Uint8Array;
    chunks: Array<{ sequence: number; pcm: Uint8Array }>;
  }) | null> {
    const row = await this.read(recordingId);
    if (!row) return null;
    const { chunks, ...metadata } = row;
    return {
      ...metadata,
      pcm: new Uint8Array(chunks.flat()),
      chunks: chunks.map((pcm, sequence) => ({ sequence, pcm: new Uint8Array(pcm) })),
    };
  }
}
