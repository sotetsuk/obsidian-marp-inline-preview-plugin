// L5 — Mobile bundle smoke.
//
// Loads the built main.js inside Node with `obsidian` resolved to a stub.
// Catches: shim leaks (a require("fs") that snuck through), syntax that
// breaks under the production target, top-level await in the bundle, and
// throw-at-load logic in our own code. The same bundle is what Obsidian
// Mobile loads, so if Node refuses to evaluate it, mobile will too.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import Module from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(here);
const bundlePath = path.join(repoRoot, 'main.js');
const stubPath = path.join(here, 'obsidian-cjs-stub.cjs');

type ModuleInternals = {
  _resolveFilename: (
    request: string,
    parent: NodeJS.Module | null,
    isMain: boolean,
    options?: Record<string, unknown>,
  ) => string;
  _cache: Record<string, NodeJS.Module>;
};

describe('bundled main.js smoke (L5)', () => {
  let bundleExports: { default?: unknown } & Record<string, unknown> = {};

  beforeAll(() => {
    if (!fs.existsSync(bundlePath)) {
      throw new Error(
        `main.js not found at ${bundlePath}. Run \`npm run build\` before \`npm run test\`.`,
      );
    }

    const internals = Module as unknown as ModuleInternals;
    const originalResolve = internals._resolveFilename;
    internals._resolveFilename = function patched(request, parent, isMain, options) {
      if (request === 'obsidian') return stubPath;
      return originalResolve.call(this, request, parent, isMain, options);
    };
    delete internals._cache[bundlePath];

    try {
      const req = createRequire(import.meta.url);
      bundleExports = req(bundlePath);
    } finally {
      internals._resolveFilename = originalResolve;
    }
  });

  it('evaluates without throwing and exposes a default export', () => {
    expect(bundleExports).toBeTruthy();
    expect(bundleExports.default).toBeDefined();
    expect(typeof bundleExports.default).toBe('function');
  });

  it('default export extends the stubbed Plugin class', () => {
    const stub = require(stubPath);
    const PluginCtor = bundleExports.default as { prototype: object };
    const stubPlugin = stub.Plugin as { prototype: object };
    expect(Object.getPrototypeOf(PluginCtor)).toBe(stubPlugin);
    expect(PluginCtor.prototype).toBeInstanceOf(stubPlugin);
  });

  it('can be instantiated with a minimal stub app', () => {
    const PluginCtor = bundleExports.default as new (
      app: unknown,
      manifest: unknown,
    ) => { app: unknown };
    const instance = new PluginCtor({}, { id: 'test', name: 'test', version: '0.0.0' });
    expect(instance).toBeTruthy();
    expect(instance.app).toEqual({});
  });
});
