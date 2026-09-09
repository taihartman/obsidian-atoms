import type { CreateRecovery, CreateRecoveryRecord } from "../app/createFlow";

type Dependencies = { indexedDB?: IDBFactory; crypto?: Crypto; databaseName?: string; now?: () => number; retentionMs?: number };
type Cipher = { binding: string; iv: Uint8Array; ciphertext: ArrayBuffer; expiresAt?: number };
const VERSION = 1;
const KEYS = "keys";
const RECORDS = "records";

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
}
function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });
}
function open(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = factory.open(name, VERSION);
    opening.onupgradeneeded = () => {
      if (!opening.result.objectStoreNames.contains(KEYS)) opening.result.createObjectStore(KEYS);
      if (!opening.result.objectStoreNames.contains(RECORDS)) opening.result.createObjectStore(RECORDS);
    };
    opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
  });
}

export class AppRecoveryStore implements CreateRecovery {
  private database: IDBDatabase | null = null;
  private key: CryptoKey | null = null;
  private binding = "";
  private readonly factory: IDBFactory;
  private readonly crypto: Crypto;
  private readonly name: string;
  private readonly now: () => number;
  private readonly retentionMs: number;

  constructor(dependencies: Dependencies = {}) {
    if (!dependencies.indexedDB && !globalThis.indexedDB) throw new Error("indexeddb_unavailable");
    if (!dependencies.crypto && !globalThis.crypto) throw new Error("webcrypto_unavailable");
    this.factory = dependencies.indexedDB ?? globalThis.indexedDB;
    this.crypto = dependencies.crypto ?? globalThis.crypto;
    this.name = dependencies.databaseName ?? "atoms-g2-app-recovery";
    this.now = dependencies.now ?? Date.now;
    this.retentionMs = dependencies.retentionMs ?? 7 * 24 * 60 * 60 * 1000;
  }

  async open(accountId: string, deviceFamilyId: string): Promise<void> {
    this.database = await open(this.factory, this.name);
    this.binding = `${accountId}\0${deviceFamilyId}`;
    await this.sweepExpired();
    const read = this.database.transaction(KEYS, "readonly");
    this.key = await request(read.objectStore(KEYS).get("content")) as CryptoKey | null;
    await done(read);
    if (!this.key) {
      this.key = await this.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      const write = this.database.transaction(KEYS, "readwrite");
      write.objectStore(KEYS).put(this.key, "content"); await done(write);
    }
    const record = await this.row();
    if (record && record.binding !== this.binding) await this.clear();
  }

  private ready(): { database: IDBDatabase; key: CryptoKey } {
    if (!this.database || !this.key || !this.binding) throw new Error("recovery_not_open");
    return { database: this.database, key: this.key };
  }
  private async row(): Promise<Cipher | null> {
    if (!this.database) return null;
    const read = this.database.transaction(RECORDS, "readonly");
    const row = await request(read.objectStore(RECORDS).get("create")) as Cipher | undefined; await done(read); return row ?? null;
  }

  async load(): Promise<CreateRecoveryRecord | null> {
    const row = await this.row();
    if (!row || row.binding !== this.binding) return null;
    const { key } = this.ready();
    const plaintext = await this.crypto.subtle.decrypt({ name: "AES-GCM", iv: row.iv, additionalData: new TextEncoder().encode(this.binding) }, key, row.ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext)) as CreateRecoveryRecord;
  }

  async save(record: CreateRecoveryRecord): Promise<void> {
    const { database, key } = this.ready();
    const iv = this.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await this.crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(this.binding) }, key, new TextEncoder().encode(JSON.stringify(record)));
    const write = database.transaction(RECORDS, "readwrite");
    const proposalExpiry = Date.parse(record.expiresAt);
    const expiresAt = record.state === "prepared" && Number.isFinite(proposalExpiry)
      ? Math.min(proposalExpiry, this.now() + this.retentionMs) : this.now() + this.retentionMs;
    write.objectStore(RECORDS).put({ binding: this.binding, iv, ciphertext, expiresAt } satisfies Cipher, "create"); await done(write);
  }

  async clear(): Promise<void> {
    if (!this.database) return;
    const write = this.database.transaction(RECORDS, "readwrite"); write.objectStore(RECORDS).delete("create"); await done(write);
  }

  async sweepExpired(limit = 10): Promise<number> {
    if (!this.database) return 0;
    const row = await this.row();
    if (!row || (Number.isFinite(row.expiresAt) && Number(row.expiresAt) > this.now()) || limit < 1) return 0;
    await this.clear();
    return 1;
  }
}
