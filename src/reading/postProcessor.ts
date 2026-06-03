import {
  App,
  MarkdownPostProcessor,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  TFile,
} from 'obsidian';
import type { MarpEngine } from '../marp/engine';
import type { ThemeResolver } from '../marp/themes';
import { injectThemeIfMissing } from '../marp/frontmatter';
import { mountDeck } from '../util/frame';
import { rewriteImageSrcs } from '../util/images';
import { fnv1a32 } from '../util/hash';
import type { SlideSyncBus, SyncSource } from '../sync/bus';
import { pickActiveSlide } from '../sync/active';
import { slideRectsRelativeTo } from '../sync/rect';

export type ReadingDeps = {
  app: App;
  engine: MarpEngine;
  themes: ThemeResolver;
  enabled: () => boolean;
  sync: SlideSyncBus;
  syncEnabled: () => boolean;
};

const HOST_SELECTOR = '.markdown-preview-view';
const OVERLAY_CLASS = 'marp-deck-overlay';
const SLIDE_HOST_CLASS = 'marp-inline-preview-host';
const ACTIVE_CLASS = 'marp-active';
const STASH_ATTR = 'data-marp-stashed-display';
// Fallback window after a programmatic scroll before we resume self-reporting.
const GUARD_MS = 300;

type Snapshot = { hash: string; slides: string[]; css: string };
const renderState = new WeakMap<HTMLElement, Snapshot>();

/**
 * Per-host sync + observation state. Replaces the old `observed` WeakSet: it now
 * owns the MutationObserver too, so everything is torn down together on cleanup.
 */
type HostRecord = {
  source: SyncSource;
  sourcePath: string;
  scrollEl: HTMLElement;
  scrollHandler: () => void;
  unsub: () => void;
  mutationObserver: MutationObserver;
  rafId: number | null;
  /** rAF used by applyReadingScroll() to wait for layout; cancelled on teardown. */
  layoutRafId: number | null;
  expectedIndex: number | null;
  guardUntil: number;
};
const hostState = new WeakMap<HTMLElement, HostRecord>();

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
        // appended new siblings since the last call. Still (re-)wire sync and
        // restore: this branch is the common one when a leaf is re-shown after
        // a mode switch, where nothing re-rendered but we may need to re-align.
        hideNonOverlay(host);
        ensureReadingSync(host, ctx, deps);
        restoreReadingPosition(host, deps);
        return;
      }

      const rendered = deps.engine.renderArray(md);
      const slides = rendered.html.map((h) => rewriteImageSrcs(h, ctx.sourcePath, deps.app));
      const css = rendered.css;
      mountOverlay(host, slides, css);
      renderState.set(host, { hash: wantHash, slides, css });
      ensureReadingSync(host, ctx, deps);
      restoreReadingPosition(host, deps);
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
  const hadSync = hostState.has(host);
  if (!host.classList.contains(ACTIVE_CLASS) && !renderState.has(host) && !hadSync) return;
  host.classList.remove(ACTIVE_CLASS);
  host.querySelectorAll(`:scope > .${OVERLAY_CLASS}`).forEach((n) => n.remove());
  unhideAll(host);
  renderState.delete(host);
  teardownSync(host);
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
 * Wire up, once per host, everything that depends on the live overlay:
 *   - a MutationObserver that re-mounts our overlay from the cached snapshot
 *     whenever Obsidian's reading-mode virtualization drops it (and re-aligns
 *     the scroll position afterwards);
 *   - a scroll listener that reports the topmost visible slide to the bus;
 *   - a bus subscription that scrolls this view when another view moves.
 * All three handles live on the HostRecord so cleanup() tears them down together.
 * Idempotent: a second call for the same path is a no-op.
 */
function ensureReadingSync(
  host: HTMLElement,
  ctx: MarkdownPostProcessorContext,
  deps: ReadingDeps,
): void {
  const sourcePath = ctx.sourcePath;
  const existing = hostState.get(host);
  if (existing && existing.sourcePath === sourcePath) return;
  if (existing) teardownSync(host); // path changed — rebuild from scratch

  const source = deps.sync.createSource();
  const scrollEl = resolveScrollContainer(host);

  const mutationObserver = new MutationObserver((mutations) => {
    if (!host.classList.contains(ACTIVE_CLASS)) return;
    const snap = renderState.get(host);
    if (!snap) return;
    if (!host.querySelector(`:scope > .${OVERLAY_CLASS}`)) {
      mountOverlay(host, snap.slides, snap.css);
      restoreReadingPosition(host, deps); // slide hosts recreated — re-align
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
  });
  mutationObserver.observe(host, { childList: true });

  const record: HostRecord = {
    source,
    sourcePath,
    scrollEl,
    scrollHandler: () => undefined,
    unsub: () => undefined,
    mutationObserver,
    rafId: null,
    layoutRafId: null,
    expectedIndex: null,
    guardUntil: 0,
  };
  record.scrollHandler = () => scheduleReadingDetect(host, record, deps);
  scrollEl.addEventListener('scroll', record.scrollHandler, { passive: true });
  record.unsub = deps.sync.subscribe(sourcePath, source, (idx) =>
    scrollReadingToSlide(host, record, idx, deps),
  );
  hostState.set(host, record);

  // Tie teardown to Obsidian's render lifecycle: when the preview is destroyed
  // (leaf closed) the child unloads and, if the host is truly gone, we drop the
  // scroll listener + subscription. This matters when the scroll container
  // resolves to an ancestor that outlives the host (otherwise the listener
  // leaks). Re-renders keep host.isConnected, so they don't tear sync down.
  if (typeof ctx.addChild === 'function') {
    const child = new MarkdownRenderChild(host);
    child.onunload = () => {
      if (!host.isConnected && hostState.get(host) === record) teardownSync(host);
    };
    ctx.addChild(child);
  }
}

function teardownSync(host: HTMLElement): void {
  const rec = hostState.get(host);
  if (!rec) return;
  rec.scrollEl.removeEventListener('scroll', rec.scrollHandler);
  if (rec.rafId !== null) cancelAnimationFrame(rec.rafId);
  if (rec.layoutRafId !== null) cancelAnimationFrame(rec.layoutRafId);
  rec.unsub();
  rec.mutationObserver.disconnect();
  hostState.delete(host);
}

function scheduleReadingDetect(host: HTMLElement, rec: HostRecord, deps: ReadingDeps): void {
  if (rec.rafId !== null) return;
  rec.rafId = requestAnimationFrame(() => {
    rec.rafId = null;
    readingDetect(host, rec, deps);
  });
}

function slideHosts(host: HTMLElement): HTMLElement[] {
  const overlay = host.querySelector(`:scope > .${OVERLAY_CLASS}`);
  if (!overlay) return [];
  return Array.from(overlay.querySelectorAll<HTMLElement>(`:scope > .${SLIDE_HOST_CLASS}`));
}

/** Measure the topmost visible slide and report it to the bus. */
function readingDetect(host: HTMLElement, rec: HostRecord, deps: ReadingDeps): void {
  if (!deps.syncEnabled() || !deps.enabled()) return;
  const nodes = slideHosts(host);
  if (nodes.length === 0) return;
  const rects = slideRectsRelativeTo(nodes, rec.scrollEl);
  const idx = pickActiveSlide(rects, rec.scrollEl.clientHeight);
  if (idx === null) return;
  if (rec.expectedIndex !== null) {
    if (idx === rec.expectedIndex) {
      rec.expectedIndex = null;
      return;
    }
    if (performance.now() < rec.guardUntil) return;
    rec.expectedIndex = null;
  }
  deps.sync.report(rec.sourcePath, idx, rec.source);
}

/** Scroll so slide `index` sits at the top of the scroll container. */
function scrollReadingToSlide(
  host: HTMLElement,
  rec: HostRecord,
  index: number,
  deps: ReadingDeps,
): void {
  if (!deps.syncEnabled()) return;
  const nodes = slideHosts(host);
  if (nodes.length === 0) return;
  const clamped = Math.max(0, Math.min(index, nodes.length - 1));
  applyReadingScroll(host, rec, nodes[clamped], clamped, 0);
}

/**
 * Apply the scroll once the target slide host has real height. Iframe heights
 * are sized lazily by a ResizeObserver (see util/frame.ts), so right after mount
 * every host can still be 0px tall; scrolling then would land on the wrong slide.
 * We poll a few frames for non-zero height before committing. Each retry is
 * tracked on the record so teardown can cancel it, and we bail if the record was
 * replaced or the node detached in the meantime.
 */
function applyReadingScroll(
  host: HTMLElement,
  rec: HostRecord,
  node: HTMLElement,
  index: number,
  attempt: number,
): void {
  if (hostState.get(host) !== rec || !node.isConnected) {
    rec.layoutRafId = null;
    return;
  }
  if (node.getBoundingClientRect().height === 0 && attempt < 10) {
    rec.layoutRafId = requestAnimationFrame(() =>
      applyReadingScroll(host, rec, node, index, attempt + 1),
    );
    return;
  }
  rec.layoutRafId = null;
  const rootTop = rec.scrollEl.getBoundingClientRect().top;
  const nodeTop = node.getBoundingClientRect().top;
  rec.expectedIndex = index;
  rec.guardUntil = performance.now() + GUARD_MS;
  // Delta-based: offsetTop is relative to the offset parent, not the scroller.
  rec.scrollEl.scrollTop += nodeTop - rootTop;
}

function restoreReadingPosition(host: HTMLElement, deps: ReadingDeps): void {
  if (!deps.syncEnabled()) return;
  const rec = hostState.get(host);
  if (!rec) return;
  const target = deps.sync.current(rec.sourcePath);
  if (target === null) return;
  scrollReadingToSlide(host, rec, target, deps);
}

/**
 * Resolve the scrollable element for a reading host. `.markdown-preview-view` is
 * normally the scroller, but depending on Obsidian version/theme it can be an
 * ancestor. Detect by overflow style (not scrollHeight, which is unreliable
 * before layout); fall back to the document scroller.
 */
function resolveScrollContainer(host: HTMLElement): HTMLElement {
  let el: HTMLElement | null = host;
  while (el) {
    if (isScrollableStyle(el)) return el;
    el = el.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? host;
}

function isScrollableStyle(el: HTMLElement): boolean {
  const oy = getComputedStyle(el).overflowY;
  return oy === 'auto' || oy === 'scroll' || oy === 'overlay';
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
