import { describe, expect, it, vi } from "vitest";

import {
  g2CaptureMarker,
  ingestG2CaptureRelay,
  renderG2InboxCapture,
} from "../src/platform/g2CaptureRelay";
import { parseInboxCaptures } from "../src/pipeline/inbox";

const item = {
  captureId: "capture_one",
  capturedAt: "2026-09-10T18:00:00.000Z",
  body: "exact first line\nexact second line",
  claimToken: "g2c_secret",
};

function harness(initial = "# Inbox\n") {
  let content = initial;
  const ack = vi.fn(async () => ({ ok: true as const, captureId: item.captureId, state: "applied" as const }));
  return {
    deps: {
      claim: vi.fn(async () => ({ ok: true as const, items: [item] })),
      ack,
      mutateInbox: async (change: (current: string) => string) => { content = change(content); },
      readInbox: async () => content,
    },
    ack,
    content: () => content,
  };
}

describe("G2 capture relay", () => {
  it("G2_CAPTURE_CLAIM_017 appends the exact capture with an opaque marker before acknowledging", async () => {
    const h = harness();
    await expect(ingestG2CaptureRelay(h.deps)).resolves.toEqual({ imported: 1, acknowledged: 1 });
    expect(h.content()).toContain(renderG2InboxCapture(item));
    expect(h.ack).toHaveBeenCalledWith({ captureId: item.captureId, claimToken: item.claimToken });
    expect(parseInboxCaptures(h.content())[0]?.text).toBe(item.body);
  });

  it("G2_CAPTURE_ACK_018 does not acknowledge when the durable re-read does not match", async () => {
    const h = harness();
    h.deps.readInbox = async () => "# Inbox\n";
    await expect(ingestG2CaptureRelay(h.deps)).resolves.toEqual({ imported: 1, acknowledged: 0 });
    expect(h.ack).not.toHaveBeenCalled();
  });

  it("deduplicates a retry by marker and acknowledges only after matching the existing block", async () => {
    const block = renderG2InboxCapture(item);
    const h = harness(`# Inbox\n\n${block}\n`);
    await expect(ingestG2CaptureRelay(h.deps)).resolves.toEqual({ imported: 0, acknowledged: 1 });
    expect(h.content().match(new RegExp(g2CaptureMarker(item.captureId), "g"))).toHaveLength(1);
  });

  it("acknowledges a retry after the user edits the captured words above its durable marker", async () => {
    const h = harness(`# Inbox\n\n- ${item.capturedAt} corrected first line\n\tcorrected second line\n${g2CaptureMarker(item.captureId)}\n`);

    await expect(ingestG2CaptureRelay(h.deps)).resolves.toEqual({ imported: 0, acknowledged: 1 });
    expect(h.ack).toHaveBeenCalledOnce();
    expect(h.content()).toContain("corrected first line");
  });

  it("acknowledges a retry when the existing filing pipeline added a filed marker", async () => {
    const block = renderG2InboxCapture(item).replace(
      g2CaptureMarker(item.captureId),
      `<!--atoms:filed-->\n${g2CaptureMarker(item.captureId)}`,
    );
    const h = harness(`# Inbox\n\n${block}\n`);

    await expect(ingestG2CaptureRelay(h.deps)).resolves.toEqual({ imported: 0, acknowledged: 1 });
    expect(h.ack).toHaveBeenCalledOnce();
  });

  it("clears ten edited retries so the next queued capture can be imported", async () => {
    const items = Array.from({ length: 11 }, (_, index) => ({
      ...item,
      captureId: `capture_${String(index).padStart(2, "0")}`,
      claimToken: `claim_${index}`,
    }));
    const pending = [...items];
    let content = [
      "# Inbox",
      ...items.slice(0, 10).flatMap((capture) => [
        "",
        `- ${capture.capturedAt} corrected ${capture.captureId}`,
        g2CaptureMarker(capture.captureId),
      ]),
      "",
    ].join("\n");
    const deps = {
      claim: vi.fn(async () => ({ ok: true as const, items: pending.slice(0, 10) })),
      ack: vi.fn(async ({ captureId }: { captureId: string; claimToken: string }) => {
        const index = pending.findIndex((capture) => capture.captureId === captureId);
        if (index >= 0) pending.splice(index, 1);
        return { ok: true as const };
      }),
      mutateInbox: async (change: (current: string) => string) => { content = change(content); },
      readInbox: async () => content,
    };

    await ingestG2CaptureRelay(deps);
    await ingestG2CaptureRelay(deps);

    expect(pending).toEqual([]);
    expect(content).toContain(g2CaptureMarker(items[10]!.captureId));
    expect(deps.ack).toHaveBeenCalledTimes(11);
  });

  it("keeps marker-shaped user text in the capture body", () => {
    const body = `say this\n${g2CaptureMarker(item.captureId)}`;
    const rendered = renderG2InboxCapture({ ...item, body });
    expect(parseInboxCaptures(rendered)[0]?.text).toBe(body);
  });
});
