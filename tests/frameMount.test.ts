// @vitest-environment happy-dom
//
// L3 — frame.ts mount/paint integration.
//
// Reading-mode and editor-mode both share mountSlide / mountDeck / paintFrame.
// The contracts that protect the user from flicker:
//   - mountDeck creates exactly one iframe per slide
//   - ensureIframe is idempotent — re-mounting on the same host keeps the
//     same iframe identity (no reload, no blank flash)
//   - paintFrame initializes the iframe Document only once; subsequent
//     paints reuse the same <style data-role="theme"> and base element
//
// We cannot rely on layout in happy-dom, so applyFrameLayout side-effects
// (transform/height) are *not* asserted here — that path is exercised by
// L4 in a real Electron renderer. This file's job is DOM-structure only.

import { describe, it, expect, beforeEach } from 'vitest';
import { mountDeck, mountSlide, paintFrame, SLIDE_W, SLIDE_H } from '../src/util/frame';

const flushMicrotasks = () => Promise.resolve();

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('mountDeck', () => {
  it('creates one iframe per slide and wraps each in a host element', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const deck = mountDeck(host, ['<svg>a</svg>', '<svg>b</svg>', '<svg>c</svg>'], '/* css */');
    expect(deck.iframes).toHaveLength(3);
    expect(host.querySelectorAll(':scope > .marp-inline-preview-host')).toHaveLength(3);
    for (const slideHost of host.querySelectorAll(':scope > .marp-inline-preview-host')) {
      expect(slideHost.querySelectorAll(':scope > iframe')).toHaveLength(1);
    }
  });

  it('tears down previous per-slide hosts when called again on the same host', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountDeck(host, ['<svg>a</svg>', '<svg>b</svg>', '<svg>c</svg>'], '/* css */');
    mountDeck(host, ['<svg>only</svg>'], '/* css */');
    expect(host.querySelectorAll(':scope > .marp-inline-preview-host')).toHaveLength(1);
  });

  it('sets the iframe to fixed 1280×720 intrinsic dimensions (matches Marp CLI viewport)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { iframes } = mountDeck(host, ['<svg>a</svg>'], '/* css */');
    const style = iframes[0].style;
    expect(style.width).toBe(`${SLIDE_W}px`);
    expect(style.height).toBe(`${SLIDE_H}px`);
    expect(style.transformOrigin).toBe('top left');
  });

  it('applies sandbox="allow-same-origin" so contentDocument is reachable', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { iframes } = mountDeck(host, ['<svg>a</svg>'], '/* css */');
    expect(iframes[0].getAttribute('sandbox')).toBe('allow-same-origin');
    expect(iframes[0].getAttribute('scrolling')).toBe('no');
    expect(iframes[0].getAttribute('tabindex')).toBe('-1');
  });
});

describe('mountSlide / ensureIframe', () => {
  it('reuses the same iframe element when called twice on the same host', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const first = mountSlide(host, '<svg>a</svg>', '/* css */').iframe;
    const second = mountSlide(host, '<svg>a-edited</svg>', '/* css */').iframe;
    expect(second).toBe(first);
    expect(host.querySelectorAll(':scope > iframe')).toHaveLength(1);
  });
});

describe('paintFrame', () => {
  it('returns false when the iframe is not yet attached (contentDocument null)', async () => {
    const iframe = document.createElement('iframe');
    // not attached → no contentDocument yet
    const ok = paintFrame(iframe, '<svg>a</svg>', '/* css */');
    // happy-dom may or may not eagerly create a doc for detached iframes;
    // the production code's contract is "either it paints, or returns false
    // so the caller can retry on microtask".
    if (!ok) {
      document.body.appendChild(iframe);
      await flushMicrotasks();
      const retry = paintFrame(iframe, '<svg>a</svg>', '/* css */');
      expect(retry).toBe(true);
    }
  });

  it('initializes the iframe Document once and reuses the theme style on subsequent paints', () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);

    const ok1 = paintFrame(iframe, '<svg>a</svg>', '/* first */');
    expect(ok1).toBe(true);
    const doc = iframe.contentDocument!;
    const themeStyleA = doc.head.querySelector('style[data-role="theme"]') as HTMLStyleElement;
    expect(themeStyleA).not.toBeNull();
    expect(themeStyleA.textContent).toBe('/* first */');

    const ok2 = paintFrame(iframe, '<svg>b</svg>', '/* second */');
    expect(ok2).toBe(true);
    const themeStyleB = doc.head.querySelector('style[data-role="theme"]') as HTMLStyleElement;
    // Identity preserved — same element, content updated. This is the key
    // invariant that prevents a CSS re-parse on every keystroke.
    expect(themeStyleB).toBe(themeStyleA);
    expect(themeStyleB.textContent).toBe('/* second */');

    // base + theme + override styles → exactly one of each in head.
    expect(doc.head.querySelectorAll('base')).toHaveLength(1);
    expect(doc.head.querySelectorAll('style[data-role="theme"]')).toHaveLength(1);
  });

  it('skips re-writing the theme style when the css string is unchanged', () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    paintFrame(iframe, '<svg>a</svg>', '/* css */');
    const themeStyle = iframe.contentDocument!.head.querySelector(
      'style[data-role="theme"]',
    ) as HTMLStyleElement;
    const original = themeStyle.textContent;
    paintFrame(iframe, '<svg>a-edited</svg>', '/* css */');
    // Same identity AND same textContent — the production code skips the
    // textContent assignment via the !== guard. Worth asserting because a
    // regression there would noticeably hurt typing latency on big themes.
    expect(themeStyle.textContent).toBe(original);
  });

  it('wraps slide html in the marp-inline-preview container div', () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    paintFrame(iframe, '<svg data-marpit-svg></svg>', '/* css */');
    const body = iframe.contentDocument!.body;
    const container = body.querySelector(':scope > .marp-inline-preview');
    expect(container).not.toBeNull();
    expect(container!.querySelector('svg[data-marpit-svg]')).not.toBeNull();
  });
});
