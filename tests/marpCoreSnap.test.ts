// L2 — marp-core output snapshots.
//
// Pin marp-core to a specific version (see package.json) and snapshot the
// (html, css) tuple for a representative corpus. Any drift — in marp-core
// itself, our engine wrapper, or the option set — is surfaced as a diff
// in CI rather than as a user-visible regression. To intentionally bless
// an update, run `npx vitest -u tests/marpCoreSnap.test.ts`.
//
// We deliberately do not diff against Marp CLI output here: both share
// marp-core, so cross-runner drift is overwhelmingly a wrapper-difference
// problem (section markup, attribute order) that produces noisy diffs
// without catching real visual issues. CLI parity is verified manually
// per the strategy doc; this layer pins our wrapper.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { MarpEngine } from '../src/marp/engine';

const fixturesDir = path.join(__dirname, 'fixtures', 'decks');

function readDeck(name: string): string {
  return readFileSync(path.join(fixturesDir, name), 'utf8');
}

const decks = readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.md'))
  .sort();

describe('marp-core output snapshots (L2)', () => {
  it('discovers a non-empty fixture corpus', () => {
    expect(decks.length).toBeGreaterThan(0);
  });

  for (const filename of decks) {
    describe(filename, () => {
      it('renders to a stable html+css pair', () => {
        const engine = new MarpEngine({ math: 'katex' });
        const { html, css } = engine.renderArray(readDeck(filename));
        // Snapshot per file via separate keys keeps diffs focused — a math
        // fix won't churn the basic deck's snapshot.
        expect({ html, css }).toMatchSnapshot();
      });
    });
  }

  it('locks per-slide section count for the basic deck (3 slides)', () => {
    const engine = new MarpEngine({ math: 'katex' });
    const { html } = engine.renderArray(readDeck('basic.md'));
    expect(html).toHaveLength(3);
  });

  it('locks per-slide section count for the math deck (2 slides)', () => {
    const engine = new MarpEngine({ math: 'katex' });
    const { html } = engine.renderArray(readDeck('math.md'));
    expect(html).toHaveLength(2);
  });
});
