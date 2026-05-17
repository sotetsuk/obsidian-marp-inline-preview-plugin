# Marp Inline Preview for Obsidian

Render [Marp](https://marp.app/) slide decks directly inside Obsidian — inline beneath each `---` slide separator while editing, and as the full deck in reading mode. Works on desktop and mobile.

| Mode | What you see |
| --- | --- |
| **Edit / Live Preview** | A rendered slide widget appears under each slide break. Updates as you type, with a configurable debounce. |
| **Reading** | The entire page is replaced by the rendered Marp deck. |

Only files whose YAML frontmatter contains `marp: true` are touched. Everything else renders as ordinary Markdown.

## Features

- Marp Core 4 under the hood — same renderer as the official Marp tooling, in pure JavaScript so it works on Obsidian Mobile (iOS & Android).
- Custom theme support through `.marprc.yml` (vault-root, with a fallback to the slide file's folder), plus the standard frontmatter `theme:` directive.
- KaTeX math is bundled — no network roundtrips, no broken formulae offline.
- Marp's per-slide CSS is mounted inside Shadow DOM, so it can't leak into Obsidian's own UI.
- Pluggable: toggle the edit-mode preview, reading-mode preview, math support, and debounce interval from Settings.

## Quick start

```yaml
---
marp: true
theme: default
---

# My deck

- Slide one

---

## Slide two

That's it.
```

Save the file. Switch between edit and reading mode to see the previews.

## Custom themes via `.marprc.yml`

Place a `.marprc.yml` at the vault root (preferred) or next to your slide file:

```yaml
themeSet:
  - themes/my-theme.css
theme: my-theme
```

Each entry in `themeSet` is a vault-relative path resolved against the `.marprc.yml` location. The plugin reads those CSS files via the Obsidian Vault API (no Node `fs`), so it works on mobile too. Your CSS must have a header comment such as `/* @theme my-theme */` to be selectable by name.

Slides can opt in per-file via frontmatter:

```yaml
---
marp: true
theme: my-theme
---
```

## Settings

- **Inline preview in edit mode** — toggle the CodeMirror widget.
- **Full preview in reading mode** — toggle the deck render.
- **Math rendering** — `KaTeX` (bundled) or `Off`.
- **Edit-mode debounce (ms)** — how long to wait after a keystroke before re-rendering. Default `300`.
- **.marprc.yml path** — leave blank to auto-detect, or pin a specific vault-relative path.

Command palette: `Marp Inline Preview: Refresh Marp previews` forces a full reload (useful after editing a theme file from outside Obsidian).

## Install (manual copy)

This plugin is distributed as build artefacts; copy the three files below into any vault you want to use it from.

1. Clone this repository and build:

   ```bash
   git clone https://github.com/<you>/obsidian-marp-inline-preview-plugin
   cd obsidian-marp-inline-preview-plugin
   npm install
   npm run build
   ```

   The build produces `main.js` in the repo root (alongside the checked-in `manifest.json` and `styles.css`).

2. In the target vault, create the plugin folder if it doesn't exist:

   ```
   <vault>/.obsidian/plugins/marp-inline-preview/
   ```

   On mobile, you may need a file manager (e.g. Files.app on iOS or any Android file browser) to navigate into the hidden `.obsidian/plugins/` directory. The Obsidian Sync service syncs this folder automatically if enabled.

3. Copy these three files into the new folder:

   - `main.js`
   - `manifest.json`
   - `styles.css`

4. Reload Obsidian (command palette → `Reload app without saving`).

5. Enable the plugin under **Settings → Community plugins → Marp Inline Preview**. You'll be asked to turn off Restricted Mode first if you haven't already.

To **update**, repeat step 3 (overwrite the three files) and reload. To **uninstall**, disable the plugin and delete the folder.

## Development

```bash
npm install
npm run dev:vault    # symlinks build outputs into test-vault/ and starts esbuild watch
```

Then in Obsidian: `File → Open vault…` and pick the `test-vault/` folder in this repo. Enable the plugin and open one of the files in `slides/`.

`npm run build` produces a production bundle (~1.5 MB).

Project layout:

```
src/
├── main.ts              Plugin entry: register processors, settings, events
├── settings.ts          Settings model + PluginSettingTab
├── marp/
│   ├── engine.ts        Marp Core wrapper (themes, render helpers)
│   ├── themes.ts        .marprc.yml discovery and theme registration
│   └── slides.ts        Slide-break detection (frontmatter & fence aware)
├── reading/
│   └── postProcessor.ts MarkdownPostProcessor that replaces the preview section
├── editor/
│   ├── extension.ts     CM6 ViewPlugin that adds block widgets after each break
│   └── widget.ts        WidgetType using Shadow DOM
└── util/
    ├── debounce.ts
    └── shadow.ts        Shadow-root mounting helpers
```

## Mobile notes

- Everything goes through `app.vault.adapter` — no Node `fs`, no Electron-only APIs.
- `mathjax-full` is aliased out at bundle time so the plugin stays small.
- KaTeX fonts are loaded from the bundle, not a CDN. Math works offline.
- Twemoji is disabled; OS Unicode emoji are used instead, so no CDN fetch.

## Limitations / known issues

- **Mermaid** isn't supported — Marp Core itself doesn't ship Mermaid integration.
- Reading-mode rendering replaces the preview section wholesale, so plugins that mutate that section (e.g. some outline plugins) may not work on Marp files.
- The CodeMirror plugin uses `editor.cm` to associate a `ViewPlugin` with the active `TFile`; this is an internal property and could break in a future Obsidian release.

## License

MIT — see [`LICENSE`](./LICENSE).
