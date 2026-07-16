/**
 * Thin DOM factories for Atoms home. No React. No pipeline/home imports.
 * Visual authority: docs/design-handoff/tokens/README.md
 */

export type ButtonGrade = "primary" | "secondary" | "quiet";
export type StatusTone = "wait" | "progress" | "done" | "error";
export type LinkChipKind = "person" | "work" | "neutral";
export type KickerVariant = "mind" | "default";

type AttrMap = Record<string, string | number | boolean | null | undefined>;

function mergeCls(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function button(
  parent: HTMLElement,
  opts: {
    grade: ButtonGrade;
    label: string;
    onClick?: (ev: MouseEvent) => void;
    attrs?: AttrMap;
    className?: string;
    disabled?: boolean;
  },
): HTMLButtonElement {
  const btn = parent.createEl("button", {
    text: opts.label,
    cls: mergeCls(
      "atoms-ui-btn",
      `atoms-ui-btn--${opts.grade}`,
      opts.className,
    ),
    attr: { type: "button", ...(opts.attrs ?? {}) },
  });
  if (opts.disabled) btn.disabled = true;
  if (opts.onClick) {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      opts.onClick?.(ev);
    });
  }
  return btn;
}

export function flatCard(
  parent: HTMLElement,
  opts?: {
    className?: string;
    role?: string;
    tabIndex?: number;
  },
): HTMLDivElement {
  return parent.createDiv({
    cls: mergeCls("atoms-ui-flat-card", opts?.className),
    attr: {
      ...(opts?.role ? { role: opts.role } : {}),
      ...(opts?.tabIndex != null ? { tabindex: String(opts.tabIndex) } : {}),
    },
  });
}

export function statusCard(
  parent: HTMLElement,
  opts: {
    tone: StatusTone;
    className?: string;
  },
): HTMLDivElement {
  return parent.createDiv({
    cls: mergeCls(
      "atoms-ui-status-card",
      `atoms-ui-status-card--${opts.tone}`,
      opts.className,
    ),
  });
}

/** Serif claim body with CSS quote chrome. Text is never mutated. */
export function claimQuote(
  parent: HTMLElement,
  opts: {
    text: string;
    maxLines?: number;
    className?: string;
  },
): HTMLParagraphElement {
  const el = parent.createEl("p", {
    text: opts.text,
    cls: mergeCls("atoms-ui-claim-quote", opts.className),
  });
  if (opts.maxLines != null && opts.maxLines > 0) {
    el.style.webkitLineClamp = String(opts.maxLines);
    el.classList.add("atoms-ui-claim-quote--clamp");
  }
  return el;
}

export function kicker(
  parent: HTMLElement,
  opts: {
    text: string;
    variant?: KickerVariant;
    className?: string;
  },
): HTMLParagraphElement {
  const variant = opts.variant ?? "default";
  return parent.createEl("p", {
    text: opts.text,
    cls: mergeCls(
      "atoms-ui-kicker",
      variant === "mind" && "atoms-ui-kicker--mind",
      opts.className,
    ),
  });
}

export function citatorLine(
  parent: HTMLElement,
  opts: {
    relationLabel: string;
    peerTitle: string;
    onPeerClick?: () => void;
    className?: string;
  },
): HTMLElement {
  const row = parent.createEl(opts.onPeerClick ? "button" : "p", {
    cls: mergeCls("atoms-ui-citator-line", opts.className),
    attr: opts.onPeerClick
      ? { type: "button" }
      : undefined,
  });
  row.createSpan({
    text: opts.relationLabel,
    cls: "atoms-ui-citator-line-rel",
  });
  row.appendText(" ");
  row.createSpan({
    text: opts.peerTitle,
    cls: "atoms-ui-citator-line-peer",
  });
  if (opts.onPeerClick) {
    row.addEventListener("click", (ev) => {
      ev.stopPropagation();
      opts.onPeerClick?.();
    });
  }
  return row;
}

export function linkChip(
  parent: HTMLElement,
  opts: {
    label: string;
    kind: LinkChipKind;
    className?: string;
  },
): HTMLSpanElement {
  return parent.createSpan({
    text: opts.label,
    cls: mergeCls(
      "atoms-ui-link-chip",
      opts.kind === "person" && "atoms-ui-link-chip--person",
      opts.kind === "work" && "atoms-ui-link-chip--work",
      opts.className,
    ),
  });
}

export function listGroup(
  parent: HTMLElement,
  opts?: { className?: string },
): HTMLDivElement {
  return parent.createDiv({
    cls: mergeCls("atoms-ui-list-group", opts?.className),
  });
}

export function listRow(
  parent: HTMLElement,
  opts?: {
    className?: string;
    onClick?: () => void;
    role?: string;
  },
): HTMLDivElement {
  const row = parent.createDiv({
    cls: mergeCls("atoms-ui-list-row", opts?.className),
    attr: {
      ...(opts?.role ? { role: opts.role } : {}),
      ...(opts?.onClick ? { tabindex: "0" } : {}),
    },
  });
  if (opts?.onClick) {
    row.addEventListener("click", () => opts.onClick?.());
    row.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        opts.onClick?.();
      }
    });
  }
  return row;
}

export function sectionLabel(
  parent: HTMLElement,
  text: string,
  opts?: { className?: string },
): HTMLElement {
  return parent.createEl("h3", {
    text,
    cls: mergeCls("atoms-ui-section-label", opts?.className),
  });
}

export function backLink(
  parent: HTMLElement,
  opts: {
    label: string;
    onClick: () => void;
    className?: string;
  },
): HTMLButtonElement {
  const btn = parent.createEl("button", {
    text: opts.label,
    cls: mergeCls("atoms-ui-back", opts.className),
    attr: { type: "button" },
  });
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    opts.onClick();
  });
  return btn;
}

export function actionRow(
  parent: HTMLElement,
  opts?: { className?: string },
): HTMLDivElement {
  return parent.createDiv({
    cls: mergeCls("atoms-ui-action-row", opts?.className),
  });
}

export function filterTabs(
  parent: HTMLElement,
  opts: {
    modes: Array<{ id: string; label: string }>;
    active: string;
    onChange: (id: string) => void;
    className?: string;
  },
): HTMLDivElement {
  const wrap = parent.createDiv({
    cls: mergeCls("atoms-ui-filter-tabs", opts.className),
  });
  for (const mode of opts.modes) {
    const tab = wrap.createEl("button", {
      text: mode.label,
      cls: mergeCls(
        "atoms-ui-filter-tab",
        mode.id === opts.active && "is-active",
      ),
      attr: { type: "button" },
    });
    tab.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (mode.id !== opts.active) opts.onChange(mode.id);
    });
  }
  return wrap;
}
