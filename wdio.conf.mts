// WDIO configuration for L4 — Desktop Obsidian E2E.
//
// wdio-obsidian-service handles Obsidian binary download/cache, vault copy,
// and plugin install. We pin one Obsidian app+installer pair for now; the
// release-gate workflow can extend the capabilities array for a matrix.
//
// The local plugin is installed via `plugins: ["."]` — wdio-obsidian-service
// reads ./manifest.json, copies main.js + manifest.json + styles.css into
// the temp vault's .obsidian/plugins/<id>/, and enables it.

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cacheDir = path.join(here, '.obsidian-cache');
const vaultPath = path.join(here, 'tests/e2e/fixtures/vault');

export const config: WebdriverIO.Config = {
  runner: 'local',
  framework: 'mocha',
  tsConfigPath: path.join(here, 'tsconfig.e2e.json'),
  specs: ['./tests/e2e/specs/**/*.e2e.ts'],
  maxInstances: 1,

  capabilities: [
    {
      browserName: 'obsidian',
      browserVersion: 'latest',
      'wdio:obsidianOptions': {
        installerVersion: 'earliest',
        plugins: ['.'],
        vault: vaultPath,
      },
    },
  ],

  services: ['obsidian'],
  reporters: ['spec'],

  cacheDir,
  logLevel: 'warn',
  bail: 0,

  mochaOpts: {
    ui: 'bdd',
    timeout: 120_000,
  },
};
