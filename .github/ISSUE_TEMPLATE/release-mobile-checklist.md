---
name: Release mobile checklist
about: Pre-release manual verification on iOS Obsidian and Android Obsidian
title: 'Release vX.Y.Z: mobile checklist'
labels: ['release', 'mobile-checklist']
assignees: []
---

Pre-release manual checklist for **vX.Y.Z**.

Automated CI (L0+L1+L3+L5+L4) covers desktop and the intermediate output
that's shared across platforms. This issue is the final guard for things
only real iOS/Android Obsidian can validate: WebView-specific rendering,
touch interactions, and the iOS file-picker auth dance. Release.yml will
not publish until this issue is closed.

## iOS Obsidian (latest stable from App Store)

Device: <!-- e.g. iPhone 14, iOS 18.5 -->

- [ ] Plugin enables without error after installing the built `main.js`/`manifest.json`/`styles.css` into `.obsidian/plugins/marp-inline-preview/` in the test vault
- [ ] Opening `deck.md` in editing mode renders one slide per `---` boundary
- [ ] Adding a slide via `---` produces a new iframe in place (no full reload visible)
- [ ] Removing a slide shrinks the deck cleanly
- [ ] Switching Obsidian light/dark theme does not produce a white flash on existing slides
- [ ] Long deck (50+ slides) scrolls smoothly, no blank slides on cull/uncull
- [ ] Switching to reading mode mounts the overlay and hides regular preview
- [ ] Custom CSS theme listed in `.marprc.yml` `themeSet:` loads (drop a vault-local theme and confirm colors apply)
- [ ] KaTeX math in a slide renders correctly (no falling back to raw `$...$`)

## Android Obsidian (latest stable from Play Store)

Device: <!-- e.g. Pixel 7, Android 14 -->

- [ ] All items from the iOS checklist
- [ ] No `ResizeObserver loop completed with undelivered notifications` warning in the Obsidian dev tools console (Android WebView is the platform where this previously surfaced — see `src/util/frame.ts` `ensureSizeObserver`)

## Known-broken scenarios (do not block release)

- <!-- list any pre-existing mobile-specific issues that are tracked elsewhere -->

## Sign-off

- [ ] Closing this issue authorizes the release workflow to publish the tag.
