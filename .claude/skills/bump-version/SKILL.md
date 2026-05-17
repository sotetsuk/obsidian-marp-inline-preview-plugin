---
name: bump-version
description: Bump this Obsidian plugin's version (patch | minor | major | explicit semver). Updates package.json, manifest.json, and versions.json, then creates a git commit and tag. Use when the user asks to release, cut a new version, or bump the plugin version.
---

# bump-version

Releases a new version of the Marp Inline Preview Obsidian plugin.

## How releases work in this repo

- `package.json`, `manifest.json`, and `versions.json` all carry the version. They must stay in sync.
- `npm version <bump>` runs the `version` script (`node version-bump.mjs && git add manifest.json versions.json`), then npm itself stages `package.json`, creates a commit, and creates a tag.
- Existing tags use **no `v` prefix** (e.g. `0.1.0`). Always pass `--tag-version-prefix=""` so we don't introduce a `v0.1.1`-style tag.
- Pushing the tag to GitHub triggers `.github/workflows/release.yml`, which builds and publishes a GitHub Release with `main.js`, `manifest.json`, `styles.css`.

## Arguments

The user invokes this skill via `/bump-version <arg>`. `<arg>` is one of:

- `patch` (default if omitted) — `0.1.0` → `0.1.1`
- `minor` — `0.1.0` → `0.2.0`
- `major` — `0.1.0` → `1.0.0`
- An explicit semver like `0.3.2` — sets that exact version

If the user did not supply an argument, default to `patch` and tell them you're doing so.

## Steps

1. **Pre-flight checks** — run in parallel:
   - `git status --porcelain` — must be empty. If not, stop and tell the user to commit/stash first.
   - `git rev-parse --abbrev-ref HEAD` — warn (don't block) if not on `main`.
   - `git fetch --tags --quiet` then `git tag --list` — confirm no clash with the target version.
   - Read the current version from `package.json`.

2. **Bump** — run:
   ```sh
   npm version <arg> --tag-version-prefix="" --ignore-scripts=false
   ```
   This creates one commit (message = the new version, e.g. `0.1.1`) and one tag (same name).

   `--ignore-scripts=false` is **required**: some users (including this repo's maintainer) set `ignore-scripts=true` in `~/.npmrc` as a security hardening. Without the override, npm silently skips the `version` lifecycle script, leaving `manifest.json` and `versions.json` at the old version while still creating the bump commit and tag.

3. **Verify** — run in parallel:
   - `git log -1 --oneline` — confirm the bump commit exists.
   - `git tag --list --points-at HEAD` — confirm the tag points at it.
   - `cat manifest.json versions.json package.json | grep -E '"version"|"[0-9]'` — sanity-check all three files moved together.

4. **Report** — tell the user the new version and tag name. Then **ask** whether to push:

   > Push `<tag>` and the bump commit to `origin`? That will trigger the release workflow and publish a GitHub Release.

   Do NOT push without explicit confirmation. If they say yes:
   ```sh
   git push origin main && git push origin <tag>
   ```

   If they say no, leave the local commit/tag in place and remind them how to undo:
   ```sh
   git tag -d <tag> && git reset --hard HEAD~1
   ```

## Gotchas

- If `npm version` fails mid-way (e.g. the `version` script errors), the working tree may have partial edits. Inspect with `git status` and resolve before retrying — don't blindly re-run.
- `versions.json` maps plugin version → `minAppVersion`. If the user wants to require a newer Obsidian version, bump `minAppVersion` in `manifest.json` **before** running this skill so `version-bump.mjs` picks it up.
- Never push with `--force` or `--no-verify`.

## Recovery: bump commit missing manifest.json / versions.json

If verification (step 3) shows `manifest.json` or `versions.json` still at the old version while the bump commit and tag already exist (most often because `--ignore-scripts=false` was omitted on a machine with `ignore-scripts=true` in `~/.npmrc`):

1. Confirm the commit has not been pushed (`git status` shows "ahead of origin/main by 1 commit"). If it has been pushed, stop and ask the user before rewriting history.
2. Run `version-bump.mjs` manually so it picks up the already-bumped `package.json`:
   ```sh
   npm_package_version=<new-version> node version-bump.mjs
   ```
3. Amend the bump commit and force-move the tag onto the amended commit:
   ```sh
   git add manifest.json versions.json
   git commit --amend --no-edit
   git tag -f <new-version>
   ```
4. Re-run the step 3 verification commands to confirm all four files (`package.json`, `package-lock.json`, `manifest.json`, `versions.json`) are in the bump commit and the tag points at it.
