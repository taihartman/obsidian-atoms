import { MAX_RECORDING_BYTES } from "./capabilities";

type RecoveryDependencies = {
  indexedDB?: IDBFactory;
  crypto?: Crypto;
  databaseName?: string;
  maxBytes?: number;
  now?: () => number;
  retentionMs?: number;
};

type Binding = { accountId: string; deviceFamilyId: string };
type JournalData = {
  formatVersion: 2;
  recordingId: string;
  capturedAt: string;
  state: "recording" | "transcribed";
  revision: number;
  nextSequence: number;
  byteLength: number;
  transcriptionId?: string;
  transcript?: string;
  expiresAt: number;
};
type LegacyJournalData = Omit<JournalData, "formatVersion" | "state" | "byteLength" | "transcript"> & { chunks: number[][] };
type CipherRow = { formatVersion?: 2; iv: Uint8Array; ciphertext: ArrayBuffer; expiresAt: number };
type ChunkCipherRow = CipherRow & { recordingId: string; sequence: number; byteLength: number };

const DB_VERSION = 2;
const META = "meta";
const KEYS = "keys";
const JOURNALS = "journals";
const CHUNKS = "chunks";
const CHUNKS_BY_RECORDING = "by-recording-id";

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
      const chunks = db.objectStoreNames.contains(CHUNKS)
        ? opening.transaction!.objectStore(CHUNKS)
        : db.createObjectStore(CHUNKS);
      if (!chunks.indexNames.contains(CHUNKS_BY_RECORDING)) {
        chunks.createIndex(CHUNKS_BY_RECORDING, "recordingId");
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
  private readonly now: () => number;
  private readonly retentionMs: number;
  private readonly recordingOperations = new Map<string, Promise<unknown>>();

  constructor(dependencies: RecoveryDependencies = {}) {
    if (!dependencies.indexedDB && !globalThis.indexedDB) throw new Error("indexeddb_unavailable");
    if (!dependencies.crypto && !globalThis.crypto) throw new Error("webcrypto_unavailable");
    this.indexedDB = dependencies.indexedDB ?? globalThis.indexedDB;
    this.crypto = dependencies.crypto ?? globalThis.crypto;
    this.databaseName = dependencies.databaseName ?? "atoms-g2-recovery";
    this.maxBytes = dependencies.maxBytes ?? MAX_RECORDING_BYTES;
    this.now = dependencies.now ?? Date.now;
    this.retentionMs = dependencies.retentionMs ?? 24 * 60 * 60 * 1000;
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
      const purge = this.database.transaction([META, KEYS, JOURNALS, CHUNKS], "readwrite");
      purge.objectStore(JOURNALS).clear();
      purge.objectStore(CHUNKS).clear();
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
    await this.sweepExpired();
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

  private additionalData(suffix = ""): Uint8Array {
    const { binding } = this.ready();
    return new TextEncoder().encode(`${binding.accountId}\0${binding.deviceFamilyId}${suffix}`);
  }

  private async encrypt(data: JournalData): Promise<CipherRow> {
    const { key } = this.ready();
    const iv = this.crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(data));
    return { formatVersion: 2, iv, ciphertext: await this.crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: this.additionalData(`\0journal\0${data.recordingId}`) }, key, plaintext), expiresAt: data.expiresAt };
  }

  private async decrypt(row: CipherRow, recordingId: string): Promise<JournalData | LegacyJournalData> {
    const { key } = this.ready();
    const additionalData = row.formatVersion === 2
      ? this.additionalData(`\0journal\0${recordingId}`)
      : this.additionalData();
    const plaintext = await this.crypto.subtle.decrypt({ name: "AES-GCM", iv: row.iv, additionalData }, key, row.ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext)) as JournalData | LegacyJournalData;
  }

  private async read(recordingId: string): Promise<JournalData | null> {
    const { database } = this.ready();
    const transaction = database.transaction(JOURNALS, "readonly");
    const row = await request(transaction.objectStore(JOURNALS).get(recordingId)) as CipherRow | undefined;
    await done(transaction);
    if (!row) return null;
    const value = await this.decrypt(row, recordingId);
    if ((value as Partial<JournalData>).formatVersion === 2) return value as JournalData;
    return this.migrateLegacy(value as LegacyJournalData);
  }

  private async storedChunks(recordingId: string): Promise<Array<{ key: IDBValidKey; row: ChunkCipherRow }>> {
    const { database } = this.ready();
    const transaction = database.transaction(CHUNKS, "readonly");
    const index = transaction.objectStore(CHUNKS).index(CHUNKS_BY_RECORDING);
    const [keys, rows] = await Promise.all([
      request(index.getAllKeys(recordingId)), request(index.getAll(recordingId)),
    ]) as [IDBValidKey[], ChunkCipherRow[]];
    await done(transaction);
    return rows.map((row, index) => ({ key: keys[index], row }))
      .sort((a, b) => a.row.sequence - b.row.sequence);
  }

  private async encryptChunk(recordingId: string, sequence: number, pcm: Uint8Array, expiresAt: number): Promise<ChunkCipherRow> {
    const { key } = this.ready();
    const iv = this.crypto.getRandomValues(new Uint8Array(12));
    const plaintext = pcm.slice();
    const ciphertext = await this.crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: this.additionalData(`\0chunk\0${recordingId}\0${sequence}`) },
      key,
      plaintext,
    );
    return { formatVersion: 2, recordingId, sequence, byteLength: pcm.byteLength, iv, ciphertext, expiresAt };
  }

  private async decryptChunk(row: ChunkCipherRow): Promise<Uint8Array> {
    const { key } = this.ready();
    const plaintext = await this.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: row.iv, additionalData: this.additionalData(`\0chunk\0${row.recordingId}\0${row.sequence}`) },
      key,
      row.ciphertext,
    );
    const pcm = new Uint8Array(plaintext);
    if (pcm.byteLength !== row.byteLength || pcm.byteLength === 0 || pcm.byteLength % 2 !== 0) throw new Error("invalid_recovery_chunk");
    return pcm;
  }

  private async migrateLegacy(legacy: LegacyJournalData): Promise<JournalData> {
    const chunks = legacy.chunks.map((chunk) => new Uint8Array(chunk));
    const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const metadata: JournalData = {
      formatVersion: 2,
      recordingId: legacy.recordingId,
      capturedAt: legacy.capturedAt,
      state: "recording",
      revision: legacy.revision,
      nextSequence: legacy.nextSequence,
      byteLength,
      transcriptionId: legacy.transcriptionId,
      expiresAt: legacy.expiresAt,
    };
    const [encryptedMetadata, encryptedChunks] = await Promise.all([
      this.encrypt(metadata),
      Promise.all(chunks.map((pcm, sequence) => this.encryptChunk(metadata.recordingId, sequence, pcm, metadata.expiresAt))),
    ]);
    const { database } = this.ready();
    const transaction = database.transaction([JOURNALS, CHUNKS], "readwrite");
    transaction.objectStore(JOURNALS).put(encryptedMetadata, metadata.recordingId);
    for (const row of encryptedChunks) transaction.objectStore(CHUNKS).put(row, [metadata.recordingId, row.sequence]);
    await done(transaction);
    return metadata;
  }

  private serialize<T>(recordingId: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.recordingOperations.get(recordingId) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(operation);
    this.recordingOperations.set(recordingId, next);
    void next.finally(() => {
      if (this.recordingOperations.get(recordingId) === next) this.recordingOperations.delete(recordingId);
    }).catch(() => undefined);
    return next;
  }

  async start(recordingId: string, capturedAt: string): Promise<void> {
    await this.serialize(recordingId, async () => {
      const metadata: JournalData = { formatVersion: 2, recordingId, capturedAt, state: "recording", revision: 1, nextSequence: 0, byteLength: 0, expiresAt: this.now() + this.retentionMs };
      const encrypted = await this.encrypt(metadata);
      const previousChunks = await this.storedChunks(recordingId);
      const { database } = this.ready();
      const transaction = database.transaction([JOURNALS, CHUNKS], "readwrite");
      for (const { key } of previousChunks) transaction.objectStore(CHUNKS).delete(key);
      transaction.objectStore(JOURNALS).put(encrypted, recordingId);
      await done(transaction);
    });
  }

  async append(recordingId: string, sequence: number, pcm: Uint8Array): Promise<void> {
    if (pcm.byteLength % 2 !== 0) throw new Error("odd_pcm_bytes");
    if (pcm.byteLength === 0) return;
    await this.serialize(recordingId, async () => {
      const row = await this.read(recordingId);
      if (!row) throw new Error("recording_not_found");
      if (row.state !== "recording") throw new Error("recording_already_transcribed");
      if (sequence !== row.nextSequence) throw new Error("sequence_gap");
      if (row.byteLength + pcm.byteLength > this.maxBytes) throw new Error("recording_limit");
      const next: JournalData = { ...row, nextSequence: row.nextSequence + 1, byteLength: row.byteLength + pcm.byteLength, revision: row.revision + 1 };
      const [encryptedMetadata, encryptedChunk] = await Promise.all([
        this.encrypt(next), this.encryptChunk(recordingId, sequence, pcm, row.expiresAt),
      ]);
      const { database } = this.ready();
      const transaction = database.transaction([JOURNALS, CHUNKS], "readwrite");
      transaction.objectStore(CHUNKS).put(encryptedChunk, [recordingId, sequence]);
      transaction.objectStore(JOURNALS).put(encryptedMetadata, recordingId);
      await done(transaction);
    });
  }

  async completeTranscription(recordingId: string, transcriptionId: string, transcript: string): Promise<void> {
    await this.serialize(recordingId, async () => {
      const row = await this.read(recordingId);
      if (!row) throw new Error("recording_not_found");
      if (row.state === "transcribed") {
        if (row.transcriptionId === transcriptionId && row.transcript === transcript) return;
        throw new Error("transcription_conflict");
      }
      const next: JournalData = { ...row, state: "transcribed", transcriptionId, transcript, revision: row.revision + 1 };
      const encrypted = await this.encrypt(next);
      const chunks = await this.storedChunks(recordingId);
      const { database } = this.ready();
      const transaction = database.transaction([JOURNALS, CHUNKS], "readwrite");
      transaction.objectStore(JOURNALS).put(encrypted, recordingId);
      for (const { key } of chunks) transaction.objectStore(CHUNKS).delete(key);
      await done(transaction);
    });
  }

  async completePreparation(recordingId: string): Promise<void> {
    await this.serialize(recordingId, async () => {
      const row = await this.read(recordingId);
      if (!row) return;
      if (row.state !== "transcribed") throw new Error("preparation_before_transcription");
      await this.deleteRecording(recordingId);
    });
  }

  async discard(recordingId: string): Promise<void> {
    await this.serialize(recordingId, () => this.deleteRecording(recordingId));
  }

  private async deleteRecording(recordingId: string): Promise<void> {
    const chunks = await this.storedChunks(recordingId);
    const { database } = this.ready();
    const transaction = database.transaction([JOURNALS, CHUNKS], "readwrite");
    transaction.objectStore(JOURNALS).delete(recordingId);
    for (const { key } of chunks) transaction.objectStore(CHUNKS).delete(key);
    await done(transaction);
  }

  async restore(recordingId: string): Promise<(Omit<JournalData, "chunks"> & {
    pcm: Uint8Array;
    chunks: Array<{ sequence: number; pcm: Uint8Array }>;
  }) | null> {
    const row = await this.read(recordingId);
    if (!row) return null;
    const encryptedChunks = await this.storedChunks(recordingId);
    const chunks = row.state === "recording" ? await Promise.all(encryptedChunks.map(async ({ row: entry }, sequence) => {
      if (entry.recordingId !== recordingId || entry.sequence !== sequence) throw new Error("invalid_recovery_sequence");
      return this.decryptChunk(entry);
    })) : [];
    if (chunks.length !== (row.state === "recording" ? row.nextSequence : 0)) throw new Error("invalid_recovery_sequence");
    const pcm = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
      pcm.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      ...row,
      pcm,
      chunks: chunks.map((pcm, sequence) => ({ sequence, pcm })),
    };
  }

  async sweepExpired(limit = 100): Promise<{ deleted: number; failed: number }> {
    const { database } = this.ready();
    const cap = Math.max(0, Math.min(1000, Math.floor(limit)));
    if (!cap) return { deleted: 0, failed: 0 };
    const read = database.transaction(JOURNALS, "readonly");
    const store = read.objectStore(JOURNALS);
    const [keys, rows] = await Promise.all([
      request(store.getAllKeys(null, cap)), request(store.getAll(null, cap)),
    ]) as [IDBValidKey[], CipherRow[]];
    await done(read);
    const expired = keys.filter((_key, index) => !Number.isFinite(rows[index]?.expiresAt) || Number(rows[index]?.expiresAt) <= this.now());
    if (!expired.length) return { deleted: 0, failed: 0 };
    try {
      const chunkKeys = new Map<IDBValidKey, IDBValidKey[]>();
      for (const key of expired) {
        if (typeof key === "string") chunkKeys.set(key, (await this.storedChunks(key)).map((entry) => entry.key));
      }
      const write = database.transaction([JOURNALS, CHUNKS], "readwrite");
      for (const key of expired) {
        write.objectStore(JOURNALS).delete(key);
        for (const chunkKey of chunkKeys.get(key) ?? []) write.objectStore(CHUNKS).delete(chunkKey);
      }
      await done(write);
      return { deleted: expired.length, failed: 0 };
    } catch {
      return { deleted: 0, failed: expired.length };
    }
  }
}
