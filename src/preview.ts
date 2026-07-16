import type { App } from "obsidian";
import { Modal, Notice } from "obsidian";
import { classifyCapture, type ClassifyDeps } from "./classify";
import type { MetadataContextProvider } from "./context";
import {
  getPastDailyNotesWithUnmarkedCaptures,
  type PastDailyNotesResult,
} from "./daily";
import {
  atomPathForTitle,
  formatAtomBody,
  markerLineForDecision,
} from "./render";
import type {
  Capture,
  ClassificationResult,
  ClassifyOutcome,
  ClassifyUsage,
  DailyNoteWithCaptures,
  VaultContext,
} from "./types";
import { mergeProposedTags } from "./vocabulary";
import {
  PERSON_HUB_MISS_LABEL,
  personHubMissAfterEnrich,
  type PersonHub,
} from "./people";

export interface PreviewEntry {
  dailyPath: string;
  date: string;
  capture: Capture;
  outcome: ClassifyOutcome;
  /** Marker line that *would* be written (only when classification succeeded). */
  wouldWriteMarker: string | null;
  /** Atom path that *would* be created (atom verdict only). */
  wouldCreateAtomPath: string | null;
  /**
   * Person-shaped atom with no link to a discovered hub (after enrich).
   * False when not person-shaped, not atom, or a hub was linked.
   */
  personHubMiss: boolean;
}

export interface DryRunReport {
  entries: PreviewEntry[];
  totalUnprocessedScanned: number;
  classified: number;
  failed: number;
  /** Person-shaped atoms with no person hub linked. */
  personHubMisses: number;
  /** True when no vault write APIs were invoked by this path. */
  wroteNothing: true;
  generatedAt: string;
}

export function emptyUsage(): ClassifyUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}

/**
 * Build one preview entry from a successful/failed classification.
 * Pure — no I/O.
 */
export function buildPreviewEntry(opts: {
  note: DailyNoteWithCaptures;
  capture: Capture;
  outcome: ClassifyOutcome;
  atomFolder: string;
  /** Hubs after classify enrich (same set as repair). */
  hubs?: PersonHub[];
}): PreviewEntry {
  const { note, capture, outcome, atomFolder } = opts;
  const hubs = opts.hubs ?? [];
  let wouldWriteMarker: string | null = null;
  let wouldCreateAtomPath: string | null = null;
  let personHubMiss = false;

  if (outcome.ok) {
    const r = outcome.result;
    wouldWriteMarker = markerLineForDecision(r.verdict, r.title);
    if (r.verdict === "atom" && r.title.trim()) {
      wouldCreateAtomPath = atomPathForTitle(atomFolder, r.title);
    }
    personHubMiss = personHubMissAfterEnrich(capture.text, r, hubs);
  }

  return {
    dailyPath: note.path,
    date: note.date,
    capture,
    outcome,
    wouldWriteMarker,
    wouldCreateAtomPath,
    personHubMiss,
  };
}

/** Markdown report for modal / console (AE5: one entry per capture). */
export function renderPreviewMarkdown(report: DryRunReport): string {
  const lines: string[] = [
    "# Atoms — dry-run preview",
    "",
    `Generated: ${report.generatedAt}`,
    `Unprocessed scanned: ${report.totalUnprocessedScanned}`,
    `Classified ok: ${report.classified} · failed: ${report.failed}`,
    "",
    "> **Dry-run:** nothing was written. No atom files, no daily-note markers.",
    "",
  ];

  if (report.entries.length === 0) {
    lines.push("_No unprocessed past captures._");
    return lines.join("\n");
  }

  let i = 0;
  for (const e of report.entries) {
    i += 1;
    lines.push(`## ${i}. ${e.date} · \`${e.dailyPath}\``);
    lines.push("");
    lines.push("**Capture**");
    lines.push("");
    lines.push("```");
    lines.push(e.capture.text);
    lines.push("```");
    lines.push("");

    if (!e.outcome.ok) {
      lines.push(
        `**Result:** FAILED — ${e.outcome.reason}: ${e.outcome.message}`,
      );
      lines.push("");
      continue;
    }

    const r: ClassificationResult = e.outcome.result;
    lines.push(`**Verdict:** \`${r.verdict}\``);
    if (r.verdict === "atom") {
      lines.push(`**Title:** ${r.title}`);
      if (e.wouldCreateAtomPath) {
        lines.push(`**Would create:** \`${e.wouldCreateAtomPath}\``);
      }
    }
    if (r.tags?.length) {
      lines.push(`**Tags:** ${r.tags.map((t) => `#${t}`).join(" ")}`);
    }
    if (r.proposed_tags?.length) {
      lines.push(
        `**Proposed tags (not applied):** ${r.proposed_tags.map((t) => `#${t}`).join(" ")}`,
      );
    }
    if (r.links?.length) {
      lines.push("**Links**");
      for (const link of r.links) {
        lines.push(`- ${link.reason || link.note}`);
      }
    }
    if (e.personHubMiss) {
      lines.push(`**People:** ${PERSON_HUB_MISS_LABEL}`);
    }
    if (r.verdict === "atom") {
      lines.push("");
      lines.push("**Atom body (would write)**");
      lines.push("");
      lines.push(formatAtomBody(e.capture.text, r));
    }
    if (e.wouldWriteMarker) {
      lines.push("");
      lines.push("**Marker (would append under capture)**");
      lines.push("");
      lines.push("```");
      lines.push(e.wouldWriteMarker);
      lines.push("```");
    }
    if (e.outcome.ok) {
      lines.push("");
      lines.push(
        `_usage: in=${e.outcome.usage.input_tokens} out=${e.outcome.usage.output_tokens} cache_read=${e.outcome.usage.cache_read_input_tokens}_`,
      );
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

export interface RunDryRunOptions {
  app: App;
  contextProvider: MetadataContextProvider;
  apiKey: string;
  model: string;
  activeVocabulary: string[];
  atomFolder: string;
  /** Cap API calls this run (default: all unprocessed). */
  maxCaptures?: number;
  classifyDeps?: Partial<ClassifyDeps>;
  onProgress?: (
    done: number,
    total: number,
    meta?: { captureText?: string },
  ) => void;
  /** Manual force: include today's daily. Default false. */
  includeToday?: boolean;
}

/**
 * Dry-run pipeline: classify unmarked captures; never write vault files.
 */
export async function runDryRun(
  opts: RunDryRunOptions,
): Promise<DryRunReport> {
  const listed: PastDailyNotesResult =
    await getPastDailyNotesWithUnmarkedCaptures(opts.app, {
      includeToday: opts.includeToday,
    });

  const work: Array<{ note: DailyNoteWithCaptures; capture: Capture }> = [];
  for (const note of listed.notes) {
    for (const capture of note.unprocessed) {
      work.push({ note, capture });
    }
  }

  const max = opts.maxCaptures ?? work.length;
  const slice = work.slice(0, max);
  const ctx: VaultContext = opts.contextProvider.buildContext();
  const hubs: PersonHub[] = (ctx.personHubDetails ?? []).map((d) => ({
    canonicalTitle: d.canonicalTitle,
    matchKeys: d.matchKeys,
    path: `${d.canonicalTitle}.md`,
  }));
  const entries: PreviewEntry[] = [];

  for (let i = 0; i < slice.length; i++) {
    const { note, capture } = slice[i]!;
    opts.onProgress?.(i + 1, slice.length, { captureText: capture.text });
    const outcome = await classifyCapture(capture.text, ctx, {
      apiKey: opts.apiKey,
      model: opts.model,
      activeVocabulary: opts.activeVocabulary,
      ...opts.classifyDeps,
    });
    entries.push(
      buildPreviewEntry({
        note,
        capture,
        outcome,
        atomFolder: opts.atomFolder,
        hubs,
      }),
    );
  }

  const classified = entries.filter((e) => e.outcome.ok).length;
  const personHubMisses = entries.filter((e) => e.personHubMiss).length;
  return {
    entries,
    totalUnprocessedScanned: work.length,
    classified,
    failed: entries.length - classified,
    personHubMisses,
    wroteNothing: true,
    generatedAt: new Date().toISOString(),
  };
}

/** Collect proposed tags from a successful dry-run (still not auto-applied). */
export function proposedTagsFromReport(report: DryRunReport): string[] {
  const incoming: string[] = [];
  for (const e of report.entries) {
    if (e.outcome.ok && e.outcome.result.proposed_tags?.length) {
      incoming.push(...e.outcome.result.proposed_tags);
    }
  }
  return incoming;
}

export function mergeProposedFromReport(
  existing: string[],
  report: DryRunReport,
  activeVocabulary: string[],
): string[] {
  return mergeProposedTags(
    existing,
    proposedTagsFromReport(report),
    activeVocabulary,
  );
}

export interface DryRunPreviewModalOpts {
  report: DryRunReport;
  /** Optional: run process after preview (same includeToday as dry-run). */
  onProcess?: () => void | Promise<void>;
}

function countByVerdict(report: DryRunReport): {
  atom: number;
  task: number;
  noise: number;
  failed: number;
} {
  let atom = 0;
  let task = 0;
  let noise = 0;
  let failed = 0;
  for (const e of report.entries) {
    if (!e.outcome.ok) {
      failed += 1;
      continue;
    }
    const v = e.outcome.result.verdict;
    if (v === "atom") atom += 1;
    else if (v === "task") task += 1;
    else noise += 1;
  }
  return { atom, task, noise, failed };
}

function snippet(text: string, max = 100): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return one.slice(0, max - 1) + "…";
}

/**
 * Card-based dry-run UI — scannable on phone. Markdown report still used for CLI.
 */
export class DryRunPreviewModal extends Modal {
  private readonly report: DryRunReport;
  private readonly onProcess?: () => void | Promise<void>;

  constructor(
    app: App,
    reportOrMarkdown: DryRunReport | string,
    summaryOrOpts?: string | DryRunPreviewModalOpts,
  ) {
    super(app);
    // Back-compat: old (app, markdown, summary) — unused path after main update
    if (typeof reportOrMarkdown === "string") {
      this.report = {
        entries: [],
        totalUnprocessedScanned: 0,
        classified: 0,
        failed: 0,
        personHubMisses: 0,
        wroteNothing: true,
        generatedAt: new Date().toISOString(),
      };
      this.onProcess = undefined;
    } else if (
      summaryOrOpts &&
      typeof summaryOrOpts === "object" &&
      "report" in summaryOrOpts
    ) {
      this.report = summaryOrOpts.report;
      this.onProcess = summaryOrOpts.onProcess;
    } else {
      this.report = reportOrMarkdown;
      this.onProcess = undefined;
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("atoms-preview-modal");
    this.modalEl.addClass("atoms-preview-modal-host");

    const counts = countByVerdict(this.report);

    // Header
    const header = contentEl.createDiv({ cls: "atoms-preview-header" });
    header.createEl("h2", { text: "Preview" });
    header.createEl("p", {
      cls: "atoms-preview-sub",
      text: "Nothing written yet — this is what Process would do.",
    });

    // Summary pills
    const pills = contentEl.createDiv({ cls: "atoms-preview-pills" });
    const addPill = (label: string, n: number, cls: string) => {
      if (n <= 0) return;
      const p = pills.createSpan({ cls: `atoms-preview-pill ${cls}` });
      p.createSpan({ text: String(n), cls: "atoms-preview-pill-n" });
      p.createSpan({ text: label });
    };
    addPill("atoms", counts.atom, "is-atom");
    addPill("tasks", counts.task, "is-task");
    addPill("noise", counts.noise, "is-noise");
    addPill("failed", counts.failed, "is-failed");
    if (
      counts.atom + counts.task + counts.noise + counts.failed === 0
    ) {
      pills.createSpan({
        cls: "atoms-preview-pill is-empty",
        text: "Nothing to preview",
      });
    }

    // Scrollable cards
    const list = contentEl.createDiv({ cls: "atoms-preview-list" });
    if (this.report.entries.length === 0) {
      list.createDiv({
        cls: "atoms-preview-empty",
        text: "No unprocessed captures in this run.",
      });
    } else {
      for (const e of this.report.entries) {
        this.renderCard(list, e);
      }
    }

    // Footer actions
    const footer = contentEl.createDiv({ cls: "atoms-preview-footer" });
    const closeBtn = footer.createEl("button", {
      cls: "atoms-preview-btn atoms-preview-btn-secondary",
      text: "Close",
    });
    closeBtn.addEventListener("click", () => this.close());

    if (this.onProcess && this.report.classified > 0) {
      const go = footer.createEl("button", {
        cls: "atoms-preview-btn atoms-preview-btn-primary",
        text: "Process these",
      });
      go.addEventListener("click", () => {
        void (async () => {
          this.close();
          await this.onProcess?.();
        })();
      });
    }
  }

  private renderCard(parent: HTMLElement, e: PreviewEntry): void {
    const card = parent.createDiv({ cls: "atoms-preview-card" });

    if (!e.outcome.ok) {
      const badge = card.createSpan({
        cls: "atoms-preview-badge is-failed",
        text: "failed",
      });
      void badge;
      card.createDiv({
        cls: "atoms-preview-title",
        text: e.outcome.message || e.outcome.reason,
      });
      card.createDiv({
        cls: "atoms-preview-capture",
        text: snippet(e.capture.text),
      });
      card.createDiv({
        cls: "atoms-preview-meta",
        text: e.date,
      });
      return;
    }

    const r = e.outcome.result;
    const badge = card.createSpan({
      cls: `atoms-preview-badge is-${r.verdict}`,
      text: r.verdict,
    });
    void badge;

    if (r.verdict === "atom" && r.title.trim()) {
      card.createDiv({ cls: "atoms-preview-title", text: r.title.trim() });
    } else if (r.verdict === "task") {
      card.createDiv({
        cls: "atoms-preview-title",
        text: "Task — marker only",
      });
    } else {
      card.createDiv({
        cls: "atoms-preview-title",
        text: "Noise — discard",
      });
    }

    card.createDiv({
      cls: "atoms-preview-capture",
      text: snippet(e.capture.text),
    });

    const meta = card.createDiv({ cls: "atoms-preview-meta-row" });
    meta.createSpan({ text: e.date, cls: "atoms-preview-meta" });
    if (r.tags?.length) {
      for (const t of r.tags.slice(0, 4)) {
        meta.createSpan({
          cls: "atoms-preview-tag",
          text: `#${t.replace(/^#/, "")}`,
        });
      }
    }
    if (r.links?.length) {
      for (const link of r.links.slice(0, 3)) {
        meta.createSpan({
          cls: "atoms-preview-link",
          text: link.note,
        });
      }
    }
    if (e.personHubMiss) {
      card.createDiv({
        cls: "atoms-preview-person-miss",
        text: PERSON_HUB_MISS_LABEL,
      });
    }
    if (r.verdict === "atom" && e.wouldCreateAtomPath) {
      const file = e.wouldCreateAtomPath.split("/").pop() ?? e.wouldCreateAtomPath;
      card.createDiv({
        cls: "atoms-preview-file",
        text: `→ ${file}`,
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

export function showDryRunNotice(report: DryRunReport): void {
  const c = countByVerdict(report);
  const parts: string[] = [];
  if (c.atom) parts.push(`${c.atom} atom`);
  if (c.task) parts.push(`${c.task} task`);
  if (c.noise) parts.push(`${c.noise} noise`);
  if (c.failed) parts.push(`${c.failed} failed`);
  if (report.personHubMisses > 0) {
    parts.push(
      `${report.personHubMisses} no person hub${report.personHubMisses === 1 ? "" : "s"}`,
    );
  }
  const summary = parts.length ? parts.join(" · ") : "nothing";
  new Notice(`Atoms preview: ${summary} — nothing written yet`);
}
