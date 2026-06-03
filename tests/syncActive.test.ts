// L1 — pure active-slide picker (top-of-viewport rule).
//
// Candidates carry top/bottom relative to the scroll root's visible top (0).
// The active slide is the last one whose top has crossed the activation line;
// falls back to first when above slide 0 and last when scrolled past the end.

import { describe, it, expect } from 'vitest';
import { pickActiveSlide, type SlideRect } from '../src/sync/active';

const VH = 600;

// Three 400px slides stacked from `scroll` px above the top edge.
function deck(scroll: number): SlideRect[] {
  return [0, 1, 2].map((i) => ({
    index: i,
    top: i * 400 - scroll,
    bottom: (i + 1) * 400 - scroll,
  }));
}

describe('pickActiveSlide', () => {
  it('returns null for an empty list', () => {
    expect(pickActiveSlide([], VH)).toBeNull();
  });

  it('picks slide 0 at the very top', () => {
    expect(pickActiveSlide(deck(0), VH)).toBe(0);
  });

  it('picks the slide whose span owns the top edge as we scroll', () => {
    expect(pickActiveSlide(deck(450), VH)).toBe(1); // scrolled into slide 1
    expect(pickActiveSlide(deck(850), VH)).toBe(2); // scrolled into slide 2
  });

  it('picks the slide exactly when its top reaches the edge', () => {
    expect(pickActiveSlide(deck(400), VH)).toBe(1); // slide 1 top at 0
  });

  it('falls back to the first slide when scrolled above slide 0', () => {
    // Whole deck pushed down below the top edge (negative scroll).
    expect(pickActiveSlide(deck(-100), VH)).toBe(0);
  });

  it('returns the last slide when scrolled past the end', () => {
    expect(pickActiveSlide(deck(2000), VH)).toBe(2);
  });

  it('is robust to unordered input', () => {
    const shuffled = [deck(450)[2], deck(450)[0], deck(450)[1]];
    expect(pickActiveSlide(shuffled, VH)).toBe(1);
  });

  it('handles gaps/margins between slides', () => {
    // Slides separated by 50px gutters; top edge sits inside slide 1's gutter
    // region just after slide 1's top.
    const rects: SlideRect[] = [
      { index: 0, top: -460, bottom: -60 }, // fully above
      { index: 1, top: -10, bottom: 390 }, // owns the top edge
      { index: 2, top: 440, bottom: 840 },
    ];
    expect(pickActiveSlide(rects, VH)).toBe(1);
  });

  it('respects a non-zero activation fraction', () => {
    // deck(250): slide 1 top = 150px below the edge.
    const rects = deck(250);
    // Strict top line (0): slide 1 hasn't crossed yet → slide 0.
    expect(pickActiveSlide(rects, VH)).toBe(0);
    expect(pickActiveSlide(rects, VH, { activationFraction: 0 })).toBe(0);
    // Line at 30% (180px): slide 1's top (150) is now above it → slide 1.
    expect(pickActiveSlide(rects, VH, { activationFraction: 0.3 })).toBe(1);
  });
});
