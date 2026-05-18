// @vitest-environment happy-dom
//
// L3 flagship — flicker contract test for SlideStage.syncSlides.
//
// The plugin's "no white flash" promise relies on syncSlides skipping any
// iframe whose (html, css) pair has not changed since last paint. If that
// skip is broken, every keystroke re-writes body.innerHTML on every slide
// in the deck — which is exactly the user-visible flicker we ship against.
// Spy-counting paintFrame calls is the contract test for that invariant.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoist-safe spy: the vi.mock factory runs before any import, so the spy
// referenced from inside it must be defined via vi.hoisted.
const { paintFrameSpy } = vi.hoisted(() => ({
  paintFrameSpy: vi.fn().mockReturnValue(true),
}));

vi.mock('../src/util/frame', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/util/frame')>();
  return { ...actual, paintFrame: paintFrameSpy };
});

// Import AFTER vi.mock so SlideStage's reference resolves to the spy.
const { SlideStage } = await import('../src/editor/stage');
type SlideContent = import('../src/editor/stage').SlideContent;

function makeView() {
  // SlideStage only touches view.scrollDOM during construction/syncSlides.
  // Repositioning is exercised separately and not needed for the paint
  // contract check.
  const scrollDOM = document.createElement('div');
  scrollDOM.style.position = 'relative';
  document.body.appendChild(scrollDOM);
  return {
    scrollDOM,
    contentDOM: document.createElement('div'),
    requestMeasure: () => {},
  } as unknown as import('@codemirror/view').EditorView;
}

const slide = (html: string, css = '/* base */'): SlideContent => ({ html, css });

describe('SlideStage.syncSlides — flicker prevention contract', () => {
  beforeEach(() => {
    paintFrameSpy.mockClear();
    document.body.innerHTML = '';
  });

  it('paints every slide on the first sync', () => {
    const stage = new SlideStage(makeView());
    stage.syncSlides([slide('<svg>a</svg>'), slide('<svg>b</svg>'), slide('<svg>c</svg>')]);
    expect(paintFrameSpy).toHaveBeenCalledTimes(3);
  });

  it('does NOT repaint when called again with identical content', () => {
    const stage = new SlideStage(makeView());
    const deck = [slide('<svg>a</svg>'), slide('<svg>b</svg>')];
    stage.syncSlides(deck);
    expect(paintFrameSpy).toHaveBeenCalledTimes(2);

    paintFrameSpy.mockClear();
    stage.syncSlides([...deck]); // new array, same content
    expect(paintFrameSpy).not.toHaveBeenCalled();
  });

  it('repaints only the slide whose html changed', () => {
    const stage = new SlideStage(makeView());
    stage.syncSlides([slide('<svg>a</svg>'), slide('<svg>b</svg>'), slide('<svg>c</svg>')]);
    paintFrameSpy.mockClear();

    stage.syncSlides([slide('<svg>a</svg>'), slide('<svg>b-edited</svg>'), slide('<svg>c</svg>')]);
    expect(paintFrameSpy).toHaveBeenCalledTimes(1);
    // The repaint must hit the changed slide's iframe, with the new html.
    const [, htmlArg] = paintFrameSpy.mock.calls[0];
    expect(htmlArg).toBe('<svg>b-edited</svg>');
  });

  it('repaints every slide when css changes (theme switch)', () => {
    const stage = new SlideStage(makeView());
    const before = [slide('<svg>a</svg>', '/* light */'), slide('<svg>b</svg>', '/* light */')];
    stage.syncSlides(before);
    paintFrameSpy.mockClear();

    const after = [slide('<svg>a</svg>', '/* dark */'), slide('<svg>b</svg>', '/* dark */')];
    stage.syncSlides(after);
    expect(paintFrameSpy).toHaveBeenCalledTimes(2);
  });

  it('grows the iframe pool when slides are added without repainting survivors', () => {
    const stage = new SlideStage(makeView());
    stage.syncSlides([slide('<svg>a</svg>')]);
    const containerBefore = document.querySelector('.marp-slide-stage')!;
    expect(containerBefore.querySelectorAll('iframe')).toHaveLength(1);
    paintFrameSpy.mockClear();

    stage.syncSlides([slide('<svg>a</svg>'), slide('<svg>b</svg>')]);
    expect(containerBefore.querySelectorAll('iframe')).toHaveLength(2);
    // Only the new slide is painted; the original iframe is reused untouched.
    expect(paintFrameSpy).toHaveBeenCalledTimes(1);
    expect(paintFrameSpy.mock.calls[0][1]).toBe('<svg>b</svg>');
  });

  it('shrinks the iframe pool when slides are removed', () => {
    const stage = new SlideStage(makeView());
    stage.syncSlides([slide('<svg>a</svg>'), slide('<svg>b</svg>'), slide('<svg>c</svg>')]);
    const container = document.querySelector('.marp-slide-stage')!;
    expect(container.querySelectorAll('iframe')).toHaveLength(3);

    paintFrameSpy.mockClear();
    stage.syncSlides([slide('<svg>a</svg>'), slide('<svg>b</svg>')]);
    expect(container.querySelectorAll('iframe')).toHaveLength(2);
    // No survivor is repainted just because a tail slide vanished.
    expect(paintFrameSpy).not.toHaveBeenCalled();
  });

  it('preserves iframe identity across edits (no remount = no white flash)', () => {
    const stage = new SlideStage(makeView());
    stage.syncSlides([slide('<svg>a</svg>'), slide('<svg>b</svg>')]);
    const container = document.querySelector('.marp-slide-stage')!;
    const [firstA, firstB] = container.querySelectorAll('iframe');

    stage.syncSlides([slide('<svg>a-edited</svg>'), slide('<svg>b</svg>')]);
    const [secondA, secondB] = container.querySelectorAll('iframe');
    expect(secondA).toBe(firstA);
    expect(secondB).toBe(firstB);
  });

  it('destroy() removes the stage container from the editor', () => {
    const view = makeView();
    const stage = new SlideStage(view);
    stage.syncSlides([slide('<svg>a</svg>')]);
    expect(view.scrollDOM.querySelector('.marp-slide-stage')).not.toBeNull();
    stage.destroy();
    expect(view.scrollDOM.querySelector('.marp-slide-stage')).toBeNull();
  });
});
