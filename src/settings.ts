import {
  App,
  Notice,
  PluginSettingTab,
  SecretComponent,
  Setting,
} from "obsidian";
import type AtomsPlugin from "./main";
import { aggregateTagsFromFileCaches } from "./context";
import {
  readDeviceAutoRunState,
  writeAutoRunEnabled,
  writeEgressAck,
} from "./autorun";
import {
  CAPTURE_SHORTCUT_VERSION,
  labelInstallOrUpdate,
  openShortcutInstallUrl,
  readShortcutAck,
  resolveCaptureShortcutInstallUrl,
  writeShortcutAck,
} from "./captureShortcut";
import { clampAtomFolder } from "./render";
import {
  API_KEY_SECRET_ID_DEFAULT,
  LOCAL_STORAGE_API_KEY,
} from "./types";
import {
  addCustomActiveTag,
  approveProposedTag,
  normalizeTag,
  removeActiveTag,
  tagCountsSorted,
} from "./vocabulary";

function settingHeading(containerEl: HTMLElement, name: string): void {
  new Setting(containerEl).setName(name).setHeading();
}

function loadLocal(app: App, key: string): unknown {
  return app.loadLocalStorage(key) as unknown;
}

export class AtomsSettingTab extends PluginSettingTab {
  plugin: AtomsPlugin;
  private customTagDraft = "";

  constructor(app: App, plugin: AtomsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const version = this.plugin.manifest.version ?? "?";
    settingHeading(containerEl, "Atoms");
    containerEl.createEl("p", {
      text: `Second brain: files keepable captures (ideas, preferences, lists, media) as flat Atoms/ notes. Not a to-do app — pure logistics are marked noise. Capture itself is handled by your iOS Shortcut.`,
      cls: "setting-item-description",
    });
    containerEl.createEl("p", {
      text: `Version ${version}`,
      cls: "setting-item-description",
    });

    this.renderCaptureSection(containerEl);
    this.renderApiSection(containerEl);
    this.renderAutoRunSection(containerEl);
    this.renderModelSection(containerEl);
    this.renderVocabularySection(containerEl);
    this.renderDevHints(containerEl);
  }

  private renderCaptureSection(containerEl: HTMLElement) {
    settingHeading(containerEl, "Capture");

    const acked = readShortcutAck((k) => loadLocal(this.app, k));
    const installUrl = resolveCaptureShortcutInstallUrl(
      this.plugin.settings.captureShortcutInstallUrl,
    );
    const urlSet = Boolean(installUrl);

    new Setting(containerEl)
      .setName("Daily capture format")
      .setDesc(
        "Write top-level bullets in your daily note: “- thought…”. Today’s note is never auto-processed; use Atoms home → Preview after midnight (or past dailies).",
      );

    new Setting(containerEl)
      .setName("iCloud shortcut link")
      .setDesc(
        "Paste the iCloud share link from Shortcuts (Share → Copy iCloud Link). Syncs with the vault. See docs/capture-shortcut.md for how to build the shortcut.",
      )
      .addText((text) =>
        text
          .setPlaceholder("https://www.icloud.com/shortcuts/…")
          .setValue(this.plugin.settings.captureShortcutInstallUrl)
          .onChange(async (value) => {
            this.plugin.settings.captureShortcutInstallUrl = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Capture shortcut")
      .setDesc(
        urlSet
          ? `Install or update the iOS shortcut (v${CAPTURE_SHORTCUT_VERSION}). Opens your iCloud link — Shortcuts.app still needs confirm. Acked: ${acked ?? "never"}.`
          : `No link yet — paste an iCloud URL above (or create the shortcut on your phone, then paste). Version tag: ${CAPTURE_SHORTCUT_VERSION}.`,
      )
      .addButton((btn) =>
        btn
          .setButtonText(labelInstallOrUpdate(acked))
          .setDisabled(!urlSet)
          .onClick(() => {
            if (!urlSet) {
              new Notice(
                "Paste an iCloud shortcut link above first (Shortcuts → Share → Copy iCloud Link).",
              );
              return;
            }
            const ok = openShortcutInstallUrl(installUrl);
            if (!ok) {
              new Notice(
                "Shortcut link must be an https://www.icloud.com/shortcuts/… URL",
              );
              return;
            }
            writeShortcutAck(
              (k, v) => this.app.saveLocalStorage(k, v),
              CAPTURE_SHORTCUT_VERSION,
            );
            new Notice(
              `Opened capture shortcut v${CAPTURE_SHORTCUT_VERSION} — add it in Shortcuts`,
            );
            this.display();
          }),
      );

    new Setting(containerEl)
      .setName("Open today's daily")
      .setDesc("Jump to (or create) today’s Daily Notes file — does not process it.")
      .addButton((btn) =>
        btn.setButtonText("Open today").onClick(() => {
          void this.plugin.openTodaysDailyFromHome();
        }),
      );
  }

  private renderApiSection(containerEl: HTMLElement) {
    settingHeading(containerEl, "API & privacy");

    new Setting(containerEl)
      .setName("Privacy")
      .setDesc(
        "Every run sends your vault's note titles, tags, a derived person-hub title list (titles only — never folder paths or hub body content), and each capture to the Anthropic API over TLS (your API key = optional paid usage). The model never rewrites your hand-authored notes — only new files in the atom folder and marker lines under captures. Existing atoms are never overwritten on title collision.",
      );

    new Setting(containerEl)
      .setName("Anthropic API key")
      .setDesc(
        "SecretStorage. The value never lives in data.json. Secret ids: lowercase alphanumeric with dashes.",
      )
      .addComponent((el) =>
        new SecretComponent(this.app, el)
          .setValue(this.plugin.settings.apiKeySecretId)
          .onChange(async (value) => {
            this.plugin.settings.apiKeySecretId = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Test connection")
      .setDesc(
        "Checks whether Obsidian can reach the internet and the Anthropic API from this device. Safe — does not log your key.",
      )
      .addButton((btn) =>
        btn.setButtonText("Test connection").onClick(() => {
          void this.plugin.runTestConnection();
        }),
      );

    new Setting(containerEl)
      .setName("Device-local key fallback")
      .setDesc(
        "Only if SecretStorage fails: non-synced local storage (still never data.json).",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useDeviceLocalKeyFallback)
          .onChange(async (value) => {
            this.plugin.settings.useDeviceLocalKeyFallback = value;
            if (!value) {
              this.app.saveLocalStorage(LOCAL_STORAGE_API_KEY, null);
            }
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    if (this.plugin.settings.useDeviceLocalKeyFallback) {
      const stored = loadLocal(this.app, LOCAL_STORAGE_API_KEY);
      const localKey = typeof stored === "string" ? stored : "";
      new Setting(containerEl)
        .setName("Device-local API key")
        .setDesc("This device only. Prefer SecretStorage.")
        .addText((text) => {
          text
            .setPlaceholder("sk-ant-…")
            .setValue(localKey)
            .onChange((value) => {
              this.app.saveLocalStorage(
                LOCAL_STORAGE_API_KEY,
                value.trim() ? value.trim() : null,
              );
            });
          text.inputEl.type = "password";
          text.inputEl.autocomplete = "off";
        });
    }

    containerEl.createEl("p", {
      text: `Tip: secret id example — ${API_KEY_SECRET_ID_DEFAULT}`,
      cls: "setting-item-description",
    });
  }

  private renderAutoRunSection(containerEl: HTMLElement) {
    settingHeading(containerEl, "Auto-run (this device)");
    containerEl.createEl("p", {
      text: "Stored only on this device (not synced via data.json). Default off. Requires a one-time privacy acknowledgment — unattended runs send titles + captures to Anthropic.",
      cls: "setting-item-description",
    });

    const load = (k: string): unknown => loadLocal(this.app, k);
    const save = (k: string, v: unknown) => this.app.saveLocalStorage(k, v);
    const state = readDeviceAutoRunState(load);

    new Setting(containerEl)
      .setName("Data egress acknowledgment")
      .setDesc(
        "I understand auto-run will send my vault title graph and each capture to the Anthropic API over TLS when Obsidian opens (unattended).",
      )
      .addToggle((toggle) =>
        toggle.setValue(state.egressAcked).onChange((on) => {
          writeEgressAck(save, on);
          if (!on) {
            writeAutoRunEnabled(save, false);
          }
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName("Auto-run on open")
      .setDesc(
        state.egressAcked
          ? "When enabled: once per calendar day after layout + metadata are ready. Caps work per launch; offline fails silently until next day."
          : "Enable the acknowledgment above first.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(state.enabled && state.egressAcked)
          .setDisabled(!state.egressAcked)
          .onChange((on) => {
            if (on && !state.egressAcked) {
              writeAutoRunEnabled(save, false);
              this.display();
              return;
            }
            writeAutoRunEnabled(save, on);
            this.display();
          }),
      );

    if (state.lastRunDay) {
      containerEl.createEl("p", {
        text: `Last auto-run day (this device): ${state.lastRunDay}`,
        cls: "setting-item-description",
      });
    }
  }

  private renderModelSection(containerEl: HTMLElement) {
    settingHeading(containerEl, "Filing");

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Anthropic model id. Default: claude-sonnet-5.")
      .addText((text) =>
        text
          .setPlaceholder("claude-sonnet-5")
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value.trim() || "claude-sonnet-5";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Atom folder")
      .setDesc(
        "Flat single folder for atom notes (e.g. Atoms). Paths with .. or subfolders are rejected.",
      )
      .addText((text) =>
        text
          .setPlaceholder("Atoms")
          .setValue(this.plugin.settings.atomFolder)
          .onChange(async (value) => {
            this.plugin.settings.atomFolder = clampAtomFolder(value);
            await this.plugin.saveSettings();
          }),
      );
  }

  private renderVocabularySection(containerEl: HTMLElement) {
    settingHeading(containerEl, "Tag vocabulary");
    containerEl.createEl("p", {
      text: "Active tags may be applied by the model. #person, #preferences, and #relationship always work (smart defaults). Proposed tags need one-tap approval. People: link to a hub note (e.g. Alex); atoms stay flat — use backlinks, not AI folders.",
      cls: "setting-item-description",
    });

    const active = [...this.plugin.settings.activeVocabulary].sort((a, b) =>
      a.localeCompare(b),
    );

    for (const tag of active) {
      new Setting(containerEl)
        .setName(`#${tag}`)
        .setDesc("Active — eligible for classification")
        .addToggle((toggle) =>
          toggle.setValue(true).onChange(async (on) => {
            if (!on) {
              this.plugin.settings.activeVocabulary = removeActiveTag(
                tag,
                this.plugin.settings.activeVocabulary,
              );
              await this.plugin.saveSettings();
              this.display();
            }
          }),
        );
    }

    new Setting(containerEl)
      .setName("Add custom Active tag")
      .setDesc("Lowercase, no # required.")
      .addText((text) =>
        text
          .setPlaceholder("e.g. health")
          .setValue(this.customTagDraft)
          .onChange((v) => {
            this.customTagDraft = v;
          }),
      )
      .addButton((btn) =>
        btn.setButtonText("Add").onClick(async () => {
          const t = normalizeTag(this.customTagDraft);
          if (!t) return;
          this.plugin.settings.activeVocabulary = addCustomActiveTag(
            t,
            this.plugin.settings.activeVocabulary,
          );
          this.customTagDraft = "";
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    // Proposed tags awaiting approval
    const proposed = this.plugin.settings.proposedTags ?? [];
    if (proposed.length > 0) {
      settingHeading(containerEl, "Proposed (approve to activate)");
      for (const tag of proposed) {
        new Setting(containerEl)
          .setName(`#${tag}`)
          .setDesc("From classify runs — not applied until approved")
          .addButton((btn) =>
            btn.setButtonText("Approve").setCta().onClick(async () => {
              const next = approveProposedTag(
                tag,
                this.plugin.settings.activeVocabulary,
                this.plugin.settings.proposedTags,
              );
              this.plugin.settings.activeVocabulary = next.activeVocabulary;
              this.plugin.settings.proposedTags = next.proposedTags;
              await this.plugin.saveSettings();
              this.display();
            }),
          )
          .addButton((btn) =>
            btn.setButtonText("Dismiss").onClick(async () => {
              this.plugin.settings.proposedTags =
                this.plugin.settings.proposedTags.filter(
                  (t) => normalizeTag(t) !== normalizeTag(tag),
                );
              await this.plugin.saveSettings();
              this.display();
            }),
          );
      }
    }

    // Found in vault
    settingHeading(containerEl, "Found in your vault");
    const files = this.app.vault.getMarkdownFiles();
    const caches = files.map((f) => ({
      path: f.path,
      cache: this.app.metadataCache.getFileCache(f),
    }));
    const counts = aggregateTagsFromFileCaches(caches);
    const ranked = tagCountsSorted(counts).slice(0, 30);
    const activeSet = new Set(active.map(normalizeTag));

    if (ranked.length === 0) {
      containerEl.createEl("p", {
        text: "No tags found in vault yet.",
        cls: "setting-item-description",
      });
    }

    for (const { tag, count } of ranked) {
      if (activeSet.has(tag)) continue;
      new Setting(containerEl)
        .setName(`#${tag}`)
        .setDesc(`${count} use(s) — tap to promote to Active`)
        .addButton((btn) =>
          btn.setButtonText("Activate").onClick(async () => {
            this.plugin.settings.activeVocabulary = addCustomActiveTag(
              tag,
              this.plugin.settings.activeVocabulary,
            );
            await this.plugin.saveSettings();
            this.display();
          }),
        );
    }
  }

  private renderDevHints(containerEl: HTMLElement) {
    settingHeading(containerEl, "Development");
    const version = this.plugin.manifest.version ?? "?";
    containerEl.createEl("p", {
      text: `Installed version: ${version}. After desktop install + Sync, confirm this matches on phone. ./scripts/install-to-vault.sh reloads via Obsidian CLI.`,
      cls: "setting-item-description",
    });
  }
}
