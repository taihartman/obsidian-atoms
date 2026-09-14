import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleMirrorRoutes } from "../src/mirror/http.mjs";

async function ackRequest({ body, row, ackResult, email = "g2-ack@ex.co" }) {
  let ackOptions = null;
  let response = null;
  const store = {
    accountFromSession: async () => ({
      email,
      status: "active",
      periodEnd: new Date(Date.now() + 60_000).toISOString(),
    }),
    outboxGet: async () => row,
    outboxAck: async (_email, opts) => {
      ackOptions = opts;
      return ackResult ?? { ok: true, id: opts.id, status: opts.status };
    },
  };
  const handled = await handleMirrorRoutes({
    req: {
      method: "POST",
      headers: { "x-forwarded-for": `test-${Math.random()}` },
      socket: { remoteAddress: "127.0.0.1" },
    },
    res: {},
    path: "/v1/ask/outbox/ack",
    store,
    bearer: () => "sess_test",
    json: (_res, status, value) => {
      response = { status, value };
    },
    readBody: async () => body,
  });
  return { handled, ackOptions, response };
}

describe("G2 outbox acknowledgement HTTP contract", () => {
  const g2Row = {
    id: "obx_g2",
    kind: "create",
    payload: { origin: "g2", title: "Exact capture" },
  };

  it("forwards the exact normalized custom-folder target for an applied G2 create", async () => {
    const result = await ackRequest({
      body: {
        id: "obx_g2",
        status: "applied",
        target_path: "Memory Shelf/Exact capture.md",
      },
      row: g2Row,
    });
    assert.equal(result.handled, true);
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.ackOptions, {
      id: "obx_g2",
      status: "applied",
      error: undefined,
      target_path: "Memory Shelf/Exact capture.md",
    });
  });

  it("rejects traversal or non-normalized G2 receipt targets before store acknowledgement", async () => {
    for (const target_path of ["../Exact capture.md", "Memory Shelf//Exact capture.md", " Memory Shelf/Exact capture.md"]) {
      const result = await ackRequest({
        body: { id: "obx_g2", status: "applied", target_path },
        row: g2Row,
      });
      assert.equal(result.response.status, 400);
      assert.equal(result.response.value.message, "invalid target_path");
      assert.equal(result.ackOptions, null);
    }
  });

  it("does not forward target_path for legacy acknowledgements", async () => {
    const result = await ackRequest({
      body: {
        id: "obx_legacy",
        status: "applied",
        target_path: "Memory Shelf/Legacy.md",
      },
      row: { id: "obx_legacy", kind: "create", payload: { title: "Legacy" } },
    });
    assert.deepEqual(result.ackOptions, {
      id: "obx_legacy",
      status: "applied",
      error: undefined,
    });
  });

  it("keeps foreign and non-mirrored targets fail-closed", async () => {
    const foreign = await ackRequest({
      body: { id: "obx_foreign", status: "applied", target_path: "Atoms/X.md" },
      row: null,
      ackResult: { ok: false, error: "not_found" },
    });
    assert.equal(foreign.response.status, 404);
    assert.equal("target_path" in foreign.ackOptions, false);

    const missingMirror = await ackRequest({
      body: { id: "obx_g2", status: "applied", target_path: "Elsewhere/X.md" },
      row: g2Row,
      ackResult: { ok: false, error: "mirror_receipt_required" },
    });
    assert.equal(missingMirror.response.status, 400);
    assert.equal(missingMirror.response.value.message, "mirror_receipt_required");
  });
});
