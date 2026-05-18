// CJS stub of the runtime `obsidian` module — used only by the bundle smoke
// test that loads the built main.js inside Node. The vitest source tests use
// tests/obsidian-stub.ts for src/ imports; this file is for the bundled CJS
// require("obsidian") calls.

class App {}
class Plugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
  }
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
  registerEvent() {}
  addSettingTab() {}
  addCommand() {}
  async loadData() { return null; }
  async saveData() {}
}
class PluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
  }
}
class Setting {
  constructor() { return this; }
  setName() { return this; }
  setDesc() { return this; }
  addText() { return this; }
  addToggle() { return this; }
  addDropdown() { return this; }
}
class MarkdownView {}
class TFile {}

function normalizePath(p) {
  let s = String(p || '').replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

module.exports = {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  MarkdownView,
  TFile,
  normalizePath,
};
