import { describe, expect, it } from "vitest";
import {
  applyOutboxItemToVault,
  runAskOutboxApply,
  syncNowNotice,
  type AskOutboxHost,
  type AskOutboxItem,
  type MirrorSyncOutcome,
  type OutboxApplyResult,
} from "../src/plugin/catchUp";

type AckRecord = { id: string; status: string; error?: string };

/**
 * A fake Plus + vault. The point of the model is the gap the ack rule guards:
 * `applyToVault` puts an atom in the *vault*, and only a mirror push that
 * actually ran puts it in the *cloud*. A `joined` push moves nothing.
 */
function fakeHost(opts: {
  items: AskOutboxItem[];
  /** Outcome for the Nth mirror push (1-based); defaults to a real push. */
  mirror?: (call: number) => MirrorSyncOutcome;
  apply?: (item: AskOutboxItem) => OutboxApplyResult;
  busy?: boolean;
}) {
  /** Un-acked items, in server order. A pull peeks; an ack retires. */
  const pending = [...opts.items];
  const acks: AckRecord[] = [];
  const vault: string[] = [];
  const cloud: string[] = [];
  /** What the vault held at each push *attempt*, whatever the push then did. */
  const pushes: string[][] = [];
  const notices: string[] = [];
  let mirrorCalls = 0;
  let busy = opts.busy ?? false;
  let passes = 0;

  const host: AskOutboxHost = {
    beginPass: () => {
      if (busy) return false;
      busy = true;
      passes++;
      return true;
    },
    endPass: () => {
      busy = false;
    },
    pullOne: async () => pending[0] ?? null,
    ack: async (id, ack) => {
      acks.push({
        id,
        status: ack.status,
        ...(ack.error ? { error: ack.error } : {}),
      });
      const i = pending.findIndex((it) => it.id === id);
      if (i >= 0) pending.splice(i, 1);
    },
    applyToVault: async (payload) => {
      const result = opts.apply?.({ id: "", payload }) ?? {
        kind: "applied" as const,
      };
      if (result.kind === "applied") vault.push(payload.title);
      return result;
    },
    syncMirror: async () => {
      mirrorCalls++;
      pushes.push([...vault]);
      const outcome = opts.mirror?.(mirrorCalls) ?? {
        kind: "worked" as const,
        uploaded: 1,
        deleted: 0,
      };
      // Only a push that ran reaches the cloud. `joined` was absorbed into an
      // in-flight pass that has already built its own payload; `refused` and
      // `failed` never converged.
      if (outcome.kind === "worked") {
        for (const title of vault) if (!cloud.includes(title)) cloud.push(title);
      }
      return outcome;
    },
    notice: (m) => notices.push(m),
    onLanded: () => {},
  };

  return {
    host,
    acks,
    cloud,
    vault,
    pushes,
    notices,
    pendingIds: () => pending.map((i) => i.id),
    passes: () => passes,
  };
}

const item = (id: string, title: string): AskOutboxItem => ({
  id,
  payload: { title, body: `body of ${title}` },
});

describe("runAskOutboxApply", () => {
  it("acks nothing when the mirror push was deferred to an in-flight pass", async () => {
    const f = fakeHost({
      items: [item("o1", "Tea"), item("o2", "Coffee")],
      mirror: () => ({ kind: "joined" }),
    });

    const outcome = await runAskOutboxApply(f.host);

    // One push was attempted, carrying the first atom — and it moved nothing,
    // so nothing may be acked and the loop must not reach the second item.
    expect(f.pushes).toEqual([["Tea"]]);
    expect(f.acks).toEqual([]);
    expect(f.pendingIds()).toEqual(["o1", "o2"]);
    // Not "worked, 0 landed" — the work is still owed.
    expect(outcome).toEqual({ kind: "joined", landed: 0, rejected: 0 });
  });

  it("acks nothing when the mirror hard-fails mid-loop", async () => {
    const f = fakeHost({
      items: [item("o1", "Tea"), item("o2", "Coffee")],
      mirror: () => ({ kind: "failed", message: "network" }),
    });

    const outcome = await runAskOutboxApply(f.host);

    expect(f.pushes).toEqual([["Tea"]]);
    expect(f.acks).toEqual([]);
    expect(f.pendingIds()).toEqual(["o1", "o2"]);
    expect(outcome).toEqual({
      kind: "failed",
      landed: 0,
      rejected: 0,
      message: "network",
    });
  });

  it("acks nothing when the mirror refused to converge", async () => {
    const f = fakeHost({
      items: [item("o1", "Tea")],
      mirror: () => ({
        kind: "refused",
        uploaded: 0,
        reason: "scan-incomplete",
      }),
    });

    const outcome = await runAskOutboxApply(f.host);

    expect(f.pushes).toEqual([["Tea"]]);
    expect(f.acks).toEqual([]);
    expect(f.pendingIds()).toEqual(["o1"]);
    expect(outcome).toEqual({
      kind: "refused",
      landed: 0,
      rejected: 0,
      reason: "scan-incomplete",
    });
  });

  it("acks each entry exactly once when the push is confirmed", async () => {
    const f = fakeHost({ items: [item("o1", "Tea"), item("o2", "Coffee")] });

    const outcome = await runAskOutboxApply(f.host);

    expect(f.cloud).toEqual(["Tea", "Coffee"]);
    expect(f.acks).toEqual([
      { id: "o1", status: "applied" },
      { id: "o2", status: "applied" },
    ]);
    expect(f.pendingIds()).toEqual([]);
    expect(outcome).toEqual({ kind: "worked", landed: 2, rejected: 0 });
    expect(f.notices).toEqual(["Ask: landed 2 atom(s)"]);
  });

  it("acks the item whose push landed and leaves the deferred one pending", async () => {
    const f = fakeHost({
      items: [item("o1", "Tea"), item("o2", "Coffee")],
      // Item 1's push runs; item 2's is absorbed by an in-flight pass — the
      // exact shape the production bug produced.
      mirror: (n) =>
        n === 1
          ? { kind: "worked", uploaded: 1, deleted: 0 }
          : { kind: "joined" },
    });

    const outcome = await runAskOutboxApply(f.host);

    expect(f.pushes).toEqual([["Tea"], ["Tea", "Coffee"]]);
    // Half one: a confirmed ack stands — the fix must not over-correct and
    // re-open an entry the cloud already took.
    expect(f.acks).toEqual([{ id: "o1", status: "applied" }]);
    expect(f.cloud).toEqual(["Tea"]);
    // Half two: the deferred entry is still owed, and the pass stopped there.
    expect(f.pendingIds()).toEqual(["o2"]);
    expect(outcome).toEqual({ kind: "joined", landed: 1, rejected: 0 });
    expect(f.notices).toEqual(["Ask: landed 1 atom(s)"]);
  });

  it("re-running after a deferred push acks the entries that then land", async () => {
    const f = fakeHost({
      items: [item("o1", "Tea")],
      // First pass deferred; the retry pass gets a real push.
      mirror: (n) =>
        n === 1
          ? { kind: "joined" }
          : { kind: "worked", uploaded: 1, deleted: 0 },
    });

    await runAskOutboxApply(f.host);
    expect(f.acks).toEqual([]);
    expect(f.pendingIds()).toEqual(["o1"]);

    const second = await runAskOutboxApply(f.host);

    expect(f.cloud).toEqual(["Tea"]);
    expect(f.acks).toEqual([{ id: "o1", status: "applied" }]);
    expect(second).toEqual({ kind: "worked", landed: 1, rejected: 0 });
  });

  it("tells a busy caller it joined, not that it did zero work", async () => {
    const busy = fakeHost({ items: [item("o1", "Tea")], busy: true });
    expect(await runAskOutboxApply(busy.host)).toEqual({
      kind: "joined",
      landed: 0,
      rejected: 0,
    });
    expect(busy.passes()).toBe(0);
    expect(busy.acks).toEqual([]);

    const idle = fakeHost({ items: [] });
    expect(await runAskOutboxApply(idle.host)).toEqual({
      kind: "worked",
      landed: 0,
      rejected: 0,
    });
  });

  it("rejects an unusable payload without touching the mirror", async () => {
    const f = fakeHost({ items: [{ id: "o1", payload: { body: "orphan" } }] });

    const outcome = await runAskOutboxApply(f.host);

    expect(f.acks).toEqual([
      { id: "o1", status: "rejected", error: "invalid_payload" },
    ]);
    // "without touching the mirror": no push was even attempted.
    expect(f.pushes).toEqual([]);
    expect(outcome).toEqual({ kind: "worked", landed: 0, rejected: 1 });
  });

  it("acks a vault-level rejection with its own reason", async () => {
    const f = fakeHost({
      items: [item("o1", "Tea")],
      apply: () => ({ kind: "rejected", error: "path_exists" }),
    });

    await runAskOutboxApply(f.host);

    expect(f.acks).toEqual([
      { id: "o1", status: "rejected", error: "path_exists" },
    ]);
  });

  it("releases the single-flight lock so the next pass can run", async () => {
    const f = fakeHost({ items: [item("o1", "Tea")] });
    await runAskOutboxApply(f.host);
    await runAskOutboxApply(f.host);
    expect(f.passes()).toBe(2);
  });

  it("releases the single-flight lock when a push throws mid-loop", async () => {
    const f = fakeHost({ items: [item("o1", "Tea")] });
    f.host.syncMirror = async () => {
      throw new Error("boom");
    };

    await expect(runAskOutboxApply(f.host)).rejects.toThrow("boom");
    expect(f.acks).toEqual([]);

    // A thrown push must not park the outbox forever: the lock is released, so
    // a later pass still does the work.
    f.host.syncMirror = async () => ({
      kind: "worked",
      uploaded: 1,
      deleted: 0,
    });
    expect(await runAskOutboxApply(f.host)).toEqual({
      kind: "worked",
      landed: 1,
      rejected: 0,
    });
    expect(f.passes()).toBe(2);
  });

  it("retries a deferred item through the real vault write, idempotently", async () => {
    const files: Record<string, string> = {};
    const port = {
      readIfExists: async (p: string) => files[p] ?? null,
      ensureFolder: async () => {},
      create: async (p: string, content: string) => {
        if (p in files) throw new Error("exists");
        files[p] = content;
      },
    };
    const f = fakeHost({
      items: [item("o1", "Tea")],
      mirror: (n) =>
        n === 1
          ? { kind: "joined" }
          : { kind: "worked", uploaded: 1, deleted: 0 },
    });
    f.host.applyToVault = (payload) =>
      applyOutboxItemToVault(port, "Atoms", payload);

    await runAskOutboxApply(f.host);
    const afterFirst = files["Atoms/Tea.md"];
    expect(afterFirst).toBeDefined();
    expect(f.acks).toEqual([]);

    // The retry meets the file the first pass already created. That is the
    // idempotent path, not a spurious "path_exists" rejection, and the body
    // written the first time is left alone.
    expect(await runAskOutboxApply(f.host)).toEqual({
      kind: "worked",
      landed: 1,
      rejected: 0,
    });
    expect(f.acks).toEqual([{ id: "o1", status: "applied" }]);
    expect(files["Atoms/Tea.md"]).toBe(afterFirst);
  });
});

describe("applyOutboxItemToVault", () => {
  function fakeVault(files: Record<string, string> = {}) {
    const folders: string[] = [];
    return {
      files,
      folders,
      port: {
        readIfExists: async (p: string) => files[p] ?? null,
        ensureFolder: async (p: string) => {
          folders.push(p);
        },
        create: async (p: string, content: string) => {
          if (p in files) throw new Error("exists");
          files[p] = content;
        },
      },
    };
  }

  const payload = { title: "Tea", body: "I prefer tea." };

  it("creates the atom flat in the configured folder", async () => {
    const v = fakeVault();
    expect(await applyOutboxItemToVault(v.port, "Atoms", payload)).toEqual({
      kind: "applied",
    });
    expect(Object.keys(v.files)).toEqual(["Atoms/Tea.md"]);
    expect(v.folders).toEqual(["Atoms"]);
  });

  it("rejects rather than rewriting a body already at that path", async () => {
    const v = fakeVault({ "Atoms/Tea.md": "someone else's words" });
    expect(await applyOutboxItemToVault(v.port, "Atoms", payload)).toEqual({
      kind: "rejected",
      error: "path_exists",
    });
    expect(v.files["Atoms/Tea.md"]).toBe("someone else's words");
  });

  it("rejects when the create failed and nothing is there to re-plan against", async () => {
    const v = fakeVault();
    v.port.create = async () => {
      throw new Error("EACCES");
    };
    expect(await applyOutboxItemToVault(v.port, "Atoms", payload)).toEqual({
      kind: "rejected",
      error: "create_failed",
    });
  });
});

describe("syncNowNotice", () => {
  it("reports reconciled, uploaded, joined and refused as four distinct lines", () => {
    const lines = [
      syncNowNotice({ kind: "worked", uploaded: 0, deleted: 0 }),
      syncNowNotice({ kind: "worked", uploaded: 3, deleted: 0 }),
      syncNowNotice({ kind: "joined" }),
      syncNowNotice({ kind: "refused", uploaded: 0, reason: "scan-incomplete" }),
    ];
    expect(lines[0]).toBe("Ask mirror reconciled");
    expect(lines[1]).toBe("Ask mirror: uploaded 3 atom(s)");
    expect(new Set(lines).size).toBe(4);
  });

  it("never reads as success when the sync was refused", () => {
    for (const reason of [
      "scan-incomplete",
      "no-server-count",
      "server-count-tripwire",
    ] as const) {
      const line = syncNowNotice({ kind: "refused", uploaded: 0, reason })!;
      expect(line).toContain("refused");
      expect(line).not.toContain("reconciled");
      expect(line).not.toContain("uploaded");
    }
  });

  it("leaves a hard failure to the push's own Notice", () => {
    expect(syncNowNotice({ kind: "failed", message: "network" })).toBeNull();
  });
});
