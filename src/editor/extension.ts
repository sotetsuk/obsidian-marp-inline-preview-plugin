import { App, MarkdownView, TFile } from 'obsidian';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view';
import { Extension, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import type { MarpEngine } from '../marp/engine';
import type { ThemeResolver } from '../marp/themes';
import { findSlideBreaks } from '../marp/slides';
import { injectThemeIfMissing } from '../marp/frontmatter';
import { SlidePlaceholder } from './widget';
import { SlideStage, type SlideContent } from './stage';
import { debounce } from '../util/debounce';
import { rewriteImageSrcs } from '../util/images';
import type { SlideSyncBus, SyncSource } from '../sync/bus';
import { pickActiveSlide } from '../sync/active';
import { slideRectsRelativeTo } from '../sync/rect';

export type EditorDeps = {
  app: App;
  engine: MarpEngine;
  themes: ThemeResolver;
  enabled: () => boolean;
  debounceMs: () => number;
  sync: SlideSyncBus;
  syncEnabled: () => boolean;
};

const PLACEHOLDER_SELECTOR = '.marp-slide-placeholder';
// Fallback window after a programmatic scroll: if we never observe the index we
// scrolled to within this long, release the guard and resume reporting.
const GUARD_MS = 300;

/**
 * Effect used by the rebuild ViewPlugin to push a fresh DecorationSet into
 * the StateField below. Using an explicit effect (rather than mutating a
 * ViewPlugin field) is what makes CM6 reliably re-render the widgets — empty
 * dispatches do not invalidate decoration facets.
 */
const setSlides = StateEffect.define<DecorationSet>();

/**
 * External nudge effect: dispatch `refreshSlides.of(null)` to an editor to
 * force the worker to recompute decorations (e.g. after settings change or
 * after a theme CSS file was modified).
 */
export const refreshSlides = StateEffect.define<null>();

const slidesField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    // Shift existing widget positions when the user edits, so they don't
    // visually jump until the rebuild ViewPlugin recomputes them.
    value = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setSlides)) value = effect.value;
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Build the editor extension bundle: a StateField that holds slide
 * decorations plus a worker ViewPlugin that rebuilds them on doc changes.
 */
export function buildEditorExtension(deps: EditorDeps): Extension {
  const worker = ViewPlugin.fromClass(
    class {
      private destroyed = false;
      private latestRunId = 0;
      private schedule: () => void;
      private stage: SlideStage;

      // --- slide-position sync state ---
      private readonly mySource: SyncSource = deps.sync.createSource();
      /** Currently subscribed file path (null when not syncing). */
      private subPath: string | null = null;
      private unsub: (() => void) | null = null;
      /** slide index -> document offset of its preview placeholder. */
      private indexToOffset = new Map<number, number>();
      private didInitialRestore = false;
      /** Index we last scrolled to programmatically; suppress self-reports until seen. */
      private expectedIndex: number | null = null;
      private guardUntil = 0;
      private detectRaf: number | null = null;
      private readonly onScroll = () => this.scheduleDetect();

      constructor(public view: EditorView) {
        this.stage = new SlideStage(view);
        this.schedule = debounce(() => {
          if (this.destroyed) return;
          void this.rebuild();
        }, Math.max(50, deps.debounceMs()));
        // Raw scroll events catch in-viewport scrolls that don't trigger a CM6
        // ViewUpdate; rAF-coalesced so we measure at most once per frame.
        this.view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
        // Initial render: defer one tick so the leaf has time to attach the
        // file to the editor, then rebuild immediately (no debounce delay).
        setTimeout(() => {
          if (!this.destroyed) void this.rebuild();
        }, 0);
      }

      update(u: ViewUpdate): void {
        // Any layout-affecting update needs an iframe reposition pass, even
        // if nothing about the slide content changed (scroll, pane resize,
        // viewport cull/uncull, etc.).
        if (u.docChanged || u.viewportChanged || u.geometryChanged) {
          this.stage.scheduleReposition();
          this.scheduleDetect();
        }
        if (u.docChanged) {
          this.schedule();
          return;
        }
        // External refresh request from main.ts (theme file change, settings,
        // metadataCache update, etc.) — bypass the debounce.
        for (const tr of u.transactions) {
          for (const e of tr.effects) {
            if (e.is(refreshSlides)) {
              void this.rebuild();
              return;
            }
          }
        }
      }

      destroy(): void {
        this.destroyed = true;
        this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
        if (this.detectRaf !== null) cancelAnimationFrame(this.detectRaf);
        if (this.unsub) this.unsub();
        this.unsub = null;
        this.stage.destroy();
      }

      /** Point the subscription at `path` (or detach when null). */
      private setSyncPath(path: string | null): void {
        if (path === this.subPath) return;
        if (this.unsub) this.unsub();
        this.unsub = null;
        this.subPath = path;
        this.indexToOffset.clear();
        this.didInitialRestore = false;
        this.expectedIndex = null;
        if (path) {
          this.unsub = deps.sync.subscribe(path, this.mySource, (idx) => this.scrollToSlide(idx));
        }
      }

      private scheduleDetect(): void {
        if (this.detectRaf !== null) return;
        this.detectRaf = requestAnimationFrame(() => {
          this.detectRaf = null;
          this.detectActiveSlide();
        });
      }

      /** Measure the topmost visible slide and report it to the bus. */
      private detectActiveSlide(): void {
        if (this.destroyed || !deps.syncEnabled() || !deps.enabled()) return;
        const path = this.subPath;
        if (!path) return;
        const nodes = this.view.contentDOM.querySelectorAll<HTMLElement>(PLACEHOLDER_SELECTOR);
        const rects = slideRectsRelativeTo(Array.from(nodes), this.view.scrollDOM);
        const idx = pickActiveSlide(rects, this.view.scrollDOM.clientHeight);
        if (idx === null) return;
        // Programmatic-scroll guard: suppress our own reports until we land on
        // the index we scrolled to (or the fallback window lapses).
        if (this.expectedIndex !== null) {
          if (idx === this.expectedIndex) {
            this.expectedIndex = null;
            return; // bus already holds this index — nothing to report
          }
          if (performance.now() < this.guardUntil) return;
          this.expectedIndex = null; // gave up waiting; treat as a real scroll
        }
        deps.sync.report(path, idx, this.mySource);
      }

      /**
       * Once per deck mount, align to whatever slide the bus last recorded for
       * this file — this is what carries the position across a reading→edit mode
       * switch. Deferred a frame so placeholder positions are laid out first.
       */
      private restoreInitial(): void {
        if (this.didInitialRestore) return;
        this.didInitialRestore = true;
        if (!deps.syncEnabled()) return;
        const path = this.subPath;
        if (!path) return;
        const target = deps.sync.current(path);
        if (target === null) return;
        requestAnimationFrame(() => {
          // The leaf may have been reused for another file before this frame ran.
          if (this.destroyed || this.subPath !== path) return;
          this.scrollToSlide(target);
        });
      }

      /** Scroll so slide `index`'s preview is at the top of the viewport. */
      private scrollToSlide(index: number): void {
        if (this.destroyed || !deps.syncEnabled()) return;
        if (this.indexToOffset.size === 0) return;
        let maxIndex = -1;
        for (const k of this.indexToOffset.keys()) if (k > maxIndex) maxIndex = k;
        if (maxIndex < 0) return;
        const clamped = Math.max(0, Math.min(index, maxIndex));
        const offset = this.indexToOffset.get(clamped);
        // Keys are normally contiguous; if a gap is hit, skip rather than scroll
        // to the wrong slide.
        if (offset === undefined) return;
        this.expectedIndex = clamped;
        this.guardUntil = performance.now() + GUARD_MS;
        this.view.dispatch({ effects: EditorView.scrollIntoView(offset, { y: 'start' }) });
      }

      async rebuild(): Promise<void> {
        if (!deps.enabled()) {
          this.setSyncPath(null);
          this.stage.syncSlides([]);
          this.push(Decoration.none);
          return;
        }

        const runId = ++this.latestRunId;
        const file = resolveFile(deps.app, this.view);
        if (!file) {
          this.setSyncPath(null);
          this.stage.syncSlides([]);
          this.push(Decoration.none);
          return;
        }

        const cache = deps.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter ?? {};
        if (fm.marp !== true && fm.marp !== 'true') {
          this.setSyncPath(null);
          this.stage.syncSlides([]);
          this.push(Decoration.none);
          return;
        }

        // Eligible deck — point the sync subscription at this file (no-op if
        // unchanged; re-subscribes if the leaf was reused for another file).
        this.setSyncPath(file.path);

        try {
          const rawSrc = this.view.state.doc.toString();
          const fmTheme = typeof fm.theme === 'string' && fm.theme.length > 0 ? fm.theme : null;
          // collect() registers themeSet entries with the engine as a side
          // effect and returns the theme name that should be applied.
          const theme = await deps.themes.collect(file, fmTheme);
          if (runId !== this.latestRunId || this.destroyed) return;
          const mdForMarp = fmTheme ? rawSrc : injectThemeIfMissing(rawSrc, theme);

          const rendered = deps.engine.renderArray(mdForMarp);
          const fullCss = rendered.css;
          const slides: SlideContent[] = rendered.html.map((h) => ({
            html: rewriteImageSrcs(h, file.path, deps.app),
            css: fullCss,
          }));
          const breaks = findSlideBreaks(rawSrc);

          // Update iframe contents first so the iframes have the new HTML by
          // the time CM6 finishes mounting placeholders and we read their
          // positions in the measure phase.
          this.stage.syncSlides(slides);

          const builder = new RangeSetBuilder<Decoration>();
          // Marp renders one section per slide; for a deck with N break lines
          // we get N+1 sections. Drop a placeholder after each break, then
          // append the last section at the end of the document. Record each
          // slide's placeholder offset in the same pass so scrollToSlide() can
          // map an index back to the exact document position we mounted it at.
          this.indexToOffset.clear();
          const widgetCount = Math.min(breaks.length, slides.length);
          for (let i = 0; i < widgetCount; i++) {
            this.indexToOffset.set(i, breaks[i].to);
            builder.add(
              breaks[i].to,
              breaks[i].to,
              Decoration.widget({
                widget: new SlidePlaceholder(i),
                block: true,
                side: 1,
              }),
            );
          }
          if (slides.length > breaks.length) {
            const lastIdx = slides.length - 1;
            const docLength = this.view.state.doc.length;
            this.indexToOffset.set(lastIdx, docLength);
            builder.add(
              docLength,
              docLength,
              Decoration.widget({
                widget: new SlidePlaceholder(lastIdx),
                block: true,
                side: 1,
              }),
            );
          }

          this.push(builder.finish());
          this.stage.scheduleReposition();
          this.restoreInitial();
        } catch (e) {
          console.error('[marp-inline-preview] edit-mode render failed', e);
          this.stage.syncSlides([]);
          this.push(Decoration.none);
        }
      }

      private push(decorations: DecorationSet): void {
        if (this.destroyed) return;
        this.view.dispatch({ effects: setSlides.of(decorations) });
      }
    },
  );

  return [slidesField, worker];
}

function resolveFile(app: App, view: EditorView): TFile | null {
  let found: TFile | null = null;
  app.workspace.iterateAllLeaves((leaf) => {
    if (found) return;
    const v = leaf.view;
    if (v instanceof MarkdownView) {
      // @ts-expect-error — `editor.cm` is not part of the public API but is the
      // standard escape hatch used by editor-extension plugins.
      const cm = v.editor?.cm as EditorView | undefined;
      if (cm === view && v.file) found = v.file;
    }
  });
  return found ?? app.workspace.getActiveFile();
}

