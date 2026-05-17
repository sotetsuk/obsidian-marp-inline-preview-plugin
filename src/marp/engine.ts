import { Marp } from '@marp-team/marp-core';

export type RenderResult = { html: string; css: string };
export type RenderArrayResult = { html: string[]; css: string };

export type EngineOptions = {
  math: 'katex' | false;
};

const CONTAINER_CLASS = 'marp-inline-preview';

export class MarpEngine {
  private marp: Marp;
  private knownThemes = new Set<string>();

  constructor(opts: EngineOptions) {
    this.marp = this.build(opts);
  }

  private build(opts: EngineOptions): Marp {
    return new Marp({
      container: { tag: 'div', class: CONTAINER_CLASS },
      inlineSVG: true,
      script: false,
      html: true,
      math: opts.math === false ? false : 'katex',
      // Keep emoji as native OS-rendered Unicode glyphs. No Twemoji CDN fetch.
      emoji: { shortcode: false, unicode: false },
    });
  }

  /** Re-create the underlying Marp instance with new options. Existing themes are re-registered. */
  rebuild(opts: EngineOptions, themes: string[]): void {
    this.marp = this.build(opts);
    this.knownThemes.clear();
    for (const css of themes) this.registerTheme(css);
  }

  /** Add a CSS string with an "@theme name" header to the themeSet. Idempotent on the CSS string. */
  registerTheme(css: string): string | null {
    if (this.knownThemes.has(css)) {
      return this.extractName(css);
    }
    try {
      const theme = this.marp.themeSet.add(css);
      this.knownThemes.add(css);
      return theme?.name ?? this.extractName(css);
    } catch (e) {
      console.warn('[marp-inline-preview] failed to register theme', e);
      return null;
    }
  }

  /** Render markdown to a single combined HTML string + shared CSS. */
  render(markdown: string): RenderResult {
    const { html, css } = this.marp.render(markdown, { htmlAsArray: false });
    return { html: html as string, css };
  }

  /** Render markdown to a per-slide HTML array + shared CSS. */
  renderArray(markdown: string): RenderArrayResult {
    const { html, css } = this.marp.render(markdown, { htmlAsArray: true });
    return { html: html as string[], css };
  }

  private extractName(css: string): string | null {
    const m = /\/\*\s*@theme\s+([\w-]+)\s*\*\//.exec(css);
    return m ? m[1] : null;
  }
}
