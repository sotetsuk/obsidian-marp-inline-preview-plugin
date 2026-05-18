#!/usr/bin/env node
// L0 build guards. Run after `npm run build`.
//
// 1) No bare Node-builtin requires survive in main.js. esbuild.config.mjs shims
//    fs/path/url; child_process must never appear. If any of these reach the
//    Obsidian Mobile runtime the plugin fails to load.
// 2) mathjax-full is fully stripped — stripMathjaxPlugin replaces the imports
//    with a throwing Proxy, but the source name should never leak through.
// 3) es-check confirms the bundle is es2020-compatible (iOS Safari 14+,
//    Android WebView 90+). Catches accidental top-level await / lookbehind
//    regressions even though esbuild targets es2018.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bundlePath = path.join(repoRoot, 'main.js');

if (!fs.existsSync(bundlePath)) {
  console.error(`[check-bundle] main.js not found at ${bundlePath}. Run \`npm run build\` first.`);
  process.exit(1);
}

const source = fs.readFileSync(bundlePath, 'utf8');

const bannedRequires = ['fs', 'path', 'url', 'child_process', 'crypto', 'os'];
const failures = [];

for (const name of bannedRequires) {
  // Match: require("fs"), require('fs'), require("node:fs"). Esbuild emits
  // these literal forms; ignore anything inside strings by requiring the
  // surrounding paren+quote.
  const patterns = [
    new RegExp(`require\\(\\s*"${name}"\\s*\\)`),
    new RegExp(`require\\(\\s*'${name}'\\s*\\)`),
    new RegExp(`require\\(\\s*"node:${name}"\\s*\\)`),
    new RegExp(`require\\(\\s*'node:${name}'\\s*\\)`),
  ];
  for (const re of patterns) {
    if (re.test(source)) {
      failures.push(`bundled require(${name}) survived — would break Obsidian Mobile`);
      break;
    }
  }
}

// mathjax-full leak check. The Proxy shim itself mentions "mathjax-full" in
// an error string, so look for module identifiers (path-like) rather than the
// bare word.
if (/["']mathjax-full(\/[^"']+)?["']/.test(source)) {
  failures.push('mathjax-full module path appears in bundle — stripMathjaxPlugin regressed');
}

if (failures.length > 0) {
  console.error('[check-bundle] FAIL');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}

console.log('[check-bundle] banned-imports OK');

// es-check: bundle should run on iOS Safari 14+ / Android WebView 90+.
// es2020 is the floor — it covers optional chaining, nullish coalescing,
// BigInt literals, etc. without depending on es2021+ features that some
// older mobile WebViews still miss.
const esCheck = spawnSync(
  'npx',
  ['--no-install', 'es-check', 'es2020', 'main.js'],
  { cwd: repoRoot, stdio: 'inherit' },
);

if (esCheck.status !== 0) {
  console.error('[check-bundle] es-check failed — bundle uses syntax newer than es2020');
  process.exit(esCheck.status ?? 1);
}

console.log('[check-bundle] OK');
