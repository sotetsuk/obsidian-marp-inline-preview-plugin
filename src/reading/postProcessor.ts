import { App, MarkdownPostProcessor, MarkdownPostProcessorContext, TFile } from 'obsidian';
import type { MarpEngine } from '../marp/engine';
import type { ThemeResolver } from '../marp/themes';
import { injectThemeIfMissing } from '../marp/frontmatter';
import { mountDeck } from '../util/frame';
import { rewriteImageSrcs } from '../util/images';
import { fnv1a32 } from '../util/hash';

export type ReadingDeps = {
  app: App;
  engine: MarpEngine;
  themes: ThemeResolver;
  enabled: () => boolean;
};

const HOST_SELECTOR = '.markdown-preview-view';
const OVERLAY_CLASS = 'marp-deck-overlay';
const ACTIVE_CLASS = 'marp-active';
const STASH_ATTR = 'data-marp-stashed-display';

type Snapshot = { hash: string; slides: string[]; css: string };
const renderState = new WeakMap<HTMLElement, Snapshot>();
const observed = new WeakSet<HTMLElement>();

export function buildReadingPostProcessor(deps: ReadingDeps): MarkdownPostProcessor {
  return async (el, ctx) => {
    if (!deps.enabled()) return;
    // Obsidian sometimes invokes the post-processor on an element that
    // isn't attached to the preview tree yet; defer one tick and retry
    // before giving up.
    let host = el.closest(HOST_SELECTOR) as HTMLElement | null;
    if (!host) {
      await new Promise((r) => setTimeout(r, 0));
      host = el.closest(HOST_SELECTOR) as HTMLElement | null;
    }
    if (!host || host.offsetParent === null) return;

    if (!isMarpFile(ctx, deps.app)) {
      cleanup(host);
      return;
    }

    const file = deps.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile)) return;

    try {
      const src = await deps.app.vault.cachedRead(file);
      const fmTheme = pickTheme(ctx, deps.app, file);
      const theme = await deps.themes.collect(file, fmTheme);
      const md = fmTheme ? src : injectThemeIfMissing(src, theme);
      const wantHash = fnv1a32(`${md}${theme ?? ''}`);

      const prior = renderState.get(host);
      const overlayPresent = !!host.querySelector(`:scope > .${OVERLAY_CLASS}`);
      if (prior?.hash === wantHash && overlayPresent) {
        // Same content already mounted — just reassert hide in case Obsidian
        // appended new siblings since the last call.
        hideNonOverlay(host);
        return;
      }

      const rendered = deps.engine.renderArray(md);
      const slides = rendered.html.map((h) => rewriteImageSrcs(h, ctx.sourcePath, deps.app));
      const css = rendered.css;
      mountOverlay(host, slides, css);
      renderState.set(host, { hash: wantHash, slides, css });
      ensureObserver(host);
    } catch (e) {
      console.error('[marp-inline-preview] reading-mode render failed', e);
      host.querySelectorAll(`:scope > .${OVERLAY_CLASS}`).forEach((n) => n.remove());
      const err = createEl('pre', {
        cls: `${OVERLAY_CLASS} marp-inline-preview-error`,
        text: `Marp render error: ${(e as Error).message}`,
      });
      host.prepend(err);
      host.classList.add(ACTIVE_CLASS);
      hideNonOverlay(host);
    }
  };
}

function cleanup(host: HTMLElement): void {
  if (!host.classList.contains(ACTIVE_CLASS) && !renderState.has(host)) return;
  host.classList.remove(ACTIVE_CLASS);
  host.querySelectorAll(`:scope > .${OVERLAY_CLASS}`).forEach((n) => n.remove());
  unhideAll(host);
  renderState.delete(host);
}

function mountOverlay(host: HTMLElement, slides: string[], css: string): void {
  host.querySelectorAll(`:scope > .${OVERLAY_CLASS}`).forEach((n) => n.remove());
  const overlay = createDiv({ cls: OVERLAY_CLASS });
  host.prepend(overlay);
  mountDeck(overlay, slides, css);
  host.classList.add(ACTIVE_CLASS);
  hideNonOverlay(host);
}

/**
 * Force every non-overlay child of `host` to render as `display: none !important`
 * via inline style. Inline-important beats stylesheet rules from Obsidian themes
 * or community plugins, which is why CSS-based hiding alone is not enough.
 */
function hideNonOverlay(host: HTMLElement): void {
  for (const child of Array.from(host.children)) {
    const el = child as HTMLElement;
    if (el.classList.contains(OVERLAY_CLASS)) continue;
    if (!el.hasAttribute(STASH_ATTR)) {
      el.setAttribute(STASH_ATTR, el.style.getPropertyValue('display') || '');
    }
    el.style.setProperty('display', 'none', 'important');
  }
}

function unhideAll(host: HTMLElement): void {
  for (const child of Array.from(host.children)) {
    const el = child as HTMLElement;
    if (!el.hasAttribute(STASH_ATTR)) continue;
    const original = el.getAttribute(STASH_ATTR) || '';
    el.removeAttribute(STASH_ATTR);
    if (original) el.style.setProperty('display', original);
    else el.style.removeProperty('display');
  }
}

/**
 * Watch the host's children. Obsidian's reading mode aggressively recreates
 * blocks (scroll virtualization, frontmatter reflow, etc.) and would drop our
 * overlay; this observer re-mounts from the cached snapshot whenever that
 * happens, without waiting for another post-processor call.
 */
function ensureObserver(host: HTMLElement): void {
  if (observed.has(host)) return;
  observed.add(host);
  new MutationObserver((mutations) => {
    if (!host.classList.contains(ACTIVE_CLASS)) return;
    const snap = renderState.get(host);
    if (!snap) return;
    if (!host.querySelector(`:scope > .${OVERLAY_CLASS}`)) {
      mountOverlay(host, snap.slides, snap.css);
      return;
    }
    for (const m of mutations) {
      for (const n of Array.from(m.addedNodes)) {
        if (n instanceof HTMLElement && !n.classList.contains(OVERLAY_CLASS)) {
          hideNonOverlay(host);
          return;
        }
      }
    }
  }).observe(host, { childList: true });
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
  const tfile = file ?? app.vault.getAbstractFileByPath(ctx.sourcePath);
  if (tfile instanceof TFile) {
    return app.metadataCache.getFileCache(tfile)?.frontmatter ?? null;
  }
  return null;
}
