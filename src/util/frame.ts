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
// the iframe a fixed 1280×720 intrinsic viewport and then scaling the element
// keeps `vh` and `vw` resolution identical to a standalone Marp document.
//
// One iframe per slide (not per deck): putting all slides into one iframe
// would make `vh` resolve to the total deck height, which throws off any
// theme rule that uses viewport units. Per-slide iframes match Marp CLI's
// per-slide viewport semantics.

export type MountedFrame = {
  host: HTMLElement;
  iframe: HTMLIFrameElement;
};

export type MountedDeck = {
  host: HTMLElement;
  iframes: HTMLIFrameElement[];
};

const CONTAINER_CLASS = 'marp-inline-preview';
const SLIDE_HOST_CLASS = 'marp-inline-preview-host';

// Marp's default slide is 1280×720 (16:9). We rely on this for the iframe's
// intrinsic dimensions and the scale factor we apply.
const SLIDE_W = 1280;
const SLIDE_H = 720;

const OVERRIDE_CSS = `
html, body { margin: 0; padding: 0; background: transparent; }
svg[data-marpit-svg] {
  display: block !important;
  width: 100% !important;
  height: auto !important;
  margin: 0 !important;
}
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
    `width:${SLIDE_W}px;height:${SLIDE_H}px;transform-origin:top left;`;
  host.appendChild(iframe);
  return iframe;
}

/**
 * Mount a single slide. The HTML from Marp's `htmlAsArray: true` output is
 * just the bare `<svg>` for that slide, so we wrap it in the container `<div>`
 * that Marp's selectors expect.
 */
export function mountSlide(
  host: HTMLElement,
  slideHtml: string,
  css: string,
): MountedFrame {
  const iframe = ensureIframe(host);
  iframe.srcdoc = buildSrcdoc(
    `<div class="${CONTAINER_CLASS}">${slideHtml}</div>`,
    css,
  );
  applyFrameLayout(iframe);
  ensureSizeObserver(iframe);
  return { host, iframe };
}

/**
 * Mount a full deck — one iframe per slide, stacked inside the host. Each
 * iframe is independently sized so viewport units (vh/vw) resolve per slide,
 * matching Marp CLI's per-slide viewport.
 */
export function mountDeck(
  host: HTMLElement,
  slides: string[],
  css: string,
): MountedDeck {
  // Tear down any per-slide hosts from a previous render.
  host.querySelectorAll(`:scope > .${SLIDE_HOST_CLASS}`).forEach((n) => n.remove());

  const iframes: HTMLIFrameElement[] = [];
  for (const slideHtml of slides) {
    const slideHost = document.createElement('div');
    slideHost.className = SLIDE_HOST_CLASS;
    host.appendChild(slideHost);
    const { iframe } = mountSlide(slideHost, slideHtml, css);
    iframes.push(iframe);
  }
  return { host, iframes };
}

/**
 * Size the iframe's intrinsic dimensions to the slide's natural 1280×720
 * (so `vh`/`vw` inside resolve to slide-relative values) and visually scale
 * it via CSS transform to fit the host's current width. The host's height is
 * set to the post-scale box so the surrounding document allocates the right
 * amount of space.
 */
export function applyFrameLayout(iframe: HTMLIFrameElement): void {
  const host = iframe.parentElement;
  const hostW = host?.clientWidth || iframe.clientWidth || 0;
  if (hostW === 0) return;

  iframe.style.height = `${SLIDE_H}px`;
  const scale = hostW / SLIDE_W;
  iframe.style.transform = `scale(${scale})`;

  if (host) host.style.height = `${SLIDE_H * scale}px`;
}

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
  // Defer the layout write to the next animation frame. applyFrameLayout
  // writes back into the observed element's box (host height + iframe
  // transform), so running it synchronously inside the ResizeObserver
  // callback can race with the current delivery cycle and produce
  // "ResizeObserver loop completed with undelivered notifications" warnings
  // on Android WebView. requestAnimationFrame moves the write out of the
  // observation loop without changing user-visible behavior.
  new ResizeObserver(() => requestAnimationFrame(() => applyFrameLayout(iframe))).observe(target);
}
