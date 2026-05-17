import { App, TFile, normalizePath } from 'obsidian';
import yaml from 'js-yaml';
import type { MarpEngine } from './engine';

type Marprc = {
  theme?: string;
  themeSet?: string | string[];
  options?: Record<string, unknown>;
};

export type ThemeContext = {
  /** Theme name that should be applied to the deck (frontmatter > .marprc.yml > null). */
  theme: string | null;
  /** Concatenated CSS of every theme we registered for this resolve call. */
  registeredCss: string;
};

export class ThemeResolver {
  /** Cache of CSS string by resolved path, so repeated renders don't re-read. */
  private cssByPath = new Map<string, string>();

  constructor(private app: App, private engine: MarpEngine, private explicitMarprcPath: string | null = null) {}

  setMarprcPath(path: string | null): void {
    this.explicitMarprcPath = path;
    this.cssByPath.clear();
  }

  /** Drop all caches so the next collect() re-reads from disk. */
  invalidate(): void {
    this.cssByPath.clear();
  }

  /**
   * Resolve themes for a given markdown file. Reads .marprc.yml (if any),
   * registers every CSS in its `themeSet` with the Marp engine, and returns
   * the chosen theme name plus the concatenated CSS we registered.
   *
   * Search order for .marprc.yml: explicit setting > vault root > file's folder.
   */
  async collect(file: TFile, frontmatterTheme: string | null): Promise<ThemeContext> {
    const marprcPath = await this.findMarprc(file);
    let cfg: Marprc | null = null;
    if (marprcPath) {
      cfg = await this.readMarprc(marprcPath);
    }

    const themeSet = this.toArray(cfg?.themeSet);
    const baseDir = marprcPath ? parentDir(marprcPath) : '';
    let registered = '';
    for (const entry of themeSet) {
      const resolved = normalizePath(baseDir ? `${baseDir}/${entry}` : entry);
      const css = await this.readCss(resolved);
      if (css == null) continue;
      this.engine.registerTheme(css);
      registered += `\n/* ${resolved} */\n${css}`;
    }

    const theme = frontmatterTheme || cfg?.theme || null;
    return { theme, registeredCss: registered };
  }

  /** Locate the active .marprc.yml file. Returns vault-relative path or null. */
  private async findMarprc(file: TFile): Promise<string | null> {
    const adapter = this.app.vault.adapter;
    if (this.explicitMarprcPath) {
      const p = normalizePath(this.explicitMarprcPath);
      return (await adapter.exists(p)) ? p : null;
    }
    // 1. Vault root
    const rootCandidates = ['.marprc.yml', '.marprc.yaml'];
    for (const name of rootCandidates) {
      if (await adapter.exists(name)) return name;
    }
    // 2. Same directory as the file
    const dir = file.parent?.path ?? '';
    if (dir && dir !== '/') {
      for (const name of rootCandidates) {
        const p = normalizePath(`${dir}/${name}`);
        if (await adapter.exists(p)) return p;
      }
    }
    return null;
  }

  private async readMarprc(path: string): Promise<Marprc | null> {
    try {
      const raw = await this.app.vault.adapter.read(path);
      const parsed = yaml.load(raw);
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

  private toArray(v: string | string[] | undefined | null): string[] {
    if (!v) return [];
    return Array.isArray(v) ? v : [v];
  }
}

function parentDir(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}
