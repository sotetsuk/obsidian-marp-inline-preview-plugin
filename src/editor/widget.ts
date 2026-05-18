import { WidgetType } from '@codemirror/view';
import { PLACEHOLDER_CLASS_NAME } from './stage';

/**
 * Minimal block-level placeholder. The actual slide content lives in a
 * persistent iframe inside SlideStage (see ./stage.ts) which is positioned
 * over this element after layout. The widget only needs to:
 *  - reserve the right amount of vertical space (aspect-ratio 16/9 + 100%
 *    width gives CM6 a measurable block of the slide's natural height),
 *  - carry its slide index so SlideStage can match it to the right iframe.
 *
 * Two widgets compare equal when they refer to the same slide index, so CM6
 * never has to throw away and rebuild a placeholder just because the slide's
 * HTML changed — the iframe behind it gets repainted in place instead.
 */
export class SlidePlaceholder extends WidgetType {
  constructor(private index: number) {
    super();
  }

  eq(other: SlidePlaceholder): boolean {
    return other.index === this.index;
  }

  toDOM(): HTMLElement {
    const dom = createDiv({ cls: PLACEHOLDER_CLASS_NAME });
    dom.dataset.slideIndex = String(this.index);
    return dom;
  }
}
