// L1 — slide-position sync bus.
//
// Contract:
//   - report() notifies every subscriber of a path EXCEPT the reporter.
//   - report() dedups identical indexes (drops echoes → no notify).
//   - current() returns the last reported index, or null when unknown.
//   - subscribe() returns a working unsubscribe.
//   - A two-source echo cannot self-perpetuate at the bus layer.

import { describe, it, expect, vi } from 'vitest';
import { createSlideSyncBus } from '../src/sync/bus';

describe('createSlideSyncBus', () => {
  it('notifies other subscribers but not the reporter', () => {
    const bus = createSlideSyncBus();
    const a = bus.createSource();
    const b = bus.createSource();
    const aFn = vi.fn();
    const bFn = vi.fn();
    bus.subscribe('deck.md', a, aFn);
    bus.subscribe('deck.md', b, bFn);

    bus.report('deck.md', 3, a);

    expect(aFn).not.toHaveBeenCalled();
    expect(bFn).toHaveBeenCalledTimes(1);
    expect(bFn).toHaveBeenCalledWith(3, a);
  });

  it('dedups identical indexes (no re-notify)', () => {
    const bus = createSlideSyncBus();
    const a = bus.createSource();
    const b = bus.createSource();
    const bFn = vi.fn();
    bus.subscribe('deck.md', b, bFn);

    bus.report('deck.md', 2, a);
    bus.report('deck.md', 2, a); // same index — dropped
    expect(bFn).toHaveBeenCalledTimes(1);

    bus.report('deck.md', 5, a); // changed — notifies
    expect(bFn).toHaveBeenCalledTimes(2);
  });

  it('isolates paths', () => {
    const bus = createSlideSyncBus();
    const a = bus.createSource();
    const b = bus.createSource();
    const bFn = vi.fn();
    bus.subscribe('other.md', b, bFn);
    bus.report('deck.md', 1, a);
    expect(bFn).not.toHaveBeenCalled();
  });

  it('current() returns last index or null', () => {
    const bus = createSlideSyncBus();
    const a = bus.createSource();
    expect(bus.current('deck.md')).toBeNull();
    bus.report('deck.md', 4, a);
    expect(bus.current('deck.md')).toBe(4);
  });

  it('unsubscribe stops notifications', () => {
    const bus = createSlideSyncBus();
    const a = bus.createSource();
    const b = bus.createSource();
    const bFn = vi.fn();
    const off = bus.subscribe('deck.md', b, bFn);
    off();
    bus.report('deck.md', 1, a);
    expect(bFn).not.toHaveBeenCalled();
  });

  it('a two-source echo cannot self-perpetuate', () => {
    // A reports 3 → B is notified once. B "echoes" the same index back: the bus
    // dedups it, so A is never re-notified and there is no ping-pong.
    const bus = createSlideSyncBus();
    const a = bus.createSource();
    const b = bus.createSource();
    const aFn = vi.fn();
    const bFn = vi.fn();
    bus.subscribe('deck.md', a, aFn);
    bus.subscribe('deck.md', b, bFn);

    bus.report('deck.md', 3, a);
    expect(bFn).toHaveBeenCalledTimes(1);
    expect(aFn).not.toHaveBeenCalled();

    bus.report('deck.md', 3, b); // echo — deduped
    expect(aFn).not.toHaveBeenCalled();
    expect(bFn).toHaveBeenCalledTimes(1);
  });
});
