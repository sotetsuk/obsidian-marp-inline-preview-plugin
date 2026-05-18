// Per-editor, persistent iframe stage.
//
// CM6 viewport-culls block widgets that fall outside the live viewport
// (BlockGapWidget, see node_modules/@codemirror/view/dist/index.js:3246) and
// rebuilds them via toDOM() when they re-enter. If iframes lived inside the
// widget DOM, every cull/uncull pair would mean: allocate a new iframe,
// allocate a new about:blank document, re-parse the theme CSS, re-lay out the
// SVG. On a long deck that's a visible flicker every time the viewport
// boundary moves.
//
// We sidestep CM6's widget lifecycle entirely: one persistent iframe per
// slide lives inside a stage we append to view.scrollDOM (which is .cm-scroller
// and has position:relative — see CM6's default theme). The widget is now a
// minimal placeholder div whose only job is to reserve layout space at the
// right document offset. After every CM6 update we use view.requestMeasure to
// read placeholder positions in the measure phase and write iframe transforms
// in the same frame, so positions stay in sync across edits, scrolls, and
// viewport-culling events without ever re-creating an iframe.

import type { EditorView } from '@codemirror/view';
import { paintFrame, SLIDE_W, SLIDE_H } from '../util/frame';

const STAGE_CLASS = 'marp-slide-stage';
const PLACEHOLDER_CLASS = 'marp-slide-placeholder';

export type SlideContent = { html: string; css: string };

type IframePosition = { x: number; y: number; w: number };

export class SlideStage {
  private container: HTMLElement;
  private iframes: HTMLIFrameElement[] = [];
  private lastPainted: SlideContent[] = [];
  private repositionScheduled = false;

  constructor(private view: EditorView) {
    this.container = document.createElement('div');
    this.container.className = STAGE_CLASS;
    view.scrollDOM.appendChild(this.container);
  }

  destroy(): void {
    this.container.remove();
    this.iframes = [];
    this.lastPainted = [];
  }

  /**
   * Match the iframe pool to the new slide list and repaint any iframe whose
   * content actually differs from what it last held. paintFrame is idempotent
   * and cheap-on-no-change, but skipping the explicit string comparison saves
   * a body.innerHTML write per unchanged slide on every keystroke.
   */
  syncSlides(slides: SlideContent[]): void {
    while (this.iframes.length < slides.length) {
      const iframe = this.createIframe();
      this.container.appendChild(iframe);
      this.iframes.push(iframe);
    }
    while (this.iframes.length > slides.length) {
      this.iframes.pop()?.remove();
      this.lastPainted.pop();
    }
    for (let i = 0; i < slides.length; i++) {
      const prev = this.lastPainted[i];
      if (prev && prev.html === slides[i].html && prev.css === slides[i].css) continue;
      paintFrame(this.iframes[i], slides[i].html, slides[i].css);
      this.lastPainted[i] = slides[i];
    }
  }

  /** Schedule a measure-read / write pass to re-align iframes to placeholders. */
  scheduleReposition(): void {
    if (this.repositionScheduled) return;
    this.repositionScheduled = true;
    this.view.requestMeasure({
      key: 'marp-slide-stage',
      read: () => this.readPositions(),
      write: (positions) => {
        this.repositionScheduled = false;
        this.writePositions(positions);
      },
    });
  }

  private readPositions(): Map<number, IframePosition> {
    const out = new Map<number, IframePosition>();
    const stageRect = this.container.getBoundingClientRect();
    const nodes = this.view.contentDOM.querySelectorAll<HTMLElement>(
      `.${PLACEHOLDER_CLASS}`,
    );
    for (const ph of Array.from(nodes)) {
      const idxStr = ph.dataset.slideIndex;
      if (!idxStr) continue;
      const idx = Number(idxStr);
      if (!Number.isFinite(idx)) continue;
      const r = ph.getBoundingClientRect();
      if (r.width === 0) continue;
      out.set(idx, {
        x: r.left - stageRect.left,
        y: r.top - stageRect.top,
        w: r.width,
      });
    }
    return out;
  }

  private writePositions(positions: Map<number, IframePosition>): void {
    for (let i = 0; i < this.iframes.length; i++) {
      const iframe = this.iframes[i];
      const pos = positions.get(i);
      if (!pos) {
        // Placeholder is culled (or not mounted yet); park the iframe off-screen
        // rather than removing it, so its document survives.
        iframe.style.visibility = 'hidden';
        continue;
      }
      const scale = pos.w / SLIDE_W;
      iframe.style.transform = `translate(${pos.x}px, ${pos.y}px) scale(${scale})`;
      iframe.style.visibility = 'visible';
    }
  }

  private createIframe(): HTMLIFrameElement {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-same-origin');
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('tabindex', '-1');
    // Fixed 1280×720 intrinsic viewport, scaled to placeholder width via
    // transform — keeps vh/vw inside the slide resolving the same as a
    // standalone Marp document. transform-origin top-left so translate +
    // scale compose cleanly.
    iframe.style.cssText =
      'position:absolute;top:0;left:0;display:block;border:0;background:transparent;' +
      `color-scheme:light dark;width:${SLIDE_W}px;height:${SLIDE_H}px;` +
      'transform-origin:top left;visibility:hidden;pointer-events:auto;';
    return iframe;
  }
}

export const PLACEHOLDER_CLASS_NAME = PLACEHOLDER_CLASS;
