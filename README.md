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

Command palette: `Marp Inline Preview: Refresh Marp previews` forces a full reload (useful after editing a theme file from outside Obsidian).

## Install: build locally and copy into another vault

The plugin ships as three files (`main.js`, `manifest.json`, `styles.css`). You build them once in this repo, then drop them into any vault.

### 1. Build the plugin

Requires Node.js 18 or newer.

```bash
git clone https://github.com/<you>/obsidian-marp-inline-preview-plugin.git
cd obsidian-marp-inline-preview-plugin
npm install
npm run build
```

After `npm run build` the repo root contains:

```
main.js        # bundled plugin code (~1.9 MB, includes Marp Core + KaTeX)
manifest.json  # plugin metadata (checked in)
styles.css     # host-side styles (checked in)
```

### 2. Find the target vault's plugin folder

Inside your Obsidian vault there is a hidden `.obsidian/` directory. Plugins live under `.obsidian/plugins/<plugin-id>/`. For this plugin the folder is `marp-inline-preview`.

Typical full paths:

| OS | Example path |
|---|---|
| macOS / Linux | `/path/to/MyVault/.obsidian/plugins/marp-inline-preview/` |
| Windows | `C:\Users\you\Documents\MyVault\.obsidian\plugins\marp-inline-preview\` |
| iOS | `On My iPhone → Obsidian → MyVault → .obsidian → plugins → marp-inline-preview` (Files.app, "Show Hidden Files" on) |
| Android | `/storage/emulated/0/MyVault/.obsidian/plugins/marp-inline-preview/` (any file manager) |

Create the directory if it doesn't exist yet.

### 3. Copy the three files

From the repo root, with `TARGET_VAULT` set to your vault directory:

```bash
# macOS / Linux
TARGET_VAULT="/path/to/MyVault"
mkdir -p "$TARGET_VAULT/.obsidian/plugins/marp-inline-preview"
cp main.js manifest.json styles.css "$TARGET_VAULT/.obsidian/plugins/marp-inline-preview/"
```

```powershell
# Windows PowerShell
$TARGET_VAULT = "C:\Users\you\Documents\MyVault"
New-Item -ItemType Directory -Force -Path "$TARGET_VAULT\.obsidian\plugins\marp-inline-preview" | Out-Null
Copy-Item main.js, manifest.json, styles.css "$TARGET_VAULT\.obsidian\plugins\marp-inline-preview\"
```

On mobile, sync the three files via iCloud / Obsidian Sync / a USB transfer to the same path. Obsidian Sync replicates `.obsidian/plugins/` automatically if you enable it.

### 4. Enable it in Obsidian

1. Open the target vault.
2. **Settings → Community plugins**. If you see "Restricted mode", turn it off.
3. Reload the plugin list (the circular-arrow icon next to "Installed plugins"), or run **Reload app without saving** from the command palette.
4. Toggle **Marp Inline Preview** on.

Open a markdown file with `marp: true` in its frontmatter — you should see slide widgets in edit mode and the full deck in reading mode.

### Updating

Re-run `npm run build`, then re-copy the same three files (step 3) and reload Obsidian.

### Uninstalling

Disable the plugin in Settings → Community plugins, then delete `<vault>/.obsidian/plugins/marp-inline-preview/`.

## Development

```bash
npm install
npm run dev:vault    # symlinks build outputs into test-vault/ and starts esbuild watch
```

Then in Obsidian: `File → Open vault…` and pick the `test-vault/` folder in this repo. Enable the plugin and open one of the files in `slides/`.

`npm run build` produces a production bundle (~1.9 MB).

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
