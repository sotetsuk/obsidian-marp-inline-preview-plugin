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
    const marprc = await this.findMarprc(file);
    const cfg = marprc ? this.parseMarprc(marprc.path, marprc.content) : null;

    if (cfg?.themeSet) {
      const entries = Array.isArray(cfg.themeSet) ? cfg.themeSet : [cfg.themeSet];
      const slash = marprc ? marprc.path.lastIndexOf('/') : -1;
      const baseDir = slash > 0 ? marprc!.path.slice(0, slash) : '';
      const adapter = this.app.vault.adapter;
      for (const entry of entries) {
        const resolved = normalizePath(baseDir ? `${baseDir}/${entry}` : entry);
        // Try stat to detect folders. On Obsidian Mobile, stat() returns null
        // (rather than throws) when the path doesn't exist or is hidden; we
        // treat anything that isn't an explicit folder as a file and let
        // readCss() handle the actual existence check via read+catch.
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

  /**
   * Locate `.marprc.yml` (or `.marprc.yaml`) and return its content alongside
   * the path. We use read+catch instead of exists()+read() because Obsidian
   * Mobile's Capacitor adapter has been observed to return `false` from
   * `exists()` for dotfiles in the vault root even when `read()` succeeds for
   * the same path. read+catch sidesteps that asymmetry and also halves the
   * number of adapter calls on the happy path.
   */
  private async findMarprc(file: TFile): Promise<{ path: string; content: string } | null> {
    const candidates: string[] = [];
    for (const name of ['.marprc.yml', '.marprc.yaml']) candidates.push(name);
    const dir = file.parent?.path;
    if (dir && dir !== '/') {
      for (const name of ['.marprc.yml', '.marprc.yaml']) {
        candidates.push(normalizePath(`${dir}/${name}`));
      }
    }
    const adapter = this.app.vault.adapter;
    for (const path of candidates) {
      try {
        const content = await adapter.read(path);
        return { path, content };
      } catch {
        // Not present (or unreadable) — try next candidate. We swallow this
        // because the lookup itself is best-effort: most vaults won't have a
        // .marprc.yml at every candidate location and we don't want to spam
        // the console with "file not found" for each miss.
      }
    }
    return null;
  }

  private parseMarprc(path: string, content: string): Marprc | null {
    try {
      const parsed = yaml.load(content);
      if (parsed && typeof parsed === 'object') return parsed as Marprc;
    } catch (e) {
      console.warn(`[marp-inline-preview] failed to parse ${path}`, e);
    }
    return null;
  }

  private async readCss(path: string): Promise<string | null> {
    const cached = this.cssByPath.get(path);
    if (cached != null) return cached;
    try {
      const css = await this.app.vault.adapter.read(path);
      this.cssByPath.set(path, css);
      return css;
    } catch (e) {
      console.warn(`[marp-inline-preview] themeSet entry not readable: ${path}`, e);
      return null;
    }
  }

}
