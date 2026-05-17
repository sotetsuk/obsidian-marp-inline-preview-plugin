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
//
// Why the iframe is sized to the slide's natural 1280×720 and visually scaled
// via CSS `transform`: themes commonly use viewport units (e.g. `max-height:
// 65vh`) assuming the slide fills the viewport — that's how Marp CLI's
// presentation mode looks. If we instead size the iframe to fit the column
// in screen pixels (~800×450), the iframe's own viewport shrinks too and
// `65vh` resolves to 65% of the smaller iframe, breaking image sizing. Giving
// the iframe a fixed 1280-wide internal viewport and then scaling the element
// keeps `vh` and `vw` resolution identical to a standalone Marp document.

export type MountedFrame = {
  host: HTMLElement;
  iframe: HTMLIFrameElement;
};

const CONTAINER_CLASS = 'marp-inline-preview';

// Marp's default slide is 1280×720 (16:9). We rely on this in two places:
// the iframe's intrinsic dimensions, and the scale factor we apply.
const SLIDE_W = 1280;
const SLIDE_H = 720;
const GAP = 12; // 0.75em at the iframe's default 16px root; matches OVERRIDE_CSS

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
  // Fixed intrinsic dimensions — see header comment. `transform-origin` keeps
  // the scaled iframe anchored to the host's top-left so it occupies the
  // expected box; the host has `overflow: hidden` to clip the rest.
  iframe.style.cssText =
    'display:block;border:0;background:transparent;color-scheme:light dark;' +
    `width:${SLIDE_W}px;transform-origin:top left;`;
  host.appendChild(iframe);
  return iframe;
}

/**
 * Mount a single slide (edit mode). The HTML from Marp's `htmlAsArray: true`
 * output is just the bare `<svg>` for that slide, so we wrap it in the
 * container `<div>` that Marp's selectors expect.
 */
export function mountSlide(
  host: HTMLElement,
  slideHtml: string,
  css: string,
): MountedFrame {
  const iframe = ensureIframe(host);
  iframe.dataset.slideCount = '1';
  iframe.srcdoc = buildSrcdoc(
    `<div class="${CONTAINER_CLASS}">${slideHtml}</div>`,
    css,
  );
  applyFrameLayout(iframe);
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
  iframe.dataset.slideCount = String(Math.max(1, slideCount));
  iframe.srcdoc = buildSrcdoc(deckHtml, css);
  applyFrameLayout(iframe);
  ensureSizeObserver(iframe);
  return { host, iframe };
}

/**
 * Size the iframe's intrinsic dimensions to the natural deck size (so the
 * iframe's own viewport is 1280×720 per slide, and `vh`/`vw` inside resolve
 * the way themes expect), then scale it visually via CSS transform to fit
 * the host's current width. The host's height is set to the post-scale box
 * so the surrounding document allocates the right amount of space.
 */
export function applyFrameLayout(iframe: HTMLIFrameElement): void {
  const count = Math.max(1, Number(iframe.dataset.slideCount ?? 1));
  const host = iframe.parentElement;
  const hostW = host?.clientWidth || iframe.clientWidth || 0;
  if (hostW === 0) return;

  const intrinsicH = SLIDE_H * count + GAP * (count - 1);
  iframe.style.height = `${intrinsicH}px`;

  const scale = hostW / SLIDE_W;
  iframe.style.transform = `scale(${scale})`;

  if (host) host.style.height = `${intrinsicH * scale}px`;
}

// Kept as a stable alias for callers that previously imported the old name.
export const applyDeckHeight = applyFrameLayout;

/**
 * Re-run the layout whenever the iframe's host box changes size.
 * Necessary because the first call can happen before layout — the host's
 * width is 0 at construction time, so we defer until the ResizeObserver
 * fires the initial measurement, and we keep watching for pane-resizes.
 */
function ensureSizeObserver(iframe: HTMLIFrameElement): void {
  if (sizedIframes.has(iframe)) return;
  sizedIframes.add(iframe);
  const target = iframe.parentElement ?? iframe;
  new ResizeObserver(() => applyFrameLayout(iframe)).observe(target);
}
