import { App, MarkdownPostProcessor, MarkdownPostProcessorContext, MarkdownView, TFile } from 'obsidian';
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

// Selector order matters: `.markdown-preview-view` is one element per leaf
// and is long-lived (survives Obsidian's lazy-rendering / section-recreation
// dance). `.markdown-preview-sizer` is recreated each render in modern
// Obsidian and would yield a fresh overlay each scroll if used as the host.
const SIZER_SELECTORS = ['.markdown-preview-view', '.markdown-reading-view', '.markdown-preview-sizer'];
const OVERLAY_CLASS = 'marp-deck-overlay';
const ACTIVE_CLASS = 'marp-active';
const STASH_ATTR = 'data-marp-stashed-display';
const DEBUG = false;

type MountSnapshot = { hash: string; html: string; css: string };

const renderState = new WeakMap<HTMLElement, MountSnapshot>();
const observed = new WeakSet<HTMLElement>();

export function buildReadingPostProcessor(deps: ReadingDeps): MarkdownPostProcessor {
  return async (el, ctx) => {
    if (DEBUG) {
      console.log('[marp-inline-preview] postProcessor invoked', {
        sourcePath: ctx.sourcePath,
        elClass: el.className,
      });
    }

    if (!deps.enabled()) return;

    let sizer = findSizer(el);
    if (!sizer) {
      sizer = await new Promise<HTMLElement | null>((resolve) =>
        setTimeout(() => resolve(findSizer(el)), 0),
      );
    }
    if (!sizer) sizer = findSizerByFile(deps.app, ctx.sourcePath);
    if (!sizer) {
      if (DEBUG) console.warn('[marp-inline-preview] no sizer for', ctx.sourcePath);
      return;
    }

    if (sizer.offsetParent === null) return;

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
      const wantHash = fnv1a32(`${md}${theme ?? ''}`);

      const prior = renderState.get(sizer);
      const overlayPresent = !!sizer.querySelector(`:scope > .${OVERLAY_CLASS}`);
      if (prior?.hash === wantHash && overlayPresent) {
        // Re-apply hide in case Obsidian appended new children since last call.
        hideNonOverlay(sizer);
        ensureObserver(sizer);
        return;
      }

      const { html, css } = deps.engine.render(md);
      mountOverlay(sizer, html, css);
      renderState.set(sizer, { hash: wantHash, html, css });
      ensureObserver(sizer);

      if (DEBUG) console.log('[marp-inline-preview] deck mounted');
    } catch (e) {
      console.error('[marp-inline-preview] reading-mode render failed', e);
      mountError(sizer, (e as Error).message);
    }
  };
}

/** Drop our overlay, restore original display values, remove active class. */
export function cleanup(sizer: HTMLElement): void {
  if (!sizer.classList.contains(ACTIVE_CLASS) && !renderState.has(sizer)) return;
  sizer.classList.remove(ACTIVE_CLASS);
  sizer.querySelectorAll(`:scope > .${OVERLAY_CLASS}`).forEach((n) => n.remove());
  unhideAll(sizer);
  renderState.delete(sizer);
}

/**
 * Attach (or re-attach) the deck overlay to the sizer. Removes any prior
 * overlay, mounts the deck HTML in a shadow root, asserts the active class,
 * and forces every non-overlay sibling to `display: none !important`.
 */
function mountOverlay(sizer: HTMLElement, html: string, css: string): void {
  sizer.querySelectorAll(`:scope > .${OVERLAY_CLASS}`).forEach((n) => n.remove());
  const overlay = document.createElement('div');
  overlay.className = `${OVERLAY_CLASS} marp-inline-preview-host marp-inline-preview-deck-host`;
  sizer.prepend(overlay);
  mountDeck(overlay, html, css);
  sizer.classList.add(ACTIVE_CLASS);
  hideNonOverlay(sizer);
}

function mountError(sizer: HTMLElement, message: string): void {
  sizer.querySelectorAll(`:scope > .${OVERLAY_CLASS}`).forEach((n) => n.remove());
  const err = document.createElement('pre');
  err.className = `${OVERLAY_CLASS} marp-inline-preview-error`;
  err.textContent = `Marp render error: ${message}`;
  sizer.prepend(err);
  sizer.classList.add(ACTIVE_CLASS);
  hideNonOverlay(sizer);
}

/**
 * Force every child of `sizer` (other than our deck overlay) to render as
 * `display: none !important`. Uses inline style with !important so it cannot
 * be defeated by stylesheet rules from Obsidian themes or community plugins.
 */
function hideNonOverlay(sizer: HTMLElement): void {
  for (const child of Array.from(sizer.children)) {
    const el = child as HTMLElement;
    if (el.classList.contains(OVERLAY_CLASS)) continue;
    if (!el.hasAttribute(STASH_ATTR)) {
      el.setAttribute(STASH_ATTR, el.style.getPropertyValue('display') || '');
    }
    el.style.setProperty('display', 'none', 'important');
  }
}

function unhideAll(sizer: HTMLElement): void {
  for (const child of Array.from(sizer.children)) {
    const el = child as HTMLElement;
    if (!el.hasAttribute(STASH_ATTR)) continue;
    const original = el.getAttribute(STASH_ATTR) || '';
    el.removeAttribute(STASH_ATTR);
    if (original) {
      el.style.setProperty('display', original);
    } else {
      el.style.removeProperty('display');
    }
  }
}

/**
 * Watch the sizer for child-list mutations. Obsidian's reading mode aggressively
 * re-creates section blocks (lazy rendering on scroll, frontmatter reflow, etc.),
 * which will drop our overlay on the floor. When that happens we re-mount from
 * the cached HTML/CSS rather than waiting for the next post-processor call,
 * which is not guaranteed to fire.
 */
function ensureObserver(sizer: HTMLElement): void {
  if (observed.has(sizer)) return;
  observed.add(sizer);
  const observer = new MutationObserver((mutations) => {
    if (!sizer.classList.contains(ACTIVE_CLASS)) return;
    const snapshot = renderState.get(sizer);
    if (!snapshot) return;
    if (!sizer.querySelector(`:scope > .${OVERLAY_CLASS}`)) {
      if (DEBUG) console.log('[marp-inline-preview] observer: overlay missing, re-mounting');
      mountOverlay(sizer, snapshot.html, snapshot.css);
      return;
    }
    // Overlay still there; only newly-added siblings need re-hiding.
    let needsHide = false;
    for (const m of mutations) {
      for (const node of Array.from(m.addedNodes)) {
        if (node instanceof HTMLElement && !node.classList.contains(OVERLAY_CLASS)) {
          needsHide = true;
          break;
        }
      }
      if (needsHide) break;
    }
    if (needsHide) hideNonOverlay(sizer);
  });
  observer.observe(sizer, { childList: true });
}

function findSizer(el: HTMLElement): HTMLElement | null {
  for (const sel of SIZER_SELECTORS) {
    const found = el.closest(sel) as HTMLElement | null;
    if (found) return found;
  }
  return null;
}

function findSizerByFile(app: App, sourcePath: string): HTMLElement | null {
  let found: HTMLElement | null = null;
  app.workspace.iterateAllLeaves((leaf) => {
    if (found) return;
    const v = leaf.view;
    if (v instanceof MarkdownView && v.file?.path === sourcePath) {
      const container = v.previewMode?.containerEl ?? v.containerEl;
      for (const sel of SIZER_SELECTORS) {
        const s = container.querySelector(sel) as HTMLElement | null;
        if (s) { found = s; return; }
      }
    }
  });
  return found;
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
