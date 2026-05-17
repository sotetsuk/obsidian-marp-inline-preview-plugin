import { App, TFile, normalizePath } from 'obsidian';

// Marp emits <img src="..."> with whatever path the markdown wrote. Inside an
// iframe srcdoc those relative paths resolve against Obsidian's app base URL
// rather than the slide note's folder, so vault-relative images would 404.
// We rewrite each src to an Obsidian resource URL (app://<id>/<abs>?…) that
// the iframe can load as a subresource.

const ABS_OR_DATA = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function isHtmlEscaped(s: string): boolean {
  return /&(amp|lt|gt|quot|#\d+);/.test(s);
}

function decodeAttr(s: string): string {
  if (!isHtmlEscaped(s)) return s;
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function resolveOne(rawSrc: string, sourcePath: string, app: App): string {
  if (!rawSrc) return rawSrc;
  if (ABS_OR_DATA.test(rawSrc) || rawSrc.startsWith('#')) return rawSrc;

  let linkpath = decodeAttr(rawSrc);
  // Marp passes the value through markdown-it's URL encoder; decode once so
  // paths with spaces or unicode resolve.
  try {
    linkpath = decodeURIComponent(linkpath);
  } catch {
    // not a valid URI component — fall through with the raw string
  }

  // Strip any fragment / query suffix (e.g. foo.svg#frag, foo.png?w=10)
  const stripped = linkpath.replace(/[?#].*$/, '');

  // First, try resolving as a vault path relative to the slide note. This
  // handles `./foo.png`, `../attachments/foo.png`, and `attachments/foo.png`
  // — the standard markdown-relative cases.
  const lastSlash = sourcePath.lastIndexOf('/');
  const sourceDir = lastSlash >= 0 ? sourcePath.slice(0, lastSlash) : '';
  const candidate = stripped.startsWith('/')
    ? normalizePath(stripped.slice(1))
    : normalizePath(sourceDir ? `${sourceDir}/${stripped}` : stripped);
  const direct = app.vault.getAbstractFileByPath(candidate);
  if (direct instanceof TFile) return app.vault.adapter.getResourcePath(direct.path);

  // Fall back to Obsidian's link resolver, which handles bare basenames
  // (e.g. `![](image.png)` when the file lives elsewhere in the vault).
  const file = app.metadataCache.getFirstLinkpathDest(stripped, sourcePath);
  if (file) return app.vault.adapter.getResourcePath(file.path);

  return rawSrc;
}

const IMG_SRC_RE = /(<img\b[^>]*?\bsrc=)(["'])([^"']*)\2/gi;

/**
 * Rewrite every <img src="…"> in the rendered Marp HTML so vault-relative
 * paths resolve through Obsidian's resource loader. Absolute URLs and
 * data: URIs are passed through untouched.
 */
export function rewriteImageSrcs(html: string, sourcePath: string, app: App): string {
  return html.replace(IMG_SRC_RE, (_, prefix, quote, src) => {
    const resolved = resolveOne(src, sourcePath, app);
    return `${prefix}${quote}${resolved}${quote}`;
  });
}
