import { App, PluginSettingTab, Setting } from 'obsidian';
import type MarpInlinePreviewPlugin from './main';

export interface MarpSettings {
  editPreview: boolean;
  readingPreview: boolean;
  math: 'katex' | 'off';
  syncScrollPosition: boolean;
}

export const DEFAULT_SETTINGS: MarpSettings = {
  editPreview: true,
  readingPreview: true,
  math: 'katex',
  syncScrollPosition: true,
};

/** Fixed debounce for edit-mode rebuilds. Was tunable via settings; pinned here. */
export const DEBOUNCE_MS = 300;

export class MarpSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: MarpInlinePreviewPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Marp Inline Preview' });
    containerEl.createEl('p', {
      text: 'Only files with `marp: true` in their YAML frontmatter are processed.',
    });

    new Setting(containerEl)
      .setName('Inline preview in edit mode')
      .setDesc('Show each slide rendered below its --- separator in the editor.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.editPreview).onChange(async (v) => {
          this.plugin.settings.editPreview = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Full preview in reading mode')
      .setDesc('Replace the rendered markdown with the full Marp deck.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.readingPreview).onChange(async (v) => {
          this.plugin.settings.readingPreview = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Sync slide position')
      .setDesc(
        'Keep the same slide visible when switching between editing and reading mode, ' +
          'and when viewing the deck in split panes.',
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.syncScrollPosition).onChange(async (v) => {
          this.plugin.settings.syncScrollPosition = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Math rendering')
      .setDesc('KaTeX is bundled. Disable to skip math entirely.')
      .addDropdown((d) =>
        d
          .addOption('katex', 'KaTeX')
          .addOption('off', 'Off')
          .setValue(this.plugin.settings.math)
          .onChange(async (v: 'katex' | 'off') => {
            this.plugin.settings.math = v;
            await this.plugin.saveSettings();
            this.plugin.rebuildEngine();
          }),
      );
  }
}
