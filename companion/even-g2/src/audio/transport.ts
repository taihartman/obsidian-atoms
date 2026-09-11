type TransportDependencies = {
  highWaterBytes: number;
  bufferedBytes(): number;
  send(sequence: number, chunk: Uint8Array): Promise<void>;
};

type QueuedChunk = { sequence: number; chunk: Uint8Array };

export class AudioTransport {
  private nextSequence = 0;
  private staged: QueuedChunk[] = [];
  private stoppedReason: string | null = null;

  constructor(private readonly dependencies: TransportDependencies) {}

  async enqueue(chunk: Uint8Array): Promise<{ state: "sent" | "staged"; sequence: number }> {
    if (this.stoppedReason) throw new Error(this.stoppedReason);
    if (chunk.byteLength % 2 !== 0) throw new Error("odd_pcm_bytes");
    const sequence = this.nextSequence++;
    if (
      this.staged.length > 0 ||
      this.dependencies.bufferedBytes() + chunk.byteLength > this.dependencies.highWaterBytes
    ) {
      this.staged.push({ sequence, chunk: chunk.slice() });
      return { state: "staged", sequence };
    }
    try {
      await this.dependencies.send(sequence, chunk);
      return { state: "sent", sequence };
    } catch {
      this.staged.push({ sequence, chunk: chunk.slice() });
      return { state: "staged", sequence };
    }
  }

  async drain(): Promise<void> {
    if (this.stoppedReason) {
      this.staged = [];
      return;
    }
    while (this.staged.length > 0) {
      const next = this.staged[0];
      if (this.dependencies.bufferedBytes() + next.chunk.byteLength > this.dependencies.highWaterBytes) return;
      try {
        await this.dependencies.send(next.sequence, next.chunk);
        this.staged.shift();
      } catch {
        return;
      }
    }
  }

  teardown(reason: "cancelled" | "permission_lost" | "background" | "revoked" | "disclosure_withdrawn"): void {
    this.stoppedReason = reason;
    this.staged = [];
  }
}

type WebSocketTransportDependencies = {
  endpoint: string;
  ticket: string;
  highWaterBytes: number;
  handshakeTimeoutMs?: number;
  socketFactory?: (url: string) => WebSocket;
};

type ReadyEnvelope = { recordingId: string; nextSequence: number };
type FinalEnvelope = { state: string; recordingId: string; transcript?: string; manualRetryRequired?: boolean };

/** Browser-safe RFC6455 client. The one-time ticket is its only URL credential. */
export class G2WebSocketTransport {
  private socket: WebSocket | null = null;
  private ticket: string;
  private readonly retained = new Map<number, Uint8Array>();
  private nextSequence = 0;
  private acknowledgedSequence = 0;
  private sendCursor = 0;
  private stoppedReason: string | null = null;
  private finalPromise: Promise<FinalEnvelope> | null = null;
  private resolveFinal: ((value: FinalEnvelope) => void) | null = null;
  private rejectFinal: ((reason: Error) => void) | null = null;
  private finalizeRequested = false;
  private finalizeSent = false;

  constructor(private readonly dependencies: WebSocketTransportDependencies) {
    this.ticket = dependencies.ticket;
  }

  loadRecovered(chunks: Array<{ sequence: number; pcm: Uint8Array }>): void {
    if (this.nextSequence !== 0 || this.retained.size !== 0) throw new Error("transport_already_started");
    for (const entry of chunks) {
      if (entry.sequence !== this.nextSequence || entry.pcm.byteLength === 0 || entry.pcm.byteLength % 2 !== 0) {
        throw new Error("invalid_recovery_sequence");
      }
      this.retained.set(entry.sequence, entry.pcm.slice());
      this.nextSequence += 1;
    }
  }

  connect(ticket = this.ticket): Promise<ReadyEnvelope> {
    this.ticket = ticket;
    const endpoint = new URL(this.dependencies.endpoint);
    if (!["https:", "http:"].includes(endpoint.protocol) || endpoint.search || endpoint.hash) {
      return Promise.reject(new Error("invalid_websocket_endpoint"));
    }
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    endpoint.searchParams.set("ticket", ticket);
    const socket = (this.dependencies.socketFactory ?? ((url) => new WebSocket(url)))(endpoint.toString());
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    return new Promise((resolve, reject) => {
      let settled = false;
      let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
      const clearHandshakeTimer = () => {
        if (handshakeTimer !== undefined) clearTimeout(handshakeTimer);
        handshakeTimer = undefined;
      };
      const failBeforeReady = (reason: string, code = 1008) => {
        if (!settled) {
          settled = true;
          clearHandshakeTimer();
          reject(new Error(reason));
        }
        socket.close(code, reason);
      };
      socket.onerror = () => {
        if (!settled) {
          settled = true;
          clearHandshakeTimer();
          reject(new Error("socket_error"));
        }
      };
      socket.onclose = () => {
        clearHandshakeTimer();
        if (this.socket === socket) this.socket = null;
        if (!settled) { settled = true; reject(new Error("socket_closed_before_ready")); }
        this.rejectFinal?.(new Error("socket_closed_before_final"));
        this.clearFinal();
      };
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") {
          if (!settled) failBeforeReady("unexpected_binary", 1003);
          else socket.close(1003, "unexpected_binary");
          return;
        }
        let message: Record<string, unknown>;
        try { message = JSON.parse(event.data) as Record<string, unknown>; }
        catch {
          if (!settled) failBeforeReady("malformed_control");
          else socket.close(1008, "malformed_control");
          return;
        }
        if (!settled) {
          if (message.type !== "ready" || typeof message.recordingId !== "string" ||
              !Number.isSafeInteger(message.nextSequence) || Number(message.nextSequence) < 0) {
            failBeforeReady("malformed_ready");
            return;
          }
          const serverSequence = Number(message.nextSequence);
          if (serverSequence > this.nextSequence) {
            failBeforeReady("server_sequence_ahead");
            return;
          }
          this.acknowledgedSequence = serverSequence;
          this.sendCursor = serverSequence;
          settled = true;
          clearHandshakeTimer();
          resolve({ recordingId: message.recordingId, nextSequence: serverSequence });
          this.flush();
          return;
        }
        if (message.type === "ack") {
          const sequence = Number(message.sequence);
          const nextSequence = Number(message.nextSequence);
          if (!Number.isSafeInteger(sequence) || !Number.isSafeInteger(nextSequence) ||
              nextSequence <= sequence || nextSequence > this.nextSequence || nextSequence > this.sendCursor) {
            socket.close(1008, "invalid_ack");
            return;
          }
          if (nextSequence > this.acknowledgedSequence) this.acknowledgedSequence = nextSequence;
          this.flush();
          this.maybeFinalize();
          return;
        }
        if (message.type === "final" && typeof message.state === "string" && typeof message.recordingId === "string") {
          if (message.state === "completed") this.retained.clear();
          this.resolveFinal?.(message as FinalEnvelope);
          this.clearFinal();
          return;
        }
        socket.close(1008, "malformed_control");
      };
      const configuredTimeout = this.dependencies.handshakeTimeoutMs ?? 10_000;
      const handshakeTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : 10_000;
      handshakeTimer = setTimeout(() => failBeforeReady("socket_handshake_timeout"), handshakeTimeoutMs);
    });
  }

  enqueue(chunk: Uint8Array): Promise<{ state: "pending" | "staged"; sequence: number }> {
    if (this.stoppedReason) return Promise.reject(new Error(this.stoppedReason));
    if (this.finalizeRequested || this.finalizeSent) return Promise.reject(new Error("finalize_pending"));
    if (chunk.byteLength === 0 || chunk.byteLength % 2 !== 0) return Promise.reject(new Error("odd_pcm_bytes"));
    const sequence = this.nextSequence++;
    this.retained.set(sequence, chunk.slice());
    this.flush();
    return Promise.resolve({ state: this.sendCursor > sequence ? "pending" : "staged", sequence });
  }

  drain(): Promise<void> {
    this.flush();
    this.maybeFinalize();
    return Promise.resolve();
  }

  finalize(): Promise<FinalEnvelope> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("socket_lost");
    if (this.finalPromise) return this.finalPromise;
    this.finalPromise = new Promise((resolve, reject) => {
      this.resolveFinal = resolve;
      this.rejectFinal = reject;
    });
    this.finalizeRequested = true;
    this.maybeFinalize();
    return this.finalPromise;
  }

  teardown(reason: "cancelled" | "permission_lost" | "background" | "revoked" | "disclosure_withdrawn"): void {
    this.stoppedReason = reason;
    this.retained.clear();
    this.socket?.close(1000, reason);
    this.socket = null;
  }

  private clearFinal(): void {
    this.finalPromise = null;
    this.resolveFinal = null;
    this.rejectFinal = null;
    this.finalizeRequested = false;
    this.finalizeSent = false;
  }

  private flush(): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1 || this.stoppedReason) return;
    while (this.sendCursor < this.nextSequence) {
      const chunk = this.retained.get(this.sendCursor);
      if (!chunk) {
        socket.close(1008, "recovery_conflict");
        return;
      }
      if (socket.bufferedAmount + chunk.byteLength + 4 > this.dependencies.highWaterBytes) return;
      const envelope = new Uint8Array(4 + chunk.byteLength);
      new DataView(envelope.buffer).setUint32(0, this.sendCursor, false);
      envelope.set(chunk, 4);
      try { socket.send(envelope); } catch { return; }
      this.sendCursor += 1;
    }
  }

  private maybeFinalize(): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1 || !this.finalizeRequested || this.finalizeSent) return;
    if (this.sendCursor !== this.nextSequence || this.acknowledgedSequence !== this.nextSequence) return;
    try {
      socket.send(JSON.stringify({ type: "finalize" }));
      this.finalizeSent = true;
      this.finalizeRequested = false;
    } catch {
      this.rejectFinal?.(new Error("socket_lost"));
      this.clearFinal();
    }
  }
}
