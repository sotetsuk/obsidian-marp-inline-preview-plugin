import { App, TFile, normalizePath } from 'obsidian';
import yaml from 'js-yaml';
import type { MarpEngine } from './engine';

type Marprc = {
  theme?: string;
  themeSet?: string | string[];
};

// Set to false (or strip) once the Android theme issue is diagnosed. These
// logs are deliberately unconditional so the user can confirm the load path
// end-to-end from Obsidian Mobile's remote debug console.
const DEBUG = true;
function log(msg: string, ...rest: unknown[]): void {
  if (DEBUG) console.log(`[marp-inline-preview] ${msg}`, ...rest);
}

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
    let registered = 0;
    let attempted = 0;

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
                attempted++;
                const css = await this.readCss(p);
                if (css != null) {
                  this.engine.registerTheme(css);
                  registered++;
                }
              }
            }
          } catch (e) {
            console.warn(`[marp-inline-preview] failed to list ${resolved}`, e);
          }
        } else {
          attempted++;
          const css = await this.readCss(resolved);
          if (css != null) {
            this.engine.registerTheme(css);
            registered++;
          }
        }
      }
    }

    const resolvedTheme = frontmatterTheme || cfg?.theme || null;
    log(
      `collect(${file.path}): marprc=${marprc?.path ?? 'none'} ` +
        `frontmatterTheme=${frontmatterTheme ?? 'none'} ` +
        `cfgTheme=${cfg?.theme ?? 'none'} ` +
        `themeSet=${registered}/${attempted} ` +
        `resolved=${resolvedTheme ?? 'none'}`,
    );
    return resolvedTheme;
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
    const attempts: Array<{ path: string; ok: boolean; err?: string }> = [];
    let found: { path: string; content: string } | null = null;
    for (const path of candidates) {
      try {
        const content = await adapter.read(path);
        attempts.push({ path, ok: true });
        found = { path, content };
        break;
      } catch (e) {
        attempts.push({ path, ok: false, err: (e as Error)?.message ?? String(e) });
      }
    }
    log(`findMarprc(${file.path}) tried:`, attempts);
    return found;
  }

  private parseMarprc(path: string, content: string): Marprc | null {
    try {
      const parsed = yaml.load(content);
      if (parsed && typeof parsed === 'object') {
        log(`parseMarprc(${path}) ok:`, parsed);
        return parsed as Marprc;
      }
      log(`parseMarprc(${path}) returned non-object:`, parsed);
    } catch (e) {
      console.warn(`[marp-inline-preview] failed to parse ${path}`, e);
    }
    return null;
  }

  private async readCss(path: string): Promise<string | null> {
    const cached = this.cssByPath.get(path);
    if (cached != null) {
      log(`readCss(${path}) cache hit (${cached.length} chars)`);
      return cached;
    }
    try {
      const css = await this.app.vault.adapter.read(path);
      this.cssByPath.set(path, css);
      log(`readCss(${path}) ok (${css.length} chars)`);
      return css;
    } catch (e) {
      console.warn(`[marp-inline-preview] themeSet entry not readable: ${path}`, e);
      return null;
    }
  }
}
