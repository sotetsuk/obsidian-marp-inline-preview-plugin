import { WidgetType } from '@codemirror/view';
import { mountSlide } from '../util/frame';

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
}
