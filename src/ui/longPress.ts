/** Long-press / tap separation for library rows (and similar list cells). */

export const LONG_PRESS_MS = 400;
export const LONG_PRESS_SLOP_PX = 12;

export type LongPressUpResult = "tap" | "ignore";

/**
 * Pure session for one press. Unit-tested; DOM wiring lives in attachLongPress.
 */
export class LongPressSession {
  phase: "idle" | "pending" | "fired" | "cancelled" = "idle";
  private startX = 0;
  private startY = 0;

  down(x: number, y: number): void {
    this.phase = "pending";
    this.startX = x;
    this.startY = y;
  }

  /** Returns true if the press was cancelled by movement. */
  move(x: number, y: number, slopPx: number = LONG_PRESS_SLOP_PX): boolean {
    if (this.phase !== "pending") return this.phase === "cancelled";
    const dx = x - this.startX;
    const dy = y - this.startY;
    if (dx * dx + dy * dy > slopPx * slopPx) {
      this.phase = "cancelled";
      return true;
    }
    return false;
  }

  /** Timer elapsed — true if long-press should fire. */
  timerFire(): boolean {
    if (this.phase !== "pending") return false;
    this.phase = "fired";
    return true;
  }

  up(): LongPressUpResult {
    if (this.phase === "pending") {
      this.phase = "idle";
      return "tap";
    }
    this.phase = "idle";
    return "ignore";
  }

  reset(): void {
    this.phase = "idle";
  }
}

export type AttachLongPressOpts = {
  onTap: () => void;
  onLongPress: () => void;
  durationMs?: number;
  slopPx?: number;
  /** Desktop right-click → long-press action (Continue). Default true. */
  contextMenuAsLongPress?: boolean;
};

/**
 * Bind pointer long-press + tap. Returns detach. Uses pointer events only.
 */
export function attachLongPress(
  el: HTMLElement,
  opts: AttachLongPressOpts,
): () => void {
  const duration = opts.durationMs ?? LONG_PRESS_MS;
  const slop = opts.slopPx ?? LONG_PRESS_SLOP_PX;
  const session = new LongPressSession();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let suppressClick = false;

  const clearTimer = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const releaseCapture = (ev: PointerEvent) => {
    try {
      if (el.hasPointerCapture?.(ev.pointerId)) {
        el.releasePointerCapture(ev.pointerId);
      }
    } catch {
      /* ignore */
    }
  };

  const onPointerDown = (ev: PointerEvent) => {
    // Primary button only for mouse; touch/pen have button 0.
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    session.down(ev.clientX, ev.clientY);
    suppressClick = false;
    clearTimer();
    try {
      el.setPointerCapture?.(ev.pointerId);
    } catch {
      /* ignore */
    }
    timer = setTimeout(() => {
      timer = null;
      if (session.timerFire()) {
        suppressClick = true;
        opts.onLongPress();
      }
    }, duration);
  };

  const onPointerMove = (ev: PointerEvent) => {
    if (session.move(ev.clientX, ev.clientY, slop)) {
      clearTimer();
    }
  };

  const onPointerUp = (ev: PointerEvent) => {
    clearTimer();
    releaseCapture(ev);
    const result = session.up();
    if (result === "tap" && !suppressClick) {
      // Touch/pen: fire here (no reliable click). Mouse: wait for click.
      if (ev.pointerType !== "mouse") {
        opts.onTap();
        // Absorb the synthetic click that often follows touch.
        suppressClick = true;
        window.setTimeout(() => {
          suppressClick = false;
        }, 50);
      }
    }
  };

  const onPointerCancel = (ev: PointerEvent) => {
    clearTimer();
    releaseCapture(ev);
    session.reset();
  };

  const onClick = (ev: MouseEvent) => {
    if (suppressClick) {
      ev.preventDefault();
      ev.stopPropagation();
      suppressClick = false;
      return;
    }
    // Mouse: tap completes on click (after pointerup with pending).
    opts.onTap();
  };

  const onContextMenu = (ev: MouseEvent) => {
    if (opts.contextMenuAsLongPress === false) return;
    ev.preventDefault();
    ev.stopPropagation();
    clearTimer();
    session.reset();
    opts.onLongPress();
  };

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerCancel);
  el.addEventListener("click", onClick);
  el.addEventListener("contextmenu", onContextMenu);

  return () => {
    clearTimer();
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerUp);
    el.removeEventListener("pointercancel", onPointerCancel);
    el.removeEventListener("click", onClick);
    el.removeEventListener("contextmenu", onContextMenu);
  };
}
