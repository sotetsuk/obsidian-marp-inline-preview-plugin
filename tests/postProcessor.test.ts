// @vitest-environment happy-dom
//
// L3 — reading-mode post-processor integration.
//
// The reading-mode contract:
//   - On a marp:true note, the processor prepends a .marp-deck-overlay div
//     to the .markdown-preview-view host and mounts one iframe per slide.
//   - Non-overlay siblings of the host are hidden via inline
//     display:none !important (so Obsidian themes can't override).
//   - When called again with the same source+theme (= same content hash),
//     no re-mount happens — the existing overlay is reused.
//   - On a non-marp file, any prior overlay is cleaned up and siblings
//     are unhidden.
//
// Out of scope for unit: the MutationObserver re-mount path is timing-
// dependent on Obsidian's virtualized scroll behavior — covered in L4.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { renderArrayMock } = vi.hoisted(() => ({
  renderArrayMock: vi.fn(),
}));

// Stub the engine so we don't pull in the real Marp (slow + would re-test
// what engine.test.ts already covers).
vi.mock('../src/marp/engine', () => ({
  MarpEngine: class {
    renderArray = renderArrayMock;
  },
}));

const { buildReadingPostProcessor } = await import('../src/reading/postProcessor');

// happy-dom returns null for offsetParent on detached/non-laid-out elements.
// The production code uses this as a "host is actually visible" gate that
// makes sense in the real Obsidian renderer but is hostile to unit tests.
// Force it visible at the host so our processor branch is exercised.
function forceVisible(el: HTMLElement) {
  Object.defineProperty(el, 'offsetParent', {
    configurable: true,
    get: () => el.parentElement,
  });
}

type Frontmatter = Record<string, unknown> | undefined;

function makeContext(opts: { sourcePath: string; frontmatter?: Frontmatter }) {
  return {
    sourcePath: opts.sourcePath,
    frontmatter: opts.frontmatter,
    // We don't exercise getSectionInfo / addChild in any branch under test.
  } as unknown as import('obsidian').MarkdownPostProcessorContext;
}

function makeApp(opts: { source: string; frontmatter?: Frontmatter }) {
  const file = { path: 'deck.md', name: 'deck.md', parent: { path: '/' } };
  return {
    vault: {
      cachedRead: vi.fn(async () => opts.source),
      getAbstractFileByPath: vi.fn(() => file),
    },
    metadataCache: {
      getFileCache: vi.fn(() => ({ frontmatter: opts.frontmatter })),
    },
  } as any;
}

function makeThemes() {
  return { collect: vi.fn(async () => null), invalidate: vi.fn() } as any;
}

function makeEngine() {
  return { renderArray: renderArrayMock } as any;
}

function buildHost(): { host: HTMLElement; child: HTMLElement; sibling: HTMLElement } {
  const host = document.createElement('div');
  host.className = 'markdown-preview-view';
  forceVisible(host);

  const child = document.createElement('div');
  host.appendChild(child);

  const sibling = document.createElement('div');
  sibling.textContent = 'pre-existing rendered markdown';
  host.appendChild(sibling);

  document.body.appendChild(host);
  return { host, child, sibling };
}

beforeEach(() => {
  document.body.innerHTML = '';
  renderArrayMock.mockReset();
  renderArrayMock.mockReturnValue({
    html: ['<svg>a</svg>', '<svg>b</svg>'],
    css: '/* css */',
  });
});

// TFile.instanceof check passes through the obsidian-stub TFile class. The
// fake file we return from getAbstractFileByPath needs to be an instance.
import { TFile } from 'obsidian';
function makeAppWithTFile(opts: { source: string; frontmatter?: Frontmatter }) {
  const file = Object.assign(new TFile(), {
    path: 'deck.md',
    name: 'deck.md',
    parent: { path: '/' },
  });
  return {
    vault: {
      cachedRead: vi.fn(async () => opts.source),
      getAbstractFileByPath: vi.fn(() => file),
    },
    metadataCache: {
      getFileCache: vi.fn(() => ({ frontmatter: opts.frontmatter })),
    },
  } as any;
}

describe('buildReadingPostProcessor', () => {
  it('does nothing when settings.enabled returns false', async () => {
    const { host, child } = buildHost();
    const processor = buildReadingPostProcessor({
      app: makeAppWithTFile({ source: 'x', frontmatter: { marp: true } }),
      engine: makeEngine(),
      themes: makeThemes(),
      enabled: () => false,
    });
    await processor(child, makeContext({ sourcePath: 'deck.md', frontmatter: { marp: true } }));
    expect(host.querySelector('.marp-deck-overlay')).toBeNull();
    expect(renderArrayMock).not.toHaveBeenCalled();
  });

  it('mounts overlay + per-slide iframes on a marp:true note', async () => {
    const { host, child, sibling } = buildHost();
    const processor = buildReadingPostProcessor({
      app: makeAppWithTFile({ source: '# a\n---\n# b', frontmatter: { marp: true } }),
      engine: makeEngine(),
      themes: makeThemes(),
      enabled: () => true,
    });
    await processor(child, makeContext({ sourcePath: 'deck.md', frontmatter: { marp: true } }));

    const overlay = host.querySelector(':scope > .marp-deck-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay!.querySelectorAll('iframe')).toHaveLength(2);
    // Non-overlay siblings must be hidden via inline !important so Obsidian
    // themes can't override.
    expect(sibling.style.getPropertyPriority('display')).toBe('important');
    expect(sibling.style.display).toBe('none');
  });

  it('skips non-marp notes and cleans up any prior overlay', async () => {
    const { host, child, sibling } = buildHost();
    const processor = buildReadingPostProcessor({
      app: makeAppWithTFile({ source: '# regular note', frontmatter: undefined }),
      engine: makeEngine(),
      themes: makeThemes(),
      enabled: () => true,
    });
    // Seed a stale overlay to ensure cleanup runs.
    const stale = document.createElement('div');
    stale.className = 'marp-deck-overlay';
    host.classList.add('marp-active');
    host.prepend(stale);
    sibling.style.setProperty('display', 'none', 'important');
    sibling.setAttribute('data-marp-stashed-display', '');

    await processor(child, makeContext({ sourcePath: 'deck.md', frontmatter: undefined }));

    expect(host.querySelector(':scope > .marp-deck-overlay')).toBeNull();
    expect(host.classList.contains('marp-active')).toBe(false);
    expect(sibling.style.display).not.toBe('none');
  });

  it('does not re-mount when called twice with identical source+theme', async () => {
    const { host, child } = buildHost();
    const app = makeAppWithTFile({ source: '# a\n---\n# b', frontmatter: { marp: true } });
    const processor = buildReadingPostProcessor({
      app,
      engine: makeEngine(),
      themes: makeThemes(),
      enabled: () => true,
    });
    const ctx = makeContext({ sourcePath: 'deck.md', frontmatter: { marp: true } });

    await processor(child, ctx);
    const overlayFirst = host.querySelector('.marp-deck-overlay');
    expect(overlayFirst).not.toBeNull();
    expect(renderArrayMock).toHaveBeenCalledTimes(1);

    await processor(child, ctx);
    const overlaySecond = host.querySelector('.marp-deck-overlay');
    expect(overlaySecond).toBe(overlayFirst); // identity preserved
    expect(renderArrayMock).toHaveBeenCalledTimes(1); // engine not re-invoked
  });

  it('re-renders when the source changes', async () => {
    const { host, child } = buildHost();
    const app = makeAppWithTFile({ source: '# a', frontmatter: { marp: true } });
    const processor = buildReadingPostProcessor({
      app,
      engine: makeEngine(),
      themes: makeThemes(),
      enabled: () => true,
    });
    const ctx = makeContext({ sourcePath: 'deck.md', frontmatter: { marp: true } });

    await processor(child, ctx);
    expect(renderArrayMock).toHaveBeenCalledTimes(1);

    // Source updated under the same host.
    app.vault.cachedRead.mockResolvedValueOnce('# a\n---\n# b');
    await processor(child, ctx);
    expect(renderArrayMock).toHaveBeenCalledTimes(2);
    expect(host.querySelector('.marp-deck-overlay')!.querySelectorAll('iframe')).toHaveLength(2);
  });

  it('renders an inline error pre when the engine throws', async () => {
    const { host, child } = buildHost();
    renderArrayMock.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const processor = buildReadingPostProcessor({
      app: makeAppWithTFile({ source: '# x', frontmatter: { marp: true } }),
      engine: makeEngine(),
      themes: makeThemes(),
      enabled: () => true,
    });
    await processor(child, makeContext({ sourcePath: 'deck.md', frontmatter: { marp: true } }));

    const err = host.querySelector('.marp-inline-preview-error');
    expect(err).not.toBeNull();
    expect(err!.textContent).toContain('boom');
  });
});
