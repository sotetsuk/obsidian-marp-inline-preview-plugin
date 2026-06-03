// Plugin-owned slide-position store, keyed by file path.
//
// Both the editor extension and the reading post-processor report the index of
// the slide currently at the top of their viewport, and subscribe to changes so
// they can scroll to match when another view (a split pane, or the other mode of
// the same leaf) moves. We sync a slide *index*, never a pixel offset: edit and
// reading geometry differ wildly (inline previews interleaved with markdown vs a
// stacked overlay deck), so only an index is portable between them.
//
// Loop prevention lives partly here (report() notifies everyone *except* the
// reporter, and dedups identical indexes) and partly in each participant (an
// expected-index guard that suppresses self-reports during programmatic scroll).

export type SyncSource = symbol;
export type SyncListener = (index: number, source: SyncSource) => void;

export interface SlideSyncBus {
  /** Stable identity for one participant (one editor view / one reading host). */
  createSource(): SyncSource;
  /**
   * Record the active slide index for a path and notify every subscriber of that
   * path EXCEPT `source`. No-op (no store change, no notify) when `index` equals
   * the currently stored index — this drops echoes.
   */
  report(path: string, index: number, source: SyncSource): void;
  /** Last reported index for a path, or null if none. Used on mount to restore. */
  current(path: string): number | null;
  /** Subscribe to index changes for a path. Returns an unsubscribe function. */
  subscribe(path: string, source: SyncSource, fn: SyncListener): () => void;
}

type Entry = { index: number; listeners: Map<SyncSource, SyncListener> };

export function createSlideSyncBus(): SlideSyncBus {
  const entries = new Map<string, Entry>();
  let counter = 0;

  function entryFor(path: string): Entry {
    let e = entries.get(path);
    if (!e) {
      e = { index: -1, listeners: new Map() };
      entries.set(path, e);
    }
    return e;
  }

  return {
    createSource(): SyncSource {
      return Symbol(`marp-sync-${counter++}`);
    },

    report(path, index, source): void {
      const e = entryFor(path);
      if (e.index === index) return; // dedup: drop echoes
      e.index = index;
      for (const [s, fn] of e.listeners) {
        if (s === source) continue; // never notify the reporter
        fn(index, source);
      }
    },

    current(path): number | null {
      const e = entries.get(path);
      return e && e.index >= 0 ? e.index : null;
    },

    subscribe(path, source, fn): () => void {
      const e = entryFor(path);
      e.listeners.set(source, fn);
      return () => {
        const cur = entries.get(path);
        cur?.listeners.delete(source);
      };
    },
  };
}
