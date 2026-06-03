// Pure "which slide owns the top of the viewport" picker, shared by the editor
// and reading detectors so two differently-sized panes always derive the same
// active index (which is what stops cross-pane oscillation).
//
// Inputs are the FULL set of currently-mounted slides — not a partial set — with
// top/bottom measured relative to the scroll root's visible top (top edge = 0).
// We deliberately measure all candidates on each pass rather than trust an
// IntersectionObserver callback, whose entries cover only the targets whose
// intersection changed.

export type SlideRect = { index: number; top: number; bottom: number };

export type PickOptions = {
  /**
   * Fraction of the viewport height used as the activation line. 0 = strict top
   * edge (default). A small positive value (e.g. 0.3) treats the slide crossing
   * 30% down as "current", which can feel more natural but is fuzzier.
   */
  activationFraction?: number;
};

/**
 * Returns the index of the last slide whose top has reached or passed the
 * activation line — the classic scrollspy rule. In a gutter between two slides
 * this keeps the previous slide (stable, no flicker) until the next slide's top
 * actually crosses the line. Falls back to the first slide when scrolled above
 * slide 0, and to the last slide when scrolled past the end. Returns null for an
 * empty candidate list. Robust to unordered input. (`bottom` is carried for
 * callers/tests but intentionally not used by this rule.)
 */
export function pickActiveSlide(
  candidates: SlideRect[],
  rootHeight: number,
  opts: PickOptions = {},
): number | null {
  if (candidates.length === 0) return null;

  const line = rootHeight * (opts.activationFraction ?? 0);
  const sorted = [...candidates].sort((a, b) => a.index - b.index);

  // The active slide is the last one whose top is at or above the activation
  // line (its content occupies the line). Tiny epsilon absorbs sub-pixel jitter.
  const EPS = 1;
  let chosen: number | null = null;
  for (const c of sorted) {
    if (c.top <= line + EPS) chosen = c.index;
  }
  if (chosen !== null) return chosen;

  // Nothing has reached the line yet → we're above slide 0.
  return sorted[0].index;
}
