import { WidgetType } from '@codemirror/view';
import { mountSlide, updateSlideInPlace } from '../util/frame';

export class SlideWidget extends WidgetType {
  constructor(private slideHtml: string, private css: string) {
    super();
  }

  eq(other: SlideWidget): boolean {
    return other.slideHtml === this.slideHtml && other.css === this.css;
  }

  toDOM(): HTMLElement {
    const host = createDiv({ cls: 'marp-inline-preview-host' });
    mountSlide(host, this.slideHtml, this.css);
    return host;
  }

  // Patch the existing iframe's document instead of letting CM6 destroy the
  // host and call toDOM() again. Re-creating the iframe would set srcdoc
  // afresh, which triggers a full document load — visible as a blank flash
  // between every keystroke.
  updateDOM(dom: HTMLElement): boolean {
    const iframe = dom.querySelector(':scope > iframe') as HTMLIFrameElement | null;
    if (!iframe) return false;
    return updateSlideInPlace(iframe, this.slideHtml, this.css);
  }
}
