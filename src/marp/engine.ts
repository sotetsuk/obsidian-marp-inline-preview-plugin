import { Marp } from '@marp-team/marp-core';

export type EngineOptions = { math: 'katex' | false };

const CONTAINER_CLASS = 'marp-inline-preview';

function build(opts: EngineOptions): Marp {
  return new Marp({
    container: { tag: 'div', class: CONTAINER_CLASS },
    inlineSVG: true,
    script: false,
    html: true,
    math: opts.math === false ? false : 'katex',
    // Convert :memo: → 📝 as native unicode; leave existing unicode emoji as-is.
    // No Twemoji CDN fetch in either case.
    emoji: { shortcode: true, unicode: false },
  });
}

export class MarpEngine {
  private marp: Marp;

  constructor(opts: EngineOptions) {
    this.marp = build(opts);
  }

  /** Recreate the underlying Marp with new options. Themes must be re-registered by the caller. */
  rebuild(opts: EngineOptions): void {
    this.marp = build(opts);
  }

  /** Add a CSS string with an "@theme name" header to the themeSet. Marp dedupes internally. */
  registerTheme(css: string): void {
    try {
      this.marp.themeSet.add(css);
    } catch (e) {
      console.warn('[marp-inline-preview] failed to register theme', e);
    }
  }

  render(markdown: string): { html: string; css: string } {
    const { html, css } = this.marp.render(markdown, { htmlAsArray: false });
    return { html: html as string, css };
  }

  renderArray(markdown: string): { html: string[]; css: string } {
    const { html, css } = this.marp.render(markdown, { htmlAsArray: true });
    return { html: html as string[], css };
  }
}
