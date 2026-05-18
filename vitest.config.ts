import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      obsidian: path.resolve(__dirname, 'tests/obsidian-stub.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Per-file pragma `// @vitest-environment happy-dom` opts into DOM mode.
    // setupFiles runs in every environment but only mutates globals that
    // exist in happy-dom (document, etc.), so node-mode tests are unaffected.
    setupFiles: ['tests/setup-dom.ts'],
  },
});
