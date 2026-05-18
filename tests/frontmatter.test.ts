import { describe, it, expect } from 'vitest';
import { injectThemeIfMissing } from '../src/marp/frontmatter';

describe('injectThemeIfMissing', () => {
  it('returns the source unchanged when theme is null', () => {
    const src = '---\nmarp: true\n---\n\n# body';
    expect(injectThemeIfMissing(src, null)).toBe(src);
  });

  it('leaves frontmatter alone when theme is already declared', () => {
    const src = '---\nmarp: true\ntheme: existing\n---\n\nbody';
    expect(injectThemeIfMissing(src, 'override')).toBe(src);
  });

  it('injects theme line before the closing `---` when frontmatter has none', () => {
    const src = '---\nmarp: true\n---\n\nbody';
    const out = injectThemeIfMissing(src, 'mytheme');
    expect(out).toContain('theme: mytheme');
    // Theme line must land inside the frontmatter, not after it.
    const fm = /^---\n([\s\S]*?)\n---/.exec(out);
    expect(fm).not.toBeNull();
    expect(fm![1]).toContain('theme: mytheme');
    expect(out).toContain('body');
  });

  it('synthesizes a minimal frontmatter when the source has none', () => {
    const out = injectThemeIfMissing('# only body\n', 'newtheme');
    expect(out.startsWith('---\nmarp: true\ntheme: newtheme\n---\n')).toBe(true);
    expect(out).toContain('# only body');
  });

  it('detects existing theme key with surrounding whitespace', () => {
    const src = '---\nmarp: true\n  theme:   spaced\n---\n\nbody';
    expect(injectThemeIfMissing(src, 'other')).toBe(src);
  });

  it('handles CRLF frontmatter delimiters', () => {
    const src = '---\r\nmarp: true\r\n---\r\n\r\nbody';
    const out = injectThemeIfMissing(src, 'crlf');
    expect(out).toContain('theme: crlf');
    expect(out).toContain('marp: true');
  });
});
