import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThemeResolver } from '../src/marp/themes';

type FakeFS = {
  files: Record<string, string>;
  folders: Record<string, { files: string[]; folders: string[] }>;
};

function makeApp(fs: FakeFS) {
  return {
    vault: {
      adapter: {
        exists: vi.fn(async (p: string) => p in fs.files || p in fs.folders),
        read: vi.fn(async (p: string) => {
          if (!(p in fs.files)) throw new Error('ENOENT: ' + p);
          return fs.files[p];
        }),
        stat: vi.fn(async (p: string) => {
          if (p in fs.files) return { type: 'file', size: fs.files[p].length, ctime: 0, mtime: 0 };
          if (p in fs.folders) return { type: 'folder', size: 0, ctime: 0, mtime: 0 };
          return null;
        }),
        list: vi.fn(async (p: string) => {
          const f = fs.folders[p];
          if (!f) throw new Error('ENOTDIR: ' + p);
          return { files: f.files, folders: f.folders };
        }),
      },
    },
  } as any;
}

function makeEngine() {
  return { registerTheme: vi.fn() } as any;
}

function makeTFile(path: string) {
  const slash = path.lastIndexOf('/');
  const parentPath = slash > 0 ? path.slice(0, slash) : '/';
  return { path, name: path.slice(slash + 1), parent: { path: parentPath } } as any;
}

const CSS_A = '/* @theme a */ section { color: #aaa; }';
const CSS_B = '/* @theme b */ section { color: #bbb; }';
const CSS_NESTED = '/* @theme nested */ section { color: #ccc; }';
const CSS_EXTRA = '/* @theme extra */ section { color: #eee; }';

describe('ThemeResolver.collect — directory themeSet entries', () => {
  let engine: ReturnType<typeof makeEngine>;

  beforeEach(() => {
    engine = makeEngine();
  });

  it('expands a directory entry with trailing slash to all *.css files', async () => {
    const fs: FakeFS = {
      files: {
        '.marprc.yml': 'themeSet:\n  - themes/\n',
        'themes/a.css': CSS_A,
        'themes/b.css': CSS_B,
      },
      folders: {
        themes: { files: ['themes/a.css', 'themes/b.css'], folders: [] },
      },
    };
    const resolver = new ThemeResolver(makeApp(fs), engine);
    await resolver.collect(makeTFile('slides/deck.md'), null);
    const calls = engine.registerTheme.mock.calls.map((c: any[]) => c[0]);
    expect(calls).toHaveLength(2);
    expect(calls).toEqual(expect.arrayContaining([CSS_A, CSS_B]));
  });

  it('accepts a bare directory string without trailing slash', async () => {
    const fs: FakeFS = {
      files: {
        '.marprc.yml': 'themeSet: themes\n',
        'themes/a.css': CSS_A,
        'themes/b.css': CSS_B,
      },
      folders: {
        themes: { files: ['themes/a.css', 'themes/b.css'], folders: [] },
      },
    };
    const resolver = new ThemeResolver(makeApp(fs), engine);
    await resolver.collect(makeTFile('slides/deck.md'), null);
    const calls = engine.registerTheme.mock.calls.map((c: any[]) => c[0]);
    expect(calls).toHaveLength(2);
    expect(calls).toEqual(expect.arrayContaining([CSS_A, CSS_B]));
  });

  it('still supports a single CSS file path (regression)', async () => {
    const fs: FakeFS = {
      files: {
        '.marprc.yml': 'themeSet:\n  - themes/a.css\n',
        'themes/a.css': CSS_A,
      },
      folders: {
        themes: { files: ['themes/a.css'], folders: [] },
      },
    };
    const resolver = new ThemeResolver(makeApp(fs), engine);
    await resolver.collect(makeTFile('slides/deck.md'), null);
    expect(engine.registerTheme).toHaveBeenCalledTimes(1);
    expect(engine.registerTheme).toHaveBeenCalledWith(CSS_A);
  });

  it('skips non-.css files inside a directory entry', async () => {
    const fs: FakeFS = {
      files: {
        '.marprc.yml': 'themeSet:\n  - themes/\n',
        'themes/a.css': CSS_A,
        'themes/README.md': '# Themes',
        'themes/notes.txt': 'hello',
      },
      folders: {
        themes: {
          files: ['themes/a.css', 'themes/README.md', 'themes/notes.txt'],
          folders: [],
        },
      },
    };
    const resolver = new ThemeResolver(makeApp(fs), engine);
    await resolver.collect(makeTFile('slides/deck.md'), null);
    const calls = engine.registerTheme.mock.calls.map((c: any[]) => c[0]);
    expect(calls).toEqual([CSS_A]);
  });

  it('handles mixed directory and file entries', async () => {
    const fs: FakeFS = {
      files: {
        '.marprc.yml': 'themeSet:\n  - themes/\n  - extra.css\n',
        'themes/a.css': CSS_A,
        'extra.css': CSS_EXTRA,
      },
      folders: {
        themes: { files: ['themes/a.css'], folders: [] },
      },
    };
    const resolver = new ThemeResolver(makeApp(fs), engine);
    await resolver.collect(makeTFile('slides/deck.md'), null);
    const calls = engine.registerTheme.mock.calls.map((c: any[]) => c[0]);
    expect(calls).toHaveLength(2);
    expect(calls).toEqual(expect.arrayContaining([CSS_A, CSS_EXTRA]));
  });

  it('does not recurse into subdirectories (shallow, matches Marp CLI)', async () => {
    const fs: FakeFS = {
      files: {
        '.marprc.yml': 'themeSet:\n  - themes/\n',
        'themes/a.css': CSS_A,
        'themes/sub/nested.css': CSS_NESTED,
      },
      folders: {
        themes: { files: ['themes/a.css'], folders: ['themes/sub'] },
        'themes/sub': { files: ['themes/sub/nested.css'], folders: [] },
      },
    };
    const resolver = new ThemeResolver(makeApp(fs), engine);
    await resolver.collect(makeTFile('slides/deck.md'), null);
    const calls = engine.registerTheme.mock.calls.map((c: any[]) => c[0]);
    expect(calls).toEqual([CSS_A]);
    expect(calls).not.toContain(CSS_NESTED);
  });

  it('silently ignores a themeSet entry that does not exist', async () => {
    const fs: FakeFS = {
      files: {
        '.marprc.yml': 'themeSet:\n  - missing.css\n  - themes/\n',
        'themes/a.css': CSS_A,
      },
      folders: {
        themes: { files: ['themes/a.css'], folders: [] },
      },
    };
    const resolver = new ThemeResolver(makeApp(fs), engine);
    await expect(
      resolver.collect(makeTFile('slides/deck.md'), null),
    ).resolves.not.toThrow();
    const calls = engine.registerTheme.mock.calls.map((c: any[]) => c[0]);
    expect(calls).toEqual([CSS_A]);
  });

  it('resolves themeSet paths relative to the .marprc.yml location, not the vault root', async () => {
    const fs: FakeFS = {
      files: {
        'subdir/.marprc.yml': 'themeSet:\n  - themes/\n',
        'subdir/themes/a.css': CSS_A,
      },
      folders: {
        'subdir/themes': { files: ['subdir/themes/a.css'], folders: [] },
      },
    };
    const resolver = new ThemeResolver(makeApp(fs), engine);
    await resolver.collect(makeTFile('subdir/deck.md'), null);
    expect(engine.registerTheme).toHaveBeenCalledTimes(1);
    expect(engine.registerTheme).toHaveBeenCalledWith(CSS_A);
  });
});
