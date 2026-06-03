// Shared geometry helper: measure slide nodes' top/bottom relative to a scroll
// root's visible top edge. Used by both the editor (placeholder nodes) and the
// reading post-processor (per-slide host divs) so the two sides feed identical
// coordinates into pickActiveSlide().

import type { SlideRect } from './active';

/**
 * Build the candidate list for pickActiveSlide from live DOM nodes. Each node
 * must carry a numeric `data-slide-index` (dataset.slideIndex). Zero-size nodes
 * (CM6-culled placeholders, not-yet-laid-out hosts) are skipped. Coordinates are
 * relative to the root's visible top, so a slide at the very top has top ≈ 0.
 */
export function slideRectsRelativeTo(
  nodes: Iterable<HTMLElement>,
  root: HTMLElement,
): SlideRect[] {
  const rootTop = root.getBoundingClientRect().top;
  const out: SlideRect[] = [];
  for (const node of nodes) {
    const idxStr = node.dataset.slideIndex;
    if (idxStr === undefined) continue;
    const index = Number(idxStr);
    if (!Number.isFinite(index)) continue;
    const r = node.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    out.push({ index, top: r.top - rootTop, bottom: r.bottom - rootTop });
  }
  return out;
}
