# Test Vault

This folder is an Obsidian vault used for developing and exercising the
**Marp Inline Preview** plugin. Open it with `File → Open vault…` in Obsidian
and pick this folder.

Layout:

- `.marprc.yml` — Marp configuration (registers `themes/my-theme.css`).
- `themes/` — Custom CSS themes.
- `slides/` — Sample Marp decks (`basic.md`, `math.md`, `custom-theme.md`).

The plugin itself lives outside this folder. The repo's `scripts/link-test-vault.mjs`
creates a symlink at `.obsidian/plugins/marp-inline-preview/` that points at the
repo root so a single `npm run dev` rebuilds the bundle in place.
