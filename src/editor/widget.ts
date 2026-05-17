import { WidgetType } from '@codemirror/view';
import { mountSlide } from '../util/shadow';

export class SlideWidget extends WidgetType {
  constructor(
    private slideHtml: string,
    private css: string,
    private index: number,
  ) {
    super();
  }

  eq(other: SlideWidget): boolean {
    return (
      this.index === other.index &&
      this.slideHtml === other.slideHtml &&
      this.css === other.css
    );
  }

  toDOM(): HTMLElement {
    const host = document.createElement('div');
    host.className = 'marp-inline-preview-host';
    host.setAttribute('data-slide-index', String(this.index));
    mountSlide(host, this.slideHtml, this.css);
    return host;
  }

  ignoreEvent(): boolean {
    // Let mouse interactions through so users can still click links inside the preview.
    return false;
  }
}
