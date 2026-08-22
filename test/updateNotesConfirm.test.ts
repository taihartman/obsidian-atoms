import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { Modal } from "./mocks/obsidian";
import { openUpdateNotesConfirm, updateNotesConfirmIsOpen } from "../src/home/updateNotesConfirm";
import { updateNotesConfirmCopy } from "../src/home/atomsHomeData";

function press(label: string): void {
  const modal = Modal.open[0];
  if (!modal) throw new Error("no confirm open");
  const button = Array.from(modal.contentEl.querySelectorAll("button")).find(
    (el) => el.textContent === label,
  );
  if (!button) throw new Error(`no button labelled ${label}`);
  button.click();
}

describe("openUpdateNotesConfirm", () => {
  const app = {} as App;

  it("quotes N and calls onConfirm with that limit", () => {
    const limits: number[] = [];
    openUpdateNotesConfirm({
      app,
      n: 3,
      billing: "plus_active",
      onConfirm: (limit) => limits.push(limit),
    });
    const copy = updateNotesConfirmCopy({ n: 3, billing: "plus_active" });
    expect(Modal.open).toHaveLength(1);
    expect(Modal.open[0]?.titleEl.textContent).toBe(copy.title);
    expect(Modal.open[0]?.contentEl.textContent).toContain(copy.body);
    press("Update");
    expect(limits).toEqual([3]);
    expect(updateNotesConfirmIsOpen()).toBe(false);
  });

  it("does not run on Cancel", () => {
    let ran = 0;
    openUpdateNotesConfirm({
      app,
      n: 3,
      billing: "byok",
      onConfirm: () => {
        ran += 1;
      },
    });
    press("Cancel");
    expect(ran).toBe(0);
    expect(Modal.open).toHaveLength(0);
  });

  it("does not run on close (Escape / outside)", () => {
    let ran = 0;
    openUpdateNotesConfirm({
      app,
      n: 2,
      billing: "none",
      onConfirm: () => {
        ran += 1;
      },
    });
    Modal.open[0]?.close();
    expect(ran).toBe(0);
    expect(updateNotesConfirmIsOpen()).toBe(false);
  });

  it("does not stack a second sheet while one is open", () => {
    const limits: number[] = [];
    openUpdateNotesConfirm({
      app,
      n: 4,
      billing: "plus_active",
      onConfirm: (limit) => limits.push(limit),
    });
    openUpdateNotesConfirm({
      app,
      n: 8,
      billing: "plus_active",
      onConfirm: (limit) => limits.push(limit),
    });
    expect(Modal.open).toHaveLength(1);
    expect(Modal.open[0]?.titleEl.textContent).toBe("Update 4 notes?");
    press("Update");
    expect(limits).toEqual([4]);
  });

  it("does not open when quoted N is 0", () => {
    let ran = 0;
    openUpdateNotesConfirm({
      app,
      n: 0,
      billing: "plus_active",
      onConfirm: () => {
        ran += 1;
      },
    });
    expect(Modal.open).toHaveLength(0);
    expect(ran).toBe(0);
  });
});
