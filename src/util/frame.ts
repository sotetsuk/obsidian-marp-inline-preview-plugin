// Mount Marp-rendered HTML inside a sandboxed <iframe srcdoc>.
//
// Why an iframe and not a Shadow DOM? Marp CLI and the VSCode Marp extension
// both render slides inside a standalone document (browser tab / webview).
// Shadow DOM does not fully isolate inheritance — CSS custom properties and
// computed values still flow in from the host document, which means Obsidian
// theme variables can collide with user theme variables (e.g. --text-muted,
// --background) and inherited values can shift computed margins in ways that
// the CSS-string analysis does not predict. An iframe is a separate document
// with its own <html>, so the rendering environment matches CLI/VSCode exactly.

export type MountedFrame = {
  host: HTMLElement;
  iframe: HTMLIFrameElement;
};

const CONTAINER_CLASS = 'marp-inline-preview';

/**
 * Override appended after Marp's own CSS inside the iframe document.
 *
 * Marp's default CSS sizes each inline SVG to `height: 100vh; width: 100vw`,
 * which assumes a single-slide-per-viewport presentation. In an Obsidian
 * preview / editor widget we want each slide to fit the available column
 * width and keep its 16:9 aspect ratio, with multiple slides stacked
 * vertically.
 */
const OVERRIDE_CSS = `
html, body { margin: 0; padding: 0; background: transparent; }
svg[data-marpit-svg] {
  display: block !important;
  width: 100% !important;
  height: auto !important;
  margin: 0 0 0.75em 0 !important;
}
svg[data-marpit-svg]:last-child { margin-bottom: 0 !important; }
`;

function buildSrcdoc(bodyHtml: string, css: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<base target="_blank">' +
    `<style>${css}</style>` +
    `<style>${OVERRIDE_CSS}</style>` +
    '</head><body>' +
    bodyHtml +
    '</body></html>'
  );
}

const sizedIframes = new WeakSet<HTMLIFrameElement>();

function ensureIframe(host: HTMLElement): HTMLIFrameElement {
  let iframe = host.querySelector(':scope > iframe') as HTMLIFrameElement | null;
  if (iframe) return iframe;
  iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.setAttribute('scrolling', 'no');
  iframe.setAttribute('loading', 'eager');
  iframe.setAttribute('tabindex', '-1');
  // color-scheme lets light-dark() inside the slide CSS react to Obsidian's
  // active theme via prefers-color-scheme on the host document.
  iframe.style.cssText =
    'display:block;width:100%;border:0;background:transparent;color-scheme:light dark';
  host.appendChild(iframe);
  return iframe;
}

/**
 * Mount a single slide (edit mode). The HTML from Marp's `htmlAsArray: true`
 * output is just the bare `<svg>` for that slide, so we wrap it in the
 * container `<div>` that Marp's selectors expect.
 *
 * We size the iframe to a pixel height derived from its current width rather
 * than relying on `aspect-ratio: 16/9` — when CodeMirror inserts the widget
 * the surrounding box hasn't laid out yet, so `aspect-ratio` can compute to
 * a 0-height box and the slide content disappears below the visible band.
 */
export function mountSlide(
  host: HTMLElement,
  slideHtml: string,
  css: string,
): MountedFrame {
  const iframe = ensureIframe(host);
  iframe.style.aspectRatio = '';
  iframe.dataset.slideCount = '1';
  iframe.srcdoc = buildSrcdoc(
    `<div class="${CONTAINER_CLASS}">${slideHtml}</div>`,
    css,
  );
  applyDeckHeight(iframe);
  ensureSizeObserver(iframe);
  return { host, iframe };
}

/**
 * Mount a full deck (reading mode). The HTML from Marp's normal `render()`
 * already includes the wrapper div, so we hand it through unchanged.
 *
 * `slideCount` is required so we can size the iframe to fit all slides
 * stacked at 16:9 each, without relying on JS inside the iframe.
 */
export function mountDeck(
  host: HTMLElement,
  deckHtml: string,
  css: string,
  slideCount: number,
): MountedFrame {
  const iframe = ensureIframe(host);
  iframe.style.aspectRatio = '';
  iframe.dataset.slideCount = String(Math.max(1, slideCount));
  iframe.srcdoc = buildSrcdoc(deckHtml, css);
  applyDeckHeight(iframe);
  ensureSizeObserver(iframe);
  return { host, iframe };
}

/**
 * Recompute the iframe's pixel height from its host's current width.
 * Each slide is 16:9 and we add the same 0.75em bottom margin between slides
 * that the OVERRIDE_CSS applies inside the iframe (0.75em at the iframe's
 * default 16px root = 12px).
 */
export function applyDeckHeight(iframe: HTMLIFrameElement): void {
  const count = Math.max(1, Number(iframe.dataset.slideCount ?? 1));
  const width = iframe.clientWidth || iframe.parentElement?.clientWidth || 0;
  if (width === 0) return;
  const slideH = (width * 9) / 16;
  const gapPx = 12; // 0.75em at the iframe's default 16px html font-size
  iframe.style.height = `${slideH * count + gapPx * (count - 1)}px`;
}

/**
 * Re-run `applyDeckHeight` whenever the iframe's host box changes size.
 * Necessary because the first call can happen before layout — the iframe's
 * width is 0 at construction time, so we defer until the ResizeObserver fires
 * the initial measurement, and we keep watching for pane-resizes after that.
 */
function ensureSizeObserver(iframe: HTMLIFrameElement): void {
  if (sizedIframes.has(iframe)) return;
  sizedIframes.add(iframe);
  const target = iframe.parentElement ?? iframe;
  new ResizeObserver(() => applyDeckHeight(iframe)).observe(target);
}
