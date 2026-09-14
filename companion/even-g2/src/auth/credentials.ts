export type PersistentCredentialStorage = {
  load(): Promise<string>;
  save(value: string): Promise<boolean>;
};
type VaultDependencies = {
  indexedDB?: IDBFactory;
  crypto?: Crypto;
  databaseName?: string;
  persistentStorage?: PersistentCredentialStorage;
};
type RefreshRecord = { accountId: string; deviceFamilyId: string; refreshToken: string };
type CipherRecord = { accountId: string; deviceFamilyId: string; iv: Uint8Array; ciphertext: ArrayBuffer };
type PersistentCredentialRecord = {
  version: 1;
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
  refresh?: RefreshRecord;
};

const VERSION = 1;
const KEYS = "keys";
const TOKENS = "tokens";
const PROOF_LEGACY = "proof";
const PROOF_PRIVATE = "proof-private";
const PROOF_PUBLIC = "proof-public";

function validPublicJwk(value: JsonWebKey): boolean {
  return value.kty === "EC" && value.crv === "P-256" &&
    typeof value.x === "string" && value.x.length > 0 &&
    typeof value.y === "string" && value.y.length > 0 && value.d === undefined;
}

function validPrivateJwk(value: JsonWebKey): boolean {
  return validPublicJwk({ ...value, d: undefined }) && typeof value.d === "string" && value.d.length > 0;
}

function parsePersistentCredential(raw: string): PersistentCredentialRecord | null {
  try {
    const value = JSON.parse(raw) as Partial<PersistentCredentialRecord>;
    if (value.version !== 1 || !value.privateJwk || !value.publicJwk ||
      !validPrivateJwk(value.privateJwk) || !validPublicJwk(value.publicJwk)) return null;
    if (value.refresh && (typeof value.refresh.accountId !== "string" ||
      typeof value.refresh.deviceFamilyId !== "string" || typeof value.refresh.refreshToken !== "string")) return null;
    return value as PersistentCredentialRecord;
  } catch {
    return null;
  }
}

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
  private readonly persistentStorage?: PersistentCredentialStorage;
  private database: IDBDatabase | null = null;
  private proofKey: CryptoKeyPair | null = null;
  private wrappingKey: CryptoKey | null = null;
  private persistentRecord: PersistentCredentialRecord | null = null;

  constructor(dependencies: VaultDependencies = {}) {
    if (!dependencies.indexedDB && !globalThis.indexedDB) throw new Error("indexeddb_unavailable");
    if (!dependencies.crypto && !globalThis.crypto) throw new Error("webcrypto_unavailable");
    this.factory = dependencies.indexedDB ?? globalThis.indexedDB;
    this.crypto = dependencies.crypto ?? globalThis.crypto;
    this.name = dependencies.databaseName ?? "atoms-g2-credentials";
    this.persistentStorage = dependencies.persistentStorage;
  }

  private async ready(): Promise<IDBDatabase> {
    this.database ??= await open(this.factory, this.name);
    return this.database;
  }

  private async proofKeyIsUsable(pair: CryptoKeyPair): Promise<boolean> {
    const probe = new TextEncoder().encode("atoms-g2-proof-key");
    try {
      const signature = await this.crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        pair.privateKey,
        probe,
      );
      return this.crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        pair.publicKey,
        signature,
        probe,
      );
    } catch {
      return false;
    }
  }

  private async storeProofKey(database: IDBDatabase, pair: CryptoKeyPair): Promise<void> {
    const write = database.transaction(KEYS, "readwrite");
    const keyStore = write.objectStore(KEYS);
    keyStore.put(pair.privateKey, PROOF_PRIVATE);
    keyStore.put(pair.publicKey, PROOF_PUBLIC);
    keyStore.delete(PROOF_LEGACY);
    await complete(write);
  }

  private async importPersistentProof(record: PersistentCredentialRecord): Promise<CryptoKeyPair> {
    const privateKey = await this.crypto.subtle.importKey(
      "jwk", record.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
    );
    const publicKey = await this.crypto.subtle.importKey(
      "jwk", record.publicJwk, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"],
    );
    return { privateKey, publicKey };
  }

  private async savePersistentRecord(record: PersistentCredentialRecord): Promise<void> {
    if (!this.persistentStorage || !await this.persistentStorage.save(JSON.stringify(record))) {
      throw new Error("persistent_credential_unavailable");
    }
    this.persistentRecord = record;
  }

  private async createPersistentProof(database: IDBDatabase): Promise<CryptoKeyPair> {
    const exportable = await this.crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"],
    );
    const record: PersistentCredentialRecord = {
      version: 1,
      privateJwk: await this.crypto.subtle.exportKey("jwk", exportable.privateKey),
      publicJwk: await this.crypto.subtle.exportKey("jwk", exportable.publicKey),
    };
    const pair = await this.importPersistentProof(record);
    if (!await this.proofKeyIsUsable(pair)) throw new Error("persistent_credential_unavailable");
    await this.savePersistentRecord(record);
    await this.storeProofKey(database, pair);
    return pair;
  }

  async createOrLoadProofKey(): Promise<JsonWebKey> {
    if (this.proofKey) return this.crypto.subtle.exportKey("jwk", this.proofKey.publicKey);
    const database = await this.ready();
    if (this.persistentStorage) {
      const record = parsePersistentCredential(await this.persistentStorage.load());
      if (record) {
        try {
          const pair = await this.importPersistentProof(record);
          if (await this.proofKeyIsUsable(pair)) {
            this.proofKey = pair;
            this.persistentRecord = record;
            await this.storeProofKey(database, pair);
            return this.crypto.subtle.exportKey("jwk", pair.publicKey);
          }
        } catch {
          // Invalid or unusable native credentials fail closed into a new identity.
        }
      }
      this.proofKey = await this.createPersistentProof(database);
      return this.crypto.subtle.exportKey("jwk", this.proofKey.publicKey);
    }
    const transaction = database.transaction(KEYS, "readonly");
    const store = transaction.objectStore(KEYS);
    const [privateKey, publicKey, legacy] = await Promise.all([
      request(store.get(PROOF_PRIVATE)) as Promise<CryptoKey | undefined>,
      request(store.get(PROOF_PUBLIC)) as Promise<CryptoKey | undefined>,
      request(store.get(PROOF_LEGACY)) as Promise<CryptoKeyPair | undefined>,
    ]);
    await complete(transaction);
    const stored = privateKey && publicKey
      ? { privateKey, publicKey }
      : legacy?.privateKey && legacy.publicKey
        ? legacy
        : null;
    if (stored && await this.proofKeyIsUsable(stored)) {
      this.proofKey = stored;
      if ((!privateKey || !publicKey) && legacy) await this.storeProofKey(database, stored);
    } else {
      this.proofKey = await this.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
      await this.storeProofKey(database, this.proofKey);
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
    if (this.persistentStorage) {
      if (!this.persistentRecord) await this.createOrLoadProofKey();
      if (!this.persistentRecord) throw new Error("persistent_credential_unavailable");
      await this.savePersistentRecord({ ...this.persistentRecord, refresh: record });
    }
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
    if (this.persistentStorage) {
      if (!this.persistentRecord) await this.createOrLoadProofKey();
      const record = this.persistentRecord?.refresh;
      return record && record.accountId === accountId && record.deviceFamilyId === deviceFamilyId
        ? { ...record }
        : null;
    }
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
    if (this.persistentStorage && !await this.persistentStorage.save("")) {
      throw new Error("persistent_credential_unavailable");
    }
    this.persistentRecord = null;
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
    this.persistentRecord = null;
  }
}
