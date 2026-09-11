import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { it } from "node:test";

import { handleG2WebSocketUpgrade } from "../src/g2/http.mjs";

function maskedTextFrame(value) {
  const body = Buffer.from(value);
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const frame = Buffer.alloc(2 + mask.length + body.length);
  frame[0] = 0x81;
  frame[1] = 0x80 | body.length;
  mask.copy(frame, 2);
  for (let index = 0; index < body.length; index += 1) frame[6 + index] = body[index] ^ mask[index % 4];
  return frame;
}

function textPayload(frame) {
  const length = frame[1] & 0x7f;
  return JSON.parse(frame.subarray(2, 2 + length).toString("utf8"));
}

it("allows transcription finalize to exceed the receive-idle window", async () => {
  const previousEnabled = process.env.G2_ENABLED;
  const previousOrigin = process.env.G2_APP_ORIGIN;
  process.env.G2_ENABLED = "1";
  process.env.G2_APP_ORIGIN = "https://com.atoms.g2.evenhub";
  try {
    let resolveFinalize;
    const providerResult = new Promise((resolve) => { resolveFinalize = resolve; });
    const writes = [];
    const endings = [];
    class FakeSocket extends EventEmitter {
      write(value) { writes.push(value); return true; }
      pause() {}
      end(value) { endings.push(value); }
    }
    const socket = new FakeSocket();
    const transcription = {
      openWebSocket: async () => ({ sessionId: "session-one", recordingId: "recording-one", nextSequence: 0 }),
      onSessionClose: () => () => {},
      finalize: () => providerResult,
      cancelSession: () => assert.fail("finalize must not be cancelled by receive-idle timeout"),
      disconnect: () => {},
      push: () => ({ nextSequence: 1 }),
    };
    const req = {
      method: "GET",
      url: "/v1/g2/transcribe/stream?ticket=g2t_one",
      headers: {
        origin: process.env.G2_APP_ORIGIN,
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-version": "13",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      },
    };

    assert.equal(await handleG2WebSocketUpgrade({
      req,
      socket,
      head: maskedTextFrame('{"type":"finalize"}'),
      transcription,
      idleTimeoutMs: 10,
    }), true);
    await sleep(25);
    assert.equal(endings.length, 0, "receive-idle timer stays disarmed during provider work");

    resolveFinalize({ state: "completed", recordingId: "recording-one", transcript: "verbatim" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(textPayload(writes.at(-1)), {
      type: "final",
      state: "completed",
      recordingId: "recording-one",
      transcript: "verbatim",
    });
    assert.equal(endings.length, 1);
  } finally {
    if (previousEnabled === undefined) delete process.env.G2_ENABLED;
    else process.env.G2_ENABLED = previousEnabled;
    if (previousOrigin === undefined) delete process.env.G2_APP_ORIGIN;
    else process.env.G2_APP_ORIGIN = previousOrigin;
  }
});
