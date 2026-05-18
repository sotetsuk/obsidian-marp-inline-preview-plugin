import { describe, it, expect } from 'vitest';
import { MarpEngine } from '../src/marp/engine';

describe('MarpEngine.render / renderArray', () => {
  it('renders a single slide into one section', () => {
    const e = new MarpEngine({ math: 'katex' });
    const { html, css } = e.render('# Hello');
    expect(typeof html).toBe('string');
    expect(typeof css).toBe('string');
    expect(html).toContain('marp-inline-preview');
    expect(css).toContain('section'); // base Marpit selector
  });

  it('renderArray returns one entry per slide for N+1 sections', () => {
    const e = new MarpEngine({ math: 'katex' });
    const { html } = e.renderArray('# a\n\n---\n\n# b\n\n---\n\n# c');
    expect(html).toHaveLength(3);
    expect(html[0]).toContain('>a</h1>');
    expect(html[1]).toContain('>b</h1>');
    expect(html[2]).toContain('>c</h1>');
  });

  it('disables script injection (no marpit script block)', () => {
    const e = new MarpEngine({ math: 'katex' });
    const { html } = e.render('# anything');
    expect(html).not.toMatch(/<script\b/);
  });

  it('renders inline SVG (matches Marp CLI default for HTML export)', () => {
    const e = new MarpEngine({ math: 'katex' });
    const { html } = e.render('# slide');
    expect(html).toContain('<svg');
    expect(html).toContain('data-marpit-svg');
  });

  it('emits KaTeX markup when math: katex', () => {
    const e = new MarpEngine({ math: 'katex' });
    const { html, css } = e.render('inline $a^2 + b^2 = c^2$ math');
    // KaTeX inserts elements with class="katex" and ships its own CSS.
    expect(html).toMatch(/class="[^"]*\bkatex\b/);
    expect(css).toContain('.katex');
  });

  it('omits KaTeX entirely when math: false', () => {
    const e = new MarpEngine({ math: false });
    const { html, css } = e.render('inline $a^2$ math');
    expect(html).not.toMatch(/\bkatex\b/);
    expect(css).not.toContain('.katex');
  });

  it('converts :memo: shortcode to unicode without contacting Twemoji', () => {
    const e = new MarpEngine({ math: 'katex' });
    const { html } = e.render(':memo: note');
    expect(html).toContain('📝');
    expect(html).not.toMatch(/twemoji/i);
  });

  it('rebuild swaps engine options on the next render', () => {
    const e = new MarpEngine({ math: 'katex' });
    expect(e.render('$x$').html).toMatch(/\bkatex\b/);
    e.rebuild({ math: false });
    expect(e.render('$x$').html).not.toMatch(/\bkatex\b/);
  });

  it('registerTheme adds a CSS payload that subsequent renders can reference', () => {
    const e = new MarpEngine({ math: 'katex' });
    e.registerTheme('/* @theme custom-test */\nsection { background: #abcdef; }');
    const md = '---\nmarp: true\ntheme: custom-test\n---\n\n# hi';
    const { css } = e.render(md);
    expect(css).toContain('#abcdef');
  });

  it('registerTheme survives malformed CSS without throwing', () => {
    const e = new MarpEngine({ math: 'katex' });
    expect(() => e.registerTheme('not actually a theme')).not.toThrow();
  });
});
