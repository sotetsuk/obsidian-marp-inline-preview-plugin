import { App, PluginSettingTab, Setting } from 'obsidian';
import type MarpInlinePreviewPlugin from './main';

export interface MarpSettings {
  editPreview: boolean;
  readingPreview: boolean;
  math: 'katex' | 'off';
  debounceMs: number;
  marprcPath: string;
}

export const DEFAULT_SETTINGS: MarpSettings = {
  editPreview: true,
  readingPreview: true,
  math: 'katex',
  debounceMs: 300,
  marprcPath: '',
};

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

    new Setting(containerEl)
      .setName('Edit-mode debounce (ms)')
      .setDesc('How long to wait after typing before re-rendering slides.')
      .addText((t) =>
        t
          .setPlaceholder('300')
          .setValue(String(this.plugin.settings.debounceMs))
          .onChange(async (v) => {
            const n = Number.parseInt(v, 10);
            if (Number.isFinite(n) && n >= 0) {
              this.plugin.settings.debounceMs = n;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName('.marprc.yml path')
      .setDesc(
        'Vault-relative path to a Marp config file. Leave empty to auto-detect (vault root, then the slide file\'s folder).',
      )
      .addText((t) =>
        t
          .setPlaceholder('.marprc.yml')
          .setValue(this.plugin.settings.marprcPath)
          .onChange(async (v) => {
            this.plugin.settings.marprcPath = v.trim();
            await this.plugin.saveSettings();
            this.plugin.themes.setMarprcPath(this.plugin.settings.marprcPath || null);
          }),
      );
  }
}
