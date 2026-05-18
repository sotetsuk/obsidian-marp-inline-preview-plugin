// L4 flicker — rAF root-element identity sampler.
//
// The unit-level test (tests/stageSyncSlides.test.ts) proves the *paint*
// contract: syncSlides skips slides whose content didn't change. But that's
// a contract on the code, not on the rendered DOM. This E2E proves the
// invariant that actually matters to the user: while editing slide K,
// the other slides' iframe contentDocument body root element identity must
// not change across animation frames. If it changes, the iframe was
// re-mounted or its body.innerHTML was rewritten — i.e. a white flash.
//
// Mechanism:
//   - Install a sampler on `window` that polls each iframe's
//     contentDocument.body.firstElementChild via rAF and records identities.
//   - Type a character into slide K.
//   - Read the sampler back: assert that for every i ≠ K the recorded
//     identity sequence has length 1 (one stable element across all frames).

import { browser } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';

declare global {
  interface Window {
    __marpFlickerSampler?: {
      stop: () => Array<Array<string | null>>;
    };
  }
}

const STAGE_SELECTOR = '.marp-slide-stage iframe';

async function openDeckEdit(): Promise<void> {
  await obsidianPage.openFile('deck.md');
  await browser.pause(300);
  // Ensure we're in source/live-preview edit mode, not reading.
  const view = await browser.$('.markdown-source-view');
  await view.waitForExist({ timeout: 5000 });
}

describe('Marp inline preview — flicker contract (E2E)', function () {
  before(async function () {
    await browser.reloadObsidian({ vault: 'tests/e2e/fixtures/vault' });
  });

  beforeEach(async function () {
    await obsidianPage.resetVault();
  });

  it('does not remount unedited slides while typing into one slide', async function () {
    await openDeckEdit();
    const iframes = await browser.$$(STAGE_SELECTOR);
    await expect(iframes).toBeElementsArrayOfSize(3);

    // Install rAF sampler.
    await browser.execute(() => {
      const stage = document.querySelector('.marp-slide-stage');
      if (!stage) throw new Error('marp stage not present');
      const targets = Array.from(stage.querySelectorAll('iframe')) as HTMLIFrameElement[];
      // For each iframe, keep the sequence of distinct firstElementChild
      // identities observed across animation frames. Identity is approximated
      // by a stable per-element string key.
      const keys = new WeakMap<Element, string>();
      let nextKey = 0;
      const idOf = (el: Element | null): string | null => {
        if (!el) return null;
        let k = keys.get(el);
        if (!k) {
          k = String(++nextKey);
          keys.set(el, k);
        }
        return k;
      };
      const samples: Array<Array<string | null>> = targets.map(() => []);
      let stopped = false;
      const tick = () => {
        if (stopped) return;
        targets.forEach((iframe, i) => {
          const body = iframe.contentDocument?.body ?? null;
          const root = body?.firstElementChild ?? null;
          const last = samples[i][samples[i].length - 1];
          const cur = idOf(root);
          if (cur !== last) samples[i].push(cur);
        });
        requestAnimationFrame(tick);
      };
      // Seed with current identities so a no-op test still records something.
      targets.forEach((iframe, i) => {
        const root = iframe.contentDocument?.body?.firstElementChild ?? null;
        samples[i].push(idOf(root));
      });
      requestAnimationFrame(tick);
      window.__marpFlickerSampler = {
        stop: () => {
          stopped = true;
          return samples;
        },
      };
    });

    // Click into the editor and type at the end of the first slide's body line.
    // We use a CM6 dispatch directly to keep the test independent of cursor
    // positioning quirks across Obsidian versions.
    await browser.execute(() => {
      const leaves = (window as any).app.workspace.getLeavesOfType('markdown');
      const view = leaves[0]?.view;
      // editor.cm is the standard CM6 escape hatch — same pattern as src/main.ts
      const cm = view?.editor?.cm as any;
      if (!cm) throw new Error('CM6 EditorView not reachable');
      // Append " edited" after "Slide 1" (line index 4 in the fixture).
      const doc = cm.state.doc;
      const targetText = '# Slide 1';
      const idx = doc.toString().indexOf(targetText);
      if (idx < 0) throw new Error('could not find "# Slide 1" in fixture');
      const pos = idx + targetText.length;
      cm.dispatch({ changes: { from: pos, insert: ' edited' } });
    });

    // Wait through several frames so the rebuild can complete and sampler
    // can observe steady state again.
    await browser.pause(800);

    const samples = await browser.execute(() => {
      const sampler = window.__marpFlickerSampler;
      window.__marpFlickerSampler = undefined;
      return sampler ? sampler.stop() : [];
    });

    // Slide 0 (the edited one) is allowed to change identity at most once
    // (paintFrame rewrites body.innerHTML in place — see frame.ts paintFrame).
    // Slides 1 and 2 must show identity stability: a single recorded entry.
    const dump = JSON.stringify(samples);
    if (samples[1].length !== 1) throw new Error(`slide 1 remounted: ${dump}`);
    if (samples[2].length !== 1) throw new Error(`slide 2 remounted: ${dump}`);
    expect(samples[0].length).toBeLessThanOrEqual(2);
  });
});
