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
import { SlideWidget } from './widget';
import { debounce } from '../util/debounce';

export type EditorDeps = {
  app: App;
  engine: MarpEngine;
  themes: ThemeResolver;
  enabled: () => boolean;
  debounceMs: () => number;
};

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

      constructor(public view: EditorView) {
        this.schedule = debounce(() => {
          if (this.destroyed) return;
          void this.rebuild();
        }, Math.max(50, deps.debounceMs()));
        // Initial render: defer one tick so the leaf has time to attach the
        // file to the editor, then rebuild immediately (no debounce delay).
        setTimeout(() => {
          if (!this.destroyed) void this.rebuild();
        }, 0);
      }

      update(u: ViewUpdate): void {
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
      }

      async rebuild(): Promise<void> {
        if (!deps.enabled()) {
          this.push(Decoration.none);
          return;
        }

        const runId = ++this.latestRunId;
        const file = resolveFile(deps.app, this.view);
        if (!file) {
          this.push(Decoration.none);
          return;
        }

        const cache = deps.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter ?? {};
        if (fm.marp !== true && fm.marp !== 'true') {
          this.push(Decoration.none);
          return;
        }

        try {
          const rawSrc = this.view.state.doc.toString();
          const fmTheme = typeof fm.theme === 'string' && fm.theme.length > 0 ? fm.theme : null;
          // collect() registers themeSet entries with the engine as a side
          // effect and returns the theme name that should be applied.
          const theme = await deps.themes.collect(file, fmTheme);
          if (runId !== this.latestRunId || this.destroyed) return;
          const mdForMarp = fmTheme ? rawSrc : injectThemeIfMissing(rawSrc, theme);

          const { html, css } = deps.engine.renderArray(mdForMarp);
          const breaks = findSlideBreaks(rawSrc);
          const fullCss = css;

          const builder = new RangeSetBuilder<Decoration>();
          // Marp renders one section per slide; for a deck with N break lines
          // we get N+1 sections. Drop a widget after each break, then append
          // the last section at the end of the document.
          const widgetCount = Math.min(breaks.length, html.length);
          for (let i = 0; i < widgetCount; i++) {
            builder.add(
              breaks[i].to,
              breaks[i].to,
              Decoration.widget({
                widget: new SlideWidget(html[i], fullCss),
                block: true,
                side: 1,
              }),
            );
          }
          if (html.length > breaks.length) {
            const lastIdx = html.length - 1;
            const docLength = this.view.state.doc.length;
            builder.add(
              docLength,
              docLength,
              Decoration.widget({
                widget: new SlideWidget(html[lastIdx], fullCss),
                block: true,
                side: 1,
              }),
            );
          }

          this.push(builder.finish());
        } catch (e) {
          console.error('[marp-inline-preview] edit-mode render failed', e);
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

