// Locate Marp slide-break positions in a markdown source string.
//
// Marpit defines a slide break as a line consisting of `---` (three or more
// hyphens) that is not inside a fenced code block and not the frontmatter
// delimiters at the top of the document.

export type LineRange = { from: number; to: number; lineNumber: number };

const FENCE_RE = /^(```+|~~~+)/;
const BREAK_RE = /^-{3,}\s*$/;

export function findSlideBreaks(source: string): LineRange[] {
  const breaks: LineRange[] = [];
  let offset = 0;
  let inFence = false;
  let fenceMarker: string | null = null;
  let lineNumber = 0;
  let frontmatterOpen = false;
  let frontmatterClosed = false;
  let sawNonEmptyBeforeFm = false;

  const lines = source.split('\n');
  for (const raw of lines) {
    const line = raw;
    const start = offset;
    const end = offset + line.length;
    const trimmed = line.replace(/\r$/, '');

    // Fence tracking (open/close)
    if (!inFence) {
      const m = FENCE_RE.exec(trimmed);
      if (m) {
        inFence = true;
        fenceMarker = m[1][0]; // ` or ~
      }
    } else if (fenceMarker) {
      if (new RegExp(`^${fenceMarker === '`' ? '`' : '~'}{3,}\\s*$`).test(trimmed)) {
        inFence = false;
        fenceMarker = null;
      }
    }

    // Frontmatter handling: only when the very first non-empty line is `---`
    if (!frontmatterClosed) {
      if (!frontmatterOpen) {
        if (trimmed.length === 0) {
          // ignore leading blank lines
        } else if (!sawNonEmptyBeforeFm && BREAK_RE.test(trimmed)) {
          frontmatterOpen = true;
          sawNonEmptyBeforeFm = true;
          // skip this `---` (frontmatter open) — not a slide break
          offset = end + 1;
          lineNumber++;
          continue;
        } else {
          sawNonEmptyBeforeFm = true;
          // there is no frontmatter
          frontmatterClosed = true;
        }
      } else {
        if (BREAK_RE.test(trimmed)) {
          // frontmatter close — not a slide break either
          frontmatterClosed = true;
          offset = end + 1;
          lineNumber++;
          continue;
        }
      }
    }

    if (!inFence && frontmatterClosed && BREAK_RE.test(trimmed)) {
      breaks.push({ from: start, to: end, lineNumber });
    }

    offset = end + 1; // +1 for the \n
    lineNumber++;
  }

  return breaks;
}
