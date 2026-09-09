import { describe, expect, it } from "vitest";
import { CreateFlow, type CreateApi, type CreateRecoveryRecord } from "../src/app/createFlow";

function harness() {
  let saved: CreateRecoveryRecord | null = null;
  const commits: unknown[] = [];
  const api: CreateApi = {
    prepare: async () => ({ preparationId: "g2p_one", fingerprint: "fp", title: "A thought from the walk", body: "exact transcript\n", expiresAt: "2026-09-08T22:15:00Z" }),
    commit: async (request: unknown) => { commits.push(request); return { state: "queued" as const, outboxId: "obx_one" }; },
    status: async () => ({ state: "saved" as const, receipt: { path: "Atoms/A thought from the walk.md", title: "A thought from the walk" } }),
  };
  const recovery = {
    load: async () => saved,
    save: async (record: CreateRecoveryRecord) => { saved = structuredClone(record); },
    clear: async () => { saved = null; },
  };
  return { api, recovery, commits, saved: () => saved };
}

describe("G2 create flow", () => {
  it("persists the fingerprint before showing confirmation and never commits on cancel", async () => {
    const h = harness();
    const flow = new CreateFlow(h.api, h.recovery, () => "commit_one");
    const prepared = await flow.prepare("rec_one", "2026-09-08T17:14:03-04:00");
    expect(prepared).toMatchObject({ state: "prepared", prompt: "Create “A thought from the walk”?" });
    expect(h.saved()).toMatchObject({ state: "prepared", fingerprint: "fp", title: "A thought from the walk" });
    await flow.cancel();
    expect(h.commits).toEqual([]);
  });

  it("restores offline queued work and says saved only after a receipt", async () => {
    const h = harness();
    const first = new CreateFlow(h.api, h.recovery, () => "commit_one");
    await first.prepare("rec_one", "2026-09-08T17:14:03-04:00");
    expect(await first.confirm()).toMatchObject({ state: "queued", message: "Queued" });
    const coldStart = new CreateFlow(h.api, h.recovery, () => "unused");
    expect(await coldStart.restore()).toMatchObject({ state: "queued", message: "Queued" });
    expect(await coldStart.refresh()).toMatchObject({ state: "saved", message: "Saved to Atoms" });
    expect(h.commits).toHaveLength(1);
  });

  it("renders title collision and revoked access as truthful terminal states", async () => {
    for (const [serverState, message] of [
      ["title_collision", "That title already exists"],
      ["setup_required", "Connect G2 again"],
    ] as const) {
      const h = harness();
      h.api.commit = async () => ({ state: serverState });
      const flow = new CreateFlow(h.api, h.recovery, () => `commit_${serverState}`);
      await flow.prepare("rec_one", "2026-09-08T17:14:03-04:00");
      expect(await flow.confirm()).toMatchObject({ message });
    }
  });
});
