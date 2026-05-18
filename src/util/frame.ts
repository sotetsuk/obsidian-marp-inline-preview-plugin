// Mount Marp-rendered HTML inside a sandboxed iframe — populated by writing
// directly into its about:blank `contentDocument` (no `srcdoc`, no `src`).
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
// Why no `srcdoc`: assigning srcdoc triggers a full document load every time —
// a visible blank frame, theme-CSS re-parse, layout, paint. CM6 viewport-culls
// off-screen block widgets (BlockGapWidget) and calls toDOM() afresh when they
// re-enter the viewport, so srcdoc-based mounts flash on every scroll over a
// long deck. Instead we let the iframe load its default about:blank document
// (synchronous, no network, no load event) and mutate that document's <head>
// and <body> directly. With sandbox="allow-same-origin" the about:blank
// document is same-origin with the parent so DOM access is allowed.
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
export const SLIDE_W = 1280;
export const SLIDE_H = 720;

const OVERRIDE_CSS = `
html, body { margin: 0; padding: 0; background: transparent; }
svg[data-marpit-svg] {
  display: block !important;
  width: 100% !important;
  height: auto !important;
  margin: 0 !important;
}
`;

const sizedIframes = new WeakSet<HTMLIFrameElement>();
const initializedDocs = new WeakSet<Document>();

const THEME_STYLE_SELECTOR = 'style[data-role="theme"]';

// Exported for the editor's persistent-iframe stage; reading-mode mountSlide /
// mountDeck use this internally via mountSlide below.
export function paintFrame(iframe: HTMLIFrameElement, slideHtml: string, css: string): boolean {
  const doc = iframe.contentDocument;
  if (!doc || !doc.body) return false;
  if (!initializedDocs.has(doc)) {
    const base = doc.createElement('base');
    base.setAttribute('target', '_blank');
    doc.head.appendChild(base);
    const themeStyle = doc.createElement('style');
    themeStyle.setAttribute('data-role', 'theme');
    doc.head.appendChild(themeStyle);
    const overrideStyle = doc.createElement('style');
    overrideStyle.textContent = OVERRIDE_CSS;
    doc.head.appendChild(overrideStyle);
    initializedDocs.add(doc);
  }
  const themeStyle = doc.head.querySelector(THEME_STYLE_SELECTOR) as HTMLStyleElement | null;
  if (themeStyle && themeStyle.textContent !== css) themeStyle.textContent = css;
  doc.body.innerHTML = `<div class="${CONTAINER_CLASS}">${slideHtml}</div>`;
  return true;
}

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
 * that Marp's selectors expect. Reused for both first-mount and re-paint —
 * `ensureIframe` returns the existing iframe if one is already attached, and
 * `paintFrame` only rewrites the theme `<style>` when the CSS actually
 * changed.
 */
export function mountSlide(
  host: HTMLElement,
  slideHtml: string,
  css: string,
): MountedFrame {
  const iframe = ensureIframe(host);
  if (!paintFrame(iframe, slideHtml, css)) {
    // CM6 hands toDOM() a detached host, so iframe.contentDocument is null
    // until the host is spliced into the editor. Microtasks drain after CM6
    // commits its DOM updates but before the next paint — so the user
    // never sees a blank frame.
    queueMicrotask(() => paintFrame(iframe, slideHtml, css));
  }
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
