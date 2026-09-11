import { webcrypto } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { AppRecoveryStore } from "../src/storage/appRecovery";
import { RecoveryJournal } from "../src/storage/recovery";
import type { CreateRecoveryRecord } from "../src/app/createFlow";

const crypto = webcrypto as unknown as Crypto;
const prepared: CreateRecoveryRecord = {
  state: "prepared", recordingId: "rec", capturedAt: "2026-09-09T00:00:00Z",
  preparationId: "g2p_one", fingerprint: "fp", title: "Title", body: "verbatim",
  expiresAt: "2026-09-09T00:15:00Z",
};

async function removeExpiry(indexedDB: IDBFactory, databaseName: string, storeName: string, key: string): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open(databaseName);
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  const transaction = database.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  const row = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const reading = store.get(key);
    reading.onsuccess = () => resolve(reading.result as Record<string, unknown>);
    reading.onerror = () => reject(reading.error);
  });
  delete row.expiresAt;
  store.put(row, key);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

describe("G2 local retention", () => {
  it("sweeps expired proposal recovery on open", async () => {
    const indexedDB = new IDBFactory(); let now = Date.parse("2026-09-09T00:00:00Z");
    const first = new AppRecoveryStore({ indexedDB, crypto, databaseName: "app-expiry", now: () => now });
    await first.open("owner", "device"); await first.save(prepared);
    now += 16 * 60 * 1000;
    const cold = new AppRecoveryStore({ indexedDB, crypto, databaseName: "app-expiry", now: () => now });
    await cold.open("owner", "device");
    expect(await cold.load()).toBeNull();
  });

  it("sweeps expired raw audio and retains only the terminal transcript until handoff", async () => {
    const indexedDB = new IDBFactory(); let now = 1_000;
    const journal = new RecoveryJournal({ indexedDB, crypto, databaseName: "audio-expiry", now: () => now, retentionMs: 100 });
    await journal.open("owner", "device"); await journal.start("expired", "2026-09-09T00:00:00Z");
    now = 1_101; journal.close();
    const cold = new RecoveryJournal({ indexedDB, crypto, databaseName: "audio-expiry", now: () => now, retentionMs: 100 });
    await cold.open("owner", "device"); expect(await cold.restore("expired")).toBeNull();
    await cold.start("terminal", "2026-09-09T00:01:00Z"); await cold.append("terminal", 0, new Uint8Array([1, 2]));
    await cold.completeTranscription("terminal", "tx", "exact");
    expect(await cold.restore("terminal")).toMatchObject({ state: "transcribed", transcript: "exact", chunks: [] });
    await cold.completePreparation("terminal");
    expect(await cold.restore("terminal")).toBeNull();
  });

  it("purges legacy U7 rows with no expiry instead of retaining them forever", async () => {
    const indexedDB = new IDBFactory();
    const app = new AppRecoveryStore({ indexedDB, crypto, databaseName: "legacy-app", now: () => 1_000 });
    await app.open("owner", "device"); await app.save(prepared);
    await removeExpiry(indexedDB, "legacy-app", "records", "create");
    const appCold = new AppRecoveryStore({ indexedDB, crypto, databaseName: "legacy-app", now: () => 1_000 });
    await appCold.open("owner", "device"); expect(await appCold.load()).toBeNull();

    const audio = new RecoveryJournal({ indexedDB, crypto, databaseName: "legacy-audio", now: () => 1_000 });
    await audio.open("owner", "device"); await audio.start("legacy", "2026-09-09T00:00:00Z"); audio.close();
    await removeExpiry(indexedDB, "legacy-audio", "journals", "legacy");
    const audioCold = new RecoveryJournal({ indexedDB, crypto, databaseName: "legacy-audio", now: () => 1_000 });
    await audioCold.open("owner", "device"); expect(await audioCold.restore("legacy")).toBeNull();
  });
});
