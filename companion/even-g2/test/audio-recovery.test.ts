import { webcrypto } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

import { PcmRecorder } from "../src/audio/recorder";
import { EvenAudioSession } from "../src/platform/audio";
import { RecoveryJournal } from "../src/storage/recovery";
import { AudioTransport, G2WebSocketTransport } from "../src/audio/transport";

const crypto = webcrypto as unknown as Crypto;

describe("G2 audio recovery", () => {
  it("stages account/device-bound encrypted arbitrary chunks across a cold restart without duplication", async () => {
    const indexedDB = new IDBFactory();
    const first = new RecoveryJournal({ indexedDB, crypto, databaseName: "cold" });
    await first.open("owner@atoms.test", "g2d-one");
    await first.start("rec-1", "2026-09-09T12:00:00-04:00");
    await first.append("rec-1", 0, new Uint8Array([1, 2]));
    await first.append("rec-1", 1, new Uint8Array([3, 4, 5, 6]));
    first.close();

    const cold = new RecoveryJournal({ indexedDB, crypto, databaseName: "cold" });
    await cold.open("owner@atoms.test", "g2d-one");
    const restored = await cold.restore("rec-1");
    expect(restored?.nextSequence).toBe(2);
    expect(Array.from(restored?.pcm ?? [])).toEqual([1, 2, 3, 4, 5, 6]);
    await expect(cold.append("rec-1", 1, new Uint8Array([3, 4]))).rejects.toThrow("sequence_gap");
  });

  it("purges content on account switch and keeps the exact transcript until preparation is durable", async () => {
    const indexedDB = new IDBFactory();
    const journal = new RecoveryJournal({ indexedDB, crypto, databaseName: "binding" });
    await journal.open("a@atoms.test", "g2d-a");
    await journal.start("rec-a", "2026-09-09T12:00:00Z");
    await journal.append("rec-a", 0, new Uint8Array([1, 2]));
    journal.close();

    const switched = new RecoveryJournal({ indexedDB, crypto, databaseName: "binding" });
    await switched.open("b@atoms.test", "g2d-b");
    expect(await switched.restore("rec-a")).toBeNull();

    await switched.start("rec-b", "2026-09-09T12:01:00Z");
    await switched.append("rec-b", 0, new Uint8Array([3, 4]));
    const transcript = "  exact\r\ntranscript 🌱  ";
    await switched.completeTranscription("rec-b", "tx-b", transcript);
    const terminal = await switched.restore("rec-b");
    expect(terminal).toMatchObject({ state: "transcribed", transcriptionId: "tx-b", transcript, nextSequence: 1 });
    expect(terminal?.chunks).toEqual([]);
    expect(terminal?.pcm).toEqual(new Uint8Array());
    await expect(switched.completeTranscription("rec-b", "tx-b", `${transcript}!`)).rejects.toThrow("transcription_conflict");
    await switched.completePreparation("rec-b");
    expect(await switched.restore("rec-b")).toBeNull();
  });

  it("stores PCM as incremental encrypted chunk rows instead of rewriting one journal blob", async () => {
    const indexedDB = new IDBFactory();
    const journal = new RecoveryJournal({ indexedDB, crypto, databaseName: "incremental" });
    await journal.open("owner@atoms.test", "g2d-one");
    await journal.start("rec-incremental", "2026-09-09T12:00:00Z");
    await journal.append("rec-incremental", 0, new Uint8Array([1, 2]));
    await journal.append("rec-incremental", 1, new Uint8Array([3, 4]));

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open("incremental");
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    expect(Array.from(database.objectStoreNames)).toContain("chunks");
    const read = database.transaction(["journals", "chunks"], "readonly");
    expect(Array.from(read.objectStore("chunks").indexNames)).toContain("by-recording-id");
    const journalRows = await new Promise<unknown[]>((resolve) => { const request = read.objectStore("journals").getAll(); request.onsuccess = () => resolve(request.result); });
    const chunkRows = await new Promise<unknown[]>((resolve) => { const request = read.objectStore("chunks").getAll(); request.onsuccess = () => resolve(request.result); });
    expect(journalRows).toHaveLength(1);
    expect(chunkRows).toHaveLength(2);
    database.close();
  });

  it("upgrades and recovers the encrypted v1 whole-journal format", async () => {
    const indexedDB = new IDBFactory();
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open("legacy-whole-journal", 1);
      opening.onupgradeneeded = () => {
        opening.result.createObjectStore("meta");
        opening.result.createObjectStore("keys");
        opening.result.createObjectStore("journals");
      };
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const binding = { accountId: "owner@atoms.test", deviceFamilyId: "g2d-one" };
    const legacy = {
      recordingId: "rec-legacy", capturedAt: "2026-09-09T12:00:00Z", revision: 3,
      nextSequence: 2, chunks: [[1, 2], [3, 4]], expiresAt: Date.now() + 60_000,
    };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const additionalData = new TextEncoder().encode(`${binding.accountId}\0${binding.deviceFamilyId}`);
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, key, new TextEncoder().encode(JSON.stringify(legacy)));
    const write = database.transaction(["meta", "keys", "journals"], "readwrite");
    write.objectStore("meta").put(binding, "binding");
    write.objectStore("keys").put(key, "content");
    write.objectStore("journals").put({ iv, ciphertext, expiresAt: legacy.expiresAt }, legacy.recordingId);
    await new Promise<void>((resolve, reject) => { write.oncomplete = () => resolve(); write.onerror = () => reject(write.error); });
    database.close();

    const upgraded = new RecoveryJournal({ indexedDB, crypto, databaseName: "legacy-whole-journal" });
    await upgraded.open(binding.accountId, binding.deviceFamilyId);
    expect(await upgraded.restore(legacy.recordingId)).toMatchObject({
      state: "recording", nextSequence: 2,
      chunks: [{ sequence: 0, pcm: new Uint8Array([1, 2]) }, { sequence: 1, pcm: new Uint8Array([3, 4]) }],
    });
  });

  it("rolls back a denied microphone setup and ignores late PCM", async () => {
    const journal = new RecoveryJournal({ indexedDB: new IDBFactory(), crypto, databaseName: "denied" });
    await journal.open("owner@atoms.test", "g2d-one");
    const teardown = vi.fn();
    const checkpoint = { save: vi.fn(async (_value: { recordingId: string; purpose: "create" | "query" }) => undefined), clear: vi.fn(async () => undefined) };
    const bridge = { audioControl: vi.fn(async (enabled: boolean) => !enabled) };
    const audio = new EvenAudioSession(
      bridge as never,
      { ticket: async () => ({ ticket: "g2t_denied" }) },
      journal,
      "https://plus.tryatoms.app/v1/g2/transcribe/stream",
      checkpoint,
      { transportFactory: () => ({ connect: async () => ({ recordingId: "rec", nextSequence: 0 }), enqueue: vi.fn(), finalize: vi.fn(), teardown }) as never },
    );

    await expect(audio.start("create")).rejects.toThrow("microphone_denied");
    audio.accept(new Uint8Array([1, 2]));
    expect(teardown).toHaveBeenCalled();
    expect(checkpoint.clear).toHaveBeenCalled();
    const pointer = checkpoint.save.mock.calls[0]?.[0];
    expect(pointer?.recordingId && await journal.restore(pointer.recordingId)).toBeNull();
  });

  it("keeps an exact completed transcript and wake-up pointer until preparation handoff", async () => {
    const journal = new RecoveryJournal({ indexedDB: new IDBFactory(), crypto, databaseName: "handoff" });
    await journal.open("owner@atoms.test", "g2d-one");
    const transcript = "  exact\r\ntranscript 🌱  ";
    const checkpoint = { save: vi.fn(async (_value: { recordingId: string; purpose: "create" | "query" }) => undefined), clear: vi.fn(async () => undefined) };
    const bridge = { audioControl: vi.fn(async () => true) };
    const audio = new EvenAudioSession(
      bridge as never,
      { ticket: async () => ({ ticket: "g2t_handoff" }) },
      journal,
      "https://plus.tryatoms.app/v1/g2/transcribe/stream",
      checkpoint,
      { transportFactory: () => ({
        connect: async () => ({ recordingId: "rec", nextSequence: 0 }),
        loadRecovered: vi.fn(), enqueue: vi.fn(), teardown: vi.fn(),
        finalize: async () => ({ state: "completed", recordingId: "rec", transcript }),
      }) as never },
    );

    await audio.start("create");
    const pointer = checkpoint.save.mock.calls[0]?.[0];
    if (!pointer) throw new Error("missing_checkpoint");
    const completed = await audio.stop();
    expect(completed.transcript).toBe(transcript);
    expect(checkpoint.clear).not.toHaveBeenCalled();
    expect(await journal.restore(pointer.recordingId)).toMatchObject({ state: "transcribed", transcript });

    await completed.completeHandoff();
    expect(checkpoint.clear).toHaveBeenCalledOnce();
    expect(await journal.restore(pointer.recordingId)).toBeNull();
  });

  it("cancels an unfinished setup before late socket readiness can enable the microphone", async () => {
    const journal = new RecoveryJournal({ indexedDB: new IDBFactory(), crypto, databaseName: "setup-cancel" });
    await journal.open("owner@atoms.test", "g2d-one");
    let releaseConnect!: () => void;
    const checkpoint = { save: vi.fn(async (_value: { recordingId: string; purpose: "create" | "query" }) => undefined), clear: vi.fn(async () => undefined) };
    const bridge = { audioControl: vi.fn(async () => true) };
    const teardown = vi.fn();
    const audio = new EvenAudioSession(
      bridge as never,
      { ticket: async () => ({ ticket: "g2t_cancel" }) },
      journal,
      "https://plus.tryatoms.app/v1/g2/transcribe/stream",
      checkpoint,
      { transportFactory: () => ({
        connect: () => new Promise((resolve) => { releaseConnect = () => resolve({ recordingId: "rec", nextSequence: 0 }); }),
        loadRecovered: vi.fn(), enqueue: vi.fn(), finalize: vi.fn(), teardown,
      }) as never },
    );

    const starting = audio.start("create");
    await vi.waitFor(() => expect(releaseConnect).toBeTypeOf("function"));
    const pointer = checkpoint.save.mock.calls[0]?.[0];
    if (!pointer) throw new Error("missing_checkpoint");
    await audio.teardown("background");
    releaseConnect();
    await expect(starting).rejects.toThrow("recording_start_cancelled");
    expect(bridge.audioControl).not.toHaveBeenCalledWith(true, expect.anything());
    expect(teardown).toHaveBeenCalled();
    expect(await journal.restore(pointer.recordingId)).toBeNull();
  });

  it("manually retries failed transcription from durable PCM with a fresh ticket", async () => {
    const journal = new RecoveryJournal({ indexedDB: new IDBFactory(), crypto, databaseName: "manual-retry" });
    await journal.open("owner@atoms.test", "g2d-one");
    const ticket = vi.fn()
      .mockResolvedValueOnce({ ticket: "g2t_first" })
      .mockResolvedValueOnce({ ticket: "g2t_retry" });
    const recovered: Array<Array<{ sequence: number; pcm: Uint8Array }>> = [];
    let transportIndex = 0;
    const audio = new EvenAudioSession(
      { audioControl: vi.fn(async () => true) } as never,
      { ticket },
      journal,
      "https://plus.tryatoms.app/v1/g2/transcribe/stream",
      undefined,
      { transportFactory: () => {
        const index = transportIndex++;
        return {
          connect: async () => ({ recordingId: "rec", nextSequence: 0 }),
          loadRecovered: (chunks: Array<{ sequence: number; pcm: Uint8Array }>) => { recovered.push(chunks); },
          enqueue: async () => ({ state: "pending", sequence: 0 }),
          finalize: async () => {
            if (index === 0) throw new Error("socket_lost");
            return { state: "completed", recordingId: "rec", transcript: "exact retry" };
          },
          teardown: vi.fn(),
        } as never;
      } },
    );

    await audio.start("create");
    audio.accept(new Uint8Array([1, 2]));
    await expect(audio.stop()).rejects.toThrow("socket_lost");
    await expect(audio.stop()).resolves.toMatchObject({ transcript: "exact retry" });
    expect(ticket).toHaveBeenCalledTimes(2);
    expect(recovered).toEqual([[{ sequence: 0, pcm: new Uint8Array([1, 2]) }]]);
  });

  it("refuses to journal beyond the two-minute byte bound", async () => {
    const journal = new RecoveryJournal({
      indexedDB: new IDBFactory(),
      crypto,
      databaseName: "bounded",
      maxBytes: 4,
    });
    await journal.open("owner@atoms.test", "g2d-one");
    await journal.start("rec-limit", "2026-09-09T12:00:00Z");
    await journal.append("rec-limit", 0, new Uint8Array([1, 2, 3, 4]));
    await expect(journal.append("rec-limit", 1, new Uint8Array([5, 6]))).rejects.toThrow("recording_limit");
  });

  it("pauses before backpressure overflow and teardown prevents stale sends", async () => {
    const sent: number[] = [];
    let buffered = 0;
    const transport = new AudioTransport({
      highWaterBytes: 4,
      bufferedBytes: () => buffered,
      send: async (sequence, chunk) => { sent.push(sequence, ...chunk); },
    });
    expect(await transport.enqueue(new Uint8Array([1, 2]))).toEqual({ state: "sent", sequence: 0 });
    buffered = 4;
    expect(await transport.enqueue(new Uint8Array([3, 4]))).toEqual({ state: "staged", sequence: 1 });
    transport.teardown("revoked");
    buffered = 0;
    await transport.drain();
    expect(sent).toEqual([0, 1, 2]);
    await expect(transport.enqueue(new Uint8Array([5, 6]))).rejects.toThrow("revoked");
  });

  it("stages a failed send and preserves sequence order until reconnect drains", async () => {
    const sent: number[] = [];
    let connected = false;
    const transport = new AudioTransport({
      highWaterBytes: 8,
      bufferedBytes: () => 0,
      send: async (sequence) => {
        if (!connected) throw new Error("socket_lost");
        sent.push(sequence);
      },
    });
    expect(await transport.enqueue(new Uint8Array([1, 2]))).toEqual({ state: "staged", sequence: 0 });
    expect(await transport.enqueue(new Uint8Array([3, 4]))).toEqual({ state: "staged", sequence: 1 });
    connected = true;
    await transport.drain();
    expect(sent).toEqual([0, 1]);
  });

  it("recorder accepts even PCM only and stops on lifecycle gates or two-minute bound", () => {
    const recorder = new PcmRecorder({ maxBytes: 6 });
    recorder.start();
    expect(recorder.capture(new Uint8Array([1, 2, 3, 4]))).toBe(4);
    expect(() => recorder.capture(new Uint8Array([5]))).toThrow("odd_pcm_bytes");
    expect(() => recorder.capture(new Uint8Array([5, 6, 7, 8]))).toThrow("recording_limit");
    recorder.stop("background");
    expect(() => recorder.capture(new Uint8Array([5, 6]))).toThrow("background");
  });

  it("uses the ticket-only RFC6455 contract and sends binary sequence envelopes", async () => {
    class FakeSocket {
      static readonly OPEN = 1;
      readonly OPEN = 1;
      readyState = 0;
      bufferedAmount = 0;
      binaryType = "";
      sent: Array<string | ArrayBufferLike | Blob | ArrayBufferView> = [];
      closed: [number?, string?] | null = null;
      onopen: (() => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      send(value: string | ArrayBufferLike | Blob | ArrayBufferView) { this.sent.push(value); }
      close(code?: number, reason?: string) { this.closed = [code, reason]; this.readyState = 3; this.onclose?.(); }
      open() { this.readyState = 1; this.onopen?.(); }
      message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent); }
    }
    let socket!: FakeSocket;
    let openedUrl = "";
    const transport = new G2WebSocketTransport({
      endpoint: "https://plus.tryatoms.app/v1/g2/transcribe/stream",
      ticket: "g2t_one_time",
      highWaterBytes: 64,
      socketFactory(url) { openedUrl = url; socket = new FakeSocket(); return socket as unknown as WebSocket; },
    });
    const connected = transport.connect();
    socket.open();
    socket.message({ type: "ready", recordingId: "rec-ws", nextSequence: 0 });
    await expect(connected).resolves.toEqual({ recordingId: "rec-ws", nextSequence: 0 });
    expect(openedUrl).toBe("wss://plus.tryatoms.app/v1/g2/transcribe/stream?ticket=g2t_one_time");
    expect(openedUrl).not.toContain("g2a_");
    expect(openedUrl).not.toContain("g2r_");

    await expect(transport.enqueue(new Uint8Array([9, 8]))).resolves.toEqual({ state: "pending", sequence: 0 });
    const binary = new Uint8Array(socket.sent[0] as ArrayBuffer);
    expect(Array.from(binary)).toEqual([0, 0, 0, 0, 9, 8]);
    socket.message({ type: "ack", sequence: 0, nextSequence: 1, duplicate: false });
    const final = transport.finalize();
    expect(socket.sent[1]).toBe('{"type":"finalize"}');
    socket.message({ type: "final", state: "completed", recordingId: "rec-ws", transcript: "verbatim" });
    await expect(final).resolves.toEqual({ type: "final", state: "completed", recordingId: "rec-ws", transcript: "verbatim" });
    transport.teardown("disclosure_withdrawn");
    expect(socket.closed).toEqual([1000, "disclosure_withdrawn"]);
  });

  it("closes and rejects a connection that never completes its handshake", async () => {
    vi.useFakeTimers();
    try {
      const socket = {
        readyState: 0,
        bufferedAmount: 0,
        binaryType: "",
        onopen: null as (() => void) | null,
        onmessage: null as ((event: MessageEvent) => void) | null,
        onerror: null as (() => void) | null,
        onclose: null as (() => void) | null,
        send() {},
        close: vi.fn(function (this: { readyState: number; onclose: (() => void) | null }) {
          this.readyState = 3;
          this.onclose?.();
        }),
      };
      const transport = new G2WebSocketTransport({
        endpoint: "https://plus.tryatoms.app/v1/g2/transcribe/stream",
        ticket: "g2t_silent",
        highWaterBytes: 64,
        handshakeTimeoutMs: 25,
        socketFactory: () => socket as unknown as WebSocket,
      });

      const connected = transport.connect();
      const rejection = expect(connected).rejects.toThrow("socket_handshake_timeout");
      await vi.advanceTimersByTimeAsync(25);

      await rejection;
      expect(socket.close).toHaveBeenCalledWith(1008, "socket_handshake_timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("replays unacknowledged PCM after disconnect and rejects impossible server progress", async () => {
    const sockets: Array<{
      readyState: number; bufferedAmount: number; binaryType: string; sent: unknown[];
      onopen: (() => void) | null; onmessage: ((event: MessageEvent) => void) | null;
      onerror: (() => void) | null; onclose: (() => void) | null;
      send(value: unknown): void; close(): void; open(): void; message(value: unknown): void;
    }> = [];
    const transport = new G2WebSocketTransport({
      endpoint: "https://plus.tryatoms.app/v1/g2/transcribe/stream", ticket: "g2t_first", highWaterBytes: 64,
      socketFactory() {
        const value = {
          readyState: 0, bufferedAmount: 0, binaryType: "", sent: [] as unknown[],
          onopen: null as (() => void) | null, onmessage: null as ((event: MessageEvent) => void) | null,
          onerror: null as (() => void) | null, onclose: null as (() => void) | null,
          send(item: unknown) { this.sent.push(item); },
          close() { this.readyState = 3; this.onclose?.(); },
          open() { this.readyState = 1; this.onopen?.(); },
          message(item: unknown) { this.onmessage?.({ data: JSON.stringify(item) } as MessageEvent); },
        };
        sockets.push(value); return value as unknown as WebSocket;
      },
    });
    const first = transport.connect(); sockets[0].open(); sockets[0].message({ type: "ready", recordingId: "rec-replay", nextSequence: 0 }); await first;
    await transport.enqueue(new Uint8Array([7, 6]));
    expect(sockets[0].sent).toHaveLength(1);
    sockets[0].close();

    const reconnect = transport.connect("g2t_second"); sockets[1].open(); sockets[1].message({ type: "ready", recordingId: "rec-replay", nextSequence: 0 }); await reconnect;
    expect(sockets[1].sent).toHaveLength(1);
    expect(Array.from(new Uint8Array(sockets[1].sent[0] as ArrayBuffer))).toEqual([0, 0, 0, 0, 7, 6]);
    sockets[1].message({ type: "ack", sequence: 0, nextSequence: 1, duplicate: false });
    sockets[1].message({ type: "ack", sequence: 0, nextSequence: 1, duplicate: true });
    expect(sockets[1].sent).toHaveLength(1);

    sockets[1].close();
    const impossible = transport.connect("g2t_third"); sockets[2].open(); sockets[2].message({ type: "ready", recordingId: "rec-replay", nextSequence: 2 });
    await expect(impossible).rejects.toThrow("server_sequence_ahead");
  });

  it("reconciles cold-restart journal chunks from the server's durable next sequence", async () => {
    const indexedDB = new IDBFactory();
    const first = new RecoveryJournal({ indexedDB, crypto, databaseName: "ws-cold" });
    await first.open("owner@atoms.test", "g2d-one");
    await first.start("rec-cold-ws", "2026-09-09T12:00:00Z");
    await first.append("rec-cold-ws", 0, new Uint8Array([1, 2]));
    await first.append("rec-cold-ws", 1, new Uint8Array([3, 4]));
    first.close();
    const cold = new RecoveryJournal({ indexedDB, crypto, databaseName: "ws-cold" });
    await cold.open("owner@atoms.test", "g2d-one");
    const restored = await cold.restore("rec-cold-ws");

    const sent: unknown[] = [];
    const socket = {
      readyState: 0, bufferedAmount: 0, binaryType: "", onopen: null as (() => void) | null,
      onmessage: null as ((event: MessageEvent) => void) | null, onerror: null, onclose: null,
      send(value: unknown) { sent.push(value); }, close() {},
    };
    const transport = new G2WebSocketTransport({
      endpoint: "https://plus.tryatoms.app/v1/g2/transcribe/stream", ticket: "g2t_cold", highWaterBytes: 64,
      socketFactory: () => socket as unknown as WebSocket,
    });
    transport.loadRecovered(restored?.chunks ?? []);
    const connected = transport.connect(); socket.readyState = 1; socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ type: "ready", recordingId: "rec-cold-ws", nextSequence: 1 }) } as MessageEvent);
    await connected;
    expect(sent).toHaveLength(1);
    expect(Array.from(new Uint8Array(sent[0] as ArrayBuffer))).toEqual([0, 0, 0, 1, 3, 4]);
  });

  it("queues finalize until acknowledgements flush every backpressured chunk", async () => {
    const sent: unknown[] = [];
    const socket = {
      readyState: 0, bufferedAmount: 0, binaryType: "", onopen: null as (() => void) | null,
      onmessage: null as ((event: MessageEvent) => void) | null, onerror: null,
      onclose: null as (() => void) | null,
      send(value: unknown) { sent.push(value); this.bufferedAmount = typeof value === "string" ? 0 : 6; },
      close() { this.readyState = 3; this.onclose?.(); },
    };
    const transport = new G2WebSocketTransport({
      endpoint: "https://plus.tryatoms.app/v1/g2/transcribe/stream", ticket: "g2t_backpressure",
      highWaterBytes: 6, socketFactory: () => socket as unknown as WebSocket,
    });
    const connected = transport.connect(); socket.readyState = 1; socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ type: "ready", recordingId: "rec-backpressure", nextSequence: 0 }) } as MessageEvent);
    await connected;
    await transport.enqueue(new Uint8Array([1, 2]));
    await transport.enqueue(new Uint8Array([3, 4]));
    expect(sent).toHaveLength(1);

    const final = transport.finalize();
    expect(sent).toHaveLength(1);
    socket.bufferedAmount = 0;
    socket.onmessage?.({ data: JSON.stringify({ type: "ack", sequence: 0, nextSequence: 1 }) } as MessageEvent);
    expect(sent).toHaveLength(2);
    expect(typeof sent[1]).not.toBe("string");
    socket.bufferedAmount = 0;
    socket.onmessage?.({ data: JSON.stringify({ type: "ack", sequence: 1, nextSequence: 2 }) } as MessageEvent);
    expect(sent).toHaveLength(3);
    expect(sent[2]).toBe('{"type":"finalize"}');
    socket.onmessage?.({ data: JSON.stringify({ type: "final", state: "completed", recordingId: "rec-backpressure", transcript: "all bytes" }) } as MessageEvent);
    await expect(final).resolves.toMatchObject({ state: "completed", transcript: "all bytes" });
  });

  it("fails a queued finalize closed when the socket disconnects before acknowledgement", async () => {
    const socket = {
      readyState: 0, bufferedAmount: 0, binaryType: "", onopen: null as (() => void) | null,
      onmessage: null as ((event: MessageEvent) => void) | null, onerror: null,
      onclose: null as (() => void) | null, send() {},
      close() { this.readyState = 3; this.onclose?.(); },
    };
    const transport = new G2WebSocketTransport({
      endpoint: "https://plus.tryatoms.app/v1/g2/transcribe/stream", ticket: "g2t_finalize_disconnect",
      highWaterBytes: 6, socketFactory: () => socket as unknown as WebSocket,
    });
    const connected = transport.connect(); socket.readyState = 1; socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ type: "ready", recordingId: "rec-finalize-disconnect", nextSequence: 0 }) } as MessageEvent);
    await connected;
    await transport.enqueue(new Uint8Array([1, 2]));
    const final = transport.finalize();
    socket.close();
    await expect(final).rejects.toThrow("socket_closed_before_final");
  });
});
