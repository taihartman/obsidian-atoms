import { describe, expect, it, vi } from "vitest";
import { CreateFlow, type CreateApi, type CreateRecoveryRecord } from "../src/app/createFlow";

function harness() {
  let saved: CreateRecoveryRecord | null = null;
  const enqueued: unknown[] = [];
  const api: CreateApi = {
    enqueue: vi.fn(async (request: unknown) => {
      enqueued.push(request);
      return { state: "pending" as const, captureId: "rec_one" };
    }),
  };
  const recovery = {
    load: async () => saved,
    save: async (record: CreateRecoveryRecord) => { saved = structuredClone(record); },
    clear: async () => { saved = null; },
  };
  return { api, recovery, enqueued, saved: () => saved };
}

describe("G2 create flow", () => {
  it("G2_CAPTURE_ENQUEUE_016 keeps the reviewed transcript local until Save", async () => {
    const h = harness();
    const flow = new CreateFlow(h.api, h.recovery);
    const prepared = await flow.prepare("rec_one", "2026-09-08T17:14:03-04:00", "exact transcript");
    expect(prepared).toEqual({ state: "prepared", title: "Review capture", transcript: "exact transcript" });
    expect(h.api.enqueue).not.toHaveBeenCalled();
    expect(h.saved()).toMatchObject({ state: "prepared", body: "exact transcript" });
    await flow.cancel();
    expect(h.enqueued).toEqual([]);
  });

  it("G2_CAPTURE_ENQUEUE_016 sends the exact displayed text once and reports queued for Obsidian", async () => {
    const h = harness();
    const flow = new CreateFlow(h.api, h.recovery, undefined, () => 1_700_000_000_000);
    await flow.prepare("rec_one", "2026-09-08T17:14:03-04:00", "exact transcript");
    expect(await flow.confirm()).toMatchObject({ state: "queued", message: "Queued for Obsidian" });
    expect(h.enqueued).toEqual([{
      captureId: "rec_one",
      capturedAt: "2026-09-08T17:14:03-04:00",
      body: "exact transcript",
    }]);
    expect(h.saved()).toBeNull();
  });

  it("keeps the review available when enqueue has no durable response", async () => {
    const h = harness();
    h.api.enqueue = vi.fn(async () => { throw new Error("offline"); });
    const flow = new CreateFlow(h.api, h.recovery);
    await flow.prepare("rec_one", "2026-09-08T17:14:03-04:00", "exact transcript");
    expect(await flow.confirm()).toMatchObject({ state: "prepared", transcript: "exact transcript", message: "Waiting for a connection" });
    expect(h.saved()).toMatchObject({ state: "prepared", body: "exact transcript" });
  });
});
