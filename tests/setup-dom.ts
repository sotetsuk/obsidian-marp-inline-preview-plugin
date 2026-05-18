// Setup file loaded by vitest for happy-dom suites. Provides the Obsidian
// runtime globals (createEl, createDiv) that the plugin uses but doesn't
// import — Obsidian injects these on `window` at startup, so production
// code references them without an import statement.

type CreateElOptions = {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string>;
};

function applyOptions(el: HTMLElement, opts?: CreateElOptions) {
  if (!opts) return;
  if (opts.cls) {
    const classes = Array.isArray(opts.cls) ? opts.cls : [opts.cls];
    for (const c of classes) el.classList.add(c);
  }
  if (opts.text !== undefined) el.textContent = opts.text;
  if (opts.attr) {
    for (const [k, v] of Object.entries(opts.attr)) el.setAttribute(k, v);
  }
}

const g = globalThis as unknown as {
  createEl?: <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    opts?: CreateElOptions,
  ) => HTMLElementTagNameMap[K];
  createDiv?: (opts?: CreateElOptions) => HTMLDivElement;
};

g.createEl = function createEl(tag, opts) {
  const el = document.createElement(tag);
  applyOptions(el, opts);
  return el;
};

g.createDiv = function createDiv(opts) {
  return g.createEl!('div', opts);
};
