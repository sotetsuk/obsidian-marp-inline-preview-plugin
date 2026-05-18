# CLAUDE.md

Obsidian plugin that previews Marp slides inline in Editing (Live Preview / Source) and Reading mode. Bundles `@marp-team/marp-core` (same engine as `marp-cli`). Mobile-compatible: `isDesktopOnly: false`; fs/path/url are shimmed in `esbuild.config.mjs` so the bundle loads on iOS/Android.

## Commands

```sh
npm run dev               # esbuild watch
npm run dev:vault         # + symlink build into test-vault/.obsidian/plugins/
npm run build             # tsc check + production bundle to ./main.js
npm test                  # vitest run (unit + DOM + bundle smoke)
npm run test:watch        # vitest in watch mode
npm run test:bundle       # L0 — grep main.js for banned requires + es-check
npm run test:e2e          # L4 — WDIO Obsidian E2E (requires built main.js)
npm run check:types       # tsc --noEmit (src only)
npm run check:types:e2e   # tsc --noEmit -p tsconfig.e2e.json
npm run ci                # check:types → build → test → test:bundle (PR-equivalent)
```

## Testing strategy (6 layers)

Layer details live in `/Users/sotetsuk/.claude/plans/marp-cli-editing-running-mode-kind-diffie.md`.

| Layer | Where | Runs on |
|-------|-------|---------|
| L0 build guards | `scripts/check-bundle.mjs` (banned requires + es-check es2020) | every PR via `ci.yml` |
| L1 logic unit | `tests/{slides,hash,engine,frontmatter,themes}.test.ts` (node env) | every PR |
| L2 marp-core snapshot | `tests/marpCoreSnap.test.ts` + `tests/fixtures/decks/` + `tests/__snapshots__/` | every PR. Bless with `npx vitest -u tests/marpCoreSnap.test.ts` |
| L3 DOM integration | `tests/{stageSyncSlides,frameMount,postProcessor}.test.ts` (happy-dom env via `// @vitest-environment happy-dom`) | every PR |
| L4 Obsidian E2E | `tests/e2e/specs/*.e2e.ts`, `wdio.conf.mts`, fixture vault at `tests/e2e/fixtures/vault/` | nightly (`nightly.yml`) + release gate |
| L5 bundle smoke | `tests/bundleSmoke.test.ts` (requires built main.js with `obsidian` resolved to `tests/obsidian-cjs-stub.cjs`) | every PR |
| L6 mobile manual | `.github/ISSUE_TEMPLATE/release-mobile-checklist.md` | release gate (issue must be closed) |

**Flicker contract** is layered: unit-level paint-count contract in `tests/stageSyncSlides.test.ts` (spies `paintFrame`); runtime rAF-identity sampler in `tests/e2e/specs/flicker.e2e.ts`.

## Conventions when adding tests

- Default env is `node`. DOM tests must declare `// @vitest-environment happy-dom` at the top.
- `tests/setup-dom.ts` shims Obsidian globals (`createEl`, `createDiv`). Add others there, not per-test.
- `tests/obsidian-stub.ts` is the source-side `import 'obsidian'` alias (Vitest). `tests/obsidian-cjs-stub.cjs` is the bundle-side require shim (L5 only).
- `tests/fixtures/decks/*.md` is the L2 corpus — add small representative fixtures here; avoid huge multi-MB decks.
- `tests/e2e/fixtures/vault/` is copied by wdio-obsidian-service per run; transient `.obsidian/workspace*` is gitignored.

## Adding source code

- `src/marp/` — Marp wrapper (engine, theme resolution, frontmatter, slide breaks)
- `src/editor/` — CodeMirror 6 extension + persistent iframe stage. Anti-flicker invariants live in `stage.ts syncSlides()` and `util/frame.ts paintFrame()` — touch carefully and run L3 + L4.
- `src/reading/` — Markdown post-processor (overlay + MutationObserver re-mount)
- `src/util/` — `frame.ts` (iframe mount/paint), `hash.ts` (FNV-1a), `debounce.ts`, `images.ts`

## Versions to keep pinned

- `@marp-team/marp-core` — exact pin in `package.json` (currently `4.3.0`). L2 snapshots assume this. Bump = re-bless snapshots in the same commit.
- `es-check`, `happy-dom`, `wdio-obsidian-service`, `webdriverio` — exact pins to keep CI deterministic.

## Release flow

1. Bump version: `npm version <patch|minor|major>` (runs `version-bump.mjs` for manifest+versions)
2. Open the `Release vX.Y.Z: mobile checklist` issue from the template, run through it on iOS + Android Obsidian, close it
3. `git push --follow-tags`
4. `release.yml` runs: types → build → vitest → bundle guards → L4 E2E → verifies the mobile checklist issue is closed → publishes via `gh release create`

If the release workflow fails at the mobile-checklist gate, the issue is still open — finish the manual verification and close it, then re-run the workflow.

## Gotchas

- `mathjax-full` is replaced with a throwing Proxy in `esbuild.config.mjs` to keep the bundle small. We force `math: 'katex'` in `engine.ts`. The L0 guard fails if `mathjax-full` ever leaks into `main.js`.
- `paintFrame` mutates the iframe's `contentDocument` in place. Never switch it to `iframe.srcdoc = ...` — that triggers a full document reload and the "white flash" we ship against. The L3 spy + L4 rAF tests guard this.
- CM6 viewport-culls block widgets; `SlideStage` deliberately lives in `view.scrollDOM` (outside the widget DOM) so iframes survive cull/uncull. Don't move iframe creation back inside `WidgetType.toDOM()`.
- `host.offsetParent === null` is used in `postProcessor.ts` as a "host is visible" gate. happy-dom returns null for non-laid-out elements, so DOM tests must patch `offsetParent` on the host (see `tests/postProcessor.test.ts`).
