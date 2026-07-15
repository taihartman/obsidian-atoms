import { App, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type AiLinkerPlugin from "./main";
import { aggregateTagsFromFileCaches } from "./context";
import {
  readDeviceAutoRunState,
  writeAutoRunEnabled,
  writeEgressAck,
} from "./autorun";
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

export class AiLinkerSettingTab extends PluginSettingTab {
  plugin: AiLinkerPlugin;
  private customTagDraft = "";

  constructor(app: App, plugin: AiLinkerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "AI Linker" });
    containerEl.createEl("p", {
      text: "Classifies past daily-note captures into flat Atoms/ notes. Capture itself is handled by your iOS Shortcut.",
      cls: "setting-item-description",
    });

    this.renderApiSection(containerEl);
    this.renderAutoRunSection(containerEl);
    this.renderModelSection(containerEl);
    this.renderVocabularySection(containerEl);
    this.renderDevHints(containerEl);
  }

  private renderApiSection(containerEl: HTMLElement) {
    containerEl.createEl("h3", { text: "API & privacy" });

    new Setting(containerEl)
      .setName("Privacy")
      .setDesc(
        "Every run sends your vault's note titles, tags, and each capture to the Anthropic API over TLS. The model never rewrites your hand-authored notes — only new files in the atom folder and marker lines under captures.",
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
      new Setting(containerEl)
        .setName("Device-local API key")
        .setDesc("This device only. Prefer SecretStorage.")
        .addText((text) => {
          text
            .setPlaceholder("sk-ant-…")
            .setValue(
              (this.app.loadLocalStorage(LOCAL_STORAGE_API_KEY) as string) ??
                "",
            )
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
    containerEl.createEl("h3", { text: "Auto-run (this device)" });
    containerEl.createEl("p", {
      text: "Stored only on this device (not synced via data.json). Default off. Requires a one-time privacy acknowledgment — unattended runs send titles + captures to Anthropic.",
      cls: "setting-item-description",
    });

    const load = (k: string) => this.app.loadLocalStorage(k);
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
    containerEl.createEl("h3", { text: "Filing" });

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
      .setDesc("Flat folder for atom notes. Never chooses subfolders (R3).")
      .addText((text) =>
        text
          .setPlaceholder("Atoms")
          .setValue(this.plugin.settings.atomFolder)
          .onChange(async (value) => {
            this.plugin.settings.atomFolder = value.trim() || "Atoms";
            await this.plugin.saveSettings();
          }),
      );
  }

  private renderVocabularySection(containerEl: HTMLElement) {
    containerEl.createEl("h3", { text: "Tag vocabulary" });
    containerEl.createEl("p", {
      text: "Only Active tags may be applied by the model. Proposed tags need one-tap approval (never auto-applied).",
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
      containerEl.createEl("h4", { text: "Proposed (approve to activate)" });
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
    containerEl.createEl("h4", { text: "Found in your vault" });
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
    containerEl.createEl("h3", { text: "Development" });
    containerEl.createEl("p", {
      text: "Throwaway vault only. ./scripts/install-to-vault.sh reloads via Obsidian CLI. ./scripts/verify.sh runs automated checks.",
      cls: "setting-item-description",
    });
  }
}
