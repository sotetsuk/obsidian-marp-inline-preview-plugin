/**
 * Inject `theme: <name>` into the markdown's frontmatter block if one isn't
 * already declared there. Used to apply themes coming from `.marprc.yml`,
 * which Marp Core itself doesn't read.
 */
export function injectThemeIfMissing(src: string, theme: string | null): string {
  if (!theme) return src;
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src);
  if (fmMatch && /^\s*theme\s*:/m.test(fmMatch[1])) return src;
  if (fmMatch) {
    // Splice the new line in just before the closing `---`.
    const closeIdx = fmMatch.index + fmMatch[0].length - 3; // pos of the final ---
    return src.slice(0, closeIdx) + `theme: ${theme}\n` + src.slice(closeIdx);
  }
  // No frontmatter — synthesize a minimal one.
  return `---\nmarp: true\ntheme: ${theme}\n---\n\n${src}`;
}
