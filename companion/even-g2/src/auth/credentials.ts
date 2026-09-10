type VaultDependencies = { indexedDB?: IDBFactory; crypto?: Crypto; databaseName?: string };
type RefreshRecord = { accountId: string; deviceFamilyId: string; refreshToken: string };
type CipherRecord = { accountId: string; deviceFamilyId: string; iv: Uint8Array; ciphertext: ArrayBuffer };

const VERSION = 1;
const KEYS = "keys";
const TOKENS = "tokens";
const PROOF_LEGACY = "proof";
const PROOF_PRIVATE = "proof-private";
const PROOF_PUBLIC = "proof-public";

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function open(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = factory.open(name, VERSION);
    opening.onupgradeneeded = () => {
      if (!opening.result.objectStoreNames.contains(KEYS)) opening.result.createObjectStore(KEYS);
      if (!opening.result.objectStoreNames.contains(TOKENS)) opening.result.createObjectStore(TOKENS);
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
}

export class G2CredentialVault {
  private readonly factory: IDBFactory;
  private readonly crypto: Crypto;
  private readonly name: string;
  private database: IDBDatabase | null = null;
  private proofKey: CryptoKeyPair | null = null;
  private wrappingKey: CryptoKey | null = null;

  constructor(dependencies: VaultDependencies = {}) {
    if (!dependencies.indexedDB && !globalThis.indexedDB) throw new Error("indexeddb_unavailable");
    if (!dependencies.crypto && !globalThis.crypto) throw new Error("webcrypto_unavailable");
    this.factory = dependencies.indexedDB ?? globalThis.indexedDB;
    this.crypto = dependencies.crypto ?? globalThis.crypto;
    this.name = dependencies.databaseName ?? "atoms-g2-credentials";
  }

  private async ready(): Promise<IDBDatabase> {
    this.database ??= await open(this.factory, this.name);
    return this.database;
  }

  async createOrLoadProofKey(): Promise<JsonWebKey> {
    if (this.proofKey) return this.crypto.subtle.exportKey("jwk", this.proofKey.publicKey);
    const database = await this.ready();
    const transaction = database.transaction(KEYS, "readonly");
    const store = transaction.objectStore(KEYS);
    const [privateKey, publicKey, legacy] = await Promise.all([
      request(store.get(PROOF_PRIVATE)) as Promise<CryptoKey | undefined>,
      request(store.get(PROOF_PUBLIC)) as Promise<CryptoKey | undefined>,
      request(store.get(PROOF_LEGACY)) as Promise<CryptoKeyPair | undefined>,
    ]);
    await complete(transaction);
    if (privateKey && publicKey) this.proofKey = { privateKey, publicKey };
    else if (legacy?.privateKey && legacy.publicKey) this.proofKey = legacy;
    else {
      this.proofKey = await this.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
      const write = database.transaction(KEYS, "readwrite");
      const keyStore = write.objectStore(KEYS);
      keyStore.put(this.proofKey.privateKey, PROOF_PRIVATE);
      keyStore.put(this.proofKey.publicKey, PROOF_PUBLIC);
      await complete(write);
    }
    return this.crypto.subtle.exportKey("jwk", this.proofKey.publicKey);
  }

  private async loadProofKey(): Promise<CryptoKeyPair> {
    if (!this.proofKey) await this.createOrLoadProofKey();
    if (!this.proofKey) throw new Error("proof_key_unavailable");
    return this.proofKey;
  }

  private async loadWrappingKey(): Promise<CryptoKey> {
    if (this.wrappingKey) return this.wrappingKey;
    const database = await this.ready();
    const read = database.transaction(KEYS, "readonly");
    this.wrappingKey = await request(read.objectStore(KEYS).get("refresh")) as CryptoKey | null;
    await complete(read);
    if (!this.wrappingKey) {
      this.wrappingKey = await this.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      const write = database.transaction(KEYS, "readwrite");
      write.objectStore(KEYS).put(this.wrappingKey, "refresh");
      await complete(write);
    }
    return this.wrappingKey;
  }

  async saveRefresh(record: RefreshRecord): Promise<void> {
    const database = await this.ready();
    const key = await this.loadWrappingKey();
    const iv = this.crypto.getRandomValues(new Uint8Array(12));
    const aad = new TextEncoder().encode(`${record.accountId}\0${record.deviceFamilyId}`);
    const ciphertext = await this.crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, new TextEncoder().encode(record.refreshToken));
    const row: CipherRecord = { accountId: record.accountId, deviceFamilyId: record.deviceFamilyId, iv, ciphertext };
    const transaction = database.transaction(TOKENS, "readwrite");
    transaction.objectStore(TOKENS).clear();
    transaction.objectStore(TOKENS).put(row, "current");
    await complete(transaction);
  }

  async loadRefresh(accountId: string, deviceFamilyId: string): Promise<RefreshRecord | null> {
    const database = await this.ready();
    const read = database.transaction(TOKENS, "readonly");
    const row = await request(read.objectStore(TOKENS).get("current")) as CipherRecord | undefined;
    await complete(read);
    if (!row || row.accountId !== accountId || row.deviceFamilyId !== deviceFamilyId) return null;
    const aad = new TextEncoder().encode(`${accountId}\0${deviceFamilyId}`);
    const plaintext = await this.crypto.subtle.decrypt({ name: "AES-GCM", iv: row.iv, additionalData: aad }, await this.loadWrappingKey(), row.ciphertext);
    return { accountId, deviceFamilyId, refreshToken: new TextDecoder().decode(plaintext) };
  }

  async purge(): Promise<void> {
    const database = await this.ready();
    const transaction = database.transaction(TOKENS, "readwrite");
    transaction.objectStore(TOKENS).clear();
    await complete(transaction);
  }

  async sign(data: Uint8Array): Promise<ArrayBuffer> {
    return this.crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, (await this.loadProofKey()).privateKey, data);
  }

  async exportPrivateKey(): Promise<JsonWebKey> {
    try { return await this.crypto.subtle.exportKey("jwk", (await this.loadProofKey()).privateKey); }
    catch { throw new Error("key_not_extractable"); }
  }

  close(): void {
    this.database?.close();
    this.database = null;
    this.proofKey = null;
    this.wrappingKey = null;
  }
}
