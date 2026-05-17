import { App, MarkdownPostProcessor, MarkdownPostProcessorContext, TFile } from 'obsidian';
import type { MarpEngine } from '../marp/engine';
import type { ThemeResolver } from '../marp/themes';
import { injectThemeIfMissing } from '../marp/frontmatter';
import { mountDeck } from '../util/shadow';
import { fnv1a32 } from '../util/hash';

export type ReadingDeps = {
  app: App;
  engine: MarpEngine;
  themes: ThemeResolver;
  enabled: () => boolean;
};

const SIZER_SELECTORS = ['.markdown-preview-sizer', '.markdown-preview-view'];
const OVERLAY_CLASS = 'marp-deck-overlay';
const ACTIVE_CLASS = 'marp-active';
let warnedNoSizer = false;

/**
 * Per-sizer render state. Keyed on the sizer element via WeakMap so closed
 * leaves are garbage-collected automatically. The value is a content hash;
 * equal hash means we can skip re-rendering on subsequent block calls.
 */
const renderState = new WeakMap<HTMLElement, string>();

export function buildReadingPostProcessor(deps: ReadingDeps): MarkdownPostProcessor {
  return async (el, ctx) => {
    if (!deps.enabled()) return;

    const sizer = findSizer(el);
    if (!sizer) {
      if (!warnedNoSizer) {
        warnedNoSizer = true;
        console.warn(
          '[marp-inline-preview] no preview-sizer ancestor found for post-processor element. ' +
            'Tried: ' + SIZER_SELECTORS.join(', '),
          { el, parents: parentClassChain(el) },
        );
      }
      return;
    }

    if (!isMarpFile(ctx, deps.app)) {
      cleanup(sizer);
      return;
    }

    const file = deps.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile)) return;

    try {
      const src = await deps.app.vault.cachedRead(file);
      const fmTheme = pickTheme(ctx, deps.app, file);
      const { theme } = await deps.themes.collect(file, fmTheme);
      const md = fmTheme ? src : injectThemeIfMissing(src, theme);

      // Hash on the markdown actually handed to Marp plus the chosen theme.
      // Theme CSS file content changes flow through ThemeResolver.invalidate()
      // plus a forced re-render dispatch from main.ts.
      const wantHash = fnv1a32(`${md}${theme ?? ''}`);
      if (renderState.get(sizer) === wantHash && sizer.querySelector(`:scope > .${OVERLAY_CLASS}`)) {
        return;
      }

      const { html, css } = deps.engine.render(md);

      sizer.querySelector(`:scope > .${OVERLAY_CLASS}`)?.remove();
      const overlay = document.createElement('div');
      overlay.className = `${OVERLAY_CLASS} marp-inline-preview-host marp-inline-preview-deck-host`;
      sizer.prepend(overlay);
      // Use ONLY Marp's emitted CSS. Marp already selected the right theme
      // from the registered themeSet; appending every registered theme's CSS
      // on top would let later themes cascade over the selected one.
      mountDeck(overlay, html, css);
      sizer.classList.add(ACTIVE_CLASS);
      renderState.set(sizer, wantHash);
    } catch (e) {
      console.error('[marp-inline-preview] reading-mode render failed', e);
      sizer.querySelector(`:scope > .${OVERLAY_CLASS}`)?.remove();
      const err = document.createElement('pre');
      err.className = `${OVERLAY_CLASS} marp-inline-preview-error`;
      err.textContent = `Marp render error: ${(e as Error).message}`;
      sizer.prepend(err);
      sizer.classList.add(ACTIVE_CLASS);
      renderState.set(sizer, '');
    }
  };
}

/** Remove any overlay we attached and restore Obsidian's native rendering. */
export function cleanup(sizer: HTMLElement): void {
  if (!sizer.classList.contains(ACTIVE_CLASS) && !renderState.has(sizer)) return;
  sizer.classList.remove(ACTIVE_CLASS);
  sizer.querySelectorAll(`:scope > .${OVERLAY_CLASS}`).forEach((n) => n.remove());
  renderState.delete(sizer);
}

function findSizer(el: HTMLElement): HTMLElement | null {
  for (const sel of SIZER_SELECTORS) {
    const found = el.closest(sel) as HTMLElement | null;
    if (found) return found;
  }
  return null;
}

function parentClassChain(el: HTMLElement | null, depth = 6): string[] {
  const out: string[] = [];
  let cur: HTMLElement | null = el;
  while (cur && depth-- > 0) {
    out.push(`${cur.tagName.toLowerCase()}.${cur.className}`);
    cur = cur.parentElement;
  }
  return out;
}

function isMarpFile(ctx: MarkdownPostProcessorContext, app: App): boolean {
  const fm = readFrontmatter(ctx, app);
  return fm?.marp === true || fm?.marp === 'true';
}

function pickTheme(ctx: MarkdownPostProcessorContext, app: App, file: TFile): string | null {
  const fm = readFrontmatter(ctx, app, file);
  const t = fm?.theme;
  return typeof t === 'string' && t.length > 0 ? t : null;
}

function readFrontmatter(
  ctx: MarkdownPostProcessorContext,
  app: App,
  file?: TFile,
): Record<string, unknown> | null {
  const direct = (ctx as unknown as { frontmatter?: Record<string, unknown> }).frontmatter;
  if (direct) return direct;
  // Fallback: ctx.frontmatter is not always populated synchronously on the
  // first render after open. metadataCache has the parsed result.
  const tfile = file ?? app.vault.getAbstractFileByPath(ctx.sourcePath);
  if (tfile instanceof TFile) {
    return app.metadataCache.getFileCache(tfile)?.frontmatter ?? null;
  }
  return null;
}
