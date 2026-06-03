// L4 — slide-position sync (mode switch + split panes).
//
// The unit tests prove the bus, the picker, and the reading wiring in isolation.
// This E2E proves the user-visible contract against real Obsidian geometry:
//   1. Switching a leaf edit<->reading keeps the same slide in view.
//   2. Two panes of the same file track each other's slide, both directions.
//   3. The coupling settles (no oscillation / runaway scroll).
//   4. With the setting off, panes scroll independently.
//
// "Which slide is at the top" is read the same way the plugin computes it: the
// topmost slide host (reading) / placeholder (editor) whose top is at/above the
// scroll container's visible top.

import { browser } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';

const FILE = 'deck-long.md';

/** Index of the slide whose preview sits at the top of the given markdown leaf. */
async function topSlideIndex(leafIndex: number): Promise<number> {
  return browser.execute((li) => {
    const app = (window as any).app;
    const leaves = app.workspace.getLeavesOfType('markdown');
    const view = leaves[li]?.view;
    if (!view) throw new Error(`no leaf ${li}`);
    const mode = view.getMode();

    const pick = (root: Element, nodes: Element[]): number => {
      const rootTop = root.getBoundingClientRect().top;
      let chosen = 0;
      for (const n of nodes) {
        const idx = Number((n as HTMLElement).dataset.slideIndex);
        if (!Number.isFinite(idx)) continue;
        const top = n.getBoundingClientRect().top - rootTop;
        if (top <= 1) chosen = idx;
      }
      return chosen;
    };

    if (mode === 'preview') {
      const host = view.containerEl.querySelector('.markdown-preview-view') as HTMLElement;
      const overlay = host?.querySelector(':scope > .marp-deck-overlay');
      const nodes = overlay
        ? Array.from(overlay.querySelectorAll(':scope > .marp-inline-preview-host'))
        : [];
      // Resolve the actual scroller (host or an ancestor).
      let scroller: HTMLElement = host;
      let el: HTMLElement | null = host;
      while (el) {
        const oy = getComputedStyle(el).overflowY;
        if (oy === 'auto' || oy === 'scroll') {
          scroller = el;
          break;
        }
        el = el.parentElement;
      }
      return pick(scroller, nodes);
    }

    const cm = (view.editor as any)?.cm;
    const scrollDOM = cm.scrollDOM as HTMLElement;
    const nodes = Array.from(scrollDOM.querySelectorAll('.marp-slide-placeholder'));
    return pick(scrollDOM, nodes);
  }, leafIndex);
}

async function scrollLeafToSlide(leafIndex: number, slide: number): Promise<void> {
  await browser.execute(
    (li, s) => {
      const app = (window as any).app;
      const view = app.workspace.getLeavesOfType('markdown')[li]?.view;
      const mode = view.getMode();
      if (mode === 'preview') {
        const host = view.containerEl.querySelector('.markdown-preview-view') as HTMLElement;
        const overlay = host.querySelector(':scope > .marp-deck-overlay');
        const nodes = overlay
          ? (Array.from(
              overlay.querySelectorAll(':scope > .marp-inline-preview-host'),
            ) as HTMLElement[])
          : [];
        let scroller: HTMLElement = host;
        let el: HTMLElement | null = host;
        while (el) {
          const oy = getComputedStyle(el).overflowY;
          if (oy === 'auto' || oy === 'scroll') {
            scroller = el;
            break;
          }
          el = el.parentElement;
        }
        const node = nodes[Math.min(s, nodes.length - 1)];
        scroller.scrollTop += node.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        scroller.dispatchEvent(new Event('scroll'));
      } else {
        const cm = (view.editor as any).cm;
        const phs = Array.from(
          cm.scrollDOM.querySelectorAll('.marp-slide-placeholder'),
        ) as HTMLElement[];
        const node = phs.find((p) => Number(p.dataset.slideIndex) === s) ?? phs[phs.length - 1];
        const sd = cm.scrollDOM as HTMLElement;
        sd.scrollTop += node.getBoundingClientRect().top - sd.getBoundingClientRect().top;
        sd.dispatchEvent(new Event('scroll'));
      }
    },
    leafIndex,
    slide,
  );
}

async function setSyncEnabled(on: boolean): Promise<void> {
  await browser.execute((v) => {
    const app = (window as any).app;
    const plugin = app.plugins.plugins['marp-inline-preview'];
    plugin.settings.syncScrollPosition = v;
  }, on);
}

describe('Marp inline preview — slide position sync (E2E)', function () {
  before(async function () {
    await browser.reloadObsidian({ vault: 'tests/e2e/fixtures/vault' });
  });

  beforeEach(async function () {
    await obsidianPage.resetVault();
    await setSyncEnabled(true);
  });

  it('keeps the same slide visible across an edit->reading mode switch', async function () {
    await obsidianPage.openFile(FILE);
    await browser.pause(500);

    await scrollLeafToSlide(0, 3);
    await browser.pause(300);
    expect(await topSlideIndex(0)).toBe(3);

    // Toggle to reading mode on the same leaf.
    await browser.execute(() => {
      const app = (window as any).app;
      app.commands.executeCommandById('markdown:toggle-preview');
    });
    await browser.pause(700);

    // Within one slide of tolerance (edit vs reading geometry differ).
    const reading = await topSlideIndex(0);
    expect(Math.abs(reading - 3)).toBeLessThanOrEqual(1);
  });

  it('syncs scroll between two split panes, both directions, and settles', async function () {
    await obsidianPage.openFile(FILE);
    await browser.pause(400);
    // Open the same file in a second pane.
    await browser.execute(() => {
      const app = (window as any).app;
      app.commands.executeCommandById('workspace:split-vertical');
    });
    await browser.pause(700);

    // Drive leaf 0; leaf 1 should follow.
    await scrollLeafToSlide(0, 4);
    await browser.pause(600);
    expect(Math.abs((await topSlideIndex(1)) - 4)).toBeLessThanOrEqual(1);

    // Reverse direction.
    await scrollLeafToSlide(1, 1);
    await browser.pause(600);
    expect(Math.abs((await topSlideIndex(0)) - 1)).toBeLessThanOrEqual(1);

    // No oscillation: the follower's scrollTop is stable after settling.
    const sample = () =>
      browser.execute(() => {
        const app = (window as any).app;
        const view = app.workspace.getLeavesOfType('markdown')[0].view;
        const cm = (view.editor as any)?.cm;
        return cm ? cm.scrollDOM.scrollTop : 0;
      });
    const a = await sample();
    await browser.pause(300);
    const b = await sample();
    expect(Math.abs(a - b)).toBeLessThan(4);
  });

  it('does not sync when the setting is off', async function () {
    await obsidianPage.openFile(FILE);
    await browser.pause(400);
    await browser.execute(() => {
      const app = (window as any).app;
      app.commands.executeCommandById('workspace:split-vertical');
    });
    await browser.pause(700);
    await setSyncEnabled(false);

    const before = await topSlideIndex(1);
    await scrollLeafToSlide(0, 5);
    await browser.pause(500);
    expect(await topSlideIndex(1)).toBe(before); // follower stayed put
  });
});
