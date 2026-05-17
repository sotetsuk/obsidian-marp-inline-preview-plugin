import { App, TFile, normalizePath } from 'obsidian';
import yaml from 'js-yaml';
import type { MarpEngine } from './engine';

type Marprc = {
  theme?: string;
  themeSet?: string | string[];
};

export class ThemeResolver {
  private cssByPath = new Map<string, string>();

  constructor(private app: App, private engine: MarpEngine) {}

  /** Drop the CSS cache so the next collect() re-reads from disk. */
  invalidate(): void {
    this.cssByPath.clear();
  }

  /**
   * Register every CSS file referenced by the active `.marprc.yml`'s
   * `themeSet` with the Marp engine (side effect), and return the theme name
   * that should be applied for this file (frontmatter > .marprc.yml > null).
   *
   * `.marprc.yml` lookup order: vault root, then the slide file's folder.
   */
  async collect(file: TFile, frontmatterTheme: string | null): Promise<string | null> {
    const marprcPath = await this.findMarprc(file);
    const cfg = marprcPath ? await this.readMarprc(marprcPath) : null;

    if (cfg?.themeSet) {
      const entries = Array.isArray(cfg.themeSet) ? cfg.themeSet : [cfg.themeSet];
      const slash = marprcPath ? marprcPath.lastIndexOf('/') : -1;
      const baseDir = slash > 0 ? marprcPath!.slice(0, slash) : '';
      const adapter = this.app.vault.adapter;
      for (const entry of entries) {
        const resolved = normalizePath(baseDir ? `${baseDir}/${entry}` : entry);
        let stat: { type: 'file' | 'folder' } | null = null;
        try {
          stat = await adapter.stat(resolved);
        } catch (e) {
          console.warn(`[marp-inline-preview] failed to stat ${resolved}`, e);
        }
        if (stat?.type === 'folder') {
          // Match Marp CLI: shallow scan of *.css in the folder.
          try {
            const listed = await adapter.list(resolved);
            for (const p of listed.files) {
              if (p.toLowerCase().endsWith('.css')) {
                const css = await this.readCss(p);
                if (css != null) this.engine.registerTheme(css);
              }
            }
          } catch (e) {
            console.warn(`[marp-inline-preview] failed to list ${resolved}`, e);
          }
        } else {
          const css = await this.readCss(resolved);
          if (css != null) this.engine.registerTheme(css);
        }
      }
    }

    return frontmatterTheme || cfg?.theme || null;
  }

  private async findMarprc(file: TFile): Promise<string | null> {
    const adapter = this.app.vault.adapter;
    for (const name of ['.marprc.yml', '.marprc.yaml']) {
      if (await adapter.exists(name)) return name;
    }
    const dir = file.parent?.path;
    if (dir && dir !== '/') {
      for (const name of ['.marprc.yml', '.marprc.yaml']) {
        const p = normalizePath(`${dir}/${name}`);
        if (await adapter.exists(p)) return p;
      }
    }
    return null;
  }

  private async readMarprc(path: string): Promise<Marprc | null> {
    try {
      const parsed = yaml.load(await this.app.vault.adapter.read(path));
      if (parsed && typeof parsed === 'object') return parsed as Marprc;
    } catch (e) {
      console.warn(`[marp-inline-preview] failed to read ${path}`, e);
    }
    return null;
  }

  private async readCss(path: string): Promise<string | null> {
    const cached = this.cssByPath.get(path);
    if (cached != null) return cached;
    try {
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(path))) return null;
      const css = await adapter.read(path);
      this.cssByPath.set(path, css);
      return css;
    } catch (e) {
      console.warn(`[marp-inline-preview] failed to read theme ${path}`, e);
      return null;
    }
  }
}
