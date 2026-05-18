// L4 smoke — Marp Inline Preview renders three iframes for a three-slide deck.
//
// Coverage:
//   - plugin loads in Obsidian Desktop without error
//   - edit mode mounts one persistent iframe per slide
//   - reading mode mounts an overlay with one iframe per slide
//   - no ResizeObserver loop warning surfaces (regression we ship against)

import { browser } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';

const STAGE_SELECTOR = '.marp-slide-stage iframe';
const OVERLAY_SELECTOR = '.marp-deck-overlay iframe';

async function openDeck(): Promise<void> {
  await obsidianPage.openFile('deck.md');
  // Give the editor extension a tick to mount its stage container.
  await browser.pause(300);
}

describe('Marp inline preview — smoke', function () {
  before(async function () {
    await browser.reloadObsidian({ vault: 'tests/e2e/fixtures/vault' });
  });

  beforeEach(async function () {
    await obsidianPage.resetVault();
  });

  it('mounts one persistent iframe per slide in edit mode', async function () {
    await openDeck();
    const iframes = await browser.$$(STAGE_SELECTOR);
    await expect(iframes).toBeElementsArrayOfSize(3);
  });

  it('mounts an overlay with one iframe per slide in reading mode', async function () {
    await openDeck();
    await browser.executeObsidianCommand('markdown:toggle-preview');
    await browser.waitUntil(
      async () => {
        const count = await browser.$$(OVERLAY_SELECTOR).length;
        return count === 3;
      },
      {
        timeout: 5000,
        timeoutMsg: 'expected reading-mode overlay to mount 3 iframes',
      },
    );
  });

  it('does not emit ResizeObserver loop warnings during a basic open/close', async function () {
    const logs: string[] = [];
    const sink = (entry: { message: string }) => logs.push(entry.message);
    // Drain any prior log buffer so we only see this test's noise.
    await browser.getLogs('browser').catch(() => []);
    await openDeck();
    await browser.executeObsidianCommand('markdown:toggle-preview');
    await browser.pause(500);

    const browserLogs = (await browser.getLogs('browser').catch(() => [])) as {
      message: string;
    }[];
    for (const entry of browserLogs) sink(entry);
    const looped = logs.find((m) =>
      m.includes('ResizeObserver loop completed with undelivered notifications'),
    );
    expect(looped).toBeUndefined();
  });
});
