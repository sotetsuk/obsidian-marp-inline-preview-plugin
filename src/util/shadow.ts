// Mount Marp-rendered HTML inside a Shadow DOM so the deck's CSS
// (which contains :root resets and global selectors) cannot leak into
// the surrounding Obsidian UI.

export type MountedSlide = {
  host: HTMLElement;
  root: ShadowRoot;
};

/**
 * Override appended after Marp's own CSS inside the shadow DOM.
 *
 * Marp's default CSS sizes each inline SVG to `height: 100vh; width: 100vw`,
 * which assumes a single-slide-per-viewport presentation. In an Obsidian
 * preview / editor widget we want each slide to fit the available column
 * width and keep its 16:9 aspect ratio, with multiple slides stacked
 * vertically. The viewport units would otherwise blow each slide up to the
 * whole window — making nothing visible inside our bounded host.
 */
const SVG_OVERRIDE_CSS = `
:host { display: block; width: 100%; }
svg[data-marpit-svg] {
  display: block !important;
  width: 100% !important;
  height: auto !important;
  margin: 0 0 0.75em 0 !important;
}
svg[data-marpit-svg]:last-child { margin-bottom: 0 !important; }
`;

const CONTAINER_CLASS = 'marp-inline-preview';

function ensureShadow(host: HTMLElement): ShadowRoot {
  return host.shadowRoot ?? host.attachShadow({ mode: 'open' });
}

/**
 * Mount a single slide. The HTML from Marp's `htmlAsArray: true` output is
 * just the bare `<svg>` for that slide, so we wrap it in the container `<div>`
 * that Marp's selectors expect (`div.marp-inline-preview > svg ...`).
 */
export function mountSlide(host: HTMLElement, slideHtml: string, css: string): MountedSlide {
  const root = ensureShadow(host);
  root.innerHTML = `<style>${css}</style><style>${SVG_OVERRIDE_CSS}</style>` +
    `<div class="${CONTAINER_CLASS}">${slideHtml}</div>`;
  return { host, root };
}

/**
 * Mount a full deck. The HTML from Marp's normal `render()` already includes
 * the wrapper div, so we hand it through unchanged.
 */
export function mountDeck(host: HTMLElement, deckHtml: string, css: string): MountedSlide {
  const root = ensureShadow(host);
  root.innerHTML = `<style>${css}</style><style>${SVG_OVERRIDE_CSS}</style>${deckHtml}`;
  return { host, root };
}
