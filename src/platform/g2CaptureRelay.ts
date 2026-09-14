import type { App } from "obsidian";
import { ensureInboxNote } from "../pipeline/inbox";
import {
  g2CaptureAck,
  g2CaptureClaim,
  type G2CaptureRelayItem,
  type PlusMirrorConfig,
} from "./plusClient";

export type G2CaptureRelayDeps = {
  claim(): Promise<{ ok: true; items: G2CaptureRelayItem[] } | { ok: false }>;
  ack(input: { captureId: string; claimToken: string }): Promise<{ ok: true } | { ok: false }>;
  mutateInbox(change: (current: string) => string): Promise<void>;
  readInbox(): Promise<string>;
};

export function g2CaptureMarker(captureId: string): string {
  return `<!--atoms:g2-capture:${captureId}-->`;
}

export function renderG2InboxCapture(item: Pick<G2CaptureRelayItem, "captureId" | "capturedAt" | "body">): string {
  const [first = "", ...rest] = item.body.split("\n");
  return [
    `- ${item.capturedAt} ${first}`,
    ...rest.map((line) => `\t${line}`),
    g2CaptureMarker(item.captureId),
  ].join("\n");
}

function appendBlock(current: string, block: string): string {
  const trimmedEnd = current.replace(/\s*$/, "");
  return `${trimmedEnd}${trimmedEnd ? "\n\n" : ""}${block}\n`;
}

function hasMarkerLine(current: string, marker: string): boolean {
  return current.split(/\r?\n/).includes(marker);
}

export async function ingestG2CaptureRelay(
  deps: G2CaptureRelayDeps,
): Promise<{ imported: number; acknowledged: number }> {
  const claimed = await deps.claim();
  if (!claimed.ok) return { imported: 0, acknowledged: 0 };
  let imported = 0;
  let acknowledged = 0;
  for (const item of claimed.items) {
    const marker = g2CaptureMarker(item.captureId);
    const block = renderG2InboxCapture(item);
    let appended = false;
    let markerAlreadyPresent = false;
    await deps.mutateInbox((current) => {
      if (hasMarkerLine(current, marker)) {
        markerAlreadyPresent = true;
        return current;
      }
      appended = true;
      return appendBlock(current, block);
    });
    if (appended) imported += 1;
    const durable = await deps.readInbox();
    if (markerAlreadyPresent ? !hasMarkerLine(durable, marker) : !durable.includes(block)) continue;
    const acked = await deps.ack({ captureId: item.captureId, claimToken: item.claimToken });
    if (acked.ok) acknowledged += 1;
  }
  return { imported, acknowledged };
}

export async function syncG2CaptureRelay(
  app: App,
  cfg: PlusMirrorConfig,
  sessionToken: string,
): Promise<{ imported: number; acknowledged: number }> {
  const inbox = await ensureInboxNote(app);
  return ingestG2CaptureRelay({
    claim: () => g2CaptureClaim(cfg, sessionToken, 10),
    ack: (input) => g2CaptureAck(cfg, sessionToken, input),
    mutateInbox: async (change) => {
      await app.vault.process(inbox, change);
    },
    readInbox: () => app.vault.cachedRead(inbox),
  });
}
