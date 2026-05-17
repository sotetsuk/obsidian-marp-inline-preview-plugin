#!/usr/bin/env node
// Symlink the plugin's build artifacts into test-vault/.obsidian/plugins/marp-inline-preview/
// so that `npm run dev` rewrites them in place and Obsidian picks up changes after a reload.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const target = path.join(repoRoot, 'test-vault', '.obsidian', 'plugins', 'marp-inline-preview');

fs.mkdirSync(path.dirname(target), { recursive: true });

const filesToLink = ['manifest.json', 'styles.css', 'main.js'];

if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
  fs.unlinkSync(target);
}
if (!fs.existsSync(target)) {
  fs.mkdirSync(target, { recursive: true });
}

for (const file of filesToLink) {
  const src = path.join(repoRoot, file);
  const dst = path.join(target, file);
  try {
    if (fs.existsSync(dst) || fs.lstatSync(dst, { throwIfNoEntry: false })) {
      fs.unlinkSync(dst);
    }
  } catch {
    // not present — fine
  }
  if (!fs.existsSync(src)) {
    if (file === 'main.js') {
      // main.js doesn't exist yet on a fresh clone — that's expected.
      console.log(`  [skip] ${file} (run "npm run build" or "npm run dev" first)`);
      continue;
    }
    console.warn(`  [warn] missing ${src}`);
    continue;
  }
  fs.symlinkSync(src, dst);
  console.log(`  linked ${file}`);
}

console.log(`\nPlugin directory: ${target}`);
console.log('Open ./test-vault in Obsidian and enable "Marp Inline Preview" under Community plugins.');
